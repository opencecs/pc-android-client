package eventws

import (
	"context"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// 事件通道路径与默认端口（§1、§10）
const (
	eventPath     = "/ws/events"
	defaultWSPort = "8000"
	eventwsURLFmt = "ws://%s" + eventPath
)

// degradeDuration 是 404（老 SDK 无此端点）的降级时长：期间不再拨号，
// 到期后由下一次 Sync 重新探测一次（§3.3）。
const degradeDuration = 10 * time.Minute

// Device 是一条待建连的设备。
//
// Key 是宿主仓库用来索引自己的缓存的键（本仓库是设备 IP，公网设备形如 "1.2.3.4:8187"）；
// Host 是实际拨号地址，留空则用 Key。两者分开是为了让集成层可以
// 用"缓存键"报告状态、用"拨号地址"建连，互不干扰。
type Device struct {
	Key      string
	Host     string
	DeviceID string // 已知设备 ID，写进 deviceId 头（可空）

	// SkipWS：true 表示这台设备不建 WS 连。
	// 本仓库里对应 OpenCecs/公网设备（只有映射端口，没有局域网 8000），
	// 它们的数据继续走既有 REST 路径（§10"public 模式无 WS"）。
	SkipWS bool
}

// Handlers 是事件消费方（集成层）需要实现的回调集合。
//
// 全部回调都在该设备的消费 goroutine 上**串行**调用，实现方不需要自己加锁防乱序，
// 但绝不能在里面做长阻塞（读循环已经解耦，但同设备事件会排队）。
//
// 只实现关心的方法：内嵌 BaseHandlers，其余自动空实现。
type Handlers interface {
	OnHello(key string, h *HelloFrame)
	OnSnapshot(key string, f *SnapshotFrame)
	OnContainerEvent(key string, ev *ContainerEvent)
	OnBootEvent(key string, ev *BootEvent)
	OnContainerStats(key string, stats []ContainerStats)
	OnSystemStats(key string, data map[string]interface{})
}

// BaseHandlers 是 Handlers 的空实现，供集成层内嵌后只覆盖需要的方法。
type BaseHandlers struct{}

func (BaseHandlers) OnHello(string, *HelloFrame)                  {}
func (BaseHandlers) OnSnapshot(string, *SnapshotFrame)            {}
func (BaseHandlers) OnContainerEvent(string, *ContainerEvent)     {}
func (BaseHandlers) OnBootEvent(string, *BootEvent)               {}
func (BaseHandlers) OnContainerStats(string, []ContainerStats)    {}
func (BaseHandlers) OnSystemStats(string, map[string]interface{}) {}

// Service 按设备管理事件通道连接，并把帧路由给 Handlers。
//
// 它同时是在线性的**上报方**：状态判定在 conn 里做，落到宿主数据由
// stateReporter 完成（§5.2、§5.3）。
type Service struct {
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	mu      sync.RWMutex
	conns   map[string]*conn
	degrade map[string]time.Time // 404 降级记忆：key → 到期时间
	// degradeTimer 每台降级设备的"到期再拨一次"定时器。撤掉 TCP 探活之后它是
	// 老 SDK 设备**唯一**的翻身机会：Sync 只在启动和设备列表变动时跑一次，
	// 等 Sync 重新探测等于"升级完固件也得重启客户端才上线"。
	degradeTimer map[string]*time.Timer
	targets      map[string]Device // 最新设备信息（hello 会回填 DeviceID）
	// seenDomain 记录每台设备已经报过一次的未知事件域，避免"SDK 加了新域"
	// 变成每帧一行日志（见 dispatch 的 default 分支）。Sync 时随设备一起清。
	seenDomain map[string]map[string]bool
	stopped    bool

	stateMu     sync.Mutex
	lastState   map[string]State
	stateReport func(key string, st State)
	stateQuery  func(key string) State

	cfgMu          sync.RWMutex
	handlers       Handlers
	passwordGetter func(ip string) string
	logFn          func(string)
	rttReport      func(key string, ms int64)
	dialPort       string // 空 = defaultWSPort，测试可覆盖
}

// New 创建服务。调用 Start 之前不会有任何 goroutine。
func New() *Service {
	return &Service{
		conns:        make(map[string]*conn),
		degrade:      make(map[string]time.Time),
		degradeTimer: make(map[string]*time.Timer),
		targets:      make(map[string]Device),
		lastState:    make(map[string]State),
		seenDomain:   make(map[string]map[string]bool),
	}
}

// ---------- 依赖注入（全部要在 Start/Sync 之前完成，§7）----------

// SetHandlers 注入事件消费方。
func (s *Service) SetHandlers(h Handlers) {
	s.cfgMu.Lock()
	s.handlers = h
	s.cfgMu.Unlock()
}

// SetPasswordGetter 注入取设备密码的函数。
//
// 契约（§7，真机踩坑）：参数**必须是剥掉端口后的纯设备 IP**。
// 传拨号地址（"ip:8000"）会永远查不到密码，导致配了密码的设备全量 401。
func (s *Service) SetPasswordGetter(fn func(ip string) string) {
	s.cfgMu.Lock()
	s.passwordGetter = fn
	s.cfgMu.Unlock()
}

// SetLogHandler 注入日志出口（前端调试用，§6.3）。
func (s *Service) SetLogHandler(fn func(string)) {
	s.cfgMu.Lock()
	s.logFn = fn
	s.cfgMu.Unlock()
}

// SetStateReporter 注入在线状态落地函数。
func (s *Service) SetStateReporter(fn func(key string, st State)) {
	s.cfgMu.Lock()
	s.stateReport = fn
	s.cfgMu.Unlock()
}

// SetStateQueryer 注入"宿主当前实际状态"读取函数，用于两级去重的第二级对账（§5.2）。
func (s *Service) SetStateQueryer(fn func(key string) State) {
	s.cfgMu.Lock()
	s.stateQuery = fn
	s.cfgMu.Unlock()
}

// SetRTTReporter 注入往返时延回调：每次 ping 拿到 pong 后调用一次（≤keepaliveInterval）。
//
// 集成层据此维护前端的"延迟"列 —— 接管在线性后就不再有独立的 TCP 探活，
// WS 自带的 ping/pong 是唯一还在周期性跑的往返测量（也顺便证明通道活着）。
func (s *Service) SetRTTReporter(fn func(key string, ms int64)) {
	s.cfgMu.Lock()
	s.rttReport = fn
	s.cfgMu.Unlock()
}

// SetDialPort 覆盖拨号端口（测试缝，缺省 8000）。
func (s *Service) SetDialPort(port string) {
	s.cfgMu.Lock()
	s.dialPort = port
	s.cfgMu.Unlock()
}

// ---------- 生命周期 ----------

// Start 启动服务的根 context。幂等：重复调用无副作用。
func (s *Service) Start() {
	s.mu.Lock()
	if s.ctx != nil {
		s.mu.Unlock()
		return
	}
	s.stopped = false
	s.ctx, s.cancel = context.WithCancel(context.Background())
	s.mu.Unlock()
}

// Sync 用权威设备列表对账：不在列表里的断开，列表内的幂等建连（§4.3）。
//
// 必须传入**全部** local 设备（含当前被判离线的）：拨号本身就是探测——
// 拨通并收到 snapshot 才算在线，拨号失败才判离线。若只喂"已在线"的设备，
// 撤掉周期探活后就没有任何东西能把离线设备拉回在线（启动死锁）。
func (s *Service) Sync(devs []Device) {
	s.Start()

	want := make(map[string]Device, len(devs))
	for _, d := range devs {
		if d.Key == "" {
			continue
		}
		want[d.Key] = d
	}

	now := time.Now()
	var disconnects []*conn
	var expired []string

	s.mu.Lock()
	for key, c := range s.conns {
		if _, ok := want[key]; !ok {
			disconnects = append(disconnects, c)
			delete(s.conns, key)
		}
	}
	for key, until := range s.degrade {
		if now.After(until) {
			expired = append(expired, key) // 到期：允许本轮重新探测
		}
	}
	for _, key := range expired {
		delete(s.degrade, key)
	}
	// 已移除的设备：连带清掉状态记忆，避免 map 无界增长
	for _, c := range disconnects {
		delete(s.degrade, c.key)
		delete(s.targets, c.key)
		s.clearDegradeRetry(c.key) // 不摘就等于给一台已删除的设备留了个未来拨号
	}
	// 降级中的设备不在 conns 里（markDegraded 已摘掉连接），上面那轮清不到它。
	// 设备被删除时必须连带忘掉降级记忆，否则 degrade/targets 会跟着 IP 的更替无限堆积。
	for key := range s.targets {
		if _, ok := want[key]; !ok {
			delete(s.targets, key)
			delete(s.degrade, key)
			s.clearDegradeRetry(key)
		}
	}
	for key := range s.degrade {
		if _, ok := want[key]; !ok {
			delete(s.degrade, key)
		}
	}
	// 未知事件域的记忆也必须跟着设备走：否则 IP 换了主人，
	// 新设备多出来的那个域永远报不出第二遍。
	for key := range s.seenDomain {
		if _, ok := want[key]; !ok {
			delete(s.seenDomain, key)
		}
	}
	for key, d := range want {
		if old, ok := s.targets[key]; ok && d.DeviceID == "" {
			d.DeviceID = old.DeviceID // 别让调用方用空值覆盖掉 hello 学到的 ID
		}
		s.targets[key] = d
	}
	s.mu.Unlock()

	s.stateMu.Lock()
	for _, c := range disconnects {
		delete(s.lastState, c.key)
	}
	for key := range s.lastState {
		if _, ok := want[key]; !ok {
			delete(s.lastState, key)
		}
	}
	s.stateMu.Unlock()

	for _, c := range disconnects {
		c.cancel()
	}
	for _, d := range want {
		s.Connect(d)
	}
}

// Connect 幂等地为某台设备建连：已有连接、正在降级、或标记 SkipWS 都跳过。
func (s *Service) Connect(d Device) {
	if d.Key == "" || d.SkipWS {
		return
	}
	s.Start()

	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return
	}
	if _, ok := s.conns[d.Key]; ok {
		s.mu.Unlock()
		return
	}
	if until, ok := s.degrade[d.Key]; ok {
		if time.Now().Before(until) {
			s.mu.Unlock()
			return
		}
		delete(s.degrade, d.Key) // 降级到期，重新探测一次
	}
	if d.Host == "" {
		d.Host = d.Key
	}
	if old, ok := s.targets[d.Key]; ok && d.DeviceID == "" {
		d.DeviceID = old.DeviceID
	}
	s.targets[d.Key] = d

	ctx := s.ctx
	c := newConn(ctx, s, d.Key)
	s.conns[d.Key] = c
	s.mu.Unlock()

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		c.run()
	}()
}

