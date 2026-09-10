package main

// ========== 设备事件通道（SDK v206+ ws://<ip>:8000/ws/events）集成层 ==========
//
// internal/eventws 只负责协议与连接，本文件负责把帧落到**既有缓存**里：
//
//	snapshot        → androidCache[ip].List（与 GET /android 同构的响应）
//	container/boot  → 按容器名补丁 status
//	container/stats → 补丁 cpu/mem/disk（不 bump 版本，见下）
//	system/stats    → deviceStatusMap 的指标字段（替代 30s /info/device 轮询）
//	hello           → 机型/固件/设备ID + API 版本号（替代 /info 的 currentVersion）
//	在线性上报      → deviceStatusMap[ip].Status（online/offline）
//
// 实测覆盖面（2026-09-04 直连 205/198 的 /ws/events 逐帧枚举）：
//
//	hello                → proto sdkVersion(v208) deviceVersion(固件全串) deviceId model serverTime
//	event system/stats   → 每 20s 一帧，只有 cputemp cpuload memuse mmctotal mmcuse
//	                       mmcread mmcwrite mmctemp sysuptime 九个键
//	event container/stats→ 每 20s，每容器 cpuUsage memUsage diskUsage status
//
// 于是 REST 只留下事件流真给不了的字段：/info 的 latestVersion，/info/device 的
// memtotal（内存列的分母）/ speed / mmcmodel / hwaddr / ip_1 / network4g。
// **这些也不再由本文件打**：设备一生不变，选中设备时前端自己查一次 /info/device
// （App.vue fetchV3DeviceInfo）就够了，另外手动刷新、离线转在线、改密、升级后
// 各有 REST 触发点。原来这里是"上线打一对打底 + 60s 定时器常驻兜底"，两头都拆了。
// 代价：拨 /ws/events 得 404 的老 SDK 设备与 SkipWS 的公网设备没有事件流。前者从
// 2026-09-04 起**直接显示离线**（在线性归事件通道判，探活不再接手），固件升到带
// 事件通道的版本后最多 degradeDuration 就会被重拨一次并自动上线；后者仍归 TCP 探活。
// 两类设备的存储/版本/网速都不再常驻刷新，只在被选中或手动刷新时查得到。
//
// 前端零改动：它按 GetAndroidCacheVersions / GetDevicesStatus 轮询版本号，
// 所以这里只做"写同一份缓存 + 需要时 bump Version"，不发新事件、不加绑定方法。
//
// 并发纪律：androidCache 里的 map 会被 Wails 在**锁外**序列化（GetAndroidContainersList
// 直接返回 cache.List），所以事件路径绝不原地改这些 map —— 一律
// 复制-修改-写回（见 patchAndroidCache），否则会撞上
// fatal error: concurrent map iteration and map write。

import (
	"log"
	"net"
	"strconv"
	"strings"
	"time"

	"edgeclient/internal/eventws"
)

// eventwsStreamFresh 是"事件流仍在供数"的宽限期：超过这个时间没有帧，
// 就认为事件通道没接管成功，把原来的周期轮询放回来（自动兜底，无需人工干预）。
const eventwsStreamFresh = 60 * time.Second

// eventwsRefetchCooldown 是"事件里出现未知容器 → 拉一次全量"的限频窗口。
const eventwsRefetchCooldown = 5 * time.Second

// initEventws 装配事件通道服务（只注入依赖，不建连）。
// 建连时机：UpdateMonitoredDevices 拿到权威设备列表后 Sync 对账。
func (a *App) initEventws() {
	svc := eventws.New()
	svc.SetHandlers(&eventwsBridge{app: a})
	// 契约：参数是**剥掉端口的纯 IP**（密码表以纯 IP 为 key，传 host:port 会全量 401）
	svc.SetPasswordGetter(func(ip string) string { return a.getDevicePasswordInternal(ip) })
	svc.SetLogHandler(func(line string) { log.Printf("[事件通道] %s", line) })
	svc.SetStateReporter(a.applyEventwsState)
	svc.SetStateQueryer(a.deviceStateForEventws)
	// 延迟列的数据源：接管在线性后这台设备不再被单独 TCP 探活，
	// WS 自己的 ping/pong 是唯一还在跑的周期往返测量。
	svc.SetRTTReporter(a.applyEventwsRTT)
	a.eventwsSvc = svc
	log.Printf("[事件通道] 已装配（等待设备列表对账建连）")
}

// StopEventws 关闭全部事件通道连接（程序退出时调用）。
func (a *App) StopEventws() {
	if a.eventwsSvc == nil {
		return
	}
	log.Printf("[事件通道] 停止中...")
	a.eventwsSvc.Stop()
}

// ---------- 连接对账 ----------

// syncEventws 用当前监控列表对账连接：新增的建连、移除的断开（幂等，可随时调用）。
func (a *App) syncEventws() {
	if a.eventwsSvc == nil {
		return
	}
	devs := a.eventwsDevices()
	a.eventwsSvc.Sync(devs)
	a.pruneEventwsHostMemory(devs)
	if n := len(devs); n > 0 {
		log.Printf("[事件通道] 对账完成：%d 台设备", n)
	}
}

