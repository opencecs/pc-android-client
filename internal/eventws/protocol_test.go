package eventws

import (
	"encoding/json"
	"strings"
	"testing"
)

// ---------- 帧解析（真实帧 fixture，§3.1）----------

func TestParseHello(t *testing.T) {
	// 10.10.5.202 / SDK v208 实测帧（方案 §3.1）
	raw := `{"type":"hello","proto":1,"sdkVersion":"v208","serverTime":1788423148,` +
		`"deviceId":"r99d3fd5e1234","deviceVersion":"QL-r1q-2026.v0.8.8.202608110721-v3","model":"r1q_v3"}`

	f, err := ParseFrame([]byte(raw))
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if f.Type != FrameHello || f.Hello == nil {
		t.Fatalf("帧类型错：%+v", f)
	}
	h := f.Hello
	if h.Proto != 1 || h.SDKVersion != "v208" || h.ServerTime != 1788423148 {
		t.Fatalf("公共字段错：%+v", h)
	}
	if h.DeviceID != "r99d3fd5e1234" || h.Model != "r1q_v3" ||
		h.DeviceVersion != "QL-r1q-2026.v0.8.8.202608110721-v3" {
		t.Fatalf("身份字段错：%+v", h)
	}
}

func TestParseHelloToleratesMissingIdentity(t *testing.T) {
	// v206 上 deviceId/deviceVersion/model 可能缺省，集成层要容忍空值
	f, err := ParseFrame([]byte(`{"type":"hello","proto":1,"sdkVersion":"v206","serverTime":1}`))
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if f.Hello.DeviceID != "" || f.Hello.Model != "" {
		t.Fatalf("缺省字段应为空：%+v", f.Hello)
	}
}

func TestParseSnapshotAndAndroidResponse(t *testing.T) {
	raw, _ := json.Marshal(snapshotFixture(3))
	f, err := ParseFrame(raw)
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	s := f.Snapshot
	if s == nil {
		t.Fatalf("snapshot 为空：%+v", f)
	}
	if f.Seq != 1 || s.Seq != 1 {
		t.Fatalf("seq 错：frame=%d snap=%d", f.Seq, s.Seq)
	}
	if s.Count != 3 || len(s.List) != 3 {
		t.Fatalf("count/list 错：%d / %d", s.Count, len(s.List))
	}
	if got, _ := s.List[0]["status"].(string); got != StatusRunning {
		t.Fatalf("容器字段丢失： %+v", s.List[0])
	}

	// 与 GET /android 响应同构：下游（截图/RPA/前端）按 {code,data:{list}} 解析
	body := s.AndroidResponse()
	if code, _ := AsFloat(body["code"]); code != 0 {
		t.Fatalf("code 错：%v", body["code"])
	}
	data, _ := body["data"].(map[string]interface{})
	if data == nil {
		t.Fatalf("缺 data：%v", body)
	}
	list, ok := data["list"].([]interface{})
	if !ok {
		t.Fatalf("data.list 必须是 []interface{}：下游（截图/RPA/extractContainersFromCache）\n"+
			"一律断言这个形状，别的类型会静默拿到空列表：%#v", data["list"])
	}
	if len(list) != 3 {
		t.Fatalf("data.list 错：%v", data["list"])
	}
	if cm, _ := list[0].(map[string]interface{}); cm == nil {
		t.Fatalf("列表元素应是解析后的容器对象：%#v", list[0])
	}
	if cnt, _ := AsFloat(data["count"]); cnt != 3 {
		t.Fatalf("data.count 错：%v", data["count"])
	}
}

func TestParseSnapshotEmptyListNotNil(t *testing.T) {
	f := &SnapshotFrame{Seq: 7} // List == nil
	body := f.AndroidResponse()
	data, _ := body["data"].(map[string]interface{})
	list, ok := data["list"].([]interface{})
	if !ok || list == nil || len(list) != 0 {
		t.Fatalf("空快照必须还原成非 nil 的 []interface{}（前端 .map 不能炸，下游形状断言不能落空）：%#v", data["list"])
	}
}

func TestParseSnapshotCountDerivedFromList(t *testing.T) {
	raw := []byte(`{"type":"snapshot","seq":9,"data":{"list":[{"name":"a","status":"running"}]}}`)
	f, err := ParseFrame(raw)
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if f.Snapshot.Count != 1 {
		t.Fatalf("data.count 缺省时应用 len(list)：%d", f.Snapshot.Count)
	}
}