// Disconnect 断开某台设备（设备被删除时调用）。
func (s *Service) Disconnect(key string) {
	s.mu.Lock()
	c := s.conns[key]
	delete(s.conns, key)
	delete(s.degrade, key)
	delete(s.targets, key)
	s.clearDegradeRetry(key)
	s.mu.Unlock()

	s.stateMu.Lock()
	delete(s.lastState, key)
	s.stateMu.Unlock()

	if c != nil {
		c.cancel()
	}
}

// Stop 断开全部连接（程序退出时调用）。
func (s *Service) Stop() {
	s.mu.Lock()
	if s.cancel != nil {
		s.cancel()
	}
	s.stopped = true
	for key, c := range s.conns {
		delete(s.conns, key)
		c.cancel()
	}
	// 降级中的设备不在 conns 里，但到期重拨的定时器还挂着：不摘就是退出后
	// 又凭空拨一台已经不监控的设备（targets 也一起清了，回调会自己收手，但没必要留）。
	for key := range s.degradeTimer {
		s.clearDegradeRetry(key)
	}
	s.mu.Unlock()

	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		s.logf("Stop 等待连接退出超时（3s），放弃等待")
	}
}

// Owns 报告这台设备**此刻**有没有一条未被降级的连接在跑（纯诊断口径）。
//
// 别拿它当宿主的探活让位判据：404 降级中的设备答案是 false，而它的在线性照样归
// 事件通道判 —— 那种形状恰恰就是"拨号判它离线"本身。让位判据请用 ServesWS。
// 要不要停掉周期 REST 轮询请用 Healthy（更保守）。
func (s *Service) Owns(key string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.conns[key]; !ok {
		return false
	}
	_, degraded := s.degrade[key]
	return !degraded
}

