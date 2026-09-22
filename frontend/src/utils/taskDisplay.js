/**
 * 从 App.vue 抽出的纯工具函数（不依赖任何组件状态）。
 * 由 App.vue 拆分阶段 2 迁出，函数体与原实现逐字相同。
 */


// 获取指定设备IP的进度百分比
export const getDeviceProgress = (task, deviceIP) => {
  if (!task.deviceProgress) return 0
  
  const deviceData = task.deviceProgress[deviceIP]
  if (!deviceData) return 0
  
  // 如果有实时进度数据且任务正在进行中，使用实时进度
  if (deviceData.currentProgress !== undefined && task.status === 'running') {
    return deviceData.currentProgress
  }
  
  // 否则使用完成/总数的百分比
  return Math.round((deviceData.completed / deviceData.total) * 100)
}


// 获取指定设备IP的进度状态
export const getDeviceProgressStatus = (task, deviceIP) => {
  if (!task.deviceProgress) return ''
  
  const deviceData = task.deviceProgress[deviceIP]
  if (!deviceData) return ''
  
  if (deviceData.completed === deviceData.total) return 'success'
  if (deviceData.failed > 0 && deviceData.completed + deviceData.failed === deviceData.total) return 'exception'
  return ''
}


// 获取指定设备IP的进度状态文字
export const getDeviceProgressText = (task, deviceIP) => {
  if (!task.deviceProgress) return { text: '等待中', icon: 'Timer' }
  
  const deviceData = task.deviceProgress[deviceIP]
  if (!deviceData) return { text: '等待中', icon: 'Timer' }
  
  // 针对批量任务，优先根据设备自身的进度判断状态，避免被全局任务状态覆盖
  if ((task.type === 'uploadFile' || task.type === 'uploadImage')) {
    if (deviceData.total > 0) {
      if (deviceData.completed === deviceData.total) {
        return { text: '完成', icon: 'CircleCheck' }
      }
      if (deviceData.failed > 0 && deviceData.completed + deviceData.failed >= deviceData.total) {
        return { text: '失败', icon: 'CircleClose' }
      }
    }
  }
  
  // 任务状态映射
  const statusMap = {
    'pending': { text: '等待中', icon: 'Timer' },
    'running': { text: '上传中', icon: 'Loading' },
    'completed': { text: '完成', icon: 'CircleCheck' },
    'failed': { text: '失败', icon: 'CircleClose' },
    'canceled': { text: '已取消', icon: 'Close' }
  }
  
  // 如果任务已完成或失败，显示最终状态
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'canceled') {
    return statusMap[task.status] || { text: '未知', icon: 'QuestionFilled' }
  }
  
  // 任务进行中，根据设备状态显示
  if (deviceData.completed > 0) {
    return { text: '完成', icon: 'CircleCheck' }
  }
  if (deviceData.failed > 0) {
    return { text: '失败', icon: 'CircleClose' }
  }
  if (deviceData.currentProgress > 0) {
    return { text: '上传中', icon: 'Loading' }
  }
  
  // 检查该设备是否在当前批次中（对于分批上传任务）
  if (task.deviceIps && task.type === 'uploadImage') {
    // 如果进度刚开始，显示等待中
    return { text: '等待中', icon: 'Timer' }
  }
  
  return { text: '等待中', icon: 'Timer' }
}


// 获取任务的目标设备/云机名称显示
export const getTaskTargetDisplay = (task) => {
  if (!task) return { short: '', full: [] }
  
  // 对于上传文件任务，从targets中获取云机名称
  if (task.type === 'uploadFile' && task.targets && task.targets.length > 0) {
    const names = []
    task.targets.forEach(target => {
      if (target.machines && target.machines.length > 0) {
        target.machines.forEach(machine => {
          if (machine.name) names.push(formatInstanceName(machine.name))
        })
      }
    })
    // 去重
    const uniqueNames = [...new Set(names)]
    if (uniqueNames.length > 0) {
      return {
        short: uniqueNames.length > 1 ? `${uniqueNames[0]}...` : uniqueNames[0],
        full: uniqueNames
      }
    }
  }
  
  // 对于其他任务，使用deviceIps
  if (task.deviceIps && task.deviceIps.length > 0) {
    return {
      short: task.deviceIps.length > 1 ? `${task.deviceIps[0]}...` : task.deviceIps[0],
      full: task.deviceIps
    }
  }
  
  // 对于创建任务，从targets中获取槽位信息
  if (task.type === 'create' && task.targets && task.targets.length > 0) {
    const slots = task.targets.map(t => `坑位${t.slot}`)
    return {
      short: slots.length > 1 ? `${slots[0]}...` : slots[0],
      full: slots
    }
  }
  
  return { short: '', full: [] }
}