// pruneEventwsHostMemory 忘掉已移除设备在宿主这半边的记忆。
//
// 两个 map 都以 IP 为 key，而 IP 会被 DHCP 回收复用，不清有两处后患：
//   - 新设备一上线就撞上上一台留下的补查冷却（eventwsRefetchCooldown），
//     真的缺容器时那次 REST 全量补查会被静默跳过；
//   - 上一台 401 留下的 authPending 会让"这次是真离线"被 deviceStateForEventws
//     答成 AuthFail，去重第二级判成一致而少报一次，前端白弹密码框。
//
// 与 Service.Sync 清 targets/degrade/lastState 同一口径 —— 包内那半边已经清了，
// 宿主这半边漏了（同一次改动引入的对称缺口）。
func (a *App) pruneEventwsHostMemory(devs []eventws.Device) {
	keep := make(map[string]struct{}, len(devs))
	for _, d := range devs {
		keep[d.Key] = struct{}{}
	}

	a.eventwsRefetchMu.Lock()
	for ip := range a.eventwsRefetchAt {
		if _, ok := keep[ip]; !ok {
			delete(a.eventwsRefetchAt, ip)
		}
	}
	a.eventwsRefetchMu.Unlock()

	a.eventwsAuthMu.Lock()
	for ip := range a.eventwsAuthFail {
		if _, ok := keep[ip]; !ok {
			delete(a.eventwsAuthFail, ip)
		}
	}
	a.eventwsAuthMu.Unlock()
}

// eventwsDevices 把监控列表换算成建连目标。
func (a *App) eventwsDevices() []eventws.Device {
	a.deviceIPsMutex.RLock()
	ips := make([]string, len(a.deviceIPs))
	copy(ips, a.deviceIPs)
	a.deviceIPsMutex.RUnlock()

	out := make([]eventws.Device, 0, len(ips))
	for _, ip := range ips {
		if ip == "" {
			continue
		}
		out = append(out, a.eventwsDevice(ip))
	}
	return out
}

// eventwsDevice 把单台设备换算成建连目标。
func (a *App) eventwsDevice(ip string) eventws.Device {
	d := eventws.Device{Key: ip, Host: ip}
	// 已带端口的设备是 OpenCecs 公网映射：只有映射端口，没有局域网 8000，
	// 不建 WS 连，容器数据继续走既有 REST 路径（方案 §10「public 模式无 WS」）。
	if _, _, err := net.SplitHostPort(ip); err == nil {
		d.SkipWS = true
	}
	if id := a.cachedDeviceID(ip); id != "" {
		d.DeviceID = id // 带上已知身份：IP 被复用时报 403 而不是错认设备
	}
	return d
}

// eventwsReconnect 用最新密码重连一台设备（密码变更后调用）。
//
// 密码只在拨号时读取，已建立的连接不会自动换密码，必须断一次重拨。
func (a *App) eventwsReconnect(ip string) {
	if a.eventwsSvc == nil || ip == "" {
		return
	}
	d := a.eventwsDevice(ip)
	if d.SkipWS {
		return // 公网设备不建连，无需重连
	}
	a.eventwsSvc.Disconnect(ip)
	a.eventwsSvc.Connect(d)
}

// ReconnectDeviceEventWS 前端发现"离线"设备的 HTTP 其实活着时调用：立刻重拨
// 它的事件通道，不等 404 降级的到期定时器（最长还要 10 分钟）。
//
// 典型场景：设备被别人（另一台客户端 / 现场）升级到带 /ws/events 的新 SDK——
// 事件通道那边我只会等到降级到期才发现。版本探测（切页 / 切筛选 / 手动刷新
// 时前端直连 /info）拿到了响应，说明设备活着且版本在动，就值得立刻试拨一把：
// 拨到 hello 自动上线；设备其实还是老 SDK 就重新 404 降级，自愈无害。SkipWS
// 公网设备由 eventwsReconnect 内部守卫跳过。自己升级的设备走升级轮询里的
// eventwsReconnect，不依赖这里。
func (a *App) ReconnectDeviceEventWS(deviceIP string) {
	a.eventwsReconnect(deviceIP)
}

// eventwsHealthy 报告这台设备的容器数据是否已由事件流供着（且仍在供数）。
// 集成层据此把被取代的周期轮询缩到"事件管不到的设备"上。
func (a *App) eventwsHealthy(ip string) bool {
	return a.eventwsSvc != nil && a.eventwsSvc.Healthy(ip, eventwsStreamFresh)
}

