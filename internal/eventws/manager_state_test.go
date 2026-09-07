package eventws

// 本文件的每条用例都对应方案 §9.1 里一次真机踩坑，别当普通覆盖率测试删：
//   - 零值吞掉首次在线上报（生产表现：134 台设备只有 5 台在线）
//   - config 被外部写歪后无人纠正（连接活着却显示离线）
//   - 心跳帧不上报在线（只在首个 snapshot 报一次）
//   - 密码 getter 收到 host:port（生产表现：配了密码的设备全量 401）

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// newBareConn 造一条不拨号的 conn，直接喂帧验证记账与上报。
func newBareConn(t *testing.T, s *Service, key string) (*conn, *seqTracker) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return newConn(ctx, s, key), &seqTracker{}
}

func statsEventFrame(seq int64) *Frame {
	data, _ := json.Marshal([]map[string]any{{"name": "c1_A", "cpuUsage": 1}})
	return &Frame{
		Type: FrameEvent,
		Seq:  seq,
		Event: &EventFrame{
			Seq: seq, Event: EventContainer, Action: ActionStats, Data: data,
		},
	}
}

// TestReportFirstOnlineNotSwallowed 回归「零值吞首报」。
//
// map 缺 key 的零值恰好等于 StateOnline(0)，只比值不判 known 时：
// 只要有一台设备先上报过在线，其余设备的首次上报会被静默丢弃。
func TestReportFirstOnlineNotSwallowed(t *testing.T) {
	s := New()
	var mu sync.Mutex
	var got []string
	s.SetStateReporter(func(key string, st State) {
		mu.Lock()
		got = append(got, key+"="+st.String())
		mu.Unlock()
	})

	s.reportState("a", StateOnline) // 第一条：建立 map 条目
	s.reportState("b", StateOnline) // 并发首报：零值也是 online，极易被吞
	s.reportState("c", StateOnline)

	// 同状态重复上报该被去重吞掉（否则每 20s 心跳都写一遍 config）
	s.reportState("a", StateOnline)
	s.reportState("b", StateOnline)

	mu.Lock()
	defer mu.Unlock()
	want := []string{"a=online", "b=online", "c=online"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("上报序列错：%v，期望 %v（首报被吞或去重失效）", got, want)
	}
}

// TestReportConfigReconcile 验证两级去重的第二级：
// 我们上次报的值没变，但宿主实际状态被外部写歪 → 仍要重报纠正。
func TestReportConfigReconcile(t *testing.T) {
	s := New()
	var mu sync.Mutex
	var reports int
	host := map[string]State{}

	s.SetStateReporter(func(key string, st State) {
		mu.Lock()
		reports++
		host[key] = st
		mu.Unlock()
	})
	s.SetStateQueryer(func(key string) State {
		mu.Lock()
		defer mu.Unlock()
		return host[key]
	})

	s.reportState("a", StateOnline) // 首报
	s.reportState("a", StateOnline) // 一致 → 吞掉

	mu.Lock()
	if reports != 1 {
		mu.Unlock()
		t.Fatalf("一致状态下不该重复上报：%d 次", reports)
	}
	mu.Unlock()

	// 模拟认证链路/迁移把 config 写歪成离线（连接其实一直健康）
	mu.Lock()
	host["a"] = StateOffline
	mu.Unlock()

	s.reportState("a", StateOnline) // 同值但宿主不一致 → 必须重报

	mu.Lock()
	defer mu.Unlock()
	if reports != 2 {
		t.Fatalf("宿主被写歪后没自愈：reports=%d", reports)
	}
	if host["a"] != StateOnline {
		t.Fatalf("自愈后宿主状态没纠正回来：%s", host["a"])
	}
}