func TestParseEventKeepsRawData(t *testing.T) {
	raw, _ := json.Marshal(eventFixture(12, EventContainer, ActionStart,
		map[string]any{"name": "c1_A", "id": "abc", "status": "running"}))
	f, err := ParseFrame(raw)
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	e := f.Event
	if e == nil {
		t.Fatalf("event 为空")
	}
	if f.Seq != 12 || e.Seq != 12 {
		t.Fatalf("seq 错：%d/%d", f.Seq, e.Seq)
	}
	if e.Event != EventContainer || e.Action != ActionStart {
		t.Fatalf("event/action 错：%s/%s", e.Event, e.Action)
	}
	if e.TimeNano != 1788423148000000000 {
		t.Fatalf("timeNano 错：%d", e.TimeNano)
	}

	ev, err := ParseContainerEventData(e)
	if err != nil {
		t.Fatalf("container data 解析失败：%v", err)
	}
	if ev.Name != "c1_A" || ev.ID != "abc" || ev.Status != "running" || ev.Action != ActionStart {
		t.Fatalf("容器事件字段错：%+v", ev)
	}
}

// TestParseFrameToleratesStringTypedScalars 钉住 flexInt 的存在理由。
//
// 现场的同一次采集里就同时有 "cputemp":57 和 "memuse":"13530"（见 realframe_test.go），
// 所以"设备哪天把 seq/count 写成字符串"不是臆想。代价极不对称：一个可选字段的
// 写法能让 encoding/json 判**整帧**失败，于是快照收不到 → 没有 seq 基线 →
// 每个事件都请求 resync → 设备反复重发 46KB；同时 snapshotSeen 一直 false →
// Healthy 永不成立 → REST 兜底永不退休，在线性还静默退回探活。
func TestParseFrameToleratesStringTypedScalars(t *testing.T) {
	cases := []struct {
		name     string
		raw      string
		wantSeq  int64
		wantCt   int
		wantNano int64
	}{
		{"数字写法（现状）", `{"type":"snapshot","seq":7,"data":{"count":1,"list":[{"name":"/c1"}]}}`, 7, 1, 0},
		{"seq 带引号", `{"type":"snapshot","seq":"7","data":{"count":"1","list":[{"name":"/c1"}]}}`, 7, 1, 0},
		{"count 小数写法", `{"type":"snapshot","seq":"3","data":{"count":"2.0","list":[{"name":"/c1"}]}}`, 3, 2, 0},
		{"event seq/timeNano 带引号", `{"type":"event","seq":"9","event":"container","action":"die","timeNano":"123","data":{"name":"/c1"}}`, 9, 0, 123},
	}
	for _, tc := range cases {
		f, err := ParseFrame([]byte(tc.raw))
		if err != nil || f == nil {
			t.Fatalf("%s：整帧被丢弃 err=%v f=%v", tc.name, err, f)
		}
		if f.Seq != tc.wantSeq {
			t.Fatalf("%s：seq=%d，期望 %d", tc.name, f.Seq, tc.wantSeq)
		}
		if f.Snapshot != nil && f.Snapshot.Count != tc.wantCt {
			t.Fatalf("%s：count=%d，期望 %d", tc.name, f.Snapshot.Count, tc.wantCt)
		}
		if f.Event != nil && f.Event.TimeNano != tc.wantNano {
			t.Fatalf("%s：timeNano=%d，期望 %d", tc.name, f.Event.TimeNano, tc.wantNano)
		}
	}

	// 真不是数字的仍然要报错：静默当 0 会让 seq 记账错得更难查
	if _, err := ParseFrame([]byte(`{"type":"snapshot","seq":"abc","data":{"list":[]}}`)); err == nil {
		t.Fatalf("非数字 seq 该报错，而不是当成 0")
	}
}

func TestParseResyncRequired(t *testing.T) {
	f, err := ParseFrame([]byte(`{"type":"resync-required"}`))
	if err != nil || f == nil {
		t.Fatalf("解析失败：%v %+v", err, f)
	}
	if f.Type != FrameResyncRequired {
		t.Fatalf("类型错：%s", f.Type)
	}
}

func TestParseUnknownTypeIsNilNotError(t *testing.T) {
	// 前向兼容：新增帧类型必须静默忽略，不能当错误（§4.1）
	f, err := ParseFrame([]byte(`{"type":"device-upgraded","seq":3}`))
	if err != nil {
		t.Fatalf("未知类型不该报错：%v", err)
	}
	if f != nil {
		t.Fatalf("未知类型该返回 nil：%+v", f)
	}
}

