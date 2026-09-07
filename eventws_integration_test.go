package main

import (
	"testing"
	"time"

	"edgeclient/internal/eventws"
)

// 这批测试守的是**跨包形状契约**：事件通道写进 androidCache 的东西，必须能被
// 改造之前就存在的消费方（截图任务、RPA、前端增量比对）原样读出来。
//
// 真出过的事：AndroidResponse 造的 list 是 []map[string]interface{}，
// 而下游一律写 data["list"].([]interface{}) —— 断言失败不报错，只是静默拿到空列表，
// 于是接了事件通道的设备"容器在、截图没了、补丁永远打不中"。

func wsSnapshotFrame() *eventws.SnapshotFrame {
	return &eventws.SnapshotFrame{
		Seq:   1,
		Count: 2,
		List: []map[string]interface{}{
			{"name": "/c1", "status": "running", "id": "abcdef123456ffff", "indexNum": float64(1)},
			{"name": "/c2", "status": "stopped", "id": "123456abcdef1234"},
		},
	}
}

func TestEventwsSnapshotFeedsExistingConsumers(t *testing.T) {
	f := wsSnapshotFrame()
	payload := f.AndroidResponse()

	// 1) 截图轮询 / RPA 取的形状
	if got := extractContainersFromCache(payload); len(got) != 2 {
		t.Fatalf("extractContainersFromCache 读不出容器（前端/截图会以为没有容器）：%#v", payload)
	}

	// 2) 同一份快照自比应判"没变"—— 这个函数现在只负责压掉重复的快照日志
	if !sameContainerNames(payload, f.List) {
		t.Fatalf("同一份快照自比应判为未变：%#v", payload)
	}

	// 3) 容器事件补丁要能命中，且打完补丁形状不丢
	a := &App{androidCache: map[string]*AndroidDeviceCache{
		"1.2.3.4": {List: payload, Status: "ok"},
	}}
	hits, changed := a.patchAndroidCache("1.2.3.4", containerPatch{
		match: containerMatcher("/c1", ""),
		apply: func(cm map[string]interface{}) bool {
			cm["status"] = eventws.StatusStopped
			return true
		},
	})
	if hits != 1 || !changed {
		t.Fatalf("按 name 打补丁没命中：hits=%d changed=%v", hits, changed)
	}
	list := extractContainersFromCache(a.androidCache["1.2.3.4"].List)
	if len(list) != 2 {
		t.Fatalf("补丁后列表形状丢了：%#v", a.androidCache["1.2.3.4"].List)
	}
	if cm, _ := list[0].(map[string]interface{}); cm["status"] != eventws.StatusStopped {
		t.Fatalf("补丁没落到容器上：%#v", list[0])
	}
	// 原对象必须没被改（复制-修改-写回，否则并发读的一侧会看到半更新数据）
	data, _ := payload["data"].(map[string]interface{})
	orig, _ := data["list"].([]interface{})
	if len(orig) != 2 {
		t.Fatalf("补丁动了原响应的列表长度：%#v", data["list"])
	}
	if cm0, _ := orig[0].(map[string]interface{}); cm0["status"] != eventws.StatusRunning {
		t.Fatalf("patchAndroidCache 就地改了调用方持有的原容器对象：%#v", cm0)
	}
}

// 快照必须**无条件**通知前端，这一条守的是"界面永久显示旧状态"那类静默事故。
//
// 形状：容器在 WS 掉线的窗口里 die 了，重连后事件补丁先把 status 写成 stopped，
// 于是紧接着的那份快照与缓存"看起来一模一样"。一旦按内容比对省掉这次 bump，前端
// 2s 循环发现版本没动就再也不来 —— 那一格显示 running 显示到进程重启。
// 同名 destroy+create 换了 indexNum / ip / adbPort 是同一形状（点「使用软件」连错坑位）。
func TestSnapshotAlwaysNotifiesEvenWhenContentMatches(t *testing.T) {
	a := &App{androidCache: map[string]*AndroidDeviceCache{}}
	b := &eventwsBridge{app: a}

	b.OnSnapshot("1.2.3.4", wsSnapshotFrame())
	first := a.androidCache["1.2.3.4"]
	if first == nil || first.Version == 0 || first.Status != "ok" {
		t.Fatalf("首帧快照没把状态立起来：%+v", first)
	}
	firstVer := first.Version // 必须取值：缓存里放的是指针，再读一次拿到的是同一个对象

	// 内容一字不差的第二份快照（resync 响应 / 重连第二帧）也得让版本号动起来。
	// 注意这里不能靠"隔一毫秒再比"：时间戳同值时 OnSnapshot 走的是自增那一支。
	b.OnSnapshot("1.2.3.4", wsSnapshotFrame())
	if got := a.androidCache["1.2.3.4"].Version; got == firstVer {
		t.Fatalf("内容相同的快照没通知前端（版本没动 = 等于没 bump）：%d", got)
	}
}

