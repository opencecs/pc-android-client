/**
 * 任务队列：入队、执行、取消、重试失败、清理。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue（taskQueue 等），需要的一堆 ref / 宿主函数通过依赖对象传入，
 * 不用 provide/inject。ElMessage / ElMessageBox 与 wails binding 由本模块自己 import。
 *
 * `t` 是 App.vue 里的本地 i18n 包装，通过依赖对象传入。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getContainers,
  startContainer,
  stopContainer,
  deleteContainer,
  resetAndroidContainer,
  restartAndroidContainer,
  getDevicePassword,
} from '../services/api.js'
import { getDeviceAddr, extractPort9082 } from '../utils/device.js'
import { generateTaskId } from '../utils/format.js'
import {
  LoadImageToDevice,
  UploadFileToCloudMachine,
  InstallAPK,
  HttpRequest,
  GetImages,
  CancelImageDownload,
  CancelImageUpload,
} from '../../bindings/edgeclient/app'

export function useTaskQueue({
  t,
  cloudManageMode,
  selectedCloudDevice,
  taskQueue,
  opencecsManagementRef,
  imageList,
  isDownloadingImage,
  downloadProgress,
  currentDownloadImage,
  currentDownloadTaskId,
  downloadStartTime,
  isUploadingImage,
  uploadProgress,
  currentUploadImage,
  imageCategory,
  currentSlot,
  createForm,
  switchCloudMachineModel,
  selectedDevicesForUpload,
  isUploadingToMultipleDevices,
  authRetry,
  backupListVisible,
  initBackupList,
  createCloudMachine,
  clearContainerScreenshotCache,
  batchSwitchCountryCode,
  fetchAndroidContainers,
}) {
  const addTaskToQueue = (taskType, targets, metadata = {}) => {
    console.log(`[addTaskToQueue] taskType: ${taskType}, targets length: ${targets?.length}, targets:`, targets)

    // 从targets中提取设备IP信息
    const deviceIps = new Set()
    if (targets && targets.length > 0) {
      targets.forEach(target => {
        // 支持多种设备IP字段格式（deviceIp小写、deviceIP大写、ip字段）
        if (target.deviceIp) {
          deviceIps.add(target.deviceIp)
        } else if (target.deviceIP) {
          deviceIps.add(target.deviceIP)
        } else if (target.ip) {
          // 设备对象直接有ip字段（如selectedDevicesForUpload中的设备）
          deviceIps.add(target.ip)
        } else if (target.device && target.device.ip) {
          // 嵌套在device对象中
          deviceIps.add(target.device.ip)
        }
      })
    }

    console.log(`[addTaskToQueue] deviceIps:`, Array.from(deviceIps))

    // 根据操作类型设置不同的超时时间
    const getTimeout = (type) => {
      switch (type) {
        case 'restart': // 重启需要stop+start，通常需要更长时间
        case 'start':   // 启动操作
        case 'reset':   // 重置操作通常需要更长时间
          return 30000  // 30秒
        case 'shutdown': // 关机操作
          return 15000  // 15秒
        case 'delete':   // 删除操作
          return 200000  // 20秒
        case 'create':   // 创建操作不使用超时限制
          return 0      // 不限制超时
        case 'switchModel': // 切换机型
          return 20000  // 20秒
        case 'uploadFile':
          return 0      // 不限制超时
        case 'uploadImage': // 批量上传镜像不限制超时
          return 0
        case 'downloadImage': // 下载镜像不限制超时
          return 0
        case 'updateImage': // 批量更新镜像不限制超时
          return 0
        case 'upload': // 上传文件
          return 0  // 不限制超时
        default:
          return 500000   // 默认5秒
      }
    }

    // 初始化每个设备的进度统计
    const deviceProgress = {}
    for (const deviceIP of deviceIps) {
      // 根据任务类型设置每个设备的总任务数
      let total = 0
      if (taskType === 'uploadImage') {
        total = 1 // 每个设备上传一个镜像
      } else if (taskType === 'uploadFile') {
        // 统计该设备关联的云机数量
        const deviceTargets = targets.filter(t => 
          (t.deviceIP && t.deviceIP === deviceIP) ||
          (t.ip && t.ip === deviceIP) ||
          (t.device && t.device.ip && t.device.ip === deviceIP)
        )
        total = deviceTargets.reduce((count, target) => {
          return count + (target.machines?.length || 0)
        }, 0)
      }

      deviceProgress[deviceIP] = {
        total: total,
        completed: 0,
        failed: 0
      }
    }

    // 计算uploadFile任务的总云机数量
    let totalMachines = targets.length
    if (taskType === 'uploadFile') {
      totalMachines = targets.reduce((count, target) => {
        return count + (target.machines?.length || 0)
      }, 0)
    }

    const task = {
      id: generateTaskId(),
      type: taskType,
      status: 'pending',
      total: taskType === 'uploadFile' ? totalMachines : targets.length,
      completed: 0,
      failed: 0,
      progress: 0,
      targets: [...targets],
      deviceIps: Array.from(deviceIps), // 操作的设备IP列表
      deviceProgress, // 每个设备的进度统计
      timeout: getTimeout(taskType), // 根据操作类型设置超时
      startTime: null,
      endTime: null,
      failedTargets: [],
      currentStep: taskType === 'create' && targets.some(t => t.isLocalImage) ? 'image' : null, // 创建任务：先推送镜像
      imageProgress: taskType === 'create' && targets.some(t => t.isLocalImage) ? 0 : null,
      ...metadata // 合并额外的任务元数据
    }
    taskQueue.value.unshift(task)
    return task.id
  }

  // 处理复制云机任务（SSE 流式进度）
  const handleStartCopyTask = ({ device, name, indexNum, count, version }) => {
    const ip = device.ip
    const endpoint = version === 'v3'
      ? `http://${getDeviceAddr(ip)}/android/copy?name=${encodeURIComponent(name)}&indexNum=${indexNum}&count=${count}`
      : `http://${getDeviceAddr(ip)}/androidV2/copy?name=${encodeURIComponent(name)}&indexNum=${indexNum}&count=${count}`

    // 创建任务对象并加入队列
    const taskId = generateTaskId()
    const task = {
      id: taskId,
      type: 'copy',
      status: 'running',
      total: count,
      completed: 0,
      failed: 0,
      progress: 0,
      targets: [{ deviceIp: ip }],
      deviceIps: [ip],
      deviceProgress: {},
      timeout: 0,
      startTime: Date.now(),
      endTime: null,
      failedTargets: [],
      currentStep: null,
      imageProgress: null,
      copyLogs: [],           // 流式日志
      sourceName: name,
      copyVersion: version
    }
    taskQueue.value.unshift(task)

    // 构建鉴权 header
    const savedPassword = getDevicePassword(ip)
    const headers = {}
    if (savedPassword) {
      const auth = btoa(`admin:${savedPassword}`)
      headers['Authorization'] = `Basic ${auth}`
    }

    // 通过 fetch 读取 SSE 流
    fetch(endpoint, { headers })
      .then(async res => {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // 按行解析 SSE data
          const lines = buffer.split('\n')
          buffer = lines.pop() // 保留未完成的一行
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const jsonStr = trimmed.slice(5).trim()
            if (!jsonStr) continue
            try {
              const data = JSON.parse(jsonStr)
              const t = taskQueue.value.find(t => t.id === taskId)
              if (!t) break
              if (data.status === 'done') {
                // 最终汇总
                const successCount = data.success?.length || 0
                const failedMap = data.failed || {}
                const failedCount = Object.keys(failedMap).length
                t.completed = successCount
                t.failed = failedCount
                t.total = data.total || count
                t.progress = 100
                t.status = failedCount > 0 ? (successCount > 0 ? 'completed' : 'failed') : 'completed'
                t.endTime = Date.now()
                // 补充失败详情到 failedTargets
                Object.entries(failedMap).forEach(([machineName, error]) => {
                  t.failedTargets.push({ deviceIP: ip, machineName, error })
                })
              } else {
                // 逐条进度
                t.total = data.total || count
                // 更新最新进度（当前处理到第几个）
                if (data.current > t.completed + t.failed) {
                  if (data.status === 'success') {
                    t.completed = data.current
                  } else if (data.status === 'failed') {
                    t.failed += 1
                  }
                }
                const processed = t.completed + t.failed
                t.progress = t.total > 0 ? Math.round((processed / t.total) * 100) : 0
                // 追加日志（去掉相同 name+status 的旧条目，只保留最新状态）
                const existIdx = t.copyLogs.findIndex(l => l.name === data.name && l.status !== 'success' && l.status !== 'failed')
                if (existIdx >= 0) {
                  t.copyLogs.splice(existIdx, 1, { current: data.current, total: data.total, name: data.name, status: data.status, message: data.message })
                } else {
                  t.copyLogs.push({ current: data.current, total: data.total, name: data.name, status: data.status, message: data.message })
                }
              }
            } catch (e) {
              // JSON解析失败忽略
            }
          }
        }
        // 流结束后确保状态为完成
        const t = taskQueue.value.find(t => t.id === taskId)
        if (t && t.status === 'running') {
          t.status = t.failed > 0 ? (t.completed > 0 ? 'completed' : 'failed') : 'completed'
          t.progress = 100
          t.endTime = Date.now()
        }
      })
      .catch(err => {
        const t = taskQueue.value.find(t => t.id === taskId)
        if (t) {
          t.status = 'failed'
          t.endTime = Date.now()
          t.failedTargets.push({ deviceIP: ip, error: err.message || '网络错误' })
        }
      })
  }

  // 执行单个任务
  const executeTask = async (taskId) => {
    const task = taskQueue.value.find(t => t.id === taskId)
    console.log(`[executeTask] taskId: ${taskId}, task:`, task)

    if (!task || task.status !== 'pending') {
      console.log(`[executeTask] 任务不存在或状态不是pending，返回`)
      return
    }

    if (task.status === 'canceled') {
      return
    }

    console.log(`[executeTask] 开始执行任务，targets数量: ${task.targets.length}`)

    task.status = 'running'
    task.startTime = new Date()
    task.completed = 0
    task.failed = 0
    task.progress = 0
    task.failedTargets = []

    // 初始化每个设备的任务总数（用于上传文件/镜像任务）
    if (task.deviceProgress) {
      for (const deviceIP of task.deviceIps) {
        if (task.type === 'uploadFile') {
          // 统计该设备关联的云机数量（支持多种字段格式）
          const deviceTargets = task.targets.filter(t => 
            (t.deviceIP && t.deviceIP === deviceIP) ||
            (t.ip && t.ip === deviceIP) ||
            (t.device && t.device.ip && t.device.ip === deviceIP)
          )
          const machineCount = deviceTargets.reduce((count, target) => {
            return count + (target.machines?.length || 0)
          }, 0)
          task.deviceProgress[deviceIP] = {
            total: machineCount,
            completed: 0,
            failed: 0
          }
        } else if (task.type === 'uploadImage') {
          // 统计该设备的镜像上传任务数（支持多种字段格式）
          const deviceTargets = task.targets.filter(t => 
            (t.deviceIP && t.deviceIP === deviceIP) ||
            (t.ip && t.ip === deviceIP) ||
            (t.device && t.device.ip && t.device.ip === deviceIP)
          )
          task.deviceProgress[deviceIP] = {
            total: deviceTargets.length,
            completed: 0,
            failed: 0
          }
        }
      }
    }

    try {
      // 处理下载镜像任务
      if (task.type === 'downloadImage') {
        // 下载镜像任务不需要并发执行，直接返回，由后端事件处理进度和结果
        return
      }

      // 按设备IP分组，同一设备的任务串行执行，不同设备的任务可以并行
      // 这样可以避免同一设备被并发请求压垮
      const targetsByDevice = {}
      task.targets.forEach(target => {
        // 支持多种设备IP字段格式（deviceIp小写、deviceIP大写、ip字段）
        const deviceIP = target.deviceIp || target.deviceIP || target.ip || (target.device && target.device.ip)
        if (!deviceIP) {
          console.log(`[executeTask] 跳过没有deviceIP的target:`, target)
          return
        }
        if (!targetsByDevice[deviceIP]) {
          targetsByDevice[deviceIP] = []
        }
        targetsByDevice[deviceIP].push(target)
      })

      const deviceIPs = Object.keys(targetsByDevice)
      console.log(`[executeTask] deviceIPs: ${deviceIPs}, targetsByDevice:`, targetsByDevice)

      if (deviceIPs.length === 0) {
        console.log(`[executeTask] 没有设备IP，任务完成`)
        task.status = 'completed'
        task.endTime = new Date()
        return
      }

      const maxConcurrentDevices = 4 // 最多同时处理4个设备
      const runningCount = { value: 0 }

      // 串行执行同一设备的所有任务 (上传任务除外,上传任务完全并发)
      const processDeviceSerially = async (deviceIP, targets) => {
        try {
          if (task.status === 'canceled') {
            return
          }

          // ========== 特殊处理: 上传任务限制并发 ==========
          if (task.type === 'uploadFile') {
            // 限制同一设备并发上传数，避免压垮设备
            const MAX_CONCURRENT_UPLOADS = 3
            const runWithLimit = (() => {
              let running = 0
              const queue = []
              const next = () => {
                if (queue.length > 0 && running < MAX_CONCURRENT_UPLOADS) {
                  running++
                  const { fn, resolve } = queue.shift()
                  fn().finally(() => { running--; next() }).then(resolve)
                }
              }
              return (fn) => new Promise(resolve => {
                if (running < MAX_CONCURRENT_UPLOADS) {
                  running++
                  fn().finally(() => { running--; next() }).then(resolve)
                } else {
                  queue.push({ fn, resolve })
                }
              })
            })()

            // 创建所有上传任务(所有文件×所有容器,限制并发)
            const allUploadPromises = targets.map(async (target) => {
              if (task.status === 'canceled') {
                return
              }

              try {
                const { filePath, isAPK, deviceIP: uploadDeviceIP, deviceVersion, machines, apkOptions } = target
                const targetDevice = { ip: uploadDeviceIP, version: deviceVersion || 'v3' }

                const runUploadWithAuth = async (password, containerID) => {
                  let result
                  if (isAPK) {
                    // 传递 APK 安装选项
                    result = await InstallAPK(
                      uploadDeviceIP,
                      deviceVersion,
                      containerID,
                      filePath,
                      password || '',
                      apkOptions || {}
                    )
                  } else {
                    result = await UploadFileToCloudMachine(
                      uploadDeviceIP,
                      deviceVersion,
                      containerID,
                      filePath,
                      password || ''
                    )
                  }

                  if (result && (result.code === 61 || result.message === 'Authentication Failed' || result.errorType === 'auth_required')) {
                    throw new Error('Authentication Failed')
                  }
                  return result
                }

                // 为每个文件创建所有容器的上传任务（限制并发）
                const machineUploadPromises = machines.map((machine) => {
                  // 容器名优先于 docker ID：排队期间云机可能被设备销毁重建（同名、新 ID），
                  // 按旧 ID 找会扑空（"容器不存在"）；名字/坑位才是稳定身份，
                  // 后端 getContainerByID 会按 indexNum/名称命中重建后的新容器
                  const containerID = machine.name || machine.containerID
                  const displayName = machine.name || machine.id || machine.indexNum || '云机'

                  return runWithLimit(async () => {
                    try {
                      const fileResult = await authRetry(targetDevice, async (password) => {
                        return await runUploadWithAuth(password, containerID)
                      })

                      if (fileResult && fileResult.success) {
                        // 更新全局任务进度
                        task.completed++
                        console.log(`文件 ${filePath.split('\\').pop().split('/').pop()} 上传到云机 ${displayName} 成功`)

                        // 立即更新设备进度
                        if (task.deviceProgress && uploadDeviceIP) {
                          if (!task.deviceProgress[uploadDeviceIP]) {
                            task.deviceProgress[uploadDeviceIP] = { total: 0, completed: 0, failed: 0 }
                          }
                          task.deviceProgress[uploadDeviceIP].completed++
                        }

                        // APK安装成功
                        if (isAPK && fileResult.installed && fileResult.uploadPath) {
                          console.log(`APK安装成功,文件保留在: ${fileResult.uploadPath}`)
                        }

                        return { success: true, machine: displayName, machineObj: machine }
                      } else {
                        // 更新全局任务进度
                        task.failed++
                        console.error(`文件 ${filePath.split('\\').pop().split('/').pop()} 上传到云机 ${displayName} 失败`)

                        // 立即更新设备进度（失败）
                        if (task.deviceProgress && uploadDeviceIP) {
                          if (!task.deviceProgress[uploadDeviceIP]) {
                            task.deviceProgress[uploadDeviceIP] = { total: 0, completed: 0, failed: 0 }
                          }
                          task.deviceProgress[uploadDeviceIP].failed++
                        }

                        return { success: false, machine: displayName, machineObj: machine, error: fileResult?.message }
                      }
                    } catch (error) {
                      // 更新全局任务进度
                      task.failed++
                      console.error(`上传文件 ${filePath.split('\\').pop().split('/').pop()} 到云机 ${displayName} 失败:`, error.message)

                      // 立即更新设备进度（异常）
                      if (task.deviceProgress && uploadDeviceIP) {
                        if (!task.deviceProgress[uploadDeviceIP]) {
                          task.deviceProgress[uploadDeviceIP] = { total: 0, completed: 0, failed: 0 }
                        }
                        task.deviceProgress[uploadDeviceIP].failed++
                      }

                      return { success: false, machine: displayName, machineObj: machine, error: error.message }
                    }
                  })
                })

                // 等待该文件的所有容器上传完成，并收集每台云机的结果
                // 任务卡片的"失败原因"渲染的是 failedTargets，之前这里把结果丢掉了，
                // 导致批量上传失败时只显示个数、看不到原因，"重试失败"按钮也一直无效
                const uploadResults = await Promise.allSettled(machineUploadPromises)
                uploadResults.forEach(r => {
                  const res = r.status === 'fulfilled' ? r.value : null
                  if (!res) return

                  // 按云机去重统计（完成弹窗用）：一台云机任一文件失败就算失败
                  if (!task.uploadResultMachines) task.uploadResultMachines = new Map()
                  const mkey = `${uploadDeviceIP}_${res.machine}`
                  const prev = task.uploadResultMachines.get(mkey) || { success: 0, failed: 0 }
                  if (res.success) prev.success++
                  else prev.failed++
                  task.uploadResultMachines.set(mkey, prev)

                  if (!res.success) {
                    // 失败记录同时按可重试的 target 形状保存（machine.name 优先解析，
                    // 重试时即使云机重建过也能命中）
                    task.failedTargets.push({
                      filePath,
                      isAPK,
                      deviceIP: uploadDeviceIP,
                      deviceIp: uploadDeviceIP, // retryFailedTask 按 deviceIp 提取设备列表
                      deviceVersion: target.deviceVersion || 'v3',
                      apkOptions: target.apkOptions || {},
                      machines: [res.machineObj],
                      machineName: res.machine,
                      error: res.error || '未知错误'
                    })
                  }
                })

              } catch (error) {
                console.error(`处理上传任务失败:`, error)
              }
            })

            // 等待所有文件的所有容器上传完成(限制并发)
            await Promise.allSettled(allUploadPromises)
            return
          }
          // ========== 上传任务并发处理结束 ==========

          // 其他任务类型保持串行
          if (task.type === 'create' && targets.length > 0 && targets[0].isLocalImage) {
            const target = targets[0]
            const deviceVersion = target.deviceVersion || 'v3'

            const onlineUrl = target.localImageOnlineUrl
            console.log(`[批量创建] 设备 ${deviceIP} 本地镜像在线地址: ${onlineUrl}`)

            const savedPassword = getDevicePassword(deviceIP)
            const deviceImages = await GetImages(deviceIP, deviceVersion, savedPassword || '')
            console.log(`[批量创建] 设备 ${deviceIP} 镜像列表:`, deviceImages)

            let imageExists = false
            if (onlineUrl) {
              if (Array.isArray(deviceImages)) {
                imageExists = deviceImages.some(img => {
                  const repoTags = img.RepoTags || img.imageUrl || img.Image
                  if (Array.isArray(repoTags)) {
                    return repoTags.includes(onlineUrl) || repoTags.some(tag => tag.includes(onlineUrl))
                  }
                  return repoTags === onlineUrl || (typeof repoTags === 'string' && repoTags.includes(onlineUrl))
                })
              } else if (deviceImages && deviceImages.list) {
                imageExists = deviceImages.list.some(img => {
                  const imgUrl = img.imageUrl || img.Image
                  return imgUrl === onlineUrl || (typeof imgUrl === 'string' && imgUrl.includes(onlineUrl))
                })
              }
            }

            console.log(`[批量创建] 检查镜像 ${onlineUrl} 是否存在:`, imageExists)

            if (!imageExists) {
              console.log(`[批量创建] 设备 ${deviceIP} 镜像不存在，开始推送本地镜像...`)

              task.imageProgress = 0
              const progressInterval = setInterval(() => {
                if (task.status === 'canceled') {
                  clearInterval(progressInterval)
                  return
                }
                if (task.imageProgress < 90) {
                  task.imageProgress += 10
                }
              }, 200)

              const password = getDevicePassword(deviceIP)
              const loadResult = await LoadImageToDevice(deviceIP, target.localImageUrl, deviceVersion, password || '')

              clearInterval(progressInterval)
              if (task.status === 'canceled') {
                return
              }
              task.imageProgress = 100

              console.log(`[批量创建] 设备 ${deviceIP} 镜像推送结果:`, loadResult)

              if (!loadResult.success) {
                console.error(`[批量创建] 设备 ${deviceIP} 镜像推送失败:`, loadResult.message)
                for (const t of targets) {
                  task.failed++
                  task.failedTargets.push({
                    ...t,
                    error: `镜像推送失败: ${loadResult.message || '未知错误'}`
                  })
                }
                return
              }
            } else {
              console.log(`[批量创建] 设备 ${deviceIP} 镜像已存在（在线地址: ${onlineUrl}），跳过推送`)
              if (task.status !== 'canceled') {
                task.imageProgress = 100
              }
            }

            if (task.status === 'canceled') {
              return
            }
            task.currentStep = 'create'
          }

          for (const target of targets) {
            if (task.status === 'canceled') {
              break
            }
            try {
            // 根据任务类型创建对应的操作Promise
            const createOperationPromise = async () => {
              // 确保 containerName 是字符串
              let containerName = ''
              const targetName = target.name || target.id || target.ID
              if (typeof targetName === 'string') {
                containerName = targetName
              } else if (targetName && typeof targetName === 'object') {
                containerName = targetName.name || targetName.id || String(targetName)
              } else {
                containerName = String(targetName || '')
              }

              // uploadFile任务已在processDeviceSerially开头并发处理,这里不再处理
              switch (task.type) {
                  case 'restart': {
                    const device = { ip: target.deviceIp, version: target.deviceVersion || 'v3' }

                    // 重启容器前，清空该容器的截图缓存，避免显示旧截图
                    clearContainerScreenshotCache(device, target)

                    await restartAndroidContainer(device, containerName)
                    return true
                  }

                  case 'start': {
                    const startDevice = { ip: target.deviceIp, version: target.deviceVersion || 'v3' }
                    await startContainer(startDevice, containerName)
                    return true
                  }

                  case 'reset': {
                    const device = { ip: target.deviceIp, version: target.deviceVersion || 'v3' }

                    // 重置容器前，清空该容器的截图缓存，避免显示旧截图
                    clearContainerScreenshotCache(device, target)

                    // 从任务中获取 start 参数（metadata 通过 spread 合并到 task 上），默认为 true
                    const resetStart = task.start !== undefined ? task.start : true
                    console.log('[重置任务执行] start参数:', resetStart, 'task.start:', task.start)
                    await resetAndroidContainer(device, containerName, null, resetStart)
                    return true
                  }

                  case 'shutdown': {
                    await stopContainer({ ip: target.deviceIp, version: target.deviceVersion || 'v3' }, containerName)
                    return true
                  }

                  case 'delete': {
                    await deleteContainer({ ip: target.deviceIp, version: target.deviceVersion || 'v3' }, containerName)
                    return true
                  }

                  case 'uploadImage': {
                    // 从 target 中提取设备信息和镜像路径
                    const uploadDeviceIP = target.deviceIP || target.ip || (target.device && target.device.ip)
                    const deviceVersion = target.deviceVersion || (target.device && target.device.version) || 'v3'
                    const imagePath = target.imagePath || task.imagePath
                    const imageName = task.imageName

                    if (!uploadDeviceIP || !imagePath) {
                      throw new Error('缺少设备IP或镜像路径')
                    }

                    const password = getDevicePassword(uploadDeviceIP)
                    const result = await LoadImageToDevice(uploadDeviceIP, imagePath, deviceVersion, password || '')

                    if (result.success) {
                      return true
                    } else {
                      throw new Error(result.message || '上传失败')
                    }
                  }

                  case 'switchModel': {
                    // 获取传递的 modelInfo
                    const modelInfo = task.modelInfo || task.modelId
                    const modelName = task.modelName

                    // 批量随机机型去重：按任务维度记录已分配的随机机型 ID
                    if (!task.usedRandomModelIds) task.usedRandomModelIds = []
                    const isRandomModel = (modelInfo && modelInfo.value === 'random') || modelInfo === 'random'
                    const excludeIds = isRandomModel ? [...task.usedRandomModelIds] : []
                    const onRandomSelected = (selectedId) => {
                      if (selectedId && !task.usedRandomModelIds.includes(selectedId)) {
                        task.usedRandomModelIds.push(selectedId)
                      }
                    }

                    // V2容器使用一键新机接口，不支持指定机型
                    if (target.androidType === 'V2') {
                      // V2容器只能调用一键新机接口
                      const device = { ip: target.deviceIp, version: target.deviceVersion || 'v3' }

                      // 判断使用哪个IP和端口
                      let host, port
                      if (target.networkName === 'myt' || target.networkMode === 'myt' || target.network === 'myt') {
                        // myt网络：使用容器IP + 9082端口
                        host = target.ip
                        port = 9082
                      } else {
                        // 非myt网络：使用端口映射
                        host = device.ip
                        // OpenCecs 公网设备：deviceIp 含端口，提取纯 IP
                        if (host && host.includes(':')) host = host.split(':')[0]
                        port = extractPort9082(target) || 9082
                      }

                      const modifyDevUrl = `http://${host}:${port}/modifydev?cmd=2`
                      console.log(`[批量新机-V2容器] 调用一键新机API: ${modifyDevUrl}`)

                      const result = await HttpRequest({
                        url: modifyDevUrl,
                        method: 'GET'
                      })

                      if (result.success) {
                        console.log(`[批量新机-V2容器] ${containerName} 一键新机成功`)
                        return true
                      } else {
                        throw new Error(`一键新机失败: ${result.status}`)
                      }
                    } else {
                      // 非V2容器使用切换机型接口
                      // 根据容器镜像的 os_ver 推导安卓大版本，避免随机机型跨版本匹配
                      let switchAndroidVer = ''
                      try {
                        const imgUrl = target.image || target.Image
                        if (imgUrl) {
                          const img = imageList.value.find(i => i.url === imgUrl)
                          if (img && img.os_ver) {
                            const verMatch = img.os_ver.match(/and(\d+)/i)
                            if (verMatch && verMatch[1]) switchAndroidVer = verMatch[1]
                          }
                        }
                      } catch (e) { /* ignore */ }
                      await switchCloudMachineModel({ ip: target.deviceIp, version: target.deviceVersion || 'v3' }, containerName, modelInfo, modelName, batchSwitchCountryCode.value, switchAndroidVer, excludeIds, onRandomSelected)
                      return true
                    }
                  }

                  case 'create': {
                    if (task.status === 'canceled') {
                      throw new Error('任务已取消')
                    }
                    const device = { ip: target.deviceIp, version: target.deviceVersion || 'v3', id: target.deviceId }

                    // 通过 formOverride 传递任务参数，避免修改共享的 createForm 导致界面抖动
                    const formOverride = {
                      createType: target.createType || 'simulator',
                      imageCategory: target.isLocalImage ? 'local' : 'online',
                      imageSelect: target.isLocalImage ? '' : target.imageUrl,
                      customImageUrl: '',
                      localImageUrl: target.isLocalImage ? target.localImageUrl : '',
                      modelType: target.modelType || 'online',
                      localModel: target.localModel || '',
                      modelStatic: target.modelStatic || '',
                      androidVersion: target.androidVersion || createForm.value.androidVersion,
                      vpcGroupId: target.vpcGroupId || '',
                      vpcNodeId: target.vpcNodeId || '',
                      vpcSelectMode: target.vpcNodeId === 'random' ? 'random' : 'specified',
                      macVlanIp: target.macVlanIp || '',
                      containerMacVlanIp: target.macVlanIp || '',
                      mytBridgeName: target.mytBridgeName || '',
                      containerNetworkCardType: target.networkCardType || 'private',
                      resolution: target.resolution || createForm.value.resolution,
                      customResolution: target.customResolution || createForm.value.customResolution,
                      dns: target.dns || createForm.value.dns,
                      customDns: target.customDns || createForm.value.customDns,
                      sandboxMode: target.sandboxMode !== undefined ? target.sandboxMode : createForm.value.sandboxMode,
                      sandboxSize: target.dataDiskSize ? parseInt(target.dataDiskSize) : createForm.value.sandboxSize,
                    }

                    const success = await createCloudMachine(
                      device,
                      target.slot,
                      target.modelName,
                      () => task.status === 'canceled',
                      { start: target.start, formOverride }
                    )

                    // 容器创建成功后，为 OpenCecs 公网设备自动创建端口映射
                    // 仅对公网设备（IP 包含 ":"，即 publicIp:publicPort 格式）生效，局域网设备跳过
                    if (success && target.deviceIp && target.deviceIp.includes(':')) {
                      try {
                        if (opencecsManagementRef.value) {
                          // 从 OpenCecs 实例列表中找到匹配的实例 ID
                          let matchedInstance = opencecsManagementRef.value.getInstanceByDeviceIp?.(target.deviceIp)

                          if (!matchedInstance) {
                            // fallback：按公网 IP 前缀从 openCecsPortMap 反查已知的 deviceIp
                            console.warn(`[端口映射] getInstanceByDeviceIp 未匹配到实例 (${target.deviceIp})，尝试 fallback...`)
                            // 刷新一次实例列表再重试
                            try {
                              await opencecsManagementRef.value.fetchInstances?.()
                              // 等待端口映射设置完成
                              await new Promise(r => setTimeout(r, 5000))
                              matchedInstance = opencecsManagementRef.value.getInstanceByDeviceIp?.(target.deviceIp)
                              if (matchedInstance) {
                                console.log(`[端口映射] fallback 成功找到实例: ${matchedInstance.instance_id}`)
                              }
                            } catch (retryErr) {
                              console.warn('[端口映射] fallback 刷新实例失败:', retryErr)
                            }
                          }

                          if (matchedInstance) {
                            console.log(`[端口映射] 开始为公网设备创建容器端口映射 (${target.deviceIp}), instanceId=${matchedInstance.instance_id}`)
                            await opencecsManagementRef.value.ensureContainerPortMappings(matchedInstance.instance_id, target.deviceIp)
                          } else {
                            console.warn(`[端口映射] ⚠️ 公网设备 ${target.deviceIp} 未找到匹配的 OpenCecs 实例，跳过端口映射。请检查 OpenCecs 是否已登录并刷新实例列表。`)
                          }
                        } else {
                          console.warn(`[端口映射] ⚠️ opencecsManagementRef 不可用，无法为公网设备 ${target.deviceIp} 创建端口映射`)
                        }
                      } catch (e) {
                        console.warn('[端口映射] 容器创建后自动映射失败:', e)
                      }
                    }

                    return success
                  }

                  default:
                    throw new Error(`未知的任务类型: ${task.type}`)
                }
              }

            // 创建带超时的Promise（超时后返回null表示需要验证）
            const operationWithTimeout = async () => {
              if (task.timeout === 0) {
                return await createOperationPromise()
              }

              const timeoutMs = task.timeout
              console.log(`开始执行${task.type}操作，超时时间: ${timeoutMs}ms`)

              let timeoutId
              const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                  reject(new Error('任务超时'))
                }, timeoutMs)
              })

              try {
                const result = await Promise.race([
                  createOperationPromise(),
                  timeoutPromise
                ])
                clearTimeout(timeoutId)
                return result
              } catch (error) {
                clearTimeout(timeoutId)
                if (error.message === '任务超时') {
                  console.warn(`操作超时但可能仍在执行中: ${target.name || target.id}`)
                  return null
                }
                throw error
              }
            }

            let result = await operationWithTimeout()

            // 对于restart和reset操作，如果超时则验证实际结果
            if (result === null && (task.type === 'restart' || task.type === 'start' || task.type === 'reset')) {
              console.log('超时后验证操作结果...')
              await new Promise(resolve => setTimeout(resolve, 5000))

              try {
                const verifyContainerName = target.name || target.id || target.ID
                const verifyDevice = { ip: target.deviceIp, version: target.deviceVersion || 'v3' }

                const containers = await getContainers(verifyDevice)
                const targetContainer = containers.find(c => 
                  (c.name || c.ID || c.id) === verifyContainerName ||
                  (c.Names && c.Names.includes(verifyContainerName))
                )

                if (targetContainer) {
                  if (targetContainer.status === 'running') {
                    console.log('验证成功：容器已执行操作并运行中')
                    result = true
                  } else {
                    console.warn('验证结果：容器状态异常', targetContainer.status)
                    result = false
                  }
                } else {
                  console.warn('验证结果：找不到容器（可能被删除）')
                  result = task.type === 'delete' ? true : false
                }
              } catch (verifyError) {
                console.error('验证操作结果失败:', verifyError)
                result = false
              }
            }

            // 如果结果包含manualCount标记，说明内部已经处理了计数，这里不再重复计数
            if (result && typeof result === 'object' && result.manualCount) {
              // 既然已经手动处理了，这里不需要做任何事
              // 但如果是非uploadFile任务（理论上不应该进入这里，因为只有uploadFile返回这个对象），
              // 我们可能还是需要更新deviceProgress。
              // 不过目前只有uploadFile返回这个，且uploadFile内部已经更新了deviceProgress。
            } else if (result === true) {
              task.completed++
              // 对于非uploadFile任务，更新对应设备的进度
              if (task.deviceProgress && target.deviceIP && task.type !== 'uploadFile') {
                if (!task.deviceProgress[target.deviceIP]) {
                  task.deviceProgress[target.deviceIP] = { total: 0, completed: 0, failed: 0 }
                }
                task.deviceProgress[target.deviceIP].completed++
              }
            } else if (result === false) {
              task.failed++
              task.failedTargets.push({
                ...target,
                error: '执行失败'
              })
              // 对于非uploadFile任务，更新对应设备的进度
              if (task.deviceProgress && target.deviceIP && task.type !== 'uploadFile') {
                if (!task.deviceProgress[target.deviceIP]) {
                  task.deviceProgress[target.deviceIP] = { total: 0, completed: 0, failed: 0 }
                }
                task.deviceProgress[target.deviceIP].failed++
              }
            } else {
              task.failed++
              task.failedTargets.push({
                ...target,
                error: '任务超时'
              })
              // 更新对应设备的进度
              if (task.deviceProgress && target.deviceIP) {
                if (!task.deviceProgress[target.deviceIP]) {
                  task.deviceProgress[target.deviceIP] = { total: 0, completed: 0, failed: 0 }
                }
                task.deviceProgress[target.deviceIP].failed++
              }
            }
          } catch (error) {
            if (task.status === 'canceled' || error.message === '任务已取消') {
              break
            }
            task.failed++
            task.failedTargets.push({
              ...target,
              error: error.message || '未知错误'
            })
            console.error(`执行任务失败: ${error.message}`)
            if (task.deviceProgress && target.deviceIP && task.type !== 'uploadFile') {
              if (!task.deviceProgress[target.deviceIP]) {
                task.deviceProgress[target.deviceIP] = { total: 0, completed: 0, failed: 0 }
              }
              task.deviceProgress[target.deviceIP].failed++
            }
          } finally {
            if (task.status !== 'canceled') {
              if (task.type === 'create') {
                if (task.currentStep === 'image' && task.imageProgress !== null) {
                  task.progress = Math.round(task.imageProgress / 2)
                } else if (task.currentStep === 'create') {
                  const currentSlot = task.completed + task.failed
                  task.progress = 50 + Math.round(currentSlot / task.total * 50)
                } else {
                  const currentSlot = task.completed + task.failed
                  task.progress = Math.round(currentSlot / task.total * 100)
                }
              } else {
                task.progress = Math.round((task.completed + task.failed) / task.total * 100)
              }
            }
          }
          }
        } finally {
          runningCount.value--
        }
      }

      // 并发处理不同设备
      const devicePromises = []
      for (const deviceIP of deviceIPs) {
        // 等待有可用的并发槽位
        while (runningCount.value >= maxConcurrentDevices) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        runningCount.value++
        devicePromises.push(processDeviceSerially(deviceIP, targetsByDevice[deviceIP]))
      }

      await Promise.all(devicePromises)

      if (task.status === 'canceled') {
        return
      }

      // 任务完成
      task.status = task.failed === 0 ? 'completed' : 'failed'
      task.endTime = new Date()

      // 计算实际上传成功的云机数量（uploadFile类型）
      let actualSuccessMachines = task.completed
      let actualFailMachines = task.failed
      if (task.type === 'uploadFile') {
        // 按云机去重统计（executeTask 里收集的 uploadResultMachines）。
        // 之前这里把成功数硬算成全部云机数、失败数硬编码 0，
        // 弹窗"成功 6 失败 0"和任务状态"部分失败"自相矛盾
        if (task.uploadResultMachines && task.uploadResultMachines.size > 0) {
          const machineResults = Array.from(task.uploadResultMachines.values())
          actualSuccessMachines = machineResults.filter(m => m.failed === 0).length
          actualFailMachines = machineResults.filter(m => m.failed > 0).length
        }
      }

      // 显示任务完成通知
      const taskTypeText = task.type === 'restart' ? '批量重启' : task.type === 'start' ? '批量启动' : task.type === 'reset' ? '批量重置' : task.type === 'shutdown' ? '批量关机' : task.type === 'create' ? '批量创建' : task.type === 'delete' ? '批量删除' : task.type === 'switchModel' ? (task.operation === 'new' ? '批量新机' : '批量切换机型') : task.type === 'uploadFile' ? '批量上传' : task.type === 'uploadImage' ? '批量上传镜像' : task.type === 'downloadImage' ? '下载镜像' : task.type === 'updateImage' ? '批量更新镜像' : '批量操作'
      if (task.status === 'completed') {
        if (task.type === 'uploadFile') {
          ElMessage.success(`${taskTypeText}任务已完成，成功上传到 ${actualSuccessMachines} 个云机`)
        } else {
          ElMessage.success(`${taskTypeText}任务已完成，成功 ${task.completed} 个云机`)
        }
      } else {
        if (task.type === 'uploadFile') {
          ElMessage.warning(`${taskTypeText}任务部分失败，成功 ${actualSuccessMachines} 个云机，失败 ${actualFailMachines} 个云机，请查看任务列表获取详细信息`)
        } else {
          ElMessage.warning(`${taskTypeText}任务部分失败，成功 ${task.completed} 个云机，失败 ${task.failed} 个云机，请查看任务列表获取详细信息`)
        }
      }

      // 刷新容器列表
      if (cloudManageMode.value === 'slot' && selectedCloudDevice.value) {
        await fetchAndroidContainers(selectedCloudDevice.value, true)
      }

      // 如果是删除操作且备份列表可见，刷新备份列表
      if (task.type === 'delete' && backupListVisible.value) {
        initBackupList()
      }
    } catch (error) {
      task.status = 'failed'
      task.endTime = new Date()
      console.error(`任务执行失败: ${error.message}`)
    }
  }

  // 取消任务
  const cancelTask = async (taskId) => {
    const task = taskQueue.value.find(t => t.id === taskId)
    if (task && task.status === 'running') {
      // 取消下载镜像任务的特殊处理
      if (task.type === 'downloadImage') {
        console.log('取消下载任务:', taskId)

        try {
          // 调用后端API取消下载并删除未完成的文件
          await CancelImageDownload()
          console.log('取消下载API调用成功')
        } catch (error) {
          console.error('取消下载API调用失败:', error)
        }

        // 先标记任务为已取消
        task.status = 'canceled'
        task.endTime = new Date()
        task.progress = 0

        // 延迟重置下载状态，避免残留事件干扰
        setTimeout(() => {
          // 再次确认是当前任务才重置
          if (currentDownloadTaskId.value === taskId) {
            isDownloadingImage.value = false
            currentDownloadImage.value = null
            currentDownloadTaskId.value = null
            downloadProgress.value = 0
            downloadStartTime.value = 0
            console.log('下载状态已完全重置')
          }
        }, 200)
      } else if (task.type === 'uploadImage') {
        // 取消上传镜像任务的特殊处理
        console.log('[上传镜像] 取消上传任务:', taskId)

        try {
          // 调用后端API取消上传
          await CancelImageUpload()
          console.log('[上传镜像] 取消上传API调用成功')
        } catch (error) {
          console.error('[上传镜像] 取消上传API调用失败:', error)
        }

        // 先标记任务为已取消
        task.status = 'canceled'
        task.endTime = new Date()

        // 延迟重置上传状态，避免残留事件干扰
        setTimeout(() => {
          if (isUploadingImage.value || isUploadingToMultipleDevices.value) {
            isUploadingImage.value = false
            isUploadingToMultipleDevices.value = false
            currentUploadImage.value = null
            uploadProgress.value = 0
            console.log('[上传镜像] 上传状态已完全重置')
          }
        }, 200)
      } else {
        task.status = 'canceled'
        task.endTime = new Date()
        task.progress = 0
        if (task.type === 'create') {
          task.imageProgress = 0
          task.currentStep = null
        }
      }

      ElMessage.info('任务已取消')
    }
  }

  // 重试任务（只重试失败的）
  const retryFailedTask = async (taskId) => {
    const task = taskQueue.value.find(t => t.id === taskId)
    if (!task || task.status !== 'failed' || task.failedTargets.length === 0) return

    try {
      // 显示确认对话框
      await ElMessageBox.confirm(
        `确定要重试失败的 ${task.failedTargets.length} 个任务吗？`, 
        '重试失败任务', 
        {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning'
        }
      )

      // 从失败目标中提取设备IP信息
      const failedDeviceIps = new Set()
      task.failedTargets.forEach(target => {
        if (target.deviceIp) {
          failedDeviceIps.add(target.deviceIp)
        } else if (target.device && target.device.ip) {
          failedDeviceIps.add(target.device.ip)
        }
      })

      // 创建新任务，只包含失败的目标
      const newTask = {
        ...task,
        id: generateTaskId(),
        status: 'pending',
        total: task.failedTargets.length,
        completed: 0,
        failed: 0,
        progress: 0,
        // 重试要重新统计云机结果，别继承上一轮的 Map（...task 会带过来）
        uploadResultMachines: new Map(),
        targets: task.failedTargets.map(target => {
          // 对于 uploadImage 类型，确保 target 包含重试所需的信息
          if (task.type === 'uploadImage') {
            return {
              ...target,
              deviceIP: target.deviceIP || target.ip || (target.device && target.device.ip),
              deviceVersion: target.deviceVersion || (target.device && target.device.version) || 'v3',
              imagePath: task.imagePath || target.imagePath || ''
            }
          }
          return target
        }),
        deviceIps: Array.from(failedDeviceIps), // 只包含失败目标相关的设备IP
        failedTargets: [],
        startTime: null,
        endTime: null
      }

      // 添加到队列并执行
      taskQueue.value.unshift(newTask)
      executeTask(newTask.id)
    } catch (error) {
      if (error !== 'cancel') {
        console.error('重试任务失败:', error)
        ElMessage.error(`重试任务失败: ${error.message || '未知错误'}`)
      }
    }
  }

  // 清理任务
  const handleClearTasks = async () => {
    try {
      // 可清理的状态：已完成、已取消、失败
      const cleanableStatuses = ['completed', 'canceled', 'failed']
      const hasCleanableTasks = taskQueue.value.some(task => cleanableStatuses.includes(task.status))

      if (hasCleanableTasks) {
        await ElMessageBox.confirm(
          '确定要清理所有已完成、已取消和失败的任务吗？', 
          '清理任务队列', 
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'info'
          }
        )

        // 过滤掉已完成、已取消、失败的任务
        taskQueue.value = taskQueue.value.filter(task => !cleanableStatuses.includes(task.status))
        ElMessage.success('任务清理成功')
      } else {
        ElMessage.info('没有可清理的任务')
      }
    } catch (error) {
      if (error !== 'cancel') {
        console.error('清理任务失败:', error)
        ElMessage.error(`清理任务失败: ${error.message || '未知错误'}`)
      }
    }
  }

  return {
    addTaskToQueue,
    handleStartCopyTask,
    executeTask,
    cancelTask,
    retryFailedTask,
    handleClearTasks,
  }
}
