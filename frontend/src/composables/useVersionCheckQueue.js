/**
 * 设备 API 版本检查队列（并发 + 节流 + 优先级）与「自动获取所有设备版本信息」防抖驱动。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同。
 *
 * 需要宿主状态的 ref / 函数通过依赖对象传入（本仓库不用 provide/inject）：
 *   devices / token / deviceVersionInfo / devicesStatusCache / devicesLastUpdateTime 五个 ref，
 *   fetchV3DeviceInfo（本文件内的 V3 设备信息查询）、
 *   addToBindCheckQueue（来自 useBindCheckQueue，取版本时顺带刷新绑定状态）。
 * `getDeviceVersionInfo` 属服务层、`ReconnectDeviceEventWS` 属 wails binding，
 * 按本仓库惯例由本模块自己 import。
 *
 * `versionCheckTimer` 是只在 autoGetAllDeviceVersions / 卸载清理之间用到的 let，
 * 收进闭包不再导出，改由 cancelAutoGetAllDeviceVersions() 暴露给卸载清理。
 */
import { ref } from 'vue'
import { getDeviceVersionInfo } from '../services/api.js'
import { ReconnectDeviceEventWS } from '../../bindings/edgeclient/app'

export function useVersionCheckQueue({
  devices,
  token,
  deviceVersionInfo,
  devicesStatusCache,
  devicesLastUpdateTime,
  fetchV3DeviceInfo,
  addToBindCheckQueue,
}) {
  // API版本检查队列
  const versionCheckQueue = ref([])
  const priorityQueue = ref([]) // 优先级队列，用于手动查询
  const isProcessingQueue = ref(false)
  const versionCheckInterval = ref(null)
  const lastCheckTime = ref(new Map()) // 记录每个设备的最后检查时间，避免频繁查询
  // 版本检查队列上次探到的版本（仅 processVersionCheckQueue 写入）：与设备详情弹窗、
  // 选中即查等别的写入方无关，专用于判断"队列两次探测之间版本变没变"
  const lastQueueProbeVersion = ref(new Map())
  const MAX_CONCURRENT_CHECKS = 3 // 最大并发检查数
  const CHECK_INTERVAL = 500 // 检查间隔缩短到500ms
  const MIN_CHECK_INTERVAL = 3000 // 同一设备最小检查间隔3秒

  // 添加设备到版本检查队列
  const addToVersionCheckQueue = (device, isPriority = false) => {
    const now = Date.now()
    const lastTime = lastCheckTime.value.get(device.id) || 0

    // 避免短时间内重复查询同一设备
    if (now - lastTime < MIN_CHECK_INTERVAL) {
      console.log(`设备 ${device.ip} 最近已查询过，跳过本次检查`)
      return
    }

    // 检查是否已在队列中
    const isInMainQueue = versionCheckQueue.value.some(item => item.id === device.id)
    const isInPriorityQueue = priorityQueue.value.some(item => item.id === device.id)

    if (isInMainQueue || isInPriorityQueue) {
      // console.log(`设备 ${device.ip} 已在检查队列中，跳过重复添加`)
      return
    }

    if (isPriority) {
      priorityQueue.value.push(device)
      // console.log(`设备 ${device.ip} 已添加到优先级检查队列`)
    } else {
      versionCheckQueue.value.push(device)
      // console.log(`设备 ${device.ip} 已添加到版本检查队列`)
    }
  }

  // 处理版本检查队列 - 支持并发检查
  const processVersionCheckQueue = async () => {
    if (isProcessingQueue.value) {
      return
    }

    isProcessingQueue.value = true

    let currentDevice = null

    try {
      // 优先处理优先级队列
      currentDevice = priorityQueue.value.shift() || versionCheckQueue.value.shift()

      if (!currentDevice) {
        isProcessingQueue.value = false
        return
      }

      console.log(`开始检查设备 ${currentDevice.ip} 版本信息`)

      // 记录检查时间
      lastCheckTime.value.set(currentDevice.id, Date.now())

      // 设置API调用超时
      const versionInfo = await Promise.race([
        getDeviceVersionInfo(currentDevice),
        new Promise((_, reject) => setTimeout(() => reject(new Error('API调用超时')), 3000))
      ])

      // 更新设备版本信息缓存
      if (versionInfo.code === 0 && versionInfo.data) {
        // 探到响应 = 这台"离线"设备的 HTTP 活着（可能已被别人升级到带 /ws/events
        // 的新 SDK）。只有队列两次探测之间版本变了才让 Go 立刻重拨事件通道，
        // 不等 10 分钟降级到期；版本没变就不重拨——2026-09-09 现场（v210 设备
        // 对 /ws/events 的所有新握手回 503，重启设备才恢复）证明设备端会积累
        // 连接，白拆一次重连就离全拒更近一步，而 app 启动/切页会把每台离线
        // 设备都探一遍 /info，无条件重拨等于反复拆好端端的连接。首探（无基线）
        // 不重拨：app 启动时本来就会全新拨号，降级状态不跨进程。自己升级的
        // 设备由升级轮询触发重拨，不走这里
        const prevProbe = lastQueueProbeVersion.value.get(currentDevice.id)
        if (devicesStatusCache.value.get(currentDevice.id) === 'offline' && prevProbe &&
            (prevProbe.currentVersion !== versionInfo.data.currentVersion ||
             prevProbe.latestVersion !== versionInfo.data.latestVersion)) {
          ReconnectDeviceEventWS(currentDevice.ip).catch(() => {})
        }
        lastQueueProbeVersion.value.set(currentDevice.id, {
          currentVersion: versionInfo.data.currentVersion,
          latestVersion: versionInfo.data.latestVersion
        })

        // 优化Map更新：只在数据变化时更新
        const currentVersion = deviceVersionInfo.value.get(currentDevice.id)
        const needUpdate = !currentVersion ||
                         currentVersion.currentVersion !== versionInfo.data.currentVersion ||
                         currentVersion.latestVersion !== versionInfo.data.latestVersion

        if (needUpdate) {
          // 直接更新现有Map，避免替换整个对象导致的重新渲染
          deviceVersionInfo.value.set(currentDevice.id, {
            currentVersion: versionInfo.data.currentVersion,
            latestVersion: versionInfo.data.latestVersion
          })
          // console.log(`设备 ${currentDevice.ip} 版本信息已更新:`, versionInfo.data)
        } else {
          // console.log(`设备 ${currentDevice.ip} 版本信息未变化，跳过更新`)
        }
      }
    } catch (error) {
      // console.error(`处理设备 ${currentDevice?.ip} 版本检查失败:`, error)

      // 标记当前处理的设备为离线
      if (currentDevice) {
        // 更新设备状态为离线
        // 更新设备最后更新时间，确保设备列表立即重新过滤
        devicesLastUpdateTime.value.set(currentDevice.id, Date.now())
        // console.log(`设备 ${currentDevice.ip} 版本检查失败，已标记为离线`)
      }
    } finally {
      isProcessingQueue.value = false
    }
  }

  // 批量处理版本检查队列 - 支持并发
  const batchProcessVersionCheckQueue = async () => {
    // 最多同时处理MAX_CONCURRENT_CHECKS个设备
    const tasks = []
    for (let i = 0; i < MAX_CONCURRENT_CHECKS; i++) {
      tasks.push(processVersionCheckQueue())
    }
    await Promise.all(tasks)
  }

  // 初始化版本检查队列定时器
  const initVersionCheckQueue = () => {
    // 清理之前的定时器
    if (versionCheckInterval.value) {
      clearInterval(versionCheckInterval.value)
    }

    // 每500ms处理一次队列，支持并发
    versionCheckInterval.value = setInterval(() => {
      batchProcessVersionCheckQueue()
    }, CHECK_INTERVAL)

    // console.log('版本检查队列定时器已启动，每500ms检查一次，支持最大并发数:', MAX_CONCURRENT_CHECKS)
  }

  // 自动获取所有设备版本信息 - 优化版
  let versionCheckTimer = null

  const autoGetAllDeviceVersions = async () => {
    if (versionCheckTimer) {
      clearTimeout(versionCheckTimer)
    }

    versionCheckTimer = setTimeout(async () => {
      try {
        console.log('自动获取所有设备版本信息 - 优化版')

        const devicesToCheck = []
        const now = Date.now()

        for (const device of devices.value) {
          const lastTime = lastCheckTime.value.get(device.id) || 0
          if (now - lastTime >= MIN_CHECK_INTERVAL) {
            devicesToCheck.push(device)

            if (device.version === 'v3') {
              fetchV3DeviceInfo(device)
            }

            if (token.value) {
              addToBindCheckQueue()
            }
          }
        }

        for (const device of devicesToCheck) {
          addToVersionCheckQueue(device)
        }
        // console.log(`本次自动检查共添加 ${devicesToCheck.length} 个设备到队列`)
      } catch (error) {
        console.error('自动获取所有设备版本信息失败:', error)
      }
    }, 500)
  }

  // 清除「自动获取所有设备版本信息」防抖定时器（组件卸载清理用）。
  // 原 App.vue 是直接读写 `versionCheckTimer`，变量收进闭包后改用这个函数。
  const cancelAutoGetAllDeviceVersions = () => {
    if (versionCheckTimer) {
      clearTimeout(versionCheckTimer)
      versionCheckTimer = null
    }
  }

  return {
    versionCheckQueue,
    priorityQueue,
    isProcessingQueue,
    versionCheckInterval,
    lastCheckTime,
    lastQueueProbeVersion,
    MAX_CONCURRENT_CHECKS,
    CHECK_INTERVAL,
    MIN_CHECK_INTERVAL,
    addToVersionCheckQueue,
    processVersionCheckQueue,
    batchProcessVersionCheckQueue,
    initVersionCheckQueue,
    autoGetAllDeviceVersions,
    cancelAutoGetAllDeviceVersions,
  }
}