func TestEventwsDestroyRemovesContainer(t *testing.T) {
	f := wsSnapshotFrame()
	a := &App{androidCache: map[string]*AndroidDeviceCache{
		"1.2.3.4": {List: f.AndroidResponse(), Status: "ok"},
	}}

	// 短 ID（docker 事件常给 12 位）也必须能命中全量 ID
	hits, changed := a.patchAndroidCache("1.2.3.4", containerPatch{
		match:  containerMatcher("c1", "abcdef123456"),
		remove: true,
	})
	if hits != 1 || !changed {
		t.Fatalf("destroy 没命中容器：hits=%d changed=%v", hits, changed)
	}
	if list := extractContainersFromCache(a.androidCache["1.2.3.4"].List); len(list) != 1 {
		t.Fatalf("destroy 后应剩 1 个容器：%#v", a.androidCache["1.2.3.4"].List)
	}
}

// 空快照必须还原成非 nil 空列表：写进缓存后前端 .map 不能炸。
func TestEventwsEmptySnapshotStillReadable(t *testing.T) {
	empty := (&eventws.SnapshotFrame{Seq: 2}).AndroidResponse()
	data, _ := empty["data"].(map[string]interface{})
	lst, ok := data["list"].([]interface{})
	if !ok || lst == nil || len(lst) != 0 {
		t.Fatalf("空快照该还原成非 nil 的 []interface{}（前端 .map 不能炸）：%#v", data["list"])
	}
	if list := extractContainersFromCache(empty); len(list) != 0 {
		t.Fatalf("空快照读出了东西：%#v", list)
	}
}

// 事件通道唯一能替代旧**数据**机制的证据是"流真的在供数"（Healthy）。
//
// 401 曾经也算（"卡在认证，轮询白刷"），真跑起来有两个事故：
//   - REST 那侧其实拿得到数据 → 轮询被关 → 列表还在（在线性另有来源）而
//     **容器数据永久冻结**的半态；
//   - 没配密码的设备真死了 → 一次正常的离线被 deviceStateForEventws 答成 AuthFail，
//     去重第二级判成"一致"而少报一次 → **永远绿着**。
//
// 所以两个门必须同进同退：都不认 authPending，也都不认"有条正在重拨的连接"。
// （在线性那一半已经改由拨号本身负责，见 TestDialerOwnershipTakesOverFromProbe。）
func TestOnlyStreamingReplacesRESTPoll(t *testing.T) {
	a := &App{eventwsSvc: eventws.New()}
	a.setEventwsAuthPending("10.10.5.205", true)

	if !a.needsRESTPoll("10.10.5.205") {
		t.Fatalf("401 不该关掉 REST 轮询（事件流没在手，轮询是唯一数据来源）")
	}
	if a.eventwsHealthy("10.10.5.205") {
		t.Fatalf("卡在 401 的设备不该被当成「流在供数」（一个字节都没收到过）")
	}
	// 从未建连（包括刚 Sync 完还在重拨）同样不算供数
	if !a.needsRESTPoll("10.10.5.9") || a.eventwsHealthy("10.10.5.9") {
		t.Fatalf("没供过数的设备必须完全沿用旧的 REST 轮询")
	}

	// 事件通道压根没装配：一律退回改造前
	var bare App
	if !bare.needsRESTPoll("10.10.5.205") || bare.eventwsHealthy("10.10.5.205") {
		t.Fatalf("未装配事件通道时轮询一个都不能少")
	}
}

