/**
 * 各类弹窗的表单状态 + 设备状态缓存：
 *   - 批量上传、设置推流（streamType / streamFilePath / rtmpUrl / setStreamLoading）
 *   - 设备密码弹窗、单设备认证弹窗、批量认证弹窗、同步授权弹窗
 *   - 注册 / 忘记密码弹窗（含验证码倒计时、错误提示）
 *   - token / uname、syncAuthTimer、批量认证收集定时器
 *   - 设备过滤与状态缓存：deviceFilter / devicesLastUpdateTime / devicesStatusCache /
 *     deviceVersionInfo / deviceFirmwareInfo / androidCacheVersions
 *   - 内部调用 useDeviceListState，把设备列表 / 镜像 / 分组状态一并接入并原样透出
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue，通过依赖对象传入；getImageListFromLocal / fetchImageList /
 * switchImageCategory / fetchV3DeviceInfo / initCloudMachineGroups 在 App.vue 下方才声明，
 * 用惰性依赖避免 TDZ。
 */
import { ref, computed } from 'vue'
import { useDeviceListState } from './useDeviceListState.js'

export function useDialogForms({
  activeDevice,
  devices,
  deviceCloudMachinesCache,
}, lazyDeps = {}) {
  // 以下依赖来自 App.vue 下方才声明的函数，用惰性依赖避免 TDZ
  const {
    getImageListFromLocal,
    fetchImageList,
    switchImageCategory,
    fetchV3DeviceInfo,
    initCloudMachineGroups,
  } = lazyDeps

  const batchUploadDialogVisible = ref(false) // 批量上传对话框可见性
  const batchUploadSelectedMachines = ref([]) // 批量上传选中的云机

  // 设置推流弹窗相关
  const setStreamDialogVisible = ref(false) // 设置推流弹窗可见性
  const streamType = ref('') // 流类型：image-图片, video-视频, app-APP, rtmp-RTMP
  const streamFilePath = ref('') // 选择文件或文件夹的路径
  const rtmpUrl = ref('') // RTMP推流地址
  const setStreamLoading = ref(false) // 设置推流加载状态

  const fetchingImages = ref(false) // 是否正在获取镜像列表
  // 设备密码管理
  const passwordDialogVisible = ref(false)
  const passwordForm = ref({
    password: ''
  })
  const passwordLoading = ref(false)

  // 认证对话框
  const authDialogVisible = ref(false)
  const authForm = ref({
    password: '',
    savePassword: true
  })

  // 批量认证管理 - 收集所有需要认证的设备，一次性弹出多个输入框
  const batchAuthDevices = ref([]) // 待批量认证的设备列表：[{device, callback, password: ''}]
  const authCancelledDevices = ref(new Set()) // 用户取消认证的设备IP集合，心跳不再弹窗
  const batchAuthDialogVisible = ref(false) // 批量认证对话框

  // 授权同步对话框
  const syncAuthDialogVisible = ref(false)
  const syncAuthForm = ref({
    username: '',
    password: '',
    saveCredentials: false
  })
  const syncAuthLoading = ref(false)
  const token = ref(localStorage.getItem('token') || null)
  const uname = ref(localStorage.getItem('uname') || null)

  // 注册对话框
  const registerDialogVisible = ref(false)
  const registerForm = ref({
    phone: '',
    password: '',
    confirmPassword: '',
    vcode: '',
    vkey: '' // 从获取验证码接口返回的vkey
  })
  const registerLoading = ref(false)
  const sendVcodeLoading = ref(false)
  const vcodeCountdown = ref(0)
  const vcodeTimer = ref(null)

  // 忘记密码对话框
  const forgotPasswordDialogVisible = ref(false)
  const forgotPasswordForm = ref({
    phone: '',
    newPassword: '',
    confirmPassword: '',
    vcode: '',
    vkey: ''
  })
  const forgotPasswordErrors = ref({ phone: '', newPassword: '', confirmPassword: '' })
  const forgotPasswordLoading = ref(false)
  const fpVcodeLoading = ref(false)
  const fpVcodeCountdown = ref(0)
  const fpVcodeTimer = ref(null)

  const authLoading = ref(false)
  const authDevice = ref(null)
  const authCallback = ref(null)
  // 批量认证加载状态
  const batchAuthLoading = ref(false)
  const batchAuthCollectTimeout = ref(null) // 收集设备的延迟定时器
  // 推流设置Loading
  // const setStreamLoading = ref(false)
  // 同步授权定时器
  const syncAuthTimer = ref(null)
  const androidCacheVersions = ref({})  // 本地版本号快照 {ip: version}
  // 设备状态过滤
  const deviceFilter = ref('online') // online: 在线设备, offline: 离线设备
  const devicesLastUpdateTime = ref(new Map()) // 记录每个设备最后更新时间，键为设备ID，值为时间戳
  const devicesStatusCache = ref(new Map()) // 记录每个设备状态，键为设备ID，值为online/offline
  // 设备版本信息
  const deviceVersionInfo = ref(new Map()) // 记录每个设备的版本信息，键为设备ID，值为{currentVersion, latestVersion}
  // 设备固件信息
  const deviceFirmwareInfo = ref(new Map()) // 记录每个设备的固件信息，键为设备ID，值为{sdkVersion, deviceModel, originalData}
  // 设备列表 / 镜像 / 分组状态（阶段 3 迁出到 composables/useDeviceListState.js）
  const {
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
  } = useDeviceListState({
    activeDevice,
    devices,
    deviceCloudMachinesCache,
    deviceFilter,
    devicesLastUpdateTime,
    devicesStatusCache,
    deviceVersionInfo,
    deviceFirmwareInfo,
  }, {
    // 以下依赖在下方才声明，用惰性依赖避免 TDZ
    getImageListFromLocal: (...a) => getImageListFromLocal(...a),
    fetchImageList: (...a) => fetchImageList(...a),
    switchImageCategory: (...a) => switchImageCategory(...a),
    fetchV3DeviceInfo: (...a) => fetchV3DeviceInfo(...a),
    initCloudMachineGroups: (...a) => initCloudMachineGroups(...a),
  })

  // 扩展服务设备列表（在线 + 过滤P类型设备）
  const extensionServiceDevices = computed(() => {
    return filteredDevicesByGroup.value
  })

  return {
    batchUploadDialogVisible,
    batchUploadSelectedMachines,
    setStreamDialogVisible,
    streamType,
    streamFilePath,
    rtmpUrl,
    setStreamLoading,
    fetchingImages,
    passwordDialogVisible,
    passwordForm,
    passwordLoading,
    authDialogVisible,
    authForm,
    batchAuthDevices,
    authCancelledDevices,
    batchAuthDialogVisible,
    syncAuthDialogVisible,
    syncAuthForm,
    syncAuthLoading,
    token,
    uname,
    registerDialogVisible,
    registerForm,
    registerLoading,
    sendVcodeLoading,
    vcodeCountdown,
    vcodeTimer,
    forgotPasswordDialogVisible,
    forgotPasswordForm,
    forgotPasswordErrors,
    forgotPasswordLoading,
    fpVcodeLoading,
    fpVcodeCountdown,
    fpVcodeTimer,
    authLoading,
    authDevice,
    authCallback,
    batchAuthLoading,
    batchAuthCollectTimeout,
    syncAuthTimer,
    androidCacheVersions,
    deviceFilter,
    devicesLastUpdateTime,
    devicesStatusCache,
    deviceVersionInfo,
    deviceFirmwareInfo,
    extensionServiceDevices,
    // 以下名字由内部 useDeviceListState 解构而来，原样透出
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
