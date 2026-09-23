/**
 * 设备操作：设备详情里的容器删除 / 坑位折叠 / 按名称分组，云机列表的过滤与按设备名分组，
 * 添加设备（单个 / 批量）与设备认证校验，云机列表的分批加载与刷新，
 * 以及创建表单的 ADB 端口校验、API 详情弹窗、云机截图 URL 与云机状态合并。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态（createForm / apiDetailsData / contextMenu* / devices* 缓存等）留在 App.vue，
 * 通过 deps 传入；本模块自己 import ElMessage / wails binding / 纯工具函数。
 */
import { ref, computed } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getDevicePassword,
  saveDevicePassword,
  getContainers,
  triggerAndroidRefresh,
} from '../services/api.js'
import { getDeviceAddr, FORBIDDEN_ADB_PORTS, getPortMappings, extractPort9082 } from '../utils/device.js'
import { formatInstanceName } from '../utils/format.js'

export function useDeviceOperations({
  activeDevice,
  fetchDeviceDetailCloudMachines,
  deviceDetailSearchKeyword,
  deviceDetailCloudMachines,
  cloudMachines,
  selectedCloudMachines,
  isBatchAddingDevices,
  batchPendingDevices,
  devices,
  saveDevicesToLocalStorage,
  devicesStatusCache,
  devicesLastUpdateTime,
  authCancelledDevices,
  initCloudMachineGroups,
  isHeartbeatInitialized,
  showAuthDialog,
  createForm,
  contextMenuContainer,
  getCurrentContextMenuContainer,
  cloudManageMode,
  apiDetailsData,
  contextMenuSlot,
  apiDetailsVisible,
  contextMenuVisible,
}, lazyDeps = {}) {
  // 以下三个在 App.vue 下方才创建，用惰性依赖避免 TDZ
  const { autoGetAllDeviceVersions, updateHeartbeatDevices, fetchAndroidContainers } = lazyDeps


  const handleDeviceDetailDeleteContainer = async (container) => {
    try {
      await ElMessageBox.confirm(
        `确定要删除云机 "${container.name || container.ID}" 吗？删除后数据将无法恢复。`,
        '删除云机',
        {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'danger'
        }
      )

      const deviceIp = container.deviceIp || activeDevice.value?.ip
      const deviceVersion = container.deviceVersion || activeDevice.value?.version || 'v3'
      const containerName = container.name || container.ID

      if (!deviceIp || !containerName) {
        ElMessage.error('无法获取设备信息或容器名称')
        return
      }

      const port = deviceVersion === 'v3' ? '8000' : '81'
      const savedPassword = getDevicePassword(deviceIp)
      let headers = {}

      if (savedPassword) {
        const auth = btoa(`admin:${savedPassword}`)
        headers = { 'Authorization': `Basic ${auth}` }
      }

      let response
      if (deviceVersion === 'v3') {
        response = await axios.delete(`http://${getDeviceAddr(deviceIp)}/android/?name=${containerName}`, { headers })
      } else {
        response = await axios.delete(`http://${getDeviceAddr(deviceIp)}/android/?name=${containerName}`, { headers })
      }

      if (response.data && response.data.code === 0) {
        ElMessage.success('删除云机成功')
        await fetchDeviceDetailCloudMachines()
      } else {
        const errorMsg = response.data?.message || '删除失败'
        ElMessage.error(`删除云机失败: ${errorMsg}`)
      }
    } catch (error) {
      if (error !== 'cancel') {
        console.error('删除云机失败:', error)
        ElMessage.error('删除云机失败')
      }
    }
  }

  const deviceDetailSlotFoldStatus = ref({})

  const toggleSlotFold = (slotNum) => {
    deviceDetailSlotFoldStatus.value[slotNum] = !deviceDetailSlotFoldStatus.value[slotNum]
  }

  const deviceDetailGroupedInstances = computed(() => {
    if (!activeDevice.value) return []

    const result = []
    const keyword = deviceDetailSearchKeyword.value.trim().toLowerCase()

    let maxSlots = 12
    if (activeDevice.value && activeDevice.value.id && activeDevice.value.id.toLowerCase().startsWith('p')) {
      maxSlots = 24
    }

    for (let slotNum = 1; slotNum <= maxSlots; slotNum++) {
      let slotInstances = deviceDetailCloudMachines.value.filter(inst => inst.indexNum === slotNum)

      // 搜索过滤：按云机名称匹配（使用格式化后的名称）
      if (keyword) {
        slotInstances = slotInstances.filter(inst => {
          const displayName = formatInstanceName(inst.name) || ''
          return displayName.toLowerCase().includes(keyword)
        })
      }

      const isExpanded = deviceDetailSlotFoldStatus.value[slotNum] === true

      const runningInstances = slotInstances.filter(inst => inst.status === 'running')
      const stoppedInstances = slotInstances.filter(inst => inst.status !== 'running')

      if (slotInstances.length > 0) {
        if (runningInstances.length > 0) {
          const allChildren = [...runningInstances.slice(1), ...stoppedInstances]
          const firstInstance = {
            ...runningInstances[0],
            id: `slot-${slotNum}-${runningInstances[0].name || 'first'}`,
            slotNum,
            isFirstInSlot: true,
            instanceCount: slotInstances.length,
            isExpanded: isExpanded,
            showFoldButton: stoppedInstances.length > 0 || runningInstances.length > 1,
            hasChildren: allChildren.length > 0,
            _children: allChildren.map((child, idx) => ({
              ...child,
              id: `slot-${slotNum}-child-${idx}-${child.name || 'child'}`
            }))
          }
          result.push(firstInstance)
        } else {
          const allChildren = stoppedInstances.slice(1)
          const firstInstance = {
            ...stoppedInstances[0],
            id: `slot-${slotNum}-${stoppedInstances[0].name || 'first'}`,
            slotNum,
            isFirstInSlot: true,
            instanceCount: slotInstances.length,
            isExpanded: isExpanded,
            showFoldButton: stoppedInstances.length > 1,
            hasChildren: allChildren.length > 0,
            _children: allChildren.map((child, idx) => ({
              ...child,
              id: `slot-${slotNum}-child-${idx}-${child.name || 'child'}`
            }))
          }
          result.push(firstInstance)
        }
      } else if (!keyword) {
        // 无搜索词时显示空坑位，有搜索词时隐藏不匹配的坑位
        result.push({
          id: `slot-${slotNum}-empty`,
          slotNum,
          isFirstInSlot: true,
          instanceCount: 1,
          isExpanded: false,
          showFoldButton: false,
          hasChildren: false,
          _children: [],
          name: '',
          ip: '',
          image: '',
          createTime: '',
          status: 'shutdown',
          modelName: ''
        })
      }
    }

    return result

  })


  const filteredCloudMachines = computed(() => {
    return cloudMachines.value.filter(m => 
      m.status === 'running' && 
      (selectedCloudMachines.value.length === 0 || selectedCloudMachines.value.includes(m.id))
    )
  })

  // 计算属性：按名称索引云机，方便模板中快速访问
  const cloudMachinesByName = computed(() => {
    const map = new Map();
    cloudMachines.value.forEach(machine => {
      map.set(machine.name, machine);
    });
    // console.log('cloudMachinesByName:', map)
    return map;
  })

  // 生命周期钩子已经在文件顶部定义，此处移除重复定义


  // 添加设备（处理来自AddDeviceDialog的事件）
  const handleAddDevice = (device) => {
    if (isBatchAddingDevices.value) {
      batchPendingDevices.value.push(device)
      return
    }

    try {
      // 以设备ID为主键去重：同ID更新属性，同IP不同ID视为不同设备，允许共存
      const existingById = devices.value.find(d => d.id === device.id)
      if (existingById) {
        // 同一设备，更新可能变更的属性（IP变更、版本升级等）
        existingById.ip = device.ip
        existingById.version = device.version
        existingById.name = device.name
        existingById.type = device.type
        console.log(`设备 ${device.id} 已存在，更新属性: ip=${device.ip}, version=${device.version}`)
        saveDevicesToLocalStorage()
        return
      }
      // 同IP不同ID：不同设备（同IP多设备场景），不做合并，直接添加

      if (!device.group) {
        device.group = '默认分组'
      }

      devices.value.push(device)
      devicesStatusCache.value.set(device.id, 'offline')  // ✅ 改为 offline，由心跳检测验证
      devicesLastUpdateTime.value.set(device.id, Date.now())
      authCancelledDevices.value.delete(device.ip)  // 重新添加设备时清除认证取消标记

      saveDevicesToLocalStorage()
      initCloudMachineGroups()
      autoGetAllDeviceVersions()

      // ✅ 手动触发心跳监控列表更新
      if (isHeartbeatInitialized()) {
        console.log('[添加设备] 手动触发心跳监控更新')
        updateHeartbeatDevices()
      }

      // 异步验证设备是否需要密码，如果 401 则弹窗让用户输入
      if (device.version === 'v3') {
        verifyDeviceAuth(device)
      }

      console.log(`设备 ${device.ip} 添加成功，分组: ${device.group}`)
    } catch (error) {
      console.error('添加设备失败:', error)
    }
  }

  // 批量添加设备（处理来自AddDeviceDialog的批量事件）
  const handleBatchAddDevices = async (devicesToAdd) => {
    if (!devicesToAdd || devicesToAdd.length === 0) return

    isBatchAddingDevices.value = true
    batchPendingDevices.value = []

    try {
      const devicesToProcess = []

      for (const device of devicesToAdd) {
        const existingDevice = devices.value.find(d => d.id === device.id)
        if (!existingDevice) {
          if (!device.group) {
            device.group = '默认分组'
          }
          devicesToProcess.push(device)
        } else {
          console.log(`设备 ${device.ip} 已存在，跳过`)
        }
      }

      if (devicesToProcess.length === 0) {
        ElMessage.warning('所选设备均已存在')
        return
      }

      for (const device of devicesToProcess) {
        devices.value.push(device)
        devicesStatusCache.value.set(device.id, 'offline')  // ✅ 改为 offline，由心跳检测验证
        devicesLastUpdateTime.value.set(device.id, Date.now())
        authCancelledDevices.value.delete(device.ip)  // 重新添加设备时清除认证取消标记
      }

      saveDevicesToLocalStorage()
      initCloudMachineGroups()
      autoGetAllDeviceVersions()

      // ✅ 手动触发心跳监控列表更新
      if (isHeartbeatInitialized()) {
        console.log('[批量添加设备] 手动触发心跳监控更新')
        updateHeartbeatDevices()
      }

      // 异步验证需要密码的设备
      for (const device of devicesToProcess) {
        if (device.version === 'v3') {
          verifyDeviceAuth(device)
        }
      }

      console.log(`批量添加设备成功: ${devicesToProcess.length} 个`)
    } catch (error) {
      console.error('批量添加设备失败:', error)
      ElMessage.error('批量添加设备失败: ' + error.message)
    } finally {
      isBatchAddingDevices.value = false
      batchPendingDevices.value = []
    }
  }

  // 验证 V3 设备是否需要密码，如果 401 则弹窗让用户输入
  const verifyDeviceAuth = async (device) => {
    try {
      const savedPassword = getDevicePassword(device.ip)
      const result = await getContainers(device, savedPassword)
      if (result && result.code === 61) {
        // 需要认证，弹出密码输入框
        showAuthDialog(device, async (password) => {
          await saveDevicePassword(device.ip, password)
          triggerAndroidRefresh([device.ip]).catch(() => {})
        })
      }
    } catch (e) {
      // 网络错误等，忽略
    }
  }

  // 发现设备并加�数据


  // 后台10个一批加载云机列表（只处理在线设备）
  const loadContainersInBatches = async () => {
    if (devices.value.length === 0) return

    // 只对在线设备发请求，避免对离线设备产生无效 HTTP 超时
    const onlineDevices = devices.value.filter(device =>
      devicesStatusCache.value.get(device.id) === 'online'
    )

    if (onlineDevices.length === 0) {
      console.log('没有在线设备，跳过云机列表加载')
      return
    }

    console.log(`开始后台10个一批加载云机列表，在线设备 ${onlineDevices.length} 台`)

    // 将在线设备分成每10个一组
    const batchSize = 10
    for (let i = 0; i < onlineDevices.length; i += batchSize) {
      const batch = onlineDevices.slice(i, i + batchSize)
      console.log(`加载第 ${Math.floor(i / batchSize) + 1} 组设备云机列表，共 ${batch.length} 个设备`)

      // 并行加载该组设备的云机列表，isUserInitiated=false表示后台加载
      const promises = batch.map(device => {
        return fetchAndroidContainers(device, false)
          .then(() => {
            console.log(`设备 ${device.ip} 云机列表加载成功`)
          })
      })

      // 使用Promise.allSettled，即使有设备加载失败，其他设备仍能继续加载
      await Promise.allSettled(promises)

      // 更新云机分组数据
      initCloudMachineGroups()

      // 短暂延迟，避免服务器压力过大
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    console.log('所有在线设备云机列表加载完成')
  }

  // 刷新数据
  const refreshData = async () => {
    if (activeDevice.value) {
      await fetchAndroidContainers(activeDevice.value, true) // isUserInitiated=true表示用户主动刷新
    }
  }


  // ADB端口禁用列表（这些端口已被其他服务占用）


  // 校验 ADB 端口
  const validateAdbPort = (value) => {
    if (value === null || value === undefined || value === '') {
      createForm.value.adbPort = 5555
      return
    }
    const port = Number(value)
    if (isNaN(port) || port < 0) {
      ElMessage.warning('ADB端口不能小于0，已重置为默认值5555')
      createForm.value.adbPort = 5555
      return
    }
    if (port > 65535) {
      ElMessage.warning('ADB端口不能超过65535，已重置为65535')
      createForm.value.adbPort = 65535
      return
    }
    if (port !== 0 && FORBIDDEN_ADB_PORTS.has(port)) {
      ElMessage.warning(`端口 ${port} 已被系统服务占用（9082/9083/10000/10001/10006/10007/10008），请使用其他端口`)
      createForm.value.adbPort = 5555
      return
    }
  }




  // 全局辅助函数：为公网设备解析端口映射
  // 返回 { ip, port } 对象，公网设备返回 publicIp + publicPort，局域网设备返回原始值
  window.resolveOpenCecsAddress = (deviceIp, hostPort) => {
    if (!deviceIp || !deviceIp.includes(':')) {
      // 局域网设备：直接返回
      return { ip: deviceIp, port: hostPort }
    }
    const publicIp = deviceIp.split(':')[0]
    const portMap = window.openCecsPortMap?.get(deviceIp)
    const publicPort = portMap?.get(Number(hostPort))
    if (publicPort) {
      return { ip: publicIp, port: publicPort }
    }
    // 未找到映射，返回原始值（可能URL会有问题但不影响局域网设备）
    return { ip: deviceIp, port: hostPort }
  };




  // 显示API详情
  const showApiDetails = () => {
    if (!contextMenuContainer.value) return


    const container = getCurrentContextMenuContainer()
    // 获取设备信息
    let device = null
    if (cloudManageMode.value === 'slot') {
      // 坑位模式：从activeDevice获取设备信息
      device = activeDevice.value
      if (!device) {
        ElMessage.error('未选择设备')
        return
      }
    } else {
      // 批量模式：从contextMenuContainer获取设备信息
      if (contextMenuContainer.value && contextMenuContainer.value.deviceIp) {
        // 查找对应的设备
        device = devices.value.find(d => d.ip === contextMenuContainer.value.deviceIp)
        if (!device) {
          // 如果找不到设备，创建一个临时设备对象
          device = {
            ip: contextMenuContainer.value.deviceIp,
            version: contextMenuContainer.value.deviceVersion || 'v3',
            name: 'unknown'
          }
        }
      } else {
        ElMessage.error('未选择设备')
        return
      }
    }

    console.log('device:', container)

    // 构建API详情数据
    apiDetailsData.value = {
      slotNum: contextMenuSlot.value,
      instanceName: contextMenuContainer.value ? (contextMenuContainer.value.name || '未命名实例') : '空坑位',
      deviceIp: container.networkName == 'myt' ? container.ip : device.ip,
      deviceVersion: device.version || '未知',
      portMappings: getPortMappings(contextMenuContainer.value, container.networkName == 'myt' ? container.ip : device.ip),
      hasInstance: !!contextMenuContainer.value
    }

    // 显示API详情对话框
    apiDetailsVisible.value = true

    // 隐藏右键菜单
    contextMenuVisible.value = false
  }

  // 获取云机截图URL
  const getCloudMachineScreenshotUrl = (device, container) => {
    // 优先从容器的缓存中获取截图URL，避免重复计算
    // 注意：OpenCecs 公网设备不缓存，端口映射表可能后续才填充
    const isPublicDev = container.deviceIp && container.deviceIp.includes(':')
    if (!isPublicDev && container._cachedScreenshotUrl) {
      return container._cachedScreenshotUrl;
    }

    let mappedPort = extractPort9082(container);

    // 如果没有找到映射端口，尝试使用默认的10000+坑位号作为端口
    if (!mappedPort && container.indexNum) {
      mappedPort = 10000 + container.indexNum;
    }

    if (!mappedPort) {
      return null;
    }

    // 使用容器所属设备IP，而不是当前选中设备
    const deviceIp = container.deviceIp || (device ? device.ip : null);
    if (!deviceIp) {
      return null;
    }

    let screenshotUrl;
    if(container.networkName == 'myt') {
      screenshotUrl = `http://${container.ip}:9082/task=snap&level=1?v=202603152350`;
    } else if (deviceIp.includes(':')) {
      // OpenCecs 公网设备：extractPort 已自动返回公网端口，只需提取纯 IP
      const publicIp = deviceIp.split(':')[0]
      screenshotUrl = `http://${publicIp}:${mappedPort}/task=snap&level=1?v=202603152350`;
    } else {
      // 局域网设备：直接使用 deviceIp:HostPort
      screenshotUrl = `http://${deviceIp}:${mappedPort}/task=snap&level=1?v=202603152350`;
    }

    // 缓存截图URL，避免重复计算
    container._cachedScreenshotUrl = screenshotUrl;
    return screenshotUrl;
  };

  // 辅助函数：合并云机状态，保留截图数据
  const mergeCloudMachineState = (oldMachines, newMachine) => {
    if (!oldMachines || oldMachines.length === 0) return newMachine;

    const oldMachine = oldMachines.find(m => m.id === newMachine.id);
    if (oldMachine) {
      newMachine.screenshotData = oldMachine.screenshotData;
      newMachine.screenshotError = oldMachine.screenshotError;
      newMachine.hasLoadedOnce = oldMachine.hasLoadedOnce;
    }
    return newMachine;
  };

  return {
    handleDeviceDetailDeleteContainer,
    deviceDetailSlotFoldStatus,
    toggleSlotFold,
    deviceDetailGroupedInstances,
    filteredCloudMachines,
    cloudMachinesByName,
    handleAddDevice,
    handleBatchAddDevices,
    verifyDeviceAuth,
    loadContainersInBatches,
    refreshData,
    validateAdbPort,
    showApiDetails,
    getCloudMachineScreenshotUrl,
    mergeCloudMachineState,
  }
}
