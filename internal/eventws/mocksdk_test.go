package eventws

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// mockSDK 是设备端事件通道的最小可用实现，只给单测用。
//
// 注意：mock 的快照默认很小，**mock 测不出大 payload 触发读限制的问题**
// （真机踩过的坑），所以下面专门有一条 40KB 快照的回归用例。
type mockSDK struct {
	t    *testing.T
	srv  *httptest.Server
	port string

	mu       sync.Mutex
	dials    int
	lastHead http.Header
	recv     chan []byte // 客户端 → 服务端的帧（resync 等）
	serve    func(ctx context.Context, ws *websocket.Conn)
}

// newMockSDK 启动一个事件通道端点；serve 返回即关闭该连接（模拟设备侧断开）。
func newMockSDK(t *testing.T, serve func(ctx context.Context, ws *websocket.Conn)) *mockSDK {
	t.Helper()
	m := &mockSDK{t: t, recv: make(chan []byte, 64), serve: serve}

	m.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		m.dials++
		m.lastHead = r.Header.Clone()
		m.mu.Unlock()

		if r.URL.Path != eventPath {
			http.NotFound(w, r)
			return
		}
		ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		defer ws.CloseNow()
		if m.serve != nil {
			m.serve(ctx, ws)
		}
	}))
	t.Cleanup(m.Close)

	host := strings.TrimPrefix(m.srv.URL, "http://")
	parts := strings.Split(host, ":")
	m.port = parts[len(parts)-1]
	return m
}

// newMockStatusSDK 启动一个握手就返回指定状态码的端点（测 401/403/404）。
func newMockStatusSDK(t *testing.T, code int) *mockSDK {
	t.Helper()
	m := &mockSDK{t: t, recv: make(chan []byte, 64)}
	m.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		m.dials++
		m.lastHead = r.Header.Clone()
		m.mu.Unlock()
		w.WriteHeader(code)
	}))
	t.Cleanup(m.Close)
	host := strings.TrimPrefix(m.srv.URL, "http://")
	parts := strings.Split(host, ":")
	m.port = parts[len(parts)-1]
	return m
}

func (m *mockSDK) Close() { m.srv.Close() }

func (m *mockSDK) Dials() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.dials
}

func (m *mockSDK) Header() http.Header {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.lastHead == nil {
		return http.Header{}
	}
	return m.lastHead
}

// WaitDial 等待至少 n 次拨号发生。
func (m *mockSDK) WaitDial(t *testing.T, n int, within time.Duration) {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if m.Dials() >= n {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("等待 %d 次拨号超时（实际 %d 次）", n, m.Dials())
}

// NoMoreDial 断言在窗口期内拨号次数不再增长。
func (m *mockSDK) NoMoreDial(t *testing.T, within time.Duration) {
	t.Helper()
	base := m.Dials()
	time.Sleep(within)
	if got := m.Dials(); got != base {
		t.Fatalf("拨号次数不该增长：%d → %d", base, got)
	}
}

func (m *mockSDK) ServeStandard(frames ...any) func(context.Context, *websocket.Conn) {
	return func(ctx context.Context, ws *websocket.Conn) {
		for _, f := range frames {
			writeJSON(ctx, ws, f)
		}
		// 保持连接活着，直到测试结束（同时把客户端写入收进 recv 供断言）
		for {
			_, data, err := ws.Read(ctx)
			if err != nil {
				return
			}
			select {
			case m.recv <- data:
			default:
			}
		}
	}
}

// WaitRecv 等到客户端发来包含 sub 的帧（resync 断言用）。
func (m *mockSDK) WaitRecv(t *testing.T, sub string, within time.Duration) {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		select {
		case got := <-m.recv:
			if strings.Contains(string(got), sub) {
				return
			}
		case <-time.After(20 * time.Millisecond):
		}
	}
	t.Fatalf("等待客户端帧包含 %q 超时", sub)
}

// NoRecv 断言窗口期内客户端没有再写任何东西（resync 限频用）。
func (m *mockSDK) NoRecv(t *testing.T, within time.Duration) {
	t.Helper()
	select {
	case got := <-m.recv:
		t.Fatalf("不该有客户端写入，收到 %s", got)
	case <-time.After(within):
	}
}

func writeJSON(ctx context.Context, ws *websocket.Conn, v any) {
	b, _ := json.Marshal(v)
	// 写超时用调用方 ctx 兜底，避免测试卡死
	wctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_ = ws.Write(wctx, websocket.MessageText, b)
}

// ---------- 事件收集器 ----------