// Healthy 报告某台设备的事件流是否**真的在供数**：有连接、未降级、本轮收到过
// snapshot，且 maxIdle 内有过数据帧。
//
// 集成层用它决定"要不要把旧的周期轮询缩掉"：
// 只看 Owns 会有空窗 —— 老 SDK 之外的设备也可能连上 8000 端口却一帧不发
// （SDK 半启动、代理吞帧），此时事件没接管、轮询又关了，容器列表直接冻住。
// 用 Healthy 做闸门，事件流一断超过 maxIdle，轮询自动接手。
func (s *Service) Healthy(key string, maxIdle time.Duration) bool {
	s.mu.RLock()
	c, ok := s.conns[key]
	_, degraded := s.degrade[key]
	s.mu.RUnlock()

	if !ok || degraded || c == nil {
		return false
	}
	return c.snapshotSeen.Load() && c.idle() <= maxIdle
}

// Degraded 报告设备是否处于 404 降级期（集成层据此保留 REST 兜底路径）。
func (s *Service) Degraded(key string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	until, ok := s.degrade[key]
	return ok && time.Now().Before(until)
}

// ServesWS 报告这台设备的在线性**该不该**归事件通道管：被 Sync/Connect 登记过
// 且不是 SkipWS。
//
// 与"现在有没有连接、是不是正在降级、退避到第几轮"全都无关 —— 拨不通、404 降级、
// 断线重拨中这几种形状恰恰就是"拨号判它离线"本身。
//
// 集成层的 TCP 探活让位判据用它而不是 Owns：用 Owns 时，拨到 404 的老 SDK 设备会被
// 探活接回去、显示在线到进程重启；用 ServesWS 之后这批设备统一显示离线，固件升到
// v206+ 由 markDegraded 那枚到期定时器重新拨出来（armDegradeRetry）。
// 唯一还归探活的是 SkipWS 的公网/OpenCecs 设备：它们照样进 targets（Sync 按 IP 记账），
// 但 Connect 一开始就返回，永远不会有人替它们判死活。
func (s *Service) ServesWS(key string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	d, ok := s.targets[key]
	return ok && !d.SkipWS
}

