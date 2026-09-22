/**
 * 云机更新镜像（单个）：打开弹窗、提交、取消。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue，需要的 ref / 宿主函数通过依赖对象传入，不用 provide/inject。
 * ElMessage 与 wails binding CloseProjectionWindow 由本模块自己 import。
 */
import { ElMessage } from 'element-plus'
import axios from 'axios'
import { getDeviceAddr } from '../utils/device.js'
import { CloseProjectionWindow } from '../../bindings/edgeclient/app'

export function useCloudMachineUpdate({
  devices,
  activeDevice,
  deviceCloudMachinesCache,
  cloudManageMode,
  phoneModels,
  imageList,
  filteredImageList,
  createDevice,
  createForm,
  isPSeries,
  updateImageDialogVisible,
  updateImageContainer,
  updateImageLoading,
  updateImageForm,
  getV3PhoneModels,
  fetchVpcGroupList,
  fetchNetworkCards,
  fetchNetworkCardsForUpdate,
  getRandomVpcNodeId,
  fetchImageList,
  authRetry,
  fetchAndroidContainers,
}) {
  const showUpdateImageDialog = async (container) => {
    // 确定目标设备
    let targetDevice = activeDevice.value
    if (cloudManageMode.value === 'batch' && container && container.deviceIp) {
      targetDevice = devices.value.find(d => d.ip === container.deviceIp) || { ip: container.deviceIp, version: 'v3' }
    }

    // 刷新容器列表，确保拿到最新数据
    if (targetDevice) {
      await fetchAndroidContainers(targetDevice, false)
      // 从最新缓存中找到对应容器（按 name 匹配）
      const freshList = deviceCloudMachinesCache.value.get(targetDevice.ip) || []
      const freshContainer = freshList.find(inst => inst.name === container.name)
      if (freshContainer) {
        container = freshContainer
      }
    }

    // 确保 targetDevice 包含 androidType，供 resetAndroidContainer 使用
    if (targetDevice && container) {
      targetDevice.androidType = container.androidType
    }

    // Update createDevice for isPSeries computed property
    createDevice.value = targetDevice 

    if (!targetDevice) {
      ElMessage.error('没有选中设备')
      return
    }

    updateImageContainer.value = container

    // 解析分辨率回显
    let resolutionValue = '720x1280x320' // 默认值
    let customRes = {
      width: '720',
      height: '1280',
      dpi: '320'
    }

    // 检查是否是容器模式 (V2) 且有详细分辨率信息
    if (container.androidType === 'V2' && container.doboxWidth && container.doboxHeight) {
      const w = String(container.doboxWidth)
      const h = String(container.doboxHeight)
      const dpi = String(container.doboxDpi || '320')

      if (w === '720' && h === '1280') {
        resolutionValue = '720x1280x320'
      } else if (w === '1080' && h === '1920') {
        resolutionValue = '1080x1920x420'
      } else {
        resolutionValue = 'custom'
        customRes = {
          width: w,
          height: h,
          dpi: dpi
        }
      }
    }


    // dns：判断是否是预设值，否则归为 custom
    const dnsRaw = container.dns || ''
    const dnsPresets = ['223.5.5.5', '8.8.8.8', '']
    const dnsSelectValue = dnsPresets.includes(dnsRaw) ? dnsRaw : 'custom'
    const customDnsValue = dnsPresets.includes(dnsRaw) ? '' : dnsRaw

    // networkName==='myt' 表示公有网卡
    const isPublicNetworkCard = container.networkName === 'myt'

    // 重置表单
    updateImageForm.value = {
      imageSelect: '',
      customImageUrl: '',
      modelName: container.modelName || '',
      enableMagisk: container.mgenable === '1',
      enableGMS: container.gmsenable === '1',
      dns: dnsSelectValue,
      customDns: customDnsValue,
      resolution: resolutionValue,
      customResolution: customRes,
      longitud: '',
      latitude: '',
      vpcGroupId: '',
      vpcNodeId: '',
      vpcSelectMode: 'specified',
      randomFile: container.randomFile || false,
      networkCardType: isPublicNetworkCard ? 'public' : 'private',
      mytBridgeName: container.mytBridgeName || '',
      macVlanIp: container.macVlanIp || '',
      enforce: container.enforce !== false // 安全模式，从容器数据读取（undefined/true均视为开启）
    }

    // 获取设备类型
    const deviceType = targetDevice.name || 'C1'

    // 获取镜像列表
     await fetchImageList(deviceType)

     // 获取网络分组列表
     await fetchVpcGroupList(targetDevice.ip)

     // 获取网卡列表 (仅V3设备)
     if (targetDevice.version === 'v3') {
       // 由于 fetchNetworkCards 依赖 createDevice.value 和 createForm.value，我们需要临时设置一下
       // 但更好的方式是让 fetchNetworkCards 接受参数，或者在这里直接调用底层 API
       // 考虑到复用性，我们修改 fetchNetworkCards 使其更通用，或者在这里手动调用

       // 方案：直接复用 fetchNetworkCards，但在调用前确保 createForm 的值被正确设置
       // 注意：fetchNetworkCards 使用的是 createForm.value，而这里是 updateImageForm
       // 所以我们需要改造 fetchNetworkCards 或者 复制一份逻辑
       // 为了避免副作用，我们在这里复制一份逻辑，专门用于 updateImageForm
       await fetchNetworkCardsForUpdate(targetDevice.ip)
     }

     // 获取当前容器使用的镜像
    const currentImageUrl = container.image || ''
    const cleanedUrl = currentImageUrl.toLowerCase()

    // 查找当前镜像是否在列表中 - 优化匹配逻辑
    let currentImage = null

    // 1. 精确匹配：检查image.url是否与currentImageUrl完全匹配
    currentImage = filteredImageList.value.find(image => {
      return image.url && image.url.toLowerCase() === cleanedUrl
    })

    // 2. 如果没有精确匹配，尝试模糊匹配：检查image.url是否是currentImageUrl的一部分
    if (!currentImage) {
      currentImage = filteredImageList.value.find(image => {
        return image.url && cleanedUrl.includes(image.url.toLowerCase())
      })
    }

    // 3. 如果仍然没有找到，尝试在完整镜像列表中查找
    if (!currentImage) {
      currentImage = imageList.value.find(image => {
        return image.url && image.url.toLowerCase() === cleanedUrl
      })
    }

    // 4. 最后尝试在完整镜像列表中进行模糊匹配
    if (!currentImage) {
      currentImage = imageList.value.find(image => {
        return image.url && cleanedUrl.includes(image.url.toLowerCase())
      })
    }

    if (currentImage) {
      // 如果在列表中，选择它
      updateImageForm.value.imageSelect = currentImage.url
    } else if (currentImageUrl) {
      // 如果不在列表中但有镜像URL，选择自定义并填写
      updateImageForm.value.imageSelect = 'custom'
      updateImageForm.value.customImageUrl = currentImageUrl
    } else {
      // 如果没有镜像URL，设置默认镜像为过滤后的第一个镜像
      if (filteredImageList.value.length > 0) {
        updateImageForm.value.imageSelect = filteredImageList.value[0].url
      }
    }

    // 如果是V3设备，获取型号列表
    if (targetDevice.version === 'v3') {
      await getV3PhoneModels(targetDevice.ip)
    }

    updateImageDialogVisible.value = true
  }

  // 处理更新镜像提交
  const handleUpdateImageSubmit = async () => {
    // 确定目标设备
    let targetDevice = activeDevice.value
    if (cloudManageMode.value === 'batch' && updateImageContainer.value && updateImageContainer.value.deviceIp) {
      targetDevice = devices.value.find(d => d.ip === updateImageContainer.value.deviceIp) || { ip: updateImageContainer.value.deviceIp, version: 'v3' }
    }

    if (!updateImageContainer.value || !targetDevice) {
      ElMessage.error('没有选中容器或设备')
      return
    }

    updateImageLoading.value = true
    try {
      // 获取镜像URL
      let imageUrl = updateImageForm.value.imageSelect
      if (updateImageForm.value.imageSelect === 'custom') {
        imageUrl = updateImageForm.value.customImageUrl
      }

      // 确保镜像URL不为空
      if (!imageUrl) {
        ElMessage.error('请选择或输入镜像URL')
        return
      }

      // 调用后端API更新镜像
      console.log('调用后端API更新镜像:', updateImageContainer.value.name, imageUrl)

      if (targetDevice.version === 'v3') {
        // V3设备使用switchImage API
        // 从手机型号列表中查找对应的ModelId
        let modelId = ''
        const model = phoneModels.value.find(m => m.name === updateImageForm.value.modelName)
        if (model) {
          modelId = model.id || ''
        } 

        // 确保ModelId不为空，使用默认值
        if (!modelId) {
          modelId = '' // 默认空
        }

        // 处理DNS设置
        let dnsValue = updateImageForm.value.dns;
        if (updateImageForm.value.dns === 'custom' && updateImageForm.value.customDns) {
          dnsValue = updateImageForm.value.customDns;
        }

        // 解析分辨率
        let doboxWidth = ''
        let doboxHeight = ''
        let doboxDpi = ''

        if (updateImageForm.value.resolution === 'default') {
          // 机型默认分辨率，传递空值
          doboxWidth = ''
          doboxHeight = ''
          doboxDpi = ''
        } else if (updateImageForm.value.resolution === 'custom') {
          // 自定义分辨率
          doboxWidth = updateImageForm.value.customResolution.width || '720'
          doboxHeight = updateImageForm.value.customResolution.height || '1280'
          doboxDpi = updateImageForm.value.customResolution.dpi || '320'
        } else {
          // 预设分辨率
          const parts = updateImageForm.value.resolution.split('x')
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

        // 构造请求体，参考老客户端的V3SwitchImageReq结构体
        const switchImageReq = {
          name: updateImageContainer.value.name,
          modelId: modelId,
          modelName: updateImageForm.value.modelName,
          imageUrl: imageUrl,
          mgenable: updateImageForm.value.enableMagisk ? '1' : '0',
          gmsenable: updateImageForm.value.enableGMS ? '1' : '0',
          dns: dnsValue,
          doboxWidth: doboxWidth,
          doboxHeight: doboxHeight,
          doboxDpi: doboxDpi,
          randomFile: updateImageForm.value.randomFile, // 随机系统文件
          enforce: updateImageForm.value.enforce !== false, // 安全模式，默认开启
          mytBridgeName: updateImageForm.value.mytBridgeName, // 网卡参数
          macVlanIp: updateImageForm.value.macVlanIp // macVlan IP
        }

        // 添加VPC网络管理配置
        if (updateImageForm.value.vpcGroupId) {
          switchImageReq.vpcGroupId = updateImageForm.value.vpcGroupId
          if (updateImageForm.value.vpcSelectMode === 'random') {
            switchImageReq.vpcID = getRandomVpcNodeId()
          } else {
            switchImageReq.vpcID = updateImageForm.value.vpcNodeId || ''
          }
        }

        console.log('发送V3 switchImage请求:', switchImageReq)

        // 使用authRetry处理认证
        await authRetry(targetDevice, async (password) => {
          let headers = {}
          if (password) {
            const auth = btoa(`admin:${password}`)
            headers = {
              'Authorization': `Basic ${auth}`
            }
          }

          let switchUrl = `http://${getDeviceAddr(targetDevice.ip)}/android/switchImage`
          let requestBody = switchImageReq

          // 检查是否是容器模式 (V2)
          if (updateImageContainer.value.androidType === 'V2') {
            switchUrl = `http://${getDeviceAddr(targetDevice.ip)}/androidV2/switchImage`
            requestBody = {
              imageUrl: imageUrl,
              name: updateImageContainer.value.name,
              dns: dnsValue,
              doboxDpi: doboxDpi,
              doboxFps: '24', // 默认24FPS
              doboxHeight: doboxHeight,
              doboxWidth: doboxWidth,
              enforce: updateImageForm.value.enforce !== false // 安全模式
            }
            if (updateImageForm.value.networkCardType === 'public' && updateImageForm.value.macVlanIp) {
              requestBody.macVlanIp = updateImageForm.value.macVlanIp
            } else if (updateImageForm.value.networkCardType === 'private' && updateImageForm.value.mytBridgeName) {
              requestBody.mytBridgeName = updateImageForm.value.mytBridgeName
            }
          }

          // 发送前关闭投屏窗口
          try {
            await CloseProjectionWindow(updateImageContainer.value.name);
          } catch(e) { console.warn('关闭投屏窗口失败:', e); }

          // 使用axios调用V3 API
          const response = await axios.post(switchUrl, requestBody, {
            headers: headers
          })
          console.log('V3 switchImage成功，返回数据:', response.data)

          // 检查响应状态
          if (response.data.code !== 0) {
            if (response.data.code === 61 && response.data.message === 'Authentication Failed') {
              throw new Error('Authentication Failed')
            } else {
              throw new Error(`切换镜像失败: ${response.data.message || '未知错误'}`)
            }
          }
        })
      } else {
        // 对于V2及以前的设备，根据要求，不调用API，只返回功能正在开发中的提示
        ElMessage.info('功能正在开发中')
        updateImageDialogVisible.value = false
        return
      }

      // 关闭对话框
      updateImageDialogVisible.value = false

      // 立即更新本地缓存中该容器的关键字段（设备端重建中，接口可能返回旧值）
      const containerName = updateImageContainer.value.name
      const cachedList = deviceCloudMachinesCache.value.get(targetDevice.ip)
      if (cachedList) {
        const idx = cachedList.findIndex(m => m.name === containerName)
        if (idx !== -1) {
          const finalDns = updateImageForm.value.dns === 'custom'
            ? (updateImageForm.value.customDns || '')
            : (updateImageForm.value.dns || '')
          const isPublic = updateImageForm.value.networkCardType === 'public'
          cachedList[idx] = {
            ...cachedList[idx],
            dns: finalDns,
            randomFile: updateImageForm.value.randomFile,
            mgenable: updateImageForm.value.enableMagisk ? '1' : '0',
            gmsenable: updateImageForm.value.enableGMS ? '1' : '0',
            networkName: isPublic ? 'myt' : (updateImageForm.value.mytBridgeName || cachedList[idx].networkName),
            macVlanIp: isPublic ? (updateImageForm.value.macVlanIp || '') : '',
            mytBridgeName: isPublic ? '' : (updateImageForm.value.mytBridgeName || ''),
            ip: isPublic ? (updateImageForm.value.macVlanIp || cachedList[idx].ip) : cachedList[idx].ip,
            image: imageUrl,
            enforce: updateImageForm.value.enforce !== false, // 安全模式
          }
          deviceCloudMachinesCache.value.set(targetDevice.ip, [...cachedList])
        }
      }

      // 刷新容器列表，传递isUserInitiated=true确保强制刷新
      await fetchAndroidContainers(targetDevice, true)

      ElMessage.success('镜像更新成功')
    } catch (error) {
      console.error('更新镜像失败:', error)
      ElMessage.error(`更新镜像失败：${error.message}`)
    } finally {
      updateImageLoading.value = false
    }
  }

  // 处理更新镜像取消
  const handleUpdateImageCancel = () => {
    updateImageDialogVisible.value = false
  }

  return {
    showUpdateImageDialog,
    handleUpdateImageSubmit,
    handleUpdateImageCancel,
  }
}