// TestOnlineHealsAfterExternalOverwrite 全链路：连接健康 + config 被写歪
// → 下一个心跳帧（这里用 container/stats）把状态纠正回来。
//
// 旧实现是"一次性上报后无人纠正"，真机表现：连接明明活着，界面一直显示离线。
func TestOnlineHealsAfterExternalOverwrite(t *testing.T) {
	push := make(chan struct{})

	m := newMockSDK(t, nil)
	m.serve = func(ctx context.Context, ws *websocket.Conn) {
		writeJSON(ctx, ws, helloFixture())
		writeJSON(ctx, ws, snapshotFixture(1))
		select {
		case <-push: // 等测试把宿主状态写歪
		case <-ctx.Done():
			return
		}
		writeJSON(ctx, ws, eventFixture(2, EventContainer, ActionStats,
			[]map[string]any{{"name": "c1_A", "cpuUsage": 1}}))
		for {
			if _, _, err := ws.Read(ctx); err != nil {
				return
			}
		}
	}

	var mu sync.Mutex
	host := map[string]State{} // 模拟宿主 config 里的实际状态
	reports := 0

	s := newTestService(t, m)
	s.SetHandlers(newCollector())
	s.SetStateReporter(func(key string, st State) {
		mu.Lock()
		host[key] = st
		reports++
		mu.Unlock()
	})
	s.SetStateQueryer(func(key string) State {
		mu.Lock()
		defer mu.Unlock()
		return host[key]
	})
	t.Cleanup(s.Stop)

	s.Connect(Device{Key: "127.0.0.1"})
	waitUntil(t, 3*time.Second, "建连后应上报在线", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return host["127.0.0.1"] == StateOnline && reports >= 1
	})

	// 外部把 config 写歪成离线（认证链路回退 / 迁移脚本 / 手工改库）
	mu.Lock()
	before := reports
	host["127.0.0.1"] = StateOffline
	mu.Unlock()

	close(push) // 触发下一个心跳帧

	waitUntil(t, 3*time.Second, "心跳帧应把状态纠正回来", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return host["127.0.0.1"] == StateOnline && reports > before
	})
}

// TestHeartbeatReportOnAnyFrame 非 snapshot 帧（stats 事件）也要参与在线性判定。
func TestHeartbeatReportOnAnyFrame(t *testing.T) {
	s := New()
	var mu sync.Mutex
	var got []State
	s.SetStateReporter(func(key string, st State) {
		mu.Lock()
		got = append(got, st)
		mu.Unlock()
	})
	c, seq := newBareConn(t, s, "10.0.0.1")

	// 从未收到 snapshot，仅凭一帧 stats 事件就该判定在线
	c.handleFrame(&Frame{Type: FrameHello, Hello: &HelloFrame{SDKVersion: "v208"}}, seq)
	c.handleFrame(statsEventFrame(4), seq)

	mu.Lock()
	defer mu.Unlock()
	if len(got) == 0 {
		t.Fatalf("非 snapshot 帧没有上报在线")
	}
	for _, st := range got {
		if st != StateOnline {
			t.Fatalf("上报了非在线状态：%s", st)
		}
	}
	if s.StateOf("10.0.0.1") != StateOnline {
		t.Fatalf("StateOf 错")
	}
}

// TestPongDoesNotKeepStreamHealthy 回归 Healthy 的时效判据：**只有数据帧**算数。
//
// pong 只证明传输层活着。SDK 半启动 / 代理吞帧时设备一帧不发但照常回 pong，
// 若 pong 也推进时效，Healthy 会永远为真 → 宿主的 REST 兜底永远接不上手，
// 容器列表静默冻在最后一帧上（最难查的一类故障：日志一切正常，数据不动）。
func TestPongDoesNotKeepStreamHealthy(t *testing.T) {
	const maxIdle = 60 * time.Second
	const key = "10.0.0.1"

	s := New()
	c, seq := newBareConn(t, s, key)
	s.mu.Lock()
	s.conns[key] = c
	s.mu.Unlock()

	c.handleFrame(&Frame{Type: FrameSnapshot, Seq: 1, Snapshot: &SnapshotFrame{Seq: 1}}, seq)
	if !s.Healthy(key, maxIdle) {
		t.Fatalf("刚收到 snapshot 应为健康")
	}

	// 数据流停了、pong 照回：时效按最后一帧算，不能按 pong 算
	c.lastData.Store(time.Now().Add(-2 * maxIdle).UnixNano())
	c.touch()
	if s.Healthy(key, maxIdle) {
		t.Fatalf("pong 顶替了数据帧：静默 %v 仍被判健康，REST 兜底接不上手", 2*maxIdle)
	}
	// 看门狗用的传输层时钟必须被 pong 推进 —— 通道活着就不该踢连接
	if d := time.Since(time.Unix(0, c.lastActivity.Load())); d > time.Second {
		t.Fatalf("pong 没推进看门狗时钟（会误杀好连接）：%v", d)
	}

	c.touchData() // 数据恢复 → 立刻回到健康
	if !s.Healthy(key, maxIdle) {
		t.Fatalf("数据帧恢复后仍判不健康")
	}
}

