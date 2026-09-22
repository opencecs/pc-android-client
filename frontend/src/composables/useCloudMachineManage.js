/**
 * 云机管理模式切换、云机选中、批量动作，以及镜像的下载 / 上传进度与完成回调。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue，64 个宿主 ref / 函数通过依赖对象传入，不用 provide/inject。
 * ElMessage / ElMessageBox 与 wails binding DeleteLocalImage 由本模块自己 import。
 *
 * `t` 是 App.vue 里的本地 i18n 包装，通过依赖对象传入。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { startContainer, stopContainer, startBatchProjection, startProjectionBatchControl, stopProjectionBatchControl } from '../services/api.js'
import { DeleteLocalImage } from '../../bindings/edgeclient/app'

export function useCloudMachineManage({
  t,
  devices,
  activeDevice,
  instances,
  allInstances,
  cloudMachines,
  deviceCloudMachinesCache,
  deviceAllInstancesCache,
  cloudManageMode,
  cloudMachineGroups,
  selectedCloudDevice,
  selectedCloudMachines,
  loading,
  batchModeProjectionControlling,
  slotModeProjectionControlStatus,
  isBatchProjectionControlling,
  taskQueue,
  phoneModels,
  imageList,
  batchUploadDialogVisible,
  batchUploadSelectedMachines,
  devicesStatusCache,
  localCachedImages,
  isDownloadingImage,
  downloadProgress,
  currentDownloadImage,
  currentDownloadTaskId,
  downloadStartTime,
  imageDownloadStatus,
  imageUploadStatus,
  isUploadingImage,
  uploadProgress,
  currentUploadImage,
  countryList,
  isPSeries,
  batchUpdateImageDialogVisible,
  batchUpdateImageGroups,
  isBatchImagePSeries,
  getBatchUpdateV3List,
  slotStates,
  setSlotStates,
  fetchAndCacheSlotStates,
  ensureSlotStatesLoaded,
  getV3PhoneModels,
  getCountryList,
  fetchImageList,
  fetchLocalCachedImages,
  showDeviceSelectionDialog,
  selectedDevicesForUpload,
  currentUploadingImage,
  authRetry,
  treeSelectedKeys,
  batchSwitchBackupProgressVisible,
  batchSwitchBackupProgressList,
  batchSwitchBackupTotal,
  batchSwitchBackupDone,
  computeCloudMachineGroups,
  initCloudMachineGroups,
  handleBatchUpload,
  updateCloudMachines,
  initModelSlots,
  batchSwitchModelDialogVisible,
  batchSwitchModelTargets,
  batchSwitchModelOperationType,
  fetchAndroidContainers,
}, lazyDeps = {}) {
  // 截图缓存 / 任务队列在 App.vue 下方才创建，用惰性依赖避免 TDZ
  const { resetScreenshotVersions, addTaskToQueue, executeTask } = lazyDeps
  const handleCloudManageModeChange = (mode) => {
    console.log('云机管理模式变化:', mode, '当前模式:', cloudManageMode.value)

    // 切换模式时清空所有选择状态，防止批量操作时使用旧数据
    if (cloudManageMode.value !== mode) {
      selectedCloudMachines.value = [] // 清空批量模式下的云机选择
      selectedCloudDevice.value = null  // 清空坑位模式下的设备选择，让用户重新选择
      activeDevice.value = null // 清空当前活跃设备，防止在切换模式后仍然刷新截图
      treeSelectedKeys.value = []       // 清空树形结构的选中状态
      console.log('已清空所有选择状态')
    }

    // 切换到批量模式前，先同步计算过滤后的数据，避免闪烁
    if (mode === 'batch') {
      cloudMachineGroups.value = computeCloudMachineGroups('batch')
    }

    cloudManageMode.value = mode

    // 切换模式时重新初始化分组数据，应用不同的过滤规则
    // 批量模式：只显示运行中的云机
    // 坑位模式：显示所有云机
    // 注意：批量模式已经在上面同步计算过了，这里的调用会被防抖机制处理
    initCloudMachineGroups()

    // 如果切换到坑位模式，自动选择第一个设备
    if (mode === 'slot') {
      // 获取第一个在线设备
      const firstOnlineDevice = devices.value.find(device => {
        return devicesStatusCache.value.get(device.id) === 'online'
      })

      if (firstOnlineDevice) {
        console.log('坑位模式：自动选择第一个在线设备:', firstOnlineDevice.ip)
        selectedCloudDevice.value = firstOnlineDevice
        activeDevice.value = firstOnlineDevice

        // 立即用已有缓存渲染，避免等待期间显示空白
        const cachedMachines = deviceCloudMachinesCache.value.get(firstOnlineDevice.ip)
        if (cachedMachines && cachedMachines.length > 0) {
          instances.value = cachedMachines
          allInstances.value = cachedMachines
          updateCloudMachines()
        }

        // 后台触发刷新，完成后重新初始化分组
        fetchAndroidContainers(firstOnlineDevice, true).then(() => {
          initCloudMachineGroups()
        })
      } else {
        console.log('坑位模式：未找到在线设备')
      }
    }

    // 如果切换到批量模式，检查是否有设备未加载云机数据，如果有则自动加载
    if (mode === 'batch') {

      // 获取所有在线但没有云机数据的设备
      const devicesToLoad = devices.value.filter(device => {
        // 检查设备是否在线
        const isOnline = devicesStatusCache.value.get(device.id) === 'online'
        if (!isOnline) return false

        // 检查是否已有缓存数据
        const cachedData = deviceCloudMachinesCache.value.get(device.ip)
        const hasData = cachedData && cachedData.length > 0

        return !hasData
      })

      if (devicesToLoad.length > 0) {
        console.log(`批量模式：发现 ${devicesToLoad.length} 个设备未加载云机数据，开始自动加载`)
        // 并行加载，限制并发数为5，避免网络拥塞
        const batchSize = 5
        const loadBatch = async (index) => {
          if (index >= devicesToLoad.length) return

          const batch = devicesToLoad.slice(index, index + batchSize)
          const promises = batch.map(device => fetchAndroidContainers(device, true)) // 使用true强制显示加载状态

          await Promise.allSettled(promises)
          // 每批加载完更新一次界面
          initCloudMachineGroups()

          // 递归加载下一批
          loadBatch(index + batchSize)
        }

        loadBatch(0)
      }

      // 批量模式要把每台设备自己的"已过期 / 即将过期"标到它的云机上，而 slotStates
      // 全局单例只装得下最后加载的那台设备，所以这里给在线设备补拉各自的坑位授权状态。
      // ensureSlotStatesLoaded 内部会跳过内存里已有的，切模式不会反复打请求；
      // 它走的也是"只读"路径（不触发到期强制关机），不会顺手关掉别的设备上的云机。
      const devicesMissingSlotStates = devices.value.filter(device => {
        return devicesStatusCache.value.get(device.id) === 'online'
      })

      if (devicesMissingSlotStates.length > 0) {
        const batchSize = 5
        const loadSlotStateBatch = async (index) => {
          if (index >= devicesMissingSlotStates.length) return

          const batch = devicesMissingSlotStates.slice(index, index + batchSize)
          await Promise.allSettled(batch.map(device => ensureSlotStatesLoaded(device.id)))
          initCloudMachineGroups()

          loadSlotStateBatch(index + batchSize)
        }

        loadSlotStateBatch(0)
      }
    }
  }

  // 处理选中云机设备变化
  const handleSelectedCloudDeviceChange = (device) => {
    console.log('选中云机设备变化:', device)
    selectedCloudDevice.value = device
    // 切换设备时清空版本快照，强制下次轮询立即拉取新设备截图
    resetScreenshotVersions()

    // 切换设备时立即清空坑位状态，避免显示上一个设备的已过期/即将过期标签
    setSlotStates({}, '')
    // 异步加载新设备的坑位状态
    if (device && device.id) {
      fetchAndCacheSlotStates(device.id)
    }

    // 同步更新activeDevice，确保实例数据正确更新
    if (device && activeDevice.value?.ip !== device.ip) {
      console.log('同步更新activeDevice:', device)
      activeDevice.value = device

      // 立即用新设备的已有缓存渲染界面，避免停留在旧设备数据
      const cachedMachines = deviceCloudMachinesCache.value.get(device.ip)
      if (cachedMachines && cachedMachines.length > 0) {
        // 已有缓存：直接更新 instances / cloudMachines，界面立即切换
        instances.value = cachedMachines
        allInstances.value = cachedMachines
        updateCloudMachines()
      } else {
        // 无缓存：清空界面，等待加载
        instances.value = []
        allInstances.value = []
        cloudMachines.value = []
      }

      // 后台触发刷新（不阻塞界面），拿到最新数据后自动更新
      fetchAndroidContainers(device, true)
    }
  }

  // 批量操作处理
  const handleBatchAction = async (action, selectedData = [], cardOrientation = null) => {
    // 对于"停止批量控制"操作，不需要检查是否选中云机
    const isStoppingControl = action === 'projection-control' && isBatchProjectionControlling.value

    // 判断某云机/坑位是否已到期（slotStates[key].state === 2）
    // 已到期的云机不允许执行 开机/重启/重置 操作（强制保持关机状态）
    const isSlotExpired = (item) => {
      if (item == null) return false
      // 坑位模式：item 是坑位号（数字/字符串）
      const slotNum = (typeof item === 'number' || typeof item === 'string')
        ? item
        : (item.indexNum != null ? item.indexNum : null)
      if (slotNum == null) return false
      const info = slotStates.value[slotNum]
      return !!(info && info.state === 2)
    }
    const FORCED_SHUTDOWN_ACTIONS = new Set(['start', 'restart', 'reset'])

    if (!isStoppingControl) {
      // 根据云机管理模式检查是否有选中的云机
      let hasSelectedMachines = false
      if (cloudManageMode.value === 'slot') {
        // 坑位模式：selectedData 是坑位号数组
        hasSelectedMachines = Array.isArray(selectedData) && selectedData.length > 0
      } else {
        // 批量模式：selectedData 是云机对象数组
        hasSelectedMachines = Array.isArray(selectedData) && selectedData.length > 0
      }

      if (!hasSelectedMachines) {
        console.error('没有选中的云机')
        ElMessage.error('请先选中要操作的云机')
        return
      }
    }


    loading.value = true
    try {
      // 已到期云机强制关机：过滤掉到期云机，并提示用户
      if (FORCED_SHUTDOWN_ACTIONS.has(action) && Array.isArray(selectedData)) {
        const expiredItems = selectedData.filter(isSlotExpired)
        if (expiredItems.length > 0) {
          const validItems = selectedData.filter(item => !isSlotExpired(item))
          ElMessage.warning(`已到期的云机不能执行此操作（强制关机），已跳过 ${expiredItems.length} 个到期云机`)
          if (validItems.length === 0) {
            // 全部到期，直接结束
            loading.value = false
            return
          }
          selectedData = validItems
        }
      }
      switch (action) {
        case 'restart':
          // 实现批量重启功能
          console.log(`执行批量重启操作`)

          let restartRunning = []
          let restartShutdown = []

          // 根据云机管理模式获取需要操作的容器
          if (cloudManageMode.value === 'slot') {
            // 坑位模式：根据选中的坑位号获取容器实例
            const selectedInstances = instances.value.filter(inst =>
              Array.isArray(selectedData) && selectedData.includes(inst.indexNum) &&
              (inst.status === 'running' || inst.status === 'shutdown' || inst.status === 'exited')
            )
            restartRunning = selectedInstances.filter(inst => inst.status === 'running')
            restartShutdown = selectedInstances.filter(inst => inst.status === 'shutdown' || inst.status === 'exited')
          } else {
            // 批量模式：直接使用传递的云机对象数组
            const selectedMachines = selectedData.filter(machine =>
              machine.status === 'running' || machine.status === 'shutdown' || machine.status === 'exited'
            )
            restartRunning = selectedMachines.filter(machine => machine.status === 'running')
            restartShutdown = selectedMachines.filter(machine => machine.status === 'shutdown' || machine.status === 'exited')
          }

          if (restartRunning.length === 0 && restartShutdown.length === 0) {
            ElMessage.warning('没有选中可操作的云机')
            break
          }

          try {
            const totalCount = restartRunning.length + restartShutdown.length
            let confirmMsg = ''
            if (restartShutdown.length === 0) {
              confirmMsg = `确定要重启选中的 ${restartRunning.length} 个运行中的云机吗？重启后容器将会停止并重新启动。`
            } else if (restartRunning.length === 0) {
              confirmMsg = `选中的 ${restartShutdown.length} 个云机处于关机状态，将执行启动操作。确定继续吗？`
            } else {
              confirmMsg = `选中的 ${totalCount} 个云机中，${restartRunning.length} 个运行中将重启，${restartShutdown.length} 个关机中将启动。确定继续吗？`
            }

            // 显示确认对话框
            await ElMessageBox.confirm(
              confirmMsg,
              '批量重启云机',
              {
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type: 'warning'
              }
            )

            // 为容器添加设备信息
            const addTargetInfo = (container) => {
              if (cloudManageMode.value === 'slot' && selectedCloudDevice.value) {
                return {
                  ...container,
                  deviceIp: selectedCloudDevice.value.ip,
                  deviceVersion: selectedCloudDevice.value.version
                }
              } else {
                return container
              }
            }

            // 运行中的云机执行重启
            if (restartRunning.length > 0) {
              const restartTargets = restartRunning.map(addTargetInfo)
              const taskId = addTaskToQueue('restart', restartTargets)
              executeTask(taskId)
            }

            // 关机状态的云机执行启动
            if (restartShutdown.length > 0) {
              const startTargets = restartShutdown.map(addTargetInfo)
              const taskId = addTaskToQueue('start', startTargets)
              executeTask(taskId)
            }

            ElMessage.success('批量操作任务已添加到队列')
          } catch (error) {
            if (error === 'cancel') {
              // 用户取消了操作
              console.log('用户取消了批量重启操作')
              ElMessage.info('已取消批量重启操作')
            } else {
              console.error('批量重启失败:', error)
              ElMessage.error(`批量重启失败: ${error.message || '未知错误'}`)
            }
          }
          break
        case 'reset':
          // 实现批量重置功能
          console.log(`执行批量重置操作`)

          let resetContainersToOperate = []

          // 根据云机管理模式获取需要操作的容器
          if (cloudManageMode.value === 'slot') {
            // 坑位模式：根据选中的坑位号获取容器实例
            resetContainersToOperate = instances.value.filter(inst => Array.isArray(selectedData) && selectedData.includes(inst.indexNum))
          } else {
            // 批量模式：直接使用传递的云机对象数组
            resetContainersToOperate = selectedData
          }

          if (resetContainersToOperate.length === 0) {
            ElMessage.warning('没有选中的云机')
            break
          }

          try {
            // 显示确认对话框，让用户选择是否开机
            let startAfterReset = true
            await new Promise((resolve, reject) => {
              ElMessageBox.confirm(
                `确定要重置选中的 ${resetContainersToOperate.length} 个容器吗？重置后容器将会被恢复到初始状态。`,
                '批量重置容器',
                {
                  confirmButtonText: '重置并开机',
                  cancelButtonText: '仅重置(不开机)',
                  distinguishCancelAndClose: true,
                  type: 'warning',
                  showClose: true
                }
              ).then(() => {
                startAfterReset = true
                console.log('[批量重置] 用户选择: 重置并开机, start=true')
                resolve()
              }).catch((action) => {
                console.log('[批量重置] catch action:', action, typeof action)
                if (action === 'close') {
                  // 用户点了 X 或按 ESC，取消操作
                  reject('cancel')
                } else {
                  // 用户点了"仅重置(不开机)"按钮
                  startAfterReset = false
                  console.log('[批量重置] 用户选择: 仅重置(不开机), start=false')
                  resolve()
                }
              })
            })

            // 检查设备版本是否支持重置功能
            let allDevicesSupported = true
            const unsupportedDevices = new Set()

            if (cloudManageMode.value === 'slot' && selectedCloudDevice.value) {
              if (selectedCloudDevice.value.version !== 'v3') {
                allDevicesSupported = false
                unsupportedDevices.add(selectedCloudDevice.value.ip)
              }
            } else {
              // 批量模式下检查所有选中容器的设备版本
              resetContainersToOperate.forEach(container => {
                if ((container.deviceVersion || 'v3') !== 'v3') {
                  allDevicesSupported = false
                  unsupportedDevices.add(container.deviceIp)
                }
              })
            }

            if (!allDevicesSupported) {
              ElMessage.warning(`以下设备不支持重置容器功能: ${Array.from(unsupportedDevices).join(', ')}`)
              break
            }

            // 为每个容器添加设备信息
            const resetTargets = resetContainersToOperate.map(container => {
              if (cloudManageMode.value === 'slot' && selectedCloudDevice.value) {
                return {
                  ...container,
                  deviceIp: selectedCloudDevice.value.ip,
                  deviceVersion: selectedCloudDevice.value.version
                }
              } else {
                return container
              }
            })

            // 添加到任务队列，通过 metadata 传递 start 参数
            const taskId = addTaskToQueue('reset', resetTargets, { start: startAfterReset })
            executeTask(taskId)

            ElMessage.success('批量重置任务已添加到队列')
          } catch (error) {
            if (error === 'cancel') {
              // 用户取消了操作
              console.log('用户取消了批量重置操作')
              ElMessage.info('已取消批量重置操作')
            } else {
              console.error('批量重置失败:', error)
              ElMessage.error(`批量重置失败: ${error.message || '未知错误'}`)
            }
          }
          break
        case 'projection':
          // 实现批量投屏功能
          console.log(`执行批量投屏操作`)

          let projectionContainersToOperate = []
          let allContainersToOperate = []

          // 根据云机管理模式获取需要操作的容器
          if (cloudManageMode.value === 'slot') {
            // 坑位模式：根据选中的坑位号获取容器实例
            allContainersToOperate = instances.value.filter(inst => Array.isArray(selectedData) && selectedData.includes(inst.indexNum))
          } else {
            // 批量模式：直接使用传递的云机对象数组
            allContainersToOperate = selectedData
          }

          // 只保留运行中的云机
          projectionContainersToOperate = allContainersToOperate.filter(container => container.status === 'running')

          if (allContainersToOperate.length === 0) {
            ElMessage.warning('没有选中的云机')
            break
          }

          if (projectionContainersToOperate.length === 0) {
            ElMessage.warning('选中的云机都没有处于运行状态')
            break
          }

          // 如果有部分云机未运行，给出提示
          if (projectionContainersToOperate.length < allContainersToOperate.length) {
            const notRunningCount = allContainersToOperate.length - projectionContainersToOperate.length
            ElMessage.info(`有 ${notRunningCount} 个选中的云机未处于运行状态，将只对运行中的 ${projectionContainersToOperate.length} 个云机打开投屏`)
          }

          try {
            // 显示确认对话框
            await ElMessageBox.confirm(`确定要对选中的 ${projectionContainersToOperate.length} 个云机打开投屏吗？`, '批量投屏', {
              confirmButtonText: '确定',
              cancelButtonText: '取消',
              type: 'info'
            })

            // 计算 orient 参数（如果有 cardOrientation）
            // horizontal: 横屏 = 1, vertical: 竖屏 = 0
            const customOrient = cardOrientation ? (cardOrientation === 'horizontal' ? 1 : 0) : null
            console.log('[App.vue 批量投屏] cardOrientation:', cardOrientation, ', customOrient:', customOrient)

            // 执行批量投屏操作：一次批量启动多窗口网格
            try {
              const batchResult = await startBatchProjection(
                { ip: selectedCloudDevice.value?.ip },
                projectionContainersToOperate,
                customOrient
              )
              const ok = batchResult?.okCount ?? 0
              const total = projectionContainersToOperate.length
              if (ok === total) {
                ElMessage.success(`成功对 ${total} 个云机打开投屏`)
              } else if (ok > 0) {
                ElMessage.warning(`成功 ${ok} 个，失败 ${total - ok} 个`)
              } else {
                ElMessage.error(batchResult?.message || `批量投屏失败`)
              }
            } catch (error) {
              console.error('批量投屏失败:', error)
              ElMessage.error(`批量投屏失败: ${error.message || '未知错误'}`)
            }
          } catch (error) {
            if (error === 'cancel') {
              // 用户取消了操作
              console.log('用户取消了批量投屏操作')
              ElMessage.info('已取消批量投屏操作')
            } else {
              console.error('批量投屏失败:', error)
              ElMessage.error(`批量投屏失败: ${error.message || '未知错误'}`)
            }
          }
          break
        case 'projection-control':
          // 批量投屏控制
          console.log(`执行批量投屏控制`)

          // 如果正在进行批量控制，则停止
          if (isBatchProjectionControlling.value) {
            try {
              await stopProjectionBatchControl()
              // 根据模式清除对应的状态
              if (cloudManageMode.value === 'batch') {
                batchModeProjectionControlling.value = false
              } else {
                const deviceIp = selectedCloudDevice.value?.ip
                if (deviceIp) {
                  delete slotModeProjectionControlStatus.value[deviceIp]
                }
              }
            } catch (error) {
              console.error('停止批量投屏控制失败:', error)
              ElMessage.error(`停止批量投屏控制失败: ${error.message || '未知错误'}`)
            }
            break
          }

          let controlContainersToOperate = []
          let allControlContainersToOperate = []

          // 根据云机管理模式获取需要操作的容器
          if (cloudManageMode.value === 'slot') {
            // 坑位模式：根据选中的坑位号获取容器实例
            allControlContainersToOperate = instances.value.filter(inst => Array.isArray(selectedData) && selectedData.includes(inst.indexNum))
          } else {
            // 批量模式：直接使用传递的云机对象数组
            allControlContainersToOperate = selectedData
          }

          // 只保留运行中的云机
          controlContainersToOperate = allControlContainersToOperate.filter(container => container.status === 'running')

          if (allControlContainersToOperate.length === 0) {
            ElMessage.warning('没有选中的云机')
            break
          }

          if (controlContainersToOperate.length === 0) {
            ElMessage.warning('选中的云机都没有处于运行状态')
            break
          }

          if (controlContainersToOperate.length < allControlContainersToOperate.length) {
            const notRunningCount = allControlContainersToOperate.length - controlContainersToOperate.length
            ElMessage.info(`有 ${notRunningCount} 个选中的云机未处于运行状态，将只对运行中的 ${controlContainersToOperate.length} 个云机进行批量投屏控制`)
          }

          try {
            await ElMessageBox.confirm(`确定要对选中的 ${controlContainersToOperate.length} 个云机进行批量投屏控制吗？`, '批量投屏控制', {
              confirmButtonText: '确定',
              cancelButtonText: '取消',
              type: 'info'
            })

            const device = (cloudManageMode.value === 'slot' && selectedCloudDevice.value)
              ? { ip: selectedCloudDevice.value.ip }
              : null

            // 计算 customOrient: horizontal -> 1, vertical -> 0
            const customOrient = cardOrientation ? (cardOrientation === 'horizontal' ? 1 : 0) : null
            console.log('[App.vue projection-control] cardOrientation:', cardOrientation, ', customOrient:', customOrient)

            await startProjectionBatchControl(device, controlContainersToOperate, `批量投屏控制`, customOrient)

            // 根据模式设置对应的状态
            if (cloudManageMode.value === 'batch') {
              batchModeProjectionControlling.value = true
            } else {
              const deviceIp = selectedCloudDevice.value?.ip
              if (deviceIp) {
                slotModeProjectionControlStatus.value[deviceIp] = true
              }
            }
          } catch (error) {
            if (error === 'cancel') {
              console.log('用户取消了批量投屏控制操作')
              ElMessage.info('已取消批量投屏控制操作')
            } else {
              console.error('批量投屏控制失败:', error)
              ElMessage.error(`批量投屏控制失败: ${error.message || '未知错误'}`)
            }
          }
          break
        case 'shutdown':
          // 实现批量关机功能
          console.log(`执行批量关机操作`)

          let shutdownContainersToOperate = []

          // 根据云机管理模式获取需要操作的容器
          if (cloudManageMode.value === 'slot') {
            // 坑位模式：根据选中的坑位号获取容器实例
            shutdownContainersToOperate = instances.value.filter(inst => Array.isArray(selectedData) && selectedData.includes(inst.indexNum))
          } else {
            // 批量模式：直接使用传递的云机对象数组
            shutdownContainersToOperate = selectedData
          }

          if (shutdownContainersToOperate.length === 0) {
            ElMessage.warning('没有选中的云机')
            break
          }

          try {
            // 显示确认对话框
            await ElMessageBox.confirm(`确定要关闭选中的 ${shutdownContainersToOperate.length} 个容器吗？关闭后容器将会停止运行。`, '批量关机容器', {
              confirmButtonText: '确定',
              cancelButtonText: '取消',
              type: 'warning'
            })

            // 为每个容器添加设备信息
            const shutdownTargets = shutdownContainersToOperate.map(container => {
              if (cloudManageMode.value === 'slot' && selectedCloudDevice.value) {
                return {
                  ...container,
                  deviceIp: selectedCloudDevice.value.ip,
                  deviceVersion: selectedCloudDevice.value.version
                }
              } else {
                return container
              }
            })

            // 添加到任务队列
            const taskId = addTaskToQueue('shutdown', shutdownTargets)
            executeTask(taskId)

            ElMessage.success('批量关机任务已添加到队列')
          } catch (error) {
            if (error === 'cancel') {
              // 用户取消了操作
              console.log('用户取消了批量关机操作')
              ElMessage.info('已取消批量关机操作')
            } else {
              console.error('批量关机失败:', error)
              ElMessage.error(`批量关机失败: ${error.message || '未知错误'}`)
            }
          }
          break
        case 'switch-backup':
          // 实现批量切换云机功能（自动切换到创建时间最新的备份）
          console.log(`执行批量切换云机操作`)

          {
            let switchBackupContainersToOperate = []

            // 根据云机管理模式获取需要操作的容器
            if (cloudManageMode.value === 'slot') {
              // 坑位模式：根据选中的坑位号获取容器实例
              switchBackupContainersToOperate = instances.value.filter(inst =>
                Array.isArray(selectedData) && selectedData.includes(inst.indexNum)
              )
            } else {
              // 批量模式：直接使用传递的云机对象数组
              switchBackupContainersToOperate = selectedData
            }

            if (switchBackupContainersToOperate.length === 0) {
              ElMessage.warning('没有选中的云机')
              break
            }

            // 对每个选中的容器，在 allInstances 中查找同坑位创建时间最新的其他备份
            const switchBackupTargets = []
            // 没有备份可切换的容器（容器名未变，需保持原选中状态）
            const noBackupTargets = []
            const noBackupSlots = []

            for (const container of switchBackupContainersToOperate) {
              const slotNum = container.indexNum
              const deviceIp = cloudManageMode.value === 'slot' && selectedCloudDevice.value
                ? selectedCloudDevice.value.ip
                : container.deviceIp

              // 查找同一设备同一坑位的所有容器（备份）
              // 坑位模式：从 allInstances 查找（包含当前设备所有容器）
              // 批量模式：从 deviceAllInstancesCache 查找（包含所有备份）
              const allDeviceContainers = cloudManageMode.value === 'slot'
                ? allInstances.value
                : (deviceAllInstancesCache.value.get(deviceIp) || [])

              const slotAllContainers = allDeviceContainers.filter(inst =>
                inst.indexNum === slotNum &&
                inst.name &&
                inst.name !== container.name
              )

              if (slotAllContainers.length === 0) {
                noBackupSlots.push(slotNum)
                // 没有备份的容器不参与切换，但其容器名不变，仍需保持原选中状态
                noBackupTargets.push({
                  currentContainer: container,
                  deviceIp,
                  slotNum
                })
                continue
              }

              // 按创建时间降序排序，取最新的一条
              const latestBackup = slotAllContainers.sort((a, b) => {
                const timeA = a.created ? new Date(a.created).getTime() : 0
                const timeB = b.created ? new Date(b.created).getTime() : 0
                return timeB - timeA
              })[0]

              switchBackupTargets.push({
                currentContainer: container,
                backupContainer: latestBackup,
                deviceIp,
                slotNum
              })
            }

            if (noBackupSlots.length > 0) {
              ElMessage.warning(`坑位 ${noBackupSlots.join('、')} 没有可切换的备份，将跳过`)
            }

            if (switchBackupTargets.length === 0) {
              ElMessage.warning('所有选中的云机都没有可切换的备份')
              break
            }

            try {
              await ElMessageBox.confirm(
                `确定要对选中的 ${switchBackupTargets.length} 个云机切换到最新备份吗？\n操作将依次关闭当前运行容器并启动最新备份。`,
                '批量切换云机',
                {
                  confirmButtonText: '确定',
                  cancelButtonText: '取消',
                  type: 'warning'
                }
              )

              // 使用每个target自身的deviceIp，避免用户切换设备后IP不一致
              const getTargetDevice = (target) => ({ ip: target.deviceIp, version: target.deviceVersion || 'v3' })

              // 初始化进度列表
              batchSwitchBackupTotal.value = switchBackupTargets.length
              batchSwitchBackupDone.value = 0
              batchSwitchBackupProgressList.value = switchBackupTargets.map(t => ({
                slotNum: t.slotNum,
                deviceIp: t.deviceIp,
                currentName: t.currentContainer.name,
                backupName: t.backupContainer.name,
                status: 'pending',
                message: '等待中'
              }))
              batchSwitchBackupProgressVisible.value = true

              let successCount = 0
              let failCount = 0

              for (let i = 0; i < switchBackupTargets.length; i++) {
                const target = switchBackupTargets[i]
                const progressItem = batchSwitchBackupProgressList.value[i]
                progressItem.status = 'running'
                progressItem.message = '关机中...'

                try {
                  const targetDevice = getTargetDevice(target)

                  // 1. 关机当前运行的容器
                  if (target.currentContainer.status === 'running') {
                    await authRetry(targetDevice, async (password) => {
                      await stopContainer(targetDevice, target.currentContainer.name, password)
                    })
                    await new Promise(resolve => setTimeout(resolve, 500))
                  }

                  // 2. 启动备份容器
                  progressItem.message = '启动备份中...'
                  await authRetry(targetDevice, async (password) => {
                    await startContainer(targetDevice, target.backupContainer.name, password)
                  })

                  progressItem.status = 'success'
                  progressItem.message = '切换成功'
                  successCount++
                } catch (err) {
                  console.error(`坑位 ${target.slotNum} 切换云机失败:`, err)
                  progressItem.status = 'failed'
                  progressItem.message = err.message || '切换失败'
                  failCount++
                }

                batchSwitchBackupDone.value = i + 1
              }

              // 3. 刷新容器列表（按设备分组刷新）
              // 切换云机刚 stop/start 完，后端缓存可能仍是旧容器状态，
              // 必须用 isUserInitiated=true 强制后端立即刷新，否则拿到的是旧数据。
              const deviceIpSet = new Set(switchBackupTargets.map(t => t.deviceIp))
              for (const ip of deviceIpSet) {
                const d = devices.value.find(dev => dev.ip === ip)
                if (d) await fetchAndroidContainers(d, true)
              }

              // 4. 切换云机后容器名变更，原选中的云机 id 全部失效。
              //    按坑位重新匹配新容器并恢复选中状态，避免用户选中状态被取消。
              if (cloudManageMode.value === 'batch' && successCount > 0) {
                const slotKeys = new Set()
                // 切换成功的坑位（容器名已变，需用新容器匹配）
                for (const target of switchBackupTargets) {
                  if (target.currentContainer && target.currentContainer.name) {
                    slotKeys.add(`${target.deviceIp}@${target.slotNum}`)
                  }
                }
                // 没有备份可切换的容器：容器名未变，原选中 id 仍然有效，必须保留
                const noBackupIds = new Set()
                for (const target of noBackupTargets) {
                  if (target.currentContainer && target.currentContainer.id) {
                    noBackupIds.add(target.currentContainer.id)
                  }
                }
                // 仅统计切换成功的坑位（失败的坑位容器名未变）
                const successSlotKeys = new Set()
                for (let i = 0; i < switchBackupTargets.length; i++) {
                  if (batchSwitchBackupProgressList.value[i]?.status === 'success') {
                    const t = switchBackupTargets[i]
                    successSlotKeys.add(`${t.deviceIp}@${t.slotNum}`)
                  }
                }

                // 提取某设备缓存中匹配坑位的"最新容器名集合"
                const getRunningNamesInCache = (ip) => {
                  const list = deviceCloudMachinesCache.value.get(ip) || []
                  const names = new Set()
                  for (const cm of list) {
                    if (!cm || !cm.name) continue
                    const slot = cm.indexNum
                    if (slot === undefined) continue
                    if (cm.status !== 'running') continue
                    if (successSlotKeys.has(`${ip}@${slot}`)) names.add(cm.name)
                  }
                  return names
                }

                // 切换前的容器名集合
                const prevRunningNamesByIp = new Map()
                for (const target of switchBackupTargets) {
                  if (!successSlotKeys.has(`${target.deviceIp}@${target.slotNum}`)) continue
                  const set = prevRunningNamesByIp.get(target.deviceIp) || new Set()
                  set.add(target.currentContainer.name)
                  prevRunningNamesByIp.set(target.deviceIp, set)
                }

                // 轮询等待后端缓存刷新完成：新容器名出现 且 与旧容器名不同
                const waitContainerRefresh = async (ip, maxRetry = 6, interval = 800) => {
                  const prevNames = prevRunningNamesByIp.get(ip) || new Set()
                  for (let k = 0; k < maxRetry; k++) {
                    const curNames = getRunningNamesInCache(ip)
                    // 全部成功坑位都出现新名字且与旧名不同
                    let allFresh = true
                    for (const slotKey of successSlotKeys) {
                      if (!slotKey.startsWith(`${ip}@`)) continue
                      const slotNum = parseInt(slotKey.split('@')[1], 10)
                      const list = deviceCloudMachinesCache.value.get(ip) || []
                      const matched = list.find(cm => cm.indexNum === slotNum && cm.status === 'running')
                      if (!matched) { allFresh = false; break }
                      if (prevNames.has(matched.name)) { allFresh = false; break }
                    }
                    if (allFresh && curNames.size > 0) return true
                    await new Promise(r => setTimeout(r, interval))
                    // 再次强制刷新后端缓存
                    const d = devices.value.find(dev => dev.ip === ip)
                    if (d) {
                      try { await fetchAndroidContainers(d, true) } catch {}
                    }
                  }
                  return false
                }

                // 并行等待所有涉及设备
                await Promise.all([...deviceIpSet].map(ip => waitContainerRefresh(ip)))

                // 用刷新后的缓存按坑位重新匹配新容器
                const newSelected = []
                const newIdSet = new Set()
                // 先加入没有备份可切换的容器（容器名未变，原 id 仍有效）
                for (const target of noBackupTargets) {
                  const cm = target.currentContainer
                  if (cm && cm.id && !newIdSet.has(cm.id)) {
                    newSelected.push(cm)
                    newIdSet.add(cm.id)
                  }
                }
                // 再按坑位匹配切换成功的新容器
                for (const ip of deviceIpSet) {
                  const list = deviceCloudMachinesCache.value.get(ip) || []
                  for (const cm of list) {
                    if (!cm || !cm.id) continue
                    const slot = cm.indexNum
                    if (slot === undefined) continue
                    if (slotKeys.has(`${ip}@${slot}`) && !newIdSet.has(cm.id)) {
                      newSelected.push(cm)
                      newIdSet.add(cm.id)
                    }
                  }
                }
                if (newSelected.length > 0) {
                  selectedCloudMachines.value = [...newSelected]
                  treeSelectedKeys.value = [...newIdSet]
                }
              }

              if (successCount > 0) {
                ElMessage.success(`批量切换云机成功：${successCount} 个`)
              }
              if (failCount > 0) {
                ElMessage.warning(`${failCount} 个切换失败`)
              }
            } catch (error) {
              if (error === 'cancel') {
                ElMessage.info('已取消批量切换云机操作')
              } else {
                console.error('批量切换云机失败:', error)
                ElMessage.error(`批量切换云机失败: ${error.message || '未知错误'}`)
              }
            }
          }
          break
        case 'delete':
          // 实现批量删除功能
          console.log(`执行批量删除操作`)

          let deleteContainersToOperate = []

          // 根据云机管理模式获取需要操作的容器
          if (cloudManageMode.value === 'slot') {
            // 坑位模式：根据选中的坑位号获取容器实例
            deleteContainersToOperate = instances.value.filter(inst => Array.isArray(selectedData) && selectedData.includes(inst.indexNum))
          } else {
            // 批量模式：直接使用传递的云机对象数组
            deleteContainersToOperate = selectedData
          }

          if (deleteContainersToOperate.length === 0) {
            ElMessage.warning('没有选中的云机')
            break
          }

          try {
            // 显示确认对话框
            await ElMessageBox.confirm(`确定要删除选中的 ${deleteContainersToOperate.length} 个云机吗？删除后数据将无法恢复。`, '批量删除云机', {
              confirmButtonText: '确定',
              cancelButtonText: '取消',
              type: 'danger'
            })

            // 为每个容器添加设备信息
            const deleteTargets = deleteContainersToOperate.map(container => {
              if (cloudManageMode.value === 'slot' && selectedCloudDevice.value) {
                return {
                  ...container,
                  deviceIp: selectedCloudDevice.value.ip,
                  deviceVersion: selectedCloudDevice.value.version
                }
              } else {
                return container
              }
            })

            // 添加到任务队列
            const taskId = addTaskToQueue('delete', deleteTargets)
            executeTask(taskId)

            ElMessage.success('批量删除任务已添加到队列')
          } catch (error) {
            if (error === 'cancel') {
              // 用户取消了操作
              console.log('用户取消了批量删除操作')
              ElMessage.info('已取消批量删除操作')
            } else {
              console.error('批量删除失败:', error)
              ElMessage.error(`批量删除失败: ${error.message || '未知错误'}`)
            }
          }
          break
        case 'switchModel':
          // 实现批量切换机型功能
          console.log(`执行批量切换机型操作`)

          let switchModelContainersToOperate = []

          // 根据云机管理模式获取需要操作的容器
          if (cloudManageMode.value === 'slot') {
            // 坑位模式：根据选中的坑位号获取容器实例
            switchModelContainersToOperate = instances.value.filter(inst => Array.isArray(selectedData) && selectedData.includes(inst.indexNum))
          } else {
            // 批量模式：直接使用传递的云机对象数组
            switchModelContainersToOperate = selectedData
          }

          if (switchModelContainersToOperate.length === 0) {
            ElMessage.warning('没有选中的云机')
            break
          }

          // 检查是否所有选中的云机都处于运行状态
          const runningContainers = switchModelContainersToOperate.filter(container => container.status === 'running')

          if (runningContainers.length === 0) {
            ElMessage.warning('没有选中已运行的云机，批量切换机型操作仅支持已运行的云机')
            break
          }

          if (runningContainers.length < switchModelContainersToOperate.length) {
            ElMessage.warning(`部分选中的云机未运行，仅对 ${runningContainers.length} 个已运行的云机执行操作`)
            // 更新要操作的容器列表，只包含已运行的云机
            switchModelContainersToOperate = runningContainers
          }

          // 检查设备版本是否支持切换机型功能
          let newIsV3Device = false
          let newTargetDevice = null

          if (cloudManageMode.value === 'slot' && selectedCloudDevice.value) {
            newIsV3Device = selectedCloudDevice.value.version === 'v3'
            newTargetDevice = selectedCloudDevice.value
          } else if (cloudManageMode.value === 'batch') {
            // 批量模式下，确保所有选中的云机都在同一个设备上
            const deviceIps = new Set(switchModelContainersToOperate.map(machine => machine.deviceIp))
            if (deviceIps.size !== 1) {
              ElMessage.error('批量切换机型功能只支持同一设备上的云机')
              break
            }

            const deviceIp = Array.from(deviceIps)[0]
            const versions = new Set(switchModelContainersToOperate.map(machine => machine.deviceVersion))
            newIsV3Device = versions.has('v3') && versions.size === 1

            if (newIsV3Device) {
              newTargetDevice = { ip: deviceIp, version: 'v3' }
            }
          }

          if (!newIsV3Device || !newTargetDevice) {
            ElMessage.error('只有V3版本设备支持批量切换机型功能')
            break
          }

          try {
            // 显示加载状态提示
            const loadingMsg = ElMessage({
              message: '加载机型列表中...',
              type: 'info',
              duration: 0
            })

            // 获取可用的手机型号列表
            await getV3PhoneModels(newTargetDevice.ip)

            // 关闭加载提示
            setTimeout(() => {
              ElMessage.closeAll()
            }, 100)

            if (phoneModels.value.length === 0) {
              ElMessage.warning('未获取到可用的机型列表')
              break
            }

            // 为每个容器添加设备信息
            batchSwitchModelTargets.value = newContainersToOperate.map(container => {
              if (cloudManageMode.value === 'slot' && selectedCloudDevice.value) {
                return {
                  ...container,
                  deviceIp: selectedCloudDevice.value.ip,
                  deviceVersion: selectedCloudDevice.value.version
                }
              } else {
                return container
              }
            })

            // 设置操作类型为'new'，表示这是通过批量新机按钮触发的操作
            batchSwitchModelOperationType.value = 'new'

            // 初始化机型槽
            initModelSlots()

            // 打开批量切换机型对话框
            batchSwitchModelDialogVisible.value = true
            if (countryList.value.length === 0) getCountryList(selectedCloudDevice.value?.ip || activeDevice.value?.ip)
          } catch (error) {
            console.error('批量切换机型失败:', error)
            ElMessage.error(`批量切换机型失败: ${error.message || '未知错误'}`)
          }
          break
        case 'new':
          // 实现批量切换机型功能（批量新机）
          console.log(`执行批量切换机型操作（批量新机）`)

          let newContainersToOperate = []

          // 根据云机管理模式获取需要操作的容器
          if (cloudManageMode.value === 'slot') {
            // 坑位模式：根据选中的坑位号获取容器实例
            newContainersToOperate = instances.value.filter(inst => Array.isArray(selectedData) && selectedData.includes(inst.indexNum))
          } else {
            // 批量模式：直接使用传递的云机对象数组
            newContainersToOperate = selectedData
          }

          if (newContainersToOperate.length === 0) {
            ElMessage.warning('没有选中的云机')
            break
          }

          // 检查是否所有选中的云机都处于运行状态
          const runningNewContainers = newContainersToOperate.filter(container => container.status === 'running')

          if (runningNewContainers.length === 0) {
            ElMessage.warning('没有选中已运行的云机，批量新机操作仅支持已运行的云机')
            break
          }

          if (runningNewContainers.length < newContainersToOperate.length) {
            ElMessage.warning(`部分选中的云机未运行，仅对 ${runningNewContainers.length} 个已运行的云机执行操作`)
            // 更新要操作的容器列表，只包含已运行的云机
            newContainersToOperate = runningNewContainers
          }

          // 检查设备版本是否支持切换机型功能
          let isV3Device = false
          let targetDevice = null

          if (cloudManageMode.value === 'slot' && selectedCloudDevice.value) {
            isV3Device = selectedCloudDevice.value.version === 'v3'
            targetDevice = selectedCloudDevice.value
          } else if (cloudManageMode.value === 'batch') {
            // 批量模式下，确保所有选中的云机都在同一个设备上
            const deviceIps = new Set(newContainersToOperate.map(machine => machine.deviceIp))
            if (deviceIps.size !== 1) {
              ElMessage.error('批量切换机型功能只支持同一设备上的云机')
              break
            }
            const deviceIp = Array.from(deviceIps)[0]
            // const versions = new Set(newContainersToOperate.map(machine => machine.deviceVersion))
            // isV3Device = versions.has('v3') && versions.size === 1
            isV3Device = true

            if (isV3Device) {
              targetDevice = { ip: deviceIp, version: 'v3' }
            }
          }
          if (!isV3Device || !targetDevice) {
            ElMessage.error('只有V3版本设备支持批量切换机型功能')
            break
          }

          try {
            // 显示加载状态提示
            const loadingMsg = ElMessage({
              message: '加载机型列表中...',
              type: 'info',
              duration: 0
            })

            // 获取可用的手机型号列表
            await getV3PhoneModels(targetDevice.ip)

            // 关闭加载提示
            setTimeout(() => {
              ElMessage.closeAll()
            }, 100)

            if (phoneModels.value.length === 0) {
              ElMessage.warning('未获取到可用的机型列表')
              break
            }

            // 为每个容器添加设备信息
            batchSwitchModelTargets.value = newContainersToOperate.map(container => {
              if (cloudManageMode.value === 'slot' && selectedCloudDevice.value) {
                return {
                  ...container,
                  deviceIp: selectedCloudDevice.value.ip,
                  deviceVersion: selectedCloudDevice.value.version
                }
              } else {
                return container
              }
            })

            // 检查是否有V2类型容器
            const v2Containers = batchSwitchModelTargets.value.filter(c => c.androidType === 'V2')
            const nonV2Containers = batchSwitchModelTargets.value.filter(c => c.androidType !== 'V2')

            if (v2Containers.length > 0 && nonV2Containers.length > 0) {
              ElMessage.warning(`检测到 ${v2Containers.length} 个V2容器，V2容器不支持指定机型，将自动分配到随机机型`)
            } else if (v2Containers.length > 0) {
              ElMessage.info('所选容器均为V2类型，将使用一键新机功能（不支持指定机型）')
            }

            // 初始化机型槽
            initModelSlots()

            // 打开批量切换机型对话框
            batchSwitchModelDialogVisible.value = true
          } catch (error) {
            console.error('批量切换机型失败:', error)
            ElMessage.error(`批量切换机型失败: ${error.message || '未知错误'}`)
          }
          break
        case 'upload':
          // 实现批量上传文件功能
          console.log(`执行批量上传文件操作`)

          let uploadContainersToOperate = []

          // 根据云机管理模式获取需要操作的容器
          if (cloudManageMode.value === 'slot') {
            // 坑位模式：根据选中的坑位号获取容器实例
            uploadContainersToOperate = instances.value.filter(inst => Array.isArray(selectedData) && selectedData.includes(inst.indexNum))
          } else {
            // 批量模式：直接使用传递的云机对象数组
            uploadContainersToOperate = selectedData
          }

          if (uploadContainersToOperate.length === 0) {
            ElMessage.warning('没有选中的云机')
            break
          }

          // 检查设备信息是否完整
          if (cloudManageMode.value === 'slot' && (!selectedCloudDevice.value || !selectedCloudDevice.value.ip)) {
            ElMessage.warning('设备信息不完整，无法上传文件')
            break
          } else if (cloudManageMode.value === 'batch') {
            // 批量模式下，无需检查是否有相同的设备，因为handleBatchUpload已经支持多设备上传
            // 这里的检查限制被移除了，以支持多设备批量上传
          }

          // 设置批量上传选中的云机
          batchUploadSelectedMachines.value = uploadContainersToOperate

          // 打开批量上传对话框
          batchUploadDialogVisible.value = true
          break
        case 'update-image': {
          // 批量更新镜像
          console.log('执行批量更新镜像操作')

          let updateImageContainersTmp = []

          // 根据云机管理模式获取需要操作的容器
          if (cloudManageMode.value === 'slot') {
            updateImageContainersTmp = instances.value.filter(inst =>
              Array.isArray(selectedData) && selectedData.includes(inst.indexNum)
            )
          } else {
            updateImageContainersTmp = selectedData
          }

          if (updateImageContainersTmp.length === 0) {
            ElMessage.warning('没有选中的云机')
            break
          }

          // 确保镜像列表已加载
          if (imageList.value.length === 0) {
            await fetchImageList('')
          }

          // 按设备类型（P系列 / 非P系列）分组
          const groupMap = new Map() // key: 'p' | 'non-p'
          for (const c of updateImageContainersTmp) {
            const deviceIp = c.deviceIp || (cloudManageMode.value === 'slot' && selectedCloudDevice.value ? selectedCloudDevice.value.ip : '')
            const device = devices.value.find(d => d.ip === deviceIp)
            const deviceName = device?.name || (cloudManageMode.value === 'slot' ? selectedCloudDevice.value?.name : '') || ''
            const isPSeries = isBatchImagePSeries(deviceName)
            const groupKey = isPSeries ? 'p' : 'non-p'
            if (!groupMap.has(groupKey)) {
              groupMap.set(groupKey, {
                groupKey,
                groupLabel: isPSeries ? 'P系列设备' : 'CRQ系列设备',
                deviceName,
                containers: [],
                hasV2: false,
                hasV3: false,
                androidType: 'V3',
                v2AndroidVersion: 10,
                selectedUrl: '',
                customUrl: ''
              })
            }
            const group = groupMap.get(groupKey)
            const containerWithIp = cloudManageMode.value === 'slot' && selectedCloudDevice.value
              ? { ...c, deviceIp: selectedCloudDevice.value.ip }
              : c
            group.containers.push(containerWithIp)
            if (c.androidType === 'V2') group.hasV2 = true
            else group.hasV3 = true
          }

          // 为每组设置默认 androidType
          for (const group of groupMap.values()) {
            if (group.hasV3) {
              group.androidType = 'V3'
            } else {
              group.androidType = 'V2'
            }
            // 默认选中第一条镜像
            if (group.androidType === 'V3') {
              const v3list = getBatchUpdateV3List(group.deviceName)
              group.selectedUrl = v3list.length > 0 ? v3list[0].url : ''
            }
          }

          batchUpdateImageGroups.value = Array.from(groupMap.values())
          batchUpdateImageDialogVisible.value = true
          break
        }
        default:
          console.error('未知的批量操作:', action)
          ElMessage.error('未知的批量操作')
      }
    } catch (error) {
      console.error('执行批量操作失败:', error)
      ElMessage.error('操作失败')
    } finally {
      loading.value = false
    }
  }

  // 上传本地镜像到设备
  const uploadLocalImageToDevice = async (image) => {
    try {
      // 显示设备选择对话框
      currentUploadingImage.value = {
        ...image,
        localPath: image.url // 本地镜像直接使用URL作为本地路径
      }
      selectedDevicesForUpload.value = []
      showDeviceSelectionDialog.value = true
    } catch (error) {
      console.error('上传本地镜像到设备失败:', error)
      ElMessage.error('操作失败')
    }
  }

  // 删除本地缓存镜像
  const deleteLocalCachedImage = async (image) => {
    return new Promise((resolve) => {
      ElMessageBox.confirm(`确定要删除镜像 ${image.name} 吗？`, '确认删除', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }).then(async () => {
        try {
          const result = await DeleteLocalImage(image.path)
          if (result.code === 0) {
            ElMessage.success('删除镜像成功')
            await fetchLocalCachedImages()
            resolve(true)
          } else {
            ElMessage.error(`删除镜像失败: ${result.message || '未知错误'}`)
            resolve(false)
          }
        } catch (error) {
          console.error('删除本地镜像失败:', error)
          ElMessage.error('操作失败')
          resolve(false)
        }
      }).catch(() => {
        resolve(false)
      })
    })
  }

  // 删除已下载的在线镜像
  const deleteDownloadedImage = async (onlineImage) => {
    // 先刷新本地镜像列表，确保数据最新
    await fetchLocalCachedImages()

    const imageUrl = onlineImage.url

    // 通过本地镜像记录的 onlineUrl 字段与在线镜像 URL 精确匹配
    const localImage = localCachedImages.value.find(localImg => localImg.onlineUrl === imageUrl)

    if (localImage) {
      // 使用找到的本地镜像执行与本地镜像删除完全相同的操作
      const success = await deleteLocalCachedImage(localImage)
      if (success) {
        imageDownloadStatus.value.set(onlineImage.url, false)
      }
    } else {
      ElMessage.error('未找到对应的本地镜像文件')
    }
  }

  // 下载进度更新事件处理函数
  const handleDownloadProgress = (event) => {
    // Wails 事件系统传递的是 WailsEvent 对象，需要从 event.data 获取实际数据
    const data = event.data || event

    if (data && data.progress !== undefined) {
      // 严格验证：必须有活动的下载任务
      if (!isDownloadingImage.value) {
        return
      }

      if (!currentDownloadTaskId.value) {
        return
      }

      if (!currentDownloadImage.value) {
        return
      }

      // 验证任务是否还在运行
      const currentTask = taskQueue.value.find(task => task.id === currentDownloadTaskId.value)
      if (!currentTask) {
        return
      }

      if (currentTask.status !== 'running') {
        return
      }

      // 检查会话时间戳是否匹配
      const taskSessionTime = currentTask.sessionStartTime || 0
      if (taskSessionTime !== downloadStartTime.value) {
        console.log(`[进度事件] 忽略：会话时间不匹配 (任务:${taskSessionTime}, 当前:${downloadStartTime.value})`)
        return
      }

      // 钳制到0~100，防止后端异常进度值导致进度超过100%
      const newProgress = Math.max(0, Math.min(100, Math.round(data.progress)))
      const currentProgress = currentTask.progress || 0

      // 严格的进度验证逻辑
      // 1. 如果新进度比当前进度小超过3%，视为异常（可能是旧任务）
      if (newProgress < currentProgress - 3) {
        console.log(`[进度事件] 忽略进度回退: ${currentProgress}% -> ${newProgress}%`)
        return
      }

      // 2. 如果当前进度已经超过20%，但新进度小于10%，明显是新旧任务混杂
      if (currentProgress > 20 && newProgress < 10) {
        console.log(`[进度事件] 忽略跨度异常: ${currentProgress}% -> ${newProgress}%`)
        return
      }

      // 3. 限制单次进度跳跃不能超过30%（正常下载不会有这么大的跳跃）
      if (newProgress - currentProgress > 30) {
        console.log(`[进度事件] 忽略异常跳跃: ${currentProgress}% -> ${newProgress}%`)
        return
      }

      // 更新进度值
      downloadProgress.value = data.progress
      currentTask.progress = newProgress
    }
  }

  // 下载完成事件处理函数
  const handleDownloadComplete = async (event) => {
    console.log('下载完成事件:', event)

    // Wails 事件系统传递的是 WailsEvent 对象，需要从 event.data 获取实际数据
    const data = event.data || event

    // 如果没有活动的下载任务，忽略此事件（可能是取消任务后的残留事件）
    if (!isDownloadingImage.value || !currentDownloadTaskId.value) {
      console.log('收到下载完成事件但无活动任务，忽略')
      return
    }

    // 验证任务状态
    const currentTask = taskQueue.value.find(task => task.id === currentDownloadTaskId.value)
    if (!currentTask || (currentTask.status !== 'running' && currentTask.status !== 'pending')) {
      console.log('收到下载完成事件但任务状态异常，忽略')
      return
    }

    try {
      if (data.success) {
        // 下载成功，确保进度显示为100%
        downloadProgress.value = 100

        // 更新任务状态
        currentTask.status = 'completed'
        currentTask.progress = 100
        currentTask.endTime = new Date()
        currentTask.completed = 1

        ElMessage.success(`镜像${currentDownloadImage.value?.name}下载成功`)

        // 重新获取本地缓存镜像列表
        await fetchLocalCachedImages()

        // 更新在线镜像列表的下载状态
        if (currentDownloadImage.value) {
          imageDownloadStatus.value.set(currentDownloadImage.value.url, true)
        }
      } else {
        // 下载失败
        currentTask.status = 'failed'
        currentTask.endTime = new Date()
        currentTask.failed = 1
        currentTask.error = data.message

        ElMessage.error(`下载镜像失败: ${data.message}`)
      }
    } finally {
      // 延迟清理状态，确保UI有时间显示最终状态
      setTimeout(() => {
        isDownloadingImage.value = false
        currentDownloadImage.value = null
        currentDownloadTaskId.value = null
        downloadProgress.value = 0
        downloadStartTime.value = 0
      }, 300)
    }
  }

  // 处理上传进度事件
  const handleUploadProgress = (event) => {
    const data = event.data || event

    if (data && data.progress !== undefined) {
      uploadProgress.value = data.progress

      const runningUploadTask = taskQueue.value.find(task => 
        task.type === 'uploadImage' && task.status === 'running'
      )

      if (runningUploadTask) {
        if (runningUploadTask.deviceIps && runningUploadTask.deviceIps.length > 0) {
          if (data.deviceIP && runningUploadTask.deviceProgress) {
            const deviceIP = data.deviceIP

            if (!runningUploadTask.deviceProgress[deviceIP]) {
              runningUploadTask.deviceProgress[deviceIP] = { 
                total: 1,
                completed: 0, 
                failed: 0,
                currentProgress: 0
              }
            }

            runningUploadTask.deviceProgress[deviceIP].currentProgress = Math.round(data.progress)

            if (data.progress >= 100) {
              runningUploadTask.deviceProgress[deviceIP].completed = 1
              runningUploadTask.deviceProgress[deviceIP].currentProgress = 100
            }
          }
        } else {
          runningUploadTask.progress = Math.round(data.progress)
        }
      }
    }
  }

  // 处理上传完成事件
  const handleUploadComplete = (event) => {
    const data = event.data || event

    if (!isUploadingImage.value) {
      return
    }

    try {
      if (!data || typeof data !== 'object') {
        return
      }

      const isSuccess = data.success === true || data.success === 'true' || data.success === 1 || data.success === '1'

      const runningUploadTask = taskQueue.value.find(task => 
        task.type === 'uploadImage' && task.status === 'running'
      )

      if (!runningUploadTask) {
        return
      }

      if (data.deviceIP && runningUploadTask.deviceProgress) {
        const deviceIP = data.deviceIP

        if (!runningUploadTask.deviceProgress[deviceIP]) {
          runningUploadTask.deviceProgress[deviceIP] = { 
            total: 1,
            completed: 0, 
            failed: 0,
            currentProgress: 0
          }
        }

        if (isSuccess) {
          runningUploadTask.deviceProgress[deviceIP].completed = 1
          runningUploadTask.deviceProgress[deviceIP].currentProgress = 100
        } else {
          runningUploadTask.deviceProgress[deviceIP].failed = 1
          runningUploadTask.deviceProgress[deviceIP].currentProgress = 0
          runningUploadTask.deviceProgress[deviceIP].error = data.message || '上传失败'

          // 立即收集失败原因到 failedTargets
          const existingIndex = runningUploadTask.failedTargets.findIndex(t => t.deviceIP === deviceIP)
          if (existingIndex >= 0) {
            runningUploadTask.failedTargets[existingIndex].error = data.message || '上传失败'
          } else {
            runningUploadTask.failedTargets.push({
              deviceIP: deviceIP,
              error: data.message || '上传失败'
            })
          }
        }
      }

      const allDevicesDone = runningUploadTask.deviceIps.every(ip => {
        const dev = runningUploadTask.deviceProgress[ip]
        return dev && (dev.completed > 0 || dev.failed > 0)
      })

      if (allDevicesDone) {
        let successCount = 0
        let failCount = 0

        runningUploadTask.deviceIps.forEach(ip => {
          const dev = runningUploadTask.deviceProgress[ip]
          if (dev) {
            if (dev.completed > 0) successCount++
            if (dev.failed > 0) failCount++
          }
        })

        runningUploadTask.completed = successCount
        runningUploadTask.failed = failCount
        runningUploadTask.progress = 100

        if (failCount === 0) {
          runningUploadTask.status = 'completed'
          runningUploadTask.endTime = new Date()
          if (currentUploadImage.value) {
            ElMessage.success(`镜像 ${currentUploadImage.value.name} 上传成功`)
            imageUploadStatus.value.set(currentUploadImage.value.url, true)
          }
        } else {
          runningUploadTask.status = 'failed'
          runningUploadTask.endTime = new Date()
          ElMessage.warning(`镜像 ${currentUploadImage.value?.name || '镜像'} 上传部分失败，成功 ${successCount} 个，失败 ${failCount} 个`)
        }
      } else {
        // 更新总进度（基于已完成的设备数）
        const doneCount = runningUploadTask.deviceIps.filter(ip => {
          const dev = runningUploadTask.deviceProgress[ip]
          return dev && (dev.completed > 0 || dev.failed > 0)
        }).length
        runningUploadTask.progress = Math.round((doneCount / runningUploadTask.deviceIps.length) * 100)
      }
    } finally {
      // 只有当没有运行中的任务时才重置状态
      const stillRunning = taskQueue.value.some(t => t.type === 'uploadImage' && t.status === 'running')
      if (!stillRunning) {
        isUploadingImage.value = false
        uploadProgress.value = 0
        currentUploadImage.value = null
      }
    }
  }

  return {
    handleCloudManageModeChange,
    handleSelectedCloudDeviceChange,
    handleBatchAction,
    uploadLocalImageToDevice,
    deleteLocalCachedImage,
    deleteDownloadedImage,
    handleDownloadProgress,
    handleDownloadComplete,
    handleUploadProgress,
    handleUploadComplete,
  }
}