// needsRESTPoll 报告这台设备**是否还需要**旧的 REST 周期轮询。
//
// 事件流健康时，/android 与 system/storage、system/version 三条轮询都已由
// snapshot / container 事件 / system/stats 接管（口径见方案 §5 / §8）。
// 判定只在"拿到肯定证据"时才免掉轮询：
//   - Healthy：真的收到过快照、且 ≤eventwsStreamFresh 内有帧 → 轮询全部让位；
//   - 其余（404 降级 / 公网不建连 / 从未拨号 / 拨号失败 / 流静默超时 / 401）
//     → 继续轮询，等价于改造前的行为。
//
// 401 不再算免轮询的理由（真机复盘）：WS 要密码而 REST 那侧未必拿不到数据
// （密码表缺项、REST 会话另有一套凭证），一旦"卡在 401"就把轮询关掉，就会出现
// **列表显示在线、容器数据却永久冻结**的半态 —— 比多刷几个 401 严重得多。
// （从前这半句还叠着"探活会因 /info 正常把设备写回 online"，现在拨不通的设备由
// 拨号自己判离线，不再有这个来回打脸；但结论不变，而且更成立：轮询是这类设备
// 唯一的数据来源。）唯一持有免轮询资格的条件仍是"事件流真的在供数"。
//
// 不拿 StateOf 当条件是故意的：未上报过的设备在 map 里取到零值，而零值恰好是
// StateOnline，会把"事件通道还没建起来"读成"已在线"，于是轮询被误关
// （同一类零值陷阱，manager.reportState 的第一级去重也踩过）。
// 事件通道未装配（nil）时返回 true：完全退回改造前的行为。
func (a *App) needsRESTPoll(ip string) bool {
	if a.eventwsSvc == nil {
		return true
	}
	return !a.eventwsHealthy(ip)
}

// eventwsOwnsLiveness 报告这台设备的在线性**该不该**归事件通道判：被登记在监控列表里
// 且不是 SkipWS，就归它 —— 与"现在有没有连接、是不是正在 404 降级"全都无关。
//
// 归它管之后，TCP 探活对这台设备一个字节都不发：一次 WS 拨号本身就是 TCP 连 8000 +
// HTTP 握手 + 认证，比一次裸 connect 更强的证据。拨通后收到任意帧 → 在线；
// 拨不通 / 读错误 / 看门狗超时 / **404 不支持事件通道** → claimOffline 判离线
// （internal/eventws/client.go）。
//
// 404 从"让回探活"改成"直接判离线"是 2026-09-04 的现场决策：老 SDK 设备要显示离线，
// 而不是"在线但存储/版本/容器那几格永远空着"。自动上线的机会挂在 markDegraded 的到期
// 定时器上（降级 ≤10 分钟重拨一次），固件升到带 /ws/events 的版本后无需重启客户端。
//
// 只剩一类设备答 false、仍归 TCP 探活兜着（这也是探活不能整体删掉的理由）：
//   - 公网 / OpenCecs 映射设备（key 带端口 → SkipWS）：压根不建连，容器数据也继续走 REST；
//   - 事件通道未装配、或还没跑过第一次对账（启动早期，退回改造前行为）。
//
// 名字相近的两个谓词问的**不是**一个问题，改动时别拿错：
//   - 这个（在线性归不归事件通道判）→ 决定 **TCP 探活**跑不跑；
//   - eventwsHealthy（流在不在供数）→ 决定 **REST 轮询**让不让位，是数据口径。
//
// 一台拨不通的设备因此是 eventwsOwnsLiveness=true（不再探活，死活由拨号判）而
// eventwsHealthy=false（REST 照轮，哪天拨通了也不会漏一段数据）。
func (a *App) eventwsOwnsLiveness(ip string) bool {
	return a.eventwsSvc != nil && a.eventwsSvc.ServesWS(ip)
}

// cachedDeviceID 取缓存里已知的设备 ID（来自 /info/device 或 hello）。
func (a *App) cachedDeviceID(ip string) string {
	a.deviceStatusMutex.RLock()
	defer a.deviceStatusMutex.RUnlock()
	if st := a.deviceStatusMap[ip]; st != nil {
		return st.DeviceID
	}
	return ""
}

// ---------- 在线性上报（§5.1 / §5.2 / §5.3）----------

// applyEventwsState 把事件通道的在线性判定写进 deviceStatusMap。
//
// 调用方（Service.reportState）已做两级去重，同一状态不会反复进来。
func (a *App) applyEventwsState(ip string, st eventws.State) {
	name := a.getDeviceName(ip)

	switch st {
	case eventws.StateOnline:
		a.setEventwsAuthPending(ip, false)
		a.deviceStatusMutex.Lock()
		status := a.deviceStatusMap[ip]
		if status == nil {
			status = &DeviceStatus{IP: ip}
			a.deviceStatusMap[ip] = status
		}
		alreadyOnline := status.Status == "online"
		if !alreadyOnline {
			status.Status = "online"
			status.ConsecutiveFailures = 0
			status.ConsecutiveSuccesses = 1
			status.LastCheckAt = time.Now()
		}
		a.deviceStatusMutex.Unlock()

		if alreadyOnline {
			return
		}
		log.Printf("[事件通道] ✅ 设备 %s (%s) 上线（WS 心跳）", ip, name)

	case eventws.StateAuthFail:
		// 401：设备可达但密码缺失/不对 → 交认证链路（通知前端输入密码）。
		// 在线性记为离线；容器列表按"认证失败不给前端读过期数据"的既有口径清掉
		// （见下面 updateAndroidCacheError），密码改对后由 snapshot 整份还原。
		a.setEventwsAuthPending(ip, true)
		a.markDeviceOffline(ip, "事件通道 401（需要密码）")
		// 把认证态落到 androidCache：这是前端唯一认的"该输密码了"信号。
		//
		// 方案的 §5.1 把 401 定成 State 2（既非在线也非普通离线，探活不得覆盖），
		// 但本仓库的 deviceStatusMap 只有 online/offline 两态，没有地方放它 ——
		// 于是 WS 报的 401 只会把设备写成"离线"，密码框永远不弹。两个真事故形状：
		//   - 密码被改而旧连接还活着：事件流仍在供数 → REST 轮询被让位 →
		//     android_poll.go 那个唯一的 auth_fail 写入点不再触发 → 界面显示在线、
		//     数据照常刷新，只有日志知道密码已经不对了；
		//   - 连接断开后重拨拿 401：设备被标 offline，而 /android 轮询只给 online
		//     设备跑（dispatchAndroidPoll）→ 同样产不出 auth_fail → 用户看到"离线"
		//     而不是"请输入密码"。
		// 写在这里等于把 REST 路径的口径补到 WS 路径上（同 updateAndroidCacheError
		// 的 auth_fail 分支：清列表 + bump 版本 → 前端 2s 循环弹框）。恢复也是自动的：
		// 密码改对 → eventwsReconnect → 建连第二帧 snapshot 把 Status 写回 "ok"。
		a.updateAndroidCacheError(ip, "auth_fail", "事件通道 401（需要密码）", false)
		go a.addToAuthQueue(ip)

	default: // StateOffline
		a.setEventwsAuthPending(ip, false)
		a.markDeviceOffline(ip, "事件通道断开")
	}
}