// StateOf 返回本服务对该设备最近一次的在线性判定。
//
// **注意零值**：State 的第一个常量是 StateOnline，所以"从没上报过"与"判过在线"
// 在这里是同一个答案。要区分两者请用 reportState 里那种显式 `known` 判断
// （或直接问 livenessSettled），别写 `StateOf(k) != StateOnline` 当离线证据。
func (s *Service) StateOf(key string) State {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	return s.lastState[key]
}

// livenessSettled 报告"判它离线"这件事是不是已经落地：本服务最近一次上报是离线，
// **并且宿主那半边也认离线**。
//
// 只看 lastState 会漏掉一种真出现过的形状：手动刷新/改密那条 REST 路径把一台
// 事件通道已判离线的设备又写回 online，而事件通道因为"自己报过离线了"闭嘴
// —— 于是它在线到进程重启。多问一句宿主的看法，这种不一致就会在下一次拨号时被
// 纠正回来，而正常的退避循环（宿主也一直说离线）依然只报一次、不刷日志墙。
func (s *Service) livenessSettled(key string) bool {
	s.stateMu.Lock()
	st, known := s.lastState[key]
	s.stateMu.Unlock()
	if !known || st != StateOffline {
		return false
	}
	s.cfgMu.RLock()
	query := s.stateQuery
	s.cfgMu.RUnlock()
	return query == nil || query(key) == StateOffline
}

// ---------- 内部 ----------

// dropDeviceID 忘掉已知的设备身份（拨号 403：IP 被复用 / 缓存过期）。
//
// 403 是设备在说"这个 IP 不是我以为的那台"。留着错的 deviceId 会每次都 403，
// 事件通道彻底接不上手；清掉后下一次 hello 会重新学到正确身份。
func (s *Service) dropDeviceID(key string) {
	s.mu.Lock()
	if d, ok := s.targets[key]; ok && d.DeviceID != "" {
		d.DeviceID = ""
		s.targets[key] = d
	}
	s.mu.Unlock()
}

// markDegraded 记住"这台设备不支持事件通道"，一段时间内不再拨号。
//
// 降级不是终态：装一枚到期定时器，到点重新拨一次。老 SDK 升到 v206+ 之后
// 没人再拨它的话，它会在离线里待到进程重启。
func (s *Service) markDegraded(key string) {
	s.mu.Lock()
	until := time.Now().Add(degradeDuration)
	s.degrade[key] = until
	c := s.conns[key]
	delete(s.conns, key)
	s.mu.Unlock()
	if c != nil {
		c.cancel()
	}
	s.armDegradeRetry(key, until)
}

