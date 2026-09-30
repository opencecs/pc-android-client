package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"edgeclient/updater"
)

// ========== 客户端启动上报（日活统计）==========
//
// 接口是公开的、无需鉴权：
//
//	POST https://newapi.moyunteng.com/api/v1/device/startup
//	→ {"code_id":200,"msg":"success","data":{"recorded":true}}
//
// 难点不在发这个请求，而在客户端常年不关：纯启动上报会漏掉后面每一天的日活。
// 所以这里用「30 分钟轮询 + 本地记录已上报日期」的跨天补报：
// 每次醒来重新算一遍当天日期，与本地记录比对，日期变了就补报一次。
// 午夜定时器在休眠 / 改系统时间 / 跨时区时都会失效，轮询式比对能自己收敛回来。
//
// 上报失败不影响任何既有功能：整个服务跑在独立 goroutine 里，带 recover() 兜底。

const (
	startupReportURL        = "https://newapi.moyunteng.com/api/v1/device/startup"
	startupReportClientType = 1 // 1=老 v3 客户端，2=AI 客户端
	startupReportInterval   = 30 * time.Minute
	startupReportTimeout    = 10 * time.Second
	startupReportIPTimeout  = 6 * time.Second
	startupReportIPCacheTTL = 30 * time.Minute
	startupReportUIDWait    = 20 * time.Second
	startupReportConfigFile = "startup_report.json"
)

// startupReportTZ 统一按 UTC+8 切天，与服务器口径对齐，不受本机时区影响。
var startupReportTZ = time.FixedZone("CST", 8*3600)

// startupReportRetryLadder 启动重试阶梯：开机时网络往往还没就绪。
var startupReportRetryLadder = []time.Duration{0, 10 * time.Second, 30 * time.Second, 60 * time.Second}

// startupReportIPEndpoints 公网 IP 查询源，按顺序尝试；全部失败则传空串，
// 由服务端回退到连接来源 IP（比上报内网 IP 更可靠）。
// 实测（2026-09-24）：ipip 走直连、拿到的才是本机真实公网 IP；
// ipinfo / ipify 走代理，返回的是代理出口 IP，所以放后面兜底。
var startupReportIPEndpoints = []string{
	"https://myip.ipip.net",
	"https://ipinfo.io/ip",
	"https://api.ipify.org?format=json",
}

var startupReportIPv4Re = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)

var startupReportDayRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

var startupReportDeviceIDRe = regexp.MustCompile(`^[0-9A-F]{12}$`)

// startupReportPayload 上报请求体
type startupReportPayload struct {
	DeviceID      string `json:"device_id"`
	UID           string `json:"uid"`
	IP            string `json:"ip"`
	OS            string `json:"os"`
	ClientVersion string `json:"client_version"`
	StartupTime   int64  `json:"startup_time"`
	ClientType    int    `json:"client_type"`
}

// startupReportResponse 上报响应体
type startupReportResponse struct {
	CodeID int    `json:"code_id"`
	Msg    string `json:"msg"`
	Data   struct {
		// Recorded true=本次落库，false=当天已上报过（服务端去重命中）
		Recorded bool `json:"recorded"`
	} `json:"data"`
}

// startupReportState 持久化到 %AppData%\edgeclient\startup_report.json 的状态
type startupReportState struct {
	DeviceID string `json:"device_id"`
	LastDay  string `json:"last_day"` // 已成功上报的日期 YYYY-MM-DD (UTC+8)
	LastAt   int64  `json:"last_at"`  // 上次成功上报的 Unix 秒
	LastUID  string `json:"last_uid"` // 上次上报时携带的 uid，用于判断要不要补报
}

// startupReporter 启动上报服务
type startupReporter struct {
	mu sync.Mutex

	deviceID   string    // 本机标识，首次运行随机生成后持久化
	uid        string    // 前端登录后回填，可为空
	lastDay    string    // 已成功上报的日期
	lastAt     time.Time // 上次成功上报时间（本机时钟）
	lastUID    string    // 上次上报携带的 uid
	needUIDRpt bool      // 当天已报但没带 uid，等拿到 uid 后补报一次

	osVersion string
	version   string

	cachedIP   string
	cachedIPAt time.Time

	uidReady     chan struct{} // SetStartupReportUid 首次拿到非空 uid 时关闭
	uidReadyOnce sync.Once
	kick         chan struct{} // 需要立即重试一次上报
	stopCh       chan struct{}
	stopOnce     sync.Once

	http     *http.Client // 上报专用
	ipClient *http.Client // 公网 IP 查询专用
}

