/**
 * 备份列表状态与坑位查找：
 *   - 备份列表 / 分组 / 排序 / 批量切换进度这些弹窗状态
 *   - initBackupList / showBackupList / handleBackupSelectionChange：备份列表的取数与选中
 *   - findAvailableSlot / isSlotOccupied / checkAndStopContainer：坑位分配前的可用性判断
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue，通过依赖对象传入；ElMessage / 各 API 由本模块自己 import。
 */
import { ref, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { triggerAndroidRefresh, stopContainer } from '../services/api.js'

export function useBackupListState({
  allInstances,
  backupLoading,
  activeDevice,
  deviceCloudMachinesCache,
  runningSlotsOf,
  instancesOf,
  authRetry,
}) {
  const treeSelectedKeys = ref([]) // 存储树形结构选中的节点ID

  // 备份列表相关
  const backupListVisible = ref(false) // 备份列表显示状态
  const backupTableRef = ref(null) // 备份列表表格引用
  const backupCurrentSlot = ref(0) // 当前操作的坑位（备份相关）
  const switchingBackupSlot = ref(null) // 当前正在切换云机的坑位
  const backupList = ref([]) // 备份列表数据
  const selectedBackupList = ref([]) // 选中的备份列表（用于批量操作）
  const backupGroups = ref(['默认分组', '测试分组', '生产分组']) // 备份分组
  const selectedBackupGroup = ref('默认分组') // 当前选中的分组
  const sortBy = ref('createTime') // 排序字段

  // 批量切换云机进度对话框
  const batchSwitchBackupProgressVisible = ref(false) // 进度对话框显示状态
  const batchSwitchBackupProgressList = ref([]) // 每条进度项: { slotNum, currentName, backupName, status: 'pending'|'running'|'success'|'failed', message }
  const batchSwitchBackupTotal = ref(0) // 总数
  const batchSwitchBackupDone = ref(0) // 已完成数（成功+失败）
  const sortOrder = ref('descending') // 排序顺序

  // 初始化备份列表数据
  const initBackupList = () => {
    // 保存当前选中的备份ID列表
    const selectedIds = selectedBackupList.value.map(item => item.id)

    // 显示当前坑位的所有容器，除了当前运行的那个
    const slotContainers = allInstances.value.filter(inst => 
      inst.indexNum === backupCurrentSlot.value && 
      inst.name // 排除空容器
    );

    // 直接映射容器数据，如果没有则为空数组
    backupList.value = slotContainers.map((container, index) => ({
      id: container.name,
      name: container.name,
      createTime: container.created,
      remark: container.image,
      group: '默认分组',
      status: container.status
    }));

    // 恢复选中状态：使用表格的toggleRowSelection方法
    if (selectedIds.length > 0 && backupTableRef.value) {
      nextTick(() => {
        // 清空当前选中
        backupTableRef.value.clearSelection()
        // 重新选中之前选中的行
        backupList.value.forEach(row => {
          if (selectedIds.includes(row.id)) {
            backupTableRef.value.toggleRowSelection(row, true)
          }
        })
      })
    }
  }

  // 显示备份列表
  const showBackupList = async (slotNum) => {
    backupCurrentSlot.value = slotNum
    // 清空之前的选中状态
    selectedBackupList.value = []

    // 先显示弹窗，并显示加载状态
    backupListVisible.value = true
    backupLoading.value = true

    try {
      // 先用缓存数据初始化，避免空白
      initBackupList()

      // 实时刷新数据
      if (activeDevice.value) {
        await triggerAndroidRefresh([activeDevice.value.ip])
        // 数据刷新后重新初始化列表
        initBackupList()
      }
    } catch (error) {
      console.error('刷新备份列表失败:', error)
    } finally {
      backupLoading.value = false
    }
  }

  // 处理备份列表选中状态变化
  const handleBackupSelectionChange = (selection) => {
    selectedBackupList.value = selection
  }

  // 显示创建云机对话框


  // 查找可用的坑位，参考api/main.go中的findAvailableIdx实现
  const findAvailableSlot = (device, startSlot = 1, count = 1) => {
    if (!device) return -1

    // 根据设备型号确定最大坑位数
    let maxSlots = 12 // 默认12个坑位
    if (device.id && device.id.toLowerCase().startsWith('p')) {
      maxSlots = 24 // P系列24个坑位
    }

    // 获取当前设备的所有容器
    const deviceContainers = deviceCloudMachinesCache.value.get(device.ip) || []

    // 创建已使用坑位的集合，只考虑运行中的容器
    const usedSlots = new Set()
    deviceContainers.forEach(machine => {
      if (machine.status === 'running' && machine.indexNum) {
        usedSlots.add(machine.indexNum)
      }
    })

    // 检查当前运行中的容器数量是否已达到上限
    if (usedSlots.size >= maxSlots) {
      return -1
    }

    // 检查请求的坑位数是否超过剩余可用坑位数
    const remainingSlots = maxSlots - usedSlots.size
    if (count > remainingSlots) {
      return -1
    }

    // 查找从startSlot开始，连续count个可用的坑位
    for (let i = 1; i <= maxSlots; i++) {
      // 如果是批量创建，检查从i开始的连续count个坑位是否都可用
      if (count > 1) {
        let allAvailable = true
        for (let j = 0; j < count; j++) {
          // 检查当前坑位是否超出范围或已被使用
          if (i + j > maxSlots || usedSlots.has(i + j)) {
            allAvailable = false
            break
          }
        }
        if (allAvailable) {
          return i
        }
      } else {
        // 单个坑位：直接返回第一个可用的坑位
        if (!usedSlots.has(i)) {
          return i
        }
      }
    }

    // 没有找到可用的坑位
    return -1
  }

  // 检查指定坑位是否已被占用
  const isSlotOccupied = (device, slot) => {
    if (!device) return true

    // 优先从 runningSlots 检查（showCreateDialog 时实时获取的运行状态）
    // runningSlots 为全局单例，仅当归属本设备时才可用，否则视为未知
    const liveSlots = runningSlotsOf(device)
    if (liveSlots && liveSlots.has(slot)) return true

    // 从 deviceCloudMachinesCache 检查
    const deviceContainers = deviceCloudMachinesCache.value.get(device.ip) || []
    if (deviceContainers.some(machine => machine.status === 'running' && machine.indexNum === slot)) return true

    // 从 instances 检查（当前选中设备的容器列表）
    // 从 instances 检查（instances 只承载当前选中设备的列表，跨设备不采信）
    if (instancesOf(device).some(machine => machine.status === 'running' && machine.indexNum === slot)) return true

    return false
  }

  // 检查并关闭指定坑位的运行中容器
  const checkAndStopContainer = async (device, slot) => {
    if (!device) return true

    // 获取当前设备的所有容器
    const deviceContainers = deviceCloudMachinesCache.value.get(device.ip) || []

    // 查找指定坑位的运行中容器
    const runningContainer = deviceContainers.find(machine => 
      machine.status === 'running' && machine.indexNum === slot
    )

    if (runningContainer) {
      // 有运行中的容器，需要先关闭
      try {
        ElMessage.info(`正在关闭坑位 ${slot} 上运行的容器: ${runningContainer.name}`)
        await authRetry(device, async (password) => {
            await stopContainer(device, runningContainer.name, password)
          })
        // 等待1秒，确保容器完全关闭
        await new Promise(resolve => setTimeout(resolve, 1000))
        return true
      } catch (error) {
        ElMessage.error(`关闭容器失败：${error.message}`)
        return false
      }
    }

    // 没有运行中的容器，直接返回
    return true
  }

  return {
    treeSelectedKeys,
    backupListVisible,
    backupTableRef,
    backupCurrentSlot,
    switchingBackupSlot,
    backupList,
    selectedBackupList,
    backupGroups,
    selectedBackupGroup,
    sortBy,
    batchSwitchBackupProgressVisible,
    batchSwitchBackupProgressList,
    batchSwitchBackupTotal,
    batchSwitchBackupDone,
    sortOrder,
    initBackupList,
    showBackupList,
    handleBackupSelectionChange,
    findAvailableSlot,
    isSlotOccupied,
    checkAndStopContainer,
  }
}