// armDegradeRetry 装/换某台设备降级到期的重拨定时器。
//
// 不能持着 s.mu 调 time.AfterFunc 的回调里那些事（Connect 要拿同一把锁），
// 所以回调自己重新排队取锁；Timer.Stop 不等回调跑完，反向也不会死锁。
func (s *Service) armDegradeRetry(key string, until time.Time) {
	s.mu.Lock()
	if t, ok := s.degradeTimer[key]; ok {
		t.Stop()
	}
	s.degradeTimer[key] = time.AfterFunc(time.Until(until), func() {
		s.mu.Lock()
		delete(s.degradeTimer, key)
		d, tracked := s.targets[key]
		stopped := s.stopped
		s.mu.Unlock()

		// 设备已被移出监控列表（targets 随 Sync/Disconnect 清掉）或在退出：不拨。
		if !tracked || stopped || d.SkipWS {
			return
		}
		s.logf("%s 降级到期，重新探测事件通道（固件升级后靠这一步自动上线）", key)
		s.Connect(d) // 幂等：还是 404 就再进一次降级 + 再装一枚定时器
	})
	s.mu.Unlock()
}

// clearDegradeRetry 忘掉某台设备的到期重拨定时器。调用方必须已持有 s.mu。
func (s *Service) clearDegradeRetry(key string) {
	if t, ok := s.degradeTimer[key]; ok {
		t.Stop()
		delete(s.degradeTimer, key)
	}
}

// noteHello 把 hello 学到的设备身份回填到 target（供下次拨号的 deviceId 头），
// 并把整帧交给 OnHello。
//
// 两件事的成立条件不同：回填需要 deviceId，OnHello 不需要 —— 方案 §3.1 写明
// deviceId 在 v206 上可以省略。若因为缺 ID 就连整帧都不报，被关掉的恰好是
// "hello 兜底机型/固件版本"这条路径，而最需要用它的正是这批老固件设备。
func (s *Service) noteHello(key string, h *HelloFrame) {
	if h == nil {
		return
	}
	if h.DeviceID != "" {
		s.mu.Lock()
		if d, ok := s.targets[key]; ok && d.DeviceID != h.DeviceID {
			d.DeviceID = h.DeviceID
			s.targets[key] = d
		}
		s.mu.Unlock()
	}

	if hd := s.handlersValue(); hd != nil {
		hd.OnHello(key, h)
	}
}

// noteNewDomain 报告该设备的这个事件域是不是**第一次**见到。
//
// dispatch 对未知事件域只记日志不改连接（前向兼容），但"SDK 加了个新域"
// 会让该域的每一帧都撞进那条日志 —— 按帧记就成了永久日志墙，
// 而它想表达的信息只有一句："这个版本设备多了一种事件，我们还没接"。
func (s *Service) noteNewDomain(key, event, action string) bool {
	id := event + "/" + action

	s.mu.Lock()
	defer s.mu.Unlock()
	set := s.seenDomain[key]
	if set == nil {
		set = make(map[string]bool, 4)
		s.seenDomain[key] = set
	}
	if set[id] {
		return false
	}
	set[id] = true
	return true
}

// noteRTT 把一次 ping/pong 的往返时延交给宿主。取锁外调用回调：
// 宿主要拿自己的锁写状态，锁序反过来会构成死锁环（同 reportState）。
func (s *Service) noteRTT(key string, rtt time.Duration) {
	s.cfgMu.RLock()
	fn := s.rttReport
	s.cfgMu.RUnlock()
	if fn == nil {
		return
	}
	ms := rtt.Milliseconds()
	if ms < 0 {
		ms = 0
	}
	fn(key, ms)
}

func (s *Service) handlersValue() Handlers {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	return s.handlers
}

// reportState 上报在线性，两级去重（§5.2）。
//
// 第一级 lastState：**必须显式判 known** —— map 缺 key 的零值恰好等于
// StateOnline(0)，只比值会把新设备的首次在线上报静默吞掉
// （真机踩坑：134 台设备只有 5 台显示在线）。
// 第二级 query 宿主实际状态：让 config 被外部写歪时能自愈 ——
// 下一个心跳帧（≤20s）发现不一致就重报纠正。
func (s *Service) reportState(key string, st State) {
	s.stateMu.Lock()
	prev, known := s.lastState[key]
	s.lastState[key] = st
	s.stateMu.Unlock()

	s.cfgMu.RLock()
	report := s.stateReport
	query := s.stateQuery
	s.cfgMu.RUnlock()

	if known && prev == st && (query == nil || query(key) == st) {
		return
	}
	if report == nil {
		return
	}
	report(key, st)
}

