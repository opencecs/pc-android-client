package eventws

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// 连接层关键参数（§4.2）
const (
	dialTimeout       = 8 * time.Second  // 拨号超时
	watchdogTimeout   = 90 * time.Second // 任意数据帧到达即重置；超时视为通道死亡，主动断开重连
	keepaliveInterval = 30 * time.Second // 主动 ping：穿 NAT + 喂看门狗 + 给前端延迟列供数（RTT）
	keepaliveTimeout  = 10 * time.Second
	backoffInitial    = 1 * time.Second
	backoffMax        = 30 * time.Second
	resyncMinInterval = 10 * time.Second // resync 限频（服务端同样限频）
	writeTimeout      = 5 * time.Second
	frameChBuf        = 256 // 读/消费解耦的蓄水池（一次开机序列 4-6 帧）

	// parseErrLogWindow 是"同类按帧错误"的日志限流窗口（见 logThrottled）。
	parseErrLogWindow = 30 * time.Second

	// dialErrLogWindow 是"拨不通一直在重拨"的日志限流窗口。
	//
	// 探活让位给拨号之后，这一行就是现场唯一能看到"这台设备连不上"的地方，
	// 首报必须留下；但一台死设备每 backoffMax(30s) 就报一次，30 台残留 IP
	// 就是每分钟 60 行同一件事 —— 和当初那堵 TCP Ping 日志墙是同一个病。
	// 真正的状态翻转（判离线 / 上线）不受此限，always 记。
	dialErrLogWindow = 60 * time.Second

	// maxFrameBytes 必须显式放宽：coder/websocket 默认读限制只有 32KB，
	// 而 37 个容器的快照就有约 40KB，会直接触发 1009 断连 →
	// "收到 hello 就断开"的无限重连循环（真机踩坑，§实施中修正）。
	//
	// 上限按量级留够即可，不要顺手写成 64MB：这是**每条连接**都能累积到
	// 的接收缓冲，200 台 × 一个发疯的对端就是十几 GB。实测每容器约 1.2KB，
	// 4MB ≈ 3000 个容器，比现场最大机型高出一个数量级。
	maxFrameBytes = 4 << 20
)

// 拨号阶段的分类错误（§3.3）
var (
	errNotFound         = errors.New("设备无事件通道端点(404)")
	errAuthRequired     = errors.New("设备事件通道认证失败(401)")
	errDeviceIDMismatch = errors.New("deviceId 与设备实际 ID 不匹配(403)")
)

// conn 是一台设备的事件通道连接（含自动重连）。
//
// 并发模型（协议 §7 硬性要求：读循环绝不能被业务处理阻塞，否则心跳超时被踢）：
//
//	run()        拨号 → 读循环 → 断开 → 退避 → 重试
//	读循环       ws.Read → frameCh，只收帧入队
//	consume()    frameCh 取帧 → seq 检查 → 分发到 Handlers
//	看门狗/ping  不活跃 / ping 硬失败 → CloseNow 唤醒读循环走重连
type conn struct {
	svc    *Service
	key    string
	ctx    context.Context
	cancel context.CancelFunc

	ws            atomic.Pointer[websocket.Conn]
	lastActivity  atomic.Int64 // unix nano，数据帧或 pong 到达时刷新（看门狗用）
	lastData      atomic.Int64 // unix nano，只在**数据帧**到达时刷新（Healthy 时效用）
	streamHealthy atomic.Bool  // 本轮连接是否收到过 snapshot —— 退避重置判据（被 run 取走）
	snapshotSeen  atomic.Bool  // 本轮连接是否收到过 snapshot —— 供 Healthy 判定，不被取走
	// 两个日志限流位：都是"按帧/按 30s 发生"的事件，不压就会变成永久底噪
	pongMissed      atomic.Bool  // 本轮连接是否已因"不回 pong"记过一行
	lastParseErrLog atomic.Int64 // 上次记"帧解析失败"的时刻（unix nano）
	lastDialErrLog  atomic.Int64 // 上次记"拨号失败/重连"的时刻（unix nano）
	resyncAt        atomic.Int64 // 上次发 resync 的时间，用于限频
}

func newConn(ctx context.Context, svc *Service, key string) *conn {
	c := &conn{svc: svc, key: key}
	c.ctx, c.cancel = context.WithCancel(ctx)
	c.lastActivity.Store(time.Now().UnixNano())
	c.lastData.Store(time.Now().UnixNano())
	return c
}