// applyEventwsRTT 把一次 ping/pong 的往返时延写进延迟列（≤30s 刷新一次）。
//
// 只在设备已被事件通道记为在线时写：pong 只证明传输层还通，证明不了有人在发事件；
// 设备一旦判离线，延迟就该停在最后一次真值上，由重连后的事件流重新接管。
// 取 deviceStatusMutex 前不碰事件通道的锁（回调已由 noteRTT 在锁外发起）。
func (a *App) applyEventwsRTT(ip string, ms int64) {
	a.deviceStatusMutex.Lock()
	defer a.deviceStatusMutex.Unlock()
	st := a.deviceStatusMap[ip]
	if st == nil || st.Status != "online" {
		return
	}
	st.ResponseTime = ms
	st.LastSuccessLatency = ms
	st.LastCheckAt = time.Now()
}

// markDeviceOffline 把设备标为离线（幂等）。
func (a *App) markDeviceOffline(ip, reason string) {
	a.deviceStatusMutex.Lock()
	status := a.deviceStatusMap[ip]
	if status == nil {
		status = &DeviceStatus{IP: ip, Status: "offline"}
		a.deviceStatusMap[ip] = status
		a.deviceStatusMutex.Unlock()
		return
	}
	wasOnline := status.Status == "online"
	if wasOnline {
		status.Status = "offline"
		status.ConsecutiveSuccesses = 0
		status.LastCheckAt = time.Now()
	}
	a.deviceStatusMutex.Unlock()

	if wasOnline {
		log.Printf("[事件通道] ❌ 设备 %s (%s) 离线（%s）", ip, a.getDeviceName(ip), reason)
	}
}

// setEventwsAuthPending 记录"这台设备当前卡在认证失败"，供两级去重的第二级对账。
//
// 没有这个标记时，query 只能回答 online/offline，AuthFail 会被判成
// "宿主状态不一致"，于是每个心跳帧（≤20s）都重报一次 401 → 前端弹窗风暴。
func (a *App) setEventwsAuthPending(ip string, pending bool) {
	a.eventwsAuthMu.Lock()
	if a.eventwsAuthFail == nil {
		a.eventwsAuthFail = make(map[string]bool)
	}
	if pending {
		a.eventwsAuthFail[ip] = true
	} else {
		delete(a.eventwsAuthFail, ip)
	}
	a.eventwsAuthMu.Unlock()
}

func (a *App) eventwsAuthPending(ip string) bool {
	a.eventwsAuthMu.Lock()
	defer a.eventwsAuthMu.Unlock()
	return a.eventwsAuthFail[ip]
}

// deviceStateForEventws 返回宿主当前**实际**记录的在线性（去重第二级对账用，§5.2）。
//
// 设备未初始化 = 未知 = 离线：这样新设备的首报一定会落地。
func (a *App) deviceStateForEventws(ip string) eventws.State {
	a.deviceStatusMutex.RLock()
	status := a.deviceStatusMap[ip]
	online := status != nil && status.Status == "online"
	a.deviceStatusMutex.RUnlock()

	if online {
		return eventws.StateOnline
	}
	if a.eventwsAuthPending(ip) {
		return eventws.StateAuthFail
	}
	return eventws.StateOffline
}

// ---------- Handlers 实现 ----------

type eventwsBridge struct {
	eventws.BaseHandlers
	app *App
}

