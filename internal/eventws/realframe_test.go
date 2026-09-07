package eventws

import (
	"encoding/json"
	"testing"
	"time"
)

// 这里的四条帧是 2026-09-03 从真机 10.10.5.202（SDK v208 / r1q_v3）上抓下来的原文，
// 只把 snapshot 的 39 个容器裁到 2 个（单个容器对象约 1.2KB，全量不利于 review）。
//
// 固化真实形状的原因：字段名以"看着像"来写最容易全线静默失效 ——
// 比如 container/stats 的元素用 containerId 而不是 id，解析漏了就是不报错地拿不到指标。

const realHello = `{"type":"hello","proto":1,"sdkVersion":"v208","serverTime":1788426715,` +
	`"deviceId":"r99d3fd5e79c313c18fc4a8f5f96847e",` +
	`"deviceVersion":"QL-r1q-2026.v0.8.8.202608110721-v3","model":"r1q_v3"}`

const realSnapshot = `{"type":"snapshot","seq":590,"data":{"count":2,"list":[` +
	`{"id":"59bed0ef8a08e53b1fce4d373980b798468a0f14c1c86894af776b9e465f575e",` +
	`"name":"1788404629504_7_1","status":"created","androidType":"V3","indexNum":2,` +
	`"dataPath":"/mmc/data/1788404629504_7_1_2_1788418122634","modelPath":"SM-F7660_16",` +
	`"image":"registry.cn-guangzhou.aliyuncs.com/mytos/dobox:Q16_v3_all_202608101107",` +
	`"ip":"","networkName":"",` +
	`"portBindings":{"5555/tcp":[{"HostIp":"","HostPort":"30100"}]},` +
	`"dns":"223.5.5.5","created":"2026-09-03 14:48:42","started":"-","adbPort":5555,` +
	`"deviceId":"r99d3fd5e79c313c18fc4a8f5f96847e","cpuUsage":0,"memUsage":0,"diskUsage":0},` +
	`{"id":"5dd3a772ffb83f70c2aeb8db06ee2d02ba4c304b7e30ecdbe9ae5fb396604799",` +
	`"name":"1788405908032_6_1","status":"running","androidType":"V3","indexNum":6,` +
	`"ip":"10.10.5.202","adbPort":5555,"cpuUsage":3.0456852793425645,"memUsage":1.2,"diskUsage":0}` +
	`]}}`

// system/stats：数值大多是字符串，cputemp 却是裸数字，两种都得吃下。
const realSystemStats = `{"type":"event","seq":591,"event":"system","action":"stats",` +
	`"timeNano":1788426725469877429,` +
	`"data":{"cputemp":57,"cpuload":"82%","memuse":"13530","mmctotal":"476519",` +
	`"mmcuse":"46601","mmcread":"93.37GB","mmcwrite":"133.68GB","sysuptime":"111492s","mmctemp":"29"}}`

// container/stats：整设备一次批量下发，元素键是 containerId（不是 id）。
const realContainerStats = `{"type":"event","seq":592,"event":"container","action":"stats",` +
	`"timeNano":1788426725469899887,"data":[` +
	`{"containerId":"59bed0ef8a08e53b1fce4d373980b798468a0f14c1c86894af776b9e465f575e",` +
	`"name":"1788404629504_7_1","status":"created","cpuUsage":0,"memUsage":0,"diskUsage":0},` +
	`{"containerId":"5dd3a772ffb83f70c2aeb8db06ee2d02ba4c304b7e30ecdbe9ae5fb396604799",` +
	`"name":"1788405908032_6_1","status":"running","cpuUsage":3.0456852793425645,` +
	`"memUsage":1.2,"diskUsage":0}]}`