// run 是连接 supervisor，独占一个 goroutine，直到 Disconnect/Stop 或 404 降级。
func (c *conn) run() {
	backoff := backoffInitial
	for {
		if c.ctx.Err() != nil {
			return
		}
		err := c.connectOnce()
		if c.ctx.Err() != nil {
			return // 主动断开，不算异常
		}
		if errors.Is(err, errNotFound) {
			// 老 SDK：判离线 + 降级一段时间不再拨号（§3.3）。
			// 降级不是终态，markDegraded 会到期自动重拨一次，所以固件升到带
			// /ws/events 的版本之后这台设备会自己上线，不用重启客户端。
			c.claimOffline("设备不支持事件通道（/ws/events 404）")
			c.svc.markDegraded(c.key)
			c.svc.logf("%s 不支持事件通道，降级 %s：%v", c.key, degradeDuration, err)
			return
		}

		// 退避重置判据 = 收到过 snapshot，而不是连上握手成功。
		// 用 hello 当判据会在"连上即断"（例如读超限）场景下退化成 1s 高频重连轰炸。
		if c.streamHealthy.Swap(false) {
			backoff = backoffInitial
		} else {
			backoff = minDuration(backoff*2, backoffMax)
		}

		c.logThrottled(&c.lastDialErrLog, dialErrLogWindow,
			"%s 连接结束：%v（%s 后重连）", c.key, err, backoff)
		if !sleepCtx(c.ctx, backoff) {
			return
		}
	}
}

// connectOnce 建一条连接并跑完整个生命周期，返回断开原因。
func (c *conn) connectOnce() error {
	url, header := c.svc.dialRequest(c.key)

	dialCtx, dialCancel := context.WithTimeout(c.ctx, dialTimeout)
	ws, resp, err := websocket.Dial(dialCtx, url, &websocket.DialOptions{HTTPHeader: header})
	dialCancel()

	if err != nil {
		//  Dial 失败时 resp 仍可能带上服务端的状态码，据此分类（§3.3）
		if resp != nil {
			switch resp.StatusCode {
			case http.StatusNotFound:
				// 老 SDK 没这个端点：它 HTTP 答得上来，只是不支持事件通道。
				// 现场口径（2026-09-04）是"没有事件流就显示离线"，所以这里照报离线，
				// 不再把在线性让回 TCP 探活 —— 宿主那侧的让位判据已换成 ServesWS，
				// 这台设备仍归拨号管（见 run 里 errNotFound 那一支）。
				return fmt.Errorf("%w: %s", errNotFound, url)
			case http.StatusUnauthorized:
				// 密码变更：交认证链路处理，正常退避重试
				c.svc.reportState(c.key, StateAuthFail)
				return fmt.Errorf("%w: %s", errAuthRequired, url)
			case http.StatusForbidden:
				// deviceId 头与设备实际 ID 不符（IP 复用 / 缓存过期），协议 code 62。
				// 必须忘掉这个身份再重试：留着它每次拨号都 403，事件通道彻底接不上。
				c.svc.dropDeviceID(c.key)
				c.claimOffline("拨号 403（deviceId 不匹配）")
				return fmt.Errorf("%w: %s", errDeviceIDMismatch, url)
			}
		}
		c.claimOffline(fmt.Sprintf("拨号失败：%v", err))
		return err
	}

	// 必须放宽，否则大快照直接把连接打死（见 maxFrameBytes 注释）
	ws.SetReadLimit(maxFrameBytes)
	c.lastDialErrLog.Store(0) // 拨通过 → 下一次失败重新算"首报"

	c.ws.Store(ws)
	c.streamHealthy.Store(false)
	c.snapshotSeen.Store(false)
	c.pongMissed.Store(false)
	c.touchData() // 本轮从零开始算时效（上一轮的数据帧不作数）

	gctx, gcancel := context.WithCancel(c.ctx)
	defer func() {
		gcancel()
		ws.CloseNow()
		c.ws.Store(nil)
	}()

	// 每轮连接全新的 channel：断开即废弃，重连不会看到上一轮的残留帧
	//（协议 §8"重连后不信任旧连接任何帧"由结构保证，不靠时间戳判断）
	frames := make(chan []byte, frameChBuf)

	var wg sync.WaitGroup
	// 3 个辅助 goroutine：读循环跑在 connectOnce 自己身上（inline），不计入
	wg.Add(3)
	go func() { defer wg.Done(); c.consumeLoop(frames) }()
	go func() { defer wg.Done(); c.watchdog(gctx) }()
	go func() { defer wg.Done(); c.keepalive(gctx, ws) }()

	readErr := func() error {
		defer close(frames)
		gcancel() // 读循环退出即停掉看门狗与 ping
		for {
			typ, data, err := ws.Read(c.ctx)
			if err != nil {
				return err
			}
			if typ != websocket.MessageText {
				continue // 只处理文本帧
			}
			// 这里只喂看门狗（传输层时钟）。数据时效必须等 handleFrame 确认这帧
			// 真的带了容器/指标载荷才推进 —— 否则 resync-required 这种控制帧
			// 会把 Healthy 一直顶成"在供数"，于是 REST 兜底永远接不上手，
			// 列表冻在最后一帧上（与 pong 不算供数同一类事故）。
			c.touch()
			select {
			case frames <- data:
			default:
				// 队列满说明业务消费不过来。这里**不能**阻塞入队 —— 阻塞读循环
				// 会让心跳超时被服务端踢，比丢几帧严重得多。丢帧由 seq 断档 →
				// resync 拉快照自愈。日志只在真的喊到重同步时记（丢帧是按帧的，
				// resync 是 10s 一次的，否则消费不过来时正好刷出最多的日志）。
				if c.sendResync() {
					c.svc.logf("%s 帧队列已满(%d)，丢弃当前帧并请求 resync", c.key, len(frames))
				}
			}
		}
	}()

	wg.Wait()

	// 读循环报错 = 通道死亡（TCP 断 / 服务端关）→ 直接判离线，重连成功后自动恢复
	// （§5.1）。TCP 探活撤掉之后这台设备的在线性只有这一个来源：这里不报就没人报。
	if c.ctx.Err() == nil {
		c.claimOffline("连接中断")
	}
	if readErr != nil {
		return readErr
	}
	return errors.New("连接已关闭")
}

