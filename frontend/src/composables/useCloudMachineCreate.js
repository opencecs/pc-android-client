/**
 * 创建云机：createV3CloudMachine（单台，带 SDK 加载进度）与 handleCreateSubmit / 取消。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue，需要的 ref / 宿主函数通过依赖对象传入，不用 provide/inject。
 * ElMessage / ElMessageBox 与 wails binding 由本模块自己 import。
 *
 * `t` 是 App.vue 里的本地 i18n 包装，通过依赖对象传入。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { nextTick } from 'vue'
import axios from 'axios'
import { getDevicePassword, saveDevicePassword } from '../services/api.js'
import { getDeviceAddr } from '../utils/device.js'
import { GetImages, LoadImageToDevice } from '../../bindings/edgeclient/app'

export function useCloudMachineCreate({
  t,
  devices,
  instances,
  deviceCloudMachinesCache,
  taskQueue,
  phoneModels,
  localPhoneModels,
  backupPhoneModels,
  localCachedImages,
  containerAndroidVersion,
  createDialogVisible,
  createDevice,
  createMode,
  selectedBatchDevices,
  currentSlot,
  createLoading,
  createCancelled,
  sdkLoadingVisible,
  sdkLoadingMessage,
  sdkLoadingProgress,
  createForm,
  createDeviceFirmwareInfo,
  androidVersionFilteredPhoneModels,
  slotStates,
  runningSlots,
  slotStatesOf,
  runningSlotsOf,
  instancesOf,
  getRandomVpcNodeId,
  isSlotOccupied,
  showAuthDialog,
}, lazyDeps = {}) {
  // 任务队列在 App.vue 下方才创建，用惰性依赖避免 TDZ
  const { addTaskToQueue, executeTask } = lazyDeps
  // 创建V3云机，参考api/main.go中的handleCreateTask和createV3Container实现
  const createV3CloudMachine = async (device, slot, modelName, cancelCheck = null, options = {}) => {
    const isCanceled = () => (typeof cancelCheck === 'function' && cancelCheck()) || createCancelled.value
    // 优先从 options.formOverride 读取参数，避免后台批量任务干扰界面表单
    const form = options.formOverride ? { ...createForm.value, ...options.formOverride } : createForm.value
    // 获取镜像URL，优先使用自定义镜像地址
    let imageUrl = ''
    // 检查是否是本地镜像
    const isLocalImage = form.imageCategory === 'local'

    if (isLocalImage) {
      // 本地镜像
      imageUrl = form.localImageUrl
      if (!imageUrl) {
        ElMessage.error('请选择本地镜像')
        return false
      }

      // 推送本地镜像到设备
      sdkLoadingVisible.value = true
      sdkLoadingMessage.value = '检查设备上的镜像...'

      try {
        // 获取设备上的镜像列表
        const savedPassword = getDevicePassword(device.ip)
        const deviceImages = await GetImages(device.ip, device.version, savedPassword || '')
        console.log('设备上的镜像列表:', deviceImages)

        // 获取本地镜像的onlineUrl（从缓存读取）
        let localImageOnlineUrl = ''
        if (localCachedImages.value.length === 0) {
          console.log('[单创建] 本地镜像列表为空，尝试加载...')
          await fetchLocalImages()
        }
        const cachedImage = localCachedImages.value.find(img => img.path === imageUrl)
        if (cachedImage && cachedImage.onlineUrl) {
          localImageOnlineUrl = cachedImage.onlineUrl
        }

        // 确定要检查的镜像名称（优先使用onlineUrl，其次使用本地标签）
        let expectedImageName = ''
        let isPushedFromOnline = false

        if (localImageOnlineUrl) {
          expectedImageName = localImageOnlineUrl
          isPushedFromOnline = true
          console.log('[单创建] 使用online_url检查镜像:', expectedImageName)
        } else {
          // 从本地镜像路径中提取镜像名称
          const imagePathParts = imageUrl.split('\\')
          let localImageName = imagePathParts[imagePathParts.length - 1]
          localImageName = localImageName.replace('.tar.gz', '')
          localImageName = localImageName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
          expectedImageName = `local/${localImageName}:latest`
          console.log('[单创建] 未找到online_url，使用本地标签检查:', expectedImageName)
        }

        // 检查设备上是否已存在该镜像
        let imageExists = false
        if (Array.isArray(deviceImages)) {
          // V0-V2 格式：数组
          imageExists = deviceImages.some(img => {
            const repoTags = img.RepoTags || img.imageUrl || img.Image
            if (Array.isArray(repoTags)) {
              return repoTags.includes(expectedImageName)
            }
            return repoTags === expectedImageName
          })
        } else if (deviceImages && deviceImages.list) {
          // V3 格式：包含list字段的对象
          imageExists = deviceImages.list.some(img => {
            return img.imageUrl === expectedImageName || img.Image === expectedImageName
          })
        }

        console.log('检查镜像是否存在:', expectedImageName, '结果:', imageExists)

        if (!imageExists) {
          // 设备上不存在该镜像，需要推送
          sdkLoadingMessage.value = '正在推送本地镜像到设备...'

          // 重置进度
          sdkLoadingProgress.value = 0

          // 调用后端的LoadImageToDevice函数，将本地镜像加载到设备
          console.log('调用后端LoadImageToDevice函数，镜像URL:', imageUrl)
          const password = getDevicePassword(device.ip)
          const loadResult = await LoadImageToDevice(device.ip, imageUrl, device.version, password || '')
          console.log('推送本地镜像结果:', loadResult)

          // 设置进度为100%
          sdkLoadingProgress.value = 100

          // 短暂延迟，让用户看到100%进度
          await new Promise(resolve => setTimeout(resolve, 500))

          // 隐藏蒙版
          sdkLoadingVisible.value = false

          // 检查加载结果
          if (!loadResult.success) {
            ElMessage.error(`推送本地镜像失败：${loadResult.message || '未知错误'}`)
            return false
          }

          // 使用后端返回的真实镜像名称
          if (loadResult.imageName) {
            imageUrl = loadResult.imageName
          } else {
            // 如果后端没有返回镜像名称，使用默认的本地镜像名称格式
            imageUrl = expectedImageName
          }
        } else {
          // 设备上已存在该镜像，直接使用预期的镜像名称
          imageUrl = expectedImageName
          console.log('设备上已存在该镜像，跳过推送步骤')
          sdkLoadingVisible.value = false
        }
      } catch (loadError) {
        console.error('处理本地镜像失败:', loadError)
        ElMessage.error(`处理本地镜像失败：${loadError.message}`)
        sdkLoadingVisible.value = false
        return false
      }
    } else {
      // 在线镜像
      imageUrl = form.imageSelect
      if (form.imageSelect === 'custom') {
        imageUrl = form.customImageUrl
      }

      // 检查是否需要缓存到本地创建
      const cacheToLocal = form.cacheToLocal || false

      if (!cacheToLocal) {
        // 不缓存到本地，直接调用V3 API拉取镜像
        sdkLoadingVisible.value = true
        sdkLoadingMessage.value = '正在拉取镜像...'
        sdkLoadingProgress.value = 0

        // 查找当前正在运行的创建任务，用于更新进度
        const currentCreateTask = taskQueue.value.find(t => t.type === 'create' && t.status === 'running')

        // 构造拉取镜像的请求参数
        const pullImageParams = {
          imageUrl: imageUrl
        }

        // 先获取设备密码
        let password = null
        try {
          // 尝试获取已保存的密码
          password = getDevicePassword(device.ip)
          console.log('使用已保存的密码:', password ? '***' : '无')
        } catch (error) {
          console.error('获取密码失败:', error)
        }

        // 构造请求头
        let headers = {}
        if (password) {
          const auth = btoa(`admin:${password}`)
          headers = {
            'Authorization': `Basic ${auth}`
          }
        }

        // 调用V3 API拉取镜像
        const pullImageUrl = `http://${getDeviceAddr(device.ip)}/android/pullImage`
        console.log('调用V3 API拉取镜像:', pullImageUrl, pullImageParams)

        // 发送POST请求
        console.log('开始发送拉取镜像请求')

        // 等待镜像拉取完成
        await new Promise((resolve, reject) => {
          try {
            // 使用fetch API处理流式响应

            // 构建请求选项
            const requestOptions = {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...headers
              },
              body: JSON.stringify(pullImageParams)
            }

            // 发送fetch请求
            fetch(pullImageUrl, requestOptions)
              .then(response => {
                if (!response.ok) {
                  throw new Error(`HTTP error! status: ${response.status}`)
                }

                // 检查是否支持流式响应
                if (!response.body) {
                  throw new Error('Response body is not a readable stream')
                }

                // 获取可读流
                const reader = response.body.getReader()

                let buffer = ''
                let progress = 0

                // 处理流式数据
                const processStream = async () => {
                  try {
                    // 检查是否已取消
                    if (isCanceled()) {
                      reader.cancel()
                      throw new Error('创建取消')
                    }

                    // 读取下一个数据块
                    const { done, value } = await reader.read()

                    if (done) {
                      sdkLoadingProgress.value = 100
                      if (currentCreateTask) {
                        currentCreateTask.progress = 100
                      }
                      nextTick()
                      setTimeout(() => {
                        sdkLoadingVisible.value = false
                        resolve()
                      }, 500)
                      return
                    }

                    // 检查是否已取消
                    if (isCanceled()) {
                      reader.cancel()
                      throw new Error('创建取消')
                    }

                    // 处理数据块
                    const chunkStr = new TextDecoder('utf-8').decode(value)
                    buffer += chunkStr

                    // 处理每一行数据
                    const lines = buffer.split('\n')

                    for (let i = 0; i < lines.length; i++) {
                      const line = lines[i].trim()
                      if (line) {
                        if (line.startsWith('data: ')) {
                          const jsonStr = line.substring(6).trim()
                          if (jsonStr) {
                            try {
                              const data = JSON.parse(jsonStr)

                              // 处理进度信息
                              if (data.progressDetail && data.progressDetail.current !== undefined && data.progressDetail.total !== undefined && data.progressDetail.total > 0) {
                                // 计算进度百分比
                                progress = (data.progressDetail.current / data.progressDetail.total) * 100
                                // 直接更新进度
                                sdkLoadingProgress.value = progress
                                if (currentCreateTask) {
                                  currentCreateTask.progress = Math.round(progress)
                                }
                                nextTick()
                              } 
                              // 备用进度计算方式
                              else if (data.progress && typeof data.progress === 'string') {
                                // 处理类似 "10%" 的进度字符串
                                const progressMatch = data.progress.match(/(\d+)%/)
                                if (progressMatch) {
                                  progress = parseFloat(progressMatch[1])
                                  sdkLoadingProgress.value = progress
                                  if (currentCreateTask) {
                                    currentCreateTask.progress = Math.round(progress)
                                  }
                                  nextTick()
                                } else {
                                  // 尝试从进度字符串中提取MB/GB信息
                                  const sizeMatch = data.progress.match(/(\d+\.\d+)MB\/(\d+\.\d+)GB/)
                                  if (sizeMatch) {
                                    const currentMB = parseFloat(sizeMatch[1])
                                    const totalGB = parseFloat(sizeMatch[2])
                                    const totalMB = totalGB * 1024
                                    if (totalMB > 0) {
                                      progress = (currentMB / totalMB) * 100
                                      sdkLoadingProgress.value = progress
                                      if (currentCreateTask) {
                                        currentCreateTask.progress = Math.round(progress)
                                      }
                                      nextTick()
                                    }
                                  }
                                }
                              }

                              // 处理状态信息
                              if (data.status) {
                                // 保持基础消息不变，确保进度条持续显示
                                if (data.status.includes('Downloading')) {
                                  sdkLoadingMessage.value = '正在拉取镜像... (下载中)'
                                } else if (data.status.includes('Pulling')) {
                                  sdkLoadingMessage.value = '正在拉取镜像... (准备中)'
                                } else if (data.status.includes('Extracting')) {
                                  sdkLoadingMessage.value = '正在拉取镜像... (解压中)'
                                } else {
                                  sdkLoadingMessage.value = `正在拉取镜像... (${data.status})`
                                }
                                nextTick()
                              }
                            } catch (error) {
                              // 尝试直接从原始数据中提取进度信息
                              try {
                                // 尝试匹配类似 "current: 123, total: 456" 的模式
                                const currentMatch = chunkStr.match(/current:\s*(\d+)/)
                                const totalMatch = chunkStr.match(/total:\s*(\d+)/)
                                if (currentMatch && totalMatch) {
                                  const current = parseInt(currentMatch[1])
                                  const total = parseInt(totalMatch[1])
                                  if (total > 0) {
                                    progress = (current / total) * 100
                                    sdkLoadingProgress.value = progress
                                    if (currentCreateTask) {
                                      currentCreateTask.progress = Math.round(progress)
                                    }
                                    nextTick()
                                  }
                                }
                              } catch (e) {
                                // 忽略错误
                              }
                            }
                          }
                        }
                      }
                    }

                    // 清空buffer，因为我们已经处理了所有行
                    buffer = ''

                    // 继续处理下一个数据块
                    await processStream()
                  } catch (error) {
                    sdkLoadingVisible.value = false
                    reject(error)
                  }
                }

                // 开始处理流式数据
                processStream()
              })
              .catch(error => {
                sdkLoadingVisible.value = false
                // 检查是否是认证错误
                if (error.message.includes('401')) {
                  // 显示认证对话框
                  showAuthDialog(device, async (password) => {
                    try {
                      // 保存密码并同步到后端
                      await saveDevicePassword(device.ip, password)

                      // 使用新密码重新拉取镜像
                      const pullImageParams = {
                        imageUrl: imageUrl
                      }

                      // 重置进度条
                      sdkLoadingProgress.value = 0

                      // 查找当前正在运行的创建任务，用于更新进度
                      const currentCreateTask = taskQueue.value.find(t => t.type === 'create' && t.status === 'running')

                      const auth = btoa(`admin:${password}`)
                      const authHeaders = {
                        'Authorization': `Basic ${auth}`,
                        'Content-Type': 'application/json'
                      }

                      // 使用新密码发送请求
                      const response = await fetch(pullImageUrl, {
                        method: 'POST',
                        headers: authHeaders,
                        body: JSON.stringify(pullImageParams)
                      })

                      if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`)
                      }

                      // 检查是否支持流式响应
                      if (!response.body) {
                        throw new Error('Response body is not a readable stream')
                      }

                      // 获取可读流
                      const reader = response.body.getReader()

                      let buffer = ''

                      // 处理流式数据
                      const processStream = async () => {
                        try {
                          // 检查是否已取消
                          if (isCanceled()) {
                            reader.cancel()
                            throw new Error('创建取消')
                          }

                          // 读取下一个数据块
                          const { done, value } = await reader.read()

                          if (done) {
                            sdkLoadingProgress.value = 100
                            if (currentCreateTask) {
                              currentCreateTask.progress = 100
                            }
                            nextTick()
                            setTimeout(() => {
                              sdkLoadingVisible.value = false
                              resolve()
                            }, 500)
                            return
                          }

                          // 检查是否已取消
                          if (isCanceled()) {
                            reader.cancel()
                            throw new Error('创建取消')
                          }

                          // 处理数据块
                          const chunkStr = new TextDecoder('utf-8').decode(value)
                          buffer += chunkStr

                          // 处理每一行数据
                          const lines = buffer.split('\n')

                          for (let i = 0; i < lines.length; i++) {
                            const line = lines[i].trim()
                            if (line.startsWith('data: ')) {
                              const jsonStr = line.substring(6).trim()
                              if (jsonStr) {
                                try {
                                  const data = JSON.parse(jsonStr)

                                  if (data.progressDetail && data.progressDetail.current !== undefined && data.progressDetail.total !== undefined && data.progressDetail.total > 0) {
                                    const progress = (data.progressDetail.current / data.progressDetail.total) * 100
                                    sdkLoadingProgress.value = progress
                                    if (currentCreateTask) {
                                      currentCreateTask.progress = Math.round(progress)
                                    }
                                    nextTick()
                                  }
                                  // 备用进度计算方式
                                  else if (data.progress && typeof data.progress === 'string') {
                                    // 处理类似 "10%" 的进度字符串
                                    const progressMatch = data.progress.match(/(\d+)%/)
                                    if (progressMatch) {
                                      const progress = parseFloat(progressMatch[1])
                                      sdkLoadingProgress.value = progress
                                      if (currentCreateTask) {
                                        currentCreateTask.progress = Math.round(progress)
                                      }
                                      nextTick()
                                    } else {
                                      // 尝试从进度字符串中提取MB/GB信息
                                      const sizeMatch = data.progress.match(/(\d+\.\d+)MB\/(\d+\.\d+)GB/)
                                      if (sizeMatch) {
                                        const currentMB = parseFloat(sizeMatch[1])
                                        const totalGB = parseFloat(sizeMatch[2])
                                        const totalMB = totalGB * 1024
                                        if (totalMB > 0) {
                                          const progress = (currentMB / totalMB) * 100
                                          sdkLoadingProgress.value = progress
                                          if (currentCreateTask) {
                                            currentCreateTask.progress = Math.round(progress)
                                          }
                                          nextTick()
                                        }
                                      }
                                    }
                                  }

                                  if (data.status) {
                                    // 保持基础消息不变，确保进度条持续显示
                                    if (data.status.includes('Downloading')) {
                                      sdkLoadingMessage.value = '正在拉取镜像... (下载中)'
                                    } else if (data.status.includes('Pulling')) {
                                      sdkLoadingMessage.value = '正在拉取镜像... (准备中)'
                                    } else if (data.status.includes('Extracting')) {
                                      sdkLoadingMessage.value = '正在拉取镜像... (解压中)'
                                    } else {
                                      sdkLoadingMessage.value = `正在拉取镜像... (${data.status})`
                                    }
                                    nextTick()
                                  }
                                } catch (error) {
                                  // 尝试直接从原始数据中提取进度信息
                                  try {
                                    // 尝试匹配类似 "current: 123, total: 456" 的模式
                                    const currentMatch = chunkStr.match(/current:\s*(\d+)/)
                                    const totalMatch = chunkStr.match(/total:\s*(\d+)/)
                                    if (currentMatch && totalMatch) {
                                      const current = parseInt(currentMatch[1])
                                      const total = parseInt(totalMatch[1])
                                      if (total > 0) {
                                        const progress = (current / total) * 100
                                        sdkLoadingProgress.value = progress
                                        nextTick()
                                      }
                                    }
                                  } catch (e) {
                                    // 忽略错误
                                  }
                                }
                              }
                            }
                          }

                          buffer = '' // 清空buffer，因为我们已经处理了所有行

                          // 继续处理下一个数据块
                          await processStream()
                        } catch (error) {
                          sdkLoadingVisible.value = false
                          reject(error)
                        }
                      }

                      // 开始处理流式数据
                      processStream()
                    } catch (error) {
                      sdkLoadingVisible.value = false
                      ElMessage.error(`拉取镜像失败：${error.message}`)
                      reject(error)
                    }
                  })
                } else {
                  ElMessage.error(`拉取镜像失败：${error.message}`)
                  reject(error)
                }
              })
          } catch (error) {
            sdkLoadingVisible.value = false
            reject(error)
          }
        })

      }
    }

    // 解析分辨率
    let doboxWidth = ''
    let doboxHeight = ''
    let doboxDpi = ''

    if (form.resolution === 'default') {
      // 机型默认分辨率，传递空值
      doboxWidth = ''
      doboxHeight = ''
      doboxDpi = ''
    } else if (form.resolution === 'custom') {
      // 自定义分辨率（用户不填则传空，由后端/设备处理）
      doboxWidth = form.customResolution.width || ''
      doboxHeight = form.customResolution.height || ''
      doboxDpi = form.customResolution.dpi || ''
    } else {
      // 预设分辨率
      const parts = (form.resolution || '').split('x')
      if (parts.length === 3) {
        doboxWidth = parts[0]
        doboxHeight = parts[1]
        doboxDpi = parts[2]
      } else {
        // 兼容旧格式
        doboxWidth = '720'
        doboxHeight = '1280'
        doboxDpi = '320'
      }
    }

    // 从手机型号列表中查找对应的ModelId
    let modelId = ''
    const model = phoneModels.value.find(m => m.name === modelName)
    if (model) {
      modelId = model.id || ''
    }

    // 确保ModelId不为空，使用默认值
    if (!modelId) {
      // 使用默认的ModelId，根据api/main.go中的默认型号设置
      modelId = '17' // 默认型号ID，对应InfinixX6880
    }

    // 处理随机机型分配（从按安卓版本过滤后的机型列表中随机选择）
    if (modelName === 'random' || !modelName) {
      const versionFilteredModels = androidVersionFilteredPhoneModels.value
      if (versionFilteredModels && versionFilteredModels.length > 0) {
        // 从按安卓版本过滤后的机型列表中随机选择一个
        const randomModel = versionFilteredModels[Math.floor(Math.random() * versionFilteredModels.length)]
        modelId = randomModel.id
        modelName = randomModel.name
        console.log('随机选择的机型:', modelName, 'ID:', modelId)
      } else if (phoneModels.value && phoneModels.value.length > 0) {
        // 如果过滤后没有机型，从全部机型中随机选择
        const randomModel = phoneModels.value[Math.floor(Math.random() * phoneModels.value.length)]
        modelId = randomModel.id
        modelName = randomModel.name
        console.log('按版本过滤后无机型，从全部机型随机选择:', modelName, 'ID:', modelId)
      } else {
        // 如果没有可用机型，使用默认值
        modelId = '17' // 默认型号ID，对应InfinixX6880
        modelName = 'InfinixX6880' // 默认型号名称
        console.log('没有可用机型，使用默认机型:', modelName, 'ID:', modelId)
      }
    }

    // 处理DNS设置
    let dnsValue = form.dns;
    if (form.dns === 'custom' && form.customDns) {
      dnsValue = form.customDns;
    }

    // 检查目标坑位的状态，决定Start参数的值
    let shouldStart = true

    if (options.start === false) {
      // 显式传 false 时直接使用
      shouldStart = false
      console.log(`[createV3CloudMachine] 使用options.start: false`)
    } else {
      // 未传或传 true 时，重新检查该坑位是否有运行中的云机
      // 优先检查 runningSlots（打开创建对话框时实时获取的运行状态）
      // runningSlots 为全局单例，仅当归属本次创建的目标设备时才可用
      const liveSlots = runningSlotsOf(device)
      if (liveSlots && liveSlots.has(slot)) {
        shouldStart = false
        console.log(`坑位 ${slot} 已有运行中的云机（runningSlots），设置 Start=false`)
      } else {
        // 从 deviceCloudMachinesCache 检查
        const deviceContainers = deviceCloudMachinesCache.value.get(device.ip) || []
        const existingMachine = deviceContainers.find(m => m.indexNum === slot)
        if (existingMachine && existingMachine.status === 'running') {
          shouldStart = false
          console.log(`坑位 ${slot} 已有运行中的云机（缓存），设置 Start=false`)
        } else if (instancesOf(device).some(m => m.indexNum === slot && m.status === 'running')) {
          shouldStart = false
          console.log(`坑位 ${slot} 已有运行中的云机（instances），设置 Start=false`)
        } else {
          shouldStart = true
          console.log(`坑位 ${slot} 无运行中的云机，保持 Start=true`)
        }
      }

      // 坑位已过期：无论已有容器状态如何，强制不开机
      // slotStates 为全局单例，仅当归属本次创建的目标设备时才可用
      const slotInfo = slotStatesOf(device)[slot]
      if (slotInfo && slotInfo.state === 2) {
        shouldStart = false
        console.log(`坑位 ${slot} 已过期，强制 Start=false`)
      }
    }

    // 构造与api/main.go中V3CreateContainerReq完全匹配的参数结构
    // 根据机型类型选择传递的参数
    let params = {}
    if (form.createType === 'container') {
      // 🔧 修复：从 containerDataDiskSize (16G/32G/64G) 提取数字
      const diskSizeNum = parseInt(form.containerDataDiskSize) || 16  // 默认 16GB

      params = {
        dns: dnsValue,
        imageUrl: imageUrl,
        name: `${Date.now()}_${slot}_${form.containerName || form.name}${slot}`,
        doboxDpi: doboxDpi,
        doboxFps: '24',
        doboxHeight: doboxHeight,
        doboxWidth: doboxWidth,
        indexNum: slot,
        start: shouldStart,
        sandboxSize: (form.containerSandboxMode === false) ? '' : `${diskSizeNum}GB`,  // ✅ 使用正确的容器数据盘大小
        enforce: form.containerEnforce !== false, // 安全模式，默认开启
        compatMode: form.containerCompatMode ? '1' : '0', // 兼容模式，0-关，1-开
        // offset: 0
      }

      // 容器模式添加网卡配置
      if (form.containerNetworkCardType === 'public' && form.containerMacVlanIp) {
        // 公有网卡(MacVlan)配置
        params.macVlanIp = form.containerMacVlanIp
      } else if (form.containerNetworkCardType === 'private' && form.containerMytBridgeName) {
        // 私有网卡(myt_bridge)配置
        params.mytBridgeName = form.containerMytBridgeName
      }

      // 添加VPC网络管理配置
      if (form.vpcGroupId) {
        params.VpcGroupId = form.vpcGroupId
        // 参考随机机型实现，在发送请求时才真正随机选择节点
        if (form.vpcSelectMode === 'random') {
          params.VpcID = getRandomVpcNodeId()
        } else {
          params.VpcID = form.vpcNodeId || ''
        }
      }
    } else {
      params = {
        Name: `${Date.now()}_${slot}_${form.name}${slot}`, // 格式：timestamp_idx_nameidx
        IndexNum: slot,
        ImageUrl: imageUrl,
        SandboxSize: (form.sandboxMode === false) ? '' : `${form.sandboxSize}GB`,
        Dns: dnsValue,
        CountryCode: form.countryCode, // 机型国家代码
        // S5代理设置（SDK版本>=25时支持）
        S5Type: form.s5Type,
        S5IP: form.s5IP,
        S5Port: form.s5Port,
        S5User: form.s5User,
        S5Password: form.s5Password,
        // 中转设置
        S5RelayType: form.s5RelayType,
        S5RelayVpcId: form.s5RelayType === '1' ? form.s5RelayVpcId : '',
        S5RelayAddress: form.s5RelayType === '2' ? form.s5RelayAddress : '',
        DoboxFps: '24', // 默认24FPS
        DoboxWidth: doboxWidth,
        DoboxHeight: doboxHeight,
        DoboxDpi: doboxDpi,
        LocateIp: '', // 定位IP，暂时为空
        Longitude: form.longitud, // 经度
        Latitude: form.latitude, // 纬度
        start: shouldStart,
        Mgenable: form.enableMagisk ? '1' : '0', // 0-关，1-开
        Gmsenable: form.enableGMS ? '1' : '0', // 0-关，1-开
        enforce: form.enforce !== false, // 安全模式，默认开启
        adbPort: (form.enforce !== false && form.adbPort !== undefined) ? Number(form.adbPort) : 0, // ADB端口，安全模式下生效，0不开启ADB
        compatMode: form.compatMode ? '1' : '0', // 兼容模式，0-关，1-开。开启后创建容器时删除机型包中的 cpuinfo 文件
        PINCode: form.lockScreenPassword, // 锁屏密码
        randomFile: form.randomFile || false, // 随机系统文件
       // VpcID: form.vpcNodeId || '', // VPC节点ID
        mytBridgeName: form.mytBridgeName,
        macVlanIp: form.macVlanIp,
      }

      // 根据机型类型添加对应的参数
      if (form.modelType === 'local') {
        // 本地机型：使用 LocalModel 参数
        params.LocalModel = form.localModel || ''
        console.log('使用本地机型参数:', params.LocalModel)
      } else if(form.modelType === 'online') {
        // 在线机型：使用 modelId 和 modelName 参数
        params.ModelId = modelId
        params.ModelName = modelName
        console.log('使用在线机型参数:', params.ModelId, params.ModelName)
      } else {
          params.modelStatic = form.modelStatic
      }

      // 如果是独立IP模式，添加网络配置
      if (form.networkMode === 'myt' && form.ipaddr) {
        // 直接使用表单中的IP地址
        params.Network = {
          Ip: form.ipaddr,
          Gw: '', // 后端会处理网络配置
          Subnet: '' // 后端会处理网络配置
        }
      }

      // 添加VPC网络管理配置
      if (form.vpcGroupId) {
        params.VpcGroupId = form.vpcGroupId
        // 参考随机机型实现，在发送请求时才真正随机选择节点
        if (form.vpcNodeId === 'random') {
          params.VpcID = getRandomVpcNodeId()
        } else {
          params.VpcID = form.vpcNodeId || ''
        }
      }
    }

    // 直接使用axios调用设备的V3 API，与api/main.go中的createV3Container实现一致
    let apiUrl = `http://${getDeviceAddr(device.ip)}/android`
    if (form.createType === 'container') {
      apiUrl = `http://${getDeviceAddr(device.ip)}/androidV2`
    }
    console.log('调用V3 API创建容器:', apiUrl, params)

    // 尝试使用已保存的密码
    const savedPassword = getDevicePassword(device.ip)
    let headers = {}

    if (savedPassword) {
      // 添加认证头
      const auth = btoa(`admin:${savedPassword}`)
      headers = {
        'Authorization': `Basic ${auth}`
      }
    }

    // 设备固件类型未获取到时自动重试（设备启动后首次创建可能尚未缓存固件类型）
    const isFirmwareTypeMissing = (data) => {
      if (!data) return false
      const msg = String(data.message || '')
      return data.code !== 0 && msg.includes('设备固件类型未获取到')
    }

    const postCreate = async (reqHeaders) => {
      let resp = await axios.post(apiUrl, params, { headers: reqHeaders })
      if (isFirmwareTypeMissing(resp.data)) {
        console.warn('[createV3CloudMachine] 设备固件类型未获取到，1.5s 后自动重试一次')
        await new Promise(r => setTimeout(r, 1500))
        resp = await axios.post(apiUrl, params, { headers: reqHeaders })
      }
      return resp
    }

    try {
      // 发送POST请求到设备的8000端口/android端点
      const response = await postCreate(headers)
      console.log('V3 API创建容器成功，返回数据:', response.data)

      // 检查响应状态
      if (response.data.code !== 0) {
        if (response.data.code === 61 && response.data.message === 'Authentication Failed') {
          // 认证失败，显示认证对话框
          return new Promise((resolve, reject) => {
            showAuthDialog(device, async (password) => {
              try {
                const auth = btoa(`admin:${password}`)
                const authResponse = await postCreate({
                  'Authorization': `Basic ${auth}`
                })

                console.log('V3 API创建容器成功，返回数据:', authResponse.data)

                // 检查响应状态
                if (authResponse.data.code !== 0) {
                  throw new Error(`创建失败: ${authResponse.data.message || '未知错误'}`)
                }

                resolve(authResponse.data)
              } catch (error) {
                console.error('创建容器失败:', error)
                reject(error)
              }
            })
          })
        } else {
          throw new Error(`创建失败: ${response.data.message || '未知错误'}`)
        }
      }

      return response.data
    } catch (error) {
      if (error.response && error.response.data && error.response.data.code === 61 && error.response.data.message === 'Authentication Failed') {
        // 认证失败，显示认证对话框
        return new Promise((resolve, reject) => {
          showAuthDialog(device, async (password) => {
            try {
              const auth = btoa(`admin:${password}`)
              const authResponse = await postCreate({
                'Authorization': `Basic ${auth}`
              })

              console.log('V3 API创建容器成功，返回数据:', authResponse.data)

              // 检查响应状态
              if (authResponse.data.code !== 0) {
                throw new Error(`创建失败: ${authResponse.data.message || '未知错误'}`)
              }

              resolve(authResponse.data)
            } catch (error) {
              console.error('创建容器失败:', error)
              reject(error)
            }
          })
        })
      } else {
        throw error
      }
    }
  }

  // 处理创建表单提交
  const handleCreateSubmit = async () => {
    // 保存选中的坑位到localStorage（用于下次记忆）
    if (createMode.value === 'batch' || createMode.value === 'multi-device-batch') {
      const slots = createForm.value.selectedSlots || []
      localStorage.setItem('createDialog_selectedSlots', JSON.stringify(slots))
      console.log('已保存坑位选择:', slots)
    }

    // IP计算辅助函数
    const calculateSingleIp = (startIp, offset) => {
      if (!startIp || offset === 0) return startIp
      try {
        const parts = startIp.split('.').map(Number)
        if (parts.length !== 4 || parts.some(isNaN)) return startIp

        let [a, b, c, d] = parts
        d += offset

        // 处理进位逻辑
        while (d > 255) { d -= 256; c += 1; }
        while (c > 255) { c -= 256; b += 1; }
        while (b > 255) { b -= 256; a += 1; }

        if (a > 255) return startIp
        return `${a}.${b}.${c}.${d}`
      } catch (e) {
        return startIp
      }
    }

    // 重置取消标志
    createCancelled.value = false

    // 校验特质镜像固件版本要求
    if (createForm.value.imageCategory === 'special') {
      const firmwareInfo = createDeviceFirmwareInfo.value
      const sdkVersion = firmwareInfo?.sdkVersion || ''
      const match = String(sdkVersion).match(/v?(\d+\.\d+\.\d+)/)
      const currentVer = match ? match[1] : '0.0.0'
      const requiredVer = '0.8.8'
      const [a1, a2, a3] = currentVer.split('.').map(Number)
      const [b1, b2, b3] = requiredVer.split('.').map(Number)
      const meets = (a1 || 0) > (b1 || 0) || ((a1 || 0) === (b1 || 0) && (a2 || 0) > (b2 || 0)) || ((a1 || 0) === (b1 || 0) && (a2 || 0) === (b2 || 0) && (a3 || 0) >= (b3 || 0))
      if (!meets) {
        ElMessage.error(`特质镜像要求固件版本 >= 0.8.8，当前固件版本为 ${currentVer}，请先升级固件`)
        return
      }
    }

    // 校验容器名称：不允许包含下划线
    const chineseRegex = /[\u4e00-\u9fa5]/
    if (chineseRegex.test(createForm.value.name) || createForm.value.name.includes('_')) {
      ElMessage.error('云机名称不允许包含中文和特殊字符_')
      return
    }

    // 准备目标设备列表
    let targetDevices = []
    if (createMode.value === 'multi-device-batch') {
      targetDevices = devices.value.filter(d => selectedBatchDevices.value.includes(d.ip))
      if (targetDevices.length === 0) {
        ElMessage.warning('请选择设备')
        return
      }
    } else if (createDevice.value) {
      targetDevices = [createDevice.value]
    }

    // 校验必须选择坑位
    if ((createMode.value === 'batch' || createMode.value === 'multi-device-batch') && (!createForm.value.selectedSlots || createForm.value.selectedSlots.length === 0)) {
      ElMessage.warning('请选择坑位')
      return
    }

    // 检查选中坑位状态，非正常状态的坑位需要用户二次确认
    const selectedSlots = createForm.value.selectedSlots || []
    const emptySlots = []
    const expiredSlots = []
    const expiringSlots = []
    selectedSlots.forEach(slot => {
      const info = slotStates.value[slot]
      if (!info || info.state === -1 || info.state === undefined) {
        emptySlots.push(slot)
      } else if (info.state === 2) {
        expiredSlots.push(slot)
      } else if (info.state === 1) {
        expiringSlots.push(slot)
      }
    })
    const warningCount = emptySlots.length + expiredSlots.length + expiringSlots.length
    if (warningCount > 0) {
      const parts = []
      if (emptySlots.length > 0) parts.push(`${emptySlots.length}个无实例`)
      if (expiredSlots.length > 0) parts.push(`${expiredSlots.length}个已过期`)
      if (expiringSlots.length > 0) parts.push(`${expiringSlots.length}个即将过期`)

      try {
        await ElMessageBox.confirm(
          `您选择的坑位中包含${parts.join('、')}的坑位，是否继续创建？`,
          '提示',
          { confirmButtonText: '继续创建', cancelButtonText: '取消', type: 'warning' }
        )
      } catch {
        return
      }
    }

    let globalIpIndex = 0

    // 统一校验自定义分辨率（覆盖 container 与非 container 两种 createType）
    const _checkCustomRes = (res, custom) => {
      if (res !== 'custom') return null
      const w = (custom?.width || '').toString().trim()
      const h = (custom?.height || '').toString().trim()
      const d = (custom?.dpi || '').toString().trim()
      if (!w || !h || !d) {
        return '自定义分辨率时，宽、高和DPI都必须填写'
      }
      if (!/^\d+$/.test(w) || !/^\d+$/.test(h) || !/^\d+$/.test(d)) {
        return '自定义分辨率的宽、高和DPI必须为正整数'
      }
      if (Number(w) <= 0 || Number(h) <= 0 || Number(d) <= 0) {
        return '自定义分辨率的宽、高和DPI必须大于0'
      }
      return null
    }
    const _resErr = _checkCustomRes(createForm.value.containerResolution, createForm.value.containerCustomResolution)
      || _checkCustomRes(createForm.value.resolution, createForm.value.customResolution)
    if (_resErr) {
      ElMessage.error(_resErr)
      return
    }

    // 批量创建模式下的容器模式逻辑
    if (createForm.value.createType === 'container') {
      let imageUrl = createForm.value.containerImageSelect
      if (createForm.value.containerAndroidVersion === 'custom' || imageUrl === 'custom') {
          imageUrl = createForm.value.containerCustomImageUrl
          if (!imageUrl) {
              ElMessage.error('请输入自定义镜像地址')
              return
          }
      } else if (!imageUrl) {
        ElMessage.error('请选择镜像地址')
        return
      }

      createLoading.value = true
      try {
        const { 
          containerName: name, 
          containerCount: count, 
          startSlot, 
          containerAndroidVersion: androidVersion, 
          containerResolution: resolution, 
          containerDns: dns, 
          containerCustomDns: customDns, 
          containerSandboxMode: sandboxMode, 
          containerDataDiskSize: dataDiskSize, 
          containerCustomResolution: customResolution
        } = createForm.value

        // 自定义分辨率校验已在前置统一完成

        const targets = []

        for (const device of targetDevices) {
          // 容器模式：支持新批量模式（指定坑位）
          if (createMode.value === 'batch' && createForm.value.selectedSlots && createForm.value.selectedSlots.length > 0) {
              for (const slot of createForm.value.selectedSlots) {
                  // Check if slot has running container
                  const hasRunning = isSlotOccupied(device, slot)

                  for (let k = 0; k < count; k++) {
                      // Determine start status
                      // 0对应边框为蓝色，1会黄色，2为红色，无实例对应灰色。
                      // 判断逻辑：
                      // 1. 未登录时：判断当前坑位是否有开机状态的云机，如果有则关机，否则开机
                      // 2. 已登录时：
                      //    - 未绑定(0)或被绑定(2)：判断当前坑位是否有开机状态的云机，如果有则关机，否则开机
                      //    - 已绑定(1)：根据坑位状态判断
                      //      * 状态0或1：如果有开机云机则关机，否则开机
                      //      * 状态2或无实例：默认关机
                      let shouldStart = false
                      // 仅第一个云机需要考虑开机；后续云机一律关机避免抢占同一坑位
                      if (k === 0) {
                         // 默认开机；坑位已过期（state === 2）时强制不开机
                          const slotInfo = slotStatesOf(device)[slot]
                          const isExpired = slotInfo && slotInfo.state === 2
                          // 坑位已有运行中的云机或已过期时，start 传 false
                          shouldStart = !isExpired && !hasRunning
                      }

                      // 计算当前实例的 IP
                      const currentMacVlanIp = calculateSingleIp(
                          createForm.value.containerMacVlanIp || createForm.value.macVlanIp,
                          globalIpIndex
                      )

                      targets.push({
                          createType: 'container', // 标记为容器创建
                          slot: slot,
                          start: shouldStart,
                          modelName: 'random', 
                          modelType: 'online',
                          deviceIp: device.ip,
                          deviceVersion: device.version,
                          deviceId: device.id,
                          imageUrl: imageUrl,
                          isLocalImage: false,

                          // Container specific fields
                          name: name ? `${name}_${slot}` : undefined,
                          androidVersion,
                          resolution,
                          customResolution: resolution === 'custom' ? { ...customResolution } : undefined,
                          dns,
                          customDns,
                          sandboxMode,
                          dataDiskSize,

                          vpcGroupId: createForm.value.vpcGroupId || '',
                          vpcNodeId: createForm.value.vpcSelectMode === 'random' ? 'random' : createForm.value.vpcNodeId,
                          mytBridgeName: createForm.value.mytBridgeName,
                          macVlanIp: currentMacVlanIp, // 优先使用容器模式的 MacVlan IP
                          networkCardType: createForm.value.containerNetworkCardType // 网卡类型
                      })
                      globalIpIndex++
                  }
              }
          } else {
              // 旧模式：单个坑位创建时 startSlot 即为用户选择的坑位，直接使用不跳过
              let availableSlot = startSlot
              const hasRunning = isSlotOccupied(device, availableSlot)

              for (let i = 0; i < count; i++) {
                // 计算当前实例的 IP
                const currentMacVlanIp = calculateSingleIp(
                  createForm.value.containerMacVlanIp || createForm.value.macVlanIp, 
                  globalIpIndex
                )

                targets.push({
                  createType: 'container', // 标记为容器创建
                  slot: availableSlot,
                  start: !hasRunning, // 有运行中的云机时 start 传 false
                  modelName: 'random', 
                  modelType: 'online',
                  deviceIp: device.ip,
                  deviceVersion: device.version,
                  deviceId: device.id,
                  imageUrl: imageUrl,
                  isLocalImage: false,

                  // Container specific fields
                  name: name ? `${name}_${availableSlot}` : undefined,
                  androidVersion,
                  resolution,
                  customResolution: resolution === 'custom' ? { ...customResolution } : undefined,
                  dns,
                  customDns,
                  sandboxMode,
                  dataDiskSize,

                  vpcGroupId: createForm.value.vpcGroupId || '',
                  vpcNodeId: createForm.value.vpcSelectMode === 'random' ? 'random' : createForm.value.vpcNodeId,
                  mytBridgeName: createForm.value.mytBridgeName,
                  macVlanIp: currentMacVlanIp, // 优先使用容器模式的 MacVlan IP
                  networkCardType: createForm.value.containerNetworkCardType // 网卡类型
                })
                availableSlot++
                globalIpIndex++
              }
          }
        }

        const taskId = addTaskToQueue('create', targets)
        executeTask(taskId)

        createDialogVisible.value = false
        createLoading.value = false
        ElMessage.success(`已添加 ${targets.length} 个云机创建任务到队列`)
      } catch (e) {
        console.error(e)
        createLoading.value = false
        ElMessage.error('创建任务失败')
      }
      return
    }

    // V3设备需要检查机型
    if (createDevice.value.version === 'v3') {
      if (createForm.value.modelType === 'online') {
        // 在线机型：需要选择机型
        if (!createForm.value.modelName || createForm.value.modelName === undefined) {
          ElMessage.error('请选择机型')
          return
        }
      } else if (createForm.value.modelType === 'backup') {
        // 备份机型：需要选择机型
        if (!createForm.value.modelStatic) {
          ElMessage.error('请选择备份机型')
          return
        }
      }
      // 本地机型：不需要选择机型，localModel 可选填
    }

    // 检查锁屏密码规则：4到8位纯数字
    const lockScreenPassword = createForm.value.lockScreenPassword
    if (lockScreenPassword) {
      const passwordRegex = /^\d{4,8}$/
      if (!passwordRegex.test(lockScreenPassword)) {
        ElMessage.error('锁屏密码必须是4到8位纯数字')
        return
      }
    }

    createLoading.value = true
    try {
      if (createMode.value === 'batch' || createMode.value === 'multi-device-batch') {
        // 批量创建 - 使用任务队列系统，支持无限制创建
        const { modelName, count, startSlot, modelType, localModel, modelStatic, selectedSlots } = createForm.value

        // 在循环前对按安卓版本过滤的机型列表取快照，避免循环过程中 computed 重新计算导致随机池变化
        const versionFilteredModelsSnapshot = androidVersionFilteredPhoneModels.value

        // 准备批量创建目标，自动分配可用坑位
        const targets = []

        for (const device of targetDevices) {
          // 新批量模式：指定坑位 + 单坑位数量
          if (createMode.value === 'batch' && selectedSlots && selectedSlots.length > 0) {
              for (const slot of selectedSlots) {
                  // Check if slot has running container
                  const hasRunning = isSlotOccupied(device, slot)

                  for (let k = 0; k < count; k++) {
                       // Determine start status
                       // 0对应边框为蓝色，1会黄色，2为红色，无实例对应灰色。
                       // 判断逻辑：
                       // 1. 未登录时：判断当前坑位是否有开机状态的云机，如果有则关机，否则开机
                       // 2. 已登录时：
                       //    - 未绑定(0)或被绑定(2)：判断当前坑位是否有开机状态的云机，如果有则关机，否则开机
                       //    - 已绑定(1)：根据坑位状态判断
                       //      * 状态0或1：如果有开机云机则关机，否则开机
                       //      * 状态2或无实例：默认关机
                       let shouldStart = false
                       // 仅第一个云机需要考虑开机；后续云机一律关机避免抢占同一坑位
                       if (k === 0) {
                           // 默认开机；坑位已过期（state === 2）时强制不开机
                           const slotInfo = slotStatesOf(device)[slot]
                           const isExpired = slotInfo && slotInfo.state === 2
                           // 坑位已有运行中的云机或已过期时，start 传 false
                           shouldStart = !isExpired && !hasRunning
                       }

                       // 获取本地镜像的 onlineUrl（从缓存读取）
                       let localImageOnlineUrl = ''
                       if (createForm.value.imageCategory === 'local' && createForm.value.localImageUrl) {
                           if (localCachedImages.value.length === 0) {
                               console.log(`[批量创建] 本地镜像列表为空，尝试加载...`)
                               await fetchLocalImages()
                           }
                           const cachedImage = localCachedImages.value.find(img => img.path === createForm.value.localImageUrl)
                           if (cachedImage && cachedImage.onlineUrl) {
                             localImageOnlineUrl = cachedImage.onlineUrl
                           }
                       }

                       // 计算当前实例的 IP
                       const currentMacVlanIp = calculateSingleIp(createForm.value.macVlanIp, globalIpIndex)

                       // Randomize model selection if 'random' is selected（从按安卓版本过滤后的机型中随机）
                       let targetModelName = modelName
                       if (modelType === 'online' && modelName === 'random') {
                          const vfModels = versionFilteredModelsSnapshot
                          if (vfModels && vfModels.length > 0) {
                            const randomIndex = Math.floor(Math.random() * vfModels.length)
                            targetModelName = vfModels[randomIndex].name
                          } else {
                            // 过滤后无机型：不回退到全量机型（会导致安卓版本不匹配），保持 'random' 由后续校验拦截
                            console.warn('[批量创建] 安卓版本过滤后无机型，可能 createForm.androidVersion 与机型数据不匹配')
                          }
                       }

                       let targetLocalModel = localModel
                       if (modelType === 'local' && (localModel === 'random' || localModel === '') && localPhoneModels.value.length > 0) {
                          const randomIndex = Math.floor(Math.random() * localPhoneModels.value.length)
                          targetLocalModel = localPhoneModels.value[randomIndex].name
                       }

                       let targetModelStatic = modelStatic
                       if (modelType === 'backup' && modelStatic === 'random' && backupPhoneModels.value.length > 0) {
                          const randomIndex = Math.floor(Math.random() * backupPhoneModels.value.length)
                          targetModelStatic = backupPhoneModels.value[randomIndex].name
                       }

                       targets.push({
                          slot: slot,
                          start: shouldStart,
                          modelName: targetModelName,
                          modelType: modelType,
                          localModel: targetLocalModel,
                          modelStatic: targetModelStatic,
                          deviceIp: device.ip,
                          deviceVersion: device.version,
                          deviceId: device.id,
                          androidVersion: createForm.value.androidVersion,
                          imageUrl: createForm.value.imageSelect === 'custom' ? createForm.value.customImageUrl : createForm.value.imageSelect,
                          isLocalImage: createForm.value.imageCategory === 'local',
                          localImageUrl: createForm.value.localImageUrl,
                          localImageOnlineUrl: localImageOnlineUrl,
                          vpcGroupId: createForm.value.vpcGroupId || '',
                          vpcNodeId: createForm.value.vpcSelectMode === 'random' ? 'random' : createForm.value.vpcNodeId,
                          mytBridgeName: createForm.value.mytBridgeName,
                          macVlanIp: currentMacVlanIp
                       })

                       globalIpIndex++
                  }
              }
          } else {
              let availableSlot = startSlot

              for (let i = 0; i < count; i++) {
                // 自动查找下一个可用坑位
                while (isSlotOccupied(device, availableSlot)) {
                  availableSlot++
                }

                // 获取本地镜像的 onlineUrl（从缓存读取）
                let localImageOnlineUrl = ''
                if (createForm.value.imageCategory === 'local' && createForm.value.localImageUrl) {
                  // 确保本地镜像列表已加载
                  if (localCachedImages.value.length === 0) {
                    console.log(`[批量创建] 本地镜像列表为空，尝试加载...`)
                    await fetchLocalImages()
                  }

                  const cachedImage = localCachedImages.value.find(img => img.path === createForm.value.localImageUrl)
                  if (cachedImage && cachedImage.onlineUrl) {
                    localImageOnlineUrl = cachedImage.onlineUrl
                    console.log(`[批量创建] 从缓存获取online_url: ${localImageOnlineUrl}`)
                  } else {
                    console.warn(`[批量创建] 未找到本地镜像的online_url: ${createForm.value.localImageUrl}`)
                  }
                }

                // 计算当前实例的 IP
                const currentMacVlanIp = calculateSingleIp(createForm.value.macVlanIp, globalIpIndex)

                // Randomize model selection if 'random' is selected（从按安卓版本过滤后的机型中随机）
                let targetModelName = modelName
                if (modelType === 'online' && modelName === 'random') {
                  const vfModels = versionFilteredModelsSnapshot
                  if (vfModels && vfModels.length > 0) {
                    const randomIndex = Math.floor(Math.random() * vfModels.length)
                    targetModelName = vfModels[randomIndex].name
                  } else {
                    // 过滤后无机型：不回退到全量机型（会导致安卓版本不匹配），保持 'random' 由后续校验拦截
                    console.warn('[批量创建] 安卓版本过滤后无机型，可能 createForm.androidVersion 与机型数据不匹配')
                  }
                }

                let targetLocalModel = localModel
                if (modelType === 'local' && (localModel === 'random' || localModel === '') && localPhoneModels.value.length > 0) {
                  const randomIndex = Math.floor(Math.random() * localPhoneModels.value.length)
                  targetLocalModel = localPhoneModels.value[randomIndex].name
                }

                let targetModelStatic = modelStatic
                if (modelType === 'backup' && modelStatic === 'random' && backupPhoneModels.value.length > 0) {
                  const randomIndex = Math.floor(Math.random() * backupPhoneModels.value.length)
                  targetModelStatic = backupPhoneModels.value[randomIndex].name
                }

                targets.push({
                  slot: availableSlot,
                  modelName: targetModelName,
                  modelType: modelType,
                  localModel: targetLocalModel,
                  modelStatic: targetModelStatic,
                  deviceIp: device.ip,
                  deviceVersion: device.version,
                  deviceId: device.id,
                  androidVersion: createForm.value.androidVersion,
                  imageUrl: createForm.value.imageSelect === 'custom' ? createForm.value.customImageUrl : createForm.value.imageSelect,
                  isLocalImage: createForm.value.imageCategory === 'local',
                  localImageUrl: createForm.value.localImageUrl,
                  localImageOnlineUrl: localImageOnlineUrl, // 本地镜像对应的在线地址
                  // 网络管理参数
                  vpcGroupId: createForm.value.vpcGroupId || '',
                  vpcNodeId: createForm.value.vpcSelectMode === 'random' ? 'random' : createForm.value.vpcNodeId,
                  mytBridgeName: createForm.value.mytBridgeName,
                  macVlanIp: currentMacVlanIp // macVlan IP
                })
                availableSlot++
                globalIpIndex++
              }
          }
        }

        // 添加到任务队列
        const taskId = addTaskToQueue('create', targets)
        executeTask(taskId)

        // 关闭创建对话框，不影响已添加的任务
        createDialogVisible.value = false
        createLoading.value = false
        ElMessage.success(`已添加 ${targets.length} 个云机创建任务到队列`)
      } else {
        // 单个坑位创建：使用任务队列系统
        const { modelName } = createForm.value

        // 检查是否已取消
        if (createCancelled.value) {
          ElMessage.info('创建取消')
          return
        }

        // 检查指定坑位是否可用
        const deviceContainers = deviceCloudMachinesCache.value.get(createDevice.value.ip) || []
        const usedSlots = new Set()
        deviceContainers.forEach(machine => {
          if (machine.status === 'running' && machine.indexNum) {
            usedSlots.add(machine.indexNum)
          }
        })

        // 检查当前运行中的容器数量是否已达到上限
        let maxSlots = 12
        if (createDevice.value.id && createDevice.value.id.toLowerCase().startsWith('p')) {
          maxSlots = 24
        }

        // 如果目标坑位已有运行中的云机，创建会覆盖它，不应受上限拦截
        if (!usedSlots.has(currentSlot.value) && usedSlots.size >= maxSlots) {
          ElMessage.error(`${createDevice.value.name}型号最大只能运行${maxSlots}个云机`)
          createLoading.value = false
          return
        }

        // 检查指定坑位是否已被占用
        // if (usedSlots.has(currentSlot.value)) {
        //   ElMessage.error(`坑位 ${currentSlot.value} 已被占用，请选择其他坑位`)
        //   createLoading.value = false
        //   return
        // }

        // 准备单个创建目标，添加到任务队列
        // Randomize model selection if 'random' is selected
        // let targetModelName = modelName
        // if (createForm.value.modelType === 'online' && modelName === 'random' && phoneModels.value.length > 0) {
        //   const randomIndex = Math.floor(Math.random() * phoneModels.value.length)
        //   targetModelName = phoneModels.value[randomIndex].name
        // }

        let targetLocalModel = createForm.value.localModel
        if (createForm.value.modelType === 'local' && (targetLocalModel === 'random' || targetLocalModel === '') && localPhoneModels.value.length > 0) {
          const randomIndex = Math.floor(Math.random() * localPhoneModels.value.length)
          targetLocalModel = localPhoneModels.value[randomIndex].name
        }

        let targetModelStatic = createForm.value.modelStatic
        if (createForm.value.modelType === 'backup' && targetModelStatic === 'random' && backupPhoneModels.value.length > 0) {
          const randomIndex = Math.floor(Math.random() * backupPhoneModels.value.length)
          targetModelStatic = backupPhoneModels.value[randomIndex].name
        }

        // 目标坑位已有运行中的云机时，start 传 false（覆盖创建）
        const isSlotRunning = usedSlots.has(currentSlot.value)

        const target = {
          slot: currentSlot.value,
          start: !isSlotRunning,
          modelName: modelName,
          modelType: createForm.value.modelType,
          localModel: targetLocalModel,
          modelStatic: targetModelStatic,
          deviceIp: createDevice.value.ip,
          deviceVersion: createDevice.value.version,
          deviceId: createDevice.value.id,
          imageUrl: createForm.value.imageSelect === 'custom' ? createForm.value.customImageUrl : createForm.value.imageSelect,
          isLocalImage: createForm.value.imageCategory === 'local',
          localImageUrl: createForm.value.localImageUrl,
          // 网络管理参数
          vpcGroupId: createForm.value.vpcGroupId || '',
          vpcNodeId: createForm.value.vpcSelectMode === 'random' ? 'random' : createForm.value.vpcNodeId,
          mytBridgeName: createForm.value.mytBridgeName,
          macVlanIp: createForm.value.macVlanIp // macVlan IP
        }

        // 添加到任务队列
        const taskId = addTaskToQueue('create', [target])
        executeTask(taskId)

        // 关闭创建对话框
        createDialogVisible.value = false
        createLoading.value = false
        ElMessage.success('云机创建任务已添加到队列')
      }
    } catch (error) {
      if (error.message === '创建取消') {
        ElMessage.info('创建取消')
      } else {
        console.error('创建云机失败:', error)
        ElMessage.error(`创建云机失败：${error.message}`)
      }
    } finally {
      createLoading.value = false
    }
  }

  // 处理创建表单取消
  const handleCreateCancel = () => {
    // 取消时也保存坑位选择，以便下次恢复
    if (createMode.value === 'batch' || createMode.value === 'multi-device-batch') {
      const slots = createForm.value.selectedSlots || []
      localStorage.setItem('createDialog_selectedSlots', JSON.stringify(slots))
    }
    createDialogVisible.value = false
    createLoading.value = false
  }

  return {
    createV3CloudMachine,
    handleCreateSubmit,
    handleCreateCancel,
  }
}