func TestParseMalformedReturnsError(t *testing.T) {
	if _, err := ParseFrame([]byte(`{`)); err == nil {
		t.Fatalf("坏 JSON 该报错")
	}
	if _, err := ParseFrame([]byte(`{"type":"snapshot","data":{"list":123}}`)); err == nil {
		t.Fatalf("snapshot.data 形状不对该报错")
	}
}

// ---------- 事件 data 解析 ----------

func TestParseContainerStatsArray(t *testing.T) {
	// container/stats 的 data 是数组，一次带全部容器（§3.2）
	raw, _ := json.Marshal([]map[string]any{
		{"name": "a", "id": "1", "cpuUsage": 12.5, "memUsage": 30, "diskUsage": "71.5"},
		{"name": "b", "id": "2", "cpu": "3.25", "memory": "40.5", "disk": 50},
	})
	f := &EventFrame{Event: EventContainer, Action: ActionStats, Data: raw}

	stats, err := ParseContainerStatsData(f)
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if len(stats) != 2 {
		t.Fatalf("条数错：%d", len(stats))
	}
	if stats[0].Name != "a" || stats[0].CPUUsage != 12.5 || stats[0].MemUsage != 30 || stats[0].DiskUsage != 71.5 {
		t.Fatalf("第一条错：%+v", stats[0])
	}
	// 字段名与数字/字符串写法都要兼容
	if stats[1].Name != "b" || stats[1].CPUUsage != 3.25 || stats[1].MemUsage != 40.5 || stats[1].DiskUsage != 50 {
		t.Fatalf("第二条错：%+v", stats[1])
	}
}

func TestParseContainerStatsToleratesSingleObject(t *testing.T) {
	raw := []byte(`{"name":"a","cpuUsage":1}`)
	f := &EventFrame{Action: ActionStats, Data: raw}
	stats, err := ParseContainerStatsData(f)
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if len(stats) != 1 || stats[0].Name != "a" || stats[0].CPUUsage != 1 {
		t.Fatalf("退化单对象没兜住：%+v", stats)
	}
}

func TestParseBootEvent(t *testing.T) {
	// 开机时容器可能还没进快照，indexNum / imageName 要带上（§3.2）
	raw := []byte(`{"containerName":"c1_7","indexNum":"7","imageName":"myt:1.2.3"}`)
	ev, err := ParseBootEventData(&EventFrame{Action: ActionBooting, Data: raw})
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if ev.Name != "c1_7" || ev.IndexNum != 7 || ev.ImageName != "myt:1.2.3" || ev.Action != ActionBooting {
		t.Fatalf("boot 字段错：%+v", ev)
	}
}

func TestParseEventDataEmptyIsSafe(t *testing.T) {
	ev, err := ParseContainerEventData(&EventFrame{Action: ActionOOM})
	if err != nil {
		t.Fatalf("空 data 不该报错：%v", err)
	}
	if ev == nil || ev.Name != "" {
		t.Fatalf("空 data 该给空对象：%+v", ev)
	}
}

func TestParseSystemStatsKeepsDeviceShape(t *testing.T) {
	// 字段与 GET /info/device 的 data 同构，原样交给集成层复用 REST 解析
	raw := []byte(`{"cpuload":"3.5","memuse":"1024","mmctotal":"58C00000"}`)
	data, err := ParseSystemStatsData(&EventFrame{Action: ActionStats, Data: raw})
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if data["cpuload"] != "3.5" || data["mmctotal"] != "58C00000" {
		t.Fatalf("字段被改写了：%v", data)
	}
}

// ---------- action → 状态映射（§3.2）----------

func TestContainerActionToStatus(t *testing.T) {
	cases := map[string]string{
		ActionCreate:  StatusCreated,
		ActionStart:   StatusRunning,
		ActionStop:    StatusStopped,
		ActionDie:     StatusStopped,
		ActionOOM:     "", // 只告警，不改状态
		ActionDestroy: "", // 移除语义由 RemoveOnDestroy 表达
		"whatever":    "", // 未知 action 保守不动
	}
	for action, want := range cases {
		if got := ContainerActionToStatus(action); got != want {
			t.Fatalf("%s → %q，期望 %q", action, got, want)
		}
	}
	if !RemoveOnDestroy(ActionDestroy) {
		t.Fatalf("destroy 该标记移除")
	}
	if RemoveOnDestroy(ActionStop) || RemoveOnDestroy("") {
		t.Fatalf("其他 action 不该标记移除")
	}
}

