/**
 * 批量新机 / 批量切换机型的「机型槽」：机型列表过滤、槽位增删、拖拽分配、校验，
 * 以及配套的 batchSwitchModel* 状态。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态（modelSlots / batchSwitchModel* 等）随本特性一起搬进来，仍解构回 App.vue 顶层，
 * 模板引用不受影响。ElMessage 由本模块自己 import。
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'

export function useModelSlots({
  taskQueue,
  phoneModels,
  localPhoneModels,
  backupPhoneModels,
  fetchBackupModels,
  imageList,
  getV3PhoneModels,
  getLocalPhoneModels,
  executeTask,
}) {
  // 批量新机 - 根据当前云机安卓版本过滤线上机型（收集所有选中容器的版本）
  const filteredPhoneModelsForBatch = computed(() => {
    let models = phoneModels.value
    const targets = batchSwitchModelTargets.value
    if (targets.length > 0) {
      const verSet = new Set()
      for (const t of targets) {
        const imageUrl = t.image || t.Image
        if (!imageUrl) continue
        const img = imageList.value.find(i => i.url === imageUrl)
        if (img && img.os_ver) {
          const m = img.os_ver.match(/and(\d+)/i)
          if (m && m[1]) verSet.add(m[1])
        }
      }
      if (verSet.size > 0) {
        models = models.filter(m => {
          if (!m.android_version) return true
          return verSet.has(String(m.android_version))
        })
      }
    }
    return models
  })

  // 批量新机 - 机型槽管理
  const addNewModelSlot = async (type = 'online') => {
    // 检查是否需要获取机型列表
    const targets = batchSwitchModelTargets.value
    if (targets.length > 0) {
      const deviceIp = targets[0].deviceIp || (targets[0].device && targets[0].device.ip)

      if (deviceIp) {
        if (type === 'local') {
          // 如果本地机型列表为空，尝试获取
          if (localPhoneModels.value.length === 0) {
             await getLocalPhoneModels(deviceIp)
          }
        } else if (type === 'backup') {
          // 如果备份机型列表为空，尝试获取
          if (backupPhoneModels.value.length === 0) {
             await fetchBackupModels(deviceIp)
          }
        } else if (type === 'online') {
          // 如果线上机型列表为空，尝试获取
          if (phoneModels.value.length === 0) {
             await getV3PhoneModels(deviceIp)
          }
        }
      }
    }

    modelSlots.value.push({
      modelId: '',
      type: type, // 'online', 'local', 'backup'
      assignedSlots: []
    })
  }

  const removeModelSlot = (index) => {
    // 将该机型槽中的坑位返回到可用列表
    const modelSlot = modelSlots.value[index]
    if (modelSlot) {
      modelSlot.assignedSlots = []
    }
    // 删除该机型槽
    modelSlots.value.splice(index, 1)
  }

  // 批量新机 - 拖拽处理
  const handleSlotDragStart = (event, slot) => {
    // V2容器不允许拖拽
    if (slot.androidType === 'V2') {
      event.preventDefault()
      ElMessage.warning('V2容器不支持指定机型，只能使用随机机型')
      return
    }
    draggingSlot.value = slot.id || slot.indexNum
    event.dataTransfer.setData('text/plain', JSON.stringify(slot))
  }

  const handleSlotDropInModelSlot = (event, modelSlotIndex) => {
    event.preventDefault()
    const slot = JSON.parse(event.dataTransfer.getData('text/plain'))
    const slotId = slot.id || slot.indexNum

    // V2容器不允许拖拽到非随机机型槽
    if (slot.androidType === 'V2' && modelSlots.value[modelSlotIndex].modelId !== 'random') {
      ElMessage.warning('V2容器不支持指定机型，只能使用随机机型')
      draggingSlot.value = null
      return
    }

    // 从所有机型槽中移除该坑位
    modelSlots.value.forEach(modelSlot => {
      modelSlot.assignedSlots = modelSlot.assignedSlots.filter(s => (s.id || s.indexNum) !== slotId)
    })

    // 添加到当前机型槽
    modelSlots.value[modelSlotIndex].assignedSlots.push(slot)
    draggingSlot.value = null
  }

  const handleSlotDropInAvailableArea = (event, slot) => {
    event.preventDefault()
    const draggedSlot = JSON.parse(event.dataTransfer.getData('text/plain'))
    const slotId = draggedSlot.id || draggedSlot.indexNum

    // 从所有机型槽中移除该坑位
    modelSlots.value.forEach(modelSlot => {
      modelSlot.assignedSlots = modelSlot.assignedSlots.filter(s => (s.id || s.indexNum) !== slotId)
    })

    draggingSlot.value = null
  }

  // 初始化机型槽
  const initModelSlots = () => {
    // 确保至少有一个机型槽
    if (modelSlots.value.length === 0) {
      // 创建一个初始机型槽，并将所有选中的坑位默认放入其中
      modelSlots.value = [{
        modelId: 'random',
        assignedSlots: [...batchSwitchModelTargets.value] // 默认将所有选中的坑位放入第一个机型槽
      }]
    }
  }

  // 执行任务队列
  const executeTaskQueue = () => {
    for (const task of taskQueue.value) {
      if (task.status === 'pending') {
        executeTask(task.id)
      }
    }
  }

  // 批量切换机型相关状态
  const batchSwitchModelDialogVisible = ref(false)
  const batchSwitchingModel = ref(false)
  const selectedBatchModelName = ref('')
  const selectedBatchModelId = ref('')
  const batchSwitchModelTargets = ref([])
  const batchSwitchModelOperationType = ref('switchModel') // 'switchModel' 或 'new'
  const batchSwitchCountryCode = ref('CN') // 批量切换机型国家代码

  // 批量新机 - 机型分配相关状态
  const modelSlots = ref([]) // 机型分配槽列表
  const draggingSlot = ref(null) // 当前拖拽的槽位
  const isModelSlotsValid = computed(() => {
    // 验证所有机型都已选择且每个机型至少分配一个坑位
    return modelSlots.value.length > 0 && 
           modelSlots.value.every(slot => slot.modelId && slot.assignedSlots.length > 0) &&
           // 确保每个坑位只分配给一个机型
           new Set(modelSlots.value.flatMap(slot => {
             return slot.assignedSlots.map(s => s.id || s.indexNum);
           })).size === batchSwitchModelTargets.value.length;
  })

  return {
    filteredPhoneModelsForBatch,
    addNewModelSlot,
    removeModelSlot,
    handleSlotDragStart,
    handleSlotDropInModelSlot,
    handleSlotDropInAvailableArea,
    initModelSlots,
    executeTaskQueue,
    batchSwitchModelDialogVisible,
    batchSwitchingModel,
    selectedBatchModelName,
    selectedBatchModelId,
    batchSwitchModelTargets,
    batchSwitchModelOperationType,
    batchSwitchCountryCode,
    modelSlots,
    draggingSlot,
    isModelSlotsValid,
  }
}
