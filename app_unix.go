//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// setSocketBroadcast sets the SO_BROADCAST option on a socket
func setSocketBroadcast(fd uintptr) error {
	return syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_BROADCAST, 1)
}

func configureHiddenProcess(cmd *exec.Cmd) {
}

func bringProcessToFront(pid int) error {
	return syscall.ENOTSUP
}

func bringWindowToFront(hwnd WindowHandle) error {
	return syscall.ENOTSUP
}

func findWindowByTitle(title string) (WindowHandle, error) {
	return 0, syscall.ENOTSUP
}

func findWindowByPidAndTitle(pid int, title string) (WindowHandle, error) {
	return 0, syscall.ENOTSUP
}

// isWindowsProcessRunning 在非Windows平台上的桩函数
// 实际不会被调用，因为app.go中有runtime.GOOS判断
func isWindowsProcessRunning(pid int) bool {
	return false
}

// getScreenSize 非Windows平台无 GetSystemMetrics，返回默认值
func getScreenSize() (int, int) {
	return 1920, 1080
}

// getWorkArea 非Windows平台无工作区概念，使用 getScreenSize 减去默认任务栏高度
func getWorkArea() (int, int) {
	w, h := getScreenSize()
	return w, h - 48
}

// adjustWindowRectForClient 非Windows平台回退：手动补偿标题栏(30px)+边框(2*2px)
func adjustWindowRectForClient(clientW, clientH int) (int, int) {
	return clientW + 4, clientH + 34
}