// claimOffline 把设备判离线。
//
// 这里从前多一道前提：本轮连接真收到过 snapshot 才敢报。理由是"拨不通不是离线的
// 证据"——老 SDK 没这个端点、8000 被防火墙挡住、SDK 半启动只握手不发帧，这些情形
// 事件通道对在线性一无所知，拿"我连不上"去覆盖 TCP 探活挣来的 online 会把整支持久
// 正常的设备刷成离线，还每 3 秒和探活来回打脸（接入当天真机踩坑：接上后列表全灭）。
//
// **那个前提已经跟着 TCP 探活一起撤掉了**（方案 §5.1「httpbeat 整体移除，WS 心跳即
// 在线性」）：现在一次拨号就是这台设备的在线性探测本身 —— 同 ip 同端口 8000，比
// connect 多走一层 HTTP 握手与认证，拨不通是比 TCP 失败更强的离线证据。闸门留着的
// 话，一台真死掉的设备从上线到进程重启都没人判它离线（两者必须同进同退，否则就是
// "界面永远绿着"）。
//
// 404（老 SDK 没这个端点）**同样判离线** —— 这是 2026-09-04 的口径变更：现场要的
// 是"没有事件流的设备就显示离线"，而不是"在线但那一格永远空着"。让位给 TCP 探活
// 的日子结束了：宿主的让位判据已从 Service.Owns（拨号循环在跑）换成 Service.ServesWS
// （归不归拨号管，含 404 降级中），探活不会再把它捞回在线。
//
// 翻身机会在 markDegraded 那枚到期定时器上：固件升到 v206+ 之后最多 degradeDuration
// 就会被重新拨一次，通了即上线，不需要重启客户端。
func (c *conn) claimOffline(why string) {
	// 已经报过离线、且宿主那半边也认离线，就闭嘴：重连退避每轮都会再走到这里，
	// reportState 内部会去重不落库，但日志会刷成一堵墙，看盘时极难分辨
	// "设备反复掉线"和"掉了一次一直在重拨"（真机复盘）。
	// 多问一句宿主：手动刷新/改密那条 REST 路径若把这台设备又写回 online，
	// 下一轮拨号必须能纠正回来，否则它就在线到进程重启。
	if c.svc.livenessSettled(c.key) {
		return
	}
	c.svc.logf("%s 事件通道判离线：%s", c.key, why)
	c.svc.reportState(c.key, StateOffline)
}