// 构造器只做纯内存初始化，刻意不碰系统 API：
// 它在 startup() 的同步路径上被调用，不在 goroutine 的 recover 覆盖范围内，
// 一旦 panic 会直接带崩应用启动。系统版本 / 客户端版本改到 load() 里读（见那里注释）。
func newStartupReporter() *startupReporter {
	return &startupReporter{
		uidReady: make(chan struct{}),
		kick:     make(chan struct{}, 1),
		stopCh:   make(chan struct{}),
		// 走 443，证书正常，无需跳过 TLS 校验。
		http: &http.Client{
			Timeout: startupReportTimeout,
		},
		ipClient: &http.Client{
			Timeout: startupReportIPTimeout,
		},
	}
}

// startupReportGuard 把统计功能的任何 panic 挡在日志里，绝不向调用方传播。
// 日活统计是纯旁路，任何情况下都不允许影响客户端正常使用。
func startupReportGuard(what string) {
	if rec := recover(); rec != nil {
		log.Printf("[启动上报] %s 异常，已忽略: %v", what, rec)
	}
}

// StartStartupReport 启动客户端启动上报服务。后台 goroutine，不阻塞应用启动。
// 从 startup() 同步调用，所以全程不允许 panic 外溢。
func (a *App) StartStartupReport() {
	defer startupReportGuard("启动")
	if a.startupReport != nil {
		return
	}
	r := newStartupReporter()
	a.startupReport = r
	r.start()
}

// StopStartupReport 停止启动上报服务。
func (a *App) StopStartupReport() {
	defer startupReportGuard("停止")
	if a.startupReport != nil {
		a.startupReport.stop()
	}
}

// SetStartupReportUid 前端在启动/登录后回填 uid，供启动上报使用。
// Go 读不到前端的 localStorage，只能由前端主动推过来。
func (a *App) SetStartupReportUid(uid string) {
	defer startupReportGuard("回填 uid")
	if a.startupReport != nil {
		a.startupReport.setUID(uid)
	}
}

func (r *startupReporter) start() {
	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("[启动上报] 服务异常退出: %v", rec)
			}
		}()

		r.load()

		// 等前端回填 uid 一小会儿：已登录用户第一次上报就能带上 uid，
		// 未登录 / 无人值守的客户端超时后照常上报，不会漏设备。
		select {
		case <-r.uidReady:
		case <-time.After(startupReportUIDWait):
		case <-r.stopCh:
			return
		}

		// ① 启动重试阶梯：开机时网络往往还没就绪
		for _, d := range startupReportRetryLadder {
			if d > 0 {
				select {
				case <-time.After(d):
				case <-r.stopCh:
					return
				}
			}
			if r.safeTryReport() {
				break
			}
		}

		// ② 稳态：30 分钟一轮，跨天补报
		ticker := time.NewTicker(startupReportInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				r.safeTryReport()
			case <-r.kick:
				r.safeTryReport()
			case <-r.stopCh:
				return
			}
		}
	}()
}

func (r *startupReporter) stop() {
	r.stopOnce.Do(func() { close(r.stopCh) })
}

// setUID 前端回填 uid。当天已上报过但当时没带 uid 时，允许补报一次。
func (r *startupReporter) setUID(uid string) {
	uid = strings.TrimSpace(uid)
	if uid == "" {
		return
	}

	r.mu.Lock()
	changed := r.uid != uid
	r.uid = uid
	needKick := false
	// 当天已经上报过、且当时 uid 是空的 → 补报一次，让服务端有机会补上 uid。
	// 服务端若按天去重不做覆盖，这次请求也无害（每天最多多一次）。
	if changed && r.lastDay == startupReportToday() && r.lastUID == "" {
		r.needUIDRpt = true
		needKick = true
	}
	r.mu.Unlock()

	r.uidReadyOnce.Do(func() { close(r.uidReady) })

	if needKick {
		select {
		case r.kick <- struct{}{}:
		default:
		}
	}
}