func TestBootActionToStatus(t *testing.T) {
	cases := map[string]string{
		ActionQueued:   StatusStarting,
		ActionBooting:  StatusStarting,
		ActionComplete: StatusRunning,
		ActionTimeout:  StatusRunning,
		ActionReady:    StatusRunning,
		ActionAborted:  StatusStopped,
		ActionResync:   "",
	}
	for action, want := range cases {
		if got := BootActionToStatus(action); got != want {
			t.Fatalf("%s → %q，期望 %q", action, got, want)
		}
	}
}

// ---------- seq 规则矩阵（§3.4）----------

func TestSeqTrackerRules(t *testing.T) {
	var tr seqTracker

	// 没基线就来事件：应用 + 补一次 resync 取基线
	if v := tr.onEvent(5); v != verdictNotAligned {
		t.Fatalf("未对齐判定错：%d", v)
	}
	if tr.hasBasline {
		t.Fatalf("onEvent 不该擅自立基线")
	}

	tr.onSnapshot(1) // 基线 = 1
	for _, step := range []struct {
		seq  int64
		want seqVerdict
	}{
		{2, verdictApply},     // 连续
		{3, verdictApply},     // 连续
		{3, verdictDuplicate}, // 重放
		{2, verdictDuplicate}, // 倒退
		{7, verdictGap},       // 断档：仍应用
		{8, verdictApply},     // 断档后继续（last 已被推进到 7）
	} {
		if got := tr.onEvent(step.seq); got != step.want {
			t.Fatalf("seq=%d 判定 %d，期望 %d", step.seq, got, step.want)
		}
	}
	if tr.lastSeq != 8 {
		t.Fatalf("lastSeq 应为 8：%d", tr.lastSeq)
	}
}

func TestSeqTrackerHelloResetsAlignment(t *testing.T) {
	tr := &seqTracker{}
	tr.onSnapshot(10)
	tr.onEvent(11)
	tr.onHello() // 新连接重新对齐

	if tr.lastSeq != 0 || tr.hasBasline {
		t.Fatalf("hello 该清空对齐状态：%+v", tr)
	}
	if v := tr.onEvent(1); v != verdictNotAligned {
		t.Fatalf("hello 后该重新要基线：%d", v)
	}
}

func TestSeqTrackerSnapshotRebindelines(t *testing.T) {
	// resync 响应把基线拉到新快照的 seq，之后旧 seq 的事件按重复丢弃
	tr := &seqTracker{}
	tr.onSnapshot(1)
	tr.onEvent(5) // 断档，last=5
	tr.onSnapshot(100)
	if v := tr.onEvent(5); v != verdictDuplicate {
		t.Fatalf("旧快照时代的 seq 该丢弃：%d", v)
	}
	if v := tr.onEvent(101); v != verdictApply {
		t.Fatalf("新基线后该正常应用：%d", v)
	}
}

// 快照不带 seq（协议允许字段缺失 → flexInt 读 0）时必须降级，不能拿 0 当基线。
//
// 拿 0 当基线的后果是每 10s 一轮 resync 的死循环：正常事件 seq=57 算断档 → 请求
// resync → 设备回一份同样不带 seq 的快照 → 基线又归 0 → 下一个事件又断档。数据
// 其实一直是全的，被我们自己判成"永久丢帧"，还顺手把 resync 限频器长期占住。
func TestSeqTrackerSnapshotWithoutSeqDegradesGracefully(t *testing.T) {
	tr := &seqTracker{}
	tr.onSnapshot(0)
	if !tr.stampless {
		t.Fatalf("不带 seq 的快照该标记成 stampless：%+v", tr)
	}
	// 不判连续性，也不回头要基线（要了也是白要），一律应用
	for _, seq := range []int64{57, 58, 99} {
		if v := tr.onEvent(seq); v != verdictApply {
			t.Fatalf("stampless 下 seq=%d 不该被判成断档/未对齐：%d", seq, v)
		}
	}
	// 连事件都不打 seq 的设备：按 seq 去重会把每一帧静默吞掉，必须照样应用
	for i := 0; i < 3; i++ {
		if v := tr.onEvent(0); v != verdictApply {
			t.Fatalf("stampless 下 seq=0 的帧被判成重复帧（数据整片消失）：%d", v)
		}
	}

	// 设备升级成带 seq 的快照后：基线重新立起来，连续性检查与去重都回归
	tr.onSnapshot(200)
	if tr.stampless || tr.lastSeq != 200 {
		t.Fatalf("带 seq 的快照该退出 stampless 并重立基线：%+v", tr)
	}
	if v := tr.onEvent(201); v != verdictApply {
		t.Fatalf("重立基线后该正常应用：%d", v)
	}
	if v := tr.onEvent(201); v != verdictDuplicate {
		t.Fatalf("退出 stampless 后该恢复去重：%d", v)
	}
}

