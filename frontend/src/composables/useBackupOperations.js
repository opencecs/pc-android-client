/**
 * 备份与机型分组操作：
 *   - switchBackup：把某个备份切回成当前运行实例
 *   - deleteBackup / batchDeleteBackup：删除单个 / 选中的备份
 *   - addBackupGroup / addNewModel：备份分组、机型分组的本地新增
 *   - handleDragAndDrop / handleDrop / handleNodeDrop：机型树拖拽后把云机挪到目标机型下
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue，通过依赖对象传入；fetchAndroidContainers 在 App.vue 下方才声明，
 * 用惰性依赖避免 TDZ。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { startContainer, stopContainer, deleteContainer } from '../services/api.js'

export function useBackupOperations({
  backupCurrentSlot,
  activeDevice,
  backupListVisible,
  deviceCloudMachinesCache,
  switchingBackupSlot,
  backupLoading,
  instances,
  authRetry,
  allInstances,
  cloudManageMode,
  selectedCloudMachines,
  treeSelectedKeys,
  initBackupList,
  selectedBackupList,
  backupGroups,
  selectedBackupGroup,
  cloudMachineGroups,
  devices,
  cloudMachines,
}, lazyDeps = {}) {
  // fetchAndroidContainers 在 App.vue 下方才声明，用惰性依赖避免 TDZ
  const { fetchAndroidContainers } = lazyDeps

  // 切换云机
  const switchBackup = async (backupId) => {
    console.log(`切换坑位 ${backupCurrentSlot.value} 到备份 ${backupId}`)

    if (!activeDevice.value) {
      ElMessage.error('没有选中设备')
      backupListVisible.value = false
      return
    }

    // 记录切换前的运行容器名（用于刷新后判定"已切换为新容器"）
    const deviceIp = activeDevice.value.ip
    const slotNum = backupCurrentSlot.value
    const prevRunningName = (() => {
      const list = deviceCloudMachinesCache.value.get(deviceIp) || []
      const cm = list.find(it => it.indexNum === slotNum && it.status === 'running')
      return cm?.name || ''
    })()

    // 记录当前正在切换的坑位
    switchingBackupSlot.value = backupCurrentSlot.value
    backupLoading.value = true

    try {
      // 1. 找到当前坑位运行的容器并关机
      const runningContainer = instances.value.find(inst =>
        inst.indexNum === backupCurrentSlot.value &&
        inst.status === 'running'
      );

      if (runningContainer) {
        ElMessage.info(`正在关机当前运行的容器: ${runningContainer.name}`)
        await authRetry(activeDevice.value, async (password) => {
          await stopContainer(activeDevice.value, runningContainer.name, password)
        })
        // 等待1秒，确保容器完全关闭
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      // 2. 找到要切换的备份容器并开机
      // 从allInstances中查找，因为instances只包含每个坑位的一个容器
      const backupContainer = allInstances.value.find(inst =>
        inst.name === backupId
      );

      if (backupContainer) {
        ElMessage.info(`正在开机备份容器: ${backupContainer.name}`)
        await authRetry(activeDevice.value, async (password) => {
          await startContainer(activeDevice.value, backupContainer.name, password)
        })
        // 等待2秒，确保容器完全启动
        await new Promise(resolve => setTimeout(resolve, 2000))
        ElMessage.success(`成功切换坑位 ${backupCurrentSlot.value} 到备份 ${backupId}`)
      } else {
        ElMessage.error('未找到指定的备份容器')
      }

      // 3. 刷新容器列表，重试最多3次，确保获取最新状态
      for (let i = 0; i < 3; i++) {
        await fetchAndroidContainers(activeDevice.value, true)
        // 检查是否获取到了"与旧容器名不同"的运行中容器
        const updatedContainer = instances.value.find(inst =>
          inst.indexNum === backupCurrentSlot.value &&
          (inst.status === 'running' || inst.status === 'created') &&
          inst.name !== prevRunningName
        );
        if (updatedContainer) {
          break;
        }
        // 等待1秒后重试
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      // 4. 批量模式下：切换云机后容器名变更，原选中的云机 id 失效，
      //    按坑位重新匹配新容器并恢复选中状态。
      if (cloudManageMode.value === 'batch') {
        const newCm = (() => {
          const list = deviceCloudMachinesCache.value.get(deviceIp) || []
          return list.find(it => it.indexNum === slotNum && it.status === 'running' && it.name !== prevRunningName)
        })()
        if (newCm && newCm.id) {
          const next = new Set()
          for (const cm of selectedCloudMachines.value) {
            // 保留同设备其它坑位的选中，同坑位旧云机会被新云机替换
            if (cm.deviceIp === deviceIp && cm.indexNum === slotNum) continue
            next.add(cm)
          }
          next.add(newCm)
          const newSelected = [...next]
          selectedCloudMachines.value = newSelected
          treeSelectedKeys.value = newSelected.map(cm => cm.id)
        }
      }
    } catch (error) {
      console.error('切换云机失败:', error)
      ElMessage.error('切换云机失败: ' + (error.message || '未知错误'))
    } finally {
      backupLoading.value = false
      backupListVisible.value = false
      switchingBackupSlot.value = null
    }
  }

  // 删除单个备份
  const deleteBackup = async (backupId) => {
    console.log(`删除备份: ${backupId}`)

    if (!activeDevice.value) {
      ElMessage.error('没有选中设备')
      return
    }

    try {
      await ElMessageBox.confirm('确定要删除该备份吗？删除后数据将无法恢复。', '删除备份', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      })

      backupLoading.value = true

      await authRetry(activeDevice.value, async (password) => {
        await deleteContainer(activeDevice.value, backupId, password)
      })

      ElMessage.success('删除备份成功')

      // 重新获取容器列表，更新 allInstances
      await fetchAndroidContainers(activeDevice.value, true)

      // 刷新备份列表
      initBackupList()
    } catch (error) {
      if (error !== 'cancel') {
        console.error('删除备份失败:', error)
        ElMessage.error('删除备份失败: ' + (error.message || '未知错误'))
      }
    } finally {
      backupLoading.value = false
    }
  }

  // 批量删除备份
  const batchDeleteBackup = async () => {
    if (selectedBackupList.value.length === 0) {
      ElMessage.warning('请先选择要删除的备份')
      return
    }

    console.log(`批量删除备份: ${selectedBackupList.value}`)

    if (!activeDevice.value) {
      ElMessage.error('没有选中设备')
      return
    }

    try {
      await ElMessageBox.confirm(`确定要删除选中的 ${selectedBackupList.value.length} 个备份吗？删除后数据将无法恢复。`, '批量删除备份', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      })

      backupLoading.value = true

      for (const backupId of selectedBackupList.value) {
        await authRetry(activeDevice.value, async (password) => {
          await deleteContainer(activeDevice.value, backupId, password)
        })
      }

      ElMessage.success(`成功删除 ${selectedBackupList.value.length} 个备份`)

      // 清空选择
      selectedBackupList.value = []

      // 重新获取容器列表，更新 allInstances
      await fetchAndroidContainers(activeDevice.value, true)

      // 刷新备份列表
      initBackupList()
    } catch (error) {
      if (error !== 'cancel') {
        console.error('批量删除备份失败:', error)
        ElMessage.error('批量删除备份失败: ' + (error.message || '未知错误'))
      }
    } finally {
      backupLoading.value = false
    }
  }

  // 添加新分组
  const addBackupGroup = () => {
    const newGroup = `新分组${backupGroups.value.length + 1}`
    backupGroups.value.push(newGroup)
    selectedBackupGroup.value = newGroup
    // 功能正在开发中提示
    ElMessage.info('功能正在开发中')
  }

  // 添加新机型
  const addNewModel = () => {
    const newModel = `新机型${cloudMachineGroups.value.length}`
    cloudMachineGroups.value.push({
      id: `model-${Date.now()}`,
      name: newModel,
      devices: devices.value.map(device => {
        return {
          id: device.id,
          ip: device.ip,
          cloudMachines: []
        };
      })
    })
    ElMessage.success(`成功创建新机型: ${newModel}`)
  }

  // 支持从默认机型拖拽坑位到新机型
  const handleDragAndDrop = (sourceModelId, targetModelId, slot) => {
    // 找到源机型和目标机型
    const sourceModel = cloudMachineGroups.value.find(model => model.id === sourceModelId)
    const targetModel = cloudMachineGroups.value.find(model => model.id === targetModelId)

    if (!sourceModel || !targetModel) return

    // 遍历所有设备
    devices.value.forEach(device => {
      // 在源机型中找到该设备的云机列表
      const sourceDevice = sourceModel.devices.find(d => d.ip === device.ip)
      const targetDevice = targetModel.devices.find(d => d.ip === device.ip)

      if (!sourceDevice || !targetDevice) return

      // 找到要移动的云机
      const cloudMachineIndex = sourceDevice.cloudMachines.findIndex(machine => machine.indexNum === slot)
      if (cloudMachineIndex === -1) return

      // 移动云机
      const [movedMachine] = sourceDevice.cloudMachines.splice(cloudMachineIndex, 1)
      targetDevice.cloudMachines.push(movedMachine)
    })

    ElMessage.success(`成功将坑位 ${slot} 从 ${sourceModel.name} 移动到 ${targetModel.name}`)
  }

  // 处理树形结构拖拽的验证函数
  const handleDrop = (draggingNode, dropNode, dropType) => {
    // 只允许将云机节点拖拽到机型节点下的设备节点
    if (draggingNode.data.screenshot && dropNode.data.cloudMachines) {
      return true
    }
    return false
  }

  // 处理树形结构拖拽的完成函数
  const handleNodeDrop = (draggingNode, dropNode, dropType) => {
    if (draggingNode.data.screenshot && dropNode.data.cloudMachines) {
      // 云机节点被拖拽到设备节点

      // 找到源机型和目标机型
      let sourceModel = null
      let targetModel = null

      // 查找源机型
      for (const model of cloudMachineGroups.value) {
        for (const device of model.devices) {
          for (const machine of device.cloudMachines) {
            if (machine.id === draggingNode.data.id) {
              sourceModel = model
              break
            }
          }
          if (sourceModel) break
        }
        if (sourceModel) break
      }

      // 查找目标机型
      for (const model of cloudMachineGroups.value) {
        for (const device of model.devices) {
          if (device.id === dropNode.data.id) {
            targetModel = model
            break
          }
        }
        if (targetModel) break
      }

      if (sourceModel && targetModel) {
        // 执行拖拽操作
        handleDragAndDrop(sourceModel.id, targetModel.id, draggingNode.data.indexNum)
      }
    }
  }

  return {
    switchBackup,
    deleteBackup,
    batchDeleteBackup,
    addBackupGroup,
    addNewModel,
    handleDragAndDrop,
    handleDrop,
    handleNodeDrop,
  }
}
