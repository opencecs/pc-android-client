/**
 * 批量切换机型 / 批量新机的确认与取消：确认时校验机型槽、按槽位逐台下发任务，
 * 取消时关闭弹窗并重置机型槽相关状态。
 *
 * 机型槽本身（增删槽位、拖拽分配、校验、batchSwitchModel* 状态）由 useModelSlots 提供，
 * 本模块在内部调用它并把它的返回值原样透出，App.vue 侧的解构写法与拆分前完全一致。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { useModelSlots } from './useModelSlots.js'

export function useBatchSwitchModel({
  phoneModels,
  addTaskToQueue,
  executeTask,
  taskQueue,
  localPhoneModels,
  backupPhoneModels,
  fetchBackupModels,
  imageList,
  getV3PhoneModels,
  getLocalPhoneModels,
}) {
  const confirmBatchSwitchModel = async () => {
    if (!isModelSlotsValid.value) {
      ElMessage.warning('请确保所有机型都已选择且每个机型至少分配一个坑位')
      return
    }

    if (batchSwitchModelTargets.value.length === 0) {
      ElMessage.warning('没有要切换的云机')
      return
    }

    try {
      // 准备确认信息
      const modelInfo = []
      modelSlots.value.forEach((modelSlot, index) => {
        if (modelSlot.assignedSlots.length > 0) {
          if (modelSlot.modelId === 'random') {
            modelInfo.push(`随机 (${modelSlot.assignedSlots.length}个坑位)`)
          } else {
            let modelName = modelSlot.modelId
            if (!modelSlot.type || modelSlot.type === 'online') {
              const model = phoneModels.value.find(m => m.id === modelSlot.modelId)
              if (model) modelName = model.name
            }
            modelInfo.push(`${modelName} (${modelSlot.assignedSlots.length}个坑位)`)
          }
        }
      })

      // 显示确认对话框
      await ElMessageBox.confirm(
        `确定要执行批量新机操作吗？\n分配情况：\n${modelInfo.join('\n')}`, 
        '批量新机确认', 
        {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning'
        }
      )

      // 标记为正在切换机型
      batchSwitchingModel.value = true

      // 确定操作类型（如果是通过批量新机按钮触发的，则显示为批量新机）
      const operationType = batchSwitchModelOperationType.value || 'switchModel'

      // 为每个机型创建一个任务
      modelSlots.value.forEach((modelSlot) => {
        if (modelSlot.assignedSlots.length === 0) {
          return
        }

        let model = null
        let modelName = ''

        // 处理随机机型情况
        if (modelSlot.modelId === 'random') {
          modelName = '随机'
        } else {
          if (!modelSlot.type || modelSlot.type === 'online') {
            // 优先在按安卓版本过滤的机型列表中查找，避免跨版本同名/同 ID 机型匹配错误
            const m = filteredPhoneModelsForBatch.value.find(m => m.id === modelSlot.modelId)
              || phoneModels.value.find(m => m.id === modelSlot.modelId)
            if (m) {
              model = { id: m.id, name: m.name }
              modelName = m.name
            }
          } else {
            // 本地和备份机型直接使用modelId(即name)
            model = { id: modelSlot.modelId, name: modelSlot.modelId }
            modelName = modelSlot.modelId
          }

          if (!model) {
            return
          }
        }

        // 将批量切换机型任务添加到任务队列
        const taskId = addTaskToQueue('switchModel', modelSlot.assignedSlots, {
          modelId: modelSlot.modelId === 'random' ? 'random' : model.id, 

          // 这里我们传递 modelInfo 对象，类似于单机切换
          modelInfo: {
            value: modelSlot.modelId === 'random' ? 'random' : modelSlot.modelId,
            type: modelSlot.type || 'online'
          },
          modelName: modelName,
          operation: operationType,
          timeout: 30000 // 30秒超时
        })

        // 执行任务
        executeTask(taskId)
      })

      // 关闭对话框
      batchSwitchModelDialogVisible.value = false

      ElMessage.success(`批量新机任务已添加到队列并开始执行`)

      // 重置状态
      batchSwitchingModel.value = false
      selectedBatchModelId.value = ''
      selectedBatchModelName.value = ''
      batchSwitchModelTargets.value = []
      batchSwitchModelOperationType.value = 'switchModel' // 重置为默认操作类型
      modelSlots.value = [] // 清空机型分配槽
      draggingSlot.value = null // 重置拖拽状态
    } catch (error) {
      if (error !== 'cancel') {
        console.error('批量切换机型失败:', error)
        ElMessage.error(`批量切换机型失败: ${error.message || '未知错误'}`)
        batchSwitchingModel.value = false
      }
    }
  }

  // 处理批量切换机型取消操作
  const handleBatchSwitchModelCancel = () => {
    // 关闭对话框
    batchSwitchModelDialogVisible.value = false

    // 重置相关状态
    setTimeout(() => {
      selectedBatchModelId.value = ''
      selectedBatchModelName.value = ''
      batchSwitchModelTargets.value = []
      batchSwitchModelOperationType.value = 'switchModel'
      modelSlots.value = [] // 清空机型分配槽
      draggingSlot.value = null // 重置拖拽状态
    }, 100)
  }

  // 批量新机 - 机型槽（阶段 3 迁出到 composables/useModelSlots.js）
  const {
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
  } = useModelSlots({
    taskQueue,
    phoneModels,
    localPhoneModels,
    backupPhoneModels,
    fetchBackupModels,
    imageList,
    getV3PhoneModels,
    getLocalPhoneModels,
    executeTask,
  })

  return {
    confirmBatchSwitchModel,
    handleBatchSwitchModelCancel,
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