func TestRealFramesParse(t *testing.T) {
	h, err := ParseFrame([]byte(realHello))
	if err != nil || h.Hello == nil {
		t.Fatalf("hello 解析失败：%v", err)
	}
	if h.Hello.SDKVersion != "v208" || h.Hello.Model != "r1q_v3" ||
		h.Hello.DeviceID != "r99d3fd5e79c313c18fc4a8f5f96847e" {
		t.Fatalf("hello 身份字段错：%+v", h.Hello)
	}

	s, err := ParseFrame([]byte(realSnapshot))
	if err != nil || s.Snapshot == nil {
		t.Fatalf("snapshot 解析失败：%v", err)
	}
	if s.Seq != 590 || s.Snapshot.Count != 2 || len(s.Snapshot.List) != 2 {
		t.Fatalf("snapshot 规模错：seq=%d count=%d len=%d", s.Seq, s.Snapshot.Count, len(s.Snapshot.List))
	}
	c0 := s.Snapshot.List[0]
	if c0["name"] != "1788404629504_7_1" || c0["status"] != "created" {
		t.Fatalf("容器主键字段丢了：%v", c0)
	}
	if _, ok := c0["portBindings"].(map[string]interface{}); !ok {
		t.Fatalf("portBindings 形状变了（截图/RPA 要用）：%#v", c0["portBindings"])
	}

	sys, err := ParseFrame([]byte(realSystemStats))
	if err != nil {
		t.Fatalf("system/stats 解析失败：%v", err)
	}
	data, err := ParseSystemStatsData(sys.Event)
	if err != nil {
		t.Fatalf("system/stats data 解析失败：%v", err)
	}
	if data["cpuload"] != "82%" || data["mmctotal"] != "476519" {
		t.Fatalf("system/stats 字段错：%v", data)
	}
	// cputemp 真机是裸数字，别的多是字符串 —— 统一按数值取
	if v, ok := AsFloat(data["cputemp"]); !ok || v != 57 {
		t.Fatalf("cputemp 取不到数值：%#v", data["cputemp"])
	}

	st, err := ParseFrame([]byte(realContainerStats))
	if err != nil {
		t.Fatalf("container/stats 解析失败：%v", err)
	}
	stats, err := ParseContainerStatsData(st.Event)
	if err != nil {
		t.Fatalf("container/stats data 解析失败：%v", err)
	}
	if len(stats) != 2 {
		t.Fatalf("批量指标条数错：%d", len(stats))
	}
	// 关键：真机用 containerId，解析只认 id 就会静默拿到空 ID → 补丁打不中
	if len(stats[0].ID) != 64 || stats[0].Name != "1788404629504_7_1" {
		t.Fatalf("containerId 没吃到：%+v", stats[0])
	}
	if stats[1].CPUUsage != 3.0456852793425645 {
		t.Fatalf("cpuUsage 错：%+v", stats[1])
	}
}

// TestRealFramesFlowToHandlers 真机原文整条走一遍连接层：
// 拨号 → hello → snapshot → 两条 stats，Handlers 必须各收到一次且 seq 连续不断档。
func TestRealFramesFlowToHandlers(t *testing.T) {
	m := newMockSDK(t, nil)
	m.serve = m.ServeStandard(json.RawMessage(realHello), json.RawMessage(realSnapshot),
		json.RawMessage(realSystemStats), json.RawMessage(realContainerStats))

	c := newCollector()
	s := newTestService(t, m)
	s.SetHandlers(c)
	s.Connect(Device{Key: "127.0.0.1"})
	t.Cleanup(s.Stop)

	c.Wait(t, 4, 3*time.Second) // hello + snapshot + system/stats + container/stats

	rec := c.snapshot()
	if len(rec.hello) != 1 || rec.hello[0].Model != "r1q_v3" {
		t.Fatalf("hello 没落到 Handlers：%+v", rec.hello)
	}
	if len(rec.snapshot) != 1 || len(rec.snapshot[0].List) != 2 {
		t.Fatalf("snapshot 没落到 Handlers：%d 条", len(rec.snapshot))
	}
	if len(rec.sstats) != 1 || rec.sstats[0]["mmcuse"] != "46601" {
		t.Fatalf("system/stats 没落到 Handlers：%+v", rec.sstats)
	}
	if len(rec.cstats) != 1 || len(rec.cstats[0]) != 2 {
		t.Fatalf("container/stats 没落到 Handlers：%+v", rec.cstats)
	}
	if len(rec.cont) != 0 {
		t.Fatalf("stats 事件不该被当生命周期事件分发：%+v", rec.cont)
	}
	// 真机 seq 从 590 起（设备开机以来累加），基线之上的 591/592 不该判成断档
	m.NoRecv(t, 400*time.Millisecond) // 一条 resync 都不该发
	if !s.Healthy("127.0.0.1", time.Minute) {
		t.Fatalf("真机帧流该判健康（REST 轮询要停下来）")
	}
}