// TestControlFramesDoNotKeepStreamHealthy 是 TestPongDoesNotKeepStreamHealthy 的另一半：
// **控制帧**同样不许顶替数据帧。
//
// resync-required 的语义是"设备端环形缓冲区滚掉了，重发一次全量"，system/resync 是
// "采集子系统重启"，两者都不带任何容器数据。若它们推进 lastData，一台只会反复喊
// 重同步、始终供不出快照的设备会让 Healthy 永远为真 → REST 兜底永远接不上手，
// 容器列表静默冻在最后一帧上（最难查的一类故障：日志一切正常，数据不动）。
// 重复帧（seq 没往前走）同理：没有任何新东西被应用，就不算在供数。
func TestControlFramesDoNotKeepStreamHealthy(t *testing.T) {
	const maxIdle = 60 * time.Second
	const key = "10.0.0.1"

	s := New()
	c, seq := newBareConn(t, s, key)
	s.mu.Lock()
	s.conns[key] = c
	s.mu.Unlock()

	c.handleFrame(&Frame{Type: FrameSnapshot, Seq: 1, Snapshot: &SnapshotFrame{Seq: 1}}, seq)
	if !s.Healthy(key, maxIdle) {
		t.Fatalf("刚收到 snapshot 应为健康")
	}
	stale := func() { c.lastData.Store(time.Now().Add(-2 * maxIdle).UnixNano()) }

	stale()
	c.handleFrame(&Frame{Type: FrameResyncRequired}, seq)
	if s.Healthy(key, maxIdle) {
		t.Fatalf("resync-required 顶替了数据帧：设备供不出快照却仍被判健康")
	}

	stale()
	c.handleFrame(&Frame{Type: FrameHello, Hello: &HelloFrame{SDKVersion: "v208"}}, seq)
	if s.Healthy(key, maxIdle) {
		t.Fatalf("hello 顶替了数据帧")
	}

	stale()
	c.handleFrame(&Frame{Type: FrameEvent, Seq: 5, Event: &EventFrame{
		Seq: 5, Event: EventSystem, Action: ActionResync, Data: json.RawMessage(`{}`),
	}}, seq)
	if s.Healthy(key, maxIdle) {
		t.Fatalf("system/resync 信令顶替了数据帧")
	}

	// 真数据帧恢复 → 立刻回到健康。
	// 注意上面那帧 hello 把 seq 基线复位了（onHello），所以先用 snapshot 重建基线：
	// 没有基线时事件走 verdictNotAligned，那条分支是**真的在应用**事件（并顺手补一次
	// resync 对齐），所以它照样算供数 —— 只有"应用了个和上次一样的 seq"才不算。
	c.handleFrame(&Frame{Type: FrameSnapshot, Seq: 2, Snapshot: &SnapshotFrame{Seq: 2}}, seq)
	if !s.Healthy(key, maxIdle) {
		t.Fatalf("快照到达后应恢复健康")
	}

	c.handleFrame(statsEventFrame(3), seq)
	if !s.Healthy(key, maxIdle) {
		t.Fatalf("事件帧到达后应判健康")
	}

	// 同一 seq 重放：没有任何新东西被应用，不该继续顶住 Healthy
	stale()
	c.handleFrame(statsEventFrame(3), seq)
	if s.Healthy(key, maxIdle) {
		t.Fatalf("重复帧（seq 未前进）顶替了数据帧")
	}

	// seq 前进一格 → 恢复
	c.handleFrame(statsEventFrame(4), seq)
	if !s.Healthy(key, maxIdle) {
		t.Fatalf("新 seq 的事件帧该恢复健康")
	}
}

