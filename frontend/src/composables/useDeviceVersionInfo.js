/**
 * 设备 / 镜像信息展示：
 *   - getImageDisplayName：把镜像 URL 或本地 tar 路径转成可读的镜像名
 *     （先在 imageList 里精确/模糊/反向/按名匹配，匹配不到再从路径里抽文件名或镜像名:标签）
 *   - handleGetDeviceVersion：查单台设备的版本信息，带最小查询间隔节流，
 *     拿到新版本后回填 deviceVersionInfo 并驱动版本检查队列
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 */
import { ElMessage } from 'element-plus'

export function useDeviceVersionInfo({
  imageList,
  loading,
  fetchV3LatestInfo,
  deviceVersionInfo,
}, lazyDeps = {}) {
  // 以下依赖来自下方才调用的 useVersionCheckQueue，用惰性依赖避免 TDZ
  const {
    getLastCheckTime,
    getMinCheckInterval,
    addToVersionCheckQueue,
    batchProcessVersionCheckQueue,
  } = lazyDeps

  // lastCheckTime 是下方才创建的 ref，用代理把 .value 的读 / 写转发到真实对象
  const proxyRef = (get) => ({
    get value() { return get().value },
    set value(v) { get().value = v },
  })
  const lastCheckTime = proxyRef(getLastCheckTime)

  const getImageDisplayName = (imageUrl) => {
    if (!imageUrl) return '未知镜像'

    // 清理镜像URL，移除可能的协议和多余路径
    const cleanedUrl = imageUrl.toLowerCase()

    // 1. 从镜像列表中查找匹配的镜像
    let matchedImage = null

    // 精确匹配：检查image.url是否与imageUrl完全匹配
    matchedImage = imageList.value.find(image => {
      return image.url && image.url.toLowerCase() === cleanedUrl
    })


    // 如果没有精确匹配，尝试模糊匹配：检查image.url是否是imageUrl的一部分
    if (!matchedImage) {
      matchedImage = imageList.value.find(image => {
        return image.url && cleanedUrl.includes(image.url.toLowerCase())
      })
    }

    // 如果没有找到，尝试反向匹配：检查imageUrl是否是image.url的一部分
    if (!matchedImage) {
      matchedImage = imageList.value.find(image => {
        return image.url && image.url.toLowerCase().includes(cleanedUrl)
      })
    }

    // 如果仍然没有找到，尝试匹配镜像名称
    if (!matchedImage) {
      // 从URL中提取镜像名称部分用于匹配
      const urlParts = cleanedUrl.split('/')
      const urlNamePart = urlParts[urlParts.length - 1]

      matchedImage = imageList.value.find(image => {
        return image.name && image.name.toLowerCase().includes(urlNamePart)
      })
    }

    if (matchedImage) {
      // 2. 如果找到匹配的镜像，返回其名称
      return matchedImage.name || matchedImage.url
    }

    // 3. 如果没有找到匹配的镜像，从URL中提取用户友好的名称

    // 处理本地文件路径
    if (cleanedUrl.includes('\\') || cleanedUrl.endsWith('.tar.gz')) {
      // 本地镜像路径，提取文件名
      const pathParts = cleanedUrl.split(/[\\/]/)
      let fileName = pathParts[pathParts.length - 1]
      // 移除文件扩展名
      fileName = fileName.replace('.tar.gz', '')
      fileName = fileName.replace('.tar', '')
      return fileName
    }

    // 处理Docker镜像URL
    // 例如：registry.magicloud.tech/magicloud/dobox-android13:Q1 -> dobox-android13:Q1
    // 例如：docker.io/library/nginx:latest -> nginx:latest
    const parts = cleanedUrl.split('/')
    if (parts.length > 0) {
      let imageName = parts[parts.length - 1]

      // 进一步优化：如果镜像名包含registry或magicloud等关键词，尝试提取更友好的名称
      const friendlyNameMatch = imageName.match(/([a-zA-Z0-9_-]+):([a-zA-Z0-9._-]+)$/)
      if (friendlyNameMatch) {
        return friendlyNameMatch[0] // 返回 镜像名:标签 格式
      }

      return imageName
    }

    // 4. 否则返回原始URL
    return imageUrl
  }



  // 处理主机管理设备选择变化


  // 单个设备删除处理


  // 批量删除设备处理


  // 获取设备版本信息 - 优化版
  const handleGetDeviceVersion = async (device, isFromUpgrade = false) => {
    try {
      const now = Date.now()
      const lastTime = lastCheckTime.value.get(device.id) || 0

      // 检查是否在最小检查间隔内（MIN_CHECK_INTERVAL 来自下方才调用的 useVersionCheckQueue，现读）
      if (now - lastTime < getMinCheckInterval()) {
        console.log(`设备 ${device.ip} 最近已查询过，跳过本次检查`)
        if (!isFromUpgrade) {
          ElMessage.warning(`设备 ${device.ip} 最近已查询过，请稍后再试`)
        }
        return
      }

      // 只在手动调用时显示全局loading
      if (!isFromUpgrade) {
        loading.value = true
      }

      console.log('获取设备版本信息:', device.ip)

      // 手动查询添加到优先级队列
      addToVersionCheckQueue(device, true)

      // 立即触发一次队列处理
      batchProcessVersionCheckQueue()

      // 同时获取版本信息
      fetchV3LatestInfo(device)

      // 如果是手动调用，优化loading显示
      if (!isFromUpgrade) {
        // 设置1.5秒超时，避免loading显示太久
        const loadingTimeout = setTimeout(() => {
          if (loading.value) {
            loading.value = false
            ElMessage.info(`设备 ${device.ip} 版本检查正在进行中，请稍候查看结果`)
          }
        }, 1500)

        // 监听版本信息变化，及时关闭loading
        const checkVersionUpdate = setInterval(() => {
          const version = deviceVersionInfo.value.get(device.id)
          const lastCheck = lastCheckTime.value.get(device.id) || 0

          if (lastCheck >= now && version) {
            clearInterval(checkVersionUpdate)
            clearTimeout(loadingTimeout)
            if (loading.value) {
              loading.value = false
              ElMessage.success(`设备 ${device.ip} 版本信息已更新`)
            }
          }
        }, 200)

        // 最多检查10次
        setTimeout(() => {
          clearInterval(checkVersionUpdate)
        }, 2000)
      }
    } catch (error) {
      console.error('获取设备版本信息失败:', error)
      if (!isFromUpgrade) {
        loading.value = false
        ElMessage.error(`获取设备 ${device.ip} 版本信息失败: ${error.message}`)
      } else {
        console.error('升级后版本检查失败:', error)
      }
    }
  }

  return {
    getImageDisplayName,
    handleGetDeviceVersion,
  }
}
