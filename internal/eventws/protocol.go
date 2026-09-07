// Package eventws 实现 SDK v206+ 设备端 WebSocket 事件通道
// （ws://<设备IP>:8000/ws/events）的客户端。
//
// 分层设计（《事件推送接入方案》§2）：
//
//	protocol.go  帧定义 + 解析 + seq 规则 + action 映射（纯函数，无 IO，单测主战场）
//	client.go    单设备连接：拨号 / 读循环 / 消费循环 / 看门狗 / 退避 / 降级
//	manager.go   按设备管理连接 + 404 降级记忆 + 在线性上报（两级去重）
//
// 本包是纯内部组件：不注册 Wails Service、不暴露任何前端可调用的方法，
// 所有对外可见的效果都由 Handlers 的实现方（集成层）落到既有缓存里。
package eventws

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// 服务端 → 客户端的帧类型（§3.1）
const (
	FrameHello          = "hello"
	FrameSnapshot       = "snapshot"
	FrameEvent          = "event"
	FrameResyncRequired = "resync-required"
)

// 事件域（§3.2）
const (
	EventContainer = "container"
	EventBoot      = "boot"
	EventSystem    = "system"
)

// 事件 action（§3.2）
const (
	ActionCreate   = "create"
	ActionStart    = "start"
	ActionStop     = "stop"
	ActionDie      = "die"
	ActionDestroy  = "destroy"
	ActionOOM      = "oom"
	ActionStats    = "stats"
	ActionQueued   = "queued"
	ActionBooting  = "booting"
	ActionReady    = "ready"
	ActionComplete = "completed"
	ActionTimeout  = "timeout"
	ActionAborted  = "aborted"
	ActionResync   = "resync"
)

// 容器运行状态字符串。与设备 GET /android 响应里 status 字段取值保持一致，
// 集成层直接把它写进缓存，前端按既有取值判断（running / stopped / starting ...）。
const (
	StatusCreated  = "created"
	StatusRunning  = "running"
	StatusStopped  = "stopped"
	StatusStarting = "starting"
)

// State 是 eventws 对设备在线性的判定结果（§5.1）。
//
// 用 int 而非字符串，是为了让本包与宿主仓库的状态表示解耦：
// 集成层负责把它翻译成自己那套字段值（本仓库是 DeviceStatus.Status 字符串）。
type State int

const (
	StateOnline   State = iota // 通道健康：任意数据帧到达
	StateOffline               // 拨号不通 / 看门狗超时 / 读错误 / 403 / 404 降级
	StateAuthFail              // 拨号 401：需要密码，由认证链路管理（心跳不得覆盖）
)

func (s State) String() string {
	switch s {
	case StateOnline:
		return "online"
	case StateAuthFail:
		return "auth_fail"
	default:
		return "offline"
	}
}

// 帧的公共头部，用于第一次探测 type 与 seq
// flexInt 吃下 7 与 "7" 两种写法。
//
// 不是为了防御臆想的怪数据：同一台设备已经在**同一份载荷**里混着写
// （"cputemp":57 旁边就是 "memuse":"13530"，见 realframe_test.go，AsFloat 也是为此存在）。
// 而帧头上任何一个数字字段类型对不上，encoding/json 报的是**整帧**错误：
// 快照被整帧丢弃 → 拿不到 seq 基线 → 之后每个事件都走 notAligned 反复请求 resync
// → 设备每次重发 46KB 又每次被拒；同时 snapshotSeen 永远是 false → Healthy 永远
// 不成立 → REST 兜底永不退休，在线性静默退回探活。一台设备的整个事件通道
// 不该由一个可选计数器的写法决定，所以两种都吃下；真解析不出数字才报错。
type flexInt int64

func (v *flexInt) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		*v = 0
		return nil
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		*v = flexInt(n)
		return nil
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil { // "1.0" 这类写法按截断处理
		*v = flexInt(f)
		return nil
	}
	return fmt.Errorf("数字字段无法解析：%s", string(b))
}

type frameHead struct {
	Type string  `json:"type"`
	Seq  flexInt `json:"seq"`
}

// HelloFrame 是建连第一帧，携带设备身份信息（§3.1）。
//
// deviceId / deviceVersion / model 在 v206 上可能缺省，集成层要容忍空值。
type HelloFrame struct {
	Proto         int    `json:"proto"`
	SDKVersion    string `json:"sdkVersion"`
	ServerTime    int64  `json:"serverTime"`
	DeviceID      string `json:"deviceId"`
	DeviceVersion string `json:"deviceVersion"`
	Model         string `json:"model"`
}