// TestBackoffNotResetByHelloOnly 覆盖退避重置判据：
// 只有 snapshot 才算流健康，hello 不算（否则「连上即断」会退化成 1s 高频重连轰炸）。
func TestBackoffNotResetByHelloOnly(t *testing.T) {
	c, seq := newBareConn(t, New(), "10.0.0.1")

	c.handleFrame(&Frame{Type: FrameHello, Hello: &HelloFrame{}}, seq)
	if c.streamHealthy.Load() {
		t.Fatalf("hello 不该把流标记为健康")
	}

	c.handleFrame(&Frame{Type: FrameSnapshot, Seq: 1, Snapshot: &SnapshotFrame{Seq: 1}}, seq)
	if !c.streamHealthy.Swap(false) {
		t.Fatalf("snapshot 该把流标记为健康")
	}
}

// TestDialOptionsPasswordGetsBareIP 回归密码契约：getter 必须收到剥掉端口的纯 IP。
//
// 传 "ip:8000" 会永远查不到密码 → 配了密码的设备全量 401（真机 11 台）。
func TestDialOptionsPasswordGetsBareIP(t *testing.T) {
	var mu sync.Mutex
	var seen []string

	s := New()
	s.SetPasswordGetter(func(ip string) string {
		mu.Lock()
		seen = append(seen, ip)
		mu.Unlock()
		return "pw123"
	})

	cases := []struct {
		key     string
		host    string
		wantIP  string
		wantURL string
	}{
		{"10.10.5.202", "10.10.5.202", "10.10.5.202", "ws://10.10.5.202:8000/ws/events"},
		{"k2", "10.10.5.203:8000", "10.10.5.203", "ws://10.10.5.203:8000/ws/events"},
	}
	for _, tc := range cases {
		s.mu.Lock()
		s.targets[tc.key] = Device{Key: tc.key, Host: tc.host, DeviceID: "r99d3fd5e"}
		s.mu.Unlock()

		url, head := s.dialRequest(tc.key)
		if url != tc.wantURL {
			t.Fatalf("URL 错：%s，期望 %s", url, tc.wantURL)
		}
		if got := head.Get("deviceId"); got != "r99d3fd5e" {
			t.Fatalf("deviceId 头错：%q", got)
		}
		want := "Basic " + base64.StdEncoding.EncodeToString([]byte("admin:pw123"))
		if got := head.Get("Authorization"); got != want {
			t.Fatalf("Authorization 头错：%q", got)
		}
	}

	mu.Lock()
	defer mu.Unlock()
	for _, ip := range seen {
		if strings.Contains(ip, ":") {
			t.Fatalf("密码 getter 收到了带端口的地址 %q（契约要求纯 IP）", ip)
		}
	}
	if len(seen) != 2 {
		t.Fatalf("getter 调用次数错：%v", seen)
	}
}

func TestDialOptionsOmitAuthWhenNoPassword(t *testing.T) {
	s := New()
	s.SetPasswordGetter(func(ip string) string { return "" }) // 设备未配密码 → 省略头
	s.mu.Lock()
	s.targets["10.0.0.9"] = Device{Key: "10.0.0.9"}
	s.mu.Unlock()

	_, head := s.dialRequest("10.0.0.9")
	if _, ok := head["Authorization"]; ok {
		t.Fatalf("没密码时不该带 Authorization（会被设备判 401）")
	}
	if head.Get("deviceId") != "" {
		t.Fatalf("没有已知 ID 时不该带 deviceId 头：%q", head.Get("deviceId"))
	}
}