// 快照的 seq 比已经应用过的事件还小（旧缓存 / 计数回绕）时不许把基线拉回去：
// 拉回去之后每个后续事件都跳号，又是一轮 resync 循环。同一连接内 seq 单调是
// §3.4 给的保证；设备重启后计数归零那一路必然伴随重连，而 hello 已经清过这里。
func TestSeqTrackerSnapshotNeverRegressesBaseline(t *testing.T) {
	tr := &seqTracker{}
	tr.onSnapshot(100)
	if v := tr.onEvent(101); v != verdictApply {
		t.Fatalf("连续事件该应用：%d", v)
	}

	tr.onSnapshot(50) // 迟到的 / 旧的快照
	if tr.lastSeq != 101 {
		t.Fatalf("基线被旧快照拉回去了：%d", tr.lastSeq)
	}
	if v := tr.onEvent(102); v != verdictApply {
		t.Fatalf("一份旧快照不该让之后的正常事件全变成断档：%d", v)
	}
}

// ---------- 数值兼容（设备端字段全是字符串，stats 事件是数字）----------

func TestAsFloatFlex(t *testing.T) {
	if v, ok := AsFloat(nil, "  12.5 "); !ok || v != 12.5 {
		t.Fatalf("字符串数字错：%v %v", v, ok)
	}
	if v, ok := AsFloat(json.Number("7")); !ok || v != 7 {
		t.Fatalf("json.Number 错：%v %v", v, ok)
	}
	if v, ok := AsFloat(int64(9), "ignored"); !ok || v != 9 {
		t.Fatalf("int64 错：%v %v", v, ok)
	}
	if _, ok := AsFloat("", nil, "abc"); ok {
		t.Fatalf("空串与非数字串都该失败，取不到值")
	}
	if v, ok := AsFloat(nil, 3); !ok || v != 3 {
		t.Fatalf("应跳过 nil 取后面的值：%v %v", v, ok)
	}
	if v, ok := AsInt("42.9"); !ok || v != 42 {
		t.Fatalf("AsInt 截断错：%v %v", v, ok)
	}
}

func TestStateString(t *testing.T) {
	if StateOnline.String() != "online" || StateOffline.String() != "offline" ||
		StateAuthFail.String() != "auth_fail" {
		t.Fatalf("State 字符串错")
	}
}

// ---------- 地址工具（密码纯 IP 契约的地基）----------

func TestDeviceIPOfAndEnsurePort(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"10.10.5.202", "10.10.5.202"},
		{"10.10.5.202:8000", "10.10.5.202"},
		{"1.2.3.4:8187", "1.2.3.4"},
		{"", ""},
		{"[fe80::1]", "fe80::1"},
	} {
		if got := deviceIPOf(c.in); got != c.want {
			t.Fatalf("deviceIPOf(%q)=%q，期望 %q", c.in, got, c.want)
		}
	}
	for _, c := range []struct{ in, want string }{
		{"10.10.5.202", "10.10.5.202:8000"},
		{"10.10.5.202:8187", "10.10.5.202:8187"}, // 已含端口不覆盖
	} {
		if got := ensurePort(c.in, "8000"); got != c.want {
			t.Fatalf("ensurePort(%q)=%q，期望 %q", c.in, got, c.want)
		}
	}
}

func TestEventPathMatchesProtocol(t *testing.T) {
	// 真机协议路径就是 /ws/events，写错会全部 404 降级（看着像"设备不支持"）
	if eventPath != "/ws/events" {
		t.Fatalf("eventPath=%q", eventPath)
	}
	if got := "ws://10.10.5.202:8000" + eventPath; !strings.HasSuffix(got, ":8000/ws/events") {
		t.Fatalf("URL 拼接错：%s", got)
	}
}