// TCP 探活的让位条件从"流在供数"换成了"有人在拨"：拨号本身就是一次 TCP 连 8000
// + HTTP 握手 + 认证，比裸 connect 更强，所以拨不通的设备也归拨号判死（claimOffline
// 里的 snapshotSeen 闸门同步拆掉了 —— 两者必须同进同退，留着就是死设备永远绿）。
//
// 2026-09-04 判据又换了一次口径：Owns（此刻有没有一条活连接）→ ServesWS（归不归
// 拨号管）。差别只在 404 降级的那批老 SDK 设备 —— 用 Owns 时降级期没连接，探活会把
// 它们接回在线并绿到进程重启；现场要的形状是"没有事件流就显示离线"。
//
// 但"归拨号判死"只动在线性，不许顺手把数据也关了：拨不通的设备 REST 轮询必须照跑，
// 否则哪天拨通了却发现列表冻在几周前。
func TestDialerOwnershipTakesOverFromProbe(t *testing.T) {
	var bare App
	if bare.eventwsOwnsLiveness("10.10.5.205") {
		t.Fatalf("没装配事件通道却说「有人在拨」（这台设备就再也没有在线性来源了）")
	}

	a := &App{eventwsSvc: eventws.New()}
	a.eventwsSvc.SetDialPort("1") // 端口 1 没人听：拨号必然立刻失败，测的是"值班资格"不是连通性
	defer a.eventwsSvc.Stop()

	a.eventwsSvc.Connect(eventws.Device{Key: "10.10.5.205"})
	if !a.eventwsOwnsLiveness("10.10.5.205") {
		t.Fatalf("拨号循环已在跑却还在被 TCP 探活（拨号即探活没生效，日志墙照旧）")
	}
	if !a.needsRESTPoll("10.10.5.205") {
		t.Fatalf("拨不通、一个字节都没供的设备被免掉了 REST 轮询（容器数据没人管）")
	}

	// 公网 / OpenCecs 映射设备（key 带端口 → SkipWS）压根不建连，探活不能撤
	a.eventwsSvc.Connect(eventws.Device{Key: "1.2.3.4:8187", SkipWS: true})
	if a.eventwsOwnsLiveness("1.2.3.4:8187") {
		t.Fatalf("SkipWS 的公网设备被当成「有人在拨」（它再也没人判死活了）")
	}

	// 设备从监控列表移除：断开即交出值班资格，探活接手（别留一个没人管的孤儿）
	a.eventwsSvc.Disconnect("10.10.5.205")
	if a.eventwsOwnsLiveness("10.10.5.205") {
		t.Fatalf("已断开的设备还说有人在拨（探活不会再接手）")
	}
}

// wsHealthy 是给"事件通道到底接管了没有"这个问题留的直读口径：
// 以前只能靠 lastCheckAt 的跳动节奏反推（3s=还在探活，30s=WS pong）。
//
// 顺带钉住锁序：这两个 getter 必须在**放掉 deviceStatusMutex 之后**才去问事件通道。
// 写成锁内的话，事件通道的状态回调（反过来拿 deviceStatusMutex）就凑成一条死锁环。
func TestGetDevicesStatusMarksWsHealthy(t *testing.T) {
	a := &App{
		eventwsSvc: eventws.New(), // 一条连接都没有 → 一律未接管
		deviceStatusMap: map[string]*DeviceStatus{
			"10.10.5.205": {IP: "10.10.5.205", Status: "online"},
		},
	}

	all := a.GetDevicesStatus()
	if st := all["10.10.5.205"]; st == nil || st.WsHealthy {
		t.Fatalf("没有事件流连接却报 wsHealthy（前端会误以为 REST 已经退了）：%+v", st)
	}
	if one := a.GetDeviceStatus("10.10.5.205"); one == nil || one.WsHealthy {
		t.Fatalf("单设备读取错：%+v", one)
	}
	if a.GetDeviceStatus("10.10.5.9") != nil {
		t.Fatalf("不存在的设备该返回 nil")
	}

	// 事件通道没装配（启动早期）也不能 panic
	bare := &App{deviceStatusMap: map[string]*DeviceStatus{"1.2.3.4": {IP: "1.2.3.4"}}}
	if bare.GetDevicesStatus()["1.2.3.4"].WsHealthy {
		t.Fatalf("未装配事件通道时 wsHealthy 必须是 false")
	}
}