// OnSnapshot 整设备覆盖容器列表（建连第二帧 / resync 响应）。
func (b *eventwsBridge) OnSnapshot(ip string, f *eventws.SnapshotFrame) {
	a := b.app
	if f == nil {
		return
	}
	// AndroidResponse() 造出与 GET /android 同构的 {code,data:{count,list}}，
	// 下游（截图任务 / RPA / 前端解析）零改动即可消费。
	payload := f.AndroidResponse()

	a.androidCacheMutex.Lock()
	cache := a.androidCache[ip]
	if cache == nil {
		cache = &AndroidDeviceCache{}
		a.androidCache[ip] = cache
	}
	// changed 只决定记不记下面那行日志：resync 响应会反复送同一份清单，日志跟着帧走
	// 就是每 10s 一行"快照覆盖 39 个容器"，把关键线索埋掉。
	changed := !sameContainerNames(cache.List, f.List)
	cache.List = payload
	cache.LastAttempt = time.Now()
	cache.Error = ""
	cache.FailCount = 0
	cache.Status = "ok"
	// 通知**不参与**"变没变"的判断：每份快照都 bump 版本。
	//
	// 这里原先省掉的那一次前端拉取，省出来的是静默丢数据：
	//   - 容器在 WS 掉线的窗口里 die 了 → 重连后的事件补丁已经把 status 写成 stopped
	//     → 快照与缓存"看起来一样" → 这一格永远不 bump → 前端 2s 循环比对版本不变，
	//     界面就一直显示 running，再没有别的东西会来纠正它；
	//   - destroy + create 同名同为 stopped 时同理：那张卡带着旧的 indexNum / ip /
	//     adbPort，点「使用软件」会连到别的坑位上去。
	// 方案 §6.1 的契约本来就是「snapshot → 合并 → 通知」，通知不带条件。代价可控：
	// 快照只在建连和 resync 时出现（resync 限频 10s），而 REST 那条路
	// （pollSingleDevice）本来就是每次成功都无条件 bump —— 不会比改造前多拉一次表。
	//
	// 同一毫秒内连着两份快照时 UnixMilli 会撞值，而前端比的是 `!==`，撞值等于没通知，
	// 所以这里保证的是"版本号一定动"。
	if v := time.Now().UnixMilli(); v > cache.Version {
		cache.Version = v
	} else {
		cache.Version++
	}
	a.androidCacheMutex.Unlock()

	if changed {
		log.Printf("[事件通道] 📦 设备 %s 快照覆盖：%d 个容器", ip, len(f.List))
	}
}

// OnContainerEvent 容器生命周期事件（docker 直出，最终真相）。
func (b *eventwsBridge) OnContainerEvent(ip string, ev *eventws.ContainerEvent) {
	a := b.app
	if ev == nil {
		return
	}

	// destroy：从缓存移除（先按名字清截图，再删容器）
	if eventws.RemoveOnDestroy(ev.Action) {
		hits, _ := a.patchAndroidCache(ip, containerPatch{
			match:  containerMatcher(ev.Name, ev.ID),
			remove: true,
		})
		a.invalidateScreenshotOf(ip, ev.Name)
		log.Printf("[事件通道] 🗑 设备 %s 容器 %s destroy（缓存命中 %d）", ip, ev.Name, hits)
		return
	}

	if ev.Action == eventws.ActionOOM {
		// oom 只告警，不改状态（§3.2）
		log.Printf("[事件通道] ⚠️ 设备 %s 容器 %s 触发 OOM", ip, ev.Name)
		return
	}

	status := ev.Status
	if status == "" {
		status = eventws.ContainerActionToStatus(ev.Action)
	}
	if status == "" {
		return // 未知 action：保守不动状态
	}

	hits, changed := a.patchAndroidCache(ip, containerPatch{
		match: containerMatcher(ev.Name, ev.ID),
		apply: func(cm map[string]interface{}) bool {
			if cur, _ := cm["status"].(string); cur == status {
				return false
			}
			cm["status"] = status
			return true
		},
	})

	if hits == 0 {
		// 快照里没有这个容器：外部创建 / 快照滞后 → 拉一次全量补齐（限频）
		a.eventwsRefetch(ip, "未知容器 "+ev.Name)
		return
	}

	// 状态转换 → 这张画面已经不可信，清掉旧图；新容器由 1s 截图轮询自然抓
	switch ev.Action {
	case eventws.ActionStart, eventws.ActionStop, eventws.ActionDie:
		a.invalidateScreenshotOf(ip, ev.Name)
	}

	if changed {
		log.Printf("[事件通道] 🐳 设备 %s 容器 %s → %s（%s）", ip, ev.Name, status, ev.Action)
	}
}

// OnBootEvent 开机过程事件（boot 只是过程展示，container 事件是最终真相）。
func (b *eventwsBridge) OnBootEvent(ip string, ev *eventws.BootEvent) {
	a := b.app
	if ev == nil {
		return
	}
	status := eventws.BootActionToStatus(ev.Action)
	if status == "" {
		return
	}

	hits, changed := a.patchAndroidCache(ip, containerPatch{
		match: bootMatcher(ev.Name, ev.ID, ev.IndexNum),
		apply: func(cm map[string]interface{}) bool {
			// 容器已 running 时不被 boot 的中间态回退（开机事件可能晚到）
			if cur, _ := cm["status"].(string); cur == eventws.StatusRunning && status != eventws.StatusRunning {
				return false
			}
			if cur, _ := cm["status"].(string); cur == status {
				return false
			}
			cm["status"] = status
			return true
		},
	})

	if hits == 0 {
		// 开机时容器常常还没进快照：拉一次全量（限频，boot 序列不会刷屏）
		a.eventwsRefetch(ip, "boot 未知容器 "+ev.Name)
		return
	}
	if changed {
		log.Printf("[事件通道] 🚀 设备 %s 容器 %s 开机中 → %s（%s）", ip, ev.Name, status, ev.Action)
	}
}