// logThrottled 把"按帧发生"的同类错误压到 window 一行。
//
// 判断依据不是"这条日志不重要"，而是"它的条数不携带信息"：一帧解析失败值得知道，
// 每秒几十帧同样的失败只需要知道一次（而且这一刻系统正忙，日志还要和 resync 抢
// 全局 log 锁）。真正会自愈的那些（seq 断档 / 队列满）改用 sendResync 的限频器
// 做闸门，不额外加状态。
func (c *conn) logThrottled(last *atomic.Int64, window time.Duration, format string, args ...interface{}) {
	now := time.Now().UnixNano()
	if old := last.Load(); old != 0 && now-old < int64(window) {
		return
	}
	last.Store(now)
	c.svc.logf(format, args...)
}

// touch 记录"通道还活着"（数据帧或 pong 都算），只喂看门狗。
func (c *conn) touch() { c.lastActivity.Store(time.Now().UnixNano()) }

// touchData 记录"刚收到数据帧"，同时推进两个时钟。
//
// 时效判据必须分清：pong 只证明传输层活着，证明不了有人在发事件。
// 混用会让"SDK 半启动 / 代理吞帧"这种一帧不发但回 pong 的设备被 Healthy
// 判成健康，于是 REST 兜底永远接不上手，容器列表静默冻死。
func (c *conn) touchData() {
	now := time.Now().UnixNano()
	c.lastActivity.Store(now)
	c.lastData.Store(now)
}

// idle 返回距离上一次**数据帧**到达过去了多久（Healthy 的时效判据）。
func (c *conn) idle() time.Duration {
	return time.Since(time.Unix(0, c.lastData.Load()))
}

// watchdog 在 watchdogTimeout 内没有任何数据帧到达时判定通道死亡。
//
// 设备端 system/stats 每 20s 一帧，正常永不触发；真断了最坏 90s 发现。
func (c *conn) watchdog(ctx context.Context) {
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			idle := time.Since(time.Unix(0, c.lastActivity.Load()))
			if idle > watchdogTimeout {
				c.svc.logf("%s 看门狗超时：%s 无数据帧，主动断开重连", c.key, idle.Round(time.Second))
				if ws := c.ws.Load(); ws != nil {
					ws.CloseNow()
				}
				return
			}
		}
	}
}

// keepalive 主动 ping：coder/websocket 在 Reader 内部自动回 pong，
// 所以 ping 成功同时证明"服务端活着"和"我的读循环活着"。
func (c *conn) keepalive(ctx context.Context, ws *websocket.Conn) {
	t := time.NewTicker(keepaliveInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			pingStart := time.Now()
			pctx, cancel := context.WithTimeout(ctx, keepaliveTimeout)
			err := ws.Ping(pctx)
			cancel()
			if err == nil {
				c.touch()
				// 接管在线性后设备不再被单独 TCP 探活，这条 pong 是唯一的
				// 周期往返测量 → 前端的延迟列由它喂（见 SetRTTReporter）。
				c.svc.noteRTT(c.key, time.Since(pingStart))
				continue
			}
			if errors.Is(err, context.DeadlineExceeded) {
				// 对端没回 pong。有些实现不回，不能据此判死 ——
				// 连接是否真死交给看门狗与读循环判断，这里只记一笔。
				// 只记本轮连接的第一笔：不回 pong 的实现会每 30s 造一行，
				// 200 台就是一辈子 6.7 行/s 的白底噪。
				if !c.pongMissed.Swap(true) {
					c.svc.logf("%s ping 未获 pong（忽略，不影响连接；本连接不再重复）", c.key)
				}
				continue
			}
			c.svc.logf("%s ping 失败，判定连接不可用：%v", c.key, err)
			ws.CloseNow()
			return
		}
	}
}