// IP 会被 DHCP 回收复用，所以设备从列表里消失时，宿主这半边以 IP 为 key 的
// 记忆必须一起忘掉，否则新上线的设备会继承上一台的状态：
//   - 撞上留下的补查冷却 → 真缺容器时那次 REST 全量补查被静默跳过；
//   - 继承 401 记忆 → 一次正常的离线被 deviceStateForEventws 答成 AuthFail，
//     去重第二级判成"一致"而少报一次，前端白弹密码框。
func TestPruneEventwsHostMemory(t *testing.T) {
	a := &App{
		eventwsRefetchAt: map[string]time.Time{
			"10.10.5.205": time.Now(), // 在场
			"10.10.5.9":   time.Now(), // 已移除
		},
		eventwsAuthFail: map[string]bool{
			"10.10.5.205": true, // 在场且真卡在 401
			"10.10.5.8":   true, // 已移除
		},
	}

	a.pruneEventwsHostMemory([]eventws.Device{{Key: "10.10.5.205"}})

	if !a.eventwsAuthPending("10.10.5.205") {
		t.Fatalf("在场设备的 401 记忆被误清（每个心跳帧会重报 401 → 弹窗风暴）")
	}
	if a.eventwsAuthPending("10.10.5.8") {
		t.Fatalf("已移除设备的 401 记忆没清掉")
	}

	a.eventwsRefetchMu.Lock()
	defer a.eventwsRefetchMu.Unlock()
	if _, ok := a.eventwsRefetchAt["10.10.5.205"]; !ok {
		t.Fatalf("在场设备的补查冷却被误清（冷却窗口形同失效）")
	}
	if _, ok := a.eventwsRefetchAt["10.10.5.9"]; ok {
		t.Fatalf("已移除设备的补查冷却没清掉")
	}
}

// 设备从监控列表删除后 androidCache 条目必须一起走：截图任务表是**遍历
// androidCache** 建的、只按 Status 过滤（dispatchScreenshotPoll），留着就等于
// 给一台已经不存在的设备开了"每秒抓一轮容器截图"的活儿，一直到进程重启。
func TestDropAndroidCacheRemovesOnlyNamed(t *testing.T) {
	a := &App{androidCache: map[string]*AndroidDeviceCache{
		"10.10.5.205": {List: wsSnapshotFrame().AndroidResponse(), Status: "ok"},
		"10.10.5.9":   {Status: "ok"},
	}}

	a.DropAndroidCache([]string{"10.10.5.205"})

	if _, ok := a.androidCache["10.10.5.205"]; ok {
		t.Fatalf("已移除设备的容器缓存还在（截图轮询会一直替它抓图）")
	}
	if _, ok := a.androidCache["10.10.5.9"]; !ok {
		t.Fatalf("未点名的设备缓存被误删")
	}
	a.DropAndroidCache(nil) // ClearScreenshotCache 的"空=全清"语义不能传染到这里
	if len(a.androidCache) != 1 {
		t.Fatalf("空参数被当成清空全部：%d 条", len(a.androidCache))
	}
}

// 延迟列换了数据源（WS ping/pong）：只有在线设备被写，且不许凭空造设备记录。
func TestEventwsRTTFeedsLatencyColumn(t *testing.T) {
	a := &App{deviceStatusMap: map[string]*DeviceStatus{
		"10.10.5.205": {IP: "10.10.5.205", Status: "online", ResponseTime: 999},
		"10.10.5.9":   {IP: "10.10.5.9", Status: "offline", ResponseTime: 42},
	}}
	a.applyEventwsRTT("10.10.5.205", 7)
	a.applyEventwsRTT("10.10.5.9", 7)
	a.applyEventwsRTT("10.10.5.206", 7)

	if st := a.deviceStatusMap["10.10.5.205"]; st.ResponseTime != 7 || st.LastSuccessLatency != 7 {
		t.Fatalf("pong 的 RTT 没进延迟列：%+v", st)
	}
	if st := a.deviceStatusMap["10.10.5.9"]; st.ResponseTime != 42 || st.LastSuccessLatency != 0 {
		t.Fatalf("离线设备不该被 pong 改写延迟（pong 只证明传输层，不证明有人在供数）：%+v", st)
	}
	if _, ok := a.deviceStatusMap["10.10.5.206"]; ok {
		t.Fatalf("applyEventwsRTT 凭空创建了设备记录")
	}
}