// load 读取本地状态；首次运行生成 device_id。
// 系统版本 / 客户端版本也在这里解析：读注册表等系统调用放在 goroutine 内，
// 万一出错（或 panic）只影响统计，不会波及 startup()。
func (r *startupReporter) load() {
	r.osVersion = getOSVersionString()
	r.version = startupReportClientVersion()

	if path, err := startupReportConfigPath(); err == nil {
		if data, err := os.ReadFile(path); err == nil {
			var st startupReportState
			if err := json.Unmarshal(data, &st); err == nil {
				r.deviceID = strings.ToUpper(strings.TrimSpace(st.DeviceID))
				r.lastUID = strings.TrimSpace(st.LastUID)
				// 日期非法（文件损坏 / 手改）当作没有记录，宁可多发一次
				if startupReportDayRe.MatchString(st.LastDay) {
					r.lastDay = st.LastDay
				}
				if st.LastAt > 0 {
					r.lastAt = time.Unix(st.LastAt, 0)
				}
			} else {
				log.Printf("[启动上报] 读取本地状态失败，按首次运行处理: %v", err)
			}
		}
	} else {
		log.Printf("[启动上报] 定位配置目录失败，本次不上报: %v", err)
	}

	if !startupReportDeviceIDRe.MatchString(r.deviceID) {
		r.deviceID = newStartupReportDeviceID()
		log.Printf("[启动上报] 生成新的 device_id: %s", r.deviceID)
		r.save()
	}

	log.Printf("[启动上报] 服务已启动: device_id=%s os=%s version=%s 上次上报=%s",
		r.deviceID, r.osVersion, r.version, startupReportOrNone(r.lastDay))
}

// tryReport 返回 true 表示"当天已完成"（成功上报或服务端去重命中），false 表示本次失败需重试。
func (r *startupReporter) tryReport() bool {
	if r.isTodayDone() {
		return true
	}
	return r.report()
}

// safeTryReport 包一层 recover 再调 tryReport。
// 单次上报出意外只丢这一次，不能把常驻的轮询 goroutine 带走——否则这个会话就再也不上报了。
func (r *startupReporter) safeTryReport() bool {
	ok := false
	func() {
		defer startupReportGuard("单次上报")
		ok = r.tryReport()
	}()
	return ok
}

// isTodayDone 判断当天是否已经上报完成。
func (r *startupReporter) isTodayDone() bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.deviceID == "" {
		return false
	}
	if r.needUIDRpt {
		return false // uid 刚回填，补报一次
	}
	// 系统时钟被调回过去时 lastAt 会落在未来，此时不能认定"今天已报"，
	// 宁可多发一次由服务端去重兜底。
	// 命中这里每 30 分钟就会走一次，是正常稳态，刻意不打日志免得刷屏。
	if r.lastDay == startupReportToday() && !r.lastAt.After(time.Now()) {
		return true
	}
	return false
}

