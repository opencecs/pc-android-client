package eventws

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// startService 起 mock 端点（依次下发 frames 后保活）+ Service + 收集器，
// 并连上一台 Key 为 127.0.0.1 的设备。
func startService(t *testing.T, frames ...any) (*Service, *mockSDK, *collector) {
	return startServiceWith(t, func(m *mockSDK) func(context.Context, *websocket.Conn) {
		return m.ServeStandard(frames...)
	})
}

// startServiceWith 允许自定义 serve（模拟断开、分批下发等）。
// build 拿到 mock 本身，因此客户端写入能落到同一个 recv 通道。
func startServiceWith(t *testing.T,
	build func(m *mockSDK) func(context.Context, *websocket.Conn)) (*Service, *mockSDK, *collector) {
	t.Helper()

	m := newMockSDK(t, nil)
	m.serve = build(m)

	c := newCollector()
	s := newTestService(t, m)
	s.SetHandlers(c)
	s.Connect(Device{Key: "127.0.0.1"})
	t.Cleanup(s.Stop)
	return s, m, c
}

// ---------- 收帧分发 ----------

func TestDispatchAllFrameKinds(t *testing.T) {
	s, m, c := startServiceWith(t, func(mk *mockSDK) func(context.Context, *websocket.Conn) {
		return func(ctx context.Context, ws *websocket.Conn) {
			writeJSON(ctx, ws, helloFixture())
			writeJSON(ctx, ws, snapshotFixture(2))
			writeJSON(ctx, ws, eventFixture(2, EventContainer, ActionStart,
				map[string]any{"name": "c1_A", "id": "1001"}))
			writeJSON(ctx, ws, eventFixture(3, EventBoot, ActionBooting,
				map[string]any{"name": "c1_B", "indexNum": 2}))
			writeJSON(ctx, ws, eventFixture(4, EventContainer, ActionStats,
				[]map[string]any{{"name": "c1_A", "cpuUsage": 5.5, "memUsage": 11}}))
			writeJSON(ctx, ws, eventFixture(5, EventSystem, ActionStats,
				map[string]any{"cpuload": "1.5"}))
			// 非文本帧该忽略；坏 JSON 该只记日志不断连
			wctx, cancel := context.WithTimeout(ctx, 2*time.Second)
			_ = ws.Write(wctx, websocket.MessageBinary, []byte{0x01, 0x02})
			cancel()
			wctx2, cancel2 := context.WithTimeout(ctx, 2*time.Second)
			_ = ws.Write(wctx2, websocket.MessageText, []byte(`{oops`))
			cancel2()
			writeJSON(ctx, ws, eventFixture(6, EventContainer, ActionDie,
				map[string]any{"name": "c1_C"}))

			for {
				if _, _, err := ws.Read(ctx); err != nil {
					return
				}
			}
		}
	})

	c.Wait(t, 7, 3*time.Second)

	rec := c.snapshot()
	if len(rec.hello) != 1 || rec.hello[0].DeviceID != "r99d3fd5e" {
		t.Fatalf("hello 分发错：%+v", rec.hello)
	}
	if len(rec.snapshot) != 1 || len(rec.snapshot[0].List) != 2 {
		t.Fatalf("snapshot 分发错：%+v", rec.snapshot)
	}
	if len(rec.cont) != 2 || rec.cont[0].Name != "c1_A" || rec.cont[1].Name != "c1_C" {
		t.Fatalf("container 分发错：%+v", rec.cont)
	}
	if len(rec.boot) != 1 || rec.boot[0].IndexNum != 2 {
		t.Fatalf("boot 分发错：%+v", rec.boot)
	}
	if len(rec.cstats) != 1 || rec.cstats[0][0].CPUUsage != 5.5 {
		t.Fatalf("container/stats 分发错：%+v", rec.cstats)
	}
	if len(rec.sstats) != 1 || rec.sstats[0]["cpuload"] != "1.5" {
		t.Fatalf("system/stats 分发错：%+v", rec.sstats)
	}

	if got := s.StateOf("127.0.0.1"); got != StateOnline {
		t.Fatalf("在线性应为 online：%s", got)
	}
	if !s.Owns("127.0.0.1") {
		t.Fatalf("连接健康时 Owns 应为 true")
	}
	// hello 学到的设备身份要回填，供下次拨号的 deviceId 头
	s.mu.RLock()
	id := s.targets["127.0.0.1"].DeviceID
	s.mu.RUnlock()
	if id != "r99d3fd5e" {
		t.Fatalf("hello 未回填 DeviceID：%q", id)
	}
	if m.Dials() != 1 {
		t.Fatalf("非文本帧/坏 JSON 不该把连接打死（拨号 %d 次）", m.Dials())
	}
}