// WS 报 401 必须把认证态落到 androidCache —— auth_fail 是前端唯一认的"该输密码"信号。
//
// 方案 §5.1 把 401 定成 State 2（探活不得覆盖的第三态），但本仓库的 deviceStatusMap
// 只有 online/offline 两态，StateAuthFail 从前只写成"离线"，于是两种现场形状都哑了：
//   - 密码被改而旧连接还在供数：事件流健康 → REST 轮询让位 → android_poll.go 里那个
//     唯一的 auth_fail 写入点不再触发 → 界面在线、数据照常，没人知道密码已经不对；
//   - 连接断了重拨拿 401：设备被标 offline，而 /android 轮询只给 online 设备跑
//     → 同样产不出 auth_fail → 用户看到"离线"而不是密码框。
func TestEventwsAuthFailSurfacesAsPasswordPrompt(t *testing.T) {
	a := &App{
		log:        &Logger{prefix: "test"}, // addToAuthQueue 会走 emitEvent → log
		eventwsSvc: eventws.New(),
		androidCache: map[string]*AndroidDeviceCache{
			"1.2.3.4": {List: wsSnapshotFrame().AndroidResponse(), Status: "ok", Version: 1},
		},
		deviceStatusMap: map[string]*DeviceStatus{
			"1.2.3.4": {IP: "1.2.3.4", Status: "online"},
		},
	}

	a.applyEventwsState("1.2.3.4", eventws.StateAuthFail)

	cache := a.androidCache["1.2.3.4"]
	if cache.Status != "auth_fail" {
		t.Fatalf("401 没落成 auth_fail（前端不会弹密码框）：%+v", cache)
	}
	if cache.List != nil {
		t.Fatalf("认证失败还留着容器列表（前端会继续读过期数据）")
	}
	if cache.Version <= 1 {
		t.Fatalf("版本号没动，前端 2s 循环根本不会来取这一格：%+v", cache)
	}
	if st := a.deviceStatusMap["1.2.3.4"]; st.Status != "offline" {
		t.Fatalf("401 时在线性该落离线（两态模型里 State 2 由 androidCache 承载）：%+v", st)
	}

	// 从没被 REST 捞过的设备也得有这一格，否则前端拿不到任何状态
	a.applyEventwsState("5.6.7.8", eventws.StateAuthFail)
	if c := a.androidCache["5.6.7.8"]; c == nil || c.Status != "auth_fail" {
		t.Fatalf("无缓存设备 401 后没建出 auth_fail 记录：%+v", c)
	}

	// "卡在 401 的设备不被抓图"这条没有单测：抓图任务表在 dispatchScreenshotPoll 里
	// 现算、不对外暴露（它按 Status=="ok" 过滤，逻辑上已覆盖，但要真机才验得动）。

	// 恢复：密码改对 → 重连 → 建连第二帧 snapshot 必须把状态整份写回，
	// 否则这条 auth_fail 会永久粘在设备上。
	(&eventwsBridge{app: a}).OnSnapshot("1.2.3.4", wsSnapshotFrame())
	if c := a.androidCache["1.2.3.4"]; c.Status != "ok" || c.List == nil {
		t.Fatalf("快照没能从 auth_fail 中恢复：%+v", c)
	}
}

