/**
 * 设备侧维护动作：
 *   - handleSetPassword：给设备下发新密码（含校验、保存到本地密码表）
 *   - showPasswordDialog / handleClosePassword：设备详情里的密码弹窗开关
 *   - handleCleanDisk：清理设备磁盘数据
 *   - handleRebootDevice：重启设备
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue，通过依赖对象传入；authRetry / collapseRightSidebar 在 App.vue 下方才声明，
 * 用惰性依赖避免 TDZ。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { getContainers, setDevicePassword, saveDevicePassword, getDevicePassword, closeDevicePassword, removeDevicePassword } from '../services/api.js'
import { getDeviceAddr } from '../utils/device.js'

export function useDeviceMaintenance({
  activeDevice,
  passwordForm,
  passwordLoading,
  passwordDialogVisible,
  taskQueue,
  t,
  isViewingDeviceDetails,
}, lazyDeps = {}) {
  // authRetry / collapseRightSidebar 在 App.vue 下方才声明，用惰性依赖避免 TDZ
  const { authRetry, collapseRightSidebar } = lazyDeps

  const handleSetPassword = async () => {
    if (!activeDevice.value) return

    if (!passwordForm.value.password) {
      ElMessage.error('请输入密码')
      return
    }

    try {
      // 检查设备是否需要认证
      if (activeDevice.value.version === 'v3') {
        try {
          // 先尝试无密码访问，看是否需要认证
          const result = await getContainers(activeDevice.value, null);
          // 如果认证失败，说明设备已经设置了密码，需要先认证
          if (result && result.code === 61 && result.message === 'Authentication Failed') {
            // 使用authRetry处理认证
            await authRetry(activeDevice.value, async (currentPassword) => {
              passwordLoading.value = true
              const result = await setDevicePassword(activeDevice.value, passwordForm.value.password, currentPassword)
              if (result.success) {
                ElMessage.success('密码设置成功')
                passwordDialogVisible.value = false
                // 保存新密码到本地存储并同步到后端
                await saveDevicePassword(activeDevice.value.ip, passwordForm.value.password)
              } else {
                ElMessage.error(`密码设置失败: ${result.message}`)
              }
            })
            return
          }
        } catch (error) {
          // 无密码访问失败，需要认证
          await authRetry(activeDevice.value, async (currentPassword) => {
            passwordLoading.value = true
            const result = await setDevicePassword(activeDevice.value, passwordForm.value.password, currentPassword)
            if (result.success) {
              ElMessage.success('密码设置成功')
              passwordDialogVisible.value = false
              // 保存新密码到本地存储并同步到后端
              await saveDevicePassword(activeDevice.value.ip, passwordForm.value.password)
            } else {
              ElMessage.error(`密码设置失败: ${result.message}`)
            }
          })
          return
        }
      }

      // 不需要认证或已经认证成功，直接设置密码
      passwordLoading.value = true
      // 获取当前保存的密码
      const currentPassword = getDevicePassword(activeDevice.value.ip);
      const result = await setDevicePassword(activeDevice.value, passwordForm.value.password, currentPassword)
      if (result.success) {
        ElMessage.success('密码设置成功')
        passwordDialogVisible.value = false
        // 保存新密码到本地存储并同步到后端
        await saveDevicePassword(activeDevice.value.ip, passwordForm.value.password)
      } else {
        ElMessage.error(`密码设置失败: ${result.message}`)
      }
    } catch (error) {
      console.error('设置密码失败:', error)
      ElMessage.error(`设置密码失败: ${error.message}`)
    } finally {
      passwordLoading.value = false
    }
  }

  // 显示密码设置对话框
  const showPasswordDialog = () => {
    if (!activeDevice.value) {
      ElMessage.error('请先选择设备')
      return
    }

    passwordForm.value.password = ''
    passwordDialogVisible.value = true
  }

  // 关闭设备密码
  const handleClosePassword = async () => {
    if (!activeDevice.value) return

    try {
      const confirmResult = await ElMessageBox.confirm('确定要关闭设备密码吗？', '提示', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      })

      // 用户确认关闭密码
      passwordLoading.value = true

      // 获取当前保存的密码
      const currentPassword = getDevicePassword(activeDevice.value.ip);
      const result = await closeDevicePassword(activeDevice.value, currentPassword)

      if (result.success) {
        ElMessage.success('密码关闭成功')
        // 清除本地存储的密码
        removeDevicePassword(activeDevice.value.ip)
      } else {
        ElMessage.error(`密码关闭失败: ${result.message}`)
      }
    } catch (error) {
      if (error !== 'cancel') {
        console.error('关闭密码失败:', error)
        ElMessage.error(`关闭密码失败: ${error.message}`)
      }
    } finally {
      passwordLoading.value = false
    }
  }


  // 清理磁盘数据
  const handleCleanDisk = async () => {
     try {
          const { value } = await ElMessageBox.prompt(
              `确定要清理设备"${activeDevice.value.ip}"磁盘数据吗？\n清理磁盘数据会重启设备，重启时间为5~10分钟，请耐心等待。\n\n请输入“yes”以继续：`,
              '清理磁盘数据',
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

          const taskId = `cleanDisk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          const task = {
              id: taskId,
              type: 'cleanDisk',
              deviceIP: activeDevice.value.ip,
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

          // 🔧 使用 authRetry 处理认证
          await authRetry(activeDevice.value, async (password) => {
              let headers = {}
              if (password) {
                  const auth = btoa(`admin:${password}`)
                  headers['Authorization'] = `Basic ${auth}`
              }

              const response = await fetch(
                  `http://${getDeviceAddr(activeDevice.value.ip)}/server/device/reset`,
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

                  ElMessage.error('清理失败')
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
                          console.log('SSE返回:', line)

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

                              ElMessage.success('设备清理完成，正在重启')

                              isViewingDeviceDetails.value = false
                          }
                      }
                  }
              }

              // 🔧 检查流结束时任务状态
              const finalTask = taskQueue.value.find(t => t.id === taskId)
              if (finalTask && !taskCompleted) {
                  // 流已结束但没有收到完成标记，可能是最后一行数据在buffer中
                  if (buffer.trim()) {
                      console.log('SSE最后一行:', buffer)
                      const resetMatch = buffer.match(/Reset sequence completed/i)
                      const rebootMatch = buffer.match(/Rebooting/i)

                      if (resetMatch || rebootMatch) {
                          finalTask.progress = 100
                          finalTask.status = 'completed'
                          finalTask.completed = 1
                          finalTask.endTime = new Date()
                          taskCompleted = true

                          ElMessage.success('设备清理完成，正在重启')
                          isViewingDeviceDetails.value = false
                      }
                  }

                  // 如果仍未完成，检查是否至少接收到了步骤信息
                  if (!taskCompleted && finalTask.currentStep >= finalTask.totalSteps) {
                      console.log('所有步骤已完成，标记任务为成功')
                      finalTask.progress = 100
                      finalTask.status = 'completed'
                      finalTask.completed = 1
                      finalTask.endTime = new Date()

                      ElMessage.success('设备清理完成，正在重启')
                      isViewingDeviceDetails.value = false
                  }
              }
          })
      } catch (error) {
          if (error !== 'cancel') {
              console.error('清理失败:', error)
              ElMessage.error('清理失败，请检查网络连接')
          }
      }
  }

  // 重启主机
  const handleRebootDevice = async () => {
    try {
      await ElMessageBox.confirm(
        `确定要重启设备"${activeDevice.value.ip}"吗？`,
        '重启后设备需要5~10分钟恢复，请耐心等待',
        {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning'
        }
      )

      collapseRightSidebar()

      await authRetry(activeDevice.value, async (password) => {
        let headers = {}
        if (password) {
          const auth = btoa(`admin:${password}`)
          headers['Authorization'] = `Basic ${auth}`
        }

        const response = await fetch(
          `http://${getDeviceAddr(activeDevice.value.ip)}/server/device/reboot`,
          {
            method: 'POST',
            headers: headers
          }
        )

        if (response.status === 401) {
          throw new Error('Authentication Failed')
        }

        if (!response.ok) {
          ElMessage.error('重启失败')
          return
        }

        ElMessage.success('重启指令已发送，设备将在5~10分钟内恢复')
        isViewingDeviceDetails.value = false
      })
    } catch (error) {
      if (error !== 'cancel') {
        console.error('重启失败:', error)
        ElMessage.error('重启失败，请检查网络连接')
      }
    }
  }

  return {
    handleSetPassword,
    showPasswordDialog,
    handleClosePassword,
    handleCleanDisk,
    handleRebootDevice,
  }
}