// SnapshotFrame 是建连第二帧 / resync 响应，整体覆盖容器列表（§3.1）。
//
// Data 与设备 GET /android 响应同构（即 /android 的 data 部分：{count, list}），
// 这里保留解析后的 List，集成层可直接据此重建缓存。
type SnapshotFrame struct {
	Seq   int64
	Count int
	List  []map[string]interface{}
}

// AndroidResponse 把快照还原成与 GET /android 完全同构的响应体。
//
// 本仓库的容器缓存存的是 /android 的**整个响应**（见 pollSingleDevice），
// 下游（截图任务、RPA、前端解析）都按 {code,data:{list}} 或 {list} 或裸数组解析，
// 所以事件路径必须造出一样的形状，否则前端要改代码。
//
// list 必须落成 []interface{}：那是 json.Unmarshal 到 interface{} 的固有形状，
// 下游清一色写的是 data["list"].([]interface{})，换成
// []map[string]interface{} 会静默断言失败 —— 截图抓不到、补丁找不到容器，
// 而且不报错，只是"数据没了"。
func (f *SnapshotFrame) AndroidResponse() map[string]interface{} {
	list := make([]interface{}, 0, len(f.List))
	for _, cm := range f.List {
		list = append(list, cm)
	}
	return map[string]interface{}{
		"code": float64(0),
		"data": map[string]interface{}{
			"count": float64(f.Count),
			"list":  list,
		},
	}
}

// EventFrame 是增量事件（§3.1）。Data 按 Event/Action 二次解析。
type EventFrame struct {
	Seq      int64
	Event    string
	Action   string
	TimeNano int64
	Data     json.RawMessage
}

// Frame 是一条已解析的服务端帧。Type 决定哪个子字段非空。
type Frame struct {
	Type     string
	Seq      int64
	Hello    *HelloFrame
	Snapshot *SnapshotFrame
	Event    *EventFrame
}

