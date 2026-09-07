package main

import (
	"testing"
	"time"
)

// 探活失败日志的限流。断线的设备会被 3s 一轮的探活一直打：
// 一台拔了网线的设备每轮固定刷一行 connectex refused，能一直刷到有人管它为止，
// 真出事时那堵日志墙会把唯一有用的那条线索埋掉。
//
// 判据必须留全 —— 前 maxFailCount 次正是"连续失败到此次数即判离线"的依据，
// 掐掉它们就等于把判定过程变成黑盒；之后才降级成每分钟一行。
func TestProbeFailureLogIsRateLimited(t *testing.T) {
	const maxFail = 3
	st := &DeviceStatus{IP: "10.10.5.205", Status: "offline"}

	for i := 1; i <= maxFail; i++ {
		st.ConsecutiveFailures = i
		if !shouldLogProbeFailure(st, maxFail) {
			t.Fatalf("判离线前的第 %d 次失败必须留日志", i)
		}
	}

	st.ConsecutiveFailures = maxFail + 1
	if shouldLogProbeFailure(st, maxFail) {
		t.Fatalf("刚记过一笔，不该立刻再记")
	}

	st.LastProbeLogAt = time.Now().Add(-probeLogInterval - time.Second)
	if !shouldLogProbeFailure(st, maxFail) {
		t.Fatalf("超过 %s 该再记一笔（长期离线也得有动静）", probeLogInterval)
	}
}

// 第二次 SYN 是给**在线**设备防跨网段瞬时丢包的（误判一次就掉一台正在用的设备）。
// 已经灰着的设备不该再享受这次重拨：只是把每轮从 2s 拖成 4s，全摊在共享 worker 池上。
func TestDeviceSaysOnline(t *testing.T) {
	a := &App{deviceStatusMap: map[string]*DeviceStatus{
		"10.10.5.202": {IP: "10.10.5.202", Status: "online"},
		"10.10.5.205": {IP: "10.10.5.205", Status: "offline"},
	}}
	if !a.deviceSaysOnline("10.10.5.202") {
		t.Fatalf("在线设备读成了离线")
	}
	if a.deviceSaysOnline("10.10.5.205") {
		t.Fatalf("离线设备读成了在线（会白多拨一次）")
	}
	if a.deviceSaysOnline("10.10.5.9") {
		t.Fatalf("没记录的设备应视为离线")
	}
}