// dispatch 把已解析的帧路由给 Handlers。运行在消费 goroutine 上，
// 因此加 recover：业务侧一次 panic 不该带走整个进程。
func (s *Service) dispatch(key string, f *Frame) {
	h := s.handlersValue()
	if h == nil {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			s.logf("%s 事件处理 panic：%v", key, r)
		}
	}()

	switch f.Type {
	case FrameSnapshot:
		if f.Snapshot != nil {
			h.OnSnapshot(key, f.Snapshot)
		}

	case FrameEvent:
		ef := f.Event
		if ef == nil {
			return
		}
		switch ef.Event {
		case EventContainer:
			if ef.Action == ActionStats {
				stats, err := ParseContainerStatsData(ef)
				if err != nil {
					s.logf("%s container/stats 解析失败：%v", key, err)
					return
				}
				h.OnContainerStats(key, stats)
				return
			}
			ev, err := ParseContainerEventData(ef)
			if err != nil {
				s.logf("%s container 事件解析失败：%v", key, err)
				return
			}
			h.OnContainerEvent(key, ev)

		case EventBoot:
			ev, err := ParseBootEventData(ef)
			if err != nil {
				s.logf("%s boot 事件解析失败：%v", key, err)
				return
			}
			h.OnBootEvent(key, ev)

		case EventSystem:
			if ef.Action != ActionStats {
				return // system/resync 已在帧处理阶段消化
			}
			data, err := ParseSystemStatsData(ef)
			if err != nil {
				s.logf("%s system/stats 解析失败：%v", key, err)
				return
			}
			h.OnSystemStats(key, data)

		default:
			// 只在第一次见到时记一行：未知域会按帧撞上这里，逐帧记就是一堵
			// 永久日志墙，而它要传达的信息只有一句"这批设备多了一种事件，还没接"。
			if s.noteNewDomain(key, ef.Event, ef.Action) {
				s.logf("%s 未处理的事件域：%s/%s（忽略，本设备此类只记一次）", key, ef.Event, ef.Action)
			}
		}
	}
	// FrameResyncRequired 没有语义载荷，不需要路由
}

// dialRequest 组装拨号地址与握手头（§3.3、§7 密码纯 IP 契约）。
func (s *Service) dialRequest(key string) (string, http.Header) {
	s.mu.RLock()
	d := s.targets[key]
	s.mu.RUnlock()

	host := d.Host
	if host == "" {
		host = key
	}
	host = ensurePort(host, s.port())

	header := http.Header{}
	// 密码按**纯 IP** 查：宿主的密码表以纯 IP 为 key
	if ip := deviceIPOf(host); ip != "" {
		if pw := s.password(ip); pw != "" {
			header.Set("Authorization", "Basic "+
				base64.StdEncoding.EncodeToString([]byte("admin:"+pw)))
		}
	}
	if d.DeviceID != "" {
		header.Set("deviceId", d.DeviceID)
	}
	return fmt.Sprintf(eventwsURLFmt, host), header
}

func (s *Service) password(ip string) string {
	s.cfgMu.RLock()
	fn := s.passwordGetter
	s.cfgMu.RUnlock()
	if fn == nil {
		return ""
	}
	return fn(ip)
}

func (s *Service) port() string {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	if s.dialPort != "" {
		return s.dialPort
	}
	return defaultWSPort
}

func (s *Service) logf(format string, args ...interface{}) {
	msg := format
	if len(args) > 0 {
		msg = fmt.Sprintf(format, args...)
	}
	s.cfgMu.RLock()
	fn := s.logFn
	s.cfgMu.RUnlock()
	if fn != nil {
		fn(msg)
	}
}

// ensurePort 给地址补默认端口（幂等，语义与宿主 deviceAddr 一致）。
func ensurePort(host, port string) string {
	if _, _, err := net.SplitHostPort(host); err == nil {
		return host
	}
	return net.JoinHostPort(host, port)
}

// deviceIPOf 剥掉端口，返回纯 IP。IPv6 无端口时原样返回。
func deviceIPOf(host string) string {
	if host == "" {
		return host
	}
	if ip, _, err := net.SplitHostPort(host); err == nil {
		return ip
	}
	return strings.Trim(host, "[]")
}
