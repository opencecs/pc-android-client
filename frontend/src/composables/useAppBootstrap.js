/**
 * 应用启动引导（原 App.vue 的 onMounted 回调，逐字搬出）：
 *   - 从 localStorage 恢复设备列表 / 设备分组，发现设备、初始化云机分组、拉镜像列表与公告
 *   - 起半小时一轮的"逐个设备刷新容器"定时器
 *   - 初始化版本检查队列、绑定状态检查队列
 *   - 延迟 3 秒启动设备心跳检测服务；有 token 时启动同步授权定时器
 *   - 注册 Wails 下载/上传进度事件、投屏窗口 IPC / 事件 BroadcastChannel
 *   - 往 window 上挂 OpenCecs 等外部组件要用的设备增删 / 查询函数
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 * 只有两处必须改写：hourlyRefreshInterval 与 heartbeatInitialized 是 App.vue 的模块级 let，
 * 本模块改通过 setter 回写（原写法无法跨模块共享 let 绑定）。
 *
 * 状态留在 App.vue，通过依赖对象传入；onMounted / Events / 各 binding 由本模块自己 import。
 */
import { onMounted } from 'vue'
import { Events } from '@wailsio/runtime'
import { ToggleProjectionWindowTop, ArrangeProjectionWindows, HttpRequest, ForceRefreshDeviceInfo, GetDevicesStatus } from '../../bindings/edgeclient/app'