// consumeLoop 串行消费帧：seq 检查 + 路由都在这一条 goroutine 上，
// 所以 seqTracker 不需要锁，也不会乱序。
func (c *conn) consumeLoop(frames <-chan []byte) {
	var seq seqTracker
	for raw := range frames {
		f, err := ParseFrame(raw)
		if err != nil {
			// 解析失败通常不是"偶然一帧坏"而是"这台设备的每一帧都这样"
			// （例如某个数字字段被写成字符串），按帧记就是几十行/秒，
			// 而且恰好发生在系统已经不健康、日志最值钱的时候。
			c.logThrottled(&c.lastParseErrLog, parseErrLogWindow,
				"%s 帧解析失败：%v（同类错误 %s 内只记一行）", c.key, err, parseErrLogWindow)
			continue
		}
		if f == nil {
			continue // 未知 type：前向兼容，静默忽略
		}
		c.handleFrame(f, &seq)
	}
}

// handleFrame 做 seq 记账，然后把语义部分交给 manager 路由。
func (c *conn) handleFrame(f *Frame, seq *seqTracker) {
	switch f.Type {
	case FrameHello:
		seq.onHello()
		c.svc.noteHello(c.key, f.Hello)

	case FrameSnapshot:
		c.touchData() // 整份容器清单落地 —— 这才是"有人在供数"的实证
		seq.onSnapshot(f.Seq)
		c.streamHealthy.Store(true)
		c.snapshotSeen.Store(true) // 供 Healthy() 判定"事件已真正接管这台设备"

	case FrameEvent:
		// system/resync 是"设备侧指标采集重启"的信令：没有语义载荷，也不参与 seq
		// 去重（设备不带 seq 时会被判成重复帧直接吞掉）。只做两件事 —— 标记存活 +
		// 回手要一次快照（限频在 sendResync 里）。绝不能流到 OnSystemStats。
		if f.Event != nil && f.Event.Event == EventSystem && f.Event.Action == ActionResync {
			c.svc.reportState(c.key, StateOnline)
			c.sendResync()
			return
		}
		switch seq.onEvent(f.Seq) {
		case verdictDuplicate:
			return // 重放帧，丢弃
		case verdictGap:
			// 断档按帧发生（设备 seq 步长不是 1 时每帧都来一行），只在真的
			// 请求了重同步时记 —— 否则日志量等于帧量，把关键线索埋掉。
			if c.sendResync() {
				c.svc.logf("%s seq 断档 seq=%d，已应用并请求 resync", c.key, f.Seq)
			}
		case verdictNotAligned:
			// 还没拿到基线就来了事件：照常应用（补丁找不到容器是安全的，
			// 集成层对未知容器会自己拉全量），同时补一次 resync 对齐。
			c.sendResync()
		}
		// 走到这里说明这帧会被真正应用 → 算供数实证。
		// 重复帧（上面已 return）与 system/resync 控制信令都不算：
		// 一台只会重放旧 seq / 喊"我缓冲区滚掉了"的设备，容器数据其实没在动，
		// 让它顶住 Healthy 就等于把 REST 兜底永久关在外面。
		c.touchData()

	case FrameResyncRequired:
		c.sendResync()

	default:
		return
	}

	// 任意数据帧到达即"存活"（§5.2：不能只在首个 snapshot 上报一次）。
	// 放在分发之前上报：业务处理慢甚至 panic 都不该让在线性判定失准。
	c.svc.reportState(c.key, StateOnline)
	c.svc.dispatch(c.key, f)
}

// sendResync 请求服务端重发快照（客户端唯一的写操作，§3.5）。限频内静默跳过、不重试。
//
// 返回"这一次是否真的过了限频器"：调用方拿它决定要不要记日志 —— 断档/丢帧是按帧
// 发生的，resync 却是 10s 一次的，日志跟着帧走就会在设备重启那半分钟刷出上百行
// 同一件事（真机反复踩到的日志墙：有用的那一条被埋掉）。
func (c *conn) sendResync() bool {
	now := time.Now().UnixNano()
	last := c.resyncAt.Load()
	if last != 0 && now-last < int64(resyncMinInterval) {
		return false
	}
	if !c.resyncAt.CompareAndSwap(last, now) {
		return false
	}
	ws := c.ws.Load()
	if ws == nil {
		return true // 名额已占用，只是这条连接还没建起来
	}
	ctx, cancel := context.WithTimeout(c.ctx, writeTimeout)
	defer cancel()
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"action":"resync"}`)); err != nil {
		c.svc.logf("%s 发送 resync 失败：%v", c.key, err)
	}
	return true
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