// ParseFrame 解析一条文本帧。
//
// 未知 type 返回 (nil, nil)：前向兼容，静默忽略新增帧类型（§4.1），
// 调用方不要把 nil 当错误。
func ParseFrame(raw []byte) (*Frame, error) {
	var h frameHead
	if err := json.Unmarshal(raw, &h); err != nil {
		return nil, fmt.Errorf("解析帧头失败: %w", err)
	}

	switch h.Type {
	case FrameHello:
		var f HelloFrame
		if err := json.Unmarshal(raw, &f); err != nil {
			return nil, fmt.Errorf("解析 hello 失败: %w", err)
		}
		return &Frame{Type: h.Type, Hello: &f}, nil

	case FrameSnapshot:
		var wire struct {
			Seq  flexInt         `json:"seq"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(raw, &wire); err != nil {
			return nil, fmt.Errorf("解析 snapshot 失败: %w", err)
		}
		f := &SnapshotFrame{Seq: int64(wire.Seq)}
		if len(wire.Data) > 0 {
			var data struct {
				Count flexInt                  `json:"count"`
				List  []map[string]interface{} `json:"list"`
			}
			if err := json.Unmarshal(wire.Data, &data); err != nil {
				return nil, fmt.Errorf("解析 snapshot.data 失败: %w", err)
			}
			f.Count, f.List = int(data.Count), data.List
			if f.Count == 0 {
				f.Count = len(f.List)
			}
		}
		return &Frame{Type: h.Type, Seq: f.Seq, Snapshot: f}, nil

	case FrameEvent:
		var wire struct {
			Seq      flexInt         `json:"seq"`
			Event    string          `json:"event"`
			Action   string          `json:"action"`
			TimeNano flexInt         `json:"timeNano"`
			Data     json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(raw, &wire); err != nil {
			return nil, fmt.Errorf("解析 event 失败: %w", err)
		}
		f := &EventFrame{
			Seq:      int64(wire.Seq),
			Event:    wire.Event,
			Action:   wire.Action,
			TimeNano: int64(wire.TimeNano),
			Data:     wire.Data,
		}
		return &Frame{Type: h.Type, Seq: f.Seq, Event: f}, nil

	case FrameResyncRequired:
		return &Frame{Type: h.Type}, nil

	default:
		return nil, nil
	}
}

// ContainerEvent 是 container 生命周期事件的 data（单对象，§3.2）。
//
// 设备侧容器身份在本仓库以 name 为主键（投屏/RPA/重启/删除都按 name 查），
// ID 只作辅助：两者都带上，由集成层决定用哪个。
type ContainerEvent struct {
	Action string
	Name   string
	ID     string
	Status string // 事件自带 status 时优先用它，否则由 action 映射
	Raw    map[string]interface{}
}

// ParseContainerEventData 把 container 事件 data 解析成单个容器对象。
func ParseContainerEventData(f *EventFrame) (*ContainerEvent, error) {
	raw, err := unmarshalObject(f.Data)
	if err != nil {
		return nil, fmt.Errorf("解析 container 事件失败: %w", err)
	}
	return &ContainerEvent{
		Action: f.Action,
		Name:   firstString(raw, "name", "containerName", "container_name"),
		ID:     firstString(raw, "id", "containerId", "container_id", "dockerId"),
		Status: firstString(raw, "status", "state"),
		Raw:    raw,
	}, nil
}

// BootEvent 是 boot 事件的 data（开机过程，§3.2）。
//
// 开机时容器可能还没进快照，所以坑位号（indexNum）和镜像名也带上，
// 集成层在查不到容器名时可以用它们定位。
type BootEvent struct {
	Action    string
	Name      string
	ID        string
	IndexNum  int
	ImageName string
	Raw       map[string]interface{}
}

// ParseBootEventData 把 boot 事件 data 解析成对象。
func ParseBootEventData(f *EventFrame) (*BootEvent, error) {
	raw, err := unmarshalObject(f.Data)
	if err != nil {
		return nil, fmt.Errorf("解析 boot 事件失败: %w", err)
	}
	idx, _ := AsInt(raw["indexNum"], raw["index"])
	return &BootEvent{
		Action:    f.Action,
		Name:      firstString(raw, "name", "containerName", "container_name"),
		ID:        firstString(raw, "id", "containerId", "container_id"),
		IndexNum:  idx,
		ImageName: firstString(raw, "imageName", "image", "imageVersion"),
		Raw:       raw,
	}, nil
}

// ContainerStats 是 container/stats 事件里单个容器的指标（§3.2）。
//
// 注意 container/stats 的 data 是**数组**，一次事件带全容器。
type ContainerStats struct {
	Name      string
	ID        string
	CPUUsage  float64
	MemUsage  float64
	DiskUsage float64
	Raw       map[string]interface{}
}

// ParseContainerStatsData 解析 container/stats 的数组 data。
// 设备若退化成单对象也能解析（容忍 array 与 object 两种形状）。
func ParseContainerStatsData(f *EventFrame) ([]ContainerStats, error) {
	items, err := unmarshalObjects(f.Data)
	if err != nil {
		return nil, fmt.Errorf("解析 container/stats 失败: %w", err)
	}
	out := make([]ContainerStats, 0, len(items))
	for _, raw := range items {
		cpu, _ := AsFloat(firstAny(raw, "cpuUsage", "cpu_usage", "cpu"))
		mem, _ := AsFloat(firstAny(raw, "memUsage", "mem_usage", "memory", "memoryUsage"))
		disk, _ := AsFloat(firstAny(raw, "diskUsage", "disk_usage", "disk"))
		out = append(out, ContainerStats{
			Name:      firstString(raw, "name", "containerName", "container_name"),
			ID:        firstString(raw, "id", "containerId", "container_id"),
			CPUUsage:  cpu,
			MemUsage:  mem,
			DiskUsage: disk,
			Raw:       raw,
		})
	}
	return out, nil
}

// ParseSystemStatsData 解析 system/stats 的 data。
//
// 字段与 GET /info/device 的 data 同构（cpuload / memuse / mmctotal ...），
// 原样交给集成层，由它复用既有 REST 解析逻辑，保证语义完全一致。
func ParseSystemStatsData(f *EventFrame) (map[string]interface{}, error) {
	raw, err := unmarshalObject(f.Data)
	if err != nil {
		return nil, fmt.Errorf("解析 system/stats 失败: %w", err)
	}
	return raw, nil
}

// ContainerActionToStatus 把 container action 映射为容器状态（§3.2）。
//
// 返回空字符串表示该 action 不改状态（oom 只告警；未知 action 保守不动）。
// destroy 的语义是"从缓存移除"，由 RemoveOnDestroy 单独表达，不在此处编状态。
func ContainerActionToStatus(action string) string {
	switch action {
	case ActionCreate:
		return StatusCreated
	case ActionStart:
		return StatusRunning
	case ActionStop, ActionDie:
		return StatusStopped
	default:
		return ""
	}
}

// RemoveOnDestroy 报告该 container action 是否意味着容器已从设备上消失。
func RemoveOnDestroy(action string) bool {
	return action == ActionDestroy
}

// BootActionToStatus 把 boot action 映射为容器状态（§3.2）。
//
// completed / timeout / ready 都落到 running：boot 只是过程展示，
// 容器是否真的活着由随后的 container 事件（最终真相）与快照校正。
func BootActionToStatus(action string) string {
	switch action {
	case ActionQueued, ActionBooting:
		return StatusStarting
	case ActionComplete, ActionTimeout, ActionReady:
		return StatusRunning
	case ActionAborted:
		return StatusStopped
	default:
		return ""
	}
}

// seqVerdict 是 seq 检查的结论。
type seqVerdict int

const (
	verdictApply      seqVerdict = iota // 正常应用
	verdictDuplicate                    // seq <= last，重复帧，丢弃
	verdictGap                          // 断档：应用 + 主动 resync 拉新快照（§3.4）
	verdictNotAligned                   // 还没收到过快照：应用 + resync 取基线
)

// seqTracker 每连接一份，只被消费 goroutine 串行调用，因此无锁。
//
// 规则（§3.4）：hello 清空对齐状态；snapshot 设基线；event 连续性检查。
// 快照不带 seq 时降级成"只应用不判连续性"（见 stampless）。
// stats 缺口不做豁免 —— resync 限频 10s、响应 3ms、快照幂等，代价可忽略。
type seqTracker struct {
	lastSeq    int64
	hasBasline bool
	// stampless 为真表示这台设备的快照不带 seq，于是"下一个事件该是几号"无从谈起。
	stampless bool
}

func (t *seqTracker) onHello() {
	t.lastSeq = 0
	t.hasBasline = false
	t.stampless = false
}

// onSnapshot 用快照的 seq 立基线。
//
// 两种形状必须挡掉，否则"数据其实一直在动"的连接会被我们自己判成永久丢帧：
//
//   - seq <= 0：协议允许快照不带 seq（字段缺失 → flexInt 读 0）。拿 0 当基线，
//     下一个正常事件（seq=57）必然算断档 → 请求 resync → 设备又回一份不带 seq 的
//     快照 → 再断档，每 10s（限频）一轮，永远收敛不了。改判 stampless：照常应用、
//     不做连续性检查，也不再回头要基线。
//   - seq 比已经应用过的事件还小：把基线拉回去，等于让之后每个事件都跳号。同一连接
//     内 seq 单调是 §3.4 给的保证（设备重启后计数归零那一路必然伴随重连，而 hello
//     已经把这里清干净了），所以基线只许朝前走。
func (t *seqTracker) onSnapshot(seq int64) {
	if seq <= 0 {
		t.stampless = true
		return
	}
	t.stampless = false
	t.hasBasline = true
	if seq > t.lastSeq {
		t.lastSeq = seq
	}
}

func (t *seqTracker) onEvent(seq int64) seqVerdict {
	if t.stampless {
		// 没有可信基线：去重和连续性都免谈，一律应用。设备连事件的 seq 都不打时，
		// 按 seq 去重会把每一帧都当成重复帧静默吞掉 —— 那才是真把数据弄没了。
		if seq > t.lastSeq {
			t.lastSeq = seq
		}
		return verdictApply
	}
	if !t.hasBasline {
		return verdictNotAligned
	}
	switch {
	case seq <= t.lastSeq:
		return verdictDuplicate
	case seq == t.lastSeq+1:
		t.lastSeq = seq
		return verdictApply
	default:
		// 断档：仍然应用（不能为了保序卡住实时性），同时请求 resync
		t.lastSeq = seq
		return verdictGap
	}
}

// AsFloat 把 JSON 解析出的值转成 float64，兼容数字与字符串两种写法
// （设备端 /info/device 的字段全是字符串，stats 事件里是数字，必须双兼容）。
func AsFloat(vals ...interface{}) (float64, bool) {
	for _, v := range vals {
		switch n := v.(type) {
		case nil:
			continue
		case float64:
			return n, true
		case float32:
			return float64(n), true
		case int:
			return float64(n), true
		case int64:
			return float64(n), true
		case json.Number:
			if f, err := n.Float64(); err == nil {
				return f, true
			}
		case string:
			if s := strings.TrimSpace(n); s != "" {
				if f, err := strconv.ParseFloat(s, 64); err == nil {
					return f, true
				}
			}
		}
	}
	return 0, false
}

// AsInt 兼容数字/字符串转 int。
func AsInt(vals ...interface{}) (int, bool) {
	if f, ok := AsFloat(vals...); ok {
		return int(f), true
	}
	return 0, false
}

func unmarshalObject(raw json.RawMessage) (map[string]interface{}, error) {
	if len(raw) == 0 {
		return map[string]interface{}{}, nil
	}
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	if m == nil {
		m = map[string]interface{}{}
	}
	return m, nil
}

func unmarshalObjects(raw json.RawMessage) ([]map[string]interface{}, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var arr []map[string]interface{}
	if err := json.Unmarshal(raw, &arr); err == nil {
		return arr, nil
	}
	// 容忍单对象
	one, err := unmarshalObject(raw)
	if err != nil {
		return nil, err
	}
	return []map[string]interface{}{one}, nil
}

func firstString(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func firstAny(m map[string]interface{}, keys ...string) interface{} {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			return v
		}
	}
	return nil
}