func TestDialPortOverrideApplies(t *testing.T) {
	s := New()
	s.SetDialPort("18000")
	s.mu.Lock()
	s.targets["10.0.0.9"] = Device{Key: "10.0.0.9"}
	s.mu.Unlock()

	url, _ := s.dialRequest("10.0.0.9")
	if url != "ws://10.0.0.9:18000/ws/events" {
		t.Fatalf("端口覆盖没生效：%s", url)
	}
}

// TestDispatchRoutesUnknownEventDomainSilently 未知事件域只记日志，不影响连接。
func TestDispatchRoutesUnknownEventDomainSilently(t *testing.T) {
	s := New()
	c := newCollector()
	s.SetHandlers(c)
	logged := make(chan string, 4)
	s.SetLogHandler(func(line string) {
		select {
		case logged <- line:
		default:
		}
	})

	s.dispatch("10.0.0.1", &Frame{Type: FrameEvent, Seq: 1, Event: &EventFrame{
		Seq: 1, Event: "volume", Action: "changed", Data: json.RawMessage(`{}`),
	}})

	select {
	case line := <-logged:
		if !strings.Contains(line, "volume") {
			t.Fatalf("日志没带上未知域：%s", line)
		}
	case <-time.After(time.Second):
		t.Fatalf("未知事件域该记一笔日志")
	}
	if rec := c.snapshot(); len(rec.cont)+len(rec.boot)+len(rec.sstats) != 0 {
		t.Fatalf("未知事件域不该乱路由：%+v", rec)
	}
}

func TestDispatchWithoutHandlersIsSafe(t *testing.T) {
	s := New() // 集成层还没来得及注入 handlers
	s.dispatch("10.0.0.1", &Frame{Type: FrameSnapshot, Seq: 1, Snapshot: &SnapshotFrame{Seq: 1}})
	s.reportState("10.0.0.1", StateOnline) // 没有 reporter 也不能 panic
	s.noteRTT("10.0.0.1", time.Millisecond)
}

// helloSpy 只关心 OnHello 有没有被叫到。
type helloSpy struct {
	BaseHandlers
	calls int
	model string
}

func (h *helloSpy) OnHello(_ string, f *HelloFrame) {
	h.calls++
	if f != nil {
		h.model = f.Model
	}
}

// TestHelloWithoutDeviceIDStillReachesOnHello 回归「缺 deviceId 就整帧不报」。
//
// 协议 §3.1 写明 deviceId 在 v206 上可以省略，而机型/固件版本恰好也只在 hello 里
// 有：把两件事捆在一起，等于对最需要兜底的那批老固件关掉了兜底。
func TestHelloWithoutDeviceIDStillReachesOnHello(t *testing.T) {
	spy := &helloSpy{}
	s := New()
	s.SetHandlers(spy)
	s.mu.Lock()
	s.targets["10.0.0.1"] = Device{Key: "10.0.0.1", DeviceID: "keepme"}
	s.mu.Unlock()

	s.noteHello("10.0.0.1", &HelloFrame{Model: "SM-F7660", SDKVersion: "v206"})
	if spy.calls != 1 || spy.model != "SM-F7660" {
		t.Fatalf("没有 deviceId 的 hello 被整帧丢弃：calls=%d model=%q", spy.calls, spy.model)
	}
	if id := s.targets["10.0.0.1"].DeviceID; id != "keepme" {
		t.Fatalf("缺 deviceId 不该擦掉已知身份：%q", id)
	}

	// 带 ID 时两条语义都成立：既报 OnHello，也回填拨号头用的身份
	s.noteHello("10.0.0.1", &HelloFrame{DeviceID: "newid"})
	if spy.calls != 2 {
		t.Fatalf("带 deviceId 的 hello 没上报：calls=%d", spy.calls)
	}
	if id := s.targets["10.0.0.1"].DeviceID; id != "newid" {
		t.Fatalf("hello 学到的 deviceId 没回填：%q", id)
	}
}

