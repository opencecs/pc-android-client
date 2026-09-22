/**
 * 云机右键菜单：菜单项的容器操作分发（重启/重置/删除/关机/移动等），
 * 右键打开菜单并自适应定位，关闭菜单，以及「当前菜单对应的云机」定位。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态（contextMenu* / instances / selectedCloudMachines 等）留在 App.vue，通过 deps 传入。
 * ElMessage / wails binding / 工具函数由本模块自己 import。
 */
import { nextTick, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { restartAndroidContainer, stopContainer, deleteContainer } from '../services/api.js'

export function useContextMenu({
  slotStates,
  t,
  activeDevice,
  cloudManageMode,
  devices,
  loading,
  authRetry,
  contextMenuPosition,
  instances,
  selectedCloudMachines,
  contextMenuSlot,
  contextMenuContainer,
  contextMenuVisible,
  contextMenuRef,
}, lazyDeps = {}) {
  // 以下在 App.vue 下方才创建 / 赋值，用惰性依赖避免 TDZ 与「按值传参永远拿到 null」
  const {
    clearContainerScreenshotCache,
    fetchAndroidContainers,
    deviceHeartbeatTimer,
    androidCacheTimer,
  } = lazyDeps

  const handleContainerAction = async (container, action) => {
    // 已到期云机强制关机：禁止 restart/start/reset
    if (['restart', 'start', 'reset'].includes(action) && container) {
      const slotNum = container.indexNum
      if (slotNum != null) {
        const info = slotStates.value[slotNum]
        if (info && info.state === 2) {
          ElMessage.warning(t('common.expiredCannotStart'))
          return
        }
      }
    }

    // 确定目标设备
    let targetDevice = activeDevice.value
    if (cloudManageMode.value === 'batch' && container && container.deviceIp) {
      targetDevice = devices.value.find(d => d.ip === container.deviceIp) || { ip: container.deviceIp, version: 'v3' }
    }

    if (!targetDevice) {
      ElMessage.error('没有选中设备')
      return
    }

    loading.value = true
    try {
      switch (action) {
        case 'restart':
          // 重启容器前，清空该容器的截图缓存，避免显示旧截图
          clearContainerScreenshotCache(targetDevice, container)

          // 重启容器：V3设备使用/android/restart API，V0-V2设备使用stop+start
          await authRetry(targetDevice, async (password) => {
            await restartAndroidContainer(targetDevice, container.name || container.ID, password)
          })
          ElMessage.success('重启成功')
          break
        case 'stop':
          await authRetry(targetDevice, async (password) => {
            await stopContainer(targetDevice, container.name || container.ID, password)
          })
          ElMessage.success('关闭成功')
          break
        case 'delete':
          // 添加删除确认提示
          await ElMessageBox.confirm('确定要删除此容器吗？此操作不可恢复。', '删除容器', {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          })
          await authRetry(targetDevice, async (password) => {
            await deleteContainer(targetDevice, container.name || container.ID, password)
          })
          ElMessage.success('删除成功')
          break
        default:
          ElMessage.error('未知操作')
          break
      }
      // 操作成功后刷新容器列表
      await fetchAndroidContainers(targetDevice, true)
    } catch (error) {
      console.error(`${action}容器失败:`, error)
      const errorMsg = error.response?.data?.message || error.message || `${action}失败`
      ElMessage.error(errorMsg)
    } finally {
      loading.value = false
    }
  }

  // 右键菜单相关函数
  const handleContextMenu = (event, slot) => {
    event.preventDefault()
    // 添加全局点击事件监听，用于关闭菜单
    // 使用 setTimeout 确保当前点击不会立即触发关闭
    setTimeout(() => {
      window.addEventListener('click', closeContextMenu)
    }, 0)
    contextMenuPosition.value = { x: event.clientX, y: event.clientY }

    // 处理 slot 参数，它可能是索引(坑位模式)或对象(批量模式)
    let container = null
    let slotIndex = slot

    if (typeof slot === 'object' && slot !== null) {
      // 批量模式下直接传入了对象
      container = slot
      slotIndex = slot.indexNum // 尝试获取索引用于后续逻辑
    } else if (cloudManageMode.value === 'slot') {
      // 坑位模式：从当前设备的容器列表中查找
      container = instances.value.find(inst => inst.indexNum === slot)
      slotIndex = slot
    } else {
      // 批量模式但传入了索引（防御性代码）
      container = selectedCloudMachines.value.find(machine => machine.indexNum === slot)
      slotIndex = slot
    }

    contextMenuSlot.value = slotIndex // 存储索引或标识符
    contextMenuContainer.value = container // 存储解析出的容器对象

    // 关键修复：批量模式下自动修正 activeDevice
    if (cloudManageMode.value === 'batch' && container && container.deviceIp) {
      // 如果当前没有 activeDevice，或者 activeDevice 与当前操作的容器不属于同一设备
      if (!activeDevice.value || activeDevice.value.ip !== container.deviceIp) {
        const device = devices.value.find(d => d.ip === container.deviceIp)
        if (device) {
          activeDevice.value = device
          console.log('批量模式下自动切换 activeDevice:', device)
        } else {
          // 如果找不到设备对象，构造临时对象
          activeDevice.value = { 
            ip: container.deviceIp, 
            version: container.deviceVersion || 'v3',
            name: container.deviceName || 'Unknown'
          }
          console.log('批量模式下设置临时 activeDevice:', activeDevice.value)
        }
      }
    }

    console.log('Context menu opened for slot:', slot, 'container:', container, 'mode:', cloudManageMode.value)
    contextMenuVisible.value = true

    // 调整菜单位置，防止超出屏幕底部
    nextTick(() => {
      if (contextMenuRef.value) {
        const menu = contextMenuRef.value
        const { height } = menu.getBoundingClientRect()
        const { innerHeight } = window

        // 如果菜单超出底部，向上显示
        if (contextMenuPosition.value.y + height > innerHeight) {
          let newY = event.clientY - height
          // 确保不超出顶部
          if (newY < 0) newY = 0
          contextMenuPosition.value.y = newY
        }
      }
    })
  }

  const closeContextMenu = () => {
    contextMenuVisible.value = false
    // 移除全局点击事件监听
    window.removeEventListener('click', closeContextMenu)
    // 清空上下文菜单相关的引用
    contextMenuContainer.value = null
  }

  onBeforeUnmount(() => {
    window.removeEventListener('click', closeContextMenu)

    // 停止设备心跳检测
    if (deviceHeartbeatTimer()) {
      clearInterval(deviceHeartbeatTimer())
      console.log('[心跳] 已停止设备心跳检测定时器')
    }
    // 停止安卓缓存轮询
    if (androidCacheTimer()) {
      clearInterval(androidCacheTimer())
      console.log('[安卓轮询] 已停止安卓缓存轮询定时器')
    }
  })

  // 获取当前上下文菜单对应的云机
  const getCurrentContextMenuContainer = () => {
    // 优先直接返回已存储的容器对象（这是最准确的，特别是在批量模式下）
    if (contextMenuContainer.value) {
      return contextMenuContainer.value
    }

    if (cloudManageMode.value === 'slot') {
      // 坑位模式：从当前设备的容器列表中查找
      return instances.value.find(inst => inst.indexNum === contextMenuSlot.value)
    } else {
      // 批量模式：从所有选中的云机列表中查找
      return selectedCloudMachines.value.find(machine => machine.indexNum === contextMenuSlot.value)
    }
  }

  return {
    handleContainerAction,
    handleContextMenu,
    closeContextMenu,
    getCurrentContextMenuContainer,
  }
}