func TestHandlerPanicDoesNotKillConnection(t *testing.T) {
	// 业务侧一次 panic 不该带走整条连接（dispatch 有 recover）
	m := newMockSDK(t, nil)
	m.serve = m.ServeStandard(helloFixture(), snapshotFixture(1),
		eventFixture(2, EventContainer, ActionStart, map[string]any{"name": "boom"}),
		eventFixture(3, EventContainer, ActionStart, map[string]any{"name": "ok"}))

	c := &panickyCollector{panics: 1}
	s := newTestService(t, m)
	s.SetHandlers(c)
	s.Connect(Device{Key: "127.0.0.1"})
	t.Cleanup(s.Stop)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if len(c.names()) >= 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if got := c.names(); len(got) != 2 || got[1] != "ok" {
		t.Fatalf("panic 之后的事件该继续投递：%v", got)
	}
}

// ---------- 大 payload：读限制回归（真机踩坑）----------

func TestBigSnapshotSurvivesReadLimit(t *testing.T) {
	big := bigSnapshotFixture(t, 37)

	s, m, c := startServiceWith(t, func(mk *mockSDK) func(context.Context, *websocket.Conn) {
		return func(ctx context.Context, ws *websocket.Conn) {
			writeJSON(ctx, ws, helloFixture())
			writeJSON(ctx, ws, big)
			for {
				if _, _, err := ws.Read(ctx); err != nil {
					return
				}
			}
		}
	})

	c.Wait(t, 2, 3*time.Second)
	rec := c.snapshot()
	if len(rec.snapshot) != 1 {
		t.Fatalf("大快照没收到：%d 条", len(rec.snapshot))
	}
	if len(rec.snapshot[0].List) != 37 {
		t.Fatalf("容器数错：%d", len(rec.snapshot[0].List))
	}
	if got := s.StateOf("127.0.0.1"); got != StateOnline {
		t.Fatalf("在线性错：%s", got)
	}
	// 读限制没放宽时的表现正是：收到 hello 就被 1009 断开 → 无限重连轰炸
	time.Sleep(500 * time.Millisecond)
	if m.Dials() != 1 {
		t.Fatalf("大快照不该把连接打死（重连 %d 次 = 32KB 读限制问题复现）", m.Dials())
	}
}

// ---------- seq 断档 / 去重 / resync 限频 ----------

func TestSeqGapAppliesEventAndRequestsResync(t *testing.T) {
	s, m, c := startService(t,
		helloFixture(), snapshotFixture(1),
		eventFixture(9, EventContainer, ActionStop, map[string]any{"name": "c1_A"})) // 基线 1 → 断档
	_ = s

	c.Wait(t, 3, 3*time.Second)
	if rec := c.snapshot(); len(rec.cont) != 1 {
		t.Fatalf("断档事件仍要应用（不能为保序卡实时性）：%+v", rec.cont)
	}
	m.WaitRecv(t, `"resync"`, 2*time.Second)
}

func TestEventBeforeSnapshotAppliesAndAligns(t *testing.T) {
	_, m, c := startService(t,
		helloFixture(),
		eventFixture(3, EventContainer, ActionStart, map[string]any{"name": "c1_A"})) // 没有基线

	c.Wait(t, 2, 3*time.Second)
	if rec := c.snapshot(); len(rec.cont) != 1 {
		t.Fatalf("未对齐时事件照常应用：%+v", rec.cont)
	}
	m.WaitRecv(t, `"resync"`, 2*time.Second)
}

