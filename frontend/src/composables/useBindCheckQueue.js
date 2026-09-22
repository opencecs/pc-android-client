/**
 * 设备绑定状态查询队列（节流 + 去重 + 定时驱动）。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同。
 *
 * 需要宿主能力的 `fetchDeviceBindStatus` 通过依赖对象传入（本仓库不用 provide/inject）。
 */
import { ref } from 'vue'

export function useBindCheckQueue({ fetchDeviceBindStatus }) {
  // 设备绑定状态查询队列
  const deviceBindCheckQueue = ref([])
  const isProcessingBindQueue = ref(false)
  const deviceBindCheckInterval = ref(null)
  const lastBindCheckTime = ref(new Map()) // 记录每个设备的最后绑定状态检查时间
  const MAX_CONCURRENT_BIND_CHECKS = 1 // 最大并发绑定状态查询数
  const BIND_CHECK_INTERVAL = 1000 // 绑定状态查询间隔1秒
  const MIN_BIND_CHECK_INTERVAL = 5000 // 同一设备最小绑定状态检查间隔5秒

  // 添加设备到绑定状态查询队列
  const addToBindCheckQueue = () => {
    const now = Date.now()
    const lastTime = lastBindCheckTime.value.get('global') || 0

    // 避免短时间内重复查询
    if (now - lastTime < MIN_BIND_CHECK_INTERVAL) {
      console.log('最近已查询过设备绑定状态，跳过本次检查')
      return
    }

    // 检查是否已在队列中
    if (deviceBindCheckQueue.value.length > 0) {
      console.log('设备绑定状态查询已在队列中，跳过重复添加')
      return
    }

    // 添加到队列
    deviceBindCheckQueue.value.push('bind-check')
    // console.log('设备绑定状态查询已添加到队列')
  }

  // 处理绑定状态查询队列
  const processBindCheckQueue = async () => {
    if (isProcessingBindQueue.value) {
      return
    }

    isProcessingBindQueue.value = true

    try {
      // 从队列中取出任务
      const task = deviceBindCheckQueue.value.shift()

      if (!task) {
        isProcessingBindQueue.value = false
        return
      }

      console.log('开始查询设备绑定状态')

      // 记录检查时间
      lastBindCheckTime.value.set('global', Date.now())

      // 调用设备绑定状态查询API
      await fetchDeviceBindStatus()

      // console.log('设备绑定状态查询完成')
    } catch (error) {
      console.error('设备绑定状态查询失败:', error)
    } finally {
      isProcessingBindQueue.value = false
    }
  }

  // 批量处理绑定状态查询队列 - 支持并发
  const batchProcessBindCheckQueue = async () => {
    // 最多同时处理MAX_CONCURRENT_BIND_CHECKS个任务
    const tasks = []
    for (let i = 0; i < MAX_CONCURRENT_BIND_CHECKS; i++) {
      tasks.push(processBindCheckQueue())
    }
    await Promise.all(tasks)
  }

  // 初始化绑定状态查询队列定时器
  const initBindCheckQueue = () => {
    // 清理之前的定时器
    if (deviceBindCheckInterval.value) {
      clearInterval(deviceBindCheckInterval.value)
    }

    // 每1秒处理一次队列，支持并发
    deviceBindCheckInterval.value = setInterval(() => {
      batchProcessBindCheckQueue()
    }, BIND_CHECK_INTERVAL)

    // console.log('设备绑定状态查询队列定时器已启动，每1秒检查一次，支持最大并发数:', MAX_CONCURRENT_BIND_CHECKS)
  }

  return {
    deviceBindCheckQueue,
    isProcessingBindQueue,
    deviceBindCheckInterval,
    lastBindCheckTime,
    MAX_CONCURRENT_BIND_CHECKS,
    BIND_CHECK_INTERVAL,
    MIN_BIND_CHECK_INTERVAL,
    addToBindCheckQueue,
    processBindCheckQueue,
    batchProcessBindCheckQueue,
    initBindCheckQueue,
  }
}