// OnContainerStats 容器指标批量补丁。
//
// 本仓库前端目前不展示容器级 cpu/mem/disk（无任何消费方），所以**不 bump 版本号**：
// 写进缓存供 RPA/后续使用，但不让 20s 一次的指标触发前端整表重取。
func (b *eventwsBridge) OnContainerStats(ip string, stats []eventws.ContainerStats) {
	a := b.app
	if len(stats) == 0 {
		return
	}
	byName := make(map[string]eventws.ContainerStats, len(stats))
	byID := make(map[string]eventws.ContainerStats, len(stats))
	for _, s := range stats {
		if s.Name != "" {
			byName[s.Name] = s
		}
		if s.ID != "" {
			byID[s.ID] = s
		}
	}

	a.patchAndroidCache(ip, containerPatch{
		silent: true,
		match: func(cm map[string]interface{}) bool {
			name, _ := cm["name"].(string)
			if _, ok := byName[name]; ok {
				return true
			}
			id := containerID(cm)
			_, ok := byID[id]
			return ok
		},
		apply: func(cm map[string]interface{}) bool {
			name, _ := cm["name"].(string)
			s, ok := byName[name]
			if !ok {
				s, ok = byID[containerID(cm)]
			}
			if !ok {
				return false
			}
			changed := false
			changed = setIfDifferent(cm, "cpuUsage", s.CPUUsage) || changed
			changed = setIfDifferent(cm, "memUsage", s.MemUsage) || changed
			changed = setIfDifferent(cm, "diskUsage", s.DiskUsage) || changed
			return changed
		},
	})
}

// OnSystemStats 设备级指标（20s 一帧，字段与 /info/device 的 data 同构）。
func (b *eventwsBridge) OnSystemStats(ip string, data map[string]interface{}) {
	b.app.applySystemStats(ip, data)
}

// OnHello 设备身份（机型/固件/设备ID）。
//
// 只填当前为空的字段：界面上 SDK 版本一直显示 /info/device 的 version，
// 直接覆盖会让显示口径突变（真机 hello 的 sdkVersion 形如 "v208"）。
func (b *eventwsBridge) OnHello(ip string, h *eventws.HelloFrame) {
	a := b.app
	if h == nil {
		return
	}
	a.deviceStatusMutex.Lock()
	status := a.deviceStatusMap[ip]
	if status == nil {
		status = &DeviceStatus{IP: ip, Status: "offline"}
		a.deviceStatusMap[ip] = status
	}
	filled := false
	if status.DeviceID == "" && h.DeviceID != "" {
		status.DeviceID = h.DeviceID
		filled = true
	}
	if status.DeviceModel == "" && h.Model != "" {
		status.DeviceModel = h.Model
		filled = true
	}
	if status.SDKVersion == "" && h.DeviceVersion != "" {
		status.SDKVersion = h.DeviceVersion
		filled = true
	}
	// APIVersion 直接覆盖，不判空：hello 的 sdkVersion 与 /info 的 currentVersion
	// 现场 25 台逐台核对全等（"v208" ↔ 208），而 hello 每轮连接只来一帧 —— 升级后重连
	// 的第一帧就能把版本号刷新，不必再为它打一次 REST（上线那对打底已经拆了）。
	// 认不出纯数字就保持原值，宁可用旧数也不猜。
	if v := apiVersionOf(h.SDKVersion); v != "" {
		status.APIVersion = v
	}
	a.deviceStatusMutex.Unlock()

	log.Printf("[事件通道] 🔑 设备 %s hello：sdk=%s model=%s deviceId=%s（补字段=%v）",
		ip, h.SDKVersion, h.Model, h.DeviceID, filled)
}

// apiVersionOf 把 hello 的 sdkVersion（形如 "v208"）转成 /info 口径的版本号（"208"）。
// 含非数字就返回空串，调用方沿用原值。
func apiVersionOf(sdk string) string {
	s := strings.TrimLeft(strings.TrimSpace(sdk), "vV")
	if s == "" {
		return ""
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return ""
		}
	}
	return s
}

// ---------- 设备指标落缓存 ----------

