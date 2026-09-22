/**
 * 设备列表与镜像相关的状态声明块，含五组彼此独立的状态与派生：
 *   1. 右侧标签页状态 currentRightTab 及「切到镜像 / 主机页」的联动 watch
 *   2. 设备列表的本地存储读写（loadDevicesFromLocalStorage / saveDevicesToLocalStorage）
 *   3. v3 设备详情 / 最新版本 / 升级进度状态
 *   4. docker 网络列表与新增 macvlan、编辑网络两个弹窗的状态
 *   5. 镜像本地缓存、下载 / 上传进度、镜像分类筛选，以及设备分组的派生列表
 *
 * 由 App.vue 拆分阶段 3 迁出，声明与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 本块只有状态与派生，不含业务流程；仍解构回 App.vue 顶层，模板引用不受影响。
 * 设备分组 CRUD 仍由 useDeviceGroups 提供，本模块只是它的调用方。
 */
import { ref, computed, watch, nextTick } from 'vue'
import { useDeviceGroups } from './useDeviceGroups.js'

export function useDeviceListState({
  activeDevice,
  devices,
  deviceCloudMachinesCache,
  deviceFilter,
  devicesLastUpdateTime,
  devicesStatusCache,
  deviceVersionInfo,
  deviceFirmwareInfo,
}, lazyDeps = {}) {
  // 以下依赖在 App.vue 下方才声明，用惰性依赖避免 TDZ
  const {
    getImageListFromLocal,
    fetchImageList,
    switchImageCategory,
    fetchV3DeviceInfo,
    initCloudMachineGroups,
  } = lazyDeps

  // 右侧标签页控制
  const currentRightTab = ref('instance') // instance: 实例, image: 镜像, network: 网络, host: 主机

  // 监听右侧标签页变化，当切换到镜像管理模块时，默认选中在线镜像
  watch(currentRightTab, async (newTab, oldTab) => {
    console.log('右侧标签页变化:', oldTab, '->', newTab)

    // 当切换到镜像管理模块时
    if (newTab === 'image' && oldTab !== 'image') {
      console.log('切换到镜像管理模块，默认选中在线镜像')

      // 检测镜像缓存是否为空或已被清理
      const cachedImages = getImageListFromLocal()
      const isCacheEmpty = !cachedImages || cachedImages.length === 0

      if (isCacheEmpty) {
        console.log('检测到镜像缓存为空，自动重新加载镜像列表...')
        await fetchImageList('')
      }

      // 先设置当前选中的镜像分类为在线镜像
      selectedImageCategory.value = 'online'

      // 等待DOM更新后再执行后续操作
      await nextTick()

      // 加载在线镜像数据，这会自动选中第一个型号的在线镜像
      await switchImageCategory('online')
    }

    // 切到主机标签页时现场调一次 /info/device：主机页展示的 memtotal/speed/
    // mmcmodel/hwaddr 等静态字段事件流给不了，心跳缓存只是先上屏，
    // 弹窗里看到的主机信息必须以这次接口返回为准（fetchV3DeviceInfo 成功后
    // 内部还会调 fetchV3LatestInfo 拉 /info 的当前/最新 API 版本）
    if (newTab === 'host') {
      fetchV3DeviceInfo(activeDevice.value)
    }
  })

  // 从本地存储加载设备列表
  const loadDevicesFromLocalStorage = () => {
    try {
      // 清空 api.js 的设备缓存，避免 deviceCache 中积累的历史离线设备干扰
      localStorage.removeItem('deviceCache')

      const savedDevices = localStorage.getItem('edgeclient_devices')
      if (savedDevices) {
        const parsedDevices = JSON.parse(savedDevices)
        devices.value = parsedDevices
        console.log('从本地存储加载设备列表成功，共', parsedDevices.length, '个设备')

        // ⚠️ 初始化设备状态为 offline，等待心跳检测验证
        // 避免启动时显示假的在线状态
        parsedDevices.forEach(device => {
          devicesStatusCache.value.set(device.id, 'offline')
          devicesLastUpdateTime.value.set(device.id, Date.now())
        })
      }
    } catch (error) {
      console.error('从本地存储加载设备列表失败:', error)
    }
  }

  // 保存设备列表到本地存储
  const saveDevicesToLocalStorage = () => {
    try {
      localStorage.setItem('edgeclient_devices', JSON.stringify(devices.value))
      console.log('设备列表保存到本地存储成功，共', devices.value.length, '个设备')
    } catch (error) {
      console.error('保存设备列表到本地存储失败:', error)
    }
  }

  // V3设备信息
  const v3DeviceInfo = ref({}) // 存储V3设备详细信息
  const v3LatestInfo = ref({}) // 存储最新版本信息
  const showUpgradeButton = ref(false) // 是否显示升级按钮
  const upgrading = ref(false) // 是否正在升级
  const upgradeProgress = ref(0) // SDK升级进度
  const v3DeviceInfoLoaded = ref(false) // 标记V3设备信息是否已加载

  // 🔧 监听心跳数据变化，自动更新当前激活设备的 v3DeviceInfo
  watch([deviceFirmwareInfo, activeDevice], () => {
    if (activeDevice.value && activeDevice.value.version === 'v3') {
      const latestInfo = deviceFirmwareInfo.value.get(activeDevice.value.id)
      if (latestInfo && latestInfo.originalData) {
        // 从心跳数据更新 v3DeviceInfo，保持实时同步
        v3DeviceInfo.value = {
          sdkVersion: latestInfo.sdkVersion || v3DeviceInfo.value.sdkVersion,
          deviceModel: latestInfo.deviceModel || v3DeviceInfo.value.deviceModel,
          originalData: {
            ...v3DeviceInfo.value.originalData,
            ...latestInfo.originalData
          }
        }
        v3DeviceInfoLoaded.value = true
        console.log(`[心跳同步] 更新 v3DeviceInfo: CPU=${latestInfo.originalData.cputemp}°C, 内存=${latestInfo.originalData.memuse}MB`)
      }
    }
  }, { deep: true })

  const v3DeviceUptimeMinutes = computed(() => {
    if (!v3DeviceInfo.value.originalData?.sysuptime) return '加载中...'
    const seconds = parseInt(v3DeviceInfo.value.originalData.sysuptime)
    if (isNaN(seconds)) return '加载中...'
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}分钟${remainingSeconds}秒`
  })


  // Docker网络信息
  const dockerNetworks = ref([]) // 存储docker网络列表
  const dockerNetworksLoading = ref(false) // 标记是否正在加载网络信息
  const dockerNetworksError = ref('') // 存储加载错误信息

  // 添加macvlan网络弹窗
  const addMacvlanDialogVisible = ref(false)
  const addMacvlanLoading = ref(false)
  const addMacvlanForm = ref({
    networkName: '',
    parentInterface: '',
    subnet: '',
    gateway: '',
    ipRange: '',
    isPrivate: false
  })

  // 修改网络弹窗
  const editNetworkDialogVisible = ref(false)
  const editNetworkLoading = ref(false)
  const editNetworkForm = ref({
    networkName: '',
    networkID: '',
    subnet: '',
    gateway: '',
    ipRange: '',
    isPrivate: false
  })
  const currentEditingNetwork = ref(null)

  // 镜像列表缓存配置
  const IMAGE_CACHE_KEY = 'mytos_image_list' // 本地存储键名
  const IMAGE_CACHE_DURATION = 24 * 60 * 60 * 1000 // 缓存有效期24小时
  const IMAGE_CACHE_LAST_UPDATE_KEY = 'mytos_image_list_last_update' // 上次更新时间键名

  // 镜像卡片相关状态
  const localCachedImages = ref([]) // 本地缓存镜像列表
  const onlineImagesByModel = ref(new Map()) // 按型号分类的在线镜像列表
  const currentOnlineImageModel = ref('') // 当前选中的在线镜像型号
  const isLoadingLocalImages = ref(false) // 本地镜像加载状态
  const isDownloadingImage = ref(false) // 镜像下载状态
  const downloadProgress = ref(0) // 镜像下载进度
  const selectedImageCategory = ref('online') // 选中的镜像分类: online 在线镜像, local 本地镜像
  const currentDownloadImage = ref(null) // 当前正在下载的镜像
  const currentDownloadTaskId = ref(null) // 当前下载任务ID
  const downloadStartTime = ref(0) // 下载开始时间戳，用于区分不同的下载会话
  const userDataDir = ref('') // 用户数据目录，用于存储下载的镜像
  const imageDownloadStatus = ref(new Map()) // 镜像下载状态映射，键为镜像URL，值为boolean
  const imageUploadStatus = ref(new Map()) // 镜像上传状态映射，键为镜像URL，值为boolean
  const isUploadingImage = ref(false) // 是否正在上传镜像
  const uploadProgress = ref(0) // 镜像上传进度
  const currentUploadImage = ref(null) // 当前正在上传的镜像
  const boxImages = ref([]) // 盒子镜像列表（设备上存在的镜像）
  const selectedDeviceForImages = ref(null) // 镜像管理tab选中的设备
  const deviceBoxImages = ref([]) // 镜像管理tab选中设备的镜像列表
  const isLoadingDeviceImages = ref(false) // 镜像管理tab设备镜像加载状态
  const isLoadingBoxImages = ref(false) // 盒子镜像加载状态

  // 在线镜像列表筛选状态
  const imageCategory = ref('simulator') // 'simulator' | 'container'
  const containerAndroidVersion = ref(10) // 10, 12, 14
  const simulatorAndroidVersion = ref(14) // 模拟器安卓版本

  // 设备API版本是否低于100（低于100时模拟器只显示Android 14）
  const isLowApiVersion = computed(() => {
    const device = selectedDeviceForImages.value || activeDevice.value
    if (!device) return false
    const versionInfo = deviceVersionInfo.value.get(device.id)
    if (!versionInfo || !versionInfo.currentVersion) return false
    return parseInt(versionInfo.currentVersion) < 100
  })

  // 镜像使用说明 - 模拟器 vs 容器对比数据
  const imageTypeCompareData = [
    { dimension: '运行原理', simulator: '基于 QEMU 等虚拟机技术，完整模拟 ARM 硬件', container: '基于 Linux 容器（如 Docker）轻量隔离，共享宿主机内核' },
    { dimension: '启动速度', simulator: '较慢，通常需要 30 秒以上', container: '快，通常 3~10 秒即可启动' },
    { dimension: '资源占用', simulator: '较高，每实例需独立分配 CPU/内存', container: '较低，多实例可共享宿主机资源，密度更高' },
    { dimension: '并发数量', simulator: '受限于宿主机性能，同时运行数量较少', container: '可大规模并发，单机支持数十甚至上百个实例' },
    { dimension: '安卓兼容性', simulator: '与真机行为高度一致，兼容性更好', container: '部分依赖底层硬件的功能可能受限' },
    { dimension: '图形界面', simulator: '支持完整 GPU 渲染，画面流畅', container: '使用软件渲染，图形性能稍弱' },
    { dimension: '适用场景', simulator: 'UI 测试、游戏运行、强兼容性需求', container: '自动化脚本、批量任务、高密度部署' },
  ]

  // 监听 tab 切换，处理 P1 不支持 Android 12 的情况
  watch(currentOnlineImageModel, (newModel) => {
    if (newModel === 'P1' && containerAndroidVersion.value === 12) {
      containerAndroidVersion.value = 10
    }
  })

  // API版本低于100时，模拟器自动重置安卓版本为14
  watch(isLowApiVersion, (low) => {
    if (low) {
      simulatorAndroidVersion.value = 14
    }
  })

  // 获取筛选后的镜像列表
  const getFilteredImages = (images, model) => {
    // console.log('getFilteredImages', images, model)
    if (!images) return []

    return images.filter(img => {
      // 1. 模拟器 vs 容器
      if (imageCategory.value === 'simulator') {
        // Q/P 系列模拟器：sys_ver == 5；特质版（sys_ver == 4）也属于模拟器分类
        if (img.sys_ver != 5 && !(img.sys_ver == 4 && img.sys_ver_des === '特质版')) return false
        return img.os_ver == `and${simulatorAndroidVersion.value}`
      } else {
        // 容器：sys_ver != 5（排除模拟器与特质版）
        if (img.sys_ver == 5) return false
        if (img.sys_ver == 4 && img.sys_ver_des === '特质版') return false
        return img.os_ver == `and${containerAndroidVersion.value}`
      }
    })
  }

  // 设备分组相关
  const deviceGroups = ref(['默认分组']) // 设备分组列表
  const deviceGroupFilter = ref('全部') // 当前选中的分组过滤
  const editingDeviceGroup = ref(null) // 当前编辑分组的设备

  // 设备分组 CRUD（阶段 3 迁出到 composables/useDeviceGroups.js）
  // initCloudMachineGroups 声明在本文件更靠后的位置，用箭头函数惰性取，避免 TDZ
  const {
    addDeviceGroup,
    renameDeviceGroup,
    deleteDeviceGroup,
    moveDeviceToGroup,
    saveDeviceGroupsToLocalStorage,
    loadDeviceGroupsFromLocalStorage,
  } = useDeviceGroups({
    devices,
    deviceGroups,
    deviceGroupFilter,
    saveDevicesToLocalStorage,
    initCloudMachineGroups: () => initCloudMachineGroups(),
  })

  // 按IP地址比较（用于正确排序）
  const compareIPs = (ip1, ip2) => {
    const parts1 = ip1.split('.').map(Number)
    const parts2 = ip2.split('.').map(Number)
    for (let i = 0; i < 4; i++) {
      if (parts1[i] < parts2[i]) return -1
      if (parts1[i] > parts2[i]) return 1
    }
    return 0
  }

  // 提取云机坑位号（用于排序）：优先直接用数据里的 indexNum（与坑位模式同口径）；
  // 兜底从容器完整ID（${deviceIp}_${hash}_${坑位}_${名}）的第3段解析；
  // 再兜底从简单容器名（如 T0002）的尾部数字解析
  const getCloudMachineSlotNum = (machine) => {
    if (machine.indexNum !== undefined && machine.indexNum !== null && machine.indexNum !== '') {
      const n = Number(machine.indexNum)
      if (!Number.isNaN(n)) return n
    }
    const parts = (machine.id || '').split('_')
    if (parts.length >= 4) {
      const slot = parseInt(parts[2], 10)
      if (!Number.isNaN(slot)) return slot
    }
    const tail = parseInt(((machine.name || '').match(/(\d+)$/) || [])[1], 10)
    return Number.isNaN(tail) ? 0 : tail
  }

  // 计算属性：按分组过滤后的设备列表
  const filteredDevicesByGroup = computed(() => {
    const filtered = devices.value.filter(device => {
      const status = devicesStatusCache.value.get(device.id) || 'online'
      const matchesStatus = deviceFilter.value === 'online' ? status === 'online' : status === 'offline'
      const matchesGroup = deviceGroupFilter.value === '全部' || device.group === deviceGroupFilter.value
      return matchesStatus && matchesGroup
    }).map(device => {
      const deviceContainers = deviceCloudMachinesCache.value.get(device.ip) || []
      return {
        ...device,
        containers: deviceContainers
      }
    })
    // 按IP地址排序
    return filtered.sort((a, b) => compareIPs(a.ip, b.ip))
  })

  // 计算属性：按分组整理的设备树形结构
  const deviceGroupsTree = computed(() => {
    const groups = {}
    // 确保默认分组存在
    if (!groups['默认分组']) {
      groups['默认分组'] = []
    }

    filteredDevicesByGroup.value.forEach(device => {
      const groupName = device.group || '默认分组'
      if (!groups[groupName]) {
        groups[groupName] = []
      }
      groups[groupName].push(device)
    })

    return Object.entries(groups).map(([name, devices]) => ({
      name,
      devices,
      count: devices.length
    }))
  })

  // 计算属性：与当前上传镜像兼容的设备列表
  const filteredDevices = computed(() => {
    // devicesLastUpdateTime.value.size
    const filtered = devices.value.filter(device => {
      const status = devicesStatusCache.value.get(device.id) || 'online' // 默认在线
      return deviceFilter.value === 'online' ? status === 'online' : status === 'offline'
    }).map(device => {
      // 添加容器数量信息
      const deviceContainers = deviceCloudMachinesCache.value.get(device.ip) || []
      return {
        ...device,
        containers: deviceContainers
      }
    })
    // 按IP地址排序
    return filtered.sort((a, b) => compareIPs(a.ip, b.ip))
  })

  return {
    currentRightTab,
    loadDevicesFromLocalStorage,
    saveDevicesToLocalStorage,
    v3DeviceInfo,
    v3LatestInfo,
    showUpgradeButton,
    upgrading,
    upgradeProgress,
    v3DeviceInfoLoaded,
    v3DeviceUptimeMinutes,
    dockerNetworks,
    dockerNetworksLoading,
    dockerNetworksError,
    addMacvlanDialogVisible,
    addMacvlanLoading,
    addMacvlanForm,
    editNetworkDialogVisible,
    editNetworkLoading,
    editNetworkForm,
    currentEditingNetwork,
    IMAGE_CACHE_KEY,
    IMAGE_CACHE_DURATION,
    IMAGE_CACHE_LAST_UPDATE_KEY,
    localCachedImages,
    onlineImagesByModel,
    currentOnlineImageModel,
    isLoadingLocalImages,
    isDownloadingImage,
    downloadProgress,
    selectedImageCategory,
    currentDownloadImage,
    currentDownloadTaskId,
    downloadStartTime,
    userDataDir,
    imageDownloadStatus,
    imageUploadStatus,
    isUploadingImage,
    uploadProgress,
    currentUploadImage,
    boxImages,
    selectedDeviceForImages,
    deviceBoxImages,
    isLoadingDeviceImages,
    isLoadingBoxImages,
    imageCategory,
    containerAndroidVersion,
    simulatorAndroidVersion,
    isLowApiVersion,
    imageTypeCompareData,
    getFilteredImages,
    deviceGroups,
    deviceGroupFilter,
    editingDeviceGroup,
    addDeviceGroup,
    renameDeviceGroup,
    deleteDeviceGroup,
    moveDeviceToGroup,
    saveDeviceGroupsToLocalStorage,
    loadDeviceGroupsFromLocalStorage,
    compareIPs,
    getCloudMachineSlotNum,
    filteredDevicesByGroup,
    deviceGroupsTree,
    filteredDevices,
  }
}