export function useAppBootstrap({
  loadDevicesFromLocalStorage,
  loadDeviceGroupsFromLocalStorage,
  initCloudMachineGroups,
  fetchImageList,
  fetchAnnouncement,
  devices,
  token,
  isDownloadingImage,
  currentDownloadTaskId,
  currentDownloadImage,
  taskQueue,
  t,
  downloadStartTime,
  downloadProgress,
  handleDownloadComplete,
  handleUploadProgress,
  handleUploadComplete,
  devicesStatusCache,
  devicesLastUpdateTime,
  deviceCloudMachinesCache,
  deviceAllInstancesCache,
  activeDevice,
  instances,
  allInstances,
  saveDevicesToLocalStorage,
}, lazyDeps = {}) {
  // 以下依赖来自 App.vue 下方才声明的函数 / 模块级 let，用惰性依赖避免 TDZ
  const {
    discoverAndLoadDevices,
    refreshDevicesContainersOneByOne,
    initVersionCheckQueue,
    initBindCheckQueue,
    autoGetAllDeviceVersions,
    initDeviceHeartbeat,
    startSyncAuthTimer,
    handleSdkUpdateTask,
    handleAddDevice,
    setHourlyRefreshInterval,
    setHeartbeatInitialized,
  } = lazyDeps

  onMounted(() => {
    // 从本地存储加载设备列表
    loadDevicesFromLocalStorage()
    // 从本地存储加载设备分组
    loadDeviceGroupsFromLocalStorage()
    // 发现设备
    discoverAndLoadDevices()

    // 初始化云机分组
    initCloudMachineGroups()
    // 自动缓存所有镜像，避免用户进入镜像管理界面还要手动刷新
    fetchImageList('')

    // 获取系统公告
    fetchAnnouncement()

    // 定时刷新设备数据（10秒）- 已禁用，避免频繁刷新
    // refreshInterval = setInterval(() => {
    //   refreshData()
    // }, 10000)

    // 每半小时刷新一次设备和云机列表（逐个设备）
    setHourlyRefreshInterval(setInterval(() => {
      refreshDevicesContainersOneByOne()
    }, 30 * 60 * 1000)) // 30分钟

    // 初始化版本检查队列 - 每2秒检查一个设备
    initVersionCheckQueue()

    // 初始化设备绑定状态查询队列 - 每1秒检查一次
    initBindCheckQueue()

    // 每10秒自动将所有设备添加到版本检查队列
    // versionRefreshInterval = setInterval(() => {
    //   autoGetAllDeviceVersions()
    // }, 10000) // 10秒

    // 初始加载时获取一次版本信息
    setTimeout(() => {
      autoGetAllDeviceVersions()
    }, 1000) // 延迟1秒执行，确保设备列表已加载

    // ========== 启动设备心跳检测服务 ==========
    // 延迟3秒启动，无论设备列表是否为空都启动服务
    setHeartbeatInitialized(false) // 确保每次挂载都能重新初始化
    setTimeout(() => {
      console.log('[启动] 准备初始化设备心跳检测，当前设备数量:', devices.value.length)
      initDeviceHeartbeat()
    }, 3000) // 3秒启动，确保前端已准备好

    // 检查是否已有token，如果有则启动同步授权定时器
    if (token.value) {
      startSyncAuthTimer()
    }

    // 使用Wails的事件API注册下载进度事件监听器
    const initEventListeners = () => {
      if (!Events || !Events.On) {
        setTimeout(initEventListeners, 500)
        return
      }

      console.log('[事件监听器] 初始化下载进度事件监听器')

      // 注册事件监听器
      Events.On('download-progress', (data) => {
        // 严格验证：必须有活动的下载任务
        if (!isDownloadingImage.value || !currentDownloadTaskId.value || !currentDownloadImage.value) {
          return
        }

        let progress = 0
        if (data && data.data && typeof data.data.progress === 'number') {
          progress = data.data.progress
        } else if (data && typeof data.progress === 'number') {
          progress = data.progress
        }

        // 查找当前活动的下载任务
        const currentTask = taskQueue.value.find(t => 
          t.id === currentDownloadTaskId.value && 
          t.type === 'downloadImage' && 
          t.status === 'running'
        )

        if (!currentTask) {
          return
        }

        // 检查会话时间戳
        const taskSessionTime = currentTask.sessionStartTime || 0
        if (taskSessionTime !== downloadStartTime.value) {
          return
        }

        // 防止进度回退和异常跳跃
        // 钳制到0~100，防止后端异常进度值导致进度超过100%
        const newProgress = Math.max(0, Math.min(100, Math.round(progress)))
        const currentProgress = currentTask.progress || 0

        // 回退检测
        if (newProgress < currentProgress - 3) {
          return
        }

        // 跨度异常检测
        if (currentProgress > 20 && newProgress < 10) {
          return
        }

        // 异常跳跃检测
        if (newProgress - currentProgress > 30) {
          return
        }

        // 更新进度
        downloadProgress.value = progress
        currentTask.progress = newProgress
      })
      Events.On('download-complete', (data) => {
        handleDownloadComplete(data)
      })
      Events.On('upload-progress', (data) => {
        handleUploadProgress(data)
      })
      Events.On('upload-complete', (data) => {
        handleUploadComplete(data)
      })
      Events.On('sdkUpgrade:progress', (event) => {
        handleSdkUpdateTask(event)
      })
    }

    // 延迟注册事件监听器，确保Events模块已加载
    setTimeout(initEventListeners, 100)
    // 设置BroadcastChannel监听器，处理来自投屏窗口的IPC调用
    const ipcChannel = new BroadcastChannel('wails-ipc-child');
    ipcChannel.onmessage = async (event) => {
      if (event.data && event.data.type === 'ipc-request') {
        const { funcName, args, requestId } = event.data;
        console.log('[Main] 收到投屏窗口IPC请求:', funcName, args);

        try {
          let result = null;

          // 根据函数名调用对应的后端方法
          switch (funcName) {
            case 'ToggleProjectionWindowTop':
              if (typeof ToggleProjectionWindowTop === 'function') {
                result = await ToggleProjectionWindowTop(args);
              }
              break;
            case 'ArrangeProjectionWindows':
              if (typeof ArrangeProjectionWindows === 'function') {
                result = await ArrangeProjectionWindows(args);
              }
              break;
            default:
              console.warn('[Main] 未知的函数名:', funcName);
          }

          // 发送响应回投屏窗口
          ipcChannel.postMessage({
            type: 'ipc-response',
            requestId: requestId,
            result: result
          });
        } catch (error) {
          console.error('[Main] IPC调用失败:', error);
          ipcChannel.postMessage({
            type: 'ipc-response',
            requestId: requestId,
            error: error.message
          });
        }
      }
    };

    // 将频道保存到窗口对象，以便后续清理
    window.$wailsIpcChannel = ipcChannel;

    // 设置事件通道监听器，处理来自投屏窗口的Wails事件
    const eventChannel = new BroadcastChannel('wails-events');
    eventChannel.onmessage = async (event) => {
      if (event.data && event.data.type === 'wails-event') {
        const { event: eventName, data } = event.data;
        console.log('[Main] 收到投屏窗口事件:', eventName, data);

        // 根据事件名称调用对应的后端方法
        switch (eventName) {
          case 'ToggleProjectionWindowTop':
            if (typeof ToggleProjectionWindowTop === 'function') {
              await ToggleProjectionWindowTop(data);
            }
            break;
          case 'ArrangeProjectionWindows':
            if (typeof ArrangeProjectionWindows === 'function') {
              await ArrangeProjectionWindows(data || {});
            }
            break;
          default:
            console.warn('[Main] 未处理的事件:', eventName);
        }
      }
    };

    // 将事件频道保存到窗口对象
    window.$wailsEventChannel = eventChannel;

    // 注册全局设备添加函数，供 opencecsManagement 等外部组件调用
    window.addDiscoveredDevice = (device) => {
      handleAddDevice(device)
    }

    // 注册全局设备移除函数，按 IP 移除设备（供 opencecsManagement 刷新时清理旧设备）
    window.removeDiscoveredDevice = (deviceIp) => {
      const idx = devices.value.findIndex(d => d.ip === deviceIp)
      if (idx !== -1) {
        const removed = devices.value[idx]
        devicesStatusCache.value.delete(removed.id)
        devicesLastUpdateTime.value.delete(removed.id)
        devices.value.splice(idx, 1)
        // 清除该设备的云机缓存，避免旧容器对象（携带旧 deviceIp）被复用
        deviceCloudMachinesCache.value.delete(deviceIp)
        deviceAllInstancesCache.value.delete(deviceIp)
        // 如果当前正在查看的设备被移除，清空容器列表，避免旧 deviceIp 的容器残留
        if (activeDevice.value && activeDevice.value.ip === deviceIp) {
          instances.value = []
          allInstances.value = []
        }
        saveDevicesToLocalStorage()
        console.log(`[removeDiscoveredDevice] 已移除设备: ${deviceIp}`)
      }
    }

    // 注册全局按来源批量移除设备函数（供 OpenCecs 等模块清理所有注入的设备）
    window.removeDevicesBySource = (source) => {
      const toRemove = devices.value.filter(d => d.source === source)
      if (toRemove.length === 0) return
      for (const device of toRemove) {
        devicesStatusCache.value.delete(device.id)
        devicesLastUpdateTime.value.delete(device.id)
        deviceCloudMachinesCache.value.delete(device.ip)
        deviceAllInstancesCache.value.delete(device.ip)
        if (activeDevice.value && activeDevice.value.ip === device.ip) {
          instances.value = []
          allInstances.value = []
        }
      }
      devices.value = devices.value.filter(d => d.source !== source)
      saveDevicesToLocalStorage()
      console.log(`[removeDevicesBySource] 已移除 ${toRemove.length} 个 ${source} 设备`)
    }

    // 暴露 Go IPC 函数供 opencecsManagement 等外部组件调用
    window.goHttpRequest = HttpRequest
    window.goForceRefreshDeviceInfo = ForceRefreshDeviceInfo
    window.goGetDevicesStatus = GetDevicesStatus

    // 暴露设备列表给 opencecsManagement 退出登录时兜底查找
    window.getDevicesList = () => devices.value

    // 注册专用的 OpenCecs 设备全部清理函数（退出登录时调用，确保万无一失）
    window.removeAllOpenCecsDevicesFromHost = (extraIps = []) => {
      console.log('========== [App.vue] removeAllOpenCecsDevicesFromHost 被调用 ==========')
      console.log('[App.vue] 传入的 extraIps:', extraIps)
      const extraIpSet = new Set(extraIps)
      const before = devices.value.length
      console.log(`[App.vue] 当前设备总数: ${before}`)

      // 逐个设备检查匹配情况
      devices.value.forEach((d, i) => {
        const matchSource = d.source === 'opencecs'
        const matchName = d.name === 'opencecs'
        const matchIp = extraIpSet.has(d.ip)
        const matchPort = d.ip && d.ip.includes(':')
        const matched = matchSource || matchName || matchIp || matchPort
        console.log(`[App.vue] 设备[${i}]: ip=${d.ip}, name=${d.name}, source=${d.source}, id=${d.id} → ${matched ? '✅ 匹配删除' : '❌ 保留'}${matchSource ? ' (source)' : ''}${matchName ? ' (name)' : ''}${matchIp ? ' (IP)' : ''}${matchPort ? ' (IP:port格式)' : ''}`)
      })

      // 找出所有 OpenCecs 设备：按 source / name / IP列表 / IP:port格式 多重匹配
      const toRemove = devices.value.filter(d => {
        if (d.source === 'opencecs') return true
        if (d.name === 'opencecs') return true
        if (extraIpSet.has(d.ip)) return true
        // 兜底：OpenCecs 公网设备的 IP 格式为 publicIP:port（含冒号+端口号）
        // 正常局域网设备为纯 IP（如 10.10.11.46），不会含冒号
        if (d.ip && d.ip.includes(':')) return true
        return false
      })

      if (toRemove.length === 0) {
        console.log('[App.vue] devices.value 中无匹配设备')
        // 即使内存中没有，也要检查并清理 localStorage 中的残留
        try {
          const saved = localStorage.getItem('edgeclient_devices')
          if (saved) {
            const savedDevices = JSON.parse(saved)
            const cleaned = savedDevices.filter(d => {
              if (d.source === 'opencecs') return false
              if (d.name === 'opencecs') return false
              if (extraIpSet.has(d.ip)) return false
              if (d.ip && d.ip.includes(':')) return false
              return true
            })
            if (cleaned.length < savedDevices.length) {
              localStorage.setItem('edgeclient_devices', JSON.stringify(cleaned))
              // 同步到 devices.value
              devices.value = cleaned
              console.log(`[App.vue] ✅ 已从 localStorage 清理 ${savedDevices.length - cleaned.length} 个 opencecs 残留设备`)
              return savedDevices.length - cleaned.length
            }
          }
        } catch (e) {
          console.error('[App.vue] 清理 localStorage 残留失败:', e)
        }
        console.log('[App.vue] ⚠️ localStorage 中也无 opencecs 残留设备')
        return 0
      }

      // 清理缓存
      for (const device of toRemove) {
        devicesStatusCache.value.delete(device.id)
        devicesLastUpdateTime.value.delete(device.id)
        deviceCloudMachinesCache.value.delete(device.ip)
        deviceAllInstancesCache.value.delete(device.ip)
        if (activeDevice.value && activeDevice.value.ip === device.ip) {
          activeDevice.value = null
          instances.value = []
          allInstances.value = []
        }
      }

      // 从列表中移除
      const removeIps = new Set(toRemove.map(d => d.ip))
      const removeIds = new Set(toRemove.map(d => d.id))
      devices.value = devices.value.filter(d => !removeIps.has(d.ip) && !removeIds.has(d.id))

      saveDevicesToLocalStorage()
      console.log(`[App.vue] ✅ 已移除 ${toRemove.length} 个设备 (${before} → ${devices.value.length})，IP: ${toRemove.map(d => d.ip).join(', ')}`)
      return toRemove.length
    }
  })
}