// applySystemStats 把 system/stats 的 data 合并进 deviceStatusMap。
//
// 只覆盖本次出现的字段：stats 不带 memtotal/mmcmodel/hwaddr 等静态字段，
// 全量覆盖会把 /info/device 建立的基准清成 0。
func (a *App) applySystemStats(ip string, data map[string]interface{}) {
	if len(data) == 0 {
		return
	}

	a.deviceStatusMutex.Lock()
	status := a.deviceStatusMap[ip]
	if status == nil {
		status = &DeviceStatus{IP: ip, Status: "offline"}
		a.deviceStatusMap[ip] = status
	}

	if v, ok := flexInt64(data, "mmctotal"); ok {
		status.StorageTotal = v
	}
	if v, ok := flexInt64(data, "mmcuse"); ok {
		status.StorageUsed = v
	}
	if status.StorageTotal > 0 && status.StorageUsed > 0 {
		status.StorageFree = status.StorageTotal - status.StorageUsed
	}
	if v, ok := flexInt64(data, "memtotal"); ok {
		status.MemoryTotal = v
	}
	if v, ok := flexInt64(data, "memuse"); ok {
		status.MemoryUsed = v
	}
	if v, ok := flexInt(data, "cputemp"); ok {
		status.CPUTemp = v
	}
	for _, m := range []struct {
		key  string
		dest *string
	}{
		{"cpuload", &status.CPULoad},
		{"mmcread", &status.MMCRead},
		{"mmcwrite", &status.MMCWrite},
		{"mmcmodel", &status.MMCModel},
		{"mmctemp", &status.MMCTemp},
		{"sysuptime", &status.SysUptime},
		{"speed", &status.Speed},
		{"network4g", &status.Network4G},
		{"netWork_eth0", &status.NetworkEth0},
		{"hwaddr", &status.HWAddr},
		{"hwaddr_1", &status.HWAddr1},
		{"ip_1", &status.IP1},
		{"version", &status.SDKVersion},
		{"model", &status.DeviceModel},
		{"deviceId", &status.DeviceID},
	} {
		if v, ok := flexString(data, m.key); ok && v != "" {
			*m.dest = v
		}
	}
	a.deviceStatusMutex.Unlock()
}

// ---------- 容器缓存补丁（复制-修改-写回）----------

type containerPatch struct {
	// match 判定该容器是否是本次补丁的目标
	match func(cm map[string]interface{}) bool
	// apply 在**副本**上修改，返回是否真的变化
	apply func(cm map[string]interface{}) bool
	// remove 为 true 时把命中的容器从列表里摘掉
	remove bool
	// silent 为 true 时不 bump 版本号（幂等的周期指标）
	silent bool
}

// patchAndroidCache 按 match 定位容器，复制-修改-写回整份列表。
//
// 返回命中数与是否发生变化。没变化时一个字节都不写（避免前端无谓重取）。
func (a *App) patchAndroidCache(ip string, p containerPatch) (hits int, changed bool) {
	if p.match == nil {
		return 0, false
	}

	a.androidCacheMutex.Lock()
	defer a.androidCacheMutex.Unlock()

	cache := a.androidCache[ip]
	if cache == nil || cache.List == nil {
		return 0, false
	}
	src := extractContainersFromCache(cache.List)
	if src == nil {
		return 0, false
	}

	out := make([]interface{}, 0, len(src))
	for _, item := range src {
		cm, ok := item.(map[string]interface{})
		if !ok || !p.match(cm) {
			out = append(out, item) // 原样带过去（不复制，也没人改它）
			continue
		}
		hits++

		if p.remove {
			changed = true
			continue // 丢弃 = 从列表移除
		}
		if p.apply == nil {
			out = append(out, item)
			continue
		}

		cp := make(map[string]interface{}, len(cm)+2)
		for k, v := range cm {
			cp[k] = v
		}
		if p.apply(cp) {
			changed = true
			out = append(out, cp)
		} else {
			out = append(out, item) // 内容没变，保留原对象
		}
	}

	if !changed {
		return hits, false
	}
	cache.List = withContainers(cache.List, out)
	cache.LastAttempt = time.Now()
	cache.Status = "ok"
	cache.Error = ""
	if !p.silent {
		cache.Version = time.Now().UnixMilli()
	}
	return hits, true
}

// withContainers 把改好的容器数组塞回原来的响应形状（新建外层 map，不改原对象）。
func withContainers(orig interface{}, updated []interface{}) interface{} {
	v, ok := orig.(map[string]interface{})
	if !ok {
		return updated // 裸数组
	}

	outer := make(map[string]interface{}, len(v))
	for k, val := range v {
		outer[k] = val
	}

	// V3 标准：{code, data:{count, list}}
	if data, ok := v["data"].(map[string]interface{}); ok {
		if _, hasList := data["list"]; hasList {
			newData := make(map[string]interface{}, len(data))
			for k, val := range data {
				newData[k] = val
			}
			newData["list"] = updated
			if _, hasCount := newData["count"]; hasCount {
				newData["count"] = float64(len(updated))
			}
			outer["data"] = newData
			return outer
		}
	}
	// 简化：{list:[...]}
	if _, hasList := v["list"]; hasList {
		outer["list"] = updated
		return outer
	}
	return updated
}

// containerMatcher 按 name / id 命中容器（本仓库容器身份以 name 为主键）。
func containerMatcher(name, id string) func(map[string]interface{}) bool {
	return func(cm map[string]interface{}) bool {
		if name != "" {
			cn, _ := cm["name"].(string)
			if cn == name || strings.TrimPrefix(cn, "/") == strings.TrimPrefix(name, "/") {
				return true
			}
		}
		if id != "" {
			return sameContainerID(containerID(cm), id)
		}
		return false
	}
}

