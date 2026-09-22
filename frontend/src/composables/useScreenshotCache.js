/**
 * 安卓容器截图缓存（后端轮询驱动）。
 *
 * 后端每 800ms 抓一次截图存缓存，前端 150ms 拉版本号，有更新才拉 base64，
 * 彻底消除前端对每个坑位独立发 IPC 请求的性能开销。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同。
 *
 * 需要宿主状态的三个 ref 通过依赖对象传入（本仓库不用 provide/inject）：
 *   cloudManageMode / selectedCloudDevice / selectedCloudMachines
 * `getScreenshotVersions` / `getScreenshots` 属于服务层，按本仓库惯例由本模块自己 import。
 *
 * 注意：原 App.vue 里的 `watch(cloudManageMode, ...)` 一并搬入，useScreenshotCache()
 * 仍在 `<script setup>` 顶层、原位置同步调用，watch 注册时机与拆分前一致。
 */
import { ref, watch } from 'vue'
import { getScreenshotVersions, getScreenshots } from '../services/api.js'

export function useScreenshotCache({ cloudManageMode, selectedCloudDevice, selectedCloudMachines }) {
  // 截图数据缓存 Map<"ip_containerName", base64DataURL>
  // 每次更新都替换整个 Map 对象，确保 Vue 响应式能检测到变化
  const screenshotDataCache = ref(new Map())
  // 每台设备的本地版本号快照，用于对比后端是否有新截图
  let screenshotLocalVersions = {}
  // 截图版本轮询定时器
  let screenshotCacheTimer = null
  // 防并发标志：避免同一时刻多个轮询 tick 重叠执行
  let screenshotFetching = false

  // 300ms 轮询：比较版本号，有变化才拉取该设备的截图数据
  const fetchScreenshotCacheIfUpdated = async () => {
    if (screenshotFetching) return
    screenshotFetching = true
    try {
      const versions = await getScreenshotVersions()
      // console.log('[截图轮询] versions:', versions, '| mode:', cloudManageMode.value, '| selectedDevice:', selectedCloudDevice.value?.ip)

      // Wails 会把 Go 空 map 序列化为 null，视为无数据但不阻断逻辑
      if (!versions || Object.keys(versions).length === 0) {
        // console.log('[截图轮询] versions 为空（后端尚无截图数据），跳过')
        return
      }

      // 找出有版本变化的设备
      const targetIps = []
      if (cloudManageMode.value === 'slot' && selectedCloudDevice.value) {
        const ip = selectedCloudDevice.value.ip
        // console.log(`[截图轮询] 坑位模式 ip=${ip} 后端版本=${versions[ip]} 本地版本=${screenshotLocalVersions[ip]}`)
        if (versions[ip] !== undefined && versions[ip] !== screenshotLocalVersions[ip]) {
          targetIps.push(ip)
        }
      } else if (cloudManageMode.value === 'batch') {
        const ipSet = new Set(selectedCloudMachines.value.map(m => m.deviceIp).filter(Boolean))
        const ips = ipSet.size > 0 ? ipSet : new Set(Object.keys(versions))
        for (const ip of ips) {
          if (versions[ip] !== undefined && versions[ip] !== screenshotLocalVersions[ip]) {
            targetIps.push(ip)
          }
        }
      } else {
        // console.log('[截图轮询] 无匹配模式或无选中设备，跳过')
      }

      // console.log('[截图轮询] targetIps:', targetIps)
      if (targetIps.length === 0) return

      // 并行拉取有变化的设备截图数据
      let hasUpdate = false
      await Promise.all(targetIps.map(async (ip) => {
        const snapshots = await getScreenshots(ip)
        // console.log(`[截图轮询] getScreenshots(${ip}) 返回:`, snapshots ? Object.keys(snapshots).length + ' 条' : 'null/undefined')
        if (!snapshots) return
        let count = 0
        for (const [key, dataURL] of Object.entries(snapshots)) {
          if (dataURL) {
            screenshotDataCache.value.set(key, dataURL)
            hasUpdate = true
            count++
          }
        }
        // console.log(`[截图轮询] 设备 ${ip} 写入缓存 ${count} 张`)
        screenshotLocalVersions[ip] = versions[ip]
      }))

      if (hasUpdate) {
        screenshotDataCache.value = new Map(screenshotDataCache.value)
        // console.log('[截图轮询] screenshotDataCache 已更新，共', screenshotDataCache.value.size, '条')
      }
    } catch (e) {
      console.error('[截图轮询] 异常:', e)
    } finally {
      screenshotFetching = false
    }
  }

  // 启动截图缓存轮询（切换到云机管理页面时调用）
  const startScreenshotRefresh = () => {
    if (screenshotCacheTimer) {
      // console.log('[截图轮询] 定时器已存在，不重复启动')
      return
    }
    console.log('[截图轮询] 启动定时器 150ms')
    screenshotCacheTimer = setInterval(fetchScreenshotCacheIfUpdated, 150)
    fetchScreenshotCacheIfUpdated()
  }

  // 停止截图缓存轮询（离开云机管理页面时调用）
  const stopScreenshotRefresh = () => {
    if (screenshotCacheTimer) {
      // console.log('[截图轮询] 停止定时器')
      clearInterval(screenshotCacheTimer)
      screenshotCacheTimer = null
    }
    screenshotFetching = false
  }

  // 获取指定容器的截图数据（供 CloudManagement 透传给 ScreenshotImage）
  const getContainerScreenshotData = (deviceIp, containerName) => {
    return screenshotDataCache.value.get(`${deviceIp}_${containerName}`) || ''
  }

  // 清空版本号快照，强制下一轮轮询立即拉取。
  // 原 App.vue 是直接对 `screenshotLocalVersions` 赋值，变量收进闭包后改用这个函数。
  const resetScreenshotVersions = () => {
    screenshotLocalVersions = {}
  }

  // 监听云机管理模式变化：清空版本快照，强制立即拉取新模式下的截图
  watch(cloudManageMode, () => {
    screenshotLocalVersions = {}
    screenshotFetching = false   // 重置并发锁，防止上一轮请求残留导致下次 tick 被跳过
    // 切模式时 selectedCloudMachines 清空会触发 watch(selectedCloudMachines) → stopScreenshotRefresh()
    // 必须在此重新启动定时器，否则后续 300ms 轮询永远不再触发
    screenshotCacheTimer && clearInterval(screenshotCacheTimer)
    screenshotCacheTimer = null
    startScreenshotRefresh()
    // 不清空 screenshotDataCache，保留已有图片避免闪烁
  })

  return {
    screenshotDataCache,
    fetchScreenshotCacheIfUpdated,
    startScreenshotRefresh,
    stopScreenshotRefresh,
    getContainerScreenshotData,
    resetScreenshotVersions,
  }
}
