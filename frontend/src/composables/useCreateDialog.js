/**
 * 创建云机弹窗：弹窗可见性 / 创建模式 / 批量设备选择 / SDK 加载进度 / 创建表单，
 * 以及围绕它的镜像与机型过滤派生（按设备类型、按容器 os_ver、按安卓版本、按国家/网络/VPC 等）。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态随本特性一起搬进来，仍解构回 App.vue 顶层，模板引用不受影响。
 * ElMessage / 纯工具函数由本模块自己 import。
 */
import { ref, computed, reactive, watch } from 'vue'
import { formatSize } from '../utils/format.js'

export function useCreateDialog({
  devices,
  localCachedImages,
  fetchBackupModels,
  phoneModels,
  localPhoneModels,
  deviceFirmwareInfo,
  v3DeviceInfo,
  deviceVersionInfo,
  activeDevice,
  imageList,
  filteredImageList,
  boxImages,
}, lazyDeps = {}) {
  // 以下依赖在 App.vue 下方才声明，用惰性依赖避免 TDZ
  const {
    filterImageList,
    fetchImageList,
    getV3PhoneModels,
    getLocalPhoneModels,
    fetchNetworkCards,
    getCompatibleTypes,
    getIsSpecialModelLocked,
    getUpdateImageContainer,
  } = lazyDeps

  // isSpecialModelLocked（computed）/ updateImageContainer（ref）是 App.vue 下方的响应式对象，
  // 用代理把 .value 的读 / 写转发到真实对象，函数体保持原写法不变
  const proxyRef = (get) => ({
    get value() { return get().value },
    set value(v) { get().value = v },
  })
  const isSpecialModelLocked = proxyRef(getIsSpecialModelLocked)
  const updateImageContainer = proxyRef(getUpdateImageContainer)

  // 创建云机对话框
  const createDialogVisible = ref(false)
  const createDevice = ref(null) // 当前操作的设备
  const createMode = ref('batch') // batch: 批量创建, slot: 单个坑位创建
  const selectedBatchDevices = ref([]) // 批量设备创建时选中的设备列表

  const batchDeviceTypeFilter = ref('p_series') // p_series, other_series

  // 监听批量设备类型筛选变化，更新镜像列表
  watch(batchDeviceTypeFilter, (newVal) => {
    if (createMode.value === 'multi-device-batch') {
      const type = newVal === 'p_series' ? 'P1' : 'C1'
      filterImageList(type)
    }
  })

  // 过滤后的设备列表（用于批量设备创建）
  const filteredBatchDevices = computed(() => {
    return devices.value.filter(device => {
      const isPSeries = device.id && device.id.toLowerCase().startsWith('p')
      if (batchDeviceTypeFilter.value === 'p_series') {
        return isPSeries
      } else {
        return !isPSeries
      }
    })
  })

  const isPSeriesOrBatchP = computed(() => {
    if (createDevice.value) {
      return createDevice.value.id && createDevice.value.id.toLowerCase().startsWith('p')
    }
    if (createMode.value === 'multi-device-batch') {
      return batchDeviceTypeFilter.value === 'p_series'
    }
    return false
  })

  // 按设备类型过滤本地镜像：P系列设备只显示P系列镜像，非P系列只显示非P系列镜像
  // 若镜像的 availableModels 为空（老镜像无元数据），则不过滤，全部显示
  const filteredLocalCachedImages = computed(() => {
    const isP = isPSeriesOrBatchP.value
    return localCachedImages.value.filter(image => {
      const models = image.availableModels
      if (!models || models.length === 0) {
        // 无型号信息的镜像不过滤，保持兼容
        return true
      }
      const hasPModel = models.some(m => m && m.toLowerCase().startsWith('p'))
      return isP ? hasPModel : !hasPModel
    })
  })

  const showV3Options = computed(() => {
    if (createDevice.value) {
      return createDevice.value.version === 'v3'
    }
    if (createMode.value === 'multi-device-batch') {
      if (selectedBatchDevices.value.length > 0) {
          const selected = devices.value.filter(d => selectedBatchDevices.value.includes(d.ip))
          return selected.some(d => d.version === 'v3')
      }
      return true
    }
    return false
  })

  watch(selectedBatchDevices, async (newVal) => {
    if (createMode.value === 'multi-device-batch' && newVal.length > 0) {
       const firstDevice = devices.value.find(d => newVal.includes(d.ip))
       if (firstDevice) {
          // Update image list based on device type
          const type = firstDevice.name || 'C1'
          await fetchImageList(type)

          if (firstDevice.version === 'v3') {
             await getV3PhoneModels(firstDevice.ip)
             await getLocalPhoneModels(firstDevice.ip)
             await fetchBackupModels(firstDevice.ip)
             fetchNetworkCards(firstDevice.ip)
          }
       }
    }
  })

  const currentSlot = ref(0) // 当前操作的坑位
  const createLoading = ref(false) // 创建云机时的加载状态
  const createCancelled = ref(false) // 创建操作取消标志
  // 添加蒙版相关状态
  const sdkLoadingVisible = ref(false) // SDK加载蒙版显示状态
  const sdkLoadingMessage = ref('加载MYT SDK中') // SDK加载提示信息
  const sdkLoadingProgress = ref(0) // SDK加载进度（0-100）
  const createForm = ref({
    createType: 'simulator', // simulator, container

    // Container mode specific fields
    containerAndroidVersion: '10', // 10, 12, 14
    containerSandboxMode: true,
    containerEnforce: true, // 安全模式，默认开启
    containerCompatMode: false, // 兼容模式，默认关闭
    containerDataDiskSize: '16G',
    containerName: 'T000',
    containerCount: 1,
    containerImageSelect: '',
        containerCustomImageUrl: '',
        containerResolution: '720x1280x320',
    containerCustomResolution: {
      width: '',
      height: '',
      dpi: ''
    },
    containerDns: '223.5.5.5',
    containerCustomDns: '',
    containerNetworkCardType: 'private', // private-私有网卡, public-公有网卡
    containerMytBridgeName: '', // 容器模式的 myt_bridge网卡名
    containerMacVlanIp: '', // 容器模式的 MacVlan IP

    // Simulator mode (shared/original) fields
    name: 'T000',
    androidVersion: '14', // 安卓版本：11, 13, 14, 15, 16, 17
    modelName: 'random',
    count: 1,
    startSlot: 1,
    imageSelect: 'registry.magicloud.tech/magicloud/dobox-android13:Q1',
    customImageUrl: '',
    imageCategory: 'online', // online: 在线镜像, local: 本地镜像
    localImageUrl: '', // 本地镜像URL
    imageSource: 'pc', // pc: 在线镜像, local: 本地镜像
    cacheToLocal: false, // 是否缓存到本地创建
    networkMode: 'bridge',
    ipaddr: '',
    resolution: 'default',
    customResolution: {
      width: '',
      height: '',
      dpi: ''
    },
    sandboxSize: 28,
    dns: '223.5.5.5',
    customDns: '',
    countryCode: 'CN', // 机型国家代码，默认为中国
    // S5代理设置（SDK版本>=25时支持）
    s5Type: '0', // 代理类型，0-不开启代理，1-本地域名解析tun2socks，2-服务器域名解析tun2proxy
    s5IP: '', // 代理服务器IP
    s5Port: '', // 代理服务器端口
    s5User: '', // 代理用户名
    s5Password: '', // 代理密码
    s5RelayType: '0', // 中转类型，0-不中转，1-已有VPC，2-中转链接
    s5RelayVpcId: '', // 已有VPC的ID
    s5RelayAddress: '', // 中转链接地址
    enableMagisk: false,
    enableGMS: false,
    enforce: true, // 安全模式，默认开启
    compatMode: false, // 兼容模式，默认关闭。开启后创建容器时删除机型包中的 cpuinfo 文件
    longitud: '',  // 经度
    latitude: '',  // 纬度
    lockScreenPassword: '',  // 锁屏密码
    modelType: 'online', // 机型类型：online-在线机型，local-本地机型
    modelStatic: 'random', // 备份机型名称
    localModel: 'random', // 本地机型名称
    // 网络管理分组
    vpcGroupId: '', // 选择的分组ID
    vpcNodeId: '', // 选择的节点ID
    vpcSelectMode: 'specified', // specified-指定节点, random-随机节点
    randomFile: false, // 随机系统文件，默认关闭
    networkCardType: 'private', // private-私有网卡, public-公有网卡
    mytBridgeName: '', // myt_bridge网卡名
    macVlanIp: '', // macVlan IP
    adbPort: 5555, // ADB端口，默认555，设置0不开启ADB
    selectedSlots: [] // 批量创建选中的坑位
  })

  // 监听 P 系列设备选择变化，如果选中了 Android 12 则重置为 10；非P设备时清除超出12的坑位
  watch(isPSeriesOrBatchP, (isP) => {
    if (isP && createForm.value.containerAndroidVersion === '12') {
      createForm.value.containerAndroidVersion = '10'
    }
    // 切换为非P设备时，过滤掉超出12坑位范围的已选坑位
    if (!isP && createForm.value.selectedSlots && createForm.value.selectedSlots.length > 0) {
      createForm.value.selectedSlots = createForm.value.selectedSlots.filter(s => s <= 12)
    }
  })

  const handleModelTypeChange = async (val) => {
    if (val === 'online') {
      // 特质镜像 + 安卓15 时绑定 Samsung_S24，否则随机
      if (isSpecialModelLocked.value) {
        createForm.value.modelName = 'Samsung_S24'
      } else if (!createForm.value.modelName || createForm.value.modelName === 'Samsung_S24') {
        createForm.value.modelName = 'random'
      }
      // 确保在线机型列表已加载
      if (phoneModels.value.length === 0 && createDevice.value && createDevice.value.ip) {
        await getV3PhoneModels(createDevice.value.ip)
      }
    } else if (val === 'local') {
      if (!createForm.value.localModel) createForm.value.localModel = 'random'
      // 确保本地机型列表已加载
      if (localPhoneModels.value.length === 0 && createDevice.value && createDevice.value.ip) {
        await getLocalPhoneModels(createDevice.value.ip)
      }
    } else if (val === 'backup') {
      if (!createForm.value.modelStatic) createForm.value.modelStatic = 'random'
      // 每次切换到备份机型都重新加载列表
      if (createDevice.value && createDevice.value.ip) {
        await fetchBackupModels(createDevice.value.ip)
      }
    }
  }

  const createDeviceFirmwareInfo = computed(() => {
    if (!createDevice.value) return null
    const cached = deviceFirmwareInfo.value.get(createDevice.value.id)
    if (cached) return cached
    if (createDevice.value.version === 'v3') {
      const info = v3DeviceInfo.value
      if (info?.originalData?.ip && info.originalData.ip === createDevice.value.ip) {
        return info
      }
    }
    return null
  })

  const createDeviceStorageInfo = computed(() => {
    const info = createDeviceFirmwareInfo.value
    const total = Number(info?.originalData?.mmctotal)
    const used = Number(info?.originalData?.mmcuse)
    if (!total || Number.isNaN(total) || Number.isNaN(used)) {
      return { text: '加载中...', isLow: false, remainingGb: null, remainingPercent: 0 }
    }
    const remainingMb = total - used
    const remainingGb = remainingMb / 1024
    const remainingPercent = Math.max(0, Math.min(100, (remainingMb / total) * 100))
    return {
      text: formatSize(remainingMb),
      isLow: remainingGb < 10,
      remainingGb,
      remainingPercent
    }
  })

  const createDeviceApiVersion = computed(() => {
    if (!createDevice.value) return '加载中...'
    const cached = deviceVersionInfo.value.get(createDevice.value.id)
    if (cached?.currentVersion !== undefined && cached?.currentVersion !== null) {
      return String(cached.currentVersion)
    }
    return '加载中...'
  })

  const createDeviceApiLatestVersion = computed(() => {
    if (!createDevice.value) return null
    const cached = deviceVersionInfo.value.get(createDevice.value.id)
    if (cached?.latestVersion !== undefined && cached?.latestVersion !== null) {
      return String(cached.latestVersion)
    }
    return null
  })

  const createDeviceApiVersionNumber = computed(() => {
    const version = createDeviceApiVersion.value
    if (!version || version === '加载中...') return null
    const value = parseFloat(version)
    return Number.isNaN(value) ? null : value
  })

  const createDeviceApiLatestVersionNumber = computed(() => {
    const version = createDeviceApiLatestVersion.value
    if (!version || version === '加载中...') return null
    const value = parseFloat(version)
    return Number.isNaN(value) ? null : value
  })

  const createDeviceApiNeedsUpgrade = computed(() => {
    const current = createDeviceApiVersionNumber.value
    const latest = createDeviceApiLatestVersionNumber.value
    if (current === null || latest === null) return false
    return current < latest
  })

  // 判断当前创建设备是否为公网设备（OpenCecs），公网设备 IP 格式为 publicIp:publicPort
  const isPublicNetworkDevice = computed(() => {
    return createDevice.value && createDevice.value.ip && createDevice.value.ip.includes(':')
  })

  // 判断当前活动设备是否为公网设备（用于更新镜像弹窗）
  const isActiveDevicePublic = computed(() => {
    return activeDevice.value && activeDevice.value.ip && activeDevice.value.ip.includes(':')
  })

  // 机型国家列表相关状态
  const countryList = ref([]) // 机型国家列表
  const countryListLoading = ref(false) // 机型国家列表加载状态
  const vpcGroupList = ref([]) // 网络分组列表
  const vpcNodeList = ref([]) // 网络节点列表
  const networkCardList = ref([]) // 网卡列表
  const fetchingNetworkCards = ref(false) // 网卡列表加载状态
  const hasMacVlan = ref(false) // 是否存在macVlan配置
  const currentDeviceMacVlanInfo = ref({ subnet: '', gw: '' }) // 当前设备的MacVlan子网和网关信息

  // 镜像筛选条件
  const imageFilters = reactive({
    name: '',
    url: '',
    includeCompatible: false // 是否包含兼容镜像
  })

  // 计算属性：根据筛选条件过滤后的镜像列表
  const isPSeries = computed(() => {
    if (!createDevice.value || !createDevice.value.id) return false
    return createDevice.value.id.toLowerCase().startsWith('p')
  })

  const filteredContainerImages = computed(() => {
    const images = imageList.value
    const version = createForm.value.containerAndroidVersion

    if (!images || images.length === 0) return []

    return images.filter(img => {
      // 检查 Android 版本 (os_ver)
      // 例如: version='10' -> target='and10'
      if (img.sys_ver == 5) {
        return false
      }

      const targetVer = `and${version}`
      if (img.os_ver !== targetVer) {
        return false
      }

      // 确定用于过滤的设备名称
      let targetDeviceName = ''
      if (createDevice.value) {
          targetDeviceName = createDevice.value.name
      } else if (createMode.value === 'multi-device-batch') {
          if (selectedBatchDevices.value.length > 0) {
             const firstDevice = devices.value.find(d => selectedBatchDevices.value.includes(d.ip))
             if (firstDevice) {
               targetDeviceName = firstDevice.name
             }
          }

          if (!targetDeviceName) {
             // 批量模式下根据筛选器判断
             if (batchDeviceTypeFilter.value === 'p_series') {
                 targetDeviceName = 'P1'
             } else {
                 targetDeviceName = 'C1' // 其他系列默认为C1，根据实际情况调整
             }
          }
      } else {
          return false
      }

      // 参考 filteredImageList 的过滤逻辑，使用 getCompatibleTypes
      const compatibleTypes = getCompatibleTypes(targetDeviceName)

      if (img.ttype && compatibleTypes.includes(img.ttype)) {
        return true
      }

      if (Array.isArray(img.ttype2)) {
        for (const t of img.ttype2) {
          if (compatibleTypes.includes(t)) {
            return true
          }
        }
      }

      return false
    })
  })

  const filteredContainerImagesForUpdate = computed(() => {
    console.log('filteredContainerImagesForUpdate', createDevice.value)
    const images = imageList.value
    if (!images || images.length === 0) return []

    if (!updateImageContainer.value || !updateImageContainer.value.image) return images

    // 找到当前镜像对应的 os_ver
    const currentImageUrl = updateImageContainer.value.image
    const currentImage = images.find(img => img.url === currentImageUrl)

    // 如果找不到当前镜像的信息，返回所有镜像 (或者根据需求处理)
    if (!currentImage || !currentImage.os_ver) {
        return images
    }

    const targetVer = currentImage.os_ver

    return images.filter(img => {
      // 检查 Android 版本 (os_ver)
      if (img.os_ver !== targetVer) {
        return false
      }

      if (img.sys_ver == 5) {
        return false
      }

      // 如果是 P 系列设备，要求 ttype2 包含 'p1_v2'
      const isP1V2 = Array.isArray(img.ttype2) && img.ttype2.includes(createDevice.value.name)
      return isP1V2
      // if (isPSeries.value) {
      //   return isP1V2
      // } else {
      //   return !isP1V2
      // }
    })
  })

  // 监听 filteredContainerImages 变化，自动选中第一条
  // V3 更新镜像：在 filteredImageList（已按设备类型过滤）基础上，额外按当前容器的 os_ver 过滤
  const filteredImageListForUpdate = computed(() => {
    const images = filteredImageList.value
    if (!images || images.length === 0) return []

    if (!updateImageContainer.value || !updateImageContainer.value.image) return images

    // 从完整镜像列表中查找当前容器镜像的 os_ver
    const currentImageUrl = updateImageContainer.value.image
    const currentImage = imageList.value.find(img => img.url === currentImageUrl)

    // 如果找不到当前镜像或没有 os_ver 信息，返回原列表
    if (!currentImage || !currentImage.os_ver) {
      return images
    }

    const targetVer = currentImage.os_ver
    return images.filter(img => img.os_ver === targetVer)
  })

  // 根据选择的安卓版本过滤在线镜像列表（用于模拟器创建）
  // 在线镜像分类中排除特质版镜像（特质版仅在"特质镜像"分类显示）
  const androidVersionFilteredImageList = computed(() => {
    const images = filteredImageList.value
    if (!images || images.length === 0) return []
    const ver = createForm.value.androidVersion
    const osVer = `and${ver}`
    return images.filter(img => img.os_ver === osVer && img.sys_ver_des !== '特质版')
  })

  // 特质镜像列表
  const specialImageList = computed(() => {
    const images = filteredImageList.value
    if (!images || images.length === 0) return []
    const ver = createForm.value.androidVersion
    const osVer = `and${ver}`
    return images.filter(img => img.os_ver === osVer && img.sys_ver_des === '特质版')
  })

  // 当前镜像分类对应的镜像列表
  const currentCategoryImageList = computed(() => {
    return createForm.value.imageCategory === 'special'
      ? specialImageList.value
      : androidVersionFilteredImageList.value
  })

  // 根据选择的安卓版本过滤在线机型列表
  const androidVersionFilteredPhoneModels = computed(() => {
    const models = phoneModels.value
    if (!models || models.length === 0) return []
    const ver = createForm.value.androidVersion
    if (!ver) return models
    return models.filter(m => {
      if (!m.android_version) return false // 无版本字段的机型在按版本过滤时排除，避免混入非目标版本
      return String(m.android_version) === String(ver)
    })
  })

  // 监听安卓版本变化，自动选中第一条镜像
  watch(() => createForm.value.androidVersion, () => {
    if (createForm.value.createType !== 'container' && createForm.value.imageCategory === 'online') {
      const filtered = androidVersionFilteredImageList.value
      if (filtered && filtered.length > 0) {
        createForm.value.imageSelect = filtered[0].url
      } else {
        createForm.value.imageSelect = ''
      }
    }
    // 特质镜像：切换安卓版本时重新选中第一条镜像
    if (createForm.value.createType !== 'container' && createForm.value.imageCategory === 'special') {
      const filtered = specialImageList.value
      if (filtered && filtered.length > 0) {
        createForm.value.imageSelect = filtered[0].url
      } else {
        createForm.value.imageSelect = ''
      }
    }
    // 特质镜像 + 安卓15 + 在线机型 时绑定 Samsung_S24
    if (isSpecialModelLocked.value) {
      createForm.value.modelName = 'Samsung_S24'
    } else if (createForm.value.imageCategory === 'special' && createForm.value.modelName === 'Samsung_S24') {
      createForm.value.modelName = 'random'
    }
  })

  watch(filteredContainerImages, (newVal) => {
    if (createForm.value.createType === 'container') {
      if (newVal && newVal.length > 0) {
        createForm.value.containerImageSelect = newVal[0].url
      } else {
        createForm.value.containerImageSelect = ''
      }
    }
  }, { immediate: true })

  // 监听 createType 变化，切换到容器模式时自动选中第一条
  watch(() => createForm.value.createType, (newVal) => {
    if (newVal === 'container') {
      const images = filteredContainerImages.value
      if (images && images.length > 0) {
        createForm.value.containerImageSelect = images[0].url
      } else {
        createForm.value.containerImageSelect = ''
      }
    }
  })

  const filteredImageListWithFilters = computed(() => {
    let result = [...filteredImageList.value]

    // 根据名称筛选
    if (imageFilters.name) {
      const nameFilter = imageFilters.name.toLowerCase()
      result = result.filter(image => image.name.toLowerCase().includes(nameFilter))
    }

    // 根据URL筛选
    if (imageFilters.url) {
      const urlFilter = imageFilters.url.toLowerCase()
      result = result.filter(image => image.url.toLowerCase().includes(urlFilter))
    }

    // 根据当前选择的设备型号筛选
    if (activeDevice.value) {
      const currentDeviceType = activeDevice.value.name || 'C1'
      if (imageFilters.includeCompatible) {
        // 包含兼容镜像：筛选ttype等于当前型号或ttype2中包含当前型号的镜像
        result = result.filter(image => {
          return image.ttype === currentDeviceType || 
                 (Array.isArray(image.ttype2) && image.ttype2.includes(currentDeviceType))
        })
      } else {
        // 不包含兼容镜像：只筛选ttype等于当前型号的镜像
        result = result.filter(image => image.ttype === currentDeviceType)
      }
    }

    return result
  })

  // 计算属性：从镜像列表中提取可用的设备型号
  const availableModels = computed(() => {
    const models = new Set()
    imageList.value.forEach(image => {
      if (image.ttype) {
        models.add(image.ttype)
      }
      if (Array.isArray(image.ttype2)) {
        image.ttype2.forEach(ttype => {
          models.add(ttype)
        })
      }
    })
    return Array.from(models).sort()
  })

  // 计算属性：将设备中已下载的镜像与线上镜像列表对应起来
  const matchedBoxImages = computed(() => {
    return boxImages.value.map(boxImage => {
      // 遍历在线镜像列表，查找匹配的镜像
      for (const image of imageList.value) {
        // 从在线镜像URL中提取镜像名称（去掉registry部分）
        let onlineImageName = image.url
        if (onlineImageName.includes('/')) {
          const parts = onlineImageName.split('/')
          onlineImageName = parts.slice(1).join('/')
        }

        // 检查盒子镜像名称是否包含在线镜像名称的关键部分
        if (boxImage.name.includes(onlineImageName) || 
            boxImage.name.includes(onlineImageName.replace(':', '_')) ||
            boxImage.name.includes(onlineImageName.split('/').pop())) {
          // 找到匹配的在线镜像，返回合并后的镜像信息
          return {
            ...boxImage,
            onlineImageName: image.name, // 使用在线镜像列表中的名称
            onlineImageUrl: image.url,   // 保存在线镜像的完整URL
            matched: true
          }
        }
      }

      // 没有找到匹配的在线镜像，返回原始镜像信息
      return {
        ...boxImage,
        onlineImageName: boxImage.name, // 使用设备中镜像的名称
        onlineImageUrl: boxImage.url,   // 使用设备中镜像的URL
        matched: false
      }
    })
  })

  return {
    createDialogVisible,
    createDevice,
    createMode,
    selectedBatchDevices,
    batchDeviceTypeFilter,
    filteredBatchDevices,
    isPSeriesOrBatchP,
    filteredLocalCachedImages,
    showV3Options,
    currentSlot,
    createLoading,
    createCancelled,
    sdkLoadingVisible,
    sdkLoadingMessage,
    sdkLoadingProgress,
    createForm,
    handleModelTypeChange,
    createDeviceFirmwareInfo,
    createDeviceStorageInfo,
    createDeviceApiVersion,
    createDeviceApiLatestVersion,
    createDeviceApiVersionNumber,
    createDeviceApiLatestVersionNumber,
    createDeviceApiNeedsUpgrade,
    isPublicNetworkDevice,
    isActiveDevicePublic,
    countryList,
    countryListLoading,
    vpcGroupList,
    vpcNodeList,
    networkCardList,
    fetchingNetworkCards,
    hasMacVlan,
    currentDeviceMacVlanInfo,
    imageFilters,
    isPSeries,
    filteredContainerImages,
    filteredContainerImagesForUpdate,
    filteredImageListForUpdate,
    androidVersionFilteredImageList,
    specialImageList,
    currentCategoryImageList,
    androidVersionFilteredPhoneModels,
    filteredImageListWithFilters,
    availableModels,
    matchedBoxImages,
  }
}