// bootMatcher 在 name/id 之外再按坑位号兜底（开机时容器可能还没进快照）。
func bootMatcher(name, id string, indexNum int) func(map[string]interface{}) bool {
	byName := containerMatcher(name, id)
	return func(cm map[string]interface{}) bool {
		if byName(cm) {
			return true
		}
		if name == "" && id == "" {
			return false
		}
		if indexNum > 0 {
			if idx, ok := toInt(cm["indexNum"]); ok && idx == indexNum {
				return true
			}
		}
		return false
	}
}

func containerID(cm map[string]interface{}) string {
	for _, k := range []string{"id", "containerId", "container_id", "dockerId"} {
		if s, ok := cm[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// sameContainerID 兼容长/短 ID 两种写法（docker 全量 64 位、事件里常给 12 位）。
func sameContainerID(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	n := 12
	if len(a) < n || len(b) < n {
		return false
	}
	return strings.HasPrefix(a, b) || strings.HasPrefix(b, a)
}

// sameContainerNames 判断快照覆盖前后容器集合是否一致。
//
// 现在只用来决定 OnSnapshot 记不记那行日志。**不要**拿它决定要不要通知前端：
// 比的是 name|status 的集合，看不见 indexNum / ip / adbPort 的变化，也区分不了
// "补丁先写好了状态"和"状态真没变"两种形状 —— 省下的那次拉取就是静默的旧数据。
func sameContainerNames(old interface{}, fresh []map[string]interface{}) bool {
	list := extractContainersFromCache(old)
	if list == nil || len(list) != len(fresh) {
		return false
	}
	prev := make(map[string]struct{}, len(list))
	for _, item := range list {
		cm, ok := item.(map[string]interface{})
		if !ok {
			return false
		}
		name, _ := cm["name"].(string)
		status, _ := cm["status"].(string)
		prev[name+"|"+status] = struct{}{}
	}
	for _, cm := range fresh {
		name, _ := cm["name"].(string)
		status, _ := cm["status"].(string)
		if _, ok := prev[name+"|"+status]; !ok {
			return false
		}
	}
	return true
}

func setIfDifferent(cm map[string]interface{}, key string, val float64) bool {
	if cur, ok := cm[key].(float64); ok && cur == val {
		return false
	}
	cm[key] = val
	return true
}

// ---------- 截图联动 ----------

// invalidateScreenshotOf 丢掉某个容器的旧画面。
//
// 截图任务表每 tick 从 androidCache 现算，状态一变就会自动重抓，
// 所以这里只需要清旧图 + bump 该设备截图版本号，让前端别再展示上一张。
func (a *App) invalidateScreenshotOf(ip, containerName string) {
	if ip == "" || containerName == "" {
		return
	}
	key := ip + "_" + containerName

	a.screenshotCacheMutex.Lock()
	_, existed := a.screenshotCache[key]
	delete(a.screenshotCache, key)
	if existed {
		a.screenshotVersions[ip] = time.Now().UnixMilli()
	}
	a.screenshotCacheMutex.Unlock()
}

// ---------- 全量补查（事件里出现未知容器时）----------

// eventwsRefetch 拉一次 /android 全量补齐缓存，带限频。
//
// 事件只能描述设备**认识**的容器；外部（Web 端 / docker 命令）创建的容器
// 在快照里查不到，此时退回一次 REST 全量，避免缓存长期缺一块。
func (a *App) eventwsRefetch(ip, reason string) {
	if !a.eventwsShouldRefetch(ip) {
		return
	}
	log.Printf("[事件通道] 🔁 设备 %s 补查全量（%s）", ip, reason)
	go a.pollSingleDevice(ip)
}

// eventwsShouldRefetch 判定并占用这次补查名额（冷却窗口内返回 false）。
func (a *App) eventwsShouldRefetch(ip string) bool {
	if ip == "" {
		return false
	}
	a.eventwsRefetchMu.Lock()
	defer a.eventwsRefetchMu.Unlock()

	if a.eventwsRefetchAt == nil {
		a.eventwsRefetchAt = make(map[string]time.Time)
	}
	if time.Since(a.eventwsRefetchAt[ip]) < eventwsRefetchCooldown {
		return false
	}
	a.eventwsRefetchAt[ip] = time.Now()
	return true
}

// ---------- 数值兼容 ----------
//
// /info/device 的字段是字符串，stats 事件里是数字，两种都要吃下。

func flexString(data map[string]interface{}, key string) (string, bool) {
	v, ok := data[key]
	if !ok || v == nil {
		return "", false
	}
	switch n := v.(type) {
	case string:
		return n, true
	case float64:
		return strconv.FormatFloat(n, 'f', -1, 64), true
	case float32:
		return strconv.FormatFloat(float64(n), 'f', -1, 32), true
	case int:
		return strconv.Itoa(n), true
	case int64:
		return strconv.FormatInt(n, 10), true
	case bool:
		if n {
			return "1", true
		}
		return "0", true
	}
	return "", false
}

func flexInt64(data map[string]interface{}, key string) (int64, bool) {
	f, ok := eventws.AsFloat(data[key])
	if !ok {
		return 0, false
	}
	return int64(f), true
}

func flexInt(data map[string]interface{}, key string) (int, bool) {
	f, ok := eventws.AsFloat(data[key])
	if !ok {
		return 0, false
	}
	return int(f), true
}