// TestUnknownDomainLoggedOncePerDevice 钉住未知事件域的日志量级。
//
// 前向兼容要求"没接的域只记日志、不动连接"，但未知域是**按帧**到达的：
// SDK 哪天加一种 volume/changed 事件，逐帧记录就是一堵永久日志墙，
// 而这堵墙想表达的信息只有一句"这批设备多了一种事件，还没接"。
func TestUnknownDomainLoggedOncePerDevice(t *testing.T) {
	s := New()
	s.SetHandlers(newCollector()) // 没接 handlers 时 dispatch 直接返回，不会走到日志
	var mu sync.Mutex
	var lines []string
	s.SetLogHandler(func(l string) {
		mu.Lock()
		lines = append(lines, l)
		mu.Unlock()
	})

	unknown := func(key string, seq int64) {
		s.dispatch(key, &Frame{Type: FrameEvent, Seq: seq, Event: &EventFrame{
			Seq: seq, Event: "volume", Action: "changed", Data: json.RawMessage(`{}`),
		}})
	}
	for i := int64(1); i <= 5; i++ {
		unknown("10.0.0.1", i)
	}
	mu.Lock()
	n := len(lines)
	mu.Unlock()
	if n != 1 {
		t.Fatalf("同一未知域记了 %d 行，应该只记 1 行：%v", n, lines)
	}

	// 换设备要重新知情（不同固件行为不同），换域名也要
	unknown("10.0.0.2", 1)
	s.dispatch("10.0.0.1", &Frame{Type: FrameEvent, Seq: 6, Event: &EventFrame{
		Seq: 6, Event: "network", Action: "changed", Data: json.RawMessage(`{}`),
	}})
	mu.Lock()
	defer mu.Unlock()
	if len(lines) != 3 {
		t.Fatalf("换设备/换域名的未知域没各自记一笔：%v", lines)
	}
}

// TestSyncPrunesUnknownDomainMemory 保证"未知域只记一次"不会变成
// "这个 IP 上以后出现的任何新域都永远不记"（IP 会被复用）。
func TestSyncPrunesUnknownDomainMemory(t *testing.T) {
	s := New()
	t.Cleanup(s.Stop)
	s.noteNewDomain("10.0.0.1", "volume", "changed")

	s.Sync([]Device{{Key: "10.0.0.9"}}) // 10.0.0.1 已不在监控列表

	if s.noteNewDomain("10.0.0.1", "volume", "changed") {
		return // 已被清掉 → 重新知情，符合预期
	}
	t.Fatalf("设备移除后未知域记忆还在：新设备（复用同一 IP）的这个域将永远不报")
}

// TestRTTReporterReceivesPongLatency pong 的往返时延必须能交给宿主：
// 事件通道接管在线性后，健康的设备不再被单独 TCP 探活，这条 RTT 是前端
// "延迟"列唯一的数据源（漏接不报错，只会看到延迟永远停在最后一次探活的值）。
func TestRTTReporterReceivesPongLatency(t *testing.T) {
	type rtt struct {
		key string
		ms  int64
	}
	got := make(chan rtt, 4)
	s := New()
	s.SetRTTReporter(func(key string, ms int64) { got <- rtt{key, ms} })

	s.noteRTT("10.0.0.1", 12*time.Millisecond)
	select {
	case r := <-got:
		if r.key != "10.0.0.1" || r.ms != 12 {
			t.Fatalf("RTT 落错设备/数值：%+v", r)
		}
	case <-time.After(time.Second):
		t.Fatalf("pong RTT 没送到宿主")
	}

	// 时钟回拨一类的负值不该污染延迟列
	s.noteRTT("10.0.0.2", -time.Second)
	if r := <-got; r.ms != 0 {
		t.Fatalf("负 RTT 该夹到 0，拿到 %+v", r)
	}
}