// report 执行一次上报，成功返回 true。
func (r *startupReporter) report() bool {
	r.mu.Lock()
	deviceID, uid := r.deviceID, r.uid
	r.mu.Unlock()

	if deviceID == "" {
		return false
	}

	payload := startupReportPayload{
		DeviceID:      deviceID,
		UID:           uid,
		IP:            r.publicIP(),
		OS:            r.osVersion,
		ClientVersion: r.version,
		StartupTime:   time.Now().Unix(),
		ClientType:    startupReportClientType,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[启动上报] 序列化请求失败: %v", err)
		return false
	}

	req, err := http.NewRequest("POST", startupReportURL, bytes.NewReader(body))
	if err != nil {
		log.Printf("[启动上报] 构造请求失败: %v", err)
		return false
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := r.http.Do(req)
	if err != nil {
		log.Printf("[启动上报] 请求失败（下个周期重试）: %v", err)
		return false
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if err != nil {
		log.Printf("[启动上报] 读取响应失败（下个周期重试）: %v", err)
		return false
	}
	if resp.StatusCode != http.StatusOK {
		log.Printf("[启动上报] 响应状态码异常 %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
		return false
	}

	var result startupReportResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		log.Printf("[启动上报] 解析响应失败: %v，原始内容: %s", err, strings.TrimSpace(string(respBody)))
		return false
	}
	if result.CodeID != 200 {
		log.Printf("[启动上报] 服务端返回失败 code_id=%d msg=%s", result.CodeID, result.Msg)
		return false
	}

	// recorded=false 表示当天已上报过（去重命中），当天确实已被记录，同样算完成。
	now := time.Now()
	r.mu.Lock()
	r.lastDay = now.In(startupReportTZ).Format("2006-01-02")
	r.lastAt = now
	r.lastUID = uid
	r.needUIDRpt = false
	r.mu.Unlock()
	r.save()

	log.Printf("[启动上报] device_id=%s uid=%s ip=%s os=%s version=%s client_type=%d → recorded=%v",
		deviceID, startupReportOrNone(uid), payload.IP, r.osVersion, r.version, startupReportClientType, result.Data.Recorded)
	return true
}

// publicIP 查询本机公网 IP。全部查询源失败时返回空串，
// 由服务端回退到连接来源 IP（比上报内网 IP 更可靠）。
func (r *startupReporter) publicIP() string {
	r.mu.Lock()
	if r.cachedIP != "" && time.Since(r.cachedIPAt) < startupReportIPCacheTTL {
		ip := r.cachedIP
		r.mu.Unlock()
		return ip
	}
	r.mu.Unlock()

	for _, endpoint := range startupReportIPEndpoints {
		if ip := fetchStartupReportPublicIP(r.ipClient, endpoint); ip != "" {
			r.mu.Lock()
			r.cachedIP = ip
			r.cachedIPAt = time.Now()
			r.mu.Unlock()
			return ip
		}
	}

	log.Printf("[启动上报] 公网 IP 查询失败，ip 留空由服务端取连接来源地址")
	return ""
}

func fetchStartupReportPublicIP(client *http.Client, endpoint string) string {
	resp, err := client.Get(endpoint)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return ""
	}

	// 三个查询源返回格式各不相同（纯文本 / JSON），统一用正则抓第一个合法公网 IPv4。
	for _, candidate := range startupReportIPv4Re.FindAllString(string(body), -1) {
		ip := net.ParseIP(candidate)
		if ip == nil || ip.To4() == nil {
			continue
		}
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			continue
		}
		return candidate
	}
	return ""
}

// save 把状态写回本地。失败只打日志，不影响上报流程。
func (r *startupReporter) save() {
	path, err := startupReportConfigPath()
	if err != nil {
		log.Printf("[启动上报] 定位配置目录失败，状态未保存: %v", err)
		return
	}

	r.mu.Lock()
	st := startupReportState{
		DeviceID: r.deviceID,
		LastDay:  r.lastDay,
		LastUID:  r.lastUID,
	}
	if !r.lastAt.IsZero() {
		st.LastAt = r.lastAt.Unix()
	}
	r.mu.Unlock()

	data, err := json.Marshal(st)
	if err != nil {
		log.Printf("[启动上报] 序列化状态失败: %v", err)
		return
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		log.Printf("[启动上报] 写入状态失败: %v", err)
	}
}

// startupReportConfigPath 返回状态文件路径。
// 注意不要复用 app.go 的 getConfigPath()：它出错时直接 panic，
// 在后台 goroutine 里会带崩整个应用。
func startupReportConfigPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	appDir := filepath.Join(configDir, "edgeclient")
	if err := os.MkdirAll(appDir, 0777); err != nil {
		return "", err
	}
	return filepath.Join(appDir, startupReportConfigFile), nil
}

// newStartupReportDeviceID 生成 12 位大写 hex 的本机标识（形如 A1B2C3D4E5F6）。
func newStartupReportDeviceID() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		// 极端情况（随机源不可用）：用时间戳 + pid 派生，保证非空
		sum := sha256.Sum256([]byte(fmt.Sprintf("%d-%d", time.Now().UnixNano(), os.Getpid())))
		copy(buf, sum[:6])
	}
	return strings.ToUpper(hex.EncodeToString(buf))
}

// startupReportClientVersion 取客户端版本（ldflags 从 build/config.yml 注入）。
func startupReportClientVersion() string {
	v := strings.TrimSpace(updater.AppVersion)
	if v == "" {
		return "unknown"
	}
	return v
}

func startupReportToday() string {
	return time.Now().In(startupReportTZ).Format("2006-01-02")
}

func startupReportOrNone(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