// hello 的 sdkVersion 顶替 /info 的 currentVersion（现场 25 台逐台核对全等），于是
// 版本列在事件流里就有了着落 —— 上线时那对 REST 打底（/info + /info/device）与 60s
// 常驻兜底定时器都已删除，设备掉线重连一次 REST 都不打。
// 这条守的是"删掉周期 REST 之后版本号由谁维护"——只有 hello 能维护，它每轮连接来一帧。
func TestHelloSuppliesAPIVersionForEveryReconnect(t *testing.T) {
	a := &App{
		eventwsSvc:      eventws.New(),
		deviceStatusMap: map[string]*DeviceStatus{"1.2.3.4": {IP: "1.2.3.4", Status: "online"}},
	}
	(&eventwsBridge{app: a}).OnHello("1.2.3.4", &eventws.HelloFrame{
		SDKVersion: "v208", DeviceVersion: "QL-r1q-2026.v0.8.8.202608110721-v3",
		Model: "r1q_v3", DeviceID: "rb4ea4b437666ac3722414c18e849d7d",
	})

	st := a.deviceStatusMap["1.2.3.4"]
	if st.APIVersion != "208" {
		t.Fatalf("hello 没把 APIVersion 顶上（REST 拆光之后版本列就没人维护了）：%+v", st)
	}
	if st.SDKVersion == "" || st.DeviceModel == "" || st.DeviceID == "" {
		t.Fatalf("hello 的身份字段没落：%+v", st)
	}

	// 升级后重连：hello 直接覆盖 APIVersion，不判空（REST 不会再补第二次）。
	(&eventwsBridge{app: a}).OnHello("1.2.3.4", &eventws.HelloFrame{SDKVersion: "v209"})
	if got := a.deviceStatusMap["1.2.3.4"].APIVersion; got != "209" {
		t.Fatalf("重连的 hello 没刷新版本号：%s", got)
	}

	// 认不出的串一律不写：宁可留着上一次的真值，也不把猜的版本号放进升级判断
	if v := apiVersionOf("v208-beta"); v != "" {
		t.Fatalf("非纯数字的 sdkVersion 被当成版本号：%q", v)
	}
	if v := apiVersionOf(""); v != "" {
		t.Fatalf("空串该返回空：%q", v)
	}
	if v := apiVersionOf("V209"); v != "209" {
		t.Fatalf("大写 V 前缀没剥掉：%q", v)
	}
}

// 拆掉周期 REST 的前提是：界面在刷的指标列**全部**在 system/stats 那 9 个键里。
//
// 实测（2026-09-04 直连 /ws/events 逐帧枚举）一帧只有
// cputemp cpuload memuse mmctotal mmcuse mmcread mmcwrite mmctemp sysuptime，
// 这里就按这份实测键名单造帧，钉两头的形状：
//   - 九个键都得落到 DeviceStatus 上（少一个就等于少一列数据，而 REST 已经没人兜底了）；
//   - 流里压根没有的字段（memtotal/speed/mmcmodel/hwaddr）不许被清成零值 ——
//     它们是前端选中设备时那一次 /info/device 写进来的基准，被 stats 帧冲掉就永久丢了。
func TestSystemStatsAloneFeedsMetricColumns(t *testing.T) {
	a := &App{
		deviceStatusMap: map[string]*DeviceStatus{"1.2.3.4": {IP: "1.2.3.4", Status: "online"}},
	}
	// 前端那一次 /info/device 写进缓存的静态基准（流里没有的字段）
	a.deviceStatusMutex.Lock()
	st := a.deviceStatusMap["1.2.3.4"]
	st.MemoryTotal, st.MMCModel, st.Speed, st.HWAddr = 23971, "SJ660", "1000", "aa:bb:cc:dd:ee:ff"
	a.deviceStatusMutex.Unlock()

	a.applySystemStats("1.2.3.4", map[string]interface{}{
		"cputemp": float64(52), "cpuload": "13%", "memuse": float64(8123),
		"mmctotal": float64(119452), "mmcuse": float64(45900),
		"mmcread": "12.5", "mmcwrite": "3.1", "mmctemp": "38", "sysuptime": "98765",
	})

	a.deviceStatusMutex.RLock()
	defer a.deviceStatusMutex.RUnlock()
	st = a.deviceStatusMap["1.2.3.4"]
	if st.CPUTemp != 52 || st.CPULoad != "13%" || st.MemoryUsed != 8123 {
		t.Fatalf("CPU/内存用量没落进状态表：%+v", st)
	}
	if st.StorageTotal != 119452 || st.StorageUsed != 45900 || st.StorageFree != 119452-45900 {
		t.Fatalf("磁盘容量/已用/可用没算对：%+v", st)
	}
	if st.MMCRead != "12.5" || st.MMCWrite != "3.1" || st.MMCTemp != "38" || st.SysUptime != "98765" {
		t.Fatalf("磁盘读写/温度/运行时长没落：%+v", st)
	}
	if st.MemoryTotal != 23971 || st.MMCModel != "SJ660" || st.Speed != "1000" || st.HWAddr == "" {
		t.Fatalf("stats 帧把流里没有的静态字段清了（内存列分母/硬盘型号/网速/MAC 就此丢失）：%+v", st)
	}
}
