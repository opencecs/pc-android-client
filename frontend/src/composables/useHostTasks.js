/**
 * 主机侧任务动作：
 *   - handleSdkUpgradePushTask / handleSdkUpdateTask：SDK 升级任务在任务队列里的建条目与
 *     按后端 sdkUpgrade:progress 事件推进状态
 *   - handleBatchDeleteHosts / cleanDeviceDisk：批量 / 单台主机磁盘清理，按台建任务并异步执行
 *   - logOut：清 token / uname 后整页重载
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue，通过依赖对象传入；ElMessage / ElMessageBox / getDeviceAddr 由本模块自己 import。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { getDeviceAddr } from '../utils/device.js'

export function useHostTasks({
  taskQueue,
  t,
  selectedHostDevices,
  collapseRightSidebar,
  authRetry,
  activeDevice,
  isViewingDeviceDetails,
  token,
  uname,
}) {
  const handleSdkUpgradePushTask = ({ taskId, deviceIP, batch }) => {
    const task = {
      id: taskId,
      type: 'sdkUpgrade',
      deviceIP,
      isBatch: !!batch,
      status: 'pending',
      progress: 0,
      currentStage: '',
      currentMsg: '',
      logs: [],
      startTime: new Date(),
      endTime: null,
      error: null
    }
    taskQueue.value.unshift(task)
  }

  // SDK升级任务队列：根据后端 sdkUpgrade:progress 事件更新对应条目
  const handleSdkUpdateTask = (event) => {
    const data = event?.data
    if (!data || !data.taskId) return
    const task = taskQueue.value.find(t => t.id === data.taskId)
    if (!task) return
    if (task.status === 'completed' || task.status === 'failed') return

    if (typeof data.progress === 'number') {
      task.progress = Math.max(task.progress, data.progress)
      if (data.stage === 'complete') task.progress = 100
    }
    if (data.stage) task.currentStage = data.stage
    if (data.msg) task.currentMsg = data.msg
    if (data.logs || data.stage === 'log' || data.stage === 'sse') {
      const line = data.msg || ''
      if (line) task.logs.push(line)
      if (task.logs.length > 200) task.logs.splice(0, task.logs.length - 200)
    }
    if (task.status === 'pending') task.status = 'running'

    if (data.stage === 'complete') {
      task.status = 'completed'
      task.endTime = new Date()
      task.progress = 100
    } else if (data.stage === 'failed') {
      task.status = 'failed'
      task.endTime = new Date()
      task.error = data.msg || '升级失败'
    }
  }

  const handleBatchDeleteHosts = async () => {
    if (selectedHostDevices.value.length === 0) {
      ElMessage.warning('请先选择要清理的主机')
      return
    }

    try {
      const { value } = await ElMessageBox.prompt(
          `确定要清理选中的 ${selectedHostDevices.value.length} 个设备的磁盘数据吗？\n清理磁盘数据会重启设备，重启时间为5~10分钟，请耐心等待。\n\n请输入“yes”以继续：`,
          '批量清理磁盘数据',
          {
              confirmButtonText: '确定',
              cancelButtonText: '取消',
              inputPlaceholder: '请输入“yes”',
              inputValidator: (val) => (val || '').trim().toLowerCase() === 'yes' || '请输入“yes”以确认操作',
              type: 'warning'
          }
      )
      if ((value || '').trim().toLowerCase() !== 'yes') {
          ElMessage.warning('输入不匹配，已取消清理')
          return
      }

      collapseRightSidebar()

      // 批量创建任务并执行
      for (const device of selectedHostDevices.value) {
          const taskId = `cleanDisk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          const task = {
              id: taskId,
              type: 'cleanDisk',
              deviceIP: device.ip,
              status: 'running',
              progress: 0,
              startTime: new Date(),
              completed: 0,
              failed: 0,
              totalSteps: 6,
              currentStep: 0,
              steps: []
          }
          taskQueue.value.unshift(task)

          // 异步执行清理，不阻塞循环
          // 🔧 不使用 .catch()，让错误在 cleanDeviceDisk 内部处理
          // 避免认证等待时被误判为失败
          cleanDeviceDisk(device, taskId)
      }

      ElMessage.success(`已开始清理 ${selectedHostDevices.value.length} 个设备，请查看任务列表`)
      selectedHostDevices.value = []

    } catch (error) {
      if (error !== 'cancel') {
          console.error('批量清理失败:', error)
          ElMessage.error('批量清理操作失败')
      }
    }
  }

  // 单个设备清理逻辑
  const cleanDeviceDisk = async (device, taskId) => {
      try {
          // 🔧 使用 authRetry 处理认证
          await authRetry(device, async (password) => {
              let headers = {}
              if (password) {
                  const auth = btoa(`admin:${password}`)
                  headers['Authorization'] = `Basic ${auth}`
              }

              const response = await fetch(
                  `http://${getDeviceAddr(device.ip)}/server/device/reset`,
                  {
                      method: 'POST',
                      headers: headers
                  }
              )

              if (!response.ok) {
                  // 🔧 如果是401错误，直接抛出让authRetry处理，不标记任务失败
                  if (response.status === 401) {
                      throw new Error('Authentication Failed')
                  }

                  // 其他错误才标记任务失败
                  const currentTask = taskQueue.value.find(t => t.id === taskId)
                  if (currentTask) {
                      currentTask.status = 'failed'
                      currentTask.endTime = new Date()
                      currentTask.error = `接口请求失败: ${response.status}`
                  }

                  return
              }

              const reader = response.body.getReader()
              const decoder = new TextDecoder()
              let buffer = ''
              let taskCompleted = false

              while (!taskCompleted) {
                  const { done, value } = await reader.read()
                  if (done) break

                  buffer += decoder.decode(value, { stream: true })
                  const lines = buffer.split('\n')
                  buffer = lines.pop()

                  for (const line of lines) {
                      if (line.trim()) {
                          // console.log(`[${device.ip}] SSE:`, line)

                          const currentTask = taskQueue.value.find(t => t.id === taskId)
                          if (!currentTask || taskCompleted) continue

                          const stepMatch = line.match(/\[STEP\s+(\d+)\]/i)
                          const infoMatch = line.match(/\[INFO\]/)
                          const resetMatch = line.match(/Reset sequence completed/i)
                          const rebootMatch = line.match(/Rebooting/i)

                          if (stepMatch) {
                              currentTask.currentStep = parseInt(stepMatch[1])
                              currentTask.progress = Math.round((currentTask.currentStep / currentTask.totalSteps) * 100)
                              currentTask.steps.push(line)
                          } else if (infoMatch) {
                              currentTask.steps.push(line)
                          }

                          if (resetMatch || rebootMatch) {
                              currentTask.progress = 100
                              currentTask.status = 'completed'
                              currentTask.completed = 1
                              currentTask.endTime = new Date()
                              taskCompleted = true

                              if (activeDevice.value && activeDevice.value.ip === device.ip) {
                                   isViewingDeviceDetails.value = false
                              }
                          }
                      }
                  }
              }

              // 🔧 检查流结束时任务状态
              const finalTask = taskQueue.value.find(t => t.id === taskId)
              if (finalTask && !taskCompleted) {
                  // 流已结束但没有收到完成标记，可能是最后一行数据在buffer中
                  if (buffer.trim()) {
                      console.log(`[${device.ip}] SSE最后一行:`, buffer)
                      const resetMatch = buffer.match(/Reset sequence completed/i)
                      const rebootMatch = buffer.match(/Rebooting/i)

                      if (resetMatch || rebootMatch) {
                          finalTask.progress = 100
                          finalTask.status = 'completed'
                          finalTask.completed = 1
                          finalTask.endTime = new Date()
                          taskCompleted = true

                          if (activeDevice.value && activeDevice.value.ip === device.ip) {
                              isViewingDeviceDetails.value = false
                          }
                      }
                  }

                  // 如果仍未完成，检查是否至少接收到了步骤信息
                  if (!taskCompleted && finalTask.currentStep >= finalTask.totalSteps) {
                      console.log(`[${device.ip}] 所有步骤已完成，标记任务为成功`)
                      finalTask.progress = 100
                      finalTask.status = 'completed'
                      finalTask.completed = 1
                      finalTask.endTime = new Date()

                      if (activeDevice.value && activeDevice.value.ip === device.ip) {
                          isViewingDeviceDetails.value = false
                      }
                  }
              }
          })
      } catch (error) {
          // 🔧 在这里处理错误，更新任务状态
          console.error(`[${device.ip}] 清理异常:`, error)
          const currentTask = taskQueue.value.find(t => t.id === taskId)
          if (currentTask && currentTask.status !== 'completed') {
              currentTask.status = 'failed'
              currentTask.endTime = new Date()
              currentTask.error = `执行异常: ${error.message || '未知错误'}`
          }
      }
  }


  // 退出登录
  const logOut = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('uname')
    // localStorage.removeItem('syncAuthCredentials')
    token.value = null
    uname.value = null
    window.location.reload()
  }

  return {
    handleSdkUpgradePushTask,
    handleSdkUpdateTask,
    handleBatchDeleteHosts,
    cleanDeviceDisk,
    logOut,
  }
}