type recorded struct {
	hello    []*HelloFrame
	snapshot []*SnapshotFrame
	cont     []*ContainerEvent
	boot     []*BootEvent
	cstats   [][]ContainerStats
	sstats   []map[string]interface{}
	states   []State
}

type collector struct {
	BaseHandlers
	mu     sync.Mutex
	rec    recorded
	notify chan struct{}
}

func newCollector() *collector { return &collector{notify: make(chan struct{}, 256)} }

// recordState 作为 SetStateReporter 的落地端，记录每次上报（测两级去重）。
func (c *collector) recordState(key string, st State) {
	c.mu.Lock()
	c.rec.states = append(c.rec.states, st)
	c.mu.Unlock()
	c.fire()
}

// states 返回已上报的状态序列。
func (c *collector) states() []State {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]State(nil), c.rec.states...)
}

func (c *collector) fire() {
	select {
	case c.notify <- struct{}{}:
	default:
	}
}

func (c *collector) OnHello(key string, h *HelloFrame) {
	c.mu.Lock()
	c.rec.hello = append(c.rec.hello, h)
	c.mu.Unlock()
	c.fire()
}
func (c *collector) OnSnapshot(key string, f *SnapshotFrame) {
	c.mu.Lock()
	c.rec.snapshot = append(c.rec.snapshot, f)
	c.mu.Unlock()
	c.fire()
}
func (c *collector) OnContainerEvent(key string, ev *ContainerEvent) {
	c.mu.Lock()
	c.rec.cont = append(c.rec.cont, ev)
	c.mu.Unlock()
	c.fire()
}
func (c *collector) OnBootEvent(key string, ev *BootEvent) {
	c.mu.Lock()
	c.rec.boot = append(c.rec.boot, ev)
	c.mu.Unlock()
	c.fire()
}
func (c *collector) OnContainerStats(key string, s []ContainerStats) {
	c.mu.Lock()
	c.rec.cstats = append(c.rec.cstats, s)
	c.mu.Unlock()
	c.fire()
}
func (c *collector) OnSystemStats(key string, d map[string]interface{}) {
	c.mu.Lock()
	c.rec.sstats = append(c.rec.sstats, d)
	c.mu.Unlock()
	c.fire()
}

func (c *collector) snapshot() recorded {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.rec
}

// Wait 等到收集器至少收到 n 条任意回调。
func (c *collector) Wait(t *testing.T, n int, within time.Duration) {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		r := c.snapshot()
		total := len(r.hello) + len(r.snapshot) + len(r.cont) + len(r.boot) + len(r.cstats) + len(r.sstats)
		if total >= n {
			return
		}
		select {
		case <-c.notify:
		case <-time.After(20 * time.Millisecond):
		}
	}
	t.Fatalf("等待 %d 条回调超时，实际 %+v", n, c.snapshot())
}

// ---------- 测试脚手架 ----------

// newTestService 造一个已注入 mock 端口的 Service。
func newTestService(t *testing.T, m *mockSDK) *Service {
	t.Helper()
	s := New()
	s.SetDialPort(m.port)
	return s
}

func helloFixture() map[string]any {
	return map[string]any{
		"type":          FrameHello,
		"proto":         1,
		"sdkVersion":    "v208",
		"serverTime":    1788423148,
		"deviceId":      "r99d3fd5e",
		"deviceVersion": "QL-r1q-2026.v0.8.8.202608110721-v3",
		"model":         "r1q_v3",
	}
}

func snapshotFixture(n int) map[string]any {
	list := make([]map[string]any, 0, n)
	for i := 0; i < n; i++ {
		list = append(list, map[string]any{
			"name":        "c1_" + strings.Repeat("x", 20) + string(rune('A'+i%26)) + itoa(i),
			"status":      "running",
			"id":          itoa(1000 + i),
			"indexNum":    i + 1,
			"ip":          "172.17.0." + itoa(i%250+2),
			"networkName": "bridge",
		})
	}
	return map[string]any{
		"type": FrameSnapshot,
		"seq":  1,
		"data": map[string]any{"count": len(list), "list": list},
	}
}

func eventFixture(seq int64, event, action string, data any) map[string]any {
	return map[string]any{
		"type":     FrameEvent,
		"seq":      seq,
		"event":    event,
		"action":   action,
		"timeNano": 1788423148000000000,
		"data":     data,
	}
}

func itoa(i int) string {
	return strings.TrimSpace(strings.Replace(jsonNumber(i), " ", "", -1))
}

func jsonNumber(i int) string {
	b, _ := json.Marshal(i)
	return string(b)
}