func TestDuplicateSeqDropped(t *testing.T) {
	_, m, c := startService(t,
		helloFixture(), snapshotFixture(1),
		eventFixture(1, EventContainer, ActionStart, map[string]any{"name": "dup"}), // <= 基线，重放
		eventFixture(2, EventContainer, ActionDie, map[string]any{"name": "fresh"}))

	c.Wait(t, 3, 3*time.Second)
	deadline := time.Now().Add(400 * time.Millisecond)
	for time.Now().Before(deadline) {
		if n := len(c.snapshot().cont); n >= 2 {
			t.Fatalf("重放帧被应用了：%+v", c.snapshot().cont)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if rec := c.snapshot(); len(rec.cont) != 1 || rec.cont[0].Name != "fresh" {
		t.Fatalf("只该留 seq=2 的那条：%+v", rec.cont)
	}
	m.NoRecv(t, 300*time.Millisecond) // 重放不该触发 resync
}

func TestResyncIsRateLimited(t *testing.T) {
	// 连发两个断档事件：resync 限频 10s → 只写一次
	_, m, c := startService(t,
		helloFixture(), snapshotFixture(1),
		eventFixture(20, EventContainer, ActionStart, map[string]any{"name": "a"}),
		eventFixture(40, EventContainer, ActionStart, map[string]any{"name": "b"}))

	c.Wait(t, 3, 3*time.Second)
	m.WaitRecv(t, `"resync"`, 2*time.Second)
	m.NoRecv(t, 500*time.Millisecond)
}

func TestResyncRequiredFrameTriggersResync(t *testing.T) {
	_, m, _ := startService(t, helloFixture(), map[string]any{"type": FrameResyncRequired})
	m.WaitRecv(t, `"resync"`, 2*time.Second)
}

func TestSystemResyncNotDispatchedAsStats(t *testing.T) {
	_, m, c := startService(t, helloFixture(), snapshotFixture(1),
		eventFixture(2, EventSystem, ActionResync, nil))

	m.WaitRecv(t, `"resync"`, 2*time.Second)
	time.Sleep(300 * time.Millisecond)
	if rec := c.snapshot(); len(rec.sstats) != 0 {
		t.Fatalf("system/resync 不该当设备指标分发：%+v", rec.sstats)
	}
}

// ---------- 断连重连 ----------

func TestReconnectsAfterDeviceClosesStream(t *testing.T) {
	s, m, c := startServiceWith(t, func(mk *mockSDK) func(context.Context, *websocket.Conn) {
		var round int
		return func(ctx context.Context, ws *websocket.Conn) {
			round++
			writeJSON(ctx, ws, helloFixture())
			writeJSON(ctx, ws, snapshotFixture(round))
			if round == 1 {
				return // 第一轮立刻断开：模拟设备重启 / TCP 断
			}
			for {
				if _, _, err := ws.Read(ctx); err != nil {
					return
				}
			}
		}
	})

	m.WaitDial(t, 2, 8*time.Second)
	c.Wait(t, 4, 3*time.Second) // 两轮 hello+snapshot

	rec := c.snapshot()
	if len(rec.snapshot) < 2 {
		t.Fatalf("重连后该再收到快照：%d", len(rec.snapshot))
	}
	if got := s.StateOf("127.0.0.1"); got != StateOnline {
		t.Fatalf("重连成功后该回到 online：%s", got)
	}
}

func TestDisconnectStopsConnection(t *testing.T) {
	s, _, c := startService(t, helloFixture(), snapshotFixture(1))
	c.Wait(t, 2, 3*time.Second)

	s.Disconnect("127.0.0.1")
	if s.Owns("127.0.0.1") {
		t.Fatalf("Disconnect 后不该还有连接")
	}
}

// ---------- 降级与鉴权 ----------

// 老 SDK 拨 /ws/events 得 404：判离线 + 降级不再拨号，但**在线性仍归事件通道管**。
//
// 契约在 2026-09-04 翻转过一次。从前这里钉的是"404 不是离线证据，一个状态都不许报"，
// 因为那台设备的在线由 TCP 探活挣；现场要的形状是"没有事件流的设备就显示离线"，
// 而不是"在线、可存储/版本/容器那几格永远空着"。翻转的配套改动是宿主的让位判据从
// Owns 换成 ServesWS —— 两者必须同进同退，只改一边就是"报完离线又被探活捞回绿色"。
func TestNotFoundDegradesAndClaimsOffline(t *testing.T) {
	m := newMockStatusSDK(t, 404)
	s := newTestService(t, m)
	c := newCollector()
	s.SetHandlers(c)
	s.SetStateReporter(c.recordState)
	t.Cleanup(s.Stop)

	s.Connect(Device{Key: "127.0.0.1"})
	m.WaitDial(t, 1, 5*time.Second)
	waitUntil(t, 3*time.Second, "404 应进降级记忆", func() bool { return s.Degraded("127.0.0.1") })

	if s.Owns("127.0.0.1") {
		t.Fatalf("降级设备不该被 Owns（此刻确实没有连接在跑）")
	}
	if !s.ServesWS("127.0.0.1") {
		t.Fatalf("降级设备必须仍归事件通道管（否则宿主的 TCP 探活会把它捞回在线）")
	}

	// 降级期内 Connect / Sync 都不该再拨
	s.Connect(Device{Key: "127.0.0.1"})
	s.Sync([]Device{{Key: "127.0.0.1"}})
	m.NoMoreDial(t, 500*time.Millisecond)

	got := c.states()
	if len(got) != 1 || got[0] != StateOffline {
		t.Fatalf("404 该判离线且只判一次（宿主那侧的让位判据已经认离线）：%v", got)
	}
	if s.Healthy("127.0.0.1", time.Minute) {
		t.Fatalf("404 设备没有事件流，REST 轮询不能因此让位")
	}
}

// 降级不是终局：固件刷到带事件通道的版本之后，到期定时器会自己再拨一次并转在线。
//
// TCP 探活撤掉之后，这台设备的翻身机会**只有**这一枚定时器 —— Sync 只在启动和设备
// 列表变动时跑，等 Sync 等于"升级完固件也得重启客户端才上线"。
func TestDegradeExpiryRedialsUpgradedFirmware(t *testing.T) {
	old := newMockStatusSDK(t, 404)
	s := newTestService(t, old)
	c := newCollector()
	s.SetHandlers(c)
	s.SetStateReporter(c.recordState)
	t.Cleanup(s.Stop)

	s.Connect(Device{Key: "127.0.0.1"})
	waitUntil(t, 3*time.Second, "先因 404 进降级", func() bool { return s.Degraded("127.0.0.1") })
	waitUntil(t, 3*time.Second, "404 该判离线", func() bool {
		return s.StateOf("127.0.0.1") == StateOffline
	})

	// 现场等价物：这台设备升级了固件，同一地址上现在真的有人供数。
	upgraded := newMockSDK(t, nil)
	upgraded.serve = upgraded.ServeStandard(helloFixture(), snapshotFixture(1))

	s.mu.Lock()
	d := s.targets["127.0.0.1"]
	d.Host = "127.0.0.1:" + upgraded.port // 换到新端点（拨号地址，Key/缓存索引不变）
	s.targets["127.0.0.1"] = d
	until := time.Now().Add(-time.Second) // 模拟 10 分钟早已到期
	s.degrade["127.0.0.1"] = until
	s.mu.Unlock()
	s.armDegradeRetry("127.0.0.1", until) // 真机上这一步由 markDegraded 自己装好

	waitUntil(t, 5*time.Second, "到期重拨后该自动上线", func() bool {
		return !s.Degraded("127.0.0.1") && s.StateOf("127.0.0.1") == StateOnline
	})
	if got := len(c.snapshot().snapshot); got == 0 {
		t.Fatalf("重拨成功了却没把容器快照接回来：%d 帧", got)
	}
	// 离线只报一次、上线报一次：中途不许有第三条（退避循环刷日志墙的老形状）。
	if got := c.states(); len(got) != 2 || got[1] != StateOnline {
		t.Fatalf("在线性上报形状不对：%v", got)
	}
}

// 到期重拨的定时器不能变成孤儿：设备被移出监控列表时必须摘掉，
// 否则退出/删除之后还会凭空拨一台已经不监控的设备，map 也随 IP 更替无限增长。
func TestDegradeRetryTimerClearedOnRemoval(t *testing.T) {
	s := New()
	s.SetDialPort("1")
	t.Cleanup(s.Stop)

	s.Sync([]Device{{Key: "10.0.0.1"}, {Key: "10.0.0.2"}})
	s.markDegraded("10.0.0.1") // 装一枚 10 分钟后的定时器
	s.mu.RLock()
	_, armed := s.degradeTimer["10.0.0.1"]
	s.mu.RUnlock()
	if !armed {
		t.Fatalf("降级时没装到期重拨定时器（这台设备升级固件后也起不来）")
	}

	// 设备被移出列表：定时器与降级记忆一起忘掉
	s.Sync([]Device{{Key: "10.0.0.2"}})
	// Disconnect 那条路径同理
	s.markDegraded("10.0.0.2")
	s.Disconnect("10.0.0.2")

	s.mu.RLock()
	n := len(s.degradeTimer)
	s.mu.RUnlock()
	if n != 0 {
		t.Fatalf("移除/断开的设备留下了 %d 枚到期重拨定时器", n)
	}
}

func TestDegradeExpiryAllowsRedial(t *testing.T) {
	m := newMockStatusSDK(t, 404)
	s := newTestService(t, m)
	t.Cleanup(s.Stop)

	s.Connect(Device{Key: "127.0.0.1"})
	m.WaitDial(t, 1, 5*time.Second)
	waitUntil(t, 3*time.Second, "404 应进降级记忆", func() bool { return s.Degraded("127.0.0.1") })

	s.mu.Lock()
	s.degrade["127.0.0.1"] = time.Now().Add(-time.Second) // 模拟 10 分钟到期
	s.mu.Unlock()

	s.Sync([]Device{{Key: "127.0.0.1"}}) // 到期后由 Sync 重新探测一次
	m.WaitDial(t, 2, 5*time.Second)
}

func TestUnauthorizedReportsAuthFail(t *testing.T) {
	m := newMockStatusSDK(t, 401)
	s := newTestService(t, m)
	t.Cleanup(s.Stop)

	s.Connect(Device{Key: "127.0.0.1"})
	waitUntil(t, 5*time.Second, "401 该报 auth_fail",
		func() bool { return s.StateOf("127.0.0.1") == StateAuthFail })
}

func TestForbiddenDropsCachedDeviceID(t *testing.T) {
	m := newMockStatusSDK(t, 403)
	s := newTestService(t, m)
	c := newCollector()
	s.SetHandlers(c)
	s.SetStateReporter(c.recordState)
	t.Cleanup(s.Stop)

	// 带着一个过期的 deviceId（IP 被复用给了另一台设备）去拨号
	s.Connect(Device{Key: "127.0.0.1", DeviceID: "staleID"})
	waitUntil(t, 5*time.Second, "403 该忘掉过期身份后再重试", func() bool {
		s.mu.RLock()
		defer s.mu.RUnlock()
		return s.targets["127.0.0.1"].DeviceID == ""
	})
	if s.Degraded("127.0.0.1") {
		t.Fatalf("403 不是降级：deviceId 不匹配要退避重试，别静默 10 分钟")
	}
	// 403 = "这个 IP 不是我以为的那台设备"：在线性只能判离线。
	// TCP 探活撤掉后这里是它唯一的判死通道（对照 claimOffline 的注释：闸门与探活同进同退）。
	if got := c.states(); len(got) == 0 || got[len(got)-1] != StateOffline {
		t.Fatalf("403 该判离线：%v", got)
	}
}

// 拨不通就是离线 —— 这是"拨号即探活"的正面表述，也是 TCP 探活让位之后唯一还活着的
// 判死路径（方案 §5.1「无心跳即离线」）。
//
// 从前这里钉的是反过来的契约："从未收到过快照的连接失败不能判设备离线"，因为那时
// 探活还在跑、还在给设备发 online，拿拨号失败去覆盖它会每 3s 打一次脸。探活撤了，
// 那条前提就不存在了：留着闸门，一台真死的设备从上线到进程重启都会绿着。
func TestUnreachableDeviceClaimedOffline(t *testing.T) {
	s := New()
	s.SetDialPort("1") // 端口 1 没人听 → 立刻 refused
	states := make(chan State, 8)
	s.SetStateReporter(func(key string, st State) { states <- st })
	t.Cleanup(s.Stop)

	s.Connect(Device{Key: "127.0.0.1"})
	select {
	case st := <-states:
		if st != StateOffline {
			t.Fatalf("拨不通该报离线，收到 %s", st)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("拨不通却没判离线：探活已经不跑这类设备了，没人会报它死")
	}
	if s.Healthy("127.0.0.1", time.Minute) {
		t.Fatalf("拨不通不该 Healthy（REST 轮询要接手）")
	}
}

// 反过来：真的供过数之后断流，必须由事件通道立刻判离线（这是接入的核心收益，
// 比 TCP 探活的 3×3s 快，也不依赖 8000 端口以外的东西）。
func TestStreamedDeviceDropsToOffline(t *testing.T) {
	m := newMockSDK(t, nil)
	var round int
	m.serve = func(ctx context.Context, ws *websocket.Conn) {
		round++
		if round == 1 {
			writeJSON(ctx, ws, helloFixture())
			writeJSON(ctx, ws, snapshotFixture(1))
			return // 供过数之后设备消失
		}
		// 后续重连只握手不供数：离线判定必须一直保持
		<-ctx.Done()
	}

	s := newTestService(t, m)
	c := newCollector()
	s.SetHandlers(c)
	s.SetStateReporter(c.recordState)
	t.Cleanup(s.Stop)

	s.Connect(Device{Key: "127.0.0.1"})
	waitUntil(t, 5*time.Second, "先收到快照（建立在线性）", func() bool {
		return s.StateOf("127.0.0.1") == StateOnline
	})
	waitUntil(t, 5*time.Second, "供过数后断开该判离线", func() bool {
		return s.StateOf("127.0.0.1") == StateOffline
	})
}

// ---------- manager 生命周期 ----------

func TestConnectIsIdempotent(t *testing.T) {
	s, m, _ := startService(t, helloFixture(), snapshotFixture(1))
	time.Sleep(300 * time.Millisecond)

	for i := 0; i < 5; i++ {
		s.Connect(Device{Key: "127.0.0.1"})
	}
	time.Sleep(300 * time.Millisecond)
	if m.Dials() != 1 {
		t.Fatalf("重复 Connect 不该再拨：%d 次", m.Dials())
	}
}

func TestSyncReconcilesConnections(t *testing.T) {
	s := New()
	s.SetDialPort("1")
	t.Cleanup(s.Stop)

	s.Sync([]Device{{Key: "10.0.0.1"}, {Key: "10.0.0.2"}})
	if !s.Owns("10.0.0.1") || !s.Owns("10.0.0.2") {
		t.Fatalf("Sync 后两台都该建连")
	}

	s.Sync([]Device{{Key: "10.0.0.2"}})
	if s.Owns("10.0.0.1") {
		t.Fatalf("不在列表里的设备该断开")
	}
	if !s.Owns("10.0.0.2") {
		t.Fatalf("留在列表里的设备不该被动过")
	}
}

func TestSyncKeepsLearnedDeviceID(t *testing.T) {
	s := New()
	s.SetDialPort("1")
	t.Cleanup(s.Stop)

	s.Sync([]Device{{Key: "10.0.0.1", DeviceID: "r99d3fd5e"}})
	s.Sync([]Device{{Key: "10.0.0.1"}}) // 调用方没有 ID，别覆盖掉学到的

	s.mu.RLock()
	got := s.targets["10.0.0.1"].DeviceID
	s.mu.RUnlock()
	if got != "r99d3fd5e" {
		t.Fatalf("hello 学到的 DeviceID 被空值覆盖：%q", got)
	}
}

func TestDisconnectClearsStateMemory(t *testing.T) {
	s := New()
	s.SetDialPort("1")
	t.Cleanup(s.Stop)

	s.Sync([]Device{{Key: "10.0.0.1"}})
	s.reportState("10.0.0.1", StateOnline)
	s.Disconnect("10.0.0.1")

	s.stateMu.Lock()
	_, known := s.lastState["10.0.0.1"]
	s.stateMu.Unlock()
	if known {
		t.Fatalf("设备移除后该清掉状态记忆，否则 map 无界增长")
	}
}

func TestPublicDevicesSkipWS(t *testing.T) {
	s := New()
	s.SetDialPort("1")
	s.SetHandlers(newCollector())
	t.Cleanup(s.Stop)

	// 公网设备只有映射端口，没有局域网 8000 → 不建连，数据继续走网关/REST
	s.Sync([]Device{
		{Key: "1.2.3.4:8187", Host: "1.2.3.4:8187", SkipWS: true},
		{Key: ""}, // 空 Key 忽略
	})
	if s.Owns("1.2.3.4:8187") {
		t.Fatalf("SkipWS 设备不该建连")
	}
	// 它照样进 targets（Sync 按 IP 记账），所以 ServesWS 必须显式排除 SkipWS，
	// 否则宿主的 TCP 探活会让位，这台公网设备就再也没有任何在线性来源。
	if s.ServesWS("1.2.3.4:8187") {
		t.Fatalf("SkipWS 设备不该归事件通道判死活")
	}
	s.Connect(Device{Key: "5.6.7.8:9000", SkipWS: true})
	if s.Owns("5.6.7.8:9000") {
		t.Fatalf("Connect 也要尊重 SkipWS")
	}
	if s.ServesWS("5.6.7.8:9000") {
		t.Fatalf("Connect 登记的设备也要尊重 SkipWS（探活不能撤）")
	}
	// 对照组：一台普通的局域网 local 设备，哪怕一条连接都没建起来，
	// 在线性也归事件通道判 —— 拨不通就是它判离线。
	s.Connect(Device{Key: "10.0.0.9"})
	if !s.ServesWS("10.0.0.9") {
		t.Fatalf("local 设备该归事件通道管（宿主的 TCP 探活要让位）")
	}
}

func TestStopTerminatesEverything(t *testing.T) {
	s, _, c := startService(t, helloFixture(), snapshotFixture(1))
	c.Wait(t, 2, 3*time.Second)

	s.Stop()
	if s.Owns("127.0.0.1") {
		t.Fatalf("Stop 后不该还有连接")
	}
	s.Connect(Device{Key: "127.0.0.1"})
	if s.Owns("127.0.0.1") {
		t.Fatalf("Stop 之后 Connect 该无效，不能复活连接")
	}
}

// ---------- 测试辅助 ----------

// panickyCollector 前 panics 次容器回调直接 panic，验证 dispatch 的 recover。
type panickyCollector struct {
	BaseHandlers
	mu     sync.Mutex
	n      int
	panics int
	got    []string
}

func (p *panickyCollector) OnContainerEvent(key string, ev *ContainerEvent) {
	p.mu.Lock()
	p.n++
	count := p.n
	// 先记下"这一帧确实送到了业务侧"，再炸：否则测试分不清是没送达还是送达后炸了
	p.got = append(p.got, ev.Name)
	if count <= p.panics {
		p.mu.Unlock()
		panic("业务炸了")
	}
	p.mu.Unlock()
}

func (p *panickyCollector) names() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.got...)
}

func bigSnapshotFixture(t *testing.T, n int) map[string]any {
	t.Helper()
	f := snapshotFixture(n)
	data := f["data"].(map[string]any)
	list := data["list"].([]map[string]any)
	pad := strings.Repeat("y", 1024)
	for _, item := range list {
		item["mounts"] = pad // 真机上 mounts/env 一类字段让快照轻松破 32KB
	}
	b, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("fixture 序列化失败：%v", err)
	}
	if len(b) <= 32768 {
		t.Fatalf("fixture 只有 %d 字节，测不出默认读限制", len(b))
	}
	return f
}

func waitUntil(t *testing.T, within time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("等待超时：%s", what)
}
