<script setup>



import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, reactive, getCurrentInstance } from 'vue'
import axios from 'axios'
import { More, Plus, Loading, Warning, Refresh, Download, Delete, Close, Switch, Upload, QuestionFilled, List, Timer, InfoFilled, ArrowRight, ArrowDown, Back, FolderOpened, Document, CircleCheck, CircleClose, Setting, BellFilled, WarningFilled, Rank, Connection } from '@element-plus/icons-vue'
import { Events } from '@wailsio/runtime'
// 导入模型管理组件
import ModelManagement from './components/modelManagement.vue'
import InstanceManagement from './components/instanceManagement.vue'
import NetworkManagement from './components/networkmanagement.vue'
import BackupManagement from './components/backupManagement.vue'
import AiAssistant from './components/aiAssistant.vue'  // 【使用新的完整版本：设备选择+模型管理+流式优化】
import RpaAgent from './components/rpaAgent.vue'
import CustomerService from './components/customerService.vue'
import OpencecsManagement from './components/opencecsManagement.vue'
import ExtensionService from './components/ExtensionService.vue'



// 导入 xterm.js 及其相关依赖
import 'xterm/css/xterm.css'
// 导入Element Plus消息组件
import { ElMessage, ElMessageBox } from 'element-plus'
// 导入云机管理公共函数
import { handleDeleteContainer, handleBatchDeleteContainers, setDependencies } from './services/cloudMachineFunctions.js'
// 导入API服务
import {
  discoverDevices, 
  getContainers, 
  startContainer, 
  stopContainer, 
  deleteContainer, 
  createContainer,
  containersMemoryCache,

  startProjection,
  startBatchProjection,
  startProjectionBatchControl,
  stopProjectionBatchControl,
  getDockerNetworks,
  createDockerNetwork,
  deleteDockerNetwork,
  updateDockerNetwork,
  createV0V2Device,
  pullDockerImage,
  getImagePullProgress,
  setDevicePassword,
  closeDevicePassword,
  getDevicePassword,
  saveDevicePassword,
  removeDevicePassword,
  switchPhoneModel,
  resetAndroidContainer,
  restartAndroidContainer,
  CloseProjectionWindow,
  getDeviceVersionInfo,
  upgradeDevice,
  deleteLocalImage,
  getDeviceAllCloudMachines,
  renameAndroidContainer,
  setMacVlanIp,
  setDeviceGPS,
  getAnnouncement,
  getAndroidCacheVersions,
  getAndroidContainersList,
  triggerAndroidRefresh,
  getScreenshotVersions,
  getScreenshots,
  clearScreenshotCache
} from './services/api.js'
// 导入设备心跳检测服务
import { 
  updateMonitoredDevices, 
  startDeviceHeartbeat, 
  getDevicesStatus 
} from './services/deviceHeartbeat.js'
import { countryMap, getCountryEnglishName } from './countryData.js'

import CryptoJS from 'crypto-js';
import QRCode from 'qrcode'


// 导入V3 bindings
import {
  GetLocalImages,
  GetImages,
  DownloadImage,
  CancelImageDownload,
  CancelImageUpload,
  IsImageDownloaded,
  LoadImageToDevice,
  DeleteLocalImage,
  UpgradeDeviceWithNewAPI,
  GetUserDataDir,
  HttpRequest,
  ListSharedDirFiles,
  InstallAPK,
  InstallAPKs,
  UploadFileToCloudMachine,
  UploadFileToSharedDir,
  OpenSharedDirectory,
  OpenLocalImageDirectory,
  SelectImageFile,
  SelectVideoFile,
  SyncAuthorization,
  ToggleProjectionWindowTop,
  ArrangeProjectionWindows,
  UpdateMonitoredDevices,
  StartDeviceHeartbeat,
  GetDevicesStatus,
  ResetAllDevicesOffline,
  ForceRefreshDeviceInfo,
  UpdateDevicePasswords,
  GetMirrorList,
  GetPhoneVCode,
  DeviceShake,
  GetUserRabbetList,
  Register,
  ReconnectDeviceEventWS,
  UploadGoogleCert,
  GetStoragePath,
  SetStoragePath,
  SelectDirectory,
  GetSharedDirPath,
  SetSharedDirPath,
  ListLocalDirFiles,
  DownloadCloudFile,
  SelectApkFile,
  SelectZipFile,
} from '../bindings/edgeclient/app'

// 导入主机管理组件
import HostManagement from './components/HostManagement.vue'
import StreamManagement from './components/StreamManagement.vue'
import BatchTaskManagement from './components/BatchTaskManagement.vue'
import InterconnectedCloudMachines from './components/InterconnectedCloudMachines.vue'

// 导入更新相关组件
import UpdateMenu from './components/UpdateMenu.vue'
import UpdateDialog from './components/UpdateDialog.vue'

import { useUpdateService } from './services/updateService.js'

const { state: updateState, checkForUpdate: checkForUpdates, getVersionInfo: getUpdateVersionInfo } = useUpdateService()

// 使用自定义国际化 - 不依赖 vue-i18n
const { proxy } = getCurrentInstance()

// 初始化语言设置
try {
  const savedLocale = localStorage.getItem('app-locale')
  if (savedLocale) {
    console.log('Loading saved locale:', savedLocale)
    proxy.$i18n.setLocale(savedLocale)
  } else {
    // 如果没有保存的语言，检测浏览器语言
    const browserLang = navigator.language || navigator.userLanguage
    const defaultLocale = browserLang && browserLang.startsWith('en') ? 'en-US' : 'zh-CN'
    console.log('Setting default locale:', defaultLocale, 'from browser:', browserLang)
    proxy.$i18n.setLocale(defaultLocale)
  }
} catch (e) {
  console.warn('Cannot load saved locale:', e)
}

// 响应式翻译函数 - 确保语言切换时重新计算
const t = (key, params) => {
  // 通过访问 proxy.$i18n.locale 建立响应式依赖
  const _ = proxy.$i18n.locale
  let text = proxy.$i18n.t(key)
  if (params) {
    Object.keys(params).forEach(param => {
      text = text.replace(`{${param}}`, params[param])
    })
  }
  return text
}

// 响应式数据
const devices = ref([])
const activeDevice = ref(null)
const instances = ref([]) // 当前选中设备的容器列表，每个坑位只显示一个容器，优先显示running状态
const allInstances = ref([]) // 当前选中设备的所有容器，用于备份切换
const cloudMachines = ref([]) // 当前选中设备的云机列表
const deviceCloudMachinesCache = ref(new Map()) // 设备云机缓存，存储每个设备的云机列表，键为设备IP
const deviceAllInstancesCache = ref(new Map()) // 设备全量容器缓存（含备份），用于批量模式切换云机
const cloudManageMode = ref('slot') // slot: 坑位模式, batch: 批量模式
const cloudMachineGroups = ref([]) // 云机分组数据
const selectedCloudDevice = ref(null) // 当前选中的云机设备
const selectedCloudMachines = ref([]) // 选中的云机ID数组

// 更新相关状态
const updateDialogVisible = ref(false) // 更新提示弹窗可见性
const updateInfo = ref(null) // 更新信息

const layoutMode = ref('grid')
const loading = ref(false)
const backupLoading = ref(false) // 切换云机时的加载状态
const activeTab = ref('host-management')
// 批量投屏控制状态管理
// 批量模式：使用单独的 ref
const batchModeProjectionControlling = ref(false)
// 坑位模式：按设备IP记录
const slotModeProjectionControlStatus = ref({})
// 计算当前上下文的批量控制状态
const isBatchProjectionControlling = computed(() => {
  if (cloudManageMode.value === 'batch') {
    // 批量模式：使用全局状态
    return batchModeProjectionControlling.value
  } else {
    // 坑位模式：按设备IP
    const deviceIp = selectedCloudDevice.value?.ip
    return deviceIp ? (slotModeProjectionControlStatus.value[deviceIp] || false) : false
  }
})


// 导入CloudManagement组件
import CloudManagement from './components/CloudManagement.vue'

// 导入批量上传对话框组件
import BatchUploadDialog from './components/BatchUploadDialog.vue'

// 导入语言切换组件
import LanguageSwitcher from './components/LanguageSwitcher.vue'

// 纯工具函数（阶段 2 从本文件迁出，见 src/utils/）
import { getDeviceAddr, FORBIDDEN_ADB_PORTS, getInstanceAdbPort, extractPort, extractPort9082, getSDKPort, getPortMappings, getDeviceTypeName, getDeviceTypeColor, parseContainerSlot } from './utils/device.js'
import { formatSize, calculateIpRange, extractNodeDisplayName, naturalSortKey, extractShortName, arrayBufferToBase64, generateTaskId, formatInstanceName, formatInstanceModel } from './utils/format.js'
import { getDeviceProgress, getDeviceProgressStatus, getDeviceProgressText, getTaskTargetDisplay } from './utils/taskDisplay.js'
import { toggleNodeExpanded, collectSharedFilePaths } from './utils/fileTree.js'
import { copyToClipboard } from './utils/clipboard.js'
import { useTheme } from './composables/useTheme.js'
import { useScreenshotCache } from './composables/useScreenshotCache.js'
import { useDeviceGroups } from './composables/useDeviceGroups.js'
import { useBindCheckQueue } from './composables/useBindCheckQueue.js'
import { useVersionCheckQueue } from './composables/useVersionCheckQueue.js'
import { useAuthForms } from './composables/useAuthForms.js'
import { useTaskQueue } from './composables/useTaskQueue.js'
import { useCloudMachineUpdate } from './composables/useCloudMachineUpdate.js'
import { useCloudMachineCreate } from './composables/useCloudMachineCreate.js'
import { useContainerActions } from './composables/useContainerActions.js'
import { useCloudMachineManage } from './composables/useCloudMachineManage.js'
import { useModelSlots } from './composables/useModelSlots.js'
import { useFileManager } from './composables/useFileManager.js'
import { useDeviceOperations } from './composables/useDeviceOperations.js'
import { useContextMenu } from './composables/useContextMenu.js'
import { useCreateDialog } from './composables/useCreateDialog.js'
import { useDeviceListState } from './composables/useDeviceListState.js'
import { useBatchSwitchModel } from './composables/useBatchSwitchModel.js'
import { useDeviceVersionInfo } from './composables/useDeviceVersionInfo.js'
import { useDialogState } from './composables/useDialogState.js'
import { useDeviceHeartbeat } from './composables/useDeviceHeartbeat.js'
import { useHostTasks } from './composables/useHostTasks.js'
import { useBackupOperations } from './composables/useBackupOperations.js'

// 任务队列状态管理
const taskQueue = ref([])
const runningTasksCount = computed(() => {
  return taskQueue.value.filter(task => task.status === 'running').length
})

// ===== 设置弹窗 =====
const settingsDialogVisible = ref(false)
const storagePathInfo = ref({ path: '', isDefault: true, defaultPath: '' })
const settingsLoading = ref(false)
// 主题模式 + APK 自动授权开关（阶段 3 迁出到 composables/useTheme.js）
const {
  isDarkTheme,
  autoGrantApkPermission,
  applyThemeMode,
  fixDarkBackgrounds,
  clearDarkOverrides,
  startDarkObserver,
  stopDarkObserver,
  toggleThemeMode,
  cleanupThemeResidue,
} = useTheme()

const openSettingsDialog = async () => {
  settingsDialogVisible.value = true
  try {
    const result = await GetStoragePath()
    if (result && result.success !== false) {
      storagePathInfo.value = {
        path: result.path || '',
        isDefault: result.isDefault !== false,
        defaultPath: result.defaultPath || result.path || ''
      }
    }
  } catch (e) {
    console.error('获取保存路径失败', e)
  }
}

const handleSelectDirectory = async () => {
  settingsLoading.value = true
  try {
    const result = await SelectDirectory('')
    if (result && result.success && result.path) {
      storagePathInfo.value.path = result.path
      storagePathInfo.value.isDefault = false
    } else if (result && !result.success && result.message !== '用户取消选择') {
      ElMessage.error(result.message || '选择目录失败')
    }
  } catch (e) {
    ElMessage.error('选择目录失败: ' + e.message)
  } finally {
    settingsLoading.value = false
  }
}

const handleSaveSettings = async () => {
  // 保存APK自动授权设置到 localStorage
  localStorage.setItem('autoGrantApkPermission', autoGrantApkPermission.value ? 'true' : 'false')

  settingsLoading.value = true
  try {
    const result = await SetStoragePath(storagePathInfo.value.path)
    if (result && result.success) {
      ElMessage.success('保存路径设置成功')
      // 刷新路径信息
      const info = await GetStoragePath()
      if (info) {
        storagePathInfo.value = {
          path: info.path || '',
          isDefault: info.isDefault !== false,
          defaultPath: info.defaultPath || info.path || ''
        }
      }
      settingsDialogVisible.value = false

      // 自动刷新镜像、机型、备份页面数据
      fetchLocalCachedImages()
      checkAllImagesDownloadStatus()
      if (modelManagementRef.value) {
        modelManagementRef.value.fetchLocalModels()
        modelManagementRef.value.checkNeedShowButtons()
      }
      if (backupManagementRef.value) {
        backupManagementRef.value.fetchBackups()
      }
    } else {
      ElMessage.error(result?.message || '保存失败')
    }
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  } finally {
    settingsLoading.value = false
  }
}

const handleResetStoragePath = async () => {
  settingsLoading.value = true
  try {
    const result = await SetStoragePath('')
    if (result && result.success) {
      ElMessage.success('已恢复默认路径')
      storagePathInfo.value = {
        path: result.path || storagePathInfo.value.defaultPath,
        isDefault: true,
        defaultPath: storagePathInfo.value.defaultPath
      }

      // 自动刷新镜像、机型、备份页面数据
      fetchLocalCachedImages()
      checkAllImagesDownloadStatus()
      if (modelManagementRef.value) {
        modelManagementRef.value.fetchLocalModels()
        modelManagementRef.value.checkNeedShowButtons()
      }
      if (backupManagementRef.value) {
        backupManagementRef.value.fetchBackups()
      }
    } else {
      ElMessage.error(result?.message || '恢复默认失败')
    }
  } catch (e) {
    ElMessage.error('恢复默认失败: ' + e.message)
  } finally {
    settingsLoading.value = false
  }
}
// ===== 设置弹窗 END =====

// 组件引用 / 弹窗状态 / 重命名 / 公告（阶段 3 迁出到 composables/useDialogState.js）
const {
  modelManagementRef,
  instanceManagementRef,
  networkManagementRef,
  backupManagementRef,
  aiAssistantRef,
  rpaAgentRef,
  opencecsManagementRef,
  customerServiceRef,
  customerServiceUnreadCount,
  handleUnreadCountChange,
  tempModelName,
  tempModelId,
  switchModelType,
  switchCountryCode,
  switchModelDialogVisible,
  currentSwitchContainer,
  switchingModel,
  contextMenuVisible,
  contextMenuPosition,
  contextMenuRef,
  contextMenuSlot,
  apiDetailsVisible,
  apiDetailsData,
  ipTestVisible,
  testIp,
  s5ProxyDialogVisible,
  s5ProxyForm,
  s5ProxyLoading,
  vpcProxyList,
  renameDialogVisible,
  renameForm,
  renameLoading,
  announcementVisible,
  announcementData,
  announcementTimer,
  countdownTimer,
  countdown,
  handleRename,
  submitRename,
  fetchAnnouncement,
  closeAnnouncement,
} = useDialogState({
  instances,
  cloudManageMode,
  activeDevice,
  selectedCloudDevice,
  selectedCloudMachines,
}, {
  // 以下依赖在下方才声明，用惰性依赖避免 TDZ
  getContextMenuContainer: () => contextMenuContainer,
  initCloudMachineGroups: (...a) => initCloudMachineGroups(...a),
})


// 设置摇一摇
const handleShake = async () => {
  const container = getCurrentContextMenuContainer()
  if (!container) return

  let targetIP = container.networkName === 'myt' ? container.ip : container.deviceIp
  // OpenCecs 公网设备：deviceIp 含端口（如 1.2.3.4:16039），提取纯 IP
  if (targetIP && targetIP.includes(':')) targetIP = targetIP.split(':')[0]
  let port = extractPort9082(container) || 9082
  
  // 判断是否为V3设备
  // if (container.androidType === 'V3') {
  //   port = extractPort9082(container) || 9082
  //   targetIP = container.deviceIp 
  // } else {
  //   // V2设备尝试使用10008端口
  //   const isDirectNet = container.networkName === 'myt'
    
  //   if (isDirectNet) {
  //     targetIP = container.ip
  //     port = extractPort9082(container) || 9082
  //   }
  // }


  try {
    const password = getDevicePassword(targetIP) || ''
    await DeviceShake(targetIP, Number(port), password)
    ElMessage.success('已发送摇一摇指令')
  } catch (error) {
    console.error('摇一摇失败:', error)
    ElMessage.error(`摇一摇失败: ${error}`)
  }
  closeContextMenu()
}


const gpsDialogVisible = ref(false)
const gpsForm = ref({
  ip: '',
  country: ''
})
const gpsLoading = ref(false)
const gpsContainer = ref(null)

// 设置IP定位
const handleGPS = async () => { 
  const container = getCurrentContextMenuContainer()
  if (!container) return
  
  gpsContainer.value = container
  gpsForm.value.ip = ''
  gpsForm.value.country = ''
  gpsDialogVisible.value = true
  closeContextMenu()
}

const submitGPS = async () => {
  if (!gpsForm.value.country) {
    ElMessage.warning('请选择国家')
    return
  }

  const container = gpsContainer.value
  if (!container) return

  gpsLoading.value = true
  try {
    // 确定目标IP
    // const targetIP = (container.networkName === 'myt' || container.networkMode === 'myt' || container.network === 'myt') && container.ip 
    //   ? container.ip 
    //   : (container.deviceIp || container.ip)

    // // 确定端口
    // let internalPort = extractPort9082(container) || 9082
    // // 检查是否为V3
    // if (container.androidType === 'V3' || container.version === 'v3' || (activeDevice.value && activeDevice.value.version === 'v3')) {
    //     internalPort = extractPort9082(container) || 9082
    // }
    
    // let finalPort = internalPort
    // // 如果不是直连网络，尝试获取映射端口
    // if (!(container.networkName === 'myt' && container.ip)) {
    //     finalPort = extractPort(container, internalPort) || internalPort
    // }

    let targetIP = container.networkName === 'myt' ? container.ip : container.deviceIp;
    // OpenCecs 公网设备：deviceIp 含端口，提取纯 IP
    if (targetIP && targetIP.includes(':')) targetIP = targetIP.split(':')[0]
    let finalPort = extractPort9082(container) || 9082
    
    // 优先使用用户输入的IP，如果为空则使用容器IP
    const currentDeviceIP = gpsForm.value.ip || ''
    
    const countryInfo = countryMap[gpsForm.value.country]
    const lang = countryInfo ? countryInfo.lang : 'en'
    
    // 调用后端API
    await setDeviceGPS(targetIP, finalPort, currentDeviceIP, lang)
    
    ElMessage.success('设置定位指令已发送')
    gpsDialogVisible.value = false

  } catch (error) {
    console.error('设置定位失败:', error)
    ElMessage.error('设置定位失败: ' + (error.message || error))
  } finally {
    gpsLoading.value = false
  }
}

// ===== 上传 Google 证书 =====
const googleCertDialogVisible = ref(false)
const googleCertContainer = ref(null)
const googleCertFile = ref(null)       // File 对象
const googleCertFileName = ref('')     // 显示用文件名
const googleCertLoading = ref(false)
const googleCertInputRef = ref(null)   // 隐藏的 input[file] ref

const handleUploadGoogleCert = () => {
  const container = getCurrentContextMenuContainer()
  if (!container) return
  googleCertContainer.value = container
  googleCertFile.value = null
  googleCertFileName.value = ''
  googleCertDialogVisible.value = true
  closeContextMenu()
}

// 点击"选择文件"按钮触发隐藏 input
const triggerGoogleCertInput = () => {
  googleCertInputRef.value && googleCertInputRef.value.click()
}

// 文件选择后记录
const onGoogleCertFileChange = (e) => {
  const file = e.target.files[0]
  if (!file) return
  googleCertFile.value = file
  googleCertFileName.value = file.name
  // 重置 input 值，允许重复选同一文件也能触发 change
  e.target.value = ''
}

// 确认上传
const submitGoogleCert = async () => {
  if (!googleCertFile.value) {
    ElMessage.warning('请先选择证书文件')
    return
  }
  const container = googleCertContainer.value
  if (!container) return

  let host = (container.networkName === 'myt' || container.networkMode === 'myt' || container.network === 'myt') && container.ip
    ? container.ip
    : container.deviceIp
  // OpenCecs 公网设备：deviceIp 含端口，提取纯 IP
  if (host && host.includes(':')) host = host.split(':')[0]
  const port = extractPort9082(container) || 9082

  googleCertLoading.value = true
  try {
    // 用 FileReader 读取文件内容为 base64，通过 Go IPC 转发（规避跨域）
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        // result 格式: "data:application/octet-stream;base64,xxxx"，只取逗号后面的部分
        const b64 = reader.result.split(',')[1]
        resolve(b64)
      }
      reader.onerror = () => reject(new Error('文件读取失败'))
      reader.readAsDataURL(googleCertFile.value)
    })

    const result = await UploadGoogleCert(host, Number(port), googleCertFileName.value, base64Data)

    if (!result.success) {
      throw new Error(result.message || '上传失败')
    }

    ElMessage.success('Google 证书上传成功')
    googleCertDialogVisible.value = false
  } catch (error) {
    console.error('上传 Google 证书失败:', error)
    ElMessage.error('上传失败: ' + (error.message || error))
  } finally {
    googleCertLoading.value = false
  }
}
// ===== END 上传 Google 证书 =====

// 监听S5代理弹窗关闭，清空vpcInfo
watch(s5ProxyDialogVisible, (newVal) => {
  if (!newVal) {
    s5ProxyForm.value.vpcInfo = ''
  }
})

// 监听备份列表可见且allInstances变化时刷新备份列表
// 使用防抖避免频繁刷新导致选中状态丢失
let backupListRefreshTimer = null
watch(allInstances, () => {
  if (backupListVisible.value) {
    // 清除之前的定时器
    if (backupListRefreshTimer) {
      clearTimeout(backupListRefreshTimer)
    }
    // 延迟刷新，避免频繁触发
    backupListRefreshTimer = setTimeout(() => {
      initBackupList()
    }, 300) // 300ms防抖
  }
}, { deep: true })

// 云机列表加载控制
const cloudMachineLoadingState = ref(new Map()) // 记录每个设备云机加载状态，键为设备IP，值为boolean
const deviceBindStatus = ref(new Map()) // 记录每个设备的绑定状态，键为deviceId，值为0未绑定、1已绑定、2被绑定
const batchLoadTimeout = ref(null) // 批量加载超时定时器
const batchLoadIndex = ref(0) // 批量加载的当前设备索引
// 批量添加设备控制
const isBatchAddingDevices = ref(false) // 是否正在批量添加设备
const batchPendingDevices = ref([]) // 待批量添加的设备队列
const batchAddTimeout = ref(null) // 批量添加防抖定时器
const initGroupsTimeout = ref(null) // 分组初始化防抖定时器
// 型号列表和镜像列表
const phoneModels = ref([]) // 手机型号列表
const localPhoneModels = ref([]) // 本地机型列表
const backupPhoneModels = ref([]) // 备份机型列表
const fetchingBackupModels = ref(false) // 是否正在获取备份机型

// 获取备份机型列表
const fetchBackupModels = async (deviceIp) => {
  if (!deviceIp) {
    console.warn('fetchBackupModels: deviceIp is empty')
    return
  }
  
  fetchingBackupModels.value = true
  // 注意:这里不要立即清空列表,保持之前的数据直到新数据加载完成
  const savedPassword = getDevicePassword(deviceIp)
  let headers = {}
  
  if (savedPassword) {
    // 添加认证头
    const auth = btoa(`admin:${savedPassword}`)
    headers = {
      'Authorization': `Basic ${auth}`
    }
  }
  
  try {
    const response = await axios.get(`http://${getDeviceAddr(deviceIp)}/android/backup/model`, { headers: headers })
    if (response.data && response.data.code === 0) {
      backupPhoneModels.value = response.data.data.list || []
      console.log('备份机型列表加载成功:', backupPhoneModels.value.length)
    } else {
      ElMessage.error(response.data.message || '获取备份机型失败')
      backupPhoneModels.value = []
    }
  } catch (error) {
    console.error('获取备份机型失败:', error)
    ElMessage.error('获取备份机型失败')
    backupPhoneModels.value = []
  } finally {
    fetchingBackupModels.value = false
  }
}



const imageList = ref([]) // 镜像列表
const filteredImageList = ref([]) // 过滤后的镜像列表
const fetchingModels = ref(false) // 是否正在获取型号列表
// 设备选择相关
const selectedHostDevices = ref([]) // 选中的设备列表
const isViewingDeviceDetails = ref(false) // 是否正在查看设备详情
const deviceDetailsDialogVisible = ref(false) // 设备详情弹窗是否可见
const v3DeviceInfoTimer = ref(null) // V3设备信息定时器


// 文件上传相关
const fileInput = ref(null) // 文件输入框引用
const contextMenuContainerId = ref('') // 当前右键菜单操作的容器ID
const contextMenuContainer = ref(null) // 当前右键菜单操作的容器对象
const sharedFilesDialogVisible = ref(false) // 共享文件对话框可见性
const sharedFiles = ref([]) // 共享目录文件列表
const sharedFileTree = ref(null) // 共享目录文件树
const sharedRootPath = ref('') // 共享目录根路径
const selectedFiles = ref([]) // 选中的文件列表
const filesLoading = ref(false) // 文件加载状态
const uploadLoading = ref(false) // 上传加载状态
const fileSortType = ref('time') // 文件排序类型: 'name' | 'time'
const fileSortOrder = ref('desc') // 文件排序顺序: 'asc' | 'desc'

// 单个上传 - 共享目录路径设置
const singleUploadSharedDirInfo = ref({ path: '', isDefault: true, defaultPath: '' })
const singleUploadSharedDirLoading = ref(false)

const loadSingleUploadSharedDirPath = async () => {
  try {
    const result = await GetSharedDirPath()
    if (result) {
      singleUploadSharedDirInfo.value = {
        path: result.path || '',
        isDefault: result.isDefault !== false,
        defaultPath: result.defaultPath || result.path || '',
      }
    }
  } catch (e) {
    console.error('获取共享目录路径失败', e)
  }
}

const handleSelectSingleUploadSharedDir = async () => {
  singleUploadSharedDirLoading.value = true
  try {
    const result = await SelectDirectory('')
    if (result && result.success && result.path) {
      const saveResult = await SetSharedDirPath(result.path)
      if (saveResult && saveResult.success) {
        singleUploadSharedDirInfo.value.path = result.path
        singleUploadSharedDirInfo.value.isDefault = false
        ElMessage.success('共享目录路径已保存')
        await loadSharedFiles()
      } else {
        ElMessage.error(saveResult?.message || '保存路径失败')
      }
    } else if (result && !result.success && result.message !== '用户取消选择') {
      ElMessage.error(result.message || '选择目录失败')
    }
  } catch (e) {
    ElMessage.error('选择目录失败')
  } finally {
    singleUploadSharedDirLoading.value = false
  }
}

const handleResetSingleUploadSharedDir = async () => {
  singleUploadSharedDirLoading.value = true
  try {
    const result = await SetSharedDirPath('')
    if (result && result.success) {
      ElMessage.success('已恢复默认目录')
      singleUploadSharedDirInfo.value = {
        path: result.path || singleUploadSharedDirInfo.value.defaultPath,
        isDefault: true,
        defaultPath: singleUploadSharedDirInfo.value.defaultPath,
      }
      await loadSharedFiles()
    } else {
      ElMessage.error(result?.message || '恢复默认失败')
    }
  } catch (e) {
    ElMessage.error('恢复默认失败')
  } finally {
    singleUploadSharedDirLoading.value = false
  }
}
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
// 设备心跳检测定时器
let deviceHeartbeatTimer = null
let heartbeatInitialized = false  // 防止重复初始化
// 安卓容器列表缓存轮询定时器
let androidCacheTimer = null
const androidCacheVersions = ref({})  // 本地版本号快照 {ip: version}
// 设备状态过滤
const deviceFilter = ref('online') // online: 在线设备, offline: 离线设备
const devicesLastUpdateTime = ref(new Map()) // 记录每个设备最后更新时间，键为设备ID，值为时间戳
const devicesStatusCache = ref(new Map()) // 记录每个设备状态，键为设备ID，值为online/offline
// 设备版本信息
const deviceVersionInfo = ref(new Map()) // 记录每个设备的版本信息，键为设备ID，值为{currentVersion, latestVersion}
// 设备固件信息
const deviceFirmwareInfo = ref(new Map()) // 记录每个设备的固件信息，键为设备ID，值为{sdkVersion, deviceModel, originalData}
// 版本信息自动刷新定时器
let versionRefreshInterval = null
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

// 扩展服务 - 升级设备固件
const handleUpgradeDevice = async (device) => {
  if (!device) return
  try {
    await ElMessageBox.confirm(`确定要升级设备 ${device.ip} 的固件吗？升级过程可能需要几分钟时间。`, '升级确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    const versionInfo = deviceVersionInfo.value.get(device.id)
    if (!versionInfo || !versionInfo.latestVersion) {
      ElMessage.error(`设备 ${device.ip} 未获取到最新版本信息`)
      return
    }

    let password = getDevicePassword(device.ip)
    const result = await UpgradeDeviceWithNewAPI(device.ip, versionInfo.latestVersion, password || '')

    if (result.success) {
      ElMessage.success(`设备 ${device.ip} 升级成功`)
      return
    }

    if (result.errorType === 'auth_required') {
      const savedPassword = getDevicePassword(device.ip)
      if (!savedPassword) {
        showAuthDialog(device, async (newPassword) => {
          const retryResult = await UpgradeDeviceWithNewAPI(device.ip, versionInfo.latestVersion, newPassword || '')
          if (retryResult.success) {
            ElMessage.success(`设备 ${device.ip} 升级成功`)
          } else {
            ElMessage.error(`设备 ${device.ip} 升级失败: ${retryResult.message}`)
          }
        })
        ElMessage.warning('设备需要认证，请输入设备密码')
      } else {
        showAuthDialog(device, async (newPassword) => {
          const retryResult = await UpgradeDeviceWithNewAPI(device.ip, versionInfo.latestVersion, newPassword || '')
          if (retryResult.success) {
            ElMessage.success(`设备 ${device.ip} 升级成功`)
          } else {
            ElMessage.error(`设备 ${device.ip} 升级失败: ${retryResult.message}`)
          }
        })
      }
      return
    }
    ElMessage.error(`设备 ${device.ip} 升级失败: ${result.message}`)
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(`设备 ${device.ip} 升级失败: ${error.message}`)
    }
  }
}

// 设置VPC对话框
const vpcSetDialogVisible = ref(false)
const vpcSetGroupList = ref([])
const vpcSetGroupId = ref('')
const vpcSetNodeId = ref('')
const vpcSetSelectMode = ref('random')
const vpcSetLoading = ref(false)

// 打开设置VPC对话框
const openVpcSetDialog = async () => {
  const container = getCurrentContextMenuContainer()
  if (!container) { ElMessage.warning('请先选择云机'); return }
  if (!activeDevice.value?.ip) { ElMessage.warning('设备信息无效'); return }

  vpcSetGroupId.value = ''
  vpcSetNodeId.value = ''
  vpcSetSelectMode.value = 'random'
  vpcSetDialogVisible.value = true
  vpcSetLoading.value = true

  try {
    const savedPassword = getDevicePassword(activeDevice.value.ip)
    const headers = {}
    if (savedPassword) headers['Authorization'] = `Basic ${btoa(`admin:${savedPassword}`)}`

    const response = await fetch(`http://${getDeviceAddr(activeDevice.value.ip)}/mytVpc/group`, { headers })
    if (response.ok) {
      const data = await response.json()
      if (data.code === 0) {
        vpcSetGroupList.value = data.data?.list || []
      } else {
        ElMessage.error(data.message || '获取VPC分组失败')
      }
    } else {
      ElMessage.error('获取VPC分组失败')
    }
  } catch (error) {
    console.error('获取VPC分组失败:', error)
    ElMessage.error('获取VPC分组失败')
  } finally {
    vpcSetLoading.value = false
  }
}

// 获取当前选中分组下的节点列表
const vpcSetNodeList = computed(() => {
  const group = vpcSetGroupList.value.find(g => g.id === vpcSetGroupId.value)
  return group?.vpcs?.list || []
})

// 提交设置VPC
const submitVpcSet = async () => {
  const container = getCurrentContextMenuContainer()
  if (!container?.name) { ElMessage.warning('云机信息无效'); return }
  if (!vpcSetGroupId.value) { ElMessage.warning('请选择分组'); return }

  let vpcId = ''
  if (vpcSetSelectMode.value === 'random') {
    const nodes = vpcSetNodeList.value
    if (!nodes.length) { ElMessage.warning('该分组下没有可用节点'); return }
    vpcId = nodes[Math.floor(Math.random() * nodes.length)].id
  } else {
    if (!vpcSetNodeId.value) { ElMessage.warning('请选择节点'); return }
    vpcId = vpcSetNodeId.value
  }

  vpcSetLoading.value = true
  try {
    const savedPassword = getDevicePassword(activeDevice.value.ip)
    const headers = { 'Content-Type': 'application/json' }
    if (savedPassword) headers['Authorization'] = `Basic ${btoa(`admin:${savedPassword}`)}`

    const response = await fetch(
      `http://${getDeviceAddr(activeDevice.value.ip)}/mytVpc/addRule/batch`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ names: [container.name], vpcID: vpcId })
      }
    )
    if (response.ok) {
      const data = await response.json()
      if (data.code === 0) {
        ElMessage.success('设置VPC节点成功')
        vpcSetDialogVisible.value = false
      } else {
        ElMessage.error(data.message || '设置VPC失败')
      }
    } else {
      ElMessage.error('设置VPC失败')
    }
  } catch (error) {
    console.error('设置VPC失败:', error)
    ElMessage.error('设置VPC失败')
  } finally {
    vpcSetLoading.value = false
  }
}

// 创建云机弹窗状态 / 镜像机型过滤（阶段 3 迁出到 composables/useCreateDialog.js）
const {
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
} = useCreateDialog({
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
}, {
  // 以下依赖在下方才声明，用惰性依赖避免 TDZ
  filterImageList: (...a) => filterImageList(...a),
  fetchImageList: (...a) => fetchImageList(...a),
  getV3PhoneModels: (...a) => getV3PhoneModels(...a),
  getLocalPhoneModels: (...a) => getLocalPhoneModels(...a),
  fetchNetworkCards: (...a) => fetchNetworkCards(...a),
  getCompatibleTypes: (...a) => getCompatibleTypes(...a),
  // 两个响应式对象也是下方才声明，传 getter 让 composable 侧做 .value 代理
  getIsSpecialModelLocked: () => isSpecialModelLocked,
  getUpdateImageContainer: () => updateImageContainer,
})

// 获取指定设备的镜像列表（用于镜像管理Tab）
const fetchDeviceBoxImages = async (device) => {
  if (!device) {
    deviceBoxImages.value = []
    return
  }
  
  try {
    isLoadingDeviceImages.value = true
    console.log('获取设备镜像列表，设备:', device.ip)
    
    // 从本地存储获取密码
    const savedPassword = getDevicePassword(device.ip);
    const deviceImages = await GetImages(device.ip, device.version || 'v3', savedPassword || '')
    
    deviceBoxImages.value = processRawDeviceImages(deviceImages)
    
    console.log('获取设备镜像列表成功，共', deviceBoxImages.value.length, '个镜像')
  } catch (error) {
    console.error('获取设备镜像列表失败:', error)
    ElMessage.error('获取设备镜像列表失败: ' + error.message)
    deviceBoxImages.value = []
  } finally {
    isLoadingDeviceImages.value = false
  }
}

// 镜像管理tab选中的设备变化处理
const handleDeviceSelectForImages = (device) => {
  if (device) {
    selectedDeviceForImages.value = device
    fetchDeviceBoxImages(device)
  }
}

// 计算属性：将选定设备中已下载的镜像与线上镜像列表对应起来（用于镜像管理Tab）
const matchedDeviceBoxImages = computed(() => {
  return deviceBoxImages.value.map(boxImage => {
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

// 删除设备镜像（用于镜像管理Tab）
const handleDeleteDeviceImage = async (image) => {
    if (!selectedDeviceForImages.value) return

    // 尝试从image对象中获取ID，如果没有则使用name
    let imageId = image.name
    if (image.original && (image.original.id || image.original.Id)) {
        imageId = image.original.id || image.original.Id
    } else if (image.url) {
        // 兼容旧逻辑，使用url作为id
         imageId = image.url
    }

    ElMessageBox.confirm(
    `确定要删除镜像 "${image.name}" 吗？`,
    '删除确认',
    {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(async () => {
    try {
        const savedPassword = getDevicePassword(selectedDeviceForImages.value.ip)

        // 尝试使用axios直接调用设备API删除镜像
        const apiUrl = `http://${selectedDeviceForImages.value.version === 'v3' ? getDeviceAddr(selectedDeviceForImages.value.ip) : selectedDeviceForImages.value.ip + ':81'}/android/image?image=${encodeURIComponent(imageId)}`;
        const headers = {};
        if (savedPassword) {
            const auth = btoa(`admin:${savedPassword}`);
            headers['Authorization'] = `Basic ${auth}`;
        }
      
        const axiosResponse = await axios.delete(apiUrl, { headers });
        const response = axiosResponse.data;
        
        if (response && response.code === 0) {
            ElMessage.success('镜像删除成功')
            // 刷新列表
            fetchDeviceBoxImages(selectedDeviceForImages.value)
        } else {
            ElMessage.error(response?.message || '镜像删除失败')
        }
    } catch(error) {
        console.error('删除镜像失败:', error)
        
        // 处理认证错误
        if (error.response?.status === 401 || error.response?.data?.code === 61) {
            console.log('删除镜像认证失败，需要显示认证对话框')
            // 显示认证对话框
            showAuthDialog(selectedDeviceForImages.value, async (password) => {
                // 认证成功后重新尝试删除
                console.log('认证回调被调用，开始重试删除镜像，密码长度:', password ? password.length : 0)
                try {
                    const apiUrl = `http://${selectedDeviceForImages.value.version === 'v3' ? getDeviceAddr(selectedDeviceForImages.value.ip) : selectedDeviceForImages.value.ip + ':81'}/android/image?image=${encodeURIComponent(imageId)}`;
                    const auth = btoa(`admin:${password}`);
                    const headers = {
                        'Authorization': `Basic ${auth}`
                    };
                    
                    console.log('重试删除镜像 API URL:', apiUrl)
                    console.log('重试删除镜像请求头:', headers)
                    
                    const axiosResponse = await axios.delete(apiUrl, { headers });
                    const response = axiosResponse.data;
                    
                    console.log('重试删除镜像响应:', response)
                    
                    if (response && response.code === 0) {
                        ElMessage.success('镜像删除成功')
                        // 刷新列表
                        fetchDeviceBoxImages(selectedDeviceForImages.value)
                    } else {
                        ElMessage.error(response?.message || '镜像删除失败')
                    }
                } catch (retryError) {
                    console.error('认证后重试删除镜像失败:', retryError)
                    console.error('错误详情:', retryError.response?.data)
                    ElMessage.error('删除镜像失败: ' + (retryError.response?.data?.message || retryError.message))
                }
            })
            return
        }
        
        ElMessage.error('删除镜像失败: ' + error.message)
    }
  }).catch(() => {
    // 取消删除
  })
}

// 刷新镜像列表
const refreshImageList = async () => {
  if (activeDevice.value) {
    const deviceType = activeDevice.value.name || 'C1'
    await fetchImageList(deviceType)
    
    // 刷新盒子镜像列表
    await fetchBoxImages()
    
    // 检查在线镜像的上传状态
    await checkOnlineImagesUploadStatus()
    
    // 热更新测试：显示一个消息
    ElMessage.info('镜像列表已刷新 - 热更新测试')
  } else {
    await fetchImageList('')
  }
}


//打开本地镜像目录
const handleOpen = async () => {
  try {
    const result = await OpenLocalImageDirectory()
    if (result.success) {
      ElMessage.success('已打开本地镜像目录')
    } else {
      ElMessage.error(result.message)
    }
  } catch (error) {
    console.error('打开本地镜像目录失败:', error)
    ElMessage.error('打开本地镜像目录失败')
  }
}


// 刷新在线镜像


// 刷新本地镜像


// 刷新盒子镜像



// 重置筛选条件



// 处理镜像列表排序
const handleImageSort = (column) => {
  const { prop, order } = column
  if (!prop || !order) return
  
  filteredImageList.value.sort((a, b) => {
    const aVal = a[prop] || ''
    const bVal = b[prop] || ''
    
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return order === 'ascending' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return order === 'ascending' ? aVal - bVal : bVal - aVal
    }
    
    return 0
  })
}

// 格式化文件大小为人类可读的格式
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  if (typeof bytes !== 'number') return bytes
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}


// 获取MacVlan IP输入框的placeholder
const getMacVlanIpPlaceholder = () => {
  if (currentDeviceMacVlanInfo.value.subnet) {
    // 从subnet中提取建议的起始IP
    // 例如: 10.10.0.0/16 -> 建议从 10.10.0.10 开始
    const subnetParts = currentDeviceMacVlanInfo.value.subnet.split('/')
    if (subnetParts.length > 0) {
      const ipParts = subnetParts[0].split('.')
      if (ipParts.length === 4) {
        // 建议从 x.x.x.10 开始,避免保留地址
        ipParts[3] = '10'
        return `建议起始IP: ${ipParts.join('.')} (请确保未被占用)`
      }
    }
  }
  return '请输入起始IP地址,例如: 10.10.0.10'
}

// 更新镜像对话框
const updateImageDialogVisible = ref(false)
const updateImageContainer = ref(null) // 当前要更新镜像的容器
const updateImageLoading = ref(false) // 更新镜像时的加载状态

// 批量更新镜像对话框
const batchUpdateImageDialogVisible = ref(false)
const batchUpdateImageLoading = ref(false)
const batchUpdateImageStatusText = ref('') // 当前操作进度文字
// 分组数据结构：每项对应一种设备类型（P系列 / 非P系列）
// { groupKey: 'p'|'non-p', groupLabel: string, deviceName: string,
//   containers: [], hasV2: bool, hasV3: bool,
//   androidType: 'V3'|'V2',          // 用户选择的版本
//   v2AndroidVersion: 10|12|14,      // V2时选择的安卓版本
//   selectedUrl: '',                 // 选中的镜像URL
//   customUrl: '' }                  // 自定义地址
const batchUpdateImageGroups = ref([])

// 根据设备名称判断是否P系列
const isBatchImagePSeries = (deviceName) => {
  const n = (deviceName || '').toLowerCase()
  return n.startsWith('p')
}

// 为某个分组获取 V3 镜像列表
const getBatchUpdateV3List = (deviceName) => {
  const images = imageList.value
  if (!images || images.length === 0) return []
  const compatibleTypes = getCompatibleTypes(deviceName || '')
  return images.filter(img => {
    if (img.sys_ver != 5) return false
    if (!img.ttype && !img.ttype2) return true
    if (img.ttype && compatibleTypes.includes(img.ttype)) return true
    if (Array.isArray(img.ttype2)) {
      for (const t of img.ttype2) {
        if (compatibleTypes.includes(t)) return true
      }
    }
    return false
  })
}

// 为某个分组获取 V2 镜像列表
const getBatchUpdateV2List = (deviceName, androidVersion) => {
  const images = imageList.value
  if (!images || images.length === 0) return []
  const ver = `and${androidVersion}`
  return images.filter(img => {
    if (img.sys_ver == 5) return false
    if (img.os_ver !== ver) return false
    if (deviceName) {
      return Array.isArray(img.ttype2) && img.ttype2.includes(deviceName)
    }
    return true
  })
}
const updateImageForm = ref({
  imageSelect: '',
  customImageUrl: '',
  modelName: '',
  enableMagisk: false,
  enableGMS: false,
  dns: '',
  customDns: '',
  resolution: 'default',
  customResolution: {
    width: '',
    height: '',
    dpi: ''
  },
  vpcGroupId: '',
  vpcNodeId: '',
  vpcSelectMode: 'specified',
  randomFile: false, // 随机系统文件，默认关闭
  enforce: true, // 安全模式，默认开启
  networkCardType: 'private', // private-私有网卡, public-公有网卡
  mytBridgeName: '', // myt_bridge网卡名
  macVlanIp: '' // macVlan IP
})
// 上一次的镜像选择记录
const lastImageSelection = ref({
  imageSelect: '',
  customImageUrl: '',
  imageCategory: 'online',
  localImageUrl: '',
  imageSource: 'pc'
})

// 处理镜像选择变化
const handleImageSelectChange = (value) => {
  if (value !== 'custom') {
    createForm.value.customImageUrl = ''
  }
}

// 处理网络模式变化
const handleNetworkModeChange = (value) => {
  if (value !== 'myt') {
    createForm.value.ipaddr = ''
  }
}

const upgradeCreateDeviceApiVersion = async () => {
  if (!createDevice.value) return
  const device = createDevice.value
  const versionInfo = deviceVersionInfo.value.get(device.id)
  if (!versionInfo || !versionInfo.latestVersion) {
    ElMessage.error(`设备 ${device.ip} 未获取到最新版本信息`)
    return
  }
  const refreshDeviceApiVersion = () => {
    lastCheckTime.value.set(device.id, 0)
    addToVersionCheckQueue(device, true)
    batchProcessVersionCheckQueue()
  }
  try {
    await ElMessageBox.confirm(`确定要升级设备 ${device.ip} 的API版本吗？升级过程可能需要几分钟时间。`, '升级确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    let password = device.password
    if (!password) {
      password = getDevicePassword(device.ip)
    }
    const result = await UpgradeDeviceWithNewAPI(device.ip, versionInfo.latestVersion, password || '')
    if (result.success) {
      ElMessage.success(`设备 ${device.ip} 升级成功: ${result.message}`)
      refreshDeviceApiVersion()
      return
    }
    if (result.errorType === 'auth_required') {
      const savedPassword = getDevicePassword(device.ip)
      if (!savedPassword) {
        showAuthDialog(device, async (newPassword) => {
          const retryResult = await UpgradeDeviceWithNewAPI(device.ip, versionInfo.latestVersion, newPassword || '')
          if (retryResult.success) {
            ElMessage.success(`设备 ${device.ip} 升级成功: ${retryResult.message}`)
            refreshDeviceApiVersion()
          } else {
            ElMessage.error(`设备 ${device.ip} 升级失败: ${retryResult.message}`)
          }
        })
        ElMessage.warning('设备需要认证，请输入设备密码')
      } else {
        ElMessage.error('设备密码错误，请重新输入')
        showAuthDialog(device, async (newPassword) => {
          const retryResult = await UpgradeDeviceWithNewAPI(device.ip, versionInfo.latestVersion, newPassword || '')
          if (retryResult.success) {
            ElMessage.success(`设备 ${device.ip} 升级成功: ${retryResult.message}`)
            refreshDeviceApiVersion()
          } else {
            ElMessage.error(`设备 ${device.ip} 升级失败: ${retryResult.message}`)
          }
        })
      }
      return
    }
    ElMessage.error(`设备 ${device.ip} 升级失败: ${result.message}`)
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(`设备 ${device.ip} 升级失败: ${error.message}`)
    }
  }
}

const slotStates = ref({})
const runningSlots = ref(new Set())

// ⚠️ slotStates / runningSlots 都是全局单例，只保存"最后一次加载的那台设备"的数据。
// 坑位模式下可以选中 A 设备、却点击 B 设备的创建按钮，直接读它们会串到别的设备，
// 导致新建云机被误判为"坑位已有运行中云机 / 坑位已过期"而默认不开机。
// 因此写入时记录归属设备，读取前先校验归属，不属于目标设备的数据一律不采信。
const slotStatesDevice = ref('')   // slotStates 当前归属的设备 device.id
const runningSlotsDevice = ref('') // runningSlots 当前归属的设备 device.ip

const setSlotStates = (map, deviceId) => {
  slotStates.value = map || {}
  slotStatesDevice.value = deviceId || ''
}

// 仅当 slotStates 确实属于目标设备时返回，否则返回空对象（视为"未知"，不阻塞开机）
const slotStatesOf = (device) => {
  if (!device || !device.id) return {}
  return slotStatesDevice.value === device.id ? slotStates.value : {}
}

// 仅当 runningSlots 确实属于目标设备时返回，否则返回 null（表示"无实时状态可用"）
const runningSlotsOf = (device) => {
  if (!device || !device.ip) return null
  return runningSlotsDevice.value === device.ip ? runningSlots.value : null
}

// instances 只承载"当前选中设备"的容器列表，跨设备时必须忽略
const instancesOf = (device) => {
  if (!device || !activeDevice.value || activeDevice.value.ip !== device.ip) return []
  return instances.value || []
}

// ---- 坑位到期时间缓存工具 ----
const SLOT_CACHE_TTL = 24 * 3600 * 1000 // 缓存有效期 1 天（毫秒）
const SLOT_CACHE_TTL_WARN = 60 * 60 * 1000 // 即将过期的坑位缓存 1 小时
const SLOT_WARN_SECONDS = 3 * 24 * 3600  // 3 天内到期 → 即将到期

const getSlotCacheKey = (deviceId) => `slotStates_${deviceId}`

// 将 API 返回的 child 对象转为 { [slot]: { state, expireTs } }
// child 可能有两种格式：
//   1) { "1": 1748xxx, "2": 1748xxx } — slot → 过期时间戳（秒）
//   2) { "1": { state:0, extime:"2025-06-15", extimeState:0 }, ... } — slot → 对象（v2 API）
const convertChild = (child) => {
  const now = Math.floor(Date.now() / 1000)
  const converted = {}
  console.log('[convertChild] raw child:', JSON.stringify(child))
  for (const [slot, val] of Object.entries(child)) {
    // 兼容 v2 格式：val 是对象且包含 state 字段
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const state = (typeof val.state === 'number') ? val.state : 0
      const ts = parseInt(val.extime || val.expireTs || 0, 10)
      console.log(`[convertChild] slot=${slot} v2格式 state=${state} extime=${val.extime} ts=${ts}`)
      converted[slot] = { state, expireTs: isNaN(ts) ? 0 : ts }
      continue
    }
    // 兼容旧格式：val 是时间戳数字/字符串
    const ts = parseInt(val, 10)
    let state
    if (isNaN(ts) || ts === 0 || ts < now) {
      state = 2 // 已到期
    } else if (ts - now < SLOT_WARN_SECONDS) {
      state = 1 // 即将到期（3天内）
    } else {
      state = 0 // 正常有效
    }
    console.log(`[convertChild] slot=${slot} 时间戳格式 val=${val} ts=${ts} now=${now} state=${state}`)
    converted[slot] = { state, expireTs: ts }
  }
  return converted
}

// 从缓存读取，返回 converted 对象或 null（缓存不存在/已过期）
// 含有即将过期/已过期坑位时使用短TTL，否则使用长TTL
const loadSlotCache = (deviceId) => {
  try {
    const raw = localStorage.getItem(getSlotCacheKey(deviceId))
    if (!raw) return null
    const { cachedAt, data } = JSON.parse(raw)
    const hasWarn = Object.values(data).some(v => v.state === 1 || v.state === 2)
    const ttl = hasWarn ? SLOT_CACHE_TTL_WARN : SLOT_CACHE_TTL
    if (Date.now() - cachedAt > ttl) return null
    return data
  } catch {
    return null
  }
}

// 将 converted 对象写入缓存
const saveSlotCache = (deviceId, converted) => {
  try {
    localStorage.setItem(getSlotCacheKey(deviceId), JSON.stringify({
      cachedAt: Date.now(),
      data: converted
    }))
  } catch {}
}

// 清除指定设备的坑位状态缓存（续费后调用）
const clearSlotCache = (deviceId) => {
  try {
    localStorage.removeItem(getSlotCacheKey(deviceId))
  } catch {}
}

// 清除所有设备的坑位状态缓存
const clearAllSlotCache = () => {
  try {
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('slotStates_')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k))
  } catch {}
}

// 判断缓存中是否有某坑位已到期（需要重新查询）
const hasCacheExpiredSlot = (cached, slot) => {
  if (!cached) return true
  const info = cached[slot]
  if (!info) return false // 坑位不存在于 child，不触发重查
  return info.state === 2
}

// 拉取并更新 slotStates，同时写缓存
const fetchAndCacheSlotStates = (deviceId) => {
  return GetUserRabbetList(deviceId).then(async res => {
    console.log('GetUserRabbetList result:', res)
    if (res.data && res.data.data && res.data.data.length > 0) {
      const converted = convertChild(res.data.data[0].child || {})
      // 先读取上一次缓存（saveSlotCache 之前的快照），用于判断"本次新进入到期"
      const previousSlotStates = loadSlotCache(deviceId) || {}
      saveSlotCache(deviceId, converted)
      setSlotStates(converted, deviceId)
      // 已过期坑位里的运行中云机强制关机
      await stopExpiredRunningContainers(deviceId, converted, previousSlotStates)
    } else {
      setSlotStates({}, '')
    }
  }).catch(err => {
    console.error('GetUserRabbetList error:', err)
    setSlotStates({}, '')
  })
}

// 将已过期坑位（state === 2）中的运行中容器强制关机
// 仅处理 previousSlotStates 中非到期、newSlotStates 中到期的坑位，避免重复关机
const stopExpiredRunningContainers = async (deviceId, newSlotStates, previousSlotStates) => {
  try {
    const device = devices.value.find(d => d.id === deviceId)
    if (!device) return
    const cached = deviceCloudMachinesCache.value.get(device.ip) || []
    if (cached.length === 0) return
    const targets = []
    for (const [slotStr, info] of Object.entries(newSlotStates || {})) {
      if (!info || info.state !== 2) continue
      const slotNum = parseInt(slotStr, 10)
      if (isNaN(slotNum)) continue
      // 仅在本次"由非到期 → 到期"或"无记录 → 到期"时关机，避免重复调用
      const prev = previousSlotStates ? previousSlotStates[slotStr] : undefined
      const prevExpired = prev && prev.state === 2
      if (prevExpired) continue
      // 在缓存中查找该坑位运行中的容器
      const running = cached.find(cm => cm.indexNum === slotNum && cm.status === 'running')
      if (running) targets.push(running)
    }
    if (targets.length === 0) return
    console.log(`[到期强制关机] 设备 ${device.ip} 发现 ${targets.length} 个到期坑位的运行中云机，开始关机`)
    for (const cm of targets) {
      try {
        await authRetry(device, async (password) => {
          await stopContainer(device, cm.name, password)
        })
        console.log(`[到期强制关机] 设备 ${device.ip} 坑位 ${cm.indexNum} 云机 ${cm.name} 已关机`)
      } catch (e) {
        console.error(`[到期强制关机] 设备 ${device.ip} 坑位 ${cm.indexNum} 云机 ${cm.name} 关机失败:`, e)
      }
    }
    // 关机完成后刷新容器列表，同步本地 status
    try {
      await fetchAndroidContainers(device, true)
    } catch (e) {
      console.error('[到期强制关机] 刷新容器列表失败:', e)
    }
  } catch (e) {
    console.error('[到期强制关机] 异常:', e)
  }
}

// 加载坑位状态：优先使用缓存，若目标坑位已到期则重新请求
const loadSlotStates = (deviceId, slot) => {
  const cached = loadSlotCache(deviceId)
  if (cached && !hasCacheExpiredSlot(cached, String(slot))) {
    // 命中缓存且目标坑位未到期，直接使用
    setSlotStates(cached, deviceId)
  } else {
    // 缓存过期、不存在，或目标坑位已到期 → 重新请求
    fetchAndCacheSlotStates(deviceId)
  }
}

// Helper to parse running slots
const updateRunningSlots = (device, containers) => {
  runningSlots.value.clear()
  runningSlotsDevice.value = device?.ip || ''
  const list = device.version === 'v3' ? (containers.data?.list || []) : (containers || [])
  list.forEach(c => {
    if (c.status === 'running') {
      let snum
      if (device.version === 'v3') {
        snum = parseInt(c.indexNum || c.snum)
      } else {
        const name = c.names?.[0] || c.Name || ''
        const match = name.match(/(\d+)/)
        if (match) snum = parseInt(match[1])
      }
      if (snum) runningSlots.value.add(snum)
    }
  })
}

const getSlotClass = (slot) => {
  const info = slotStates.value[slot]
  const state = info ? info.state : undefined
  if (state === 0) return 'slot-blue'
  if (state === 1) return 'slot-yellow'
  if (state === 2) return 'slot-red'
  return 'slot-gray'
}

// Watcher for selectedSlots removed as logic is moved to submit handler

// 显示创建云机对话框
const showCreateDialog = async (device, mode, slot = 0, localImage = null) => {
  console.log('showCreateDialog', device)

  if (device && device.id) {
    loadSlotStates(device.id, slot)
    
    // Fetch containers to check running status
    getContainers(device).then(containers => {
      updateRunningSlots(device, containers)
    }).catch(err => {
      console.error('getContainers error:', err)
      runningSlots.value.clear()
      runningSlotsDevice.value = '' // 拉取失败，标记为"未知"，避免误判坑位占用
    })
  } else {
    setSlotStates({}, '')
    runningSlots.value.clear()
    runningSlotsDevice.value = ''
  }

  createDevice.value = device
  createMode.value = mode
  currentSlot.value = slot
  
  // 使用上一次的选择初始化表单
  if (createMode.value === 'multi-device-batch' || createMode.value === 'batch') {
    // 从localStorage加载上次选择的坑位
    const savedSlots = localStorage.getItem('createDialog_selectedSlots')
    let previousSelectedSlots = savedSlots ? JSON.parse(savedSlots) : []
    
    // 根据当前设备类型过滤坑位：非P设备只允许 1-12 的坑位
    const currentDeviceIsP = device && device.id && device.id.toLowerCase().startsWith('p')
    const maxSlotForDevice = currentDeviceIsP ? 24 : 12
    previousSelectedSlots = previousSelectedSlots.filter(s => s >= 1 && s <= maxSlotForDevice)
    
    createForm.value = {
      createType: 'simulator',
      selectedSlots: previousSelectedSlots, // 恢复上次选择的坑位（已过滤超出范围的）
      
      // Container mode specific fields
      containerAndroidVersion: '10', // 10, 12, 14
      containerSandboxMode: true,
      containerEnforce: true, // 安全模式，默认开启
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

      name: 'T000',
      androidVersion: '14', // 安卓版本：11, 13, 14, 15, 16, 17
      modelName: 'random', // 默认随机机型
      modelType: mode === 'multi-device-batch' ? 'online' : 'online', // 默认在线机型
      count: 1,
      startSlot: 1,
      imageSelect: '',
      customImageUrl: '',
      imageCategory: 'online',
      localImageUrl: '',
      imageSource: 'pc',
      cacheToLocal: false,
      networkMode: 'bridge',
      ipaddr: '',
      resolution: '720x1280x320',
      customResolution: {
        width: '',
        height: '',
        dpi: ''
      },
      sandboxSize: 28,
      dns: '223.5.5.5',
      customDns: '',
      countryCode: 'CN', // 默认为中国
      // S5代理设置
      s5Type: '0',
      s5IP: '',
      s5Port: '',
      s5User: '',
      s5Password: '',
      s5RelayType: '0',
      s5RelayVpcId: '',
      s5RelayAddress: '',
      enableMagisk: false,
      enableGMS: false,
      enforce: true, // 安全模式，默认开启
      compatMode: false, // 兼容模式，默认关闭
      adbPort: 5555, // ADB端口，默认555，设置0不开启ADB
      // 网络管理分组
      vpcGroupId: '', // 选择的分组ID
      vpcNodeId: '', // 选择的节点ID
      vpcSelectMode: 'specified', // specified-指定节点, random-随机节点
      networkCardType: 'private', // private-私有网卡, public-公有网卡
      mytBridgeName: '' // myt_bridge网卡名
    }
  } else {
    createForm.value = {
      createType: 'simulator',

      // Container mode specific fields
      containerAndroidVersion: '10', // 10, 12, 14
      containerSandboxMode: true,
      containerEnforce: true, // 安全模式，默认开启
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

      name: 'T000',
      androidVersion: '14', // 安卓版本：11, 13, 14, 15, 16, 17
      modelName: 'random', // 默认随机机型
      modelType: 'online', // 默认在线机型
      count: 1,
      startSlot: slot,
      imageSelect: '',
      customImageUrl: '',
      imageCategory: 'online',
      localImageUrl: '',
      imageSource: 'pc',
      cacheToLocal: false,
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
      countryCode: 'CN', // 默认为中国
      // S5代理设置
      s5Type: '0',
      s5IP: '',
      s5Port: '',
      s5User: '',
      s5Password: '',
      s5RelayType: '0',
      s5RelayVpcId: '',
      s5RelayAddress: '',
      enableMagisk: false,
      enableGMS: false,
      enforce: true, // 安全模式，默认开启
      compatMode: false, // 兼容模式，默认关闭
      adbPort: 5555, // ADB端口，默认5555，设置0不开启ADB
      // 网络管理分组
      vpcGroupId: '', // 选择的分组ID
      vpcNodeId: '', // 选择的节点ID
      vpcSelectMode: 'specified', // specified-指定节点, random-随机节点
      networkCardType: 'private', // private-私有网卡, public-公有网卡
      mytBridgeName: '' // myt_bridge网卡名
    }
  }
  
  // 获取设备类型
  const deviceType = device ? (device.name || 'C1') : 'C1'
  
  // 先显示创建对话框
  createDialogVisible.value = true

  // 加载VPC代理列表（中转设置使用），从设备API获取真实节点
  try {
    const targetDevice = activeDevice.value
    if (targetDevice?.ip) {
      const savedPassword = getDevicePassword(targetDevice.ip)
      const headers = {}
      if (savedPassword) headers['Authorization'] = `Basic ${btoa(`admin:${savedPassword}`)}`
      const resp = await fetch(`http://${getDeviceAddr(targetDevice.ip)}/mytVpc/group`, { headers })
      if (resp.ok) {
        const data = await resp.json()
        if (data.code === 0) {
          const groups = data.data?.list || []
          const nodes = []
          for (const g of groups) {
            for (const n of g.vpcs?.list || []) {
              nodes.push({ id: n.id, name: `${g.alias} / ${n.remarks || n.protocol}`, ip: n.remarks || n.protocol })
            }
          }
          vpcProxyList.value = nodes
        } else {
          vpcProxyList.value = []
        }
      } else {
        vpcProxyList.value = []
      }
    } else {
      vpcProxyList.value = []
    }
  } catch (e) {
    console.warn('加载VPC代理列表失败:', e)
    vpcProxyList.value = []
  }

  if (mode === 'multi-device-batch') {
    selectedBatchDevices.value = []
    batchDeviceTypeFilter.value = 'p_series' // 默认选择P系列
    createForm.value.modelType = 'online' // 批量模式下默认为在线机型
    // 加载镜像列表
    const type = batchDeviceTypeFilter.value === 'p_series' ? 'P1' : 'C1'
    await fetchImageList(type)
    // 加载本地镜像列表
    await fetchLocalCachedImages()
    return
  }

  if (device && device.version === 'v3') {
    if (!deviceFirmwareInfo.value.get(device.id)) {
      await fetchV3DeviceInfo(device)
    }
  }

  if (device && !deviceVersionInfo.value.get(device.id)) {
    addToVersionCheckQueue(device, true)
    batchProcessVersionCheckQueue()
  }
  
  // 获取网卡列表 (仅V3设备)
  if (device.version === 'v3') {
    fetchNetworkCards()
  }
  
  // 加载本地镜像列表，确保用户可以在对话框中选择本地镜像
  await fetchLocalCachedImages()
  
  // 如果提供了本地镜像，直接设置表单
  if (localImage) {
    createForm.value.imageCategory = 'local'
    createForm.value.localImageUrl = localImage.url
    createForm.value.imageSource = 'local'
    console.log('从本地镜像创建云机，镜像URL:', localImage.url)
    
    // 如果是V3设备，仍然需要获取型号列表和本地机型列表
    if (device.version === 'v3') {
      await getV3PhoneModels(device.ip)
      await getLocalPhoneModels(device.ip)
      await fetchBackupModels(device.ip)
    }
    
    return
  }
  
  // 如果是V0-V2设备，显示SDK加载蒙版并执行加载流程
  if (device.version !== 'v3') {
    try {
      // 显示SDK加载蒙版
      sdkLoadingVisible.value = true
      sdkLoadingMessage.value = '加载MYT SDK中'
      
      // 调用后端创建V0-V2设备的SDK
      await createV0V2Device(device)
      
      // 更新提示信息
      sdkLoadingMessage.value = '加载镜像列表中'
      
      // 获取镜像列表
      await fetchImageList(deviceType)
      
      // 设置镜像选择：始终默认选第一个镜像（按安卓版本过滤后）
      const filtered = androidVersionFilteredImageList.value
      if (filtered && filtered.length > 0) {
        createForm.value.imageSelect = filtered[0].url
        createForm.value.imageCategory = 'online'
        createForm.value.localImageUrl = ''
        createForm.value.imageSource = 'pc'
      }
      
      // 隐藏SDK加载蒙版
      sdkLoadingVisible.value = false
    } catch (error) {
      console.error('加载MYT SDK失败:', error)
      ElMessage.error(`加载MYT SDK失败：${error.message}`)
      // 隐藏SDK加载蒙版
      sdkLoadingVisible.value = false
      // 关闭创建对话框
      createDialogVisible.value = false
    }
  } else {
    // V3设备正常流程
    // 如果是V3设备，获取型号列表
    await getV3PhoneModels(device.ip)
    
    // 获取本地机型列表
    await getLocalPhoneModels(device.ip)

    // 获取备份机型列表
    await fetchBackupModels(device.ip)
    
    // 获取机型国家列表
    await getCountryList(device.ip)
    
    // 获取镜像列表
    await fetchImageList(deviceType)
    
    // 设置镜像选择：始终默认选第一个镜像（按安卓版本过滤后）
    const filteredByVer = androidVersionFilteredImageList.value
    if (filteredByVer && filteredByVer.length > 0) {
      createForm.value.imageSelect = filteredByVer[0].url
      createForm.value.imageCategory = 'online'
      createForm.value.localImageUrl = ''
      createForm.value.imageSource = 'pc'
    }
  }
  
  // 重置网络管理相关字段
  createForm.value.vpcGroupId = ''
  createForm.value.vpcNodeId = ''
  createForm.value.vpcSelectMode = 'specified'
  vpcGroupList.value = []
  vpcNodeList.value = []
  
  // 如果是V3设备，获取分组列表
  if (device.version === 'v3') {
    await fetchVpcGroupList(device.ip)
  }
}

// 获取V3手机型号列表，参考api/main.go中的getV3PhoneModels实现
const getV3PhoneModels = async (deviceIP) => {
  try {
    fetchingModels.value = true
    // 尝试使用已保存的密码
    const savedPassword = getDevicePassword(deviceIP)
    let headers = {}
    
    if (savedPassword) {
      // 添加认证头
      const auth = btoa(`admin:${savedPassword}`)
      headers = {
        'Authorization': `Basic ${auth}`
      }
    }
    
    const response = await axios.get(`http://${getDeviceAddr(deviceIP)}/android/phoneModel?page=0`, {
      headers: headers
    })
    
    // 解析响应数据
    if (response.data.code === 0 && response.data.data) {
      const result = response.data.data
      phoneModels.value = result.list || []
      console.log('获取V3手机型号列表成功，共', phoneModels.value.length, '个型号')
    } else if (response.data.code === 61 && response.data.message === 'Authentication Failed') {
      // 认证失败，显示认证对话框
      return new Promise((resolve, reject) => {
        showAuthDialog({ ip: deviceIP, version: 'v3' }, async (password) => {
          try {
            const auth = btoa(`admin:${password}`)
            const authResponse = await axios.get(`http://${getDeviceAddr(deviceIP)}/android/phoneModel?page=0`, {
              headers: {
                'Authorization': `Basic ${auth}`
              }
            })
            
            if (authResponse.data.code === 0 && authResponse.data.data) {
              const result = authResponse.data.data
              phoneModels.value = result.list || []
              console.log('获取V3手机型号列表成功，共', phoneModels.value.length, '个型号')
              resolve(phoneModels.value)
            } else {
              ElMessage.error('获取手机型号列表失败: ' + (authResponse.data.message || '未知错误'))
              reject(new Error('获取手机型号列表失败'))
            }
          } catch (error) {
            console.error('获取V3手机型号列表失败:', error)
            ElMessage.error('获取手机型号列表失败: ' + error.message)
            reject(error)
          }
        })
        
        // 30秒后检查是否有响应
        setTimeout(() => {
          console.log('30秒超时检查')
        }, 30000)
      })
    } else {
      console.error('获取V3手机型号列表失败:', response.data.message)
      ElMessage.error('获取手机型号列表失败: ' + (response.data.message || '未知错误'))
    }
  } catch (error) {
    console.error('获取V3手机型号列表失败:', error)
    ElMessage.error('获取手机型号列表失败: ' + error.message)
  } finally {
    fetchingModels.value = false
  }
}

// 获取本地机型列表，使用 /phoneModel 接口
const getLocalPhoneModels = async (deviceIP) => {
  try {
    fetchingModels.value = true
    const savedPassword = getDevicePassword(deviceIP)
    let headers = {}
    
    if (savedPassword) {
      const auth = btoa(`admin:${savedPassword}`)
      headers = {
        'Authorization': `Basic ${auth}`
      }
    }
    
    const response = await axios.get(`http://${getDeviceAddr(deviceIP)}/phoneModel`, {
      headers: headers
    })
    
    // 解析响应数据
    if (response.data.code === 0 && response.data.data) {
      const result = response.data.data
      localPhoneModels.value = result.list || []
      console.log('获取本地机型列表成功，共', localPhoneModels.value.length, '个机型')
    } else if (response.data.code === 61 && response.data.message === 'Authentication Failed') {
      return new Promise((resolve, reject) => {
        showAuthDialog({ ip: deviceIP, version: 'v3' }, async (password) => {
          try {
            const auth = btoa(`admin:${password}`)
            const authResponse = await axios.get(`http://${getDeviceAddr(deviceIP)}/phoneModel`, {
              headers: {
                'Authorization': `Basic ${auth}`
              }
            })
            
            if (authResponse.data.code === 0 && authResponse.data.data) {
              const result = authResponse.data.data
              localPhoneModels.value = result.list || []
              console.log('获取本地机型列表成功，共', localPhoneModels.value.length, '个机型')
              resolve(localPhoneModels.value)
            } else {
              ElMessage.error('获取本地机型列表失败: ' + (authResponse.data.message || '未知错误'))
              reject(new Error('获取本地机型列表失败'))
            }
          } catch (error) {
            console.error('获取本地机型列表失败:', error)
            ElMessage.error('获取本地机型列表失败: ' + error.message)
            reject(error)
          }
        })
      })
    } else {
      console.error('获取本地机型列表失败:', response.data.message)
      ElMessage.error('获取本地机型列表失败: ' + (response.data.message || '未知错误'))
    }
  } catch (error) {
    console.error('获取本地机型列表失败:', error)
    ElMessage.error('获取本地机型列表失败: ' + error.message)
  } finally {
    fetchingModels.value = false
  }
}

// 计算当前显示的机型列表
const displayedModels = computed(() => {
  let models = []
  let useNameAsId = false
  
  switch (switchModelType.value) {
    case 'online':
      models = phoneModels.value
      // 切换机型弹窗：根据容器当前镜像的安卓版本过滤在线机型
      if (currentSwitchContainer.value && currentSwitchContainer.value.image) {
        const currentImageUrl = currentSwitchContainer.value.image
        const currentImage = imageList.value.find(img => img.url === currentImageUrl)
        if (currentImage && currentImage.os_ver) {
          const verMatch = currentImage.os_ver.match(/and(\d+)/i)
          if (verMatch && verMatch[1]) {
            const targetVer = verMatch[1]
            models = models.filter(m => {
              if (!m.android_version) return true // 无该字段时不过滤
              return String(m.android_version) === String(targetVer)
            })
          }
        }
      }
      break
    case 'local':
      models = localPhoneModels.value
      useNameAsId = true
      break
    case 'backup':
      models = backupPhoneModels.value
      useNameAsId = true
      break
    default:
      models = []
  }
  
  if (models && models.length > 0) {
    // 对于本地和备份机型，使用name作为id
    let processedModels = models
    if (useNameAsId) {
      processedModels = models.map(m => ({
        ...m,
        id: m.name // 覆盖或添加id为name
      }))
    }
    
    // 添加随机选项
    return [{ id: 'random', name: '随机机型' }, ...processedModels]
  }
  return []
})

// 处理机型类型切换
const handleSwitchModelTypeChange = async () => {
  tempModelId.value = '' // 重置选择
  if (!currentSwitchContainer.value) return
  
  const deviceIp = currentSwitchContainer.value.deviceIp
  
  if (switchModelType.value === 'local') {
     await getLocalPhoneModels(deviceIp)
  } else if (switchModelType.value === 'backup') {
     await fetchBackupModels(deviceIp)
  }
}

// 切换云机机型函数
const switchCloudMachineModel = async (device, containerName, modelId, modelName, countryCode, androidVersion = '', excludeIds = [], onRandomSelected = null) => {
  if (!device || !containerName || !modelId) {
    console.error('切换机型参数不完整:', device, containerName, modelId, modelName)
    throw new Error('参数不能为空')
  }

  // 按安卓版本过滤的机型池：批量新机传入 androidVersion，避免随机/查找混入其它版本的机型
  const versionFilteredPhoneModels = (() => {
    if (!androidVersion) return phoneModels.value
    return (phoneModels.value || []).filter(m => {
      if (!m.android_version) return false
      return String(m.android_version) === String(androidVersion)
    })
  })()

  // 处理随机机型情况
  let finalModelId = modelId
  let finalModelName = modelName
  let modelType = 'online'
  
  // 检查 modelId 是否为对象 (包含 type 和 value)
  if (typeof modelId === 'object' && modelId !== null && modelId.value) {
    finalModelId = modelId.value
    modelType = modelId.type || 'online'
  }
  
  if (finalModelId === 'random') {
    if (phoneModels.value.length === 0 && modelType === 'online') {
       // 尝试获取一下? 或者报错
       // 如果是online且为空，可能还没获取
    }

    // 随机选择一个机型
    let list = []
    if (modelType === 'local') list = localPhoneModels.value
    else if (modelType === 'backup') list = backupPhoneModels.value
    else list = androidVersion ? versionFilteredPhoneModels : phoneModels.value

    if (list.length === 0) {
      console.error('随机机型选择失败：没有可用机型列表')
      throw new Error('随机机型选择失败：没有可用机型列表')
    }

    // 批量随机时排除已分配的机型，避免重复；若全部已用则回退为允许重复
    const excludeSet = new Set((excludeIds || []).map(id => String(id)))
    let candidateList = list
    if (excludeSet.size > 0) {
      const filtered = list.filter(m => !excludeSet.has(String(m.id)))
      if (filtered.length > 0) candidateList = filtered
    }

    const randomIndex = Math.floor(Math.random() * candidateList.length)
    const randomModel = candidateList[randomIndex]

    if (modelType === 'online') {
      finalModelId = randomModel.id
      finalModelName = randomModel.name
    } else {
      finalModelId = randomModel.name
      finalModelName = randomModel.name
    }

    console.log(`随机选择的机型：${finalModelName} (${finalModelId}) 安卓版本：${androidVersion || '未指定'}，已排除：${excludeSet.size}个`)

    // 回调通知调用方本次随机选中的机型 ID，便于批量场景去重
    if (typeof onRandomSelected === 'function') {
      try { onRandomSelected(finalModelId) } catch (e) { /* ignore */ }
    }
  }

  // 确保 Online 机型使用的是 ID 而不是 Name
  // 有些情况下 modelId 可能是 name (如果 el-select 绑定的是 id 但数据源里 id=name)
  // 如果是 Online 且 modelId 与某个机型的 name 相同但 id 不同，尝试找到正确的 id
  if (modelType === 'online' && phoneModels.value.length > 0) {
    // 优先在按版本过滤的列表中查找，避免跨版本同名机型匹配到错误的 modelId
    const foundModel = (androidVersion ? versionFilteredPhoneModels : phoneModels.value).find(m => m.id === finalModelId || m.name === finalModelId)
      || phoneModels.value.find(m => m.id === finalModelId || m.name === finalModelId)
    if (foundModel) {
      // 如果找到了模型，确保使用其 ID
      // 注意：有些后端返回的数据可能 id 和 name 是一样的，这取决于后端实现
      // 但如果不一样，我们必须使用 id
      if (foundModel.id !== finalModelId) {
        console.log(`[switchCloudMachineModel] 修正 modelId: ${finalModelId} -> ${foundModel.id} (name: ${foundModel.name})`)
        finalModelId = foundModel.id
      }
      finalModelName = foundModel.name
    }
  }
  
  try {
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
    
    // 根据设备版本确定API端口和端点
    const port = device.version === 'v3' ? '8000' : '81'
    const apiEndpoint = device.version === 'v3' 
      ? `/android/switchModel` 
      : `/android/container/${containerName}/switchModel`
    
    // 准备请求数据
    const requestData = {
      name: containerName,
      modelId: ''
    }
    
    // V3设备需要添加更多参数
    if (device.version === 'v3') {
      Object.assign(requestData, {
        modelName: finalModelName,
        localModel: '',
        modelStatic: '',
        latitude: 0,
        longitude: 0,
        locateIp: '',
        locateQueryMethod: 'ip-api',
        countryCode: countryCode || 'CN'
      })
      
      // 根据类型设置参数
      if (modelType === 'local') {
        requestData.localModel = finalModelId
      } else if (modelType === 'backup') {
        requestData.modelStatic = finalModelId
      } else {
        requestData.modelId = finalModelId
      }
    } else {
      // V0-V2 只有 modelId
      requestData.modelId = finalModelId
    }
    
    // 调用切换机型API
    const response = await axios.post(
      `http://${device.version === 'v3' ? getDeviceAddr(device.ip) : device.ip + ':' + port}${apiEndpoint}`,
      requestData,
      { headers: headers }
    )
    
    // 解析响应数据
    if (response.data.code === 0) {
      console.log(`云机 ${containerName} 切换机型成功: ${modelName}`)
      return true
    } else if (response.data.code === 61 && response.data.message === 'Authentication Failed') {
      // 认证失败，显示认证对话框
      return new Promise((resolve, reject) => {
        showAuthDialog(device, async (password) => {
          try {
            const auth = btoa(`admin:${password}`)
            
            // 准备认证重试的请求数据
            const authRequestData = {
              name: containerName,
              modelId: finalModelId
            }
            
            // V3设备需要添加更多参数
            if (device.version === 'v3') {
              Object.assign(authRequestData, {
                modelName: finalModelName,
                localModel: '',
                modelStatic: '',
                latitude: 0,
                longitude: 0,
                locateIp: '',
                locateQueryMethod: 'ip-api',
                countryCode: countryCode || 'CN'
              })
            }
            
            const authResponse = await axios.post(
              `http://${device.version === 'v3' ? getDeviceAddr(device.ip) : device.ip + ':' + port}${apiEndpoint}`,
              authRequestData,
              { 
                headers: {
                  'Authorization': `Basic ${auth}`
                }
              }
            )
            
            if (authResponse.data.code === 0) {
              console.log(`云机 ${containerName} 切换机型成功: ${modelName}`)
              resolve(true)
            } else {
              console.error(`切换机型失败: ${authResponse.data.message}`)
              reject(new Error(authResponse.data.message || '切换机型失败'))
            }
          } catch (error) {
            console.error(`切换云机机型失败: ${error.message}`)
            reject(error)
          }
        })
      })
    } else {
      console.error(`切换机型失败: ${response.data.message}`)
      throw new Error(response.data.message || '切换机型失败')
    }
  } catch (error) {
    console.error(`切换云机机型失败: ${error.message}`)
    throw error
  }
}

// 获取机型国家列表
const getCountryList = async (deviceIP) => {
  try {
    countryListLoading.value = true
    // 尝试使用已保存的密码
    const savedPassword = getDevicePassword(deviceIP)
    let headers = {}
    
    if (savedPassword) {
      // 添加认证头
      const auth = btoa(`admin:${savedPassword}`)
      headers = {
        'Authorization': `Basic ${auth}`
      }
    }
    
    const response = await axios.get(`http://${getDeviceAddr(deviceIP)}/android/countryCode`, {
      headers: headers
    })
    
    // 解析响应数据
    if (response.data.code === 0 && response.data.data) {
      const result = response.data.data
      countryList.value = result.list || []
      console.log('获取机型国家列表成功，共', countryList.value.length, '个国家')
    } else if (response.data.code === 61 && response.data.message === 'Authentication Failed') {
      // 认证失败，显示认证对话框
      return new Promise((resolve, reject) => {
        showAuthDialog({ ip: deviceIP, version: 'v3' }, async (password) => {
          try {
            const auth = btoa(`admin:${password}`)
            const authResponse = await axios.get(`http://${getDeviceAddr(deviceIP)}/android/countryCode`, {
              headers: {
                'Authorization': `Basic ${auth}`
              }
            })
            
            if (authResponse.data.code === 0 && authResponse.data.data) {
              const result = authResponse.data.data
              countryList.value = result.list || []
              console.log('获取机型国家列表成功，共', countryList.value.length, '个国家')
              resolve(countryList.value)
            } else {
              ElMessage.error('获取机型国家列表失败: ' + (authResponse.data.message || '未知错误'))
              reject(new Error('获取机型国家列表失败'))
            }
          } catch (error) {
            console.error('获取机型国家列表失败:', error)
            ElMessage.error('获取机型国家列表失败: ' + error.message)
            reject(error)
          } finally {
            countryListLoading.value = false
          }
        })
      })
    } else {
      console.error('获取机型国家列表失败:', response.data.message)
      ElMessage.error('获取机型国家列表失败: ' + (response.data.message || '未知错误'))
    }
  } catch (error) {
    console.error('获取机型国家列表失败:', error)
    ElMessage.error('获取机型国家列表失败: ' + error.message)
  } finally {
    countryListLoading.value = false
  }
}

// 获取网络分组列表
const fetchVpcGroupList = async (deviceIP) => {
  try {
    const savedPassword = getDevicePassword(deviceIP)
    let headers = {}
    
    if (savedPassword) {
      const auth = btoa(`admin:${savedPassword}`)
      headers = {
        'Authorization': `Basic ${auth}`
      }
    }
    
    const response = await axios.get(`http://${getDeviceAddr(deviceIP)}/mytVpc/group`, {
      headers: headers
    })
    
    if (response.data.code === 0) {
      vpcGroupList.value = response.data.data?.list || []
    } else {
      console.error('获取分组列表失败:', response.data.message)
    }
  } catch (error) {
    console.error('获取分组列表失败:', error)
  }
}

// 处理分组选择变化
const handleSandboxModeChange = (val) => {
  if (!val) {
    createForm.value.containerDataDiskSize = ''
  } else {
    createForm.value.containerDataDiskSize = '16G'
  }
}

const handleVpcGroupChange = (groupId) => {
  createForm.value.vpcNodeId = ''
  createForm.value.vpcSelectMode = 'specified'
  updateImageForm.value.vpcNodeId = ''
  updateImageForm.value.vpcSelectMode = 'specified'
  
  if (!groupId) {
    vpcNodeList.value = []
    return
  }
  
  const selectedGroup = vpcGroupList.value.find(g => g.id === groupId)
  if (selectedGroup?.vpcs?.list) {
    vpcNodeList.value = selectedGroup.vpcs.list
  } else {
    vpcNodeList.value = []
  }
}

// 获取网卡列表
const fetchNetworkCards = async (ip) => {
  const deviceIP = typeof ip === 'string' ? ip : (createDevice.value ? createDevice.value.ip : null)
  if (!deviceIP) return
  // 根据创建类型决定使用哪个网卡类型字段
  const type = createForm.value.createType === 'container' 
    ? createForm.value.containerNetworkCardType 
    : createForm.value.networkCardType
  
  fetchingNetworkCards.value = true
  networkCardList.value = []
  hasMacVlan.value = false // 重置macVlan状态
  currentDeviceMacVlanInfo.value = { subnet: '', gw: '' } // 重置MacVlan信息
  
  try {
    const savedPassword = getDevicePassword(deviceIP)
    let headers = {}
    
    if (savedPassword) {
      const auth = btoa(`admin:${savedPassword}`)
      headers = {
        'Authorization': `Basic ${auth}`
      }
    }
    
    if (type === 'private') {
      const response = await axios.get(`http://${getDeviceAddr(deviceIP)}/mytBridge`, {
        headers: headers
      })
      
      if (response.data.code === 0) {
        networkCardList.value = (response.data.data?.list || []).map(item => ({
          label: item.name,
          value: item.name
        }))
      } else {
        console.error('获取私有网卡列表失败:', response.data.message)
        networkCardList.value = []
      }
      // 若当前已选网卡不在列表中（包括列表为空），则清空选择
      const validValues = networkCardList.value.map(c => c.value)
      if (updateImageForm.value.mytBridgeName && !validValues.includes(updateImageForm.value.mytBridgeName)) {
        updateImageForm.value.mytBridgeName = ''
      }
    } else {
      const response = await axios.get(`http://${getDeviceAddr(deviceIP)}/macvlan`, {
        headers: headers
      })
      
      if (response.data.code === 0) {
        const info = response.data.data
        
        // 检查macVlan字段
        if (info.macVlan !== null && info.macVlan !== undefined) {
          hasMacVlan.value = true
          
          // 解析MacVlan信息
          try {
            let macVlanData = info.macVlan
            if (typeof macVlanData === 'string') {
              macVlanData = JSON.parse(macVlanData)
            }
            
            // 提取subnet和gateway信息
            if (macVlanData && macVlanData.IPAM && Array.isArray(macVlanData.IPAM.Config) && macVlanData.IPAM.Config.length > 0) {
              currentDeviceMacVlanInfo.value.subnet = macVlanData.IPAM.Config[0].Subnet || ''
              currentDeviceMacVlanInfo.value.gw = macVlanData.IPAM.Config[0].Gateway || ''
            }
          } catch (parseError) {
            console.error('解析MacVlan信息失败:', parseError)
          }
        } else {
          hasMacVlan.value = false
        }
        
        const list = []
        if (info.netWork_eth0) {
          list.push({
            label: 'ETH0',
            value: 'eth0'
          })
        }
        if (info.network4g) {
          list.push({
            label: '4G',
            value: '4g'
          })
        }
        networkCardList.value = list
      } else {
        console.error('获取公有网卡信息失败:', response.data.message)
      }
    }
  } catch (error) {
    console.error('获取网卡列表失败:', error)
  } finally {
    fetchingNetworkCards.value = false
  }
}

// 获取网卡列表（更新镜像专用）
const fetchNetworkCardsForUpdate = async (deviceIP) => {
  if (!deviceIP) return
  
  const type = updateImageForm.value.networkCardType
  
  fetchingNetworkCards.value = true
  networkCardList.value = []
  hasMacVlan.value = false // 重置macVlan状态
  currentDeviceMacVlanInfo.value = { subnet: '', gw: '' } // 重置MacVlan信息
  
  try {
    const savedPassword = getDevicePassword(deviceIP)
    let headers = {}
    
    if (savedPassword) {
      const auth = btoa(`admin:${savedPassword}`)
      headers = {
        'Authorization': `Basic ${auth}`
      }
    }
    
    if (type === 'private') {
      const response = await axios.get(`http://${getDeviceAddr(deviceIP)}/mytBridge`, {
        headers: headers
      })
      
      if (response.data.code === 0) {
        networkCardList.value = (response.data.data?.list || []).map(item => ({
          label: item.name,
          value: item.name
        }))
      } else {
        console.error('获取私有网卡列表失败:', response.data.message)
        networkCardList.value = []
      }
      // 若当前已选网卡不在列表中（包括列表为空），则清空选择
      const validValues = networkCardList.value.map(c => c.value)
      if (updateImageForm.value.mytBridgeName && !validValues.includes(updateImageForm.value.mytBridgeName)) {
        updateImageForm.value.mytBridgeName = ''
      }
    } else {
      const response = await axios.get(`http://${getDeviceAddr(deviceIP)}/macvlan`, {
        headers: headers
      })
      
      if (response.data.code === 0) {
        const info = response.data.data
        
        // 检查macVlan字段
        if (info.macVlan !== null && info.macVlan !== undefined) {
          hasMacVlan.value = true
          
          // 解析MacVlan信息
          try {
            let macVlanData = info.macVlan
            if (typeof macVlanData === 'string') {
              macVlanData = JSON.parse(macVlanData)
            }
            
            // 提取subnet和gateway信息
            if (macVlanData && macVlanData.IPAM && Array.isArray(macVlanData.IPAM.Config) && macVlanData.IPAM.Config.length > 0) {
              currentDeviceMacVlanInfo.value.subnet = macVlanData.IPAM.Config[0].Subnet || ''
              currentDeviceMacVlanInfo.value.gw = macVlanData.IPAM.Config[0].Gateway || ''
            }
          } catch (parseError) {
            console.error('解析MacVlan信息失败:', parseError)
          }
        } else {
          hasMacVlan.value = false
        }
        
        const list = []
        if (info.netWork_eth0) {
          list.push({
            label: 'ETH0',
            value: 'eth0'
          })
        }
        if (info.network4g) {
          list.push({
            label: '4G',
            value: '4g'
          })
        }
        networkCardList.value = list
      } else {
        console.error('获取公有网卡信息失败:', response.data.message)
      }
    }
  } catch (error) {
    console.error('获取网卡列表失败:', error)
  } finally {
    fetchingNetworkCards.value = false
  }
}

// 处理网卡类型变化
const handleNetworkCardTypeChange = () => {
  if (createForm.value.networkCardType === 'public') {
    const version = createDeviceApiVersionNumber.value
    if (!version || version < 65) {
      ElMessage.warning('公有网卡需要SDK版本>65')
      createForm.value.networkCardType = 'private'
      createForm.value.mytBridgeName = ''
      createForm.value.macVlanIp = ''
      return
    }
    createForm.value.vpcGroupId = ''
    createForm.value.vpcNodeId = ''
  }
  createForm.value.mytBridgeName = ''
  createForm.value.macVlanIp = ''
  fetchNetworkCards()
}

// 处理容器模式网卡类型变化
const handleContainerNetworkCardTypeChange = () => {
  if (createForm.value.containerNetworkCardType === 'public') {
    const version = createDeviceApiVersionNumber.value
    if (!version || version < 65) {
      ElMessage.warning('公有网卡需要SDK版本>65')
      createForm.value.containerNetworkCardType = 'private'
      createForm.value.containerMytBridgeName = ''
      createForm.value.containerMacVlanIp = ''
      return
    }
    createForm.value.vpcGroupId = ''
    createForm.value.vpcNodeId = ''
    createForm.value.containerMytBridgeName = '' // 切换到公有网卡时清空私有网卡选择
  } else {
    createForm.value.containerMacVlanIp = '' // 切换到私有网卡时清空MacVlan IP
  }
  fetchNetworkCards()
}

// 处理更新镜像网卡类型变化
const handleUpdateNetworkCardTypeChange = () => {
  // 获取当前操作的设备IP
  const container = updateImageContainer.value
  let targetDevice = activeDevice.value
  if (cloudManageMode.value === 'batch' && container && container.deviceIp) {
    targetDevice = devices.value.find(d => d.ip === container.deviceIp) || { ip: container.deviceIp }
  } else if (!targetDevice && createDevice.value) {
    targetDevice = createDevice.value
  }

  if (updateImageForm.value.networkCardType === 'public') {
    let version = null
    if (targetDevice && targetDevice.id) {
      const cached = deviceVersionInfo.value.get(targetDevice.id)
      if (cached?.currentVersion) {
        version = parseFloat(cached.currentVersion)
      }
    }

    if (!version || version < 65) {
      ElMessage.warning('公有网卡需要SDK版本>65')
      updateImageForm.value.networkCardType = 'private'
      updateImageForm.value.mytBridgeName = ''
      updateImageForm.value.macVlanIp = ''
      return
    }
    updateImageForm.value.vpcGroupId = ''
    updateImageForm.value.vpcNodeId = ''
  }

  updateImageForm.value.mytBridgeName = ''
  updateImageForm.value.macVlanIp = ''
  
  if (targetDevice && targetDevice.ip) {
    fetchNetworkCardsForUpdate(targetDevice.ip)
  }
}

// 获取随机节点ID
const getRandomVpcNodeId = () => {
  if (!vpcNodeList.value || vpcNodeList.value.length === 0) {
    return null
  }
  
  const randomIndex = Math.floor(Math.random() * vpcNodeList.value.length)
  return vpcNodeList.value[randomIndex].id
}


// 从本地存储读取镜像列表
const getImageListFromLocal = () => {
  try {
    const saved = localStorage.getItem(IMAGE_CACHE_KEY)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (error) {
    console.error('读取本地镜像列表缓存失败:', error)
  }
  return []
}

// 将镜像列表保存到本地存储
const saveImageListToLocal = (data) => {
  try {
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(data))
    localStorage.setItem(IMAGE_CACHE_LAST_UPDATE_KEY, Date.now().toString())
  } catch (error) {
    console.error('保存镜像列表到本地缓存失败:', error)
  }
}

// 检查是否需要更新镜像列表
const shouldUpdateImageList = () => {
  try {
    const lastUpdate = localStorage.getItem(IMAGE_CACHE_LAST_UPDATE_KEY)
    if (!lastUpdate) {
      return true // 没有上次更新时间，需要更新
    }
    const now = Date.now()
    return now - parseInt(lastUpdate) > IMAGE_CACHE_DURATION
  } catch (error) {
    console.error('检查是否需要更新镜像列表失败:', error)
    return true // 出错时需要更新
  }
}

// 获取镜像列表，使用本地缓存，自动更新
const fetchImageList = async (deviceType) => {
  try {
    fetchingImages.value = true
    
    // 从本地存储加载镜像列表
    let localImages = getImageListFromLocal()
    
    // 首先使用本地缓存的数据
    if (localImages.length > 0) {
      // console.log('使用本地缓存的镜像列表，共', localImages.length, '个镜像')
      imageList.value = localImages
      filterImageList(deviceType)
      await categorizeOnlineImages() // 按型号分类在线镜像
    } else {
      // 本地缓存为空，使用默认镜像
      // console.log('本地缓存为空，使用默认镜像列表')
      imageList.value = [
        { name: 'registry.magicloud.tech/magicloud/dobox-android13:Q1', url: 'registry.magicloud.tech/magicloud/dobox-android13:Q1' }
      ];
      filterImageList(deviceType);
      await categorizeOnlineImages() // 按型号分类在线镜像
    }
    
    // 无论是否需要更新，都尝试联网更新本地缓存（后台自动更新）
    try {
      console.log('尝试联网更新镜像列表...')
      
      // 使用Wails IPC调用后端GetMirrorList函数获取镜像列表
      const response = await GetMirrorList()
      
      // console.log('获取镜像列表成功，返回数据:', response)
      
      // 处理响应数据
      if (response.code === '200' && response.data && Array.isArray(response.data)) {
        // 对数据按ID降序排序
        const sortedData = [...response.data].sort((a, b) => {
          const idA = parseInt(a.id) || 0
          const idB = parseInt(b.id) || 0
          return idB - idA
        })
        
        // 保存到本地存储
        saveImageListToLocal(sortedData)
        
        // 更新镜像列表
        imageList.value = sortedData
        // console.log('更新镜像列表成功，共', imageList.value.length, '个镜像')
        
        // 过滤匹配当前设备类型的镜像
        filterImageList(deviceType)
        // 按型号分类在线镜像
        await categorizeOnlineImages()
      } else {
        console.error('获取镜像列表失败: 无效的返回数据');
        ElMessage.warning('无法联网获取最新镜像列表，使用本地缓存！')
      }
    } catch (error) {
      console.error('更新镜像列表失败:', error)
      ElMessage.warning('无法联网获取最新镜像，使用本地缓存老镜像列表！')
    }
  } catch (error) {
    console.error('获取镜像列表失败:', error)
    ElMessage.error('获取镜像列表失败: ' + error.message)
  } finally {
    fetchingImages.value = false
  }
}

// 获取兼容的设备类型列表，参考api/main.go中的getCompatibleTypes实现
const getCompatibleTypes = (deviceType) => {
  switch (deviceType) {
    case 'q1_10':
    case 'c1_10':
      return ['q1_10', 'c1_10']
    case 'q1':
    case 'C1':
    case '': // 空值处理为C1
      return ['q1', 'C1']
    case 'r1_v3':
      return ['r1_v3', 'q1_v3', 'c1_v3']
    case 'c1_v3':
      return ['c1_v3', 'q1_v3', 'r1_v3']
    default:
      return [deviceType]
  }
}

// 过滤镜像列表，根据ttype匹配设备型号_版本
const filterImageList = (deviceType) => {
  if (!deviceType) {
    filteredImageList.value = imageList.value
    console.log('设备类型为空，返回所有镜像，共', filteredImageList.value.length, '个')
    return
  }
  
  // console.log('正在过滤镜像列表，设备类型:', deviceType)
  
  // 获取兼容的设备类型列表
  const compatibleTypes = getCompatibleTypes(deviceType)
  // console.log('兼容的设备类型:', compatibleTypes)
  
  // 过滤镜像列表，检查ttype和ttype2字段是否包含设备型号_版本
  filteredImageList.value = imageList.value.filter(image => {

  if(image.sys_ver != 5) {
    // 特质版镜像 sys_ver=4 也需要保留，用于特质镜像分类
    if (!(image.sys_ver == 4 && image.sys_ver_des === '特质版')) {
      return false
    }
   }
  //  console.log('正在检查镜像:', image)
    // 检查ttype字段
    if (image.ttype && compatibleTypes.includes(image.ttype)) {
      return true
    }

    // 检查ttype2字段（数组）
    if (Array.isArray(image.ttype2)) {
      for (const t of image.ttype2) {
        if (compatibleTypes.includes(t)) {
          return true
        }
      }
    }

    // 没有匹配的ttype或ttype2字段，过滤掉
    return false
  })
  
  // console.log('过滤镜像列表成功，共', filteredImageList.value.length, '个镜像')
  
  // 如果过滤后没有镜像，添加默认镜像
  if (filteredImageList.value.length === 0) {
    // console.log('过滤后没有匹配的镜像，添加默认镜像')
    filteredImageList.value = [
      { name: 'registry.magicloud.tech/magicloud/dobox-android13:Q1', url: 'registry.magicloud.tech/magicloud/dobox-android13:Q1' }
    ];
  }

  // 默认选中留给 watcher 处理（会经过安卓版本过滤）
}

// 监听 filteredImageList 变化，自动选中第一条（按镜像分类过滤后）
watch(filteredImageList, () => {
  if (createForm.value.imageCategory === 'online' && createForm.value.createType !== 'container') {
    const filtered = androidVersionFilteredImageList.value
    if (filtered && filtered.length > 0) {
      createForm.value.imageSelect = filtered[0].url
    } else {
      createForm.value.imageSelect = ''
    }
  }
}, { immediate: true })

// 特质镜像分类切换逻辑
watch(() => createForm.value.imageCategory, (newCat, oldCat) => {
  if (newCat === 'online' || newCat === 'special') {
    const filtered = currentCategoryImageList.value
    createForm.value.imageSelect = (filtered && filtered.length > 0) ? filtered[0].url : ''
  }
  // 特质镜像 + 安卓15 + 在线机型 时绑定 Samsung_S24
  if (newCat === 'special') {
    if (createForm.value.androidVersion === '15' && createForm.value.modelType === 'online') {
      createForm.value.modelName = 'Samsung_S24'
    }
  }
  // 从特质镜像切回其他分类时，恢复随机机型
  if (oldCat === 'special' && newCat !== 'special') {
    if (createForm.value.modelName === 'Samsung_S24') {
      createForm.value.modelName = 'random'
    }
  }
})

// 特质镜像是否需要锁定 Samsung_S24：仅安卓15 + 在线机型
const isSpecialModelLocked = computed(() => {
  return createForm.value.imageCategory === 'special'
    && createForm.value.androidVersion === '15'
    && createForm.value.modelType === 'online'
})

// 按型号分类在线镜像
const categorizeOnlineImages = async () => {
  const imagesByModel = new Map()
  let firstModel = null // 记录第一个出现的型号
  
  imageList.value.forEach(image => {
    // 检查 ttype2 数组，如果是 Q1 或 P1 则添加到对应分类
    if (Array.isArray(image.ttype2)) {
      // 按优先级处理：P1优先于Q1（按定义顺序）
      const models = []
      if (image.ttype2.includes('p1_v3')) {
        models.push('P1')
      }
      if (image.ttype2.includes('q1_v3')) {
        models.push('Q1')
      }
      if (image.ttype2.includes('r1_v3')) {
        models.push('R1')
      }
      if (image.ttype2.includes('c1_v3')) {
        models.push('C1')
      }
      
      // 处理该镜像属于的所有型号
      models.forEach(displayModel => {
        if (!imagesByModel.has(displayModel)) {
          imagesByModel.set(displayModel, [])
          // 记录第一个出现的型号
          if (!firstModel) {
            firstModel = displayModel
          }
        }
        imagesByModel.get(displayModel).push(image)
      })
    }
  })
  
  onlineImagesByModel.value = imagesByModel
  // console.log('按型号分类在线镜像成功，共', imagesByModel.size, '个型号')
  
  // 自动选中第一个标签（使用记录的第一个型号）
  if (imagesByModel.size > 0 && !currentOnlineImageModel.value) {
    currentOnlineImageModel.value = firstModel || Array.from(imagesByModel.keys())[0]
    console.log('自动选中第一个型号:', currentOnlineImageModel.value)
  }
  
  // 检查每个在线镜像的下载状态
  await checkAllImagesDownloadStatus()
}

// 获取本地缓存镜像列表
const fetchLocalCachedImages = async () => {
  try {
    isLoadingLocalImages.value = true
    // console.log('获取本地缓存镜像列表')
    
    // 使用Wails的原生通信方式，获取本地镜像列表
    const localImages = await GetLocalImages()
    // console.log('获取本地缓存镜像列表成功，返回数据:', localImages)
    
    // 处理返回的本地镜像数据
    let processedImages = await Promise.all(localImages.map(async image => {
      // 移除available_models中的重复型号
      const uniqueModels = Array.from(new Set(image.available_models || []))
      
      // 获取基础镜像名称（去掉.tar.gz后缀）
      const baseName = image.name.replace('.tar.gz', '')
      
      // 优先使用从JSON文件中获取的镜像名称
      let displayName = image.image_name || baseName
      
      // 检查是否是特别版镜像
      if (baseName.includes('特别版')) {
        // 特别版镜像处理：从文件路径中提取设备型号标识
        // 例如：从 "dobox-P14_v3_all_202601091434.tar.gz" 中提取 "P14_v3"
        const fileName = image.name
        const modelMatch = fileName.match(/dobox-(\w+_v\d+)_all_/)
        if (modelMatch && modelMatch[1]) {
          // 添加设备型号到特别版镜像名称中
          displayName = `${baseName} (${modelMatch[1]})`
        } else {
          // 如果无法提取型号，使用原始名称
          displayName = baseName
        }
      } else {
        // 非特别版镜像尝试匹配在线镜像列表中的名称
        // 遍历在线镜像列表，查找匹配的镜像
        for (const onlineImage of imageList.value) {
          // 从在线镜像URL中提取关键信息用于匹配
          const onlineImageUrl = onlineImage.url
          
          // 提取在线镜像的关键标识（支持多种URL格式）
          let onlineImageKey = onlineImageUrl
          if (onlineImageUrl.includes('/')) {
            onlineImageKey = onlineImageUrl.split('/').pop()
          }
          
          // 提取镜像的基础名称（不含标签）
          const onlineImageBase = onlineImageKey.split(':')[0]
          
          // 提取镜像的完整标识（包含标签）
          const onlineImageFull = onlineImageKey
          // console.log('onlineImageFull', onlineImageFull)
          
          // 三种匹配方式，优先级递减：
          // 1. 本地镜像名称包含在线镜像的完整标识
          // 2. 本地镜像名称包含在线镜像的基础名称
          // 3. 在线镜像URL包含本地镜像名称的关键部分
          // if (baseName.includes(onlineImageFull) || 
          //     baseName.includes(onlineImageBase) ||
          //     onlineImageUrl.includes(baseName)) {
          //   // 如果找到匹配项，使用在线镜像的名称
          //   displayName = onlineImage.name
          //   break
          // }
        }
      }

      console.log('baseName:', baseName, 'displayName:', displayName, 'image_name:', image.image_name)
      
      return {
        name: displayName, // 优先使用JSON文件中的名称，其次是在线镜像名称，否则使用文件名
        originalName: baseName, // 保存原始文件名，用于参考
        path: image.path, // 镜像文件路径（保留原始path属性，用于删除操作）
        url: image.path, // 镜像文件路径（兼容原有代码）
        size: image.size, // 镜像大小
        createTime: new Date(image.createTime).toLocaleString(), // 创建时间
        availableModels: uniqueModels, // 去重后的可用设备型号
        onlineUrl: image.online_url || '' // 从JSON metadata读取的在线镜像地址
      }
    }))
    
    localCachedImages.value = processedImages
    
    console.log('获取本地缓存镜像列表成功，共', localCachedImages.value.length, '个镜像')
  } catch (error) {
    console.error('获取本地缓存镜像列表失败:', error)
    ElMessage.error('获取本地缓存镜像列表失败: ' + error.message)
    // 失败时使用空数组，不显示模拟数据
    localCachedImages.value = []
  } finally {
    isLoadingLocalImages.value = false
  }
}

// 处理原始设备镜像数据
const processRawDeviceImages = (deviceImages) => {
    if (Array.isArray(deviceImages)) {
      return deviceImages
        .map(image => {
        // 处理RepoTags数组，获取第一个标签作为镜像名称
        let imageName = '未知镜像'
        let imageUrl = ''
        if (Array.isArray(image.imageUrl) && image.imageUrl.length > 0) {
          imageName = image.imageUrl[0]
          imageUrl = image.imageUrl[0]
        } else if (Array.isArray(image.Image) && image.Image.length > 0) {
          imageName = image.Image[0]
          imageUrl = image.Image[0]
        } else if (image.imageUrl) {
          imageName = image.imageUrl
          imageUrl = image.imageUrl
        } else if (image.Image) {
          imageName = image.Image
          imageUrl = image.Image
        } else if (image.id || image.Id) {
          // 如果所有名称字段都为空，使用镜像ID的前12位作为名称
          const imageId = image.id || image.Id
          imageName = `镜像-${imageId.substring(0, 12)}`
          imageUrl = imageId
        }
        
        // 处理大小字段，转换为人类可读的格式
        let size = '未知大小'
        if (image.size) {
          if (typeof image.size === 'number') {
            size = formatFileSize(image.size)
          } else {
            size = image.size
          }
        }
        
        // 处理创建时间字段
        let createTime = '未知时间'
        if (image.createTime) {
          if (typeof image.createTime === 'number') {
            // 检查是否是秒级时间戳（Docker API返回的是秒）
            if (image.createTime < 10000000000) {
              // 秒级时间戳，转换为毫秒
              createTime = new Date(image.createTime * 1000).toLocaleString()
            } else {
              // 毫秒级时间戳
              createTime = new Date(image.createTime).toLocaleString()
            }
          } else {
            createTime = image.createTime
          }
        }
        
        return {
          name: imageName,
          url: imageUrl,
          size: size,
          createTime: createTime,
          original: image
        }
      })
      // 过滤掉没有有效名称和URL的镜像
      .filter(image => {
        // 确保name和url是字符串类型，然后再调用trim()方法
        const validName = typeof image.name === 'string' && image.name.trim() !== ''
        const validUrl = typeof image.url === 'string' && image.url.trim() !== ''
        return validName && validUrl
      })
    } else {
      return []
    }
}

// 获取盒子镜像列表（设备上存在的镜像）
const fetchBoxImages = async () => {
  if (!activeDevice.value) {
    boxImages.value = []
    return
  }
  
  try {
    isLoadingBoxImages.value = true
    console.log('获取盒子镜像列表，设备:', activeDevice.value.ip)
    
    // 使用Wails的原生通信方式，获取设备上的镜像列表
    // 从本地存储获取密码
    const savedPassword = getDevicePassword(activeDevice.value.ip);
    const deviceImages = await GetImages(activeDevice.value.ip, activeDevice.value.version, savedPassword || '')
    console.log('获取盒子镜像列表成功，返回数据:', deviceImages)
    
    // 处理返回的设备镜像数据
    boxImages.value = processRawDeviceImages(deviceImages)
    
    console.log('获取盒子镜像列表成功，共', boxImages.value.length, '个镜像')
    
    // 检查在线镜像的上传状态：如果盒子中有这个在线镜像，就说明是已上传的
    await checkOnlineImagesUploadStatus()
  } catch (error) {
    console.error('获取盒子镜像列表失败:', error)
    ElMessage.error('获取盒子镜像列表失败: ' + error.message)
    boxImages.value = []
  } finally {
    isLoadingBoxImages.value = false
  }
}

// 检查在线镜像的上传状态：如果盒子中有这个在线镜像，就说明是已上传的
const checkOnlineImagesUploadStatus = async () => {
  try {
    console.log('开始检查在线镜像的上传状态')
    
    // 清空当前上传状态
    imageUploadStatus.value.clear()
    
    // 遍历所有在线镜像
    for (const [model, images] of onlineImagesByModel.value.entries()) {
      for (const image of images) {
        // 只检查已下载的镜像
        if (imageDownloadStatus.value.get(image.url)) {
          // 检查盒子中是否有这个镜像
          const isUploaded = await checkImageInBox(image)
          imageUploadStatus.value.set(image.url, isUploaded)
        }
      }
    }
    
    console.log('检查在线镜像的上传状态完成')
  } catch (error) {
    console.error('检查在线镜像的上传状态失败:', error)
  }
}

// 检查在线镜像是否在盒子中
const checkImageInBox = async (image) => {
  try {
    // 从在线镜像URL中提取镜像名称
    const imageUrl = image.url
    console.log('检查镜像是否在盒子中:', imageUrl)
    
    // 提取镜像名称（去掉registry部分）
    let imageName = imageUrl
    if (imageUrl.includes('/')) {
      // 例如：registry.cn-guangzhou.aliyuncs.com/mytos/dobox:P14_v3_all_202512312124
      // 提取为：mytos/dobox:P14_v3_all_202512312124
      const parts = imageUrl.split('/')
      imageName = parts.slice(1).join('/')
    }
    
    console.log('提取的镜像名称:', imageName)
    
    // 遍历盒子镜像列表
    for (const boxImage of boxImages.value) {
      console.log('盒子镜像:', boxImage.name)
      // 检查盒子镜像名称是否包含在线镜像名称的关键部分
      if (boxImage.name.includes(imageName) || 
          boxImage.name.includes(imageName.replace(':', '_')) ||
          boxImage.name.includes(imageName.split('/').pop())) {
        console.log('镜像在盒子中找到:', imageName)
        return true
      }
    }
    
    console.log('镜像在盒子中未找到:', imageName)
    return false
  } catch (error) {
    console.error('检查镜像是否在盒子中失败:', error)
    return false
  }
}

// 下载在线镜像到本地
const downloadOnlineImage = async (image) => {
  try {
    // 如果已有下载任务正在进行，先完全清理旧状态
    if (isDownloadingImage.value || currentDownloadTaskId.value) {
      console.log('检测到旧的下载任务，彻底清理状态')
      const oldTaskId = currentDownloadTaskId.value
      
      // 立即清空所有状态
      isDownloadingImage.value = false
      currentDownloadImage.value = null
      currentDownloadTaskId.value = null
      downloadProgress.value = 0
      downloadStartTime.value = 0
      
      // 取消旧任务
      if (oldTaskId) {
        const oldTask = taskQueue.value.find(t => t.id === oldTaskId)
        if (oldTask && oldTask.status === 'running') {
          oldTask.status = 'canceled'
          oldTask.endTime = new Date()
          oldTask.progress = 0
        }
      }
      
      // 延长等待时间，确保后端旧任务的事件不会影响新任务
      // 这个延迟很重要，给后端足够的时间停止发送旧事件
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    
    // 生成新的下载会话时间戳
    const sessionStartTime = Date.now()
    downloadStartTime.value = sessionStartTime
    
    console.log('==================== 开始新的下载任务 ====================')
    console.log('镜像名称:', image.name)
    console.log('镜像URL:', image.url)
    console.log('会话时间戳:', sessionStartTime)
    
    // 添加下载任务到任务队列
    const taskId = addTaskToQueue('downloadImage', [{ imageUrl: image.url, imageName: image.name }], {
      imageName: image.name,
      imageUrl: image.url,
      sessionStartTime: sessionStartTime  // 保存会话时间戳到任务元数据
    })
    
    console.log('创建任务ID:', taskId)
    
    // 关键：先设置所有状态，再执行任务
    currentDownloadTaskId.value = taskId
    currentDownloadImage.value = image
    isDownloadingImage.value = true
    downloadProgress.value = 0
    
    console.log('当前下载任务ID已设置:', currentDownloadTaskId.value)
    console.log('当前下载镜像URL:', currentDownloadImage.value?.url)
    
    // 执行下载任务，设置状态为running
    executeTask(taskId)
    
    // 使用Wails的原生通信方式，调用后端下载镜像，传递完整的镜像元数据
    const result = await DownloadImage(image)
    console.log('下载镜像请求结果:', result)
    
    // 注意：这里不再需要轮询获取进度，进度会通过事件监听自动更新
    // 下载结果也会通过事件监听处理
  } catch (error) {
    console.error('下载镜像请求失败:', error)
    ElMessage.error(`下载镜像请求失败: ${error.message}`)
    
    // 出错时彻底清理状态
    isDownloadingImage.value = false
    currentDownloadImage.value = null
    currentDownloadTaskId.value = null
    downloadProgress.value = 0
    downloadStartTime.value = 0
  }
}

// 检查镜像是否已下载
const checkImageDownloadStatus = async (imageUrl) => {
  try {
    const result = await IsImageDownloaded(imageUrl)
    // console.log('检查镜像下载状态:', imageUrl, result)
    imageDownloadStatus.value.set(imageUrl, result.downloaded)
    return result.downloaded
  } catch (error) {
    console.error('检查镜像下载状态失败:', error)
    return false
  }
}

// 检查所有在线镜像的下载状态
const checkAllImagesDownloadStatus = async () => {
  try {
    console.log('开始检查所有在线镜像的下载状态')
    for (const [model, images] of onlineImagesByModel.value.entries()) {
      for (const image of images) {
        await checkImageDownloadStatus(image.url)
      }
    }
    console.log('检查所有在线镜像的下载状态完成')
  } catch (error) {
    console.error('检查所有在线镜像的下载状态失败:', error)
  }
}

// 检查镜像的上传状态
const checkImageUploadStatus = async (imageUrl) => {
  try {
    if (!activeDevice.value) {
      return false
    }
    
    // 获取本地镜像路径
    const result = await IsImageDownloaded(imageUrl)
    if (!result.downloaded || !result.local_path) {
      return false
    }
    
    const localPath = result.local_path
    const imageName = localPath.split('\\').pop().split('/').pop().replace('.tar.gz', '')
    
    // 获取设备上的镜像列表
    // 从本地存储获取密码
    const savedPassword = getDevicePassword(activeDevice.value.ip);
    const boxImages = await GetImages(activeDevice.value.ip, activeDevice.value.version, savedPassword || '')
    console.log('设备上的镜像列表:', boxImages)
    
    // 检查镜像是否在设备上
    let isUploaded = false
    if (Array.isArray(boxImages)) {
      for (const img of boxImages) {
        let imgName = ''
        if (Array.isArray(img.imageUrl) && img.imageUrl.length > 0) {
          imgName = img.imageUrl[0]
        } else if (Array.isArray(img.Image) && img.Image.length > 0) {
          imgName = img.Image[0]
        } else if (img.imageUrl) {
          imgName = img.imageUrl
        } else if (img.Image) {
          imgName = img.Image
        }
        
        // 检查镜像名称是否匹配
        if (imgName.includes(imageName)) {
          isUploaded = true
          break
        }
      }
    }
    
    // 更新上传状态
    imageUploadStatus.value.set(imageUrl, isUploaded)
    return isUploaded
  } catch (error) {
    console.error('检查镜像上传状态失败:', error)
    return false
  }
}

// 上传镜像到设备
// 设备选择对话框状态
const showDeviceSelectionDialog = ref(false)
const selectedDevicesForUpload = ref([])
const currentUploadingImage = ref(null)
const isUploadingToMultipleDevices = ref(false)

// 计算属性：与当前上传镜像兼容的设备列表
const compatibleDevicesForUpload = computed(() => {
  // 添加调试信息
  console.log('compatibleDevicesForUpload 计算属性执行中:')
  console.log('设备列表:', devices.value)
  console.log('设备列表类型:', typeof devices.value)
  console.log('设备列表长度:', Array.isArray(devices.value) ? devices.value.length : '不是数组')
  console.log('当前上传镜像:', currentUploadingImage.value)
  
  // 确保设备列表是数组
  if (!Array.isArray(devices.value)) {
    console.log('设备列表不是数组，返回空数组')
    return []
  }
  
  // 如果没有设备，直接返回空数组
  if (devices.value.length === 0) {
    console.log('没有设备，返回空数组')
    return []
  }
  
  // 如果没有选择镜像，显示所有设备
  if (!currentUploadingImage.value) {
    console.log('没有选择镜像，返回所有设备')
    return [...devices.value]
  }
  
  const image = currentUploadingImage.value
  let imageModels = []
  
  // 安全处理镜像的兼容性信息
  if (Array.isArray(image.availableModels)) {
    imageModels = image.availableModels
    console.log('镜像 availableModels:', image.availableModels)
  } else {
    // 处理在线镜像的兼容性信息
    if (typeof image.ttype === 'string' && image.ttype.trim()) {
      imageModels.push(image.ttype)
      console.log('添加ttype到imageModels:', image.ttype)
    }
    if (Array.isArray(image.ttype2)) {
      const validTypes = image.ttype2.filter(type => typeof type === 'string' && type.trim())
      imageModels = [...imageModels, ...validTypes]
      console.log('ttype2数组:', image.ttype2)
      console.log('ttype2中有效类型:', validTypes)
    }
    console.log('镜像 ttype:', image.ttype)
    console.log('镜像 ttype2:', image.ttype2)
    console.log('镜像支持的设备型号:', imageModels)
  }
  
  // 如果镜像没有指定可用型号，则显示所有设备
  if (imageModels.length === 0) {
    console.log('镜像没有指定可用型号，返回所有设备')
    return [...devices.value]
  }
  
  // 过滤与镜像兼容的设备
  const compatibleDevices = devices.value.filter(device => {
    // 安全获取设备型号
    const deviceType = typeof device === 'object' && device !== null ? device.name || '' : ''
    console.log('检查设备:', deviceType, '设备ID:', device?.id, '设备IP:', device?.ip)
    
    // 检查每个模型是否匹配
    const isCompatible = imageModels.some(model => {
      // 标准化模型名称：去除空格，替换下划线为破折号，转为小写
      const normalizeName = (name) => {
        return name?.trim().replace(/_/g, '-').toLowerCase() || ''
      }
      
      const normalizedModel = normalizeName(model)
      const normalizedDeviceType = normalizeName(deviceType)
      const matches = normalizedModel === normalizedDeviceType
      
      console.log('  检查模型:', model, '(标准化:', normalizedModel, ') 与设备型号:', deviceType, '(标准化:', normalizedDeviceType, ') 匹配:', matches)
      return matches
    })
    
    console.log('  设备', deviceType, '兼容:', isCompatible)
    return isCompatible
  })
  
  console.log('兼容设备列表:', compatibleDevices)
  console.log('兼容设备列表长度:', compatibleDevices.length)
  
  // 将结果转换为普通数组，并且将数组中的每个设备对象也转换为普通对象，确保UI能够正确识别
  const resultArray = compatibleDevices.map(device => {
    // 将设备对象转换为普通对象
    return {
      ...device,
      id: device.id,
      name: device.name,
      ip: device.ip,
      port: device.port,
      version: device.version
    }
  })
  
  console.log('转换为普通数组和普通对象后的结果:', resultArray)
  console.log('转换后数组长度:', resultArray.length)
  
  return resultArray
})

const uploadImageToDevice = async (image) => {
  try {
    // 检查镜像是否已下载
    const downloadStatus = await checkImageDownloadStatus(image.url)
    if (!downloadStatus) {
      ElMessage.error('镜像未下载到本地，请先下载')
      return
    }
    
    // 获取本地镜像路径
    const result = await IsImageDownloaded(image.url)
    if (!result.downloaded || !result.local_path) {
      ElMessage.error('无法获取本地镜像路径')
      return
    }
    
    // 显示设备选择对话框,设置localPath与本地镜像一致
    currentUploadingImage.value = {
      ...image,
      localPath: result.local_path
    }
    selectedDevicesForUpload.value = []
    showDeviceSelectionDialog.value = true
  } catch (error) {
    console.error('上传镜像到设备失败:', error)
    ElMessage.error('操作失败')
  }
}

// 设备选择表格的引用
const deviceSelectionTableRef = ref(null)

// 刷新上传设备列表的状态
const refreshingDevicesForUpload = ref(false)

// 刷新上传设备列表
const refreshDeviceListForUpload = async () => {
  try {
    refreshingDevicesForUpload.value = true
    // 等待一下，确保获取最新状态
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // 📊 诊断信息
    console.log('========== 设备列表诊断 ==========')
    console.log('总设备数:', devices.value.length)
    console.log('兼容设备数:', compatibleDevicesForUpload.value.length)
    console.log('在线兼容设备数:', sortedCompatibleDevicesList.value.length)
    
    // 统计各状态设备数量
    const statusCount = { online: 0, offline: 0, unknown: 0 }
    devices.value.forEach(device => {
      const status = devicesStatusCache.value.get(device.id)
      if (status === 'online') statusCount.online++
      else if (status === 'offline') statusCount.offline++
      else statusCount.unknown++
    })
    console.log('状态统计:', statusCount)
    
    // 列出离线但 isOnline=true 的设备（数据不一致）
    const inconsistentDevices = devices.value.filter(device => {
      const status = devicesStatusCache.value.get(device.id)
      return device.isOnline && status !== 'online'
    })
    if (inconsistentDevices.length > 0) {
      console.warn('⚠️ 发现状态不一致的设备:', inconsistentDevices.map(d => `${d.ip} (isOnline=true, status=${devicesStatusCache.value.get(d.id)})`))
    }
    console.log('==================================')
    
    ElMessage.success(`已刷新设备列表，当前在线设备: ${sortedCompatibleDevicesList.value.length} 台`)
  } catch (error) {
    console.error('刷新设备列表失败:', error)
    ElMessage.error('刷新设备列表失败: ' + error.message)
  } finally {
    refreshingDevicesForUpload.value = false
  }
}

// 处理上传设备选择变化
const handleUploadDeviceSelectionChange = (selection) => {
  selectedDevicesForUpload.value = selection
}

// 检查设备是否可选择（仅在线设备可选）
const checkDeviceSelectable = (row) => {
  return devicesStatusCache.value.get(row.id) === 'online'
}

// 获取设备行的class名称（离线设备灰色）
const getDeviceRowClassName = ({ row }) => {
  return devicesStatusCache.value.get(row.id) !== 'online' ? 'device-offline-row' : ''
}

// 获取设备存储信息（用于上传设备选择表格）
const getDeviceStorageInfo = (deviceId) => {
  const firmwareInfo = deviceFirmwareInfo.value.get(deviceId)
  if (!firmwareInfo?.originalData) {
    return null
  }
  
  const total = Number(firmwareInfo.originalData.mmctotal) || 0
  const used = Number(firmwareInfo.originalData.mmcuse) || 0
  
  if (total === 0) {
    return null
  }
  
  const free = total - used
  const freeGb = free / 1024
  const freeText = freeGb >= 1 ? `${freeGb.toFixed(1)} GB` : `${free.toFixed(0)} MB`
  
  return {
    total,
    used,
    free,
    freeGb,
    freeText,
    isLow: freeGb < 10  // 可用空间小于10GB视为不足
  }
}

// 处理设备选择对话框关闭
const handleDeviceSelectionDialogClose = () => {
  // 清除选择状态
  selectedDevicesForUpload.value = []
  // 清除表格的选择状态
  if (deviceSelectionTableRef.value) {
    deviceSelectionTableRef.value.clearSelection()
  }
}

// 处理设备选择后上传镜像
const handleUploadAfterDeviceSelection = async () => {
  if (selectedDevicesForUpload.value.length === 0) {
    ElMessage.error('请选择至少一个设备')
    return
  }
  
  if (!currentUploadingImage.value) {
    ElMessage.error('请选择要上传的镜像')
    return
  }
  
  // 上传前再次检查设备在线状态
  const offlineDevices = selectedDevicesForUpload.value.filter(device => {
    const status = devicesStatusCache.value.get(device.id)
    return status !== 'online' && !device.isOnline
  })
  
  if (offlineDevices.length > 0) {
    const offlineIPs = offlineDevices.map(d => d.ip).join(', ')
    ElMessage.error(`以下设备已离线，无法上传: ${offlineIPs}`)
    return
  }
  
  // 创建上传镜像任务
  const taskId = addTaskToQueue('uploadImage', selectedDevicesForUpload.value, {
    imageName: currentUploadingImage.value.name,
    imagePath: currentUploadingImage.value.localPath || currentUploadingImage.value.url,
    imageSize: currentUploadingImage.value.size
  })
  
  try {
    showDeviceSelectionDialog.value = false
    isUploadingToMultipleDevices.value = true
    isUploadingImage.value = true
    currentUploadImage.value = currentUploadingImage.value
    uploadProgress.value = 0
    
    // 更新任务状态为运行中
    const task = taskQueue.value.find(t => t.id === taskId)
    if (task) {
      task.status = 'running'
      task.startTime = new Date()
    }
    
    console.log('开始批量上传镜像:', currentUploadingImage.value.name, '到设备:', selectedDevicesForUpload.value.map(d => d.ip))
    
    // 获取本地镜像路径
    let localPath = ''
    if (currentUploadingImage.value.localPath) {
      // 本地镜像直接使用本地路径
      localPath = currentUploadingImage.value.localPath
    } else {
      // 在线镜像需要获取下载路径
      const result = await IsImageDownloaded(currentUploadingImage.value.url)
      if (!result.downloaded || !result.local_path) {
        ElMessage.error('无法获取本地镜像路径')
        isUploadingImage.value = false
        currentUploadImage.value = null
        uploadProgress.value = 0
        isUploadingToMultipleDevices.value = false
        return
      }
      localPath = result.local_path
      
      // 更新任务的本地镜像路径
      const task = taskQueue.value.find(t => t.id === taskId)
      if (task) {
        task.imagePath = localPath
      }
    }
    
    // 批量上传到所选设备，按设备分组，同一设备的任务串行执行
    // 策略：不同设备可以并行，同一设备的任务必须串行
    
    // 按设备IP分组
    const devicesByIP = {}
    selectedDevicesForUpload.value.forEach(device => {
      if (!devicesByIP[device.ip]) {
        devicesByIP[device.ip] = []
      }
      devicesByIP[device.ip].push(device)
    })
    
    const deviceIPs = Object.keys(devicesByIP)
    const results = []
    let completedCount = 0
    const totalCount = selectedDevicesForUpload.value.length
    
    // 使用信号量控制并发设备数（最多2个设备同时上传）
    const maxConcurrentDevices = 2
    const runningCount = { value: 0 }
    
    // 串行执行同一设备的任务
    const processDeviceSerially = async (deviceIP, devices) => {
      for (const device of devices) {
        // 在每个设备上传前都检查任务是否已取消
        const checkTask = taskQueue.value.find(t => t.id === taskId)
        if (checkTask && checkTask.status === 'canceled') {
          console.log('[上传镜像] 任务已取消,停止上传设备:', device.ip)
          // 将剩余设备标记为已取消,不上传
          results.push({ device: device.ip, success: false, message: '任务已取消' })
          completedCount++
          uploadProgress.value = Math.round((completedCount / totalCount) * 100)
          
          const task = taskQueue.value.find(t => t.id === taskId)
          if (task) {
            task.completed = completedCount
            task.progress = Math.round((completedCount / totalCount) * 100)
          }
          continue
        }
        
        try {
          const imageName = currentUploadingImage.value.name
          const version = device.version || 'v3'
          const password = getDevicePassword(device.ip)
          
          console.log('[上传镜像] 开始上传到设备:', device.ip)
          
          // 上传前再次检查任务状态
          const preCheckTask = taskQueue.value.find(t => t.id === taskId)
          if (preCheckTask && preCheckTask.status === 'canceled') {
            console.log('[上传镜像] 上传前检测到任务已取消,跳过设备:', device.ip)
            results.push({ device: device.ip, success: false, message: '任务已取消' })
            completedCount++
            uploadProgress.value = Math.round((completedCount / totalCount) * 100)
            
            const task = taskQueue.value.find(t => t.id === taskId)
            if (task) {
              task.completed = completedCount
              task.progress = Math.round((completedCount / totalCount) * 100)
            }
            continue
          }
          
          const loadResult = await LoadImageToDevice(device.ip, localPath, version, password || '')
          
          // 检查是否因为取消而失败
          if (loadResult.canceled) {
            console.log('[上传镜像] 检测到后端取消标志,停止后续上传')
            results.push({ device: device.ip, success: false, message: '任务已取消' })
            // 直接退出循环,不再处理后续设备
            break
          }
          
          // 上传完成后检查任务状态,如果已取消则不记录成功
          const postCheckTask = taskQueue.value.find(t => t.id === taskId)
          if (postCheckTask && postCheckTask.status === 'canceled') {
            console.log('[上传镜像] 上传完成后检测到任务已取消,不记录结果:', device.ip)
            results.push({ device: device.ip, success: false, message: '任务已取消' })
          } else if (loadResult.success) {
            results.push({ device: device.ip, success: true })
          } else {
            const errorMsg = loadResult.message || '未知错误'
            results.push({ device: device.ip, success: false, message: errorMsg })
          }
        } catch (error) {
          const errorMsg = error.message || error.toString() || '未知异常'
          results.push({ device: device.ip, success: false, message: errorMsg })
        } finally {
          completedCount++
          uploadProgress.value = Math.round((completedCount / totalCount) * 100)
          
          const task = taskQueue.value.find(t => t.id === taskId)
          if (task) {
            task.completed = completedCount
            task.progress = Math.round((completedCount / totalCount) * 100)
          }
          
          runningCount.value--
        }
      }
    }
    
    // 并发处理不同设备
    const devicePromises = []
    for (const deviceIP of deviceIPs) {
      // 检查任务是否已取消
      const task = taskQueue.value.find(t => t.id === taskId)
      if (task && task.status === 'canceled') {
        console.log('[上传镜像] 任务已取消,停止添加新设备:', taskId)
        break
      }
      
      // 等待有可用的并发槽位
      while (runningCount.value >= maxConcurrentDevices) {
        // 在等待期间也检查任务状态
        const task = taskQueue.value.find(t => t.id === taskId)
        if (task && task.status === 'canceled') {
          console.log('[上传镜像] 等待期间任务已取消:', taskId)
          break
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      // 再次检查任务是否已取消
      const taskFinal = taskQueue.value.find(t => t.id === taskId)
      if (taskFinal && taskFinal.status === 'canceled') {
        break
      }
      
      runningCount.value++
      devicePromises.push(processDeviceSerially(deviceIP, devicesByIP[deviceIP]))
    }
    
    await Promise.all(devicePromises)
    
    // 统计成功和失败
    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length
    
    // 更新任务状态
    const resultTask = taskQueue.value.find(t => t.id === taskId)
    if (resultTask) {
      // 如果任务已被取消,保持取消状态
      if (resultTask.status === 'canceled') {
        console.log('[上传镜像] 任务已取消,不更新为完成状态')
      } else {
        resultTask.status = failCount > 0 ? 'failed' : 'completed'
        resultTask.endTime = new Date()
        resultTask.completed = successCount
        resultTask.failed = failCount
        resultTask.progress = 100
        
        // 记录失败的设备及错误信息
        resultTask.failedTargets = results.filter(r => !r.success).map(r => ({
          deviceIP: r.device,
          error: r.message || '未知错误'
        }))
      }
    }
    
    // 只在任务未取消时显示成功/失败消息
    const canceledTask = taskQueue.value.find(t => t.id === taskId)
    if (!canceledTask || canceledTask.status !== 'canceled') {
      if (successCount > 0) {
        ElMessage.success(`成功上传到 ${successCount} 个设备`)
      }
      
      if (failCount > 0) {
        const failDetails = results.filter(r => !r.success).map(r => `${r.device}: ${r.message || '未知错误'}`).join('\n')
        ElMessage.error(`上传失败 ${failCount} 个设备:\n${failDetails}`)
      }
    }
    
    // 更新盒子镜像列表
    await fetchBoxImages()
    
  } catch (error) {
    console.error('批量上传镜像失败:', error)
    ElMessage.error('批量上传失败: ' + error.message)
    
    // 更新任务状态为失败
    const task = taskQueue.value.find(t => t.id === taskId)
    if (task) {
      task.status = 'failed'
      task.endTime = new Date()
      task.progress = 0
      task.error = error.message
    }
  } finally {
    // 隐藏加载状态
    isUploadingToMultipleDevices.value = false
    isUploadingImage.value = false
    currentUploadImage.value = null
    uploadProgress.value = 0
  }
}

// 兼容设备列表的ref变量
// 🔧 方案1修复：直接使用 compatibleDevicesForUpload，不再需要 compatibleDevicesList
// 排序后的兼容设备列表（按IP地址排序，只显示在线设备）
const sortedCompatibleDevicesList = computed(() => {
  // 直接使用 compatibleDevicesForUpload 计算属性作为数据源（实时更新）
  const devicesList = compatibleDevicesForUpload.value
  
  if (!devicesList || devicesList.length === 0) {
    return []
  }
  
  // 过滤出在线设备（严格模式：只信任 devicesStatusCache，忽略 device.isOnline）
  const onlineDevices = devicesList.filter(device => {
    const status = devicesStatusCache.value.get(device.id)
    const isOnline = status === 'online'
    // 调试日志
    if (!isOnline && device.isOnline) {
      console.log(`[设备过滤] 设备 ${device.ip} 的 device.isOnline=true 但 statusCache=${status}，已过滤`)
    }
    return isOnline
  })
  
  // 按IP地址排序
  return [...onlineDevices].sort((a, b) => {
    // 将IP地址转换为数字数组进行比较
    const ipA = a.ip.split('.').map(Number)
    const ipB = b.ip.split('.').map(Number)
    for (let i = 0; i < 4; i++) {
      if (ipA[i] !== ipB[i]) {
        return ipA[i] - ipB[i]
      }
    }
    return 0
  })
})

// 设置云机管理函数的依赖
onMounted(() => {
  setDependencies({
    getDevicePassword: getDevicePassword,
    showAuthDialog: showAuthDialog,
    refreshContainerList: fetchAndroidContainers,
    refreshDeviceInfo: (deviceIp) => {
      // 刷新特定设备的信息
      if (activeDevice.value && activeDevice.value.ip === deviceIp) {
        fetchAndroidContainers()
      }
    }
  })
})

// 程序启动时自动检查更新
onMounted(async () => {
  try {
    await getUpdateVersionInfo()
    console.log('[App] 当前版本:', updateState.currentVersion)
    
    if (updateState.autoCheck) {
      console.log('[App] 自动检查更新已开启，开始检查更新...')
      setTimeout(async () => {
        await checkForUpdates()
      }, 2000)
    }
  } catch (error) {
    console.error('[App] 初始化更新服务失败:', error)
  }
})

// 监听更新状态变化，自动弹出更新提示
watch(
  () => updateState.hasUpdate,
  (hasUpdate, prevHasUpdate) => {
    if (hasUpdate && !prevHasUpdate) {
      console.log('[App] 发现新版本，自动显示更新提示')
      updateInfo.value = updateState.updateInfo
      updateDialogVisible.value = true
    }
  }
)

// 🔧 方案1修复：不再需要 watch 监听器，因为 sortedCompatibleDevicesList 直接使用 compatibleDevicesForUpload

// 监听机型类型变化，切换时获取本地机型列表
watch(
  () => createForm.value.modelType,
  async (newType, oldType) => {
    if (newType === 'local' && oldType === 'online') {
      // 从在线机型切换到本地机型时，获取本地机型列表
      if (createDevice.value && createDevice.value.version === 'v3') {
        await getLocalPhoneModels(createDevice.value.ip)
      }
    }
  }
)

// 处理云机管理模式变化
// 云机管理模式 / 选中 / 批量动作 / 镜像上下行进度（阶段 3 迁出到 composables/useCloudMachineManage.js）
const {
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
} = useCloudMachineManage({
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
}, {
  // 以下三个在下方才创建（截图缓存 / 任务队列），用惰性依赖避免 TDZ
  resetScreenshotVersions: () => resetScreenshotVersions(),
  addTaskToQueue: () => addTaskToQueue(),
  executeTask: () => executeTask(),
})

// 显示设备密码设置对话框


// 设置设备密码
const handleSetPassword = async () => {
  if (!activeDevice.value) return
  
  if (!passwordForm.value.password) {
    ElMessage.error('请输入密码')
    return
  }
  
  try {
    // 检查设备是否需要认证
    if (activeDevice.value.version === 'v3') {
      try {
        // 先尝试无密码访问，看是否需要认证
        const result = await getContainers(activeDevice.value, null);
        // 如果认证失败，说明设备已经设置了密码，需要先认证
        if (result && result.code === 61 && result.message === 'Authentication Failed') {
          // 使用authRetry处理认证
          await authRetry(activeDevice.value, async (currentPassword) => {
            passwordLoading.value = true
            const result = await setDevicePassword(activeDevice.value, passwordForm.value.password, currentPassword)
            if (result.success) {
              ElMessage.success('密码设置成功')
              passwordDialogVisible.value = false
              // 保存新密码到本地存储并同步到后端
              await saveDevicePassword(activeDevice.value.ip, passwordForm.value.password)
            } else {
              ElMessage.error(`密码设置失败: ${result.message}`)
            }
          })
          return
        }
      } catch (error) {
        // 无密码访问失败，需要认证
        await authRetry(activeDevice.value, async (currentPassword) => {
          passwordLoading.value = true
          const result = await setDevicePassword(activeDevice.value, passwordForm.value.password, currentPassword)
          if (result.success) {
            ElMessage.success('密码设置成功')
            passwordDialogVisible.value = false
            // 保存新密码到本地存储并同步到后端
            await saveDevicePassword(activeDevice.value.ip, passwordForm.value.password)
          } else {
            ElMessage.error(`密码设置失败: ${result.message}`)
          }
        })
        return
      }
    }
    
    // 不需要认证或已经认证成功，直接设置密码
    passwordLoading.value = true
    // 获取当前保存的密码
    const currentPassword = getDevicePassword(activeDevice.value.ip);
    const result = await setDevicePassword(activeDevice.value, passwordForm.value.password, currentPassword)
    if (result.success) {
      ElMessage.success('密码设置成功')
      passwordDialogVisible.value = false
      // 保存新密码到本地存储并同步到后端
      await saveDevicePassword(activeDevice.value.ip, passwordForm.value.password)
    } else {
      ElMessage.error(`密码设置失败: ${result.message}`)
    }
  } catch (error) {
    console.error('设置密码失败:', error)
    ElMessage.error(`设置密码失败: ${error.message}`)
  } finally {
    passwordLoading.value = false
  }
}

// 显示密码设置对话框
const showPasswordDialog = () => {
  if (!activeDevice.value) {
    ElMessage.error('请先选择设备')
    return
  }
  
  passwordForm.value.password = ''
  passwordDialogVisible.value = true
}

// 关闭设备密码
const handleClosePassword = async () => {
  if (!activeDevice.value) return
  
  try {
    const confirmResult = await ElMessageBox.confirm('确定要关闭设备密码吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    
    // 用户确认关闭密码
    passwordLoading.value = true
    
    // 获取当前保存的密码
    const currentPassword = getDevicePassword(activeDevice.value.ip);
    const result = await closeDevicePassword(activeDevice.value, currentPassword)
    
    if (result.success) {
      ElMessage.success('密码关闭成功')
      // 清除本地存储的密码
      removeDevicePassword(activeDevice.value.ip)
    } else {
      ElMessage.error(`密码关闭失败: ${result.message}`)
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('关闭密码失败:', error)
      ElMessage.error(`关闭密码失败: ${error.message}`)
    }
  } finally {
    passwordLoading.value = false
  }
}


// 清理磁盘数据
const handleCleanDisk = async () => {
   try {
        const { value } = await ElMessageBox.prompt(
            `确定要清理设备"${activeDevice.value.ip}"磁盘数据吗？\n清理磁盘数据会重启设备，重启时间为5~10分钟，请耐心等待。\n\n请输入“yes”以继续：`,
            '清理磁盘数据',
            {
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                inputPlaceholder: '请输入“yes”',
                inputValidator: (val) => (val || '').trim().toLowerCase() === 'yes' || '请输入“yes”以确认操作',
                type: 'warning'
            }
        )
        if ((value || '').trim().toLowerCase() !== 'yes') {
            ElMessage.warning('输入不匹配，已取消清理')
            return
        }

        collapseRightSidebar()

        const taskId = `cleanDisk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        const task = {
            id: taskId,
            type: 'cleanDisk',
            deviceIP: activeDevice.value.ip,
            status: 'running',
            progress: 0,
            startTime: new Date(),
            completed: 0,
            failed: 0,
            totalSteps: 6,
            currentStep: 0,
            steps: []
        }
        taskQueue.value.unshift(task)

        // 🔧 使用 authRetry 处理认证
        await authRetry(activeDevice.value, async (password) => {
            let headers = {}
            if (password) {
                const auth = btoa(`admin:${password}`)
                headers['Authorization'] = `Basic ${auth}`
            }

            const response = await fetch(
                `http://${getDeviceAddr(activeDevice.value.ip)}/server/device/reset`,
                {
                    method: 'POST',
                    headers: headers
                }
            )

            if (!response.ok) {
                // 🔧 如果是401错误，直接抛出让authRetry处理，不标记任务失败
                if (response.status === 401) {
                    throw new Error('Authentication Failed')
                }
                
                // 其他错误才标记任务失败
                const currentTask = taskQueue.value.find(t => t.id === taskId)
                if (currentTask) {
                    currentTask.status = 'failed'
                    currentTask.endTime = new Date()
                    currentTask.error = `接口请求失败: ${response.status}`
                }
                
                ElMessage.error('清理失败')
                return
            }

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let taskCompleted = false

            while (!taskCompleted) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop()

                for (const line of lines) {
                    if (line.trim()) {
                        console.log('SSE返回:', line)
                        
                        const currentTask = taskQueue.value.find(t => t.id === taskId)
                        if (!currentTask || taskCompleted) continue

                        const stepMatch = line.match(/\[STEP\s+(\d+)\]/i)
                        const infoMatch = line.match(/\[INFO\]/)
                        const resetMatch = line.match(/Reset sequence completed/i)
                        const rebootMatch = line.match(/Rebooting/i)

                        if (stepMatch) {
                            currentTask.currentStep = parseInt(stepMatch[1])
                            currentTask.progress = Math.round((currentTask.currentStep / currentTask.totalSteps) * 100)
                            currentTask.steps.push(line)
                        } else if (infoMatch) {
                            currentTask.steps.push(line)
                        }

                        if (resetMatch || rebootMatch) {
                            currentTask.progress = 100
                            currentTask.status = 'completed'
                            currentTask.completed = 1
                            currentTask.endTime = new Date()
                            taskCompleted = true
                            
                            ElMessage.success('设备清理完成，正在重启')
                            
                            isViewingDeviceDetails.value = false
                        }
                    }
                }
            }
            
            // 🔧 检查流结束时任务状态
            const finalTask = taskQueue.value.find(t => t.id === taskId)
            if (finalTask && !taskCompleted) {
                // 流已结束但没有收到完成标记，可能是最后一行数据在buffer中
                if (buffer.trim()) {
                    console.log('SSE最后一行:', buffer)
                    const resetMatch = buffer.match(/Reset sequence completed/i)
                    const rebootMatch = buffer.match(/Rebooting/i)
                    
                    if (resetMatch || rebootMatch) {
                        finalTask.progress = 100
                        finalTask.status = 'completed'
                        finalTask.completed = 1
                        finalTask.endTime = new Date()
                        taskCompleted = true
                        
                        ElMessage.success('设备清理完成，正在重启')
                        isViewingDeviceDetails.value = false
                    }
                }
                
                // 如果仍未完成，检查是否至少接收到了步骤信息
                if (!taskCompleted && finalTask.currentStep >= finalTask.totalSteps) {
                    console.log('所有步骤已完成，标记任务为成功')
                    finalTask.progress = 100
                    finalTask.status = 'completed'
                    finalTask.completed = 1
                    finalTask.endTime = new Date()
                    
                    ElMessage.success('设备清理完成，正在重启')
                    isViewingDeviceDetails.value = false
                }
            }
        })
    } catch (error) {
        if (error !== 'cancel') {
            console.error('清理失败:', error)
            ElMessage.error('清理失败，请检查网络连接')
        }
    }
}

// 重启主机
const handleRebootDevice = async () => {
  try {
    await ElMessageBox.confirm(
      `确定要重启设备"${activeDevice.value.ip}"吗？`,
      '重启后设备需要5~10分钟恢复，请耐心等待',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    collapseRightSidebar()

    await authRetry(activeDevice.value, async (password) => {
      let headers = {}
      if (password) {
        const auth = btoa(`admin:${password}`)
        headers['Authorization'] = `Basic ${auth}`
      }

      const response = await fetch(
        `http://${getDeviceAddr(activeDevice.value.ip)}/server/device/reboot`,
        {
          method: 'POST',
          headers: headers
        }
      )

      if (response.status === 401) {
        throw new Error('Authentication Failed')
      }

      if (!response.ok) {
        ElMessage.error('重启失败')
        return
      }

      ElMessage.success('重启指令已发送，设备将在5~10分钟内恢复')
      isViewingDeviceDetails.value = false
    })
  } catch (error) {
    if (error !== 'cancel') {
      console.error('重启失败:', error)
      ElMessage.error('重启失败，请检查网络连接')
    }
  }
}

// 认证 / 授权同步 / 注册 / 忘记密码 / 批量认证（阶段 3 迁出到 composables/useAuthForms.js）
const {
  showAuthDialog,
  showSyncAuthDialog,
  handleAuthExpired,
  clearAuthAndRefresh,
  handleSyncAuthSubmit,
  handleSyncAuthCancel,
  handleUpdateUserInfo,
  openRegisterDialog,
  sendVcode,
  handleRegisterSubmit,
  handleRegisterCancel,
  openForgotPasswordDialog,
  handleForgotPasswordClose,
  sendForgotPasswordVcode,
  fpVcodeButtonText,
  fpIsCountingDown,
  handleForgotPasswordSubmit,
  openRegisterFromForgot,
  handleBatchAuthSubmit,
  handleBatchAuthCancel,
} = useAuthForms({
  t,
  activeDevice,
  instances,
  allInstances,
  deviceCloudMachinesCache,
  deviceAllInstancesCache,
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
  batchAuthLoading,
  batchAuthCollectTimeout,
  devicesStatusCache,
  deviceVersionInfo,
  deviceFirmwareInfo,
  fetchDeviceBindStatus,
  updateCloudMachines,
  startSyncAuthTimer,
  proxy,
})

// 获取V3设备SDK版本信息
const getV3SDKVersion = async (deviceIP) => {
  try {
    // 尝试使用已保存的密码
    const savedPassword = getDevicePassword(deviceIP);
    let headers = {};
    
    if (savedPassword) {
      const auth = btoa(`admin:${savedPassword}`);
      headers = {
        'Authorization': `Basic ${auth}`
      };
    }
    
    const response = await axios.get(`http://${getDeviceAddr(deviceIP)}/api/v1/device/info`, {
      headers: headers,
      timeout: 5000
    });
    
    if (response.data.code === 0 && response.data.data) {
      const version = response.data.data.sdkVersion || response.data.data.version || '0';
      console.log('获取V3设备SDK版本成功:', version);
      return version;
    }
    return '0';
  } catch (error) {
    console.error('获取V3设备SDK版本失败:', error);
    return '0';
  }
}

// 认证重试函数
const authRetry = async (device, callback) => {
  try {
    console.log('认证重试 - 开始认证流程')
    console.log('认证重试 - 设备信息:', device)
    
    // 检查设备是否需要认证
    // v0-v2 设备不需要认证
    if (device.version === 'v0' || device.version === 'v1' || device.version === 'v2') {
      console.log('认证重试 - v0-v2设备，不需要认证')
      return await callback(null);
    }
    
    // 对于V3设备，智能认证流程（优化：优先使用保存的密码，避免无谓的401）
    if (device.version === 'v3') {
      console.log('认证重试 - V3设备，检查认证策略')
      
      // 【优化】先检查是否有保存的密码
      const savedPassword = getDevicePassword(device.ip)
      
      if (savedPassword) {
        console.log('认证重试 - 发现已保存的密码，直接使用认证')
        try {
          // 直接使用保存的密码，避免先401再重试
          const result = await callback(savedPassword)
          console.log('认证重试 - 使用保存密码成功')
          return result
        } catch (error) {
          console.log('认证重试 - 保存的密码失败:', error)
          
          // 检查是否是认证错误
          if ((error.response && error.response.status === 401) || error.message === 'Authentication Failed') {
            console.log('认证重试 - 保存的密码已失效，需要重新认证')
            
            // 密码失效，显示认证对话框
            return new Promise((resolve, reject) => {
              console.log('认证重试 - 显示认证对话框')
              showAuthDialog(device, async (password) => {
                try {
                  console.log('认证重试 - 收到认证对话框的密码')
                  
                  // 保存新密码
                  await saveDevicePassword(device.ip, password)
                  console.log('认证重试 - 新密码已保存')
                  
                  // 执行原始回调
                  const result = await callback(password)
                  console.log('认证重试 - 回调执行成功')
                  resolve(result)
                } catch (error) {
                  console.error('认证重试 - 回调执行失败:', error)
                  reject(error)
                }
              })
            })
          } else {
            // 不是401错误，直接抛出
            console.log('认证重试 - 不是401错误，直接抛出')
            throw error
          }
        }
      } else {
        console.log('认证重试 - 没有保存的密码，尝试无密码访问')
        
        try {
          // 没有保存密码，尝试无密码访问
          const result = await callback(null)
          console.log('认证重试 - 无密码访问成功')
          return result
        } catch (error) {
          console.log('认证重试 - 无密码访问失败:', error)
          
          // 检查是否是认证错误
          if ((error.response && error.response.status === 401) || error.message === 'Authentication Failed') {
            console.log('认证重试 - 需要认证，显示认证对话框')
            
            // 显示认证对话框
            return new Promise((resolve, reject) => {
              showAuthDialog(device, async (password) => {
                try {
                  console.log('认证重试 - 收到认证对话框的密码')
                  
                  // 保存密码
                  await saveDevicePassword(device.ip, password)
                  console.log('认证重试 - 密码已保存')
                  
                  // 执行原始回调
                  const result = await callback(password)
                  console.log('认证重试 - 回调执行成功')
                  resolve(result)
                } catch (error) {
                  console.error('认证重试 - 回调执行失败:', error)
                  reject(error)
                }
              })
            })
          } else {
            // 不是401错误，直接抛出
            console.log('认证重试 - 不是401错误，直接抛出')
            throw error
          }
        }
      }
    }
    
    // 默认返回空密码
    console.log('认证重试 - 默认返回空密码')
    return await callback(null);
  } catch (error) {
    console.error('认证重试失败:', error)
    throw error
  }
}



// 显示设备详情弹窗
const showDeviceDetails = async (device) => {
  console.log('显示设备详情弹窗:', device);
  await handleDeviceSelect(device);
  deviceDetailsDialogVisible.value = true;
  isViewingDeviceDetails.value = true;
  
  console.log('根据当前选中的镜像分类自动获取镜像列表:', selectedImageCategory.value);
  await switchImageCategory(selectedImageCategory.value);
  
  await fetchDeviceDetailCloudMachines();

   // 🔧 移除定时查询，使用心跳机制自动更新设备信息
  // 设备信息会随心跳自动更新，不需要前端定时刷新

}


// 切换镜像分类


// 树形结构选中节点
const treeSelectedKeys = ref([]) // 存储树形结构选中的节点ID

// 备份列表相关
const backupListVisible = ref(false) // 备份列表显示状态
const backupTableRef = ref(null) // 备份列表表格引用
const backupCurrentSlot = ref(0) // 当前操作的坑位（备份相关）
const switchingBackupSlot = ref(null) // 当前正在切换云机的坑位
const backupList = ref([]) // 备份列表数据
const selectedBackupList = ref([]) // 选中的备份列表（用于批量操作）
const backupGroups = ref(['默认分组', '测试分组', '生产分组']) // 备份分组
const selectedBackupGroup = ref('默认分组') // 当前选中的分组
const sortBy = ref('createTime') // 排序字段

// 批量切换云机进度对话框
const batchSwitchBackupProgressVisible = ref(false) // 进度对话框显示状态
const batchSwitchBackupProgressList = ref([]) // 每条进度项: { slotNum, currentName, backupName, status: 'pending'|'running'|'success'|'failed', message }
const batchSwitchBackupTotal = ref(0) // 总数
const batchSwitchBackupDone = ref(0) // 已完成数（成功+失败）
const sortOrder = ref('descending') // 排序顺序

// 初始化备份列表数据
const initBackupList = () => {
  // 保存当前选中的备份ID列表
  const selectedIds = selectedBackupList.value.map(item => item.id)
  
  // 显示当前坑位的所有容器，除了当前运行的那个
  const slotContainers = allInstances.value.filter(inst => 
    inst.indexNum === backupCurrentSlot.value && 
    inst.name // 排除空容器
  );
  
  // 直接映射容器数据，如果没有则为空数组
  backupList.value = slotContainers.map((container, index) => ({
    id: container.name,
    name: container.name,
    createTime: container.created,
    remark: container.image,
    group: '默认分组',
    status: container.status
  }));
  
  // 恢复选中状态：使用表格的toggleRowSelection方法
  if (selectedIds.length > 0 && backupTableRef.value) {
    nextTick(() => {
      // 清空当前选中
      backupTableRef.value.clearSelection()
      // 重新选中之前选中的行
      backupList.value.forEach(row => {
        if (selectedIds.includes(row.id)) {
          backupTableRef.value.toggleRowSelection(row, true)
        }
      })
    })
  }
}

// 显示备份列表
const showBackupList = async (slotNum) => {
  backupCurrentSlot.value = slotNum
  // 清空之前的选中状态
  selectedBackupList.value = []
  
  // 先显示弹窗，并显示加载状态
  backupListVisible.value = true
  backupLoading.value = true
  
  try {
    // 先用缓存数据初始化，避免空白
    initBackupList()
    
    // 实时刷新数据
    if (activeDevice.value) {
      await triggerAndroidRefresh([activeDevice.value.ip])
      // 数据刷新后重新初始化列表
      initBackupList()
    }
  } catch (error) {
    console.error('刷新备份列表失败:', error)
  } finally {
    backupLoading.value = false
  }
}

// 处理备份列表选中状态变化
const handleBackupSelectionChange = (selection) => {
  selectedBackupList.value = selection
}

// 显示创建云机对话框


// 查找可用的坑位，参考api/main.go中的findAvailableIdx实现
const findAvailableSlot = (device, startSlot = 1, count = 1) => {
  if (!device) return -1
  
  // 根据设备型号确定最大坑位数
  let maxSlots = 12 // 默认12个坑位
  if (device.id && device.id.toLowerCase().startsWith('p')) {
    maxSlots = 24 // P系列24个坑位
  }
  
  // 获取当前设备的所有容器
  const deviceContainers = deviceCloudMachinesCache.value.get(device.ip) || []
  
  // 创建已使用坑位的集合，只考虑运行中的容器
  const usedSlots = new Set()
  deviceContainers.forEach(machine => {
    if (machine.status === 'running' && machine.indexNum) {
      usedSlots.add(machine.indexNum)
    }
  })
  
  // 检查当前运行中的容器数量是否已达到上限
  if (usedSlots.size >= maxSlots) {
    return -1
  }
  
  // 检查请求的坑位数是否超过剩余可用坑位数
  const remainingSlots = maxSlots - usedSlots.size
  if (count > remainingSlots) {
    return -1
  }
  
  // 查找从startSlot开始，连续count个可用的坑位
  for (let i = 1; i <= maxSlots; i++) {
    // 如果是批量创建，检查从i开始的连续count个坑位是否都可用
    if (count > 1) {
      let allAvailable = true
      for (let j = 0; j < count; j++) {
        // 检查当前坑位是否超出范围或已被使用
        if (i + j > maxSlots || usedSlots.has(i + j)) {
          allAvailable = false
          break
        }
      }
      if (allAvailable) {
        return i
      }
    } else {
      // 单个坑位：直接返回第一个可用的坑位
      if (!usedSlots.has(i)) {
        return i
      }
    }
  }
  
  // 没有找到可用的坑位
  return -1
}

// 检查指定坑位是否已被占用
const isSlotOccupied = (device, slot) => {
  if (!device) return true
  
  // 优先从 runningSlots 检查（showCreateDialog 时实时获取的运行状态）
  // runningSlots 为全局单例，仅当归属本设备时才可用，否则视为未知
  const liveSlots = runningSlotsOf(device)
  if (liveSlots && liveSlots.has(slot)) return true
  
  // 从 deviceCloudMachinesCache 检查
  const deviceContainers = deviceCloudMachinesCache.value.get(device.ip) || []
  if (deviceContainers.some(machine => machine.status === 'running' && machine.indexNum === slot)) return true
  
  // 从 instances 检查（当前选中设备的容器列表）
  // 从 instances 检查（instances 只承载当前选中设备的列表，跨设备不采信）
  if (instancesOf(device).some(machine => machine.status === 'running' && machine.indexNum === slot)) return true
  
  return false
}

// 检查并关闭指定坑位的运行中容器
const checkAndStopContainer = async (device, slot) => {
  if (!device) return true
  
  // 获取当前设备的所有容器
  const deviceContainers = deviceCloudMachinesCache.value.get(device.ip) || []
  
  // 查找指定坑位的运行中容器
  const runningContainer = deviceContainers.find(machine => 
    machine.status === 'running' && machine.indexNum === slot
  )
  
  if (runningContainer) {
    // 有运行中的容器，需要先关闭
    try {
      ElMessage.info(`正在关闭坑位 ${slot} 上运行的容器: ${runningContainer.name}`)
      await authRetry(device, async (password) => {
          await stopContainer(device, runningContainer.name, password)
        })
      // 等待1秒，确保容器完全关闭
      await new Promise(resolve => setTimeout(resolve, 1000))
      return true
    } catch (error) {
      ElMessage.error(`关闭容器失败：${error.message}`)
      return false
    }
  }
  
  // 没有运行中的容器，直接返回
  return true
}

// 创建云机
const createCloudMachine = async (device, slot, modelName, cancelCheck = null, options = {}) => {
  if (!device) {
    ElMessage.error('设备不能为空')
    return false
  }

  if (typeof cancelCheck === 'function' && cancelCheck()) {
    throw new Error('任务已取消')
  }
  
  // 优先从 options.formOverride 读取参数，避免后台批量任务干扰界面表单
  const form = options.formOverride ? { ...createForm.value, ...options.formOverride } : createForm.value
  
  try {
    // 获取镜像信息
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
    } else {
      // 在线镜像
      imageUrl = form.imageSelect
      if (form.imageSelect === 'custom') {
        imageUrl = form.customImageUrl
      }
    }
    
    // 根据设备版本选择创建方式
    if (device.version === 'v3') {
      // 如果是在线机型，需要选择机型
      if (form.modelType === 'online' && !modelName) {
        ElMessage.error('请选择机型')
        return false
      }
      // V3 API：使用8000端口
      createLoading.value = true
      await createV3CloudMachine(device, slot, modelName, cancelCheck, options)
      createLoading.value = false
    } else {
      // V0-V2 API：根据镜像来源执行不同的逻辑
      // 1. 显示蒙版
      sdkLoadingVisible.value = true
      
      // 2. 处理镜像
      if (isLocalImage) {
        // 本地镜像：先检查设备上是否已存在该镜像
        sdkLoadingMessage.value = '检查设备上的镜像...'
        
        try {
          // 获取设备上的镜像列表

          const savedPassword = getDevicePassword(device.ip)
          const deviceImages = await GetImages(device.ip, device.version, savedPassword || '')

          console.log('设备上的镜像列表:', deviceImages)
          
          // 从本地镜像路径中提取镜像名称
          const imagePathParts = imageUrl.split('\\')
          let localImageName = imagePathParts[imagePathParts.length - 1]
          localImageName = localImageName.replace('.tar.gz', '')
          localImageName = localImageName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
          const expectedImageName = `local/${localImageName}:latest`
          
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
          } else if (deviceImages.list) {
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
            
            // 检查加载结果
            if (!loadResult.success) {
              ElMessage.error(`推送本地镜像失败：${loadResult.message || '未知错误'}`)
              sdkLoadingVisible.value = false
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
          }
        } catch (loadError) {
          console.error('处理本地镜像失败:', loadError)
          ElMessage.error(`处理本地镜像失败：${loadError.message}`)
          sdkLoadingVisible.value = false
          return false
        }
      } else {
        // 在线镜像：检查是否需要缓存到本地创建
        const cacheToLocal = createForm.value.cacheToLocal || false
        
        if (cacheToLocal) {
          // 在线镜像缓存到本地创建：先下载到本地，再推送到设备
          sdkLoadingMessage.value = '正在下载镜像到本地...'
          
          // 获取用户数据目录
          const userDataDir = await GetUserDataDir()
          
          // 下载镜像到本地
          try {
            // 重置进度
            sdkLoadingProgress.value = 0
            
            // 启动进度查询定时器
            const progressQueryTimer = setInterval(async () => {
              try {
                const progressResult = await getImagePullProgress()
                if (progressResult && progressResult.progress !== undefined) {
                  sdkLoadingProgress.value = progressResult.progress
                }
              } catch (err) {
                console.error('获取下载进度失败:', err)
              }
            }, 500)
            
            // 调用后端DownloadImage函数
            await DownloadImage(imageUrl)
            
            // 清除进度查询定时器
            clearInterval(progressQueryTimer)
            
            // 设置进度为100%
            sdkLoadingProgress.value = 100
            await new Promise(resolve => setTimeout(resolve, 500))
          } catch (downloadError) {
            console.error('下载镜像到本地失败:', downloadError)
            ElMessage.error(`下载镜像到本地失败：${downloadError.message}`)
            sdkLoadingVisible.value = false
            return false
          }
          
          // 推送本地镜像到设备
          sdkLoadingMessage.value = '正在推送镜像到设备...'
          
          try {
            // 重置进度
            sdkLoadingProgress.value = 0
            
            // 构建正确的本地镜像文件名
            let localImageName = imageUrl.split('/').pop()
            // 替换冒号为下划线，添加.tar.gz后缀
            localImageName = localImageName.replace(':', '_') + '.tar.gz'
            // 调用后端LoadImageToDevice函数
            const password = getDevicePassword(device.ip)
            await LoadImageToDevice(device.ip, `${userDataDir}/${localImageName}`, device.version, password || '')
            
            // 设置进度为100%
            sdkLoadingProgress.value = 100
            await new Promise(resolve => setTimeout(resolve, 500))
          } catch (loadError) {
            console.error('推送镜像到设备失败:', loadError)
            ElMessage.error(`推送镜像到设备失败：${loadError.message}`)
            sdkLoadingVisible.value = false
            return false
          }
        } else {
          // 在线镜像直接创建：使用Docker API拉取镜像
          sdkLoadingMessage.value = '正在下载镜像...'
          
          try {
            // 重置进度
            sdkLoadingProgress.value = 0
            
            // 启动进度查询定时器
            const progressQueryTimer = setInterval(async () => {
              try {
                const progressResult = await getImagePullProgress()
                if (progressResult && progressResult.progress !== undefined) {
                  sdkLoadingProgress.value = progressResult.progress
                }
              } catch (err) {
                console.error('获取镜像拉取进度失败:', err)
              }
            }, 500)
            
            // 调用后端的pullDockerImage函数，开始拉取镜像
            await pullDockerImage(device.ip, imageUrl)
            
            // 清除进度查询定时器
            clearInterval(progressQueryTimer)
            
            // 设置进度为100%
            sdkLoadingProgress.value = 100
            
            // 短暂延迟，让用户看到100%进度
            await new Promise(resolve => setTimeout(resolve, 500))
          } catch (pullError) {
            console.error('拉取镜像失败:', pullError)
            ElMessage.error(`拉取镜像失败：${pullError.message}`)
            sdkLoadingVisible.value = false
            return false
          }
        }
      }
      
      // 3. 镜像处理完成，创建云机
      sdkLoadingMessage.value = '正在创建云机...'
      
      // 4. 调用createV0V2Device函数创建云机
      const createParams = {
        name: createForm.value.name,
        count: createForm.value.count,
        startSlot: createForm.value.startSlot,
        imageSelect: isLocalImage ? imageUrl : createForm.value.imageSelect,
        customImageUrl: isLocalImage ? '' : createForm.value.customImageUrl,
        networkMode: createForm.value.networkMode,
        ipaddr: createForm.value.ipaddr,
        resolution: createForm.value.resolution,
        sandboxSize: createForm.value.sandboxSize,
        dns: createForm.value.dns,
        sandbox: false, // V3才有沙盒选项，V0-V2暂时不使用
        longitud: createForm.value.longitud,
        latitude: createForm.value.latitude,
        PINCode: createForm.value.lockScreenPassword,
        vpcID: createForm.value.vpcNodeId
      }
      
      // 5. 调用后端创建云机
      await createV0V2Device(device, createParams)
      
      // 6. 隐藏蒙版
      sdkLoadingVisible.value = false
    }
    
    // 刷新云机列表
    await fetchAndroidContainers(device, true)
    
    // 保存上一次的镜像选择
    lastImageSelection.value = {
      imageSelect: createForm.value.imageSelect,
      customImageUrl: createForm.value.customImageUrl,
      imageCategory: createForm.value.imageCategory,
      localImageUrl: createForm.value.localImageUrl,
      imageSource: createForm.value.imageSource
    }
    
    ElMessage.success('云机创建成功')
    return true
  } catch (error) {
    console.error('创建云机失败:', error)
    ElMessage.error(`创建云机失败：${error.message}`)
    // 确保蒙版已关闭
    sdkLoadingVisible.value = false
    createLoading.value = false
    throw error // 抛出异常，保留错误信息
  } finally {
    createLoading.value = false
  }
}

// 创建云机（阶段 3 迁出到 composables/useCloudMachineCreate.js）
const {
  createV3CloudMachine,
  handleCreateSubmit,
  handleCreateCancel,
} = useCloudMachineCreate({
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
}, {
  // 任务队列在下方（约 10760 行）才创建，用惰性依赖避免 TDZ
  addTaskToQueue: () => addTaskToQueue(),
  executeTask: () => executeTask(),
})

// 云机更新镜像（阶段 3 迁出到 composables/useCloudMachineUpdate.js）
const {
  showUpdateImageDialog,
  handleUpdateImageSubmit,
  handleUpdateImageCancel,
} = useCloudMachineUpdate({
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
})

// 批量更新镜像 - 等待下载完成（轮询 isDownloadingImage）
const waitForDownloadComplete = () => {
  return new Promise((resolve, reject) => {
    if (!isDownloadingImage.value) {
      resolve(true)
      return
    }
    const timer = setInterval(() => {
      if (!isDownloadingImage.value) {
        clearInterval(timer)
        // 检查最近一次下载是否成功（task 状态）
        const lastTask = [...taskQueue.value].reverse().find(t => t.type === 'downloadImage')
        if (lastTask && lastTask.status === 'failed') {
          reject(new Error(lastTask.error || '下载失败'))
        } else {
          resolve(true)
        }
      }
    }, 500)
    // 超时 30 分钟
    setTimeout(() => {
      clearInterval(timer)
      reject(new Error('下载超时'))
    }, 30 * 60 * 1000)
  })
}

// 批量更新镜像 - 执行提交
// 轮询任务进度，直到任务完成或超时
// onProgress(successCount, failCount, total) 回调用于实时更新进度条
const pollTaskStatus = async (deviceIp, taskId, headers, totalCount, groupLabel, onProgress) => {
  const maxWaitMs = 10 * 60 * 1000 // 最长等待10分钟
  const pollInterval = 3000 // 每3秒查询一次
  const startTime = Date.now()
  let successCount = 0
  let failCount = 0
  const failDetails = []

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const res = await axios.get(
        `http://${getDeviceAddr(deviceIp)}/android/task-status?taskId=${taskId}`,
        { headers }
      )
      const data = res.data?.data
      if (res.data?.code === 0 && data) {
        const status = data.status
        const total = data.total || totalCount
        const successNames = data.successNames || []
        const failedMap = data.failedMap || {}
        const currentSuccess = successNames.length
        const currentFail = Object.keys(failedMap).length
        const processed = currentSuccess + currentFail

        batchUpdateImageStatusText.value = `设备 ${deviceIp}(${groupLabel}) 更新中：${processed}/${total}`

        // 实时回调，每次轮询都更新进度
        if (onProgress) {
          onProgress(currentSuccess, currentFail, total)
        }

        if (status === 'completed' || status === 'done' || status === 'finished') {
          successCount = currentSuccess
          failCount = currentFail
          for (const [name, reason] of Object.entries(failedMap)) {
            failDetails.push({ deviceIP: `${deviceIp}(${groupLabel})`, machineName: name, error: reason })
          }
          break
        } else if (status === 'failed' || status === 'error') {
          failCount = totalCount
          failDetails.push({ deviceIP: `${deviceIp}(${groupLabel})`, error: '任务失败' })
          break
        }
      }
    } catch (e) {
      // 查询失败，继续重试
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }

  // 超时处理：若仍未完成，视为成功（任务已提交）
  if (successCount === 0 && failCount === 0) {
    successCount = totalCount
  }

  return { successCount, failCount, failDetails }
}

const executeBatchUpdateImage = async () => {
  // 校验每组都已选镜像
  for (const group of batchUpdateImageGroups.value) {
    const addr = group.selectedUrl === 'custom' ? group.customUrl.trim() : group.selectedUrl.trim()
    if (!addr) {
      ElMessage.warning(`请为「${group.groupLabel}」选择或输入镜像地址`)
      return
    }
  }

  // 收集所有容器作为 targets（用于任务队列展示设备信息）
  const allContainers = []
  for (const group of batchUpdateImageGroups.value) {
    for (const c of group.containers) {
      allContainers.push(c)
    }
  }

  // 创建任务队列条目
  const imageLabels = [...new Set(batchUpdateImageGroups.value.map(g =>
    g.selectedUrl === 'custom' ? (g.customUrl.trim() || '自定义') : (g.selectedUrl.trim() || '')
  ))].join(', ')
  const queueTaskId = addTaskToQueue('updateImage', allContainers, {
    imageLabels
  })
  const queueTask = taskQueue.value.find(t => t.id === queueTaskId)
  if (queueTask) {
    queueTask.status = 'running'
    queueTask.startTime = new Date()
  }

  // 关闭弹窗，后台执行
  batchUpdateImageDialogVisible.value = false
  ElMessage.info('批量更新镜像任务已创建，可在任务队列中查看进度')

  // 快照当前分组数据，避免弹窗关闭后数据被清空
  const groups = JSON.parse(JSON.stringify(batchUpdateImageGroups.value))

  // 后台异步执行
  ;(async () => {
    let successCount = 0
    let failCount = 0
    const failDetails = []

    try {
      // 收集所有需要处理的镜像 URL（自定义 URL 不做下载检查）
      const urlsToProcess = []
      for (const group of groups) {
        const imageAddress = group.selectedUrl === 'custom' ? group.customUrl.trim() : group.selectedUrl.trim()
        if (group.selectedUrl === 'custom') continue
        const existing = urlsToProcess.find(u => u.imageUrl === imageAddress)
        if (existing) {
          existing.groups.push(group)
        } else {
          const imgObj = imageList.value.find(img => img.url === imageAddress) || { url: imageAddress, name: imageAddress }
          urlsToProcess.push({ imageUrl: imageAddress, imageObj: imgObj, groups: [group] })
        }
      }

      // 逐一检查并下载镜像
      for (const item of urlsToProcess) {
        const isDownloaded = await checkImageDownloadStatus(item.imageUrl)
        if (!isDownloaded) {
          await downloadOnlineImage(item.imageObj)
          try {
            await waitForDownloadComplete()
          } catch (err) {
            throw new Error(`镜像「${item.imageObj.name || item.imageUrl}」下载失败：${err.message}`)
          }
          const downloadedNow = await checkImageDownloadStatus(item.imageUrl)
          if (!downloadedNow) {
            throw new Error(`镜像「${item.imageObj.name || item.imageUrl}」下载后验证失败`)
          }
        }
      }

      // 收集需要推送的设备，结构：Map<imageUrl, Set<deviceIp>>
      const imagePushTargets = new Map()
      for (const group of groups) {
        const imageAddress = group.selectedUrl === 'custom' ? group.customUrl.trim() : group.selectedUrl.trim()
        if (group.selectedUrl === 'custom') continue
        const targetContainers = group.androidType === 'V2'
          ? group.containers.filter(c => c.androidType === 'V2')
          : group.containers.filter(c => c.androidType !== 'V2')
        for (const container of targetContainers) {
          const deviceIp = container.deviceIp || ''
          if (!deviceIp) continue
          if (!imagePushTargets.has(imageAddress)) imagePushTargets.set(imageAddress, new Set())
          imagePushTargets.get(imageAddress).add(deviceIp)
        }
      }

      // 逐一推送镜像到各设备
      for (const [imageUrl, deviceIpSet] of imagePushTargets.entries()) {
        const downloadResult = await IsImageDownloaded(imageUrl)
        if (!downloadResult.downloaded || !downloadResult.local_path) {
          throw new Error(`无法获取镜像本地路径：${imageUrl}`)
        }
        const localPath = downloadResult.local_path
        for (const deviceIp of deviceIpSet) {
          const device = devices.value.find(d => d.ip === deviceIp)
          const version = device?.version || ''
          const password = getDevicePassword(deviceIp)

          // 检查设备上是否已存在该镜像，避免重复推送
          try {
            const deviceImages = await GetImages(deviceIp, version, password || '')
            let imageAlreadyExists = false
            if (Array.isArray(deviceImages)) {
              imageAlreadyExists = deviceImages.some(img => {
                const repoTags = img.RepoTags || img.imageUrl || img.Image
                if (Array.isArray(repoTags)) {
                  return repoTags.some(tag => tag === imageUrl || tag.includes(imageUrl))
                }
                return repoTags === imageUrl || (typeof repoTags === 'string' && repoTags.includes(imageUrl))
              })
            } else if (deviceImages && deviceImages.list) {
              imageAlreadyExists = deviceImages.list.some(img => {
                const imgUrl = img.imageUrl || img.Image
                return imgUrl === imageUrl || (typeof imgUrl === 'string' && imgUrl.includes(imageUrl))
              })
            }
            if (imageAlreadyExists) {
              console.log(`[批量更新镜像] 设备 ${deviceIp} 已存在镜像 ${imageUrl}，跳过推送`)
              continue
            }
          } catch (e) {
            console.warn(`[批量更新镜像] 检查设备 ${deviceIp} 镜像列表失败，继续推送:`, e)
          }

          const loadResult = await LoadImageToDevice(deviceIp, localPath, version, password || '')
          if (!loadResult.success && !loadResult.canceled) {
            throw new Error(`推送镜像到设备 ${deviceIp} 失败：${loadResult.message || '未知错误'}`)
          }
        }
      }

      // 调用 change-image 接口
      const allSubTasks = []
      const totalContainers = allContainers.length || 1
      for (const group of groups) {
        const imageAddress = group.selectedUrl === 'custom' ? group.customUrl.trim() : group.selectedUrl.trim()
        const apiPath = group.androidType === 'V2' ? '/androidV2/change-image' : '/android/change-image'
        const targetContainers = group.androidType === 'V2'
          ? group.containers.filter(c => c.androidType === 'V2')
          : group.containers.filter(c => c.androidType !== 'V2')

        const deviceContainerMap = new Map()
        for (const container of targetContainers) {
          const deviceIp = container.deviceIp || ''
          if (!deviceIp) continue
          if (!deviceContainerMap.has(deviceIp)) deviceContainerMap.set(deviceIp, [])
          const containerName = container.name || container.Name || container.names?.[0] || ''
          if (containerName) deviceContainerMap.get(deviceIp).push(containerName)
        }

        for (const [deviceIp, containerNames] of deviceContainerMap.entries()) {
          allSubTasks.push(async () => {
            try {
              const savedPassword = getDevicePassword(deviceIp)
              const headers = {}
              if (savedPassword) {
                headers['Authorization'] = `Basic ${btoa(`admin:${savedPassword}`)}`
              }
              
              try {
                for (const cn of containerNames) {
                  await CloseProjectionWindow(cn);
                }
              } catch(e) { console.warn('关闭投屏窗口失败:', e); }

              const response = await axios.post(
                `http://${getDeviceAddr(deviceIp)}${apiPath}`,
                { containerNames, image: imageAddress },
                { headers }
              )
              if (response.data && response.data.code === 0) {
                const remoteTaskId = response.data.data?.taskId
                if (remoteTaskId) {
                  // 记录本子任务开始前的累计数，用于计算增量
                  const baseSuccess = successCount
                  const baseFail = failCount
                  const pollResult = await pollTaskStatus(
                    deviceIp, remoteTaskId, headers, containerNames.length, group.groupLabel,
                    (curSuccess, curFail, _total) => {
                      // 每次轮询实时更新进度条（增量 = 本轮已完成数 - 上一轮）
                      if (queueTask) {
                        const totalDone = baseSuccess + baseFail + curSuccess + curFail
                        queueTask.completed = baseSuccess + curSuccess
                        queueTask.failed = baseFail + curFail
                        queueTask.progress = Math.min(
                          Math.round(totalDone / totalContainers * 100),
                          99 // 未最终确认完成前最多到99%
                        )
                      }
                    }
                  )
                  successCount += pollResult.successCount
                  failCount += pollResult.failCount
                  if (pollResult.failDetails.length > 0) {
                    failDetails.push(...pollResult.failDetails)
                  }
                } else {
                  successCount += containerNames.length
                }
              } else {
                failCount += containerNames.length
                failDetails.push({ deviceIP: `${deviceIp}(${group.groupLabel})`, error: response.data?.message || '未知错误' })
              }
            } catch (err) {
              failCount += containerNames.length
              failDetails.push({ deviceIP: `${deviceIp}(${group.groupLabel})`, error: err.message || '请求失败' })
            }
            // 子任务完成后同步最终进度
            if (queueTask) {
              queueTask.completed = successCount
              queueTask.failed = failCount
              queueTask.progress = Math.round((successCount + failCount) / totalContainers * 100)
            }
          })
        }
      }

      if (allSubTasks.length === 0) {
        if (queueTask) {
          queueTask.status = 'failed'
          queueTask.endTime = new Date()
          queueTask.error = '未能获取到有效的容器信息'
        }
        return
      }

      await Promise.all(allSubTasks.map(fn => fn()))

      // 完成
      if (queueTask) {
        queueTask.completed = successCount
        queueTask.failed = failCount
        queueTask.progress = 100
        queueTask.status = failCount === 0 ? 'completed' : 'failed'
        queueTask.endTime = new Date()
        if (failDetails.length > 0) {
          queueTask.failedTargets = failDetails
        }
      }
    } catch (error) {
      if (queueTask) {
        queueTask.status = 'failed'
        queueTask.endTime = new Date()
        queueTask.error = error.message
      }
      ElMessage.error(`批量更新镜像失败：${error.message}`)
    }
  })()
}

// 备份切换 / 备份删除 / 备份分组 / 机型树拖拽（阶段 3 迁出到 composables/useBackupOperations.js）
const {
  switchBackup,
  deleteBackup,
  batchDeleteBackup,
  addBackupGroup,
  addNewModel,
  handleDragAndDrop,
  handleDrop,
  handleNodeDrop,
} = useBackupOperations({
  backupCurrentSlot,
  activeDevice,
  backupListVisible,
  deviceCloudMachinesCache,
  switchingBackupSlot,
  backupLoading,
  instances,
  authRetry,
  allInstances,
  cloudManageMode,
  selectedCloudMachines,
  treeSelectedKeys,
  initBackupList,
  selectedBackupList,
  backupGroups,
  selectedBackupGroup,
  cloudMachineGroups,
  devices,
  cloudMachines,
}, {
  // 以下依赖在下方才声明，用惰性依赖避免 TDZ
  fetchAndroidContainers: (...a) => fetchAndroidContainers(...a),
})



// 计算排序后的备份列表
const sortedBackupList = computed(() => {
  return [...backupList.value].sort((a, b) => {
    if (sortBy.value === 'createTime') {
      const aVal = new Date(a[sortBy.value]).getTime()
      const bVal = new Date(b[sortBy.value]).getTime()
      return sortOrder.value === 'ascending' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1)
    }
    
    // 名称排序：按截取后的短名称自然排序（如 1778046657165_6_0_copy_A1 -> A1）
    const aKey = naturalSortKey(extractShortName(a[sortBy.value]))
    const bKey = naturalSortKey(extractShortName(b[sortBy.value]))
    const len = Math.min(aKey.length, bKey.length)
    let cmp = 0
    for (let i = 0; i < len; i++) {
      const ai = aKey[i]
      const bi = bKey[i]
      // 同类型比较：数字与数字比，字符串与字符串比
      if (typeof ai === 'number' && typeof bi === 'number') {
        if (ai !== bi) { cmp = ai > bi ? 1 : -1; break }
      } else {
        const as = String(ai), bs = String(bi)
        if (as !== bs) { cmp = as > bs ? 1 : -1; break }
      }
    }
    if (cmp === 0 && aKey.length !== bKey.length) {
      cmp = aKey.length > bKey.length ? 1 : -1
    }
    // 短名称相同时，按完整名称排序作为二级排序（区分不同时间戳的同名备份）
    if (cmp === 0) {
      const aFull = a[sortBy.value] || ''
      const bFull = b[sortBy.value] || ''
      cmp = aFull > bFull ? 1 : (aFull < bFull ? -1 : 0)
    }
    return sortOrder.value === 'ascending' ? cmp : -cmp
  })
})

// 切换排序
const changeSort = (field) => {
  if (sortBy.value === field) {
    sortOrder.value = sortOrder.value === 'ascending' ? 'descending' : 'ascending'
  } else {
    sortBy.value = field
    sortOrder.value = 'descending'
  }
}

// 同步计算云机分组数据（无防抖）
const computeCloudMachineGroups = (mode = cloudManageMode.value) => {
  console.log('computeCloudMachineGroups called with mode:', mode)
  console.log('devices.value:', devices.value)
  console.log('deviceGroups.value:', deviceGroups.value)
  
  // 根据设备分组生成云机分组数据
  const groups = []
  
  // 遍历所有设备分组
  deviceGroups.value.forEach(groupName => {
    // 批量模式下只显示在线设备
    const groupDevices = devices.value.filter(device => {
      const deviceGroup = device.group || '默认分组'
      const isInGroup = deviceGroup === groupName
      const isOnline = mode === 'batch' 
        ? devicesStatusCache.value.get(device.id) === 'online'
        : true
      return isInGroup && isOnline
    }).sort((a, b) => compareIPs(a.ip, b.ip))
    
    if (groupDevices.length > 0) {
      // 为该分组创建云机分组
      const groupData = {
        id: `group-${groupName}`,
        name: groupName,
        devices: groupDevices.map(device => {
          // 从deviceCloudMachinesCache中获取对应设备的云机数据
          const deviceCloudMachines = deviceCloudMachinesCache.value.get(device.ip) || []
          // 批量模式下只显示运行中的云机
          const filteredCloudMachines = mode === 'batch' 
            ? deviceCloudMachines.filter(machine => machine.status === 'running')
            : deviceCloudMachines
          
          console.log('Device:', device.ip, 'has', filteredCloudMachines.length, 'cloud machines (mode:', mode, ')')
          
          // 对云机按坑位号排序（与坑位模式的 indexNum 口径一致）。
          // 旧实现取 id.split('_')[1] 解析的是容器名：简单名（T0002）得 NaN、
          // 带哈希名（hash_2_T0002）得哈希串前导数字，排序从未真正生效
          const sortedCloudMachines = [...filteredCloudMachines].sort((a, b) =>
            getCloudMachineSlotNum(a) - getCloudMachineSlotNum(b)
          )
          
          return {
            id: device.id,
            ip: device.ip,
            name: device.name,
            group: groupName,
            cloudMachines: sortedCloudMachines
          }
        })
      }
      
      groups.push(groupData)
    }
  })
  
  console.log('computed cloudMachineGroups:', groups)
  
  return groups
}

// 初始化云机分组数据（带防抖）
const initCloudMachineGroups = () => {
  if (initGroupsTimeout.value) {
    clearTimeout(initGroupsTimeout.value)
  }
  
  initGroupsTimeout.value = setTimeout(() => {
    cloudMachineGroups.value = computeCloudMachineGroups()
    
    // 不默认选择设备，保持selectedCloudDevice为空，显示12个空坑位
    // 只有在用户点击设备列表时才选择设备并加载对应数据
  }, 100)
}

// 包装删除容器函数，删除后刷新备份列表
const handleDeleteContainerWithBackupRefresh = async (container) => {
  const result = await handleDeleteContainer(container)
  // 如果删除成功且备份列表可见，刷新备份列表
  if (result?.success && backupListVisible.value) {
    initBackupList()
  }
  return result
}

// 关闭设备详情弹窗


// 设备详情弹窗关闭前的回调函数
const handleDeviceDetailsDialogClose = () => {
  console.log('设备详情弹窗关闭前回调');
  collapseRightSidebar();
}

// 显示设备详情弹窗


// 删除设备镜像
const handleDeleteImage = async (image) => {
  try {
    // 显示确认对话框
    await ElMessageBox.confirm(
      `确定要删除镜像 "${image.onlineImageName}" 吗？`,
      '删除确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    );

    // 直接调用Wails IPC删除镜像
    console.log('调用Wails IPC删除镜像:', image.url);
    const savedPassword = getDevicePassword(activeDevice.value.ip);
    
    let response = null;
    let deleteSuccess = false;
    
    // 尝试使用axios直接调用设备API删除镜像
    try {
      console.log('尝试使用axios直接调用设备API删除镜像');
      const apiUrl = `http://${activeDevice.value.version === 'v3' ? getDeviceAddr(activeDevice.value.ip) : activeDevice.value.ip + ':81'}/android/image?image=${encodeURIComponent(image.url)}`;
      const headers = {};
      if (savedPassword) {
        const auth = btoa(`admin:${savedPassword}`);
        headers['Authorization'] = `Basic ${auth}`;
      }
      
      const axiosResponse = await axios.delete(apiUrl, { headers });
      response = axiosResponse.data;
      console.log('使用axios直接调用设备API删除镜像结果:', response);
      if (response && response.code === 0) {
        deleteSuccess = true;
        refreshImageList()
      }
    } catch (error) {
      console.error('删除镜像API调用失败:', error);
      
      // 处理认证错误
      if (error.response?.status === 401 || error.response?.data?.code === 61) {
        console.log('删除镜像认证失败，需要显示认证对话框')
        // 显示认证对话框
        showAuthDialog(activeDevice.value, async (password) => {
          // 认证成功后重新尝试删除
          console.log('认证回调被调用，开始重试删除镜像，密码长度:', password ? password.length : 0)
          try {
            console.log('认证后重新尝试删除镜像');
            const apiUrl = `http://${activeDevice.value.version === 'v3' ? getDeviceAddr(activeDevice.value.ip) : activeDevice.value.ip + ':81'}/android/image?image=${encodeURIComponent(image.url)}`;
            const auth = btoa(`admin:${password}`);
            const headers = {
              'Authorization': `Basic ${auth}`
            };
            
            console.log('重试删除镜像 API URL:', apiUrl)
            console.log('重试删除镜像请求头:', headers)
            
            const axiosResponse = await axios.delete(apiUrl, { headers });
            const response = axiosResponse.data;
            console.log('认证后删除镜像结果:', response);
            
            if (response && response.code === 0) {
              ElMessage.success('镜像删除成功');
              refreshImageList();
            } else {
              ElMessage.error(response?.message || '镜像删除失败');
            }
          } catch (retryError) {
            console.error('认证后重试删除镜像失败:', retryError);
            console.error('错误详情:', retryError.response?.data);
            ElMessage.error('删除镜像失败: ' + (retryError.response?.data?.message || retryError.message));
          }
        });
        return;
      }
      
      // 如果所有API调用都失败，尝试从本地镜像列表中移除该镜像
      console.log('尝试从本地镜像列表中移除该镜像');
      
      // 找到该镜像在boxImages中的索引（matchedBoxImages是计算属性，不能直接修改）
      const imageIndex = boxImages.value.findIndex(img => img.url === image.url);
      if (imageIndex !== -1) {
        // 从原始数据源中移除该镜像
        boxImages.value.splice(imageIndex, 1);
        // 更新在线镜像状态
        await checkAllImagesDownloadStatus();
        // 显示成功消息
        ElMessage.success('镜像删除成功');
        return;
      }
      
      throw error;
    }

    // 根据API返回结果判断是否删除成功
    if (deleteSuccess) {
      // 显示成功消息
      ElMessage.success('镜像删除成功');
      // 重新获取设备镜像列表，刷新显示
      await switchImageCategory(selectedImageCategory.value);
    } else {
      // 显示失败消息
      ElMessage.error(`删除镜像失败: ${response?.message || '未知错误'}`);
    }
  } catch (error) {
    // 如果是用户取消操作，不显示错误消息
    if (error !== 'cancel') {
      console.error('删除镜像失败:', error);
      ElMessage.error(`删除镜像失败: ${error.message || '未知错误'}`);
    }
  }
}

// 设备选择事件处理
const handleDeviceSelect = async (device) => {
  console.log('handleDeviceSelect called with device:', device)
  if (device) {
    console.log('Setting activeDevice and selectedCloudDevice to:', device.ip)
    activeDevice.value = device
    selectedCloudDevice.value = device // 同步到selectedCloudDevice，确保云机管理也能获取到设备
    
    // 重置上传状态，避免切换设备后上传按钮被禁用
    isUploadingImage.value = false
    currentUploadImage.value = null
    uploadProgress.value = 0
    // 清除上传状态，因为不同设备的上传状态是独立的
    imageUploadStatus.value.clear()
    
    // 切换设备时停止当前截图刷新
    stopScreenshotRefresh()

    // 切换设备时立即清空坑位状态，避免显示上一个设备的已过期/即将过期标签
    setSlotStates({}, '')
    if (device.id) {
      fetchAndCacheSlotStates(device.id)
    }

    // 清空选中的云机列表，避免不同设备的云机混淆
    selectedCloudMachines.value = []
    
    // 立即清空右侧内容，提供更好的用户体验
    instances.value = []
    allInstances.value = []
    updateCloudMachines()
    
    // 异步获取选中设备的容器列表，isUserInitiated=true表示用户主动操作
    console.log('Calling fetchAndroidContainers for device:', device.ip)
    fetchAndroidContainers(device, true)
      .then(() => {
        console.log('After fetchAndroidContainers, instances.value:', instances.value)
        
        // 获取盒子镜像列表
        console.log('Calling fetchBoxImages')
        return fetchBoxImages()
      })
      .then(() => {
        // 检查在线镜像的下载和上传状态
        console.log('Calling checkAllImagesDownloadStatus')
        return checkAllImagesDownloadStatus()
      })
      .then(() => {
        // 检查在线镜像的上传状态
        console.log('Calling checkOnlineImagesUploadStatus')
        return checkOnlineImagesUploadStatus()
      })
      .then(() => {
        // 使用nextTick确保DOM更新后再执行后续操作，避免布局挤压
        nextTick(() => {
          // 刷新云机列表
          console.log('Calling updateCloudMachines')
          updateCloudMachines()
          console.log('After updateCloudMachines, cloudMachines.value:', cloudMachines.value)
          
          // 开始截图刷新初始化（不再自动刷新）
          // startScreenshotRefresh()
          
          console.log('handleDeviceSelect completed')
        })
      })
      .catch(error => {
        console.error('Error in fetchAndroidContainers:', error)
        // 即使出错，也确保云机列表已更新
        nextTick(() => {
          updateCloudMachines()
        })
      })
    
    // 如果是V3设备，获取详细信息
    if (device.version === 'v3') {
      console.log('Fetching V3 device info for:', device.ip)

      // 🔧 先用心跳缓存立即上屏（点开设备到内容渲染不等接口往返）
      const cachedInfo = deviceFirmwareInfo.value.get(device.id)
      if (cachedInfo && cachedInfo.originalData) {
        console.log('[快速加载] 从心跳数据加载 V3 设备信息')
        v3DeviceInfo.value = {
          sdkVersion: cachedInfo.sdkVersion,
          deviceModel: cachedInfo.deviceModel,
          originalData: cachedInfo.originalData
        }
        v3DeviceInfoLoaded.value = true
      }
      // 无论有没有缓存，都现场调一次 /info/device（成功后内部还会调
      // fetchV3LatestInfo 拉 /info 的当前/最新 API 版本）。心跳的事件流给不了
      // memtotal/speed/mmcmodel/hwaddr/latestVersion 这些字段，设备详情弹窗
      // 点开主机看到的数据必须以这次接口返回为准；启动时没查到（比如设备
      // 当时离线）的话，只靠缓存就永远是旧值了
      fetchV3DeviceInfo(device)
    } else {
      // 非V3设备，清空之前的V3设备信息
      v3DeviceInfo.value = {}
      v3LatestInfo.value = {}
      showUpgradeButton.value = false
    }
    
    // 获取设备的Docker网络列表
    console.log('Fetching Docker networks for:', device.ip)
    fetchDockerNetworks(device)
  } else {
    console.error('handleDeviceSelect called with null/undefined device')
  }
}

const handleHostDeviceSelectionChange = async (selection) => {
  selectedHostDevices.value = selection
  
  // 如果只选择了一个设备，设置为当前活动设备
  // if (selection.length === 1) {
  //   await handleDeviceSelect(selection[0])
  // }
}




const fetchV3DeviceInfo = async (device) => {
  if (!device || device.version !== 'v3') return
  
  try {
    // 重置加载状态
    v3DeviceInfoLoaded.value = false
    
    // 使用authRetry处理认证
    await authRetry(device, async (password) => {
      let headers = {}
      if (password) {
        const auth = btoa(`admin:${password}`)
        headers = {
          'Authorization': `Basic ${auth}`
        }
      }
      
      const url = `http://${getDeviceAddr(device.ip)}/info/device`
      const response = await axios.get(url, { 
        timeout: 1500,
        headers: headers
      })
      console.log('V3设备信息API返回:', response.data)
      
      if (response.data.code === 0) {
        const data = response.data.data
        // 适配实际API返回格式，映射字段名
        const deviceInfo = {
          sdkVersion: data.version, // 实际返回的version字段对应SDK版本
          deviceModel: data.model, // 实际返回的model字段对应设备型号
          hardwareVersion: '未知', // API未返回硬件版本
          firmwareVersion: '未知', // API未返回固件版本
          // 保留原始数据，方便后续扩展
          originalData: data
        }
        
        // 使用nextTick确保UI更新
        await nextTick()
        v3DeviceInfo.value = deviceInfo
        
        // 将固件信息存储到全局Map中，以便在设备列表中显示
        // 使用set方法修改现有Map，避免替换整个对象导致的重新渲染
        deviceFirmwareInfo.value.set(device.id, deviceInfo)
        
        v3DeviceInfoLoaded.value = true
        console.log('V3设备信息更新完成:', v3DeviceInfo.value)
        
        // 获取最新版本信息
        await fetchV3LatestInfo(device)
        
        // ⚠️ 不再手动设置设备在线状态，由心跳检测系统统一管理
        // devicesStatusCache.value.set(device.id, 'online')
      } else if (response.data.code === 61 && response.data.message === 'Authentication Failed') {
        throw new Error('Authentication Failed')
      }
    })
  } catch (error) {
    console.error('获取V3设备信息失败:', error)
    // 接口超时或失败时，不清空设备信息，保持现有数据
    v3DeviceInfoLoaded.value = true // 即使失败也标记为已加载，避免一直显示加载中
    
    // ⚠️ 不手动标记设备为离线，由心跳检测系统统一管理
    // devicesStatusCache.value.set(device.id, 'offline')

    // 更新设备最后更新时间
    // devicesLastUpdateTime.value.set(device.id, Date.now())
    
    // 不需要调用API版本信息，因为设备已离线
  }
}

// 获取设备绑定状态
const fetchDeviceBindStatus = async () => {
  try {
    // 1. 获取所有设备的deviceId
    const deviceIds = devices.value.map(device => device.id)
    if(deviceIds.length === 0) return

    console.log('fetchDeviceBindStatus', deviceIds)
    
    // 2. 构造请求数据

    const formData = new URLSearchParams()
    formData.append('type', 'user_host_oper');
    const data = {
       act: 'get',
       data: JSON.stringify({ host: deviceIds }),
       token: token.value
    }
    formData.append('data', JSON.stringify(data));


    console.log('formData:', formData)

    const response = await fetch('https://www.moyunteng.com/api/api.php', {
          method: 'POST',
          body: formData
     })  
 
       const result = await response.json()
       console.log('response:', result)
    
    // 4. 处理API返回结果
    if (result.code == 200) {
      // 清空之前的绑定状态
      deviceBindStatus.value.clear()
      
      // 遍历返回的绑定状态数据，将结果存入deviceBindStatus
      Object.entries(result.data).forEach(([deviceId, status]) => {
        deviceBindStatus.value.set(deviceId, status)
      })
      
      console.log('设备绑定状态获取成功:', deviceBindStatus.value)
    } else if (result.code == 3030) {
      handleAuthExpired()
    }
     else {
      console.error('获取设备绑定状态失败:', result.message)
      ElMessage.error('获取设备绑定状态失败: ' + result.message)
    }
  } catch (error) {
    console.error('获取设备绑定状态异常:', error)
    ElMessage.error('获取设备绑定状态异常: ' + error.message)
  }
}

const fetchDockerNetworks = async (device) => {
  if (!device) return
  
  try {
    dockerNetworksLoading.value = true
    dockerNetworksError.value = ''
    
    // 使用后端代理获取Docker网络列表
    const networks = await getDockerNetworks(device)
    dockerNetworks.value = networks
    console.log('Docker网络列表:', dockerNetworks.value)
  } catch (error) {
    console.error('获取Docker网络列表失败:', error)
    dockerNetworks.value = []
    dockerNetworksError.value = `获取网络列表失败: ${error.message}`
  } finally {
    dockerNetworksLoading.value = false
  }
}

// 云机设备选择事件处理
const handleCloudDeviceSelect = async (device) => {
  console.log('handleCloudDeviceSelect called with device:', device)
  if (device) {
    console.log('Setting selectedCloudDevice and activeDevice to:', device.ip)
    selectedCloudDevice.value = device
    activeDevice.value = device // 同步到activeDevice，确保主机管理和云机管理使用同一设备

    // 切换设备时停止当前截图刷新，清空版本快照强制下次立即拉取新设备截图
    stopScreenshotRefresh()
    resetScreenshotVersions()

    // 切换设备时立即清空坑位状态，避免显示上一个设备的已过期/即将过期标签
    setSlotStates({}, '')
    fetchAndCacheSlotStates(device.id)

    // 清空选中的云机列表，避免不同设备的云机混淆
    selectedCloudMachines.value = []
    
    // 立即清空右侧内容，提供更好的用户体验
    instances.value = []
    allInstances.value = []
    updateCloudMachines()
    
    // 异步获取选中设备的容器列表，isUserInitiated=true表示用户主动操作
    console.log('Calling fetchAndroidContainers for device:', device.ip)
    fetchAndroidContainers(device, true)
      .then(() => {
        // 使用nextTick确保DOM更新后再执行后续操作，避免布局挤压
        nextTick(() => {
          // 刷新云机列表
          console.log('Calling updateCloudMachines')
          updateCloudMachines()
          
          // 开始截图定时刷新（每1秒）
          startScreenshotRefresh()
          console.log('handleCloudDeviceSelect completed')
        })
      })
      .catch(error => {
        console.error('Error in fetchAndroidContainers:', error)
        // 即使出错，也确保云机列表已更新
        nextTick(() => {
          updateCloudMachines()
        })
      })
  } else {
    console.error('handleCloudDeviceSelect called with null/undefined device')
  }
}

// 获取V3设备详细信息


// 获取V3最新版本信息
const fetchV3LatestInfo = async (device) => {
  if (!device || device.version !== 'v3') return

  // 不做离线拦截：老 SDK(<208) 设备没有事件流会被判"离线"，但 HTTP 仍可达，
  // 必须查 /info 才能拿到当前/最新 SDK 版本并显示"升级SDK"入口；
  // 真不可达的设备这里只是多付一次 1 秒超时
  try {
    // 使用authRetry处理认证
    await authRetry(device, async (password) => {
      let headers = {}
      if (password) {
        const auth = btoa(`admin:${password}`)
        headers = {
          'Authorization': `Basic ${auth}`
        }
      }
      
      const url = `http://${getDeviceAddr(device.ip)}/info`
      const response = await axios.get(url, { 
        timeout: 1000,
        headers: headers
      })
      
      if (response.data.code === 0) {
        const data = response.data.data
        // 适配实际API返回格式
        v3LatestInfo.value = {
          version: data.latestVersion.toString(), // 将数字版本转换为字符串
          currentVersion: data.currentVersion.toString(),
          originalData: data
        }
        console.log('V3最新版本信息:', v3LatestInfo.value)

        // 同步设备列表"API版本"列的当前/最新值。latestVersion 只有 /info 这个
        // 接口才返回（事件流 hello 只带当前版本），不写回的话列表里的"最新"
        // 会一直停在启动时版本检查队列查到的那一次
        const newCurrent = data.currentVersion.toString()
        const newLatest = data.latestVersion.toString()
        const cachedVersionInfo = deviceVersionInfo.value.get(device.id)
        if (!cachedVersionInfo || cachedVersionInfo.currentVersion !== newCurrent || cachedVersionInfo.latestVersion !== newLatest) {
          deviceVersionInfo.value.set(device.id, {
            ...cachedVersionInfo,
            currentVersion: newCurrent,
            latestVersion: newLatest,
            lastUpdateTime: Date.now()
          })
        }

        // 检查是否需要显示升级按钮
        // 比较currentVersion和latestVersion数字版本
        // 只有当确实需要升级时才显示升级按钮，否则保持当前状态
        if (data.currentVersion < data.latestVersion) {
          showUpgradeButton.value = true
        } else {
          // 如果不需要升级，不改变当前状态，避免刷新后升级按钮消失
          // showUpgradeButton.value = false
        }
      } else if (response.data.code === 61 && response.data.message === 'Authentication Failed') {
        throw new Error('Authentication Failed')
      }
    })
  } catch (error) {
    console.error('获取V3最新版本信息失败:', error)
    // 只重置版本信息，不重置showUpgradeButton状态，避免刷新后升级按钮消失
    v3LatestInfo.value = {}
    // 保持showUpgradeButton当前状态，不设置为false

    // ⚠️ 不手动标记设备为离线，由心跳检测系统统一管理
    // devicesStatusCache.value.set(device.id, 'offline')

    // 更新设备最后更新时间
    // devicesLastUpdateTime.value.set(device.id, Date.now())
  }
}

// 升级SDK


// 获取Docker网络列表


// 显示添加macvlan网络弹窗


// 国家提示
const fetchCountryList = async () => {
  createForm.value.countryCode = ''
  // 仅在列表为空时触发请求，避免每次 focus 重复请求
  if (countryList.value.length === 0) {
    const deviceIP = createDevice.value?.ip || activeDevice.value?.ip || selectedCloudDevice.value?.ip
    if (deviceIP) {
      await getCountryList(deviceIP)
    }
  }
}


// 添加macvlan网络
const handleAddMacvlanSubmit = async () => {
  if (!activeDevice.value) return
  
  try {
    addMacvlanLoading.value = true
    
    // 调用后端API创建macvlan网络
    console.log('添加macvlan网络:', addMacvlanForm.value)
    
    const result = await createDockerNetwork(activeDevice.value, addMacvlanForm.value)
    
    if (result.success) {
      ElMessage.success('macvlan网络添加成功')
      addMacvlanDialogVisible.value = false
      
      // 刷新网络列表
      await fetchDockerNetworks(activeDevice.value)
    } else {
      ElMessage.error(`添加macvlan网络失败: ${result.message}`)
    }
  } catch (error) {
    console.error('添加macvlan网络失败:', error)
    ElMessage.error(`添加macvlan网络失败: ${error.message}`)
  } finally {
    addMacvlanLoading.value = false
  }
}

// 取消添加macvlan网络
const handleAddMacvlanCancel = () => {
  addMacvlanDialogVisible.value = false
}

// 显示添加macvlan网络弹窗
const showAddMacvlanDialog = () => {
  // 重置表单
  addMacvlanForm.value = {
    networkName: '',
    parentInterface: '',
    subnet: '',
    gateway: '',
    ipRange: '',
    isPrivate: false
  }
  addMacvlanDialogVisible.value = true
}

// 处理修改网络


// 修改网络提交
const handleEditNetworkSubmit = async () => {
  if (!activeDevice.value || !currentEditingNetwork.value) return
  
  try {
    editNetworkLoading.value = true
    
    // 调用后端API更新网络
    const result = await updateDockerNetwork(activeDevice.value, editNetworkForm.value.networkID, editNetworkForm.value)
    
    if (result.success) {
      ElMessage.success('网络修改成功')
      editNetworkDialogVisible.value = false
      
      // 刷新网络列表
      await fetchDockerNetworks(activeDevice.value)
    } else {
      ElMessage.error(`修改网络失败: ${result.message}`)
    }
  } catch (error) {
    console.error('修改网络失败:', error)
    ElMessage.error(`修改网络失败: ${error.message}`)
  } finally {
    editNetworkLoading.value = false
  }
}

// 取消修改网络
const handleEditNetworkCancel = () => {
  editNetworkDialogVisible.value = false
  currentEditingNetwork.value = null
}

// 处理删除网络


// 主机管理列表切到"离线"筛选时，把离线 V3 设备的 API 版本现场重探一遍：
// 被手动降级/老 SDK(<208) 的设备只是事件通道口径下"离线"（/ws/events 404），
// HTTP /info 还活着，能探到降级后的真实版本，避免离线列表一直显示降级前的
// 旧值；真死机的设备 1s 超时探不通，队列失败不清旧值，保留最后一次拿到的版本
const handleDeviceFilterChange = (filter) => {
  deviceFilter.value = filter
  if (filter === 'offline') {
    for (const device of devices.value) {
      if (device.version === 'v3' && devicesStatusCache.value.get(device.id) === 'offline') {
        addToVersionCheckQueue(device)
      }
    }
    batchProcessVersionCheckQueue()
  }
}

// 标签页切换事件处理
const handleTabChange = (tabName) => {
  console.log('Tab changed to:', tabName)
  
  // 处理截图刷新的开启与暂停
  if (tabName === 'cloud-management') {
    // 切换回云机管理页面，尝试启动截图刷新
    // startScreenshotRefresh 内部会检查是否有选中的设备或云机
    startScreenshotRefresh()
    
    // 如果是坑位模式且没有选中设备，自动选择第一个在线设备
    if (cloudManageMode.value === 'slot' && !selectedCloudDevice.value) {
      const firstOnlineDevice = devices.value.find(device => {
        return devicesStatusCache.value.get(device.id) === 'online'
      })
      if (firstOnlineDevice) {
        console.log('切换到云机管理页面(坑位模式)，自动选择第一个在线设备:', firstOnlineDevice.name)
        selectedCloudDevice.value = firstOnlineDevice
        activeDevice.value = firstOnlineDevice
        fetchAndroidContainers(firstOnlineDevice, true).then(() => {
          initCloudMachineGroups()
        })
      }
    }
    
    // 如果有选中设备，截图轮询已通过 startScreenshotRefresh 启动，无需手动触发
  } else {
    // 离开云机管理页面，停止截图刷新
    stopScreenshotRefresh()
  }
  
  // 切换到主机管理页面时，把列表的 API版本（当前/最新）重新查一遍：
  // 不能等点击"查看"打开设备详情弹窗才现场调接口。离线设备也一并入队——
  // 老 SDK/被手动降级的设备拨 /ws/events 得 404 被判"离线"，但 HTTP /info
  // 还活着，现场能探到降级后的真实版本；真死机的设备 1s 超时探不通，队列
  // 失败不会清旧值，列表保留最后一次拿到的版本。不批量调
  // fetchV3DeviceInfo——它会改写右侧主机面板正在展示的 v3DeviceInfo
  // （选中设备的现场数据），循环调用会把面板数据串到别的设备上
  if (tabName === 'host-management') {
    for (const device of devices.value) {
      if (device.version === 'v3') {
        addToVersionCheckQueue(device)
      }
    }
    batchProcessVersionCheckQueue()
  }

  // 切换到机型管理页面时，触发机型列表数据获取
  if (tabName === 'model-management' && modelManagementRef.value) {
    console.log('切换到机型管理页面，触发机型列表数据获取')
    modelManagementRef.value.fetchPhoneModels()
  }

  // 切换到实例管理页面时，触发实例列表数据获取
  if (tabName === 'instance-management') {
    console.log('切换到实例管理页面，触发实例列表数据获取')
    instanceManagementRef.value.fetchInstances()
  }

  // 切换到网络管理页面时，触发网络列表数据获取
  if (tabName === 'network-management') {
    console.log('切换到网络管理页面，触发网络列表数据获取')
    networkManagementRef.value.fetchNetworks()
  }

  // 切换到云机管理页面时，触发备份列表数据获取
  if (tabName === 'backup-management') {
    console.log('切换到云机管理页面，触发备份列表数据获取')
    backupManagementRef.value.fetchBackups()
  }

  // 切换到AI助理页面时，触发AI助理数据获取
  if (tabName === 'ai-assistant') {
    console.log('切换到AI助理页面，触发AI助理数据获取')
    aiAssistantRef.value.fetchAiAssistant()
  }

  // 切换到RPA Agent页面时，触发RPA Agent数据获取
  if (tabName === 'rpa-agent') {
    console.log('切换到RPA Agent页面')
    rpaAgentRef.value?.fetchRpaAgent()
  }

  // 切换到OpenCecs页面时，触发初始化数据获取
  if (tabName === 'opencecs-management') {
    console.log('切换到OpenCecs页面，触发初始化数据获取')
    opencecsManagementRef.value?.init()
  }

  // 切换到客服页面时，触发资产信息上报
  if (tabName === 'customer-service') {
    console.log('切换到客服页面，触发资产信息上报')
    // 延迟一下确保组件已经渲染
    nextTick(() => {
      if (customerServiceRef.value && token.value) {
        // 重新生成 ticket
        if (customerServiceRef.value.initCustomerServiceUrl) {
          customerServiceRef.value.initCustomerServiceUrl()
        }
        if (customerServiceRef.value.reportUserAssets) {
          customerServiceRef.value.reportUserAssets()
        }
      }
    })
  }
}


// 监听选中的云机变化，取消勾选时停止相关截图请求
watch(selectedCloudMachines, (newSelected, oldSelected) => {
  if (oldSelected.length !== newSelected.length) {
    console.log('选中的云机变化:', oldSelected.length, '->', newSelected.length);
  }
  
  // 只有在云机管理标签页才处理截图刷新
  if (activeTab.value !== 'cloud-management') {
    return;
  }
  
  // 如果从无选中变为有选中，启动截图定时刷新
  if (oldSelected.length === 0 && newSelected.length > 0) {
    startScreenshotRefresh();
  }
  
  // 如果从有选中变为无选中，且仍在批量模式下（非模式切换导致的清空），停止截图刷新
  if (oldSelected.length > 0 && newSelected.length === 0 && cloudManageMode.value === 'batch') {
    stopScreenshotRefresh();
  }
}, { deep: true });

// 生命周期钩子
let refreshInterval = null
let hourlyRefreshInterval = null
let nextDeviceIndex = 0 // 用于半小时逐个设备刷新

onMounted(() => {
  // 从本地存储加载设备列表
  loadDevicesFromLocalStorage()
  // 从本地存储加载设备分组
  loadDeviceGroupsFromLocalStorage()
  // 发现设备
  discoverAndLoadDevices()

  // 初始化云机分组
  initCloudMachineGroups()
  // 自动缓存所有镜像，避免用户进入镜像管理界面还要手动刷新
  fetchImageList('')
  
  // 获取系统公告
  fetchAnnouncement()
  
  // 定时刷新设备数据（10秒）- 已禁用，避免频繁刷新
  // refreshInterval = setInterval(() => {
  //   refreshData()
  // }, 10000)
  
  // 每半小时刷新一次设备和云机列表（逐个设备）
  hourlyRefreshInterval = setInterval(() => {
    refreshDevicesContainersOneByOne()
  }, 30 * 60 * 1000) // 30分钟
  
  // 初始化版本检查队列 - 每2秒检查一个设备
  initVersionCheckQueue()
  
  // 初始化设备绑定状态查询队列 - 每1秒检查一次
  initBindCheckQueue()
  
  // 每10秒自动将所有设备添加到版本检查队列
  // versionRefreshInterval = setInterval(() => {
  //   autoGetAllDeviceVersions()
  // }, 10000) // 10秒
  
  // 初始加载时获取一次版本信息
  setTimeout(() => {
    autoGetAllDeviceVersions()
  }, 1000) // 延迟1秒执行，确保设备列表已加载
  
  // ========== 启动设备心跳检测服务 ==========
  // 延迟3秒启动，无论设备列表是否为空都启动服务
  heartbeatInitialized = false // 确保每次挂载都能重新初始化
  setTimeout(() => {
    console.log('[启动] 准备初始化设备心跳检测，当前设备数量:', devices.value.length)
    initDeviceHeartbeat()
  }, 3000) // 3秒启动，确保前端已准备好
  
  // 检查是否已有token，如果有则启动同步授权定时器
  if (token.value) {
    startSyncAuthTimer()
  }
  
  // 使用Wails的事件API注册下载进度事件监听器
  const initEventListeners = () => {
    if (!Events || !Events.On) {
      setTimeout(initEventListeners, 500)
      return
    }
    
    console.log('[事件监听器] 初始化下载进度事件监听器')
    
    // 注册事件监听器
    Events.On('download-progress', (data) => {
      // 严格验证：必须有活动的下载任务
      if (!isDownloadingImage.value || !currentDownloadTaskId.value || !currentDownloadImage.value) {
        return
      }
      
      let progress = 0
      if (data && data.data && typeof data.data.progress === 'number') {
        progress = data.data.progress
      } else if (data && typeof data.progress === 'number') {
        progress = data.progress
      }
      
      // 查找当前活动的下载任务
      const currentTask = taskQueue.value.find(t => 
        t.id === currentDownloadTaskId.value && 
        t.type === 'downloadImage' && 
        t.status === 'running'
      )
      
      if (!currentTask) {
        return
      }
      
      // 检查会话时间戳
      const taskSessionTime = currentTask.sessionStartTime || 0
      if (taskSessionTime !== downloadStartTime.value) {
        return
      }
      
      // 防止进度回退和异常跳跃
      // 钳制到0~100，防止后端异常进度值导致进度超过100%
      const newProgress = Math.max(0, Math.min(100, Math.round(progress)))
      const currentProgress = currentTask.progress || 0
      
      // 回退检测
      if (newProgress < currentProgress - 3) {
        return
      }
      
      // 跨度异常检测
      if (currentProgress > 20 && newProgress < 10) {
        return
      }
      
      // 异常跳跃检测
      if (newProgress - currentProgress > 30) {
        return
      }
      
      // 更新进度
      downloadProgress.value = progress
      currentTask.progress = newProgress
    })
    Events.On('download-complete', (data) => {
      handleDownloadComplete(data)
    })
    Events.On('upload-progress', (data) => {
      handleUploadProgress(data)
    })
    Events.On('upload-complete', (data) => {
      handleUploadComplete(data)
    })
    Events.On('sdkUpgrade:progress', (event) => {
      handleSdkUpdateTask(event)
    })
  }
  
  // 延迟注册事件监听器，确保Events模块已加载
  setTimeout(initEventListeners, 100)
  // 设置BroadcastChannel监听器，处理来自投屏窗口的IPC调用
  const ipcChannel = new BroadcastChannel('wails-ipc-child');
  ipcChannel.onmessage = async (event) => {
    if (event.data && event.data.type === 'ipc-request') {
      const { funcName, args, requestId } = event.data;
      console.log('[Main] 收到投屏窗口IPC请求:', funcName, args);
      
      try {
        let result = null;
        
        // 根据函数名调用对应的后端方法
        switch (funcName) {
          case 'ToggleProjectionWindowTop':
            if (typeof ToggleProjectionWindowTop === 'function') {
              result = await ToggleProjectionWindowTop(args);
            }
            break;
          case 'ArrangeProjectionWindows':
            if (typeof ArrangeProjectionWindows === 'function') {
              result = await ArrangeProjectionWindows(args);
            }
            break;
          default:
            console.warn('[Main] 未知的函数名:', funcName);
        }
        
        // 发送响应回投屏窗口
        ipcChannel.postMessage({
          type: 'ipc-response',
          requestId: requestId,
          result: result
        });
      } catch (error) {
        console.error('[Main] IPC调用失败:', error);
        ipcChannel.postMessage({
          type: 'ipc-response',
          requestId: requestId,
          error: error.message
        });
      }
    }
  };
  
  // 将频道保存到窗口对象，以便后续清理
  window.$wailsIpcChannel = ipcChannel;
  
  // 设置事件通道监听器，处理来自投屏窗口的Wails事件
  const eventChannel = new BroadcastChannel('wails-events');
  eventChannel.onmessage = async (event) => {
    if (event.data && event.data.type === 'wails-event') {
      const { event: eventName, data } = event.data;
      console.log('[Main] 收到投屏窗口事件:', eventName, data);
      
      // 根据事件名称调用对应的后端方法
      switch (eventName) {
        case 'ToggleProjectionWindowTop':
          if (typeof ToggleProjectionWindowTop === 'function') {
            await ToggleProjectionWindowTop(data);
          }
          break;
        case 'ArrangeProjectionWindows':
          if (typeof ArrangeProjectionWindows === 'function') {
            await ArrangeProjectionWindows(data || {});
          }
          break;
        default:
          console.warn('[Main] 未处理的事件:', eventName);
      }
    }
  };
  
  // 将事件频道保存到窗口对象
  window.$wailsEventChannel = eventChannel;

  // 注册全局设备添加函数，供 opencecsManagement 等外部组件调用
  window.addDiscoveredDevice = (device) => {
    handleAddDevice(device)
  }

  // 注册全局设备移除函数，按 IP 移除设备（供 opencecsManagement 刷新时清理旧设备）
  window.removeDiscoveredDevice = (deviceIp) => {
    const idx = devices.value.findIndex(d => d.ip === deviceIp)
    if (idx !== -1) {
      const removed = devices.value[idx]
      devicesStatusCache.value.delete(removed.id)
      devicesLastUpdateTime.value.delete(removed.id)
      devices.value.splice(idx, 1)
      // 清除该设备的云机缓存，避免旧容器对象（携带旧 deviceIp）被复用
      deviceCloudMachinesCache.value.delete(deviceIp)
      deviceAllInstancesCache.value.delete(deviceIp)
      // 如果当前正在查看的设备被移除，清空容器列表，避免旧 deviceIp 的容器残留
      if (activeDevice.value && activeDevice.value.ip === deviceIp) {
        instances.value = []
        allInstances.value = []
      }
      saveDevicesToLocalStorage()
      console.log(`[removeDiscoveredDevice] 已移除设备: ${deviceIp}`)
    }
  }

  // 注册全局按来源批量移除设备函数（供 OpenCecs 等模块清理所有注入的设备）
  window.removeDevicesBySource = (source) => {
    const toRemove = devices.value.filter(d => d.source === source)
    if (toRemove.length === 0) return
    for (const device of toRemove) {
      devicesStatusCache.value.delete(device.id)
      devicesLastUpdateTime.value.delete(device.id)
      deviceCloudMachinesCache.value.delete(device.ip)
      deviceAllInstancesCache.value.delete(device.ip)
      if (activeDevice.value && activeDevice.value.ip === device.ip) {
        instances.value = []
        allInstances.value = []
      }
    }
    devices.value = devices.value.filter(d => d.source !== source)
    saveDevicesToLocalStorage()
    console.log(`[removeDevicesBySource] 已移除 ${toRemove.length} 个 ${source} 设备`)
  }

  // 暴露 Go IPC 函数供 opencecsManagement 等外部组件调用
  window.goHttpRequest = HttpRequest
  window.goForceRefreshDeviceInfo = ForceRefreshDeviceInfo
  window.goGetDevicesStatus = GetDevicesStatus

  // 暴露设备列表给 opencecsManagement 退出登录时兜底查找
  window.getDevicesList = () => devices.value

  // 注册专用的 OpenCecs 设备全部清理函数（退出登录时调用，确保万无一失）
  window.removeAllOpenCecsDevicesFromHost = (extraIps = []) => {
    console.log('========== [App.vue] removeAllOpenCecsDevicesFromHost 被调用 ==========')
    console.log('[App.vue] 传入的 extraIps:', extraIps)
    const extraIpSet = new Set(extraIps)
    const before = devices.value.length
    console.log(`[App.vue] 当前设备总数: ${before}`)
    
    // 逐个设备检查匹配情况
    devices.value.forEach((d, i) => {
      const matchSource = d.source === 'opencecs'
      const matchName = d.name === 'opencecs'
      const matchIp = extraIpSet.has(d.ip)
      const matchPort = d.ip && d.ip.includes(':')
      const matched = matchSource || matchName || matchIp || matchPort
      console.log(`[App.vue] 设备[${i}]: ip=${d.ip}, name=${d.name}, source=${d.source}, id=${d.id} → ${matched ? '✅ 匹配删除' : '❌ 保留'}${matchSource ? ' (source)' : ''}${matchName ? ' (name)' : ''}${matchIp ? ' (IP)' : ''}${matchPort ? ' (IP:port格式)' : ''}`)
    })
    
    // 找出所有 OpenCecs 设备：按 source / name / IP列表 / IP:port格式 多重匹配
    const toRemove = devices.value.filter(d => {
      if (d.source === 'opencecs') return true
      if (d.name === 'opencecs') return true
      if (extraIpSet.has(d.ip)) return true
      // 兜底：OpenCecs 公网设备的 IP 格式为 publicIP:port（含冒号+端口号）
      // 正常局域网设备为纯 IP（如 10.10.11.46），不会含冒号
      if (d.ip && d.ip.includes(':')) return true
      return false
    })
    
    if (toRemove.length === 0) {
      console.log('[App.vue] devices.value 中无匹配设备')
      // 即使内存中没有，也要检查并清理 localStorage 中的残留
      try {
        const saved = localStorage.getItem('edgeclient_devices')
        if (saved) {
          const savedDevices = JSON.parse(saved)
          const cleaned = savedDevices.filter(d => {
            if (d.source === 'opencecs') return false
            if (d.name === 'opencecs') return false
            if (extraIpSet.has(d.ip)) return false
            if (d.ip && d.ip.includes(':')) return false
            return true
          })
          if (cleaned.length < savedDevices.length) {
            localStorage.setItem('edgeclient_devices', JSON.stringify(cleaned))
            // 同步到 devices.value
            devices.value = cleaned
            console.log(`[App.vue] ✅ 已从 localStorage 清理 ${savedDevices.length - cleaned.length} 个 opencecs 残留设备`)
            return savedDevices.length - cleaned.length
          }
        }
      } catch (e) {
        console.error('[App.vue] 清理 localStorage 残留失败:', e)
      }
      console.log('[App.vue] ⚠️ localStorage 中也无 opencecs 残留设备')
      return 0
    }
    
    // 清理缓存
    for (const device of toRemove) {
      devicesStatusCache.value.delete(device.id)
      devicesLastUpdateTime.value.delete(device.id)
      deviceCloudMachinesCache.value.delete(device.ip)
      deviceAllInstancesCache.value.delete(device.ip)
      if (activeDevice.value && activeDevice.value.ip === device.ip) {
        activeDevice.value = null
        instances.value = []
        allInstances.value = []
      }
    }
    
    // 从列表中移除
    const removeIps = new Set(toRemove.map(d => d.ip))
    const removeIds = new Set(toRemove.map(d => d.id))
    devices.value = devices.value.filter(d => !removeIps.has(d.ip) && !removeIds.has(d.id))
    
    saveDevicesToLocalStorage()
    console.log(`[App.vue] ✅ 已移除 ${toRemove.length} 个设备 (${before} → ${devices.value.length})，IP: ${toRemove.map(d => d.ip).join(', ')}`)
    return toRemove.length
  }
})

// 处理容器操作
// 云机右键菜单 / 容器操作分发（阶段 3 迁出到 composables/useContextMenu.js）
const {
  handleContainerAction,
  handleContextMenu,
  closeContextMenu,
  getCurrentContextMenuContainer,
} = useContextMenu({
  slotStates,
  t,
  activeDevice,
  cloudManageMode,
  devices,
  loading,
  authRetry,
  contextMenuPosition,
  instances,
  selectedCloudMachines,
  contextMenuSlot,
  contextMenuContainer,
  contextMenuVisible,
  contextMenuRef,
}, {
  // 以下在下方才创建 / 赋值，用惰性依赖避免 TDZ
  clearContainerScreenshotCache: (...a) => clearContainerScreenshotCache(...a),
  fetchAndroidContainers: (...a) => fetchAndroidContainers(...a),
  // 两个 let 定时器句柄在下方才被赋值，每次现读才能拿到真实句柄
  deviceHeartbeatTimer: () => deviceHeartbeatTimer,
  androidCacheTimer: () => androidCacheTimer,
})

// 云机右键菜单动作 + S5 代理 / 推流设置（阶段 3 迁出到 composables/useContainerActions.js）
const {
  handleUpdateImage,
  handleRestart,
  setS5Agent,
  parseAndFillSocks5Url,
  parseVpcInfo,
  handleS5ProxySubmit,
  closeS5Agent,
  handleDelete,
  getBackupCount,
  moveInstanceDialogVisible,
  moveInstanceForm,
  moveInstanceLoading,
  moveInstanceCurrentSlot,
  moveInstanceAvailableSlots,
  handleMoveInstance,
  submitMoveInstance,
  handleResetContainer,
  handleSetStream,
  selectStreamFolder,
  qrCodeUrl,
  appDownloadQrCodeUrl,
  qrCodeLoading,
  generateAppQRCode,
  confirmSetStream,
  cancelSetStream,
  handleShutdown,
} = useContainerActions({
  t,
  devices,
  activeDevice,
  allInstances,
  cloudManageMode,
  selectedCloudDevice,
  s5ProxyDialogVisible,
  s5ProxyForm,
  s5ProxyLoading,
  vpcProxyList,
  setStreamDialogVisible,
  streamType,
  streamFilePath,
  rtmpUrl,
  setStreamLoading,
  slotStates,
  authRetry,
  handleContainerAction,
  closeContextMenu,
  getCurrentContextMenuContainer,
  clearContainerScreenshotCache,
  fetchAndroidContainers,
  showUpdateImageDialog,
})

// MacVlanIP相关状态
const macVlanDialogVisible = ref(false)
const macVlanForm = ref({
  name: '', // 容器名称
  ip: ''    // MacVlanIP
})
const macVlanLoading = ref(false)

// 处理设置MacVlanIP
const handleSetMacVlanIP = () => {
  const container = getCurrentContextMenuContainer()
  if (!container) {
    ElMessage.warning('未找到选中的云机')
    return
  }
  
  // 初始化表单
  macVlanForm.value.name = container.name || container.ID || ''
  macVlanForm.value.ip = container.macVlanIP || '' 
  
  macVlanDialogVisible.value = true
  closeContextMenu()
}

// 提交MacVlanIP
const confirmSetMacVlanIP = async () => {
  if (!macVlanForm.value.ip) {
    ElMessage.warning('请输入MacVlanIP')
    return
  }
  
  // 简单的IP格式校验
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/
  if (!ipRegex.test(macVlanForm.value.ip)) {
    ElMessage.warning('请输入有效的IP地址')
    return
  }
  
  try {
    macVlanLoading.value = true
    
    // 确定目标设备
    let targetDevice = activeDevice.value
    if (cloudManageMode.value === 'batch' && !targetDevice) {
       // 批量模式下如果没有activeDevice，尝试从container获取deviceIp
       const container = getCurrentContextMenuContainer()
       if (container && container.deviceIp) {
         targetDevice = devices.value.find(d => d.ip === container.deviceIp) || { ip: container.deviceIp, version: 'v3' }
       }
    }
    
    if (!targetDevice) {
      ElMessage.error('无法确定目标设备')
      return
    }

    await authRetry(targetDevice, async (password) => {
      await setMacVlanIp(targetDevice, macVlanForm.value.name, macVlanForm.value.ip, password)
      ElMessage.success('设置MacVlanIP成功')
      macVlanDialogVisible.value = false
    })
    
  } catch (error) {
    if (error !== 'cancel') {
      console.error('设置MacVlanIP失败:', error)
      ElMessage.error(`设置MacVlanIP失败: ${error.message || '未知错误'}`)
    }
  } finally {
    macVlanLoading.value = false
  }
}

// 一键新机 (for androidType === 'V2')
const handleOneKeyNewDevice = async () => {
  const container = getCurrentContextMenuContainer()
  console.log('handleOneKeyNewDevice called with container:', container)
  
  if (!container) {
    ElMessage.warning('未找到容器信息')
    closeContextMenu()
    return
  }
  
  // 确定目标设备
  let targetDevice = activeDevice.value
  if (cloudManageMode.value === 'batch' && container && container.deviceIp) {
    targetDevice = devices.value.find(d => d.ip === container.deviceIp) || { ip: container.deviceIp, version: 'v3' }
  }
  
  try {
    const loadingMsg = ElMessage({
      message: '正在执行一键新机...',
      type: 'info',
      duration: 0
    })
    
    // 判断使用哪个IP和端口
    let host, port
    if (container.networkName === 'myt' || container.networkMode === 'myt' || container.network === 'myt') {
      // myt网络：使用容器IP + 9082端口
      host = container.ip
      port = 9082
    } else {
      // 非myt网络：使用端口映射
      host = targetDevice.ip
      // OpenCecs 公网设备：deviceIp 含端口，提取纯 IP
      if (host && host.includes(':')) host = host.split(':')[0]
      port = extractPort9082(container) || 9082
    }
    
    const modifyDevUrl = `http://${host}:${port}/modifydev?cmd=2`
    console.log('调用一键新机API:', modifyDevUrl)
    
    const result = await HttpRequest({
      url: modifyDevUrl,
      method: 'GET'
    })
    
    ElMessage.closeAll()
    
    if (result.success) {
      ElMessage.success('一键新机成功')
      // 刷新容器列表
      if (targetDevice) {
        await fetchAndroidContainers(targetDevice, true)
      }
    } else {
      ElMessage.error(`一键新机失败: ${result.status}`)
    }
  } catch (error) {
    ElMessage.closeAll()
    console.error('一键新机失败:', error)
    ElMessage.error(`一键新机失败: ${error.message || '未知错误'}`)
  } finally {
    closeContextMenu()
  }
}

const handleSwitchModel = async () => {
  const container = getCurrentContextMenuContainer()
  console.log('handleSwitchModel called with container:', container)
  
  // 确定目标设备
  let targetDevice = activeDevice.value
  if (cloudManageMode.value === 'batch' && container && container.deviceIp) {
    // 在批量模式下，根据 deviceIp 查找设备
    targetDevice = devices.value.find(d => d.ip === container.deviceIp) || { ip: container.deviceIp, version: 'v3' }
  }
  console.log('targetDevice:', targetDevice)
  
  if (container && targetDevice && targetDevice.version === 'v3') {
    try {
      // 显示加载状态提示
      const loadingMsg = ElMessage({
        message: '加载机型列表中...',
        type: 'info',
        duration: 0
      })
      
      // 先获取可用的手机型号列表
      console.log('Calling getV3PhoneModels with deviceIP:', targetDevice.ip)
      await getV3PhoneModels(targetDevice.ip)
      
      console.log('Phone models fetched:', phoneModels.value)
      
      // if (phoneModels.value.length === 0) {
      //   ElMessage.warning('未获取到可用的机型列表')
      //   closeContextMenu()
      //   return
      // }
      
      // 重置临时变量
      tempModelName.value = ''
      tempModelId.value = ''
      switchModelType.value = 'online' // 重置为默认线上机型
      switchCountryCode.value = 'CN'
      currentSwitchContainer.value = container
      
      // 打开机型切换对话框
      switchModelDialogVisible.value = true
      if (countryList.value.length === 0) getCountryList(targetDevice.ip)
    } catch (error) {
      if (error !== 'cancel') {
        console.error('切换机型失败:', error)
        ElMessage.error(`切换机型失败: ${error.message || '未知错误'}`)
      }
    } finally {
      // 关闭加载提示
      setTimeout(() => {
        ElMessage.closeAll()
      }, 100)
    }
  } else if (targetDevice && targetDevice.version !== 'v3') {
    ElMessage.warning('该设备版本不支持切换机型功能')
  } else {
    ElMessage.warning('请先选择设备')
  }
  closeContextMenu()
}


const confirmSwitchModel = async () => {
  if (!tempModelId.value) {
    ElMessage.warning('请选择机型')
    return
  }
  
  // 确定目标设备
  let targetDevice = activeDevice.value
  if (cloudManageMode.value === 'batch' && currentSwitchContainer.value && currentSwitchContainer.value.deviceIp) {
    targetDevice = devices.value.find(d => d.ip === currentSwitchContainer.value.deviceIp) || { ip: currentSwitchContainer.value.deviceIp, version: 'v3' }
  }
  
  if (currentSwitchContainer.value && targetDevice) {
    try {
      // 开始切换，设置加载状态
      switchingModel.value = true
      
      let finalModelId = tempModelId.value
      
      // 处理随机机型
      if (finalModelId === 'random') {
        let list = []
        switch (switchModelType.value) {
          case 'online': 
            list = phoneModels.value; 
            if (currentSwitchContainer.value && currentSwitchContainer.value.image) {
              const currentImageUrl = currentSwitchContainer.value.image
              const currentImage = imageList.value.find(img => img.url === currentImageUrl)
              if (currentImage && currentImage.os_ver) {
                const verMatch = currentImage.os_ver.match(/and(\d+)/i)
                if (verMatch && verMatch[1]) {
                  const targetVer = verMatch[1]
                  const filteredList = list.filter(m => {
                    if (!m.android_version) return true // 无该字段时不过滤
                    return String(m.android_version) === String(targetVer)
                  })
                  if (filteredList.length > 0) {
                    list = filteredList
                  }
                }
              }
            }
            break;
          case 'local': list = localPhoneModels.value; break;
          case 'backup': list = backupPhoneModels.value; break;
        }
        
        if (!list || list.length === 0) {
          ElMessage.warning('当前列表为空，无法随机选择')
          switchingModel.value = false
          return
        }
        
        const randomModel = list[Math.floor(Math.random() * list.length)]
        
        // 根据不同类型获取对应的值
        if (switchModelType.value === 'online') {
          finalModelId = randomModel.id
        } else {
          // 本地和备份机型使用name
          finalModelId = randomModel.name
        }
        
        console.log(`随机选择了机型: ${randomModel.name} (${finalModelId})`)
      }
      
      // 调用切换机型API
      const result = await switchPhoneModel(
        targetDevice, 
        currentSwitchContainer.value.name, 
        {
          value: finalModelId,
          type: switchModelType.value,
          countryCode: switchCountryCode.value
        }
      )
      
      if (result.code === 0) {
        ElMessage.success('机型切换成功')
        // 刷新容器列表
        await fetchAndroidContainers(targetDevice, true)
      } else {
        ElMessage.error(`机型切换失败: ${result.message || '未知错误'}`)
      }
    } catch (error) {
      console.error('切换机型失败:', error)
      ElMessage.error(`切换机型失败: ${error.message || '未知错误'}`)
    } finally {
      // 关闭对话框
      switchModelDialogVisible.value = false
      tempModelName.value = ''
      tempModelId.value = ''
      currentSwitchContainer.value = null
      switchingModel.value = false
    }
  }
}

const cancelSwitchModel = () => {
  // 关闭对话框并重置变量
  switchModelDialogVisible.value = false
  tempModelName.value = ''
  tempModelId.value = ''
  currentSwitchContainer.value = null
}


const handleSwitchBackup = () => {
  showBackupList(contextMenuSlot.value)
  closeContextMenu()
}



// 处理文件上传
const handleFileManager = () => {
  const container = contextMenuContainer.value
  if (!container) {
    ElMessage.warning('请先选择云机')
    closeContextMenu()
    return
  }
  fileManagerContainer.value = container
  fileManagerDeviceIp.value = container.deviceIp || activeDevice.value?.ip
  if (!fileManagerDeviceIp.value) {
    ElMessage.warning('无法确定设备IP')
    closeContextMenu()
    return
  }
  closeContextMenu()
  fileManagerVisible.value = true
  androidCurrentPath.value = '/'
  localCurrentPath.value = ''
  fetchAndroidFiles('/')
  fetchLocalFiles('')
}

// 文件管理 / 共享目录 / 上传下载（阶段 3 迁出到 composables/useFileManager.js）
const {
  fileManagerVisible,
  fileManagerContainer,
  fileManagerDeviceIp,
  androidCurrentPath,
  androidFileList,
  androidFileLoading,
  localCurrentPath,
  localFileList,
  localFileLoading,
  getDeviceAddrForFiles,
  fetchAndroidFiles,
  fetchLocalFiles,
  androidNavigate,
  androidGoUp,
  localSelectDirectory,
  localNavigate,
  localGoUp,
  downloadCloudFileDialogVisible,
  downloadCloudFileLoading,
  downloadFileInfo,
  downloadCloudFile,
  submitDownloadCloudFile,
  handleFileUpload,
  handleApkUpload,
  sortFileTreeNode,
  changeFileSort,
  loadSharedFiles,
  handleUploadRefresh,
  processFileTree,
  getDirectorySelectionState,
  handleNodeSelectionChange,
  isSharedDirectoryFullySelected,
  isSharedDirectoryPartiallySelected,
  handleSharedNodeSelectionChange,
  handleSharedFileCheckChange,
  handleUploadToCloudMachine,
  openSharedDirectory,
  handleBatchUpload,
  handleFileSelect,
} = useFileManager({
  activeDevice,
  cloudMachines,
  contextMenuContainer,
  contextMenuContainerId,
  contextMenuSlot,
  closeContextMenu,
  fileSortType,
  fileSortOrder,
  sharedFileTree,
  filesLoading,
  loadSingleUploadSharedDirPath,
  sharedFiles,
  sharedRootPath,
  selectedFiles,
  sharedFilesDialogVisible,
  uploadLoading,
  autoGrantApkPermission,
  cloudManageMode,
  selectedCloudDevice,
  batchUploadDialogVisible,
}, {
  // 任务队列在下方才创建，用惰性依赖避免 TDZ
  addTaskToQueue: () => addTaskToQueue(),
  executeTask: () => executeTask(),
})


// 组件销毁时清理资源
onBeforeUnmount(() => {
  // 清除定时器
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
  
  // 清除每半小时刷新定时器
  if (hourlyRefreshInterval) {
    clearInterval(hourlyRefreshInterval)
    hourlyRefreshInterval = null
  }
  
  // 清除版本信息刷新定时器
  if (versionRefreshInterval) {
    clearInterval(versionRefreshInterval)
    versionRefreshInterval = null
  }
  
  // 清除同步授权定时器
  if (syncAuthTimer.value) {
    clearInterval(syncAuthTimer.value)
    syncAuthTimer.value = null
  }
  
  // 停止截图刷新并释放资源
  stopScreenshotRefresh()
  
  // 清除批量添加防抖定时器
  if (batchAddTimeout.value) {
    clearTimeout(batchAddTimeout.value)
    batchAddTimeout.value = null
  }
  
  // 清除分组初始化防抖定时器
  if (initGroupsTimeout.value) {
    clearTimeout(initGroupsTimeout.value)
    initGroupsTimeout.value = null
  }
  
  // 清除版本检查防抖定时器
  cancelAutoGetAllDeviceVersions()
  
  // 使用Wails的事件API移除下载进度事件监听器
  Events.Off('download-progress')
  // 使用Wails的事件API移除上传进度事件监听器
  Events.Off('upload-progress')
  // 注意：EventsOnce 监听的事件不需要手动移除，它们只触发一次
})

// 半小时逐个设备刷新云机列表
const refreshDevicesContainersOneByOne = async () => {
  console.log('开始逐个设备刷新云机列表')
  
  // 如果没有设备，直接返回
  if (devices.value.length === 0) {
    console.log('没有设备需要刷新')
    return
  }
  
  // 计算下一个要刷新的设备索引
  const device = devices.value[nextDeviceIndex]
  nextDeviceIndex = (nextDeviceIndex + 1) % devices.value.length
  
  console.log(`正在刷新设备 ${device.ip} 的云机列表`)
  try {
    // 使用fetchAndroidContainers函数刷新设备云机列表，isUserInitiated=false表示后台加载
    await fetchAndroidContainers(device, false)
    // 更新云机分组数据
    initCloudMachineGroups()
    console.log(`设备 ${device.ip} 云机列表刷新成功`)
  } catch (error) {
    console.error(`设备 ${device.ip} 云机列表刷新失败:`, error)
  }
}

// 批量加载云机列表，每10个设备一批，超时10秒
const batchLoadCloudMachines = async () => {
  console.log('开始批量加载云机列表')
  
  if (devices.value.length === 0) {
    console.log('没有设备需要加载')
    return
  }
  
  // 计算批次
  const BATCH_SIZE = 10;
  const totalDevices = devices.value.length;
  const totalBatches = Math.ceil(totalDevices / BATCH_SIZE);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    // 计算当前批次的设备范围
    const startIndex = batchIndex * BATCH_SIZE;
    const endIndex = Math.min(startIndex + BATCH_SIZE, totalDevices);
    const batchDevices = devices.value.slice(startIndex, endIndex);
    
    console.log(`正在加载第 ${batchIndex + 1}/${totalBatches} 批设备云机列表，共 ${batchDevices.length} 个设备`)
    
    // 并行加载当前批次的设备云机列表
    const loadPromises = batchDevices.map(device => 
      // 使用fetchAndroidContainers函数，isUserInitiated=false表示后台加载
      fetchAndroidContainers(device, false).catch(error => {
        console.error(`设备 ${device.ip} 云机列表加载失败:`, error)
        return null
      })
    );
    
    // 等待当前批次加载完成或超时
    try {
      await Promise.all(loadPromises);
    } catch (error) {
      console.error(`第 ${batchIndex + 1} 批设备云机列表加载失败:`, error)
    }
    
    // 更新云机分组数据
    initCloudMachineGroups();
  }
  
  console.log('所有批次设备云机列表加载完成')
}

// 计算属性
const slotGroups = computed(() => {
  const groups = {}
  for (let i = 1; i <= 12; i++) {
    groups[i] = instances.value.filter(inst => inst.indexNum === i)
  }
  return groups
})

const runningCloudMachines = computed(() => {
  return cloudMachines.value.filter(m => m.status === 'running')
})



const groupedInstances = computed(() => {
  let result = []
  const slotCountMap = new Map()
  
  let maxSlots = 12
  if (selectedCloudDevice.value && selectedCloudDevice.value.id && selectedCloudDevice.value.id.toLowerCase().startsWith('p')) {
    maxSlots = 24
  }
  
  for (let slotNum = 1; slotNum <= maxSlots; slotNum++) {
    const slotInstances = instances.value.filter(inst => inst.indexNum === slotNum)
    if (slotInstances.length > 0) {
      slotInstances.forEach((inst, index) => {
        result.push({
          slotNum,
          isFirstInSlot: index === 0,
          instanceCount: slotInstances.length,
          ...inst
        })
      })
      slotCountMap.set(slotNum, slotInstances.length)
    } else {
      result.push({
        slotNum,
        isFirstInSlot: true,
        instanceCount: 1,
        name: '',
        ip: '',
        image: '',
        createTime: '',
        status: 'shutdown',
        modelName: ''
      })
      slotCountMap.set(slotNum, 1)
    }
  }

  return result
  
})

const deviceDetailCloudMachines = ref([])
const deviceDetailCloudMachinesLoading = ref(false)
const deviceDetailSearchKeyword = ref('')

const fetchDeviceDetailCloudMachines = async () => {
  if (!activeDevice.value || !activeDevice.value.ip) return
  
  try {
    deviceDetailCloudMachinesLoading.value = true
    const data = await getDeviceAllCloudMachines(activeDevice.value.ip, '', true)
    console.log('fetchDeviceDetailCloudMachines', data)
    if (data && data.code == 0) {
      deviceDetailCloudMachines.value = data.data.list || []
    } else if (Array.isArray(data)) {
      deviceDetailCloudMachines.value = data
    } else {
      deviceDetailCloudMachines.value = []
    }
    
    console.log('设备详情云机数据获取成功:', deviceDetailCloudMachines.value)
  } catch (error) {
    console.error('获取设备详情云机数据失败:', error)
    deviceDetailCloudMachines.value = []
  } finally {
    deviceDetailCloudMachinesLoading.value = false
  }
}

// 设备操作 / 云机列表加载（阶段 3 迁出到 composables/useDeviceOperations.js）
const {
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
} = useDeviceOperations({
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
  heartbeatInitialized,
  showAuthDialog,
  createForm,
  contextMenuContainer,
  getCurrentContextMenuContainer,
  cloudManageMode,
  apiDetailsData,
  contextMenuSlot,
  apiDetailsVisible,
  contextMenuVisible,
}, {
  // 以下三个在下方才创建，用惰性依赖避免 TDZ
  autoGetAllDeviceVersions: (...a) => autoGetAllDeviceVersions(...a),
  updateHeartbeatDevices: (...a) => updateHeartbeatDevices(...a),
  fetchAndroidContainers: (...a) => fetchAndroidContainers(...a),
})

// 清空指定容器的截图缓存，用于重启/重置操作
const clearContainerScreenshotCache = (device, container) => {
  if (!device || !container) return;
  
  const cacheKey = `${device.ip}_${container.name}`
  screenshotDataCache.value.delete(cacheKey)
  // 替换新 Map 对象触发响应式更新
  screenshotDataCache.value = new Map(screenshotDataCache.value)
  // 通知后端清空，下次后端轮询会重新抓图
  clearScreenshotCache(device.ip, container.name || '').catch(() => {})

  // console.log(`已清空容器 ${container.name} 的截图缓存并触发重新加载`);
};



// 更新云机列表
const updateCloudMachines = () => {
  if (cloudManageMode.value === 'batch') {
    // 批量模式：从deviceCloudMachinesCache获取所有选中设备的云机数据
    const selectedDeviceIps = new Set(selectedCloudMachines.value.map(machine => machine.deviceIp));
    let allCloudMachines = [];
    
    // 遍历所有选中的设备IP
    selectedDeviceIps.forEach(deviceIp => {
      // 从缓存中获取该设备的所有云机数据
      const deviceCloudMachines = deviceCloudMachinesCache.value.get(deviceIp) || [];
      // 筛选出被选中的云机
      const selectedCloudMachinesForDevice = deviceCloudMachines.filter(machine => {
        return selectedCloudMachines.value.some(selectedMachine => selectedMachine.id === machine.id);
      });
      // 将选中的云机添加到总列表中
    allCloudMachines = [...allCloudMachines, ...selectedCloudMachinesForDevice];
  });
  
  // 对云机按照从ID中提取的坑位号进行排序
  allCloudMachines.sort((a, b) => {
    // 从ID中提取坑位号，例如从"8569541a74175bfe052739c4321ea31b_2_T0002"中提取"2"
    const aParts = a.id.split('_');
    const bParts = b.id.split('_');
    
    // 获取坑位号（第二个元素）并转换为数字
    const aSlot = aParts.length >= 2 ? parseInt(aParts[1]) : 0;
    const bSlot = bParts.length >= 2 ? parseInt(bParts[1]) : 0;
    
    return aSlot - bSlot;
  });
  
  cloudMachines.value = allCloudMachines;
  } else {
    // 坑位模式：从instances.value获取云机数据
    // 先保存当前的云机列表，用于保留截图状态
    const currentCloudMachines = [...cloudMachines.value];
    
    cloudMachines.value = instances.value.map(inst => {
      const screenshotUrl = getCloudMachineScreenshotUrl(activeDevice.value, inst);
      const newMachine = {
        id: inst.name,
        name: inst.name,
        status: inst.status,
        screenshot: screenshotUrl,
        screenshotData: null, // 存储截图URL
        screenshotError: false, // 存储截图加载状态
        hasLoadedOnce: false, // 标记是否已成功加载过至少一次
        ip: inst.ip,
        modelName: inst.modelName,
        deviceIp: inst.deviceIp, // 添加设备IP属性，确保截图URL生成时能获取到设备IP
        indexNum: inst.indexNum, // 添加坑位编号属性，确保截图URL生成时能获取到坑位编号
      };
      
      // 合并状态
      return mergeCloudMachineState(currentCloudMachines, newMachine);
    });
  }
  
  // 云机列表更新后，重新初始化云机分组数据
  initCloudMachineGroups();
}

// ========== 安卓容器截图缓存（后端轮询驱动）=========
// 阶段 3 迁出到 composables/useScreenshotCache.js
const {
  screenshotDataCache,
  fetchScreenshotCacheIfUpdated,
  startScreenshotRefresh,
  stopScreenshotRefresh,
  getContainerScreenshotData,
  resetScreenshotVersions,
} = useScreenshotCache({
  cloudManageMode,
  selectedCloudDevice,
  selectedCloudMachines,
})



// 将ArrayBuffer转换为base64


// 获取容器列表


// 树形结构勾选事件处理
// 加载选中云机的截图
const handleTreeCheck = (data, checkedInfo) => {
  // 处理来自CloudManagement.vue的事件数据：{selectedMachines, selectedDevices, treeSelectedKeys}
  let selectedMachines = []
  let selectedDevices = []
  let treeSelectedKeysValue = []
  
  if (data && data.selectedMachines && data.selectedDevices && data.treeSelectedKeys) {
    // 来自CloudManagement.vue的参数格式
    selectedMachines = data.selectedMachines
    selectedDevices = data.selectedDevices
    treeSelectedKeysValue = data.treeSelectedKeys
  } else {
    // 来自el-tree组件的原始参数格式（兼容旧代码）
    return
  }
  
  // 更新选中的节点ID数组
  treeSelectedKeys.value = treeSelectedKeysValue
  
  // 更新选中的云机列表，确保每次都重新赋值
  selectedCloudMachines.value = [...selectedMachines]
}

// 任务队列核心逻辑

// 生成唯一任务ID






// 添加任务到队列
// 任务队列：入队 / 执行 / 取消 / 重试 / 清理（阶段 3 迁出到 composables/useTaskQueue.js）
const {
  addTaskToQueue,
  handleStartCopyTask,
  executeTask,
  cancelTask,
  retryFailedTask,
  handleClearTasks,
} = useTaskQueue({
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
})

// 显示更新提示弹窗
const handleShowUpdateDialog = (info) => {
  updateInfo.value = info
  updateDialogVisible.value = true
}

// 批量切换机型确认函数
// 批量切换机型确认 / 取消 + 机型槽（阶段 3 迁出到 composables/useBatchSwitchModel.js）
const {
  confirmBatchSwitchModel,
  handleBatchSwitchModelCancel,
  filteredPhoneModelsForBatch,
  addNewModelSlot,
  removeModelSlot,
  handleSlotDragStart,
  handleSlotDropInModelSlot,
  handleSlotDropInAvailableArea,
  initModelSlots,
  executeTaskQueue,
  batchSwitchModelDialogVisible,
  batchSwitchingModel,
  selectedBatchModelName,
  selectedBatchModelId,
  batchSwitchModelTargets,
  batchSwitchModelOperationType,
  batchSwitchCountryCode,
  modelSlots,
  draggingSlot,
  isModelSlotsValid,
} = useBatchSwitchModel({
  phoneModels,
  addTaskToQueue,
  executeTask,
  taskQueue,
  localPhoneModels,
  backupPhoneModels,
  fetchBackupModels,
  imageList,
  getV3PhoneModels,
  getLocalPhoneModels,
})

// 批量操作处理


// 从设备名称中提取设备型号




// 格式化实例机型名称


// 获取镜像显示名称 - 优化版
// 镜像显示名 / 设备版本信息查询（阶段 3 迁出到 composables/useDeviceVersionInfo.js）
const {
  getImageDisplayName,
  handleGetDeviceVersion,
} = useDeviceVersionInfo({
  imageList,
  loading,
  fetchV3LatestInfo,
  deviceVersionInfo,
}, {
  // 以下依赖来自下方才调用的 useVersionCheckQueue，用惰性依赖避免 TDZ
  getLastCheckTime: () => lastCheckTime,
  getMinCheckInterval: () => MIN_CHECK_INTERVAL,
  addToVersionCheckQueue: (...a) => addToVersionCheckQueue(...a),
  batchProcessVersionCheckQueue: (...a) => batchProcessVersionCheckQueue(...a),
})

// 升级设备


// 清理客户端数据功能


// ===== 设备检查队列（阶段 3 迁出到 composables/）=====
// 设备绑定状态查询队列
const {
  deviceBindCheckQueue,
  isProcessingBindQueue,
  deviceBindCheckInterval,
  lastBindCheckTime,
  MAX_CONCURRENT_BIND_CHECKS,
  BIND_CHECK_INTERVAL,
  MIN_BIND_CHECK_INTERVAL,
  addToBindCheckQueue,
  processBindCheckQueue,
  batchProcessBindCheckQueue,
  initBindCheckQueue,
} = useBindCheckQueue({
  fetchDeviceBindStatus,
})

// API版本检查队列 + 自动获取所有设备版本信息
const {
  versionCheckQueue,
  priorityQueue,
  isProcessingQueue,
  versionCheckInterval,
  lastCheckTime,
  lastQueueProbeVersion,
  MAX_CONCURRENT_CHECKS,
  CHECK_INTERVAL,
  MIN_CHECK_INTERVAL,
  addToVersionCheckQueue,
  processVersionCheckQueue,
  batchProcessVersionCheckQueue,
  initVersionCheckQueue,
  autoGetAllDeviceVersions,
  cancelAutoGetAllDeviceVersions,
} = useVersionCheckQueue({
  devices,
  token,
  deviceVersionInfo,
  devicesStatusCache,
  devicesLastUpdateTime,
  fetchV3DeviceInfo,
  addToBindCheckQueue,
})

// 启动批量升级

// 发现并加载设备

// 后台10个一批加载云机列表

// 发现并加载设备
const discoverAndLoadDevices = async () => {
  loading.value = true
  try {
    // 记录开始发现设备的时间
    const discoveryTime = Date.now()

    // 发现设备
    const discoveredDevices = await discoverDevices()

    // 以设备ID为比对，同步更新现有设备的属性变更（IP变更、版本升级等）
    const discoveredDevicesMap = new Map(discoveredDevices.map(device => [device.id, device]))

    // 同步已发现设备的属性到 devices.value（仅更新属性，不改状态，不与心跳冲突）
    let propsChanged = false
    devices.value.forEach(device => {
      const discovered = discoveredDevicesMap.get(device.id)
      if (discovered) {
        // 同ID：正常属性更新
        if (device.version !== discovered.version) {
          console.log(`[发现设备] 设备 ${device.ip} 版本变更: ${device.version} → ${discovered.version}`)
          device.version = discovered.version
          propsChanged = true
        }
        if (device.ip !== discovered.ip) {
          console.log(`[发现设备] 设备ID ${device.id} IP变更: ${device.ip} → ${discovered.ip}`)
          device.ip = discovered.ip
          propsChanged = true
        }
        if (device.name !== discovered.name) {
          device.name = discovered.name
          propsChanged = true
        }
      }
      // 同IP不同ID：不合并，视为不同设备
    })

    if (propsChanged) {
      saveDevicesToLocalStorage()
      if (heartbeatInitialized) updateHeartbeatDevices()
    }

    // 不自动设置默认设备和获取容器列表，保持selectedCloudDevice为空，显示12个空坑位
    activeDevice.value = null
    selectedCloudDevice.value = null
    instances.value = []
    updateCloudMachines()

    // 设备列表更新后，重新初始化云机分组
    initCloudMachineGroups()

    // 3. 加载完成后，检查哪些设备没有被更新
    // 注意：这里不再简单地将未更新的设备标记为离线，
    // 而是保留它们的状态，因为有些设备可能能访问Docker API但在本次加载中失败
    const updatedDeviceIds = new Set()
    devicesLastUpdateTime.value.forEach((time, deviceId) => {
      if (time >= discoveryTime) {
        updatedDeviceIds.add(deviceId)
      }
    })

    // 4. 对于本次发现且成功加载的设备，确保标记为在线
    // 对于本次发现但未成功加载的设备，保持原有状态，不自动标记为离线
    // 这样可以避免能访问Docker API的设备被误判为离线
  } catch (error) {
    console.error('发现设备失败:', error)
    // 失败时保持设备列表不变
  } finally {
    loading.value = false
  }

  // 云机列表加载由 initDeviceHeartbeat 首次完成状态更新后触发，确保只请求在线设备

  // 获取设备绑定状态
  if(token.value) {
    fetchDeviceBindStatus()
  }
}


// 刷新当前列表 - 手动触发API版本检查和存储查询
const refchDevices = async () => {
  loading.value = true
  
  try {
    // console.log('[手动刷新] 开始手动刷新设备API版本和存储信息')
    
    // 获取所有在线设备
    const onlineDevices = devices.value.filter(device => {
      return devicesStatusCache.value.get(device.id) === 'online'
    })

    // 离线的 V3 设备走前端版本队列现场探一次 /info：老 SDK/被手动降级的设备
    // 只是事件通道口径下"离线"（/ws/events 404），HTTP 还活着，能探到降级后
    // 的真实版本——Go 侧 ForceRefreshDeviceInfo 带"在线才查"闸门，对这类设备
    // 不生效。真死机的设备 1s 超时探不通，失败不清旧值
    const offlineV3Devices = devices.value.filter(device => {
      return device.version === 'v3' && devicesStatusCache.value.get(device.id) === 'offline'
    })
    for (const device of offlineV3Devices) {
      addToVersionCheckQueue(device)
    }
    if (offlineV3Devices.length > 0) {
      batchProcessVersionCheckQueue()
    }

    if (onlineDevices.length === 0) {
      if (offlineV3Devices.length > 0) {
        ElMessage.success(`没有在线设备，已刷新 ${offlineV3Devices.length} 个离线设备的API版本`)
      } else {
        ElMessage.warning('没有在线设备可以刷新')
      }
      loading.value = false
      return
    }
    
    console.log(`[手动刷新] 找到 ${onlineDevices.length} 个在线设备`)
    
    // 🔧 调用后端强制刷新API版本和存储信息(不管在线离线)
    const deviceIPs = onlineDevices.map(device => device.ip)
    
    // 调用后端接口强制刷新
    await ForceRefreshDeviceInfo(deviceIPs)

    // 提示里带上离线设备的重探数，不然离线列值没变化时（比如设备报的版本
    // 和列表显示的一样）没法分辨"没探"还是"探了但值没变"
    if (offlineV3Devices.length > 0) {
      ElMessage.success(`已触发 ${onlineDevices.length} 个在线设备的API版本和存储信息刷新，正在重探 ${offlineV3Devices.length} 个离线设备的API版本`)
    } else {
      ElMessage.success(`已触发 ${onlineDevices.length} 个在线设备的API版本和存储信息刷新`)
    }
    
    // console.log('[手动刷新] ✅ 刷新请求已发送到后端,预计1-2秒内完成')
    
  } catch (error) {
    console.error('[手动刷新] 刷新失败:', error)
    ElMessage.error(`刷新失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

// 切换镜像分类
const switchImageCategory = async (category) => {
  selectedImageCategory.value = category
  console.log('切换镜像分类:', category)
  
  if (category === 'local') {
    await fetchLocalCachedImages()
    
    // 如果是V3设备，确保已经获取了型号列表
    if (activeDevice.value && activeDevice.value.version === 'v3') {
      await getV3PhoneModels(activeDevice.value.ip)
    }
  } else if (category === 'online') {
    // 在线镜像分类，确保已经获取了在线镜像列表
    if (activeDevice.value) {
      const deviceType = activeDevice.value.name || 'C1'
      await fetchImageList(deviceType)
    } else {
      await fetchImageList('')
    }
    
    // 确保categorizeOnlineImages已经执行完毕，onlineImagesByModel有数据
    await nextTick()
    
    // 如果categorizeOnlineImages没有自动选中，这里作为兜底逻辑
    if (!currentOnlineImageModel.value && onlineImagesByModel.value.size > 0) {
      if (onlineImagesByModel.value.has('Q1')) {
        currentOnlineImageModel.value = 'Q1'
        console.log('[兜底] 默认选中在线镜像型号: Q1')
      } else {
        const firstModel = Array.from(onlineImagesByModel.value.keys())[0]
        currentOnlineImageModel.value = firstModel
        console.log('[兜底] 默认选中第一个在线镜像型号:', firstModel)
      }
    }
  } else if (category === 'device') {
     console.log('切换到设备镜像分类')
     // 如果没有选中的设备，且设备列表不为空，默认选中第一个
     if (!selectedDeviceForImages.value && devices.value.length > 0) {
         handleDeviceSelectForImages(devices.value[0])
     }
  }
}

// 关闭设备详情弹窗
const collapseRightSidebar = () => {
  console.log('关闭设备详情弹窗');
  deviceDetailsDialogVisible.value = false;
  // 退出查看详情模式，显示勾选框
  isViewingDeviceDetails.value = false;
  // 清空搜索关键词
  deviceDetailSearchKeyword.value = '';

  // 🔧 已移除定时器，无需清理

}



// ========== 设备心跳检测服务 ==========

// 初始化设备心跳检测
const initDeviceHeartbeat = async () => {
  console.log('[心跳] initDeviceHeartbeat 被调用, heartbeatInitialized=', heartbeatInitialized)
  // 防止重复初始化
  if (heartbeatInitialized) {
    console.log('[心跳] ⚠️ 心跳检测已初始化，忽略重复调用')
    return
  }
  
  heartbeatInitialized = true
  
  try {
    console.log('[心跳] ========== 开始初始化设备心跳检测服务 ==========');
    console.log('[心跳] 当前设备列表:', devices.value);
    
    // 🔥 应用启动时强制重置所有设备为离线状态
    console.log('[心跳] 正在重置所有设备为离线状态...');
    await ResetAllDevicesOffline();
    console.log('[心跳] ✓ 已重置所有设备为离线状态');
    
    // 收集所有设备IP（去重，避免同IP多设备重复发送）
    const deviceIPs = [...new Set(devices.value.map(device => device.ip))];
    
    if (deviceIPs.length === 0) {
      console.warn('[心跳] ⚠️ 当前设备列表为空，但仍启动心跳服务（设备添加后会自动监控）');
    }
    
    console.log('[心跳] ✓ 准备监控的设备IP列表:', deviceIPs);
    
    // 检查函数是否存在
    if (typeof updateMonitoredDevices !== 'function') {
      console.error('[心跳] ❌ updateMonitoredDevices 函数不存在！');
      return;
    }
    if (typeof startDeviceHeartbeat !== 'function') {
      console.error('[心跳] ❌ startDeviceHeartbeat 函数不存在！');
      return;
    }
    if (typeof getDevicesStatus !== 'function') {
      console.error('[心跳] ❌ getDevicesStatus 函数不存在！');
      return;
    }
    
    console.log('[心跳] ✓ 所有必需函数都存在');
    
    // 获取设备密码映射
    let devicePasswords = {};
    try {
      const storedPasswords = localStorage.getItem('devicePasswords');
      if (storedPasswords) {
        devicePasswords = JSON.parse(storedPasswords);
        console.log('[心跳] ✓ 已加载设备密码映射:', Object.keys(devicePasswords).length, '个设备');
      }
    } catch (error) {
      console.warn('[心跳] ⚠️ 加载设备密码失败:', error);
    }
    
    // 更新后端设备密码映射
    if (typeof UpdateDevicePasswords === 'function') {
      console.log('[心跳] 正在调用 UpdateDevicePasswords...');
      await UpdateDevicePasswords(devicePasswords);
      console.log('[心跳] ✓ 已更新后端设备密码映射');
    } else {
      console.warn('[心跳] ⚠️ UpdateDevicePasswords 函数不存在，跳过密码更新');
    }
    
    // 更新后端监控设备列表（携带名称映射）
    const deviceNamesMap = {}
    devices.value.forEach(d => { deviceNamesMap[d.ip] = d.name || d.ip })
    console.log('[心跳] 正在调用 updateMonitoredDevices...');
    await updateMonitoredDevices(deviceIPs, deviceNamesMap);
    console.log('[心跳] ✓ 已更新后端监控设备列表');
    
    // 启动后端心跳检测服务
    console.log('[心跳] 正在调用 startDeviceHeartbeat...');
    await startDeviceHeartbeat();
    console.log('[心跳] ✓ 已启动后端心跳检测服务');
    
    // 🔧 启动前端状态轮询（每1秒查询一次，实时更新设备信息）
    deviceHeartbeatTimer = setInterval(async () => {
      // console.log('[心跳] ⏰ 定时器触发，开始轮询设备状态...');
      await fetchDevicesStatusFromBackend();
    }, 1000); // 1秒，实时响应设备状态变化
    
    console.log('[心跳] ✓ 前端轮询定时器已启动');

    // 🚀 启动安卓容器列表缓存轮询（每2秒查询版本号，有变化才拉完整数据）
    androidCacheTimer = setInterval(fetchAndroidCacheIfUpdated, 2000)
    // console.log('[安卓轮询] ✓ 前端安卓缓存轮询定时器已启动（间隔2秒）');
    
    // 立即执行一次状态更新，拿到真实在线/离线状态后再加载云机列表
    // console.log('[心跳] 立即执行第一次状态查询...');
    await fetchDevicesStatusFromBackend();

    // 首次心跳完成后，devicesStatusCache 已是真实状态，安全地加载在线设备云机列表
    loadContainersInBatches()
    
    // console.log('[心跳] ========== ✅ 设备心跳检测服务启动成功！ ==========');
    // console.log('[心跳] 监控设备数:', deviceIPs.length);
    // console.log('[心跳] 后端检测间隔: 4秒');
    // console.log('[心跳] 前端轮询间隔: 1秒');
    // console.log('[心跳] 超时时间: 2秒');
  } catch (error) {
    console.error('[心跳] ❌ 初始化设备心跳检测失败:');
    console.error('[心跳] 错误详情:', error);
    console.error('[心跳] 错误堆栈:', error.stack);
  }
}

// ========== 安卓容器列表缓存轮询 ==========
// 每2秒调用，先比较版本号，有变化才拉完整数据，避免无效传输
const fetchAndroidCacheIfUpdated = async () => {
  try {
    const versions = await getAndroidCacheVersions()
    if (!versions || Object.keys(versions).length === 0) return

    const changedIps = []
    for (const [ip, version] of Object.entries(versions)) {
      if (version !== androidCacheVersions.value[ip]) {
        changedIps.push(ip)
      }
    }

    if (changedIps.length === 0) return

    // 拉取有变化的设备完整数据
    const cacheData = await getAndroidContainersList(changedIps)
    if (!cacheData) return

    for (const [ip, cacheEntry] of Object.entries(cacheData)) {
      // 更新本地版本号快照
      androidCacheVersions.value[ip] = versions[ip]

      // 找到对应设备
      const device = devices.value.find(d => d.ip === ip)
      if (!device) continue

      // 离线或错误状态：清空该设备缓存
      if (cacheEntry.status === 'offline') {
        deviceCloudMachinesCache.value.set(ip, [])
        deviceAllInstancesCache.value.set(ip, [])
        if (activeDevice.value && activeDevice.value.ip === ip) {
          instances.value = []
          allInstances.value = []
          updateCloudMachines()
        }
        continue
      }

      // 无数据或错误：保留当前缓存不清空
      if (cacheEntry.status === 'error' && !cacheEntry.list) continue
      // 认证失败：弹窗让用户输入密码，输入后更新后端密码并触发重新轮询
      if (cacheEntry.status === 'auth_fail') {
        // 用户已取消认证的设备不再弹窗
        if (authCancelledDevices.value.has(ip)) continue
        // 仅在该设备尚未弹出认证对话框时触发
        const alreadyAuthing = batchAuthDevices.value.some(item => item.device.ip === ip)
        if (!alreadyAuthing) {
          showAuthDialog(device, async (password) => {
            await saveDevicePassword(device.ip, password)
            triggerAndroidRefresh([ip]).catch(() => {})
          })
        }
        continue
      }

      // 有数据：解析并更新 deviceCloudMachinesCache（复用 _parseV3RawContainers）
      const raw = cacheEntry.list
      if (!raw) continue

      // 兼容后端返回的完整响应结构 {code, data:{list:[...]}}
      let rawContainers = []
      if (raw.data && raw.data.list) {
        rawContainers = raw.data.list
      } else if (raw.list) {
        rawContainers = raw.list
      }

      if (!Array.isArray(rawContainers)) continue

      _parseV3RawContainers(device, rawContainers)
    }
  } catch (e) {
    // 静默失败，不影响其他功能
    console.warn('[安卓轮询] 缓存更新异常:', e)
  }
}

// 状态表里出现、但设备列表里找不到的 IP：只提醒一次用的去重表
// （心跳每秒一轮，不去重就会把控制台刷满）
// 设备心跳：后端状态轮询 / 监控列表同步（阶段 3 迁出到 composables/useDeviceHeartbeat.js）
const {
  heartbeatUnknownIpWarned,
  fetchDevicesStatusFromBackend,
  updateHeartbeatDevices,
} = useDeviceHeartbeat({
  devices,
  devicesStatusCache,
  devicesLastUpdateTime,
  deviceFirmwareInfo,
  deviceVersionInfo,
  cloudManageMode,
  selectedCloudDevice,
  instances,
  allInstances,
})

// ⚠️ 暂时禁用自动 watch，避免意外触发
// 改为在添加/删除设备时手动调用 updateHeartbeatDevices()
// 
// 监听设备列表变化,自动更新监控列表
// 只监听设备IP列表,避免在设备属性更新时重复触发
// const deviceIPsList = computed(() => {
//   const ipList = devices.value.map(d => d.ip).sort().join(',')
//   console.log('[心跳Watch] computed deviceIPsList 被计算:', ipList)
//   return ipList
// })

// watch(deviceIPsList, async (newIPs, oldIPs) => {
//   console.log('[心跳Watch] watch 触发!', {
//     heartbeatInitialized,
//     newIPs,
//     oldIPs,
//     same: newIPs === oldIPs
//   })
//   
//   if (heartbeatInitialized && newIPs && newIPs !== oldIPs) {
//     console.log('[心跳Watch] ⚠️⚠️⚠️ 设备IP列表发生变化,更新监控列表')
//     console.log('[心跳Watch] 旧IP列表:', oldIPs || '空')
//     console.log('[心跳Watch] 新IP列表:', newIPs)
//     await updateHeartbeatDevices()
//   } else {
//     console.log('[心跳Watch] 条件不满足,不触发更新')
//   }
// })

// 将后端缓存的原始容器列表解析为前端 deviceCloudMachinesCache 格式
// rawContainers: /android 接口返回的 list 数组（已含 deviceIp 字段）
const _parseV3RawContainers = (device, rawContainers) => {
  // 保存所有原始容器数据，用于备份列表
  const allRawContainers = rawContainers.map(container => ({
    ...container,
    status: container.status === 'running' ? 'running' : container.status,
    deviceIp: device.ip
  }))

  // 按坑位分组，每个坑位只保留一个容器，优先保留 running 状态
  const containersBySlot = new Map()
  rawContainers.forEach(container => {
    const slotNum = container.indexNum
    if (slotNum) {
      const existing = containersBySlot.get(slotNum)
      const processed = {
        ...container,
        containerId: container.id || container.ID || container.containerId || container.containerID || '',
        status: container.status === 'running' ? 'running' : 'shutdown',
        deviceIp: device.ip
      }
      if (!existing || (processed.status === 'running' && existing.status !== 'running')) {
        containersBySlot.set(slotNum, processed)
      }
    }
  })

  // 按坑位号升序排列（Map 是插入序，跟随设备接口原始顺序），保证坑位模式批量投屏/批量操作按坑位顺序执行
  const processedContainers = Array.from(containersBySlot.values())
    .sort((a, b) => (Number(a.indexNum) || 0) - (Number(b.indexNum) || 0))

  // 获取之前的缓存，用于保留截图状态
  const previousCache = deviceCloudMachinesCache.value.get(device.ip) || []

  const deviceCloudMachines = processedContainers.map(inst => {
    const screenshotUrl = getCloudMachineScreenshotUrl(device, inst)
    const newMachine = {
      id: `${device.ip}_${inst.name}`,
      containerId: inst.containerId || inst.containerID || inst.id || inst.ID || '',
      name: inst.name,
      status: inst.status,
      screenshot: screenshotUrl,
      screenshotData: null,
      screenshotError: false,
      hasLoadedOnce: false,
      ip: inst.ip,
      modelName: inst.modelName,
      modelPath: inst.modelPath,
      deviceIp: device.ip,
      indexNum: inst.indexNum,
      portBindings: inst.portBindings,
      image: inst.image,
      created: inst.created,
      dns: inst.dns,
      androidType: inst.androidType,
      networkName: inst.networkName,
      randomFile: inst.randomFile || false,
      enforce: inst.enforce !== undefined ? inst.enforce : true,
      mgenable: inst.mgenable || '0',
      gmsenable: inst.gmsenable || '0',
      doboxWidth: inst.doboxWidth || '',
      doboxHeight: inst.doboxHeight || '',
      doboxDpi: inst.doboxDpi || '',
      doboxFps: inst.doboxFps || '',
      macVlanIp: inst.networkName === 'myt' ? (inst.ip || '') : '',
      mytBridgeName: inst.networkName !== 'myt' ? (inst.networkName || '') : '',
      adbPort: inst.adbPort || 5555, // ADB端口，默认5555
    }
    return mergeCloudMachineState(previousCache, newMachine)
  })

  devicesLastUpdateTime.value.set(device.id, Date.now())
  deviceCloudMachinesCache.value.set(device.ip, deviceCloudMachines)
  deviceAllInstancesCache.value.set(device.ip, allRawContainers)

  if (activeDevice.value && activeDevice.value.ip === device.ip) {
    instances.value = processedContainers
    allInstances.value = allRawContainers
    updateCloudMachines()
  } else if (cloudManageMode.value === 'batch') {
    // 批量模式下 activeDevice 为 null，需主动重新计算分组数据以刷新界面
    initCloudMachineGroups()
  }
}

// 获取安卓云机列表
// isUserInitiated=true：触发后端立即刷新后读最新缓存（操作后强制更新）
// isUserInitiated=false：直接读后端缓存（日常展示，极快）
const fetchAndroidContainers = async (device, isUserInitiated = false) => {
  if (!device) return

  // 只有用户主动刷新或设备未加载过时才显示加载状态
  if (isUserInitiated || !deviceCloudMachinesCache.value.has(device.ip)) {
    cloudMachineLoadingState.value.set(device.ip, true)
  }

  try {
    // isUserInitiated=true：触发后端立即刷新，等 800ms 后读最新数据
    if (isUserInitiated) {
      triggerAndroidRefresh([device.ip]).catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 800))
    }

    // 从后端缓存读取（IPC 调用，极快，无外部网络请求）
    const cacheMap = await getAndroidContainersList([device.ip])
    const deviceCache = cacheMap[device.ip]

    // 认证失败：触发 authRetry 弹窗重新认证，认证后触发后端重新轮询
    if (deviceCache && deviceCache.status === 'auth_fail') {
      await authRetry(device, async () => {
        triggerAndroidRefresh([device.ip]).catch(() => {})
      })
      return
    }

    // 从缓存中提取原始列表
    let rawList = null
    if (deviceCache && deviceCache.list) {
      const resp = deviceCache.list
      // 后端存的是完整 /android 响应：{code:0, data:{list:[...]}}
      if (resp.code === 0 && resp.data && resp.data.list) {
        rawList = resp.data.list
      } else if (resp.code === 0 && resp.list) {
        rawList = resp.list
      } else if (resp.code === 0) {
        rawList = [] // 空列表合法
      }
    }

    // 缓存无数据（设备刚上线、尚未完成首次轮询）：回退到直接请求
    if (rawList === null) {
      await authRetry(device, async (password = null) => {
        const containers = await getContainers(device, password)
        if (!containers) return
        if (containers.code === 61 && containers.message === 'Authentication Failed') {
          throw new Error('Authentication Failed')
        }
        if (containers.code === 0) {
          const list = (containers.data && containers.data.list) ? containers.data.list
            : containers.list ? containers.list : []
          _parseV3RawContainers(device, list)
        }
      })
      return
    }

    // V3：直接解析
    if (device.version === 'v3') {
      _parseV3RawContainers(device, rawList)
      return
    }

    // V0-V2：回退到 Docker API（后端轮询仅支持 V3）
    await authRetry(device, async (password = null) => {
      const dockerContainers = await getContainers(device, password)
      if (!dockerContainers) return

      const dockerArr = Array.isArray(dockerContainers)
        ? dockerContainers
        : (dockerContainers?.code === 0 && dockerContainers?.data?.list) ? dockerContainers.data.list : []

      const processedContainers = dockerArr.filter(c => {
        const image = c.Image || c.image
        const name = c.Name || c.Names?.[0]
        return !(image?.includes('myt_sdk') || image?.includes('myt_vpc_plugin') ||
                 name?.includes('myt_sdk') || name?.includes('myt_vpc_plugin'))
      }).filter(c => parseContainerSlot(c, device) !== null)
        .map((c, index) => {
          const slotNum = parseContainerSlot(c, device) || (index + 1)
          return {
            name: c.Names ? c.Names[0]?.replace('/', '') || `container-${index}` : `container-${index}`,
            status: c.Status?.startsWith('Up') ? 'running' : 'shutdown',
            indexNum: slotNum,
            ip: `${device.ip.split('.')[0]}.${device.ip.split('.')[1]}.3.${slotNum + 100}`,
            deviceIp: device.ip,
            containerId: c.Id || c.ID || c.id || '',
            image: c.Image,
            createTime: new Date(c.Created * 1000).toLocaleString('zh-CN', {
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit'
            }),
            modelName: 'Q1',
            Ports: c.Ports,
            NetworkSettings: c.NetworkSettings,
            PortBindings: c.PortBindings,
            portBindings: c.portBindings,
            rawContainer: c
          }
        }).sort((a, b) => (Number(a.indexNum) || 0) - (Number(b.indexNum) || 0))

      const previousCache = deviceCloudMachinesCache.value.get(device.ip) || []
      const deviceCloudMachines = processedContainers.map(inst => {
        const screenshotUrl = getCloudMachineScreenshotUrl(device, inst)
        return mergeCloudMachineState(previousCache, {
          id: `${device.ip}_${inst.name}`,
          name: inst.name,
          status: inst.status,
          screenshot: screenshotUrl,
          screenshotData: null,
          screenshotError: false,
          hasLoadedOnce: false,
          ip: inst.ip,
          modelName: inst.modelName,
          modelPath: inst.modelPath,
          deviceIp: device.ip,
          indexNum: inst.indexNum,
          PortBindings: inst.PortBindings,
          portBindings: inst.portBindings,
        })
      })

      deviceCloudMachinesCache.value.set(device.ip, deviceCloudMachines)
      deviceAllInstancesCache.value.set(device.ip, processedContainers)
      if (activeDevice.value && activeDevice.value.ip === device.ip) {
        instances.value = processedContainers
        allInstances.value = processedContainers
        updateCloudMachines()
      }
    })
  } catch (error) {
    if (error.message !== 'Authentication Failed') {
      console.error('获取安卓云机列表失败:', device.ip, error)
    }
    deviceCloudMachinesCache.value.set(device.ip, [])
    deviceAllInstancesCache.value.set(device.ip, [])
  } finally {
    cloudMachineLoadingState.value.set(device.ip, false)
  }
}


// 启动同步授权定时器（每10分钟执行一次）
const startSyncAuthTimer = () => {
  // 清理之前的定时器
  if (syncAuthTimer.value) {
    clearInterval(syncAuthTimer.value)
  }
  
  // 设置新的定时器，每10分钟执行一次
  syncAuthTimer.value = setInterval(() => {
    console.log('自动执行同步授权操作')
    handleSyncAuthorization()
  }, 30 * 60 * 1000) // 10分钟 = 10 * 60 * 1000毫秒
  
  console.log('同步授权定时器已启动，每10分钟执行一次')
}

// 从HostManagement.vue移回的函数
const handleSyncAuthorization = async () => {
  const currentToken = token.value 
  if (!currentToken) {
    ElMessage.warning('请先获取授权token');
    return;
  }
  
  const devices = filteredDevices.value;
  if (devices.length === 0) {
    ElMessage.warning('请先添加设备');
    return;
  }
  
  const deviceIPs = devices.map(device => device.ip);
  console.log('deviceIPs:', deviceIPs)
  
  try {
    let successCount = 0;
    for (const deviceIP of deviceIPs) {
      try {
        const result = await SyncAuthorization(currentToken, deviceIP);
        if (result.success) {
          successCount++;
        } else {
          console.error(`设备 ${deviceIP} 同步授权失败:`, result.message);
        }
      } catch (deviceError) {
        console.error(`设备 ${deviceIP} 同步授权出错:`, deviceError);
      }
    }
    
    if (successCount === deviceIPs.length) {
      ElMessage.success(t('common.syncAuthCompletedForAllDevices', { count: successCount }));
    } else if (successCount > 0) {
      ElMessage.warning(t('common.syncAuthPartialSuccess', { count: successCount }));
    } else {
      ElMessage.error(t('common.syncAuthAllFailed'));
    }
    // 续费/授权同步后，清除坑位状态缓存并刷新当前设备
    clearAllSlotCache()
    if (selectedCloudDevice.value) {
      fetchAndCacheSlotStates(selectedCloudDevice.value.id)
    }
  } catch (error) {
    console.error('同步授权失败:', error);
    ElMessage.error(t('common.syncAuthFailed'));
  }
}

const clearCache = async () => {
  try {
    await ElMessageBox.confirm('确定要清理所有客户端数据并重新加载吗？这将清除所有设备信息、密码和镜像缓存。', '清理客户端数据确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    
    // 显示加载状态
    ElMessage({ message: '正在清理客户端数据...', type: 'info' })
    
    console.log('[清理缓存] 开始清理所有客户端数据...')
    
    // 1. 清理localStorage缓存
    console.log('[清理缓存] 清理 localStorage...')
    localStorage.removeItem('edgeclient_devices')  // ✅ 修复：正确的设备列表key
    localStorage.removeItem('deviceCache')  // 同步清理 api.js 的设备缓存
    localStorage.removeItem('devicePasswords')
    localStorage.removeItem('mytos_image_list')
    localStorage.removeItem('mytos_image_list_last_update')
    localStorage.removeItem('deviceGroups')  // 清理设备分组
    localStorage.removeItem('deviceGroupFilter')  // 清理分组过滤器
    
    console.log('[清理缓存] ✓ localStorage 清理完成')
    
    // 2. 清理内存缓存（Map类型）
    console.log('[清理缓存] 清理 Map 缓存...')
    deviceCloudMachinesCache.value.clear()
    deviceAllInstancesCache.value.clear()
    cloudMachineLoadingState.value.clear()
    devicesLastUpdateTime.value.clear()
    devicesStatusCache.value.clear()
    deviceVersionInfo.value.clear()
    deviceFirmwareInfo.value.clear()  // 清理固件信息
    onlineImagesByModel.value.clear()
    imageDownloadStatus.value.clear()
    imageUploadStatus.value.clear()
    deviceBindStatus.value.clear()  // 清理绑定状态
    
    console.log('[清理缓存] ✓ Map 缓存清理完成')
    
    // 3. 清理内存缓存（ref类型）
    console.log('[清理缓存] 清理 ref 缓存...')
    devices.value = []
    activeDevice.value = null
    instances.value = []
    allInstances.value = []
    cloudMachines.value = []
    selectedCloudMachines.value = []
    phoneModels.value = []
    imageList.value = []
    filteredImageList.value = []
    sharedFiles.value = []
    selectedFiles.value = []
    dockerNetworks.value = []
    localCachedImages.value = []
    deviceBoxImages.value = []
    isViewingDeviceDetails.value = false
    deviceDetailsDialogVisible.value = false
    
    console.log('[清理缓存] ✓ ref 缓存清理完成')


    // 🔧 通知后端清空监控设备列表
    console.log('[清理缓存] 通知后端清空监控列表...')
    await updateMonitoredDevices([], {})
    console.log('[清理缓存] ✓ 后端监控列表已清空')

    // 🔧 通知后端清空设备密码（否则心跳检测仍会用旧密码认证，导致设备被判定为在线）
    console.log('[清理缓存] 通知后端清空设备密码...')
    await UpdateDevicePasswords({})
    console.log('[清理缓存] ✓ 后端设备密码已清空')

    // 🔧 已移除定时器，无需清理
    
    // 4. 清理api.js中的内存缓存
    console.log('[清理缓存] 清理 API 缓存...')
    containersMemoryCache.clear()
    
    console.log('[清理缓存] ✓ API 缓存清理完成')
    
    // 5. 重新加载所有数据
    console.log('[清理缓存] 重新加载数据...')
    await refreshData()
    
    // 6. 自动重新加载镜像列表
    console.log('[清理缓存] 重新加载镜像列表...')
    await fetchImageList('')
    
    console.log('[清理缓存] ========== ✅ 客户端数据清理完成 ==========')
    ElMessage({ message: '客户端数据清理完成，数据已重新加载', type: 'success' })
  } catch (error) {
    if (error !== 'cancel') {
      console.error('[清理缓存] ❌ 清理失败:', error)
      ElMessage.error('清理客户端数据失败: ' + error.message)
    }
  }
}

// 批量清理磁盘数据
// SDK升级任务队列：子组件发起升级时，先在队列里创建条目
// SDK 升级任务 / 主机磁盘清理 / 退出登录（阶段 3 迁出到 composables/useHostTasks.js）
const {
  handleSdkUpgradePushTask,
  handleSdkUpdateTask,
  handleBatchDeleteHosts,
  cleanDeviceDisk,
  logOut,
} = useHostTasks({
  taskQueue,
  t,
  selectedHostDevices,
  collapseRightSidebar,
  authRetry,
  activeDevice,
  isViewingDeviceDetails,
  token,
  uname,
})

const handleBatchDeleteDevices = async () => {
  if (selectedHostDevices.value.length === 0) {
    ElMessage.warning('请先选择要删除的设备')
    return
  }
  
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedHostDevices.value.length} 个设备吗？`, '批量删除确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'danger'
    })
    
    // 批量移除设备
    const deviceIpsToDelete = new Set(selectedHostDevices.value.map(d => d.ip))
    devices.value = devices.value.filter(d => !deviceIpsToDelete.has(d.ip))
    
    // 保存到本地存储
    saveDevicesToLocalStorage()
    deviceIpsToDelete.forEach(ip => {
      deviceCloudMachinesCache.value.delete(ip)
      deviceAllInstancesCache.value.delete(ip)
      // 如果删除的是当前激活的设备，清空激活状态
      if (activeDevice.value && activeDevice.value.ip === ip) {
        activeDevice.value = null
        instances.value = []
        allInstances.value = []
        cloudMachines.value = []
      }
    })

    // 清理已删除设备的认证密码
    const passwords = JSON.parse(localStorage.getItem('devicePasswords') || '{}')
    deviceIpsToDelete.forEach(ip => {
      delete passwords[ip]
    })
    localStorage.setItem('devicePasswords', JSON.stringify(passwords))
    await UpdateDevicePasswords(passwords)
    
    // 清空选择
    selectedHostDevices.value = []

    // 通知后端更新监控设备列表，停止对已删除设备的心跳检测
    await updateHeartbeatDevices()
    
    ElMessage.success(`成功删除 ${deviceIpsToDelete.size} 个设备`)
  } catch (error) {
    if (error !== 'cancel') {
      console.error('批量删除设备失败:', error)
      ElMessage.error('批量删除设备失败')
    }
  }
}


// 绑定主机
const handleBindsTest = async () => { 
  try {
    // 1. 检查是否已登录
    // const currentToken = token.value 
    // if (!currentToken) {
    //   ElMessage.warning('请先登录获取授权token');
    //   return;
    // }
    
    // 2. 获取选中的设备
    const selectedDevices = [...selectedHostDevices.value];
    // if (selectedDevices.length === 0) {
    //   ElMessage.warning('请先选择要绑定的设备');
    //   return;
    // }
    
    // 3. 过滤出未绑定的设备
    const unboundDevices = selectedDevices.filter(device => {
      const bindStatus = deviceBindStatus.value.get(device.id) || 0;
      return bindStatus !== 1; // 1表示已绑定
    });
    
    if (unboundDevices.length === 0) {
      ElMessage.warning('所有选中的设备都已绑定');
      return;
    }
    
    // 4. 提取设备ID
    const deviceIds = unboundDevices.map(device => device.id);
    console.log('要绑定的设备ID:', deviceIds);
    
    
    // 6. 调用绑定API
    const formData = new URLSearchParams()
    formData.append('type', 'user_host_oper');
    const data = {
       act: 'batchBind',
       data: JSON.stringify({ host: deviceIds }),
       token: token.value
    }
    formData.append('data', JSON.stringify(data));


    console.log('formData:', formData)
    
    const response = await fetch('https://www.moyunteng.com/api/api.php', {
          method: 'POST',
          body: formData
     })  
 
    const result = await response.json()
    console.log('response:', result)
    
    // 7. 处理响应结果
    if (result.code == 200) {
      // 更新绑定状态
      result.data.forEach(deviceId => {
        deviceBindStatus.value.set(deviceId, 1); // 标记为已绑定
      });
      
      // 清空选中设备
      selectedHostDevices.value = [];
      
      ElMessage.success(`成功绑定 ${result.data.length} 个设备`);
    } else {
      ElMessage.error(`绑定失败: ${result.msg}`);
    }
    
  } catch (error) {
    console.error('绑定设备失败:', error);
    ElMessage.error('绑定设备失败: ' + error.message);
  }
}
</script>

<template>
  <el-container class="app-container" style="height: 100vh;">
    <!-- 终端遮罩层 -->
    <div id="terminal-overlay" class="terminal-overlay"></div>
    <!-- 主要内容区域 -->
    <el-main class="app-main" style="height: 100%;">
      <!-- 悬浮任务列表按钮和语言切换 -->
      <div style="position: fixed; top: 18px; right: 34px; z-index: 1000; display: flex; gap: 8px; align-items: center;">
        <!-- 语言切换器 -->
        <LanguageSwitcher />
        
        <!-- 任务队列 -->
        <el-dropdown trigger="click" popper-class="task-list-dropdown">
          <el-button type="primary" size="default" class="el-tooltip__trigger" style="padding: 8px 10px;">
            <el-icon><Timer /></el-icon>
            {{ t('common.taskQueue') }}
            <el-badge v-if="runningTasksCount > 0" :value="runningTasksCount" type="danger" :max="99"></el-badge>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu style="width: 400px; max-height: 500px; overflow-y: auto;">
              <div style="padding: 12px; font-weight: bold; border-bottom: 1px solid #e4e7ed; color: var(--el-text-color-primary); display: flex; justify-content: space-between; align-items: center;">
                <span>{{ t('common.taskQueue') }}</span>
                <el-button type="link" size="small" @click="handleClearTasks" :disabled="taskQueue.length === 0">
                  {{ t('common.delete') }}{{ t('common.taskQueue') }}
                </el-button>
              </div>
              <div v-if="taskQueue.length === 0" style="padding: 20px; text-align: center; color: var(--el-text-color-secondary);">
                {{ t('common.taskQueue') }}为空
              </div>
              <el-dropdown-item v-else v-for="task in taskQueue" :key="task.id" style="padding: 0; border-bottom: 1px solid #f0f0f0; text-align: left !important; display: block;">
                <div style="padding: 10px 15px; text-align: left !important; display: block; width: 100%;">
                  <div style="display: flex; justify-content: space-between; align-items: center; text-align: left;">
                    <div style="text-align: left !important;">
                      <span style="font-weight: bold;">
                {{ task.type === 'restart' ? '批量重启' : task.type === 'reset' ? '批量重置' : task.type === 'shutdown' ? '批量关机' : task.type === 'create' ? '批量创建' : task.type === 'delete' ? '批量删除' : task.type === 'switchModel' ? (task.operation === 'new' ? '批量新机' : '批量切换机型') : task.type === 'uploadFile' ? '批量上传' : task.type === 'uploadImage' ? '批量上传镜像' : task.type === 'downloadImage' ? '下载镜像' : task.type === 'cleanDisk' ? '清理磁盘' : task.type === 'sdkUpgrade' ? (task.isBatch ? '批量升级SDK' : '升级SDK') : task.type === 'updateImage' ? '批量更新镜像' : task.type === 'copy' ? '复制云机' : '未知任务' }}
              </span>
                      <el-tooltip :content="getTaskTargetDisplay(task).full.join('\n')" placement="top" :disabled="getTaskTargetDisplay(task).full.length <= 1">
                <span style="color: #409eff; font-size: 12px; margin-left: 4px; cursor: default;">
                  {{ getTaskTargetDisplay(task).short }}
                </span>
              </el-tooltip>
                      <el-tag :type="task.status === 'running' ? 'warning' : task.status === 'completed' ? 'success' : task.status === 'failed' ? 'danger' : 'info'" size="small" style="margin-left: 8px;">
                        {{ task.status === 'running' ? '运行中' : task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : task.status === 'canceled' ? '已取消' : '等待中' }}
                      </el-tag>
                    </div>
                    <div style="font-size: 12px; color: var(--el-text-color-secondary); text-align: right !important;">{{ new Date(task.startTime || 0).toLocaleTimeString() }}</div>
                  </div>
                  
                  <!-- 批量上传镜像/文件按设备IP分进度条显示 -->
                  <div v-if="(task.type === 'uploadImage' || task.type === 'uploadFile') && task.deviceIps && task.deviceIps.length > 0" class="device-progress-list" style="margin-top: 8px;">
                    <div v-for="deviceIP in task.deviceIps" :key="deviceIP" class="device-progress-item" style="display: flex; align-items: center; margin-bottom: 4px;">
                      <span style="width: 100px; font-size: 12px; color: var(--el-text-color-regular); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ deviceIP }}</span>
                      <el-progress 
                        :percentage="getDeviceProgress(task, deviceIP)" 
                        :status="getDeviceProgressStatus(task, deviceIP)"
                        :stroke-width="8"
                        style="flex: 1;"
                      ></el-progress>
                      <component :is="getDeviceProgressText(task, deviceIP).icon" v-if="getDeviceProgressText(task, deviceIP).icon === 'CircleCheck'" style="width: 16px; height: 16px; color: #67c23a; margin-left: 8px;" />
                      <component :is="getDeviceProgressText(task, deviceIP).icon" v-else-if="getDeviceProgressText(task, deviceIP).icon === 'CircleClose'" style="width: 16px; height: 16px; color: #f56c6c; margin-left: 8px;" />
                      <component :is="getDeviceProgressText(task, deviceIP).icon" v-else-if="getDeviceProgressText(task, deviceIP).icon === 'Loading'" style="width: 16px; height: 16px; color: #409eff; margin-left: 8px;" class="rotating" />
                      <el-icon v-else style="width: 16px; height: 16px; color: var(--el-text-color-secondary); margin-left: 8px;"><Timer /></el-icon>
                    </div>
                  </div>
                  <!-- 其他任务显示总进度 -->
                  <div v-else style="margin-top: 5px;">
                    <el-progress :percentage="task.progress" :status="task.status === 'completed' ? 'success' : task.status === 'failed' ? 'exception' : ''" :stroke-width="10"></el-progress>
                  </div>
                  
                  <!-- 清理磁盘任务显示步骤 -->
                  <div v-if="task.type === 'cleanDisk' && task.steps && task.steps.length > 0" style="margin-top: 8px;">
                    <div style="font-size: 12px; color: var(--el-text-color-regular); margin-bottom: 4px;">执行步骤:</div>
                    <div style="max-height: 150px; overflow-y: auto; background: #f5f7fa; padding: 8px; border-radius: 4px; font-size: 11px; color: var(--el-text-color-regular); font-family: monospace;">
                      <div v-for="(step, index) in task.steps" :key="index" style="margin-bottom: 2px; word-break: break-all;">{{ step }}</div>
                    </div>
                  </div>
                  
                  <!-- 任务摘要信息 -->
                  <div v-if="task.type === 'cleanDisk'" style="margin-top: 5px; font-size: 12px; text-align: left !important; display: block;">
                    <div v-if="task.status === 'completed'" style="color: #67c23a;">
                      设备清理完毕，正在重启
                    </div>
                    <div v-else style="color: var(--el-text-color-regular);">
                      设备: {{ task.deviceIP }} | 步骤: {{ task.currentStep }}/{{ task.totalSteps }}
                    </div>
                  </div>
                  <!-- SDK升级任务显示日志与状态 -->
                  <div v-else-if="task.type === 'sdkUpgrade'" style="margin-top: 5px; font-size: 12px; text-align: left !important; display: block;">
                    <div style="color: var(--el-text-color-regular); margin-bottom: 4px;">
                      设备: {{ task.deviceIP }}<span v-if="task.currentStage"> | 阶段: {{ task.currentStage }}</span>
                    </div>
                    <div v-if="task.currentMsg" style="color: #409eff; margin-bottom: 4px; word-break: break-all;">
                      {{ task.currentMsg }}
                    </div>
                    <div v-if="task.logs && task.logs.length > 0" style="max-height: 150px; overflow-y: auto; background: #f5f7fa; padding: 8px; border-radius: 4px; font-size: 11px; color: var(--el-text-color-regular); font-family: monospace;">
                      <div v-for="(log, idx) in task.logs" :key="idx" style="margin-bottom: 2px; word-break: break-all;">{{ log }}</div>
                    </div>
                  </div>
                  <!-- 创建任务分步显示进度 -->
                  <div v-else-if="task.type === 'create'" style="margin-top: 5px; font-size: 12px; text-align: left !important; display: block;">
                    <template v-if="task.currentStep === 'image' && task.imageProgress !== null">
                      <span style="color: #409eff;">推送镜像: {{ task.imageProgress }}%</span>
                    </template>
                    <template v-else-if="task.currentStep === 'create'">
                      <span style="color: #67c23a;">创建第{{ task.completed + task.failed }}个 ({{ task.completed + task.failed }}/{{ task.total }})</span>
                    </template>
                    <template v-else>
                      <span style="color: var(--el-text-color-regular);">创建第{{ task.completed + task.failed }}个 ({{ task.completed + task.failed }}/{{ task.total }})</span>
                    </template>
                    <span style="color: var(--el-text-color-secondary); margin-left: 8px;">成功: {{ task.completed }}, 失败: {{ task.failed }}</span>
                  </div>
                  <div v-else style="margin-top: 5px; font-size: 12px; color: var(--el-text-color-regular); text-align: left !important; display: block;">
                      总进度: {{ task.progress }}% (成功: {{ task.completed }}, 失败: {{ task.failed }})
                    </div>
                    <div v-if="(task.type === 'uploadImage' || task.type === 'downloadImage') && task.imageName" style="margin-top: 3px; font-size: 12px; color: #67c23a; text-align: left !important; display: block;">
                      镜像名称: {{ task.imageName }}
                    </div>
                    <div v-if="task.type === 'uploadFile'" style="margin-top: 3px; font-size: 12px; color: #67c23a; text-align: left !important; display: block;">
                      文件数: {{ task.fileCount || task.targets?.length || 0 }}, 云机数: {{ task.machineCount || 0 }}
                    </div>
                    <!-- 复制云机：流式日志列表 -->
                    <div v-if="task.type === 'copy' && task.copyLogs && task.copyLogs.length > 0" style="margin-top: 6px; max-height: 160px; overflow-y: auto; background: #f5f7fa; border-radius: 4px; padding: 6px 8px;">
                      <div v-for="(log, li) in task.copyLogs" :key="li" style="display:flex; align-items:center; gap:4px; font-size:11px; margin-bottom:3px; font-family:monospace;">
                        <span style="color:var(--el-text-color-secondary); flex-shrink:0;">[{{ log.current }}/{{ log.total }}]</span>
                        <span style="color:var(--el-text-color-primary); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" :title="log.name">{{ log.name }}</span>
                        <el-tag size="small" :type="log.status === 'success' ? 'success' : log.status === 'failed' ? 'danger' : 'info'" style="flex-shrink:0; padding:0 4px; height:16px; line-height:16px;">
                          {{ log.status === 'success' ? '✓' : log.status === 'failed' ? '✗' : '…' }}
                        </el-tag>
                        <span style="color:var(--el-text-color-regular); max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-shrink:0;" :title="log.message">{{ log.message }}</span>
                      </div>
                    </div>
                    <div v-if="task.failed > 0" style="margin-top: 3px; font-size: 12px; color: #f56c6c; text-align: left !important; display: block;">
                      <template v-if="task.type === 'create'">
                        <div style="text-align: left !important; display: block;">失败原因:</div>
                        <div v-for="(failedTarget, index) in task.failedTargets.slice(0, 3)" :key="index" style="margin-top: 2px; text-align: left !important; display: block;">
                          坑位{{ failedTarget.slot }}: {{ failedTarget.error || '未知错误' }}
                        </div>
                        <div v-if="task.failedTargets.length > 3" style="margin-top: 2px; color: var(--el-text-color-secondary); text-align: left !important; display: block;">
                          ...等{{ task.failedTargets.length }}个失败记录
                        </div>
                      </template>
                      <template v-else-if="task.type === 'uploadFile'">
                        <div style="text-align: left !important; display: block;">失败原因:</div>
                        <div v-for="(failedTarget, index) in task.failedTargets.slice(0, 3)" :key="index" style="margin-top: 2px; text-align: left !important; display: block;">
                          {{ failedTarget.filePath?.split('\\').pop() || '未知文件' }} -> {{ formatInstanceName(failedTarget.machineName) || '未知云机' }}: {{ failedTarget.error || '未知错误' }}
                        </div>
                        <div v-if="task.failedTargets.length > 3" style="margin-top: 2px; color: var(--el-text-color-secondary); text-align: left !important; display: block;">
                          ...等{{ task.failedTargets.length }}个失败记录
                        </div>
                      </template>
                      <template v-else>
                        <div style="text-align: left !important; display: block;">
                          <span v-for="(failedTarget, index) in task.failedTargets.slice(0, 3)" :key="index" style="display: block; margin-bottom: 2px;">
                            {{ failedTarget.machineName ? `${failedTarget.deviceIP || '未知设备'} ${failedTarget.machineName}` : (failedTarget.deviceIP || '未知设备') }}: {{ failedTarget.error || '未知错误' }}
                          </span>
                          <div v-if="task.failedTargets.length > 3" style="margin-top: 2px; color: var(--el-text-color-secondary);">
                            ...等{{ task.failedTargets.length }}个失败记录
                          </div>
                        </div>
                      </template>
                    </div>
                  <div style="margin-top: 8px; display: flex; gap: 5px; justify-content: flex-start; text-align: left !important;">
                    <el-button v-if="task.status === 'running'" type="danger" size="small" @click="cancelTask(task.id)">取消</el-button>
                    <el-button v-if="task.status === 'failed'" type="primary" size="small" @click="retryFailedTask(task.id)">重试失败</el-button>
                  </div>
                </div>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        
        <!-- 设置按钮 -->
        <el-tooltip content="设置" placement="bottom">
          <el-button type="default" size="default" style="padding: 8px 10px;" @click="openSettingsDialog">
            <el-icon><Setting /></el-icon>
          </el-button>
        </el-tooltip>
        
        <!-- 更新菜单组件 -->
        <UpdateMenu :is-dark="isDarkTheme" @show-update-dialog="handleShowUpdateDialog" @theme-mode-change="toggleThemeMode" />
      </div>
      
      <!-- 标签页 -->
      <el-tabs v-model="activeTab" size="large" class="modern-tabs fixed-tabs" @tab-change="handleTabChange" style="height: 100%;" :scrollable="true">
        <template #append>
          <!-- 其他菜单按钮 -->
          <el-dropdown trigger="click">
            <el-button type="link" size="large" class="menu-button">
              <el-icon><More /></el-icon>
            </el-button>
            <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item @click="toggleThemeMode">
            切换主题颜色模式
          </el-dropdown-item>
          <el-dropdown-item @click="openSettingsDialog" divided>{{ t('common.settings') }}</el-dropdown-item>
          <el-dropdown-item divided>{{ t('menu.logout') }}</el-dropdown-item>
        </el-dropdown-menu>
        </template>
          </el-dropdown>
        </template>
          <!-- 主机管理 -->
          <el-tab-pane :label="t('menu.hostManagement')" name="host-management" style="height: 100%;">
            <HostManagement 
              :devices="devices"
              :active-device="activeDevice"
              :instances="instances"
              :loading="loading"
              :token="token"
              :uname="uname"
              :filtered-devices="filteredDevices"
              :device-firmware-info="deviceFirmwareInfo"
              :device-version-info="deviceVersionInfo"
              :selected-host-devices="selectedHostDevices"
              :is-viewing-device-details="isViewingDeviceDetails"
              :active-tab="activeTab"
              :grouped-instances="groupedInstances"
              :filtered-image-List="filteredImageList"
              :docker-networks="dockerNetworks"
              :box-images="boxImages"
              :device-filter="deviceFilter"
              :devices-status-cache="devicesStatusCache"
              :slot-states="slotStates"
              :device-bind-status="deviceBindStatus"
              :device-groups="deviceGroups"
              :device-group-filter="deviceGroupFilter"
              :filtered-devices-by-group="filteredDevicesByGroup"
              :device-groups-tree="deviceGroupsTree"
              :is-batch-projection-controlling="isBatchProjectionControlling"
              @update:device-filter="handleDeviceFilterChange"
              @update:device-group-filter="deviceGroupFilter = $event"
              @refch-devices="refchDevices"
              @handle-batch-delete-devices="handleBatchDeleteDevices"
              @show-sync-auth-dialog="showSyncAuthDialog"
              @handle-sync-authorization="handleSyncAuthorization"
              @clear-cache="clearCache"
              @log-Out="logOut"
              @handle-host-device-selection-change="handleHostDeviceSelectionChange"
              @show-device-details="showDeviceDetails"
              @show-create-dialog="showCreateDialog"
              @collapse-right-sidebar="collapseRightSidebar"
              @fetch-android-containers="fetchAndroidContainers"
              @handle-batch-action="handleBatchAction"
              @refresh-image-list="refreshImageList"
              @fetch-docker-networks="fetchDockerNetworks"
              @fetch-v3-device-info="fetchV3DeviceInfo"
              @show-password-dialog="showPasswordDialog"
              @handle-close-password="handleClosePassword"
              @show-add-macvlan-dialog="showAddMacvlanDialog"
              @switch-image-category="switchImageCategory" 
              @start-container="startContainer"
              @stop-container="stopContainer"
              @start-projection="startProjection"
              @show-update-image-dialog="showUpdateImageDialog"
              @handle-delete-container="handleDeleteContainerWithBackupRefresh"
              @handle-add-device="handleAddDevice"
              @handle-batch-add-devices="handleBatchAddDevices"
              @handle-binds-test="handleBindsTest"
              @handle-get-device-version="handleGetDeviceVersion"
              @add-device-group="addDeviceGroup"
              @rename-device-group="renameDeviceGroup"
              @delete-device-group="deleteDeviceGroup"
              @move-device-to-group="moveDeviceToGroup"
              @handle-batch-delete-hosts="handleBatchDeleteHosts"
              @sdk-upgrade-push-task="handleSdkUpgradePushTask"
            />
          </el-tab-pane>
        <!-- 云机管理 -->
        <el-tab-pane :label="t('menu.cloudManagement')" name="cloud-management">
          <CloudManagement 
            :active-device="activeDevice"
            :cloud-manage-mode="cloudManageMode"
            :cloud-machine-groups="cloudMachineGroups"
            :selected-cloud-device="selectedCloudDevice"
            :imageList="imageList"
            :instances="instances"
            :all-instances="allInstances"
            :cloud-machines="cloudMachines"
            :cloud-machines-by-name="cloudMachinesByName"
            :selected-cloud-machines="selectedCloudMachines"
            :devices="devices"
            :devices-status-cache="devicesStatusCache"
            :loading="loading"
            :tree-selected-keys="treeSelectedKeys"
            :is-batch-projection-controlling="isBatchProjectionControlling"
            @show-create-dialog="showCreateDialog"
            @handle-context-menu="handleContextMenu"
            @show-backup-list="showBackupList"
            @handle-batch-action="handleBatchAction"
            @handle-delete-container="handleDeleteContainerWithBackupRefresh"
            @start-projection="startProjection"
            @handle-node-drop="handleNodeDrop"
            @cloud-manage-mode-change="handleCloudManageModeChange"
            @selected-cloud-device-change="handleSelectedCloudDeviceChange"
            @fetch-android-containers="fetchAndroidContainers"
            @device-added="handleAddDevice"
            @devices-added="handleBatchAddDevices"
            @handle-batch-add-devices="handleBatchAddDevices"
            @handle-tree-check="handleTreeCheck"
            @move-device-to-group="moveDeviceToGroup"
            @start-copy-task="handleStartCopyTask"
            :screenshot-cache="screenshotDataCache"
            :slot-states="slotStates"
            
          />
          
          <!-- 批量上传对话框 -->
          <BatchUploadDialog
            v-model:visible="batchUploadDialogVisible"
            :selected-machines="batchUploadSelectedMachines"
            :cloud-manage-mode="cloudManageMode"
            :selected-cloud-device="selectedCloudDevice"
            @upload="handleBatchUpload"
            @open-shared-directory="openSharedDirectory"
          />
        </el-tab-pane>

        
        
        <!-- 镜像管理 -->
        <el-tab-pane :label="t('menu.imageManagement')" name="image-management">
          <el-row :gutter="12" style="height: 100%; min-height: 600px;">
            <el-col :span="24" class="device-left-col" style="height: 100%;">
              <el-card shadow="hover" class="device-card image-management-card" style="height: 100%;">
                <template #header>
                  <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                    <div class="device-list-tabs">
                      <el-button 
                        type="link" 
                        size="small" 
                        class="device-tab" 
                        :class="{ active: selectedImageCategory === 'online' }"
                        @click="selectedImageCategory = 'online'; switchImageCategory('online')"
                      >{{ $t('common.onlineImage') }}</el-button>
                      <el-button 
                        type="link" 
                        size="small" 
                        class="device-tab"
                        :class="{ active: selectedImageCategory === 'local' }"
                        @click="selectedImageCategory = 'local'; switchImageCategory('local')"
                      >{{ $t('common.localImage') }}</el-button>
                      <el-button 
                        type="link" 
                        size="small" 
                        class="device-tab"
                        :class="{ active: selectedImageCategory === 'device' }"
                        @click="selectedImageCategory = 'device'; switchImageCategory('device')"
                      >{{ $t('common.deviceImage') }}</el-button>
                      <el-button 
                        type="link" 
                        size="small" 
                        class="device-tab"
                        :class="{ active: selectedImageCategory === 'guide' }"
                        @click="selectedImageCategory = 'guide'"
                      >{{ $t('image.usageGuide') }}</el-button>
                    </div>
                    <div style="display: flex; gap: 8px;">
                      <el-button 
                        type="primary" 
                        size="small" 
                        @click="refreshImageList" 
                        :disabled="fetchingImages"
                        class="refresh-button"
                      >
                        <el-icon :class="{ 'is-rotating': fetchingImages }"><Refresh /></el-icon> {{ $t('common.refreshOnlineImages') }}
                      </el-button>
                      <el-button 
                        type="primary" 
                        size="small" 
                        @click="handleOpen" 
                        class="refresh-button"
                      >
                        <el-icon ><FolderOpened /></el-icon> {{ $t('common.openLocalImageDirectory') }}
                      </el-button>
                    </div>
                  </div>
                </template>
                
                <!-- 在线镜像列表 -->
                <div v-if="selectedImageCategory === 'online'" class="image-list-container">
                  <el-tabs v-model="currentOnlineImageModel" type="border-card" class="online-image-tabs">
                    <el-tab-pane 
                      v-for="[model, images] in onlineImagesByModel" 
                      :key="model" 
                      :label="model || $t('common.other')"
                      :name="model || $t('common.other')"
                    >
                      <!-- 筛选控制区域 -->
                      <div class="filter-controls" style="margin-bottom: 15px;">
                        <el-radio-group v-model="imageCategory" size="small" style="margin-bottom: 10px; display: block;">
                          <el-radio-button label="simulator">{{ $t('common.simulator') }}</el-radio-button>
                          <el-radio-button label="container">{{ $t('common.container') }}</el-radio-button>
                        </el-radio-group>

                        <div v-if="imageCategory === 'container'" class="version-filter" style="display: flex; align-items: center;">
                           <span style="margin-right: 10px; font-size: 12px;">{{ $t('common.androidVersion') }}:</span>
                           <el-radio-group v-model="containerAndroidVersion" size="small">
                             <el-radio :label="10">Android 10</el-radio>
                             <!-- Q1 支持 Android 12，P1 不支持 -->
                             <el-radio v-if="model !== 'P1'" :label="12">Android 12</el-radio>
                             <el-radio :label="14">Android 14</el-radio>
                           </el-radio-group>
                        </div>
                        <div v-if="imageCategory === 'simulator'" class="version-filter" style="display: flex; align-items: center;">
                           <span style="margin-right: 10px; font-size: 12px;">{{ $t('common.androidVersion') }}:</span>
                           <el-radio-group v-model="simulatorAndroidVersion" size="small">
                             <el-radio :label="10">Android 10</el-radio>
                             <el-radio :label="11">Android 11</el-radio>
                             <el-radio :label="13">Android 13</el-radio>
                             <el-radio :label="14">Android 14</el-radio>
                             <el-radio :label="15">Android 15</el-radio>
                             <el-radio :label="16">Android 16</el-radio>
                             <el-radio :label="17">Android 17</el-radio>
                           </el-radio-group>
                        </div>
                      </div>

                      <el-table 
                        :data="getFilteredImages(images, model)" 
                        stripe 
                        size="small" 
                        class="image-table"
                      >
                        <el-table-column :label="$t('common.imageName')" align="center" width="260">
                          <template #default="scope">
                            <span class="image-name">{{ scope.row.name }}</span>
                          </template>
                        </el-table-column>
                        <el-table-column :label="$t('common.updateContent')" align="center">
                          <template #default="scope">
                            <span v-html="scope.row.udesc ? scope.row.udesc.replace(/\n/g, '|') : ''"></span>
                          </template>
                        </el-table-column>
                        <el-table-column :label="$t('common.operation')" fixed="right" align="center" width="220">
                          <template #default="scope">
                            <div class="table-actions">
                              <!-- 未下载状态 -->
                              <el-button 
                                v-if="!imageDownloadStatus.get(scope.row.url)"
                                type="primary" 
                                size="small"
                                @click="downloadOnlineImage(scope.row)"
                                :disabled="isDownloadingImage"
                              >
                                <el-icon><Download /></el-icon> {{ $t('common.download') }}
                              </el-button>
                              <!-- 已下载状态 -->
                              <template v-else>
                                <el-button 
                                  type="success" 
                                  size="small"
                                  @click="uploadImageToDevice(scope.row)"
                                  
                                >
                                  <el-icon><Upload /></el-icon> {{ $t('common.uploadToDevice') }}
                                </el-button>
                                <el-button 
                                  type="danger" 
                                  size="small"
                                  @click="deleteDownloadedImage(scope.row)"
                                >
                                  <el-icon><Delete /></el-icon> {{ $t('common.delete') }}
                                </el-button>
                              </template>
                            </div>
                          </template>
                        </el-table-column>
                      </el-table>
                    </el-tab-pane>
                  </el-tabs>
                </div>
                
                <!-- 设备镜像列表 -->
                <div v-else-if="selectedImageCategory === 'device'" class="image-list-container" style="height: calc(100% - 50px);">
                  <el-row style="height: 100%;">
                    <!-- 左侧：设备列表 -->
                    <el-col :span="6" style="height: 100%; border-right: 1px solid #EBEEF5;">
                      <div class="device-list-sidebar" style="height: 100%; overflow-y: auto;">
                        <el-menu
                          :default-active="selectedDeviceForImages ? selectedDeviceForImages.ip : ''"
                          class="el-menu-vertical-demo"
                          style="border-right: none;"
                        >
                          <el-menu-item 
                            v-for="device in devices" 
                            :key="device.ip" 
                            :index="device.ip"
                            @click="handleDeviceSelectForImages(device)"
                          >
                            <el-icon><Monitor /></el-icon>
                            <span>{{ device.ip }}</span>
                            <el-tag size="small" type="info" style="margin-left: 5px;">{{ device.name || $t('common.device') }}</el-tag>
                          </el-menu-item>
                          
                          <div v-if="devices.length === 0" style="padding: 20px; text-align: center; color: var(--el-text-color-secondary);">
                            {{ $t('common.noDevice') }}
                          </div>
                        </el-menu>
                      </div>
                    </el-col>
                    
                    <!-- 右侧：镜像列表 -->
                    <el-col :span="18" style="height: 100%; padding-left: 10px;">
                        <div v-if="selectedDeviceForImages" class="image-list-content" style="height: 100%; overflow-y: auto;">
                          <div v-if="isLoadingDeviceImages" class="image-loading" style="padding: 20px;">
                            <el-skeleton :rows="5" animated></el-skeleton>
                          </div>
                          <div v-else-if="matchedDeviceBoxImages.length === 0" class="no-images" style="padding: 20px; text-align: center;">
                            <el-empty :description="$t('common.noDownloadedImages')" :image-size="100"></el-empty>
                          </div>
                          <div v-else class="image-items" style="display: flex; flex-wrap: wrap; align-content: flex-start;">
                            <div v-for="(image, index) in matchedDeviceBoxImages" :key="index" class="image-item" style="margin: 10px;">
                              <el-card shadow="hover" class="image-card">
                                <template #header>
                                  <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                                    <span :title="image.onlineImageName">{{ image.onlineImageName }}</span>
                                    <el-button
                                      type="danger"
                                      size="small"
                                      @click="handleDeleteDeviceImage(image)"
                                      class="delete-button"
                                    >
                                    <el-icon><Delete /></el-icon> {{ $t('common.delete') }}
                                    </el-button>
                                  </div>
                                </template>
                                <div class="image-info">
                                  <div class="image-details" style="font-size: 13px; line-height: 1.5;">
                                    <p>{{ $t('common.onlineImageName') }}: {{ image.onlineImageName }}</p>
                                    <p>{{ $t('common.imageSize') }}: {{ image.size }}</p>
                                    <p>{{ $t('common.createTime') }}: {{ image.createTime }}</p>
                                    <p v-if="image.matched" style="color: #67c23a;">{{ $t('common.matchedWithOnlineImage') }}</p>
                                    <p v-else style="color: var(--el-text-color-secondary);">{{ $t('common.notMatchedWithOnlineImage') }}</p>
                                    <p v-if="image.matched" style="font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ $t('common.onlineURL') }}: {{ image.onlineImageUrl }}</p>
                                    <p v-else style="font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ $t('common.deviceURL') }}: {{ image.url }}</p>
                                  </div>
                                </div>
                              </el-card>
                            </div>
                          </div>
                        </div>
                        
                        <div v-else class="no-device-selected" style="height: 100%; display: flex; justify-content: center; align-items: center;">
                          <el-empty :description="$t('common.pleaseSelectDeviceFirst')" :image-size="100"></el-empty>
                        </div>
                    </el-col>
                  </el-row>
                </div>
                <div v-else-if="selectedImageCategory === 'local'" class="image-list-container">
                  <el-table 
                    :data="localCachedImages" 
                    stripe 
                    size="small" 
                    class="image-table"
                  >
                    <el-table-column :label="$t('common.imageName')" align="center">
                      <template #default="scope">
                        <span class="image-name">{{ scope.row.name }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column :label="$t('common.filePath')" show-overflow-tooltip align="center">
                      <template #default="scope">
                        <span class="image-url">{{ scope.row.url }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column :label="$t('common.size')" align="center">
                      <template #default="scope">
                        <span>{{ formatFileSize(scope.row.size || 0) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column :label="$t('common.createTime')" align="center">
                      <template #default="scope">
                        <span>{{ scope.row.createTime }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column :label="$t('common.availableDeviceModels')" show-overflow-tooltip align="center">
                      <template #default="scope">
                        <el-tag 
                          v-for="model in scope.row.availableModels" 
                          :key="model" 
                          size="small"
                          style="margin-right: 4px; margin-bottom: 4px;"
                        >
                          {{ model }}
                        </el-tag>
                        <span v-if="!scope.row.availableModels || scope.row.availableModels.length === 0">{{ $t('common.universal') }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column :label="$t('common.operation')" fixed="right" align="center" width="280">
                      <template #default="scope">
                        <div class="table-actions">
                          <el-button 
                            type="success" 
                            size="small" 
                            @click="uploadLocalImageToDevice(scope.row)" 
                            :disabled="false" 
                          >
                            <el-icon><Upload /></el-icon> {{ $t('common.uploadToDevice') }}
                          </el-button>
                          <el-button 
                            type="danger" 
                            size="small"
                            @click="deleteLocalCachedImage(scope.row)"
                          >
                            <el-icon><Delete /></el-icon> {{ $t('common.delete') }}
                          </el-button>
                        </div>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>

                <!-- 使用说明 -->
                <div v-else-if="selectedImageCategory === 'guide'" class="image-list-container image-guide-container">
                  <div class="image-guide-content" v-html="$t('image.guideContent')"></div>
                </div>

                <!-- 下载进度弹窗 -->
              
                
              </el-card>
            </el-col>
          </el-row>
        </el-tab-pane>
        

        <!-- 机型管理 -->
        <el-tab-pane :label="t('menu.modelManagement')" name="model-management">
          <ModelManagement 
            ref="modelManagementRef"
            :devices="devices" 
            :activeDevice="activeDevice" 
            :selectedHostDevices="selectedHostDevices"
            :devicesStatusCache="devicesStatusCache"
          />
        </el-tab-pane>

        <!-- 网络管理 -->
        <el-tab-pane :label="t('menu.networkManagement')" name="network-management">
          <NetworkManagement 
            ref="networkManagementRef"
            :devices="devices" 
            :activeDevice="activeDevice" 
            :selectedHostDevices="selectedHostDevices"
            :token="token"
            :device-firmware-info="deviceFirmwareInfo"
            :device-version-info="deviceVersionInfo"
            :devices-status-cache="devicesStatusCache"
          />
        </el-tab-pane>


        <!-- 云机管理 -->
        <el-tab-pane :label="t('menu.backupManagement')" name="backup-management">
          <BackupManagement
            ref="backupManagementRef"
            :devices="devices"
            :device-firmware-info="deviceFirmwareInfo"
            :devices-status-cache="devicesStatusCache"
            :slot-states="slotStates"
          />
        </el-tab-pane>


        <!-- 实例管理 -->
        <el-tab-pane :label="t('menu.instanceManagement')" name="instance-management">
          <instanceManagement 
            ref="instanceManagementRef"
            :devices="devices" 
            @handle-sync-authorization="handleSyncAuthorization"
            v-model:token="token"
            @update-user-info="handleUpdateUserInfo"
          />
        </el-tab-pane>

        <!-- 客服 -->
        <!-- <el-tab-pane name="customer-service">
          <template #label>
            <el-badge :value="customerServiceUnreadCount" :hidden="customerServiceUnreadCount === 0" :max="99">
              <span>客服</span>
            </el-badge>
          </template>
          <CustomerService 
             ref="customerServiceRef"
            :devices="devices" 
            :token="token"
            :device-firmware-info="deviceFirmwareInfo"
            :devices-status-cache="devicesStatusCache"
            :device-version-info="deviceVersionInfo"
            @unread-count-change="handleUnreadCountChange"
            @show-sync-auth-dialog="showSyncAuthDialog"
            @show-register-dialog="openRegisterDialog"
          />
        </el-tab-pane> -->

         <!-- 批量任务 -->
        <el-tab-pane :label="t('menu.batchTask')" name="batch-task">
          <BatchTaskManagement 
            :devices="devices"
            :instances="instances"
            :all-instances="allInstances"
            :cloud-machines="cloudMachines"
            :device-cloud-machines-cache="deviceCloudMachinesCache"
            :devices-status-cache="devicesStatusCache"
            :loading="loading"
          />
        </el-tab-pane>

        <!-- 流媒体 -->
        <el-tab-pane :label="t('menu.streamManagement')" name="stream-management">
          <StreamManagement 
            :devices="devices"
            :devices-status-cache="devicesStatusCache"
            :cloud-machine-groups="cloudMachineGroups"
            :fetch-android-containers="fetchAndroidContainers"
            :device-cloud-machines-cache="deviceCloudMachinesCache"
          />
        </el-tab-pane>

        <!-- AI助理 -->
        <el-tab-pane :label="t('menu.aiAssistant')" name="ai-assistant">
          <AiAssistant 
            ref="aiAssistantRef"
            :devices="devices" 
            :token="token"
            :devices-status-cache="devicesStatusCache"
          />
        </el-tab-pane>

        <!-- RPA Agent -->
        <el-tab-pane :label="t('menu.rpaAgent')" name="rpa-agent">
          <RpaAgent
            ref="rpaAgentRef"
            :devices="devices"
            :token="token"
            :devices-status-cache="devicesStatusCache"
          />
        </el-tab-pane>

        <!-- 互联云机 -->
        <el-tab-pane :label="t('menu.interconnectedCloudMachines')" name="interconnected-cloud-machines">
          <InterconnectedCloudMachines :token="token" />
        </el-tab-pane>

        <!-- 扩展服务 -->
        <el-tab-pane :label="t('menu.extensionService')" name="extension-service">
          <ExtensionService
            :devices="extensionServiceDevices"
            :device-firmware-info="deviceFirmwareInfo"
            :device-version-info="deviceVersionInfo"
            :devices-status-cache="devicesStatusCache"
            @upgrade-device="handleUpgradeDevice"
          />
        </el-tab-pane>

        <!-- opencecs -->
        <!-- <el-tab-pane label="OpenCecs" name="opencecs-management">
          <OpencecsManagement ref="opencecsManagementRef" />
        </el-tab-pane> -->

      </el-tabs>
    </el-main>
  </el-container>
  
  <!-- 设备选择对话框 -->
  <el-dialog
    v-model="showDeviceSelectionDialog"
    :title="t('dialog.addDeviceTitle')"
    width="600px"
    :close-on-click-modal="false"
    @close="handleDeviceSelectionDialogClose"
  >
    <!-- 上传进度已整合到任务列表 -->
    
    <div class="device-selection-container">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h4 style="margin: 0;">
          {{ $t('common.pleaseSelectDeviceForUpload') }}
          <span style="color: #409eff; font-weight: 500; margin-left: 8px;">
            ({{ $t('model.onlineDeviceCount', { count: sortedCompatibleDevicesList.length }) }})
          </span>
        </h4>
        <el-button 
          type="primary" 
          size="small" 
          :icon="Refresh" 
          @click="refreshDeviceListForUpload"
          :loading="refreshingDevicesForUpload"
        >
          刷新列表
        </el-button>
      </div>
      
      <!-- 空状态提示 -->
      <div v-if="sortedCompatibleDevicesList.length === 0" class="empty-devices">
        <el-empty :description="$t('common.noCompatibleDevices')" :image-size="100"></el-empty>
      </div>
      
      <!-- 设备列表 -->
      <el-table 
        v-else
        ref="deviceSelectionTableRef"
        :data="sortedCompatibleDevicesList" 
        stripe 
        size="small" 
        max-height="400"
        class="device-selection-table"
        @selection-change="handleUploadDeviceSelectionChange"
        :row-class-name="getDeviceRowClassName"
      >
        <el-table-column 
          type="selection" 
          width="55"
          :selectable="checkDeviceSelectable"
        ></el-table-column>
        <el-table-column prop="name" :label="$t('image.deviceModel')" width="120"></el-table-column>
        <el-table-column prop="ip" :label="$t('model.deviceIP')" width="150" sortable></el-table-column>
        <el-table-column :label="$t('common.status')" width="80" align="center">
          <template #default="scope">
            <el-tag 
              :type="devicesStatusCache.get(scope.row.id) === 'online' ? 'success' : 'danger'" 
              size="small"
            >
              {{ devicesStatusCache.get(scope.row.id) === 'online' ? $t('common.online') : $t('common.offline') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('image.availableSpace')" width="140" align="center">
          <template #default="scope">
            <span v-if="devicesStatusCache.get(scope.row.id) !== 'online'" style="color: var(--el-text-color-secondary);">
              未知
            </span>
            <span v-else-if="getDeviceStorageInfo(scope.row.id)">
              {{ getDeviceStorageInfo(scope.row.id).freeText }}
              <span 
                v-if="getDeviceStorageInfo(scope.row.id).isLow" 
                style="color: #F56C6C; font-size: 12px;"
              >
                {{ $t('image.insufficient') }}
              </span>
            </span>
            <span v-else style="color: var(--el-text-color-secondary);">{{ $t('common.loading') }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
    
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="showDeviceSelectionDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button 
          type="primary" 
          @click="handleUploadAfterDeviceSelection"
          :loading="isUploadingToMultipleDevices"
        >
          {{ t('common.upload') }}
        </el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 云机重命名弹窗 -->
  <el-dialog
    v-model="renameDialogVisible"
    :title="t('cloudMachine.renameCloudMachine')"
    width="400px"
    :close-on-click-modal="false"
  >
    <el-form :model="renameForm" label-width="80px">
      <el-form-item :label="$t('cloudMachine.currentName')">
        <el-input v-model="renameForm.name" disabled></el-input>
      </el-form-item>
      <el-form-item :label="$t('cloudMachine.newName')">
        <el-input v-model="renameForm.newName" :placeholder="$t('cloudMachine.enterNewName')"></el-input>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="renameDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submitRename" :loading="renameLoading">
          {{ t('common.confirm') }}
        </el-button>
      </span>
    </template>
  </el-dialog>
  
  <!-- 系统公告弹窗 -->
  <el-dialog
    v-model="announcementVisible"
    :title="announcementData.title"
    width="520px"
    :close-on-click-modal="false"
    :show-close="false"
    @close="closeAnnouncement"
    class="announcement-dialog"
  >
    <div class="announcement-content">
      <div class="announcement-icon">
        <el-icon :size="48" color="#409EFF">
          <BellFilled />
        </el-icon>
      </div>
      <div class="announcement-text">
        {{ announcementData.content }}
      </div>
    </div>
    <template #footer>
      <div class="announcement-footer">
        <el-button type="primary" @click="closeAnnouncement" size="large">
          {{ $t('common.understood') }}
          <span v-if="countdown > 0" class="countdown-badge">
            {{ countdown }}s
          </span>
        </el-button>
      </div>
    </template>
  </el-dialog>
  
  <!-- 切换云机悬浮窗口 -->
  <el-dialog
    v-model="backupListVisible"
    :title="t('cloudMachine.switchBackup')"
    width="70%"
  >
    <!-- 切换云机时的覆盖层 -->
    <div 
      v-if="backupLoading" 
      class="switching-backup-overlay-dialog"
    >
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>切换中...</span>
    </div>
    
    <!-- 坑位选择 -->
    <!-- <div class="backup-slot-section" style="margin-bottom: 16px;">
      <span class="backup-section-label">坑位：</span>
      <el-select 
        v-model="currentSlot" 
        placeholder="选择坑位" 
        style="width: 150px; margin-right: 12px;"
        @change="initBackupList"
        :disabled="backupLoading"
      >
        <el-option 
          v-for="i in 12" 
          :key="i" 
          :label="i" 
          :value="i"
        ></el-option>
      </el-select>
    </div> -->
    

    
    <!-- 备份列表 -->
    <div class="backup-list-container">
      <!-- 排序栏和批量操作 -->
      <div class="backup-sort-bar" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; gap: 16px;">
          <span class="backup-section-label">{{ $t('common.sortBy') }}</span>
          <el-button 
            type="link" 
            size="small" 
            @click="changeSort('name')"
            :class="{ active: sortBy === 'name' }"
            :disabled="backupLoading"
          >
            {{ $t('common.name') }} {{ sortBy === 'name' ? (sortOrder === 'ascending' ? '↑' : '↓') : '' }}
          </el-button>
          <el-button 
            type="link" 
            size="small" 
            @click="changeSort('createTime')"
            :class="{ active: sortBy === 'createTime' }"
            :disabled="backupLoading"
          >
            {{ $t('common.createTimeSort') }} {{ sortBy === 'createTime' ? (sortOrder === 'ascending' ? '↑' : '↓') : '' }}
          </el-button>
        </div>
        <div>
          <span v-if="selectedBackupList.length > 0" style="margin-right: 12px; color: var(--el-text-color-secondary);">{{ $t('common.selectedItems', { count: selectedBackupList.length }) }}</span>
          <el-button 
            type="danger" 
            size="small" 
            @click="batchDeleteBackup"
            :loading="backupLoading"
            :disabled="backupLoading || selectedBackupList.length === 0"
          >
            {{ $t('common.batchDelete') }}
          </el-button>
        </div>
      </div>
      
      <!-- 备份列表表格 -->
      <el-table 
        :data="sortedBackupList" 
        stripe 
        size="small" 
        style="width: 100%;" 
        :disabled="backupLoading"
        @selection-change="handleBackupSelectionChange"
        :row-key="row => row.id"
        ref="backupTableRef"
      >
        <el-table-column type="selection" width="50"></el-table-column>
        <el-table-column prop="name" :label="$t('cloudMachine.backupName')" width="150" show-overflow-tooltip>
           <template #default="scope">
            {{ formatInstanceName(scope.row.name) }}
          </template>
        </el-table-column>
        <el-table-column prop="createTime" :label="$t('common.createTimeSort')" width="180"></el-table-column>
        <el-table-column :label="$t('cloudMachine.remark')">
          <template #default="scope">
            {{ getImageDisplayName(scope.row.remark) }}
          </template>
        </el-table-column>

        <el-table-column prop="status" :label="$t('common.status')" width="120">
          <template #default="scope">
            <el-tag size="small" type="info" style="padding: 2px 8px;">{{ scope.row.status === 'running' ? $t('cloudMachine.running') : (scope.row.status === 'shutdown' || scope.row.status === 'exited') ? $t('cloudMachine.shutdown') : scope.row.status === 'created' ? $t('cloudMachine.created') : $t('cloudMachine.restarting') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="scope">
            <el-button 
              size="small" 
              type="primary" 
              @click="switchBackup(scope.row.id)"
              :loading="backupLoading"
              :disabled="backupLoading"
              style="margin-right: 8px;"
            >
              切换
            </el-button>
             <el-button 
              size="small" 
              type="primary" 
              @click="handleRename(scope.row)"
              style="margin-right: 8px;"
            >
              修改名称
            </el-button>
            <el-button 
              size="small" 
              type="danger" 
              @click="deleteBackup(scope.row.id)"
              :loading="backupLoading"
              :disabled="backupLoading"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div style="padding: 20px; text-align: center; color: var(--el-text-color-secondary);">
            当前坑位没有可用的备份
          </div>
        </template>
      </el-table>
    </div>
  </el-dialog>
  
  <!-- 批量切换云机进度对话框 -->
  <el-dialog
    v-model="batchSwitchBackupProgressVisible"
    title="批量切换云机进度"
    width="520px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="batchSwitchBackupDone >= batchSwitchBackupTotal"
  >
    <div style="padding: 0 4px;">
      <!-- 总进度条 -->
      <div style="margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 13px; color: var(--el-text-color-regular);">总进度</span>
          <span style="font-size: 13px; color: var(--el-text-color-primary); font-weight: 500;">
            {{ batchSwitchBackupDone }} / {{ batchSwitchBackupTotal }}
          </span>
        </div>
        <el-progress
          :percentage="batchSwitchBackupTotal > 0 ? Math.round(batchSwitchBackupDone / batchSwitchBackupTotal * 100) : 0"
          :status="batchSwitchBackupDone >= batchSwitchBackupTotal
            ? (batchSwitchBackupProgressList.some(i => i.status === 'failed') ? 'exception' : 'success')
            : ''"
          :stroke-width="12"
        />
      </div>
      <!-- 每台云机进度列表 -->
      <div style="max-height: 320px; overflow-y: auto;">
        <div
          v-for="item in batchSwitchBackupProgressList"
          :key="item.slotNum + '-' + item.deviceIp"
          style="display: flex; align-items: center; padding: 7px 0; border-bottom: 1px solid #f0f0f0; gap: 8px;"
        >
          <!-- 坑位 + 设备IP -->
          <div style="min-width: 100px; font-size: 12px; color: var(--el-text-color-regular); flex-shrink: 0;">
            <span>坑位 {{ item.slotNum }}</span>
            <span v-if="cloudManageMode === 'batch'" style="display: block; color: var(--el-text-color-secondary); font-size: 11px;">{{ item.deviceIp }}</span>
          </div>
          <!-- 备份名称 -->
          <div style="flex: 1; min-width: 0; font-size: 12px; color: var(--el-text-color-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" :title="item.backupName">
            → {{ item.backupName }}
          </div>
          <!-- 状态 -->
          <div style="min-width: 82px; text-align: right; flex-shrink: 0;">
            <el-tag
              v-if="item.status === 'pending'"
              size="small"
              type="info"
            >等待中</el-tag>
            <el-tag
              v-else-if="item.status === 'running'"
              size="small"
              type="warning"
            >
              <el-icon class="is-loading" style="margin-right: 3px;"><Loading /></el-icon>
              {{ item.message }}
            </el-tag>
            <el-tag
              v-else-if="item.status === 'success'"
              size="small"
              type="success"
            >成功</el-tag>
            <el-tag
              v-else-if="item.status === 'failed'"
              size="small"
              type="danger"
              :title="item.message"
            >失败</el-tag>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button
        type="primary"
        :disabled="batchSwitchBackupDone < batchSwitchBackupTotal"
        @click="batchSwitchBackupProgressVisible = false"
      >
        {{ batchSwitchBackupDone < batchSwitchBackupTotal ? '处理中...' : '关闭' }}
      </el-button>
    </template>
  </el-dialog>

  <!-- 创建云机弹窗 -->
  <div class="create-dialog-container">
    <el-dialog
      v-model="createDialogVisible"
      :title="createMode === 'batch' ? $t('common.batchCreateCloudMachine') : $t('common.createCloudMachine')"
      width="900px"
      :before-close="handleCreateCancel"
    >
      <!-- 弹窗内容 -->
      <div class="create-dialog-content">
        <!-- SDK加载蒙版 -->
        <!-- <div v-if="sdkLoadingVisible" class="sdk-loading-overlay">
          <div class="sdk-loading-content">
            <el-loading-spinner class="is-medium"></el-loading-spinner>
            <div class="sdk-loading-text">{{ sdkLoadingMessage }}</div>
            <div v-if="sdkLoadingMessage.includes('下载镜像') || sdkLoadingMessage.includes('拉取镜像')" class="sdk-loading-progress">
              <el-progress 
                :percentage="sdkLoadingProgress" 
                :stroke-width="16" 
                :show-text="true"
                status="success"
              ></el-progress>
            </div>
          </div>
        </div> -->
      <!-- 批量创建模式切换 -->
      <div style="margin-bottom: 20px; text-align: center;">
        <div class="create-type-switch">
          <div class="create-type-side create-type-left">
            <span class="create-type-tag create-type-tag-success">{{ $t('common.googleGreen') }}</span>
            <span class="create-type-tag create-type-tag-success">{{ $t('common.realParameters') }}</span>
          </div>
          <el-radio-group v-model="createForm.createType">
            <el-radio-button label="simulator">{{ $t('common.simulator') }}</el-radio-button>
            <el-radio-button label="container">{{ $t('common.container') }}</el-radio-button>
          </el-radio-group>
          <div class="create-type-side create-type-right">
            <span class="create-type-tag create-type-tag-muted">{{ $t('common.oldVersionImage') }}</span>
          </div>
        </div>
        <div style="margin-top: 8px; font-size: 12px; color: var(--el-text-color-regular); display: flex; justify-content: center; gap: 16px; flex-wrap: wrap;">
          <template v-if="createMode !== 'multi-device-batch'">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span>{{ $t('common.deviceRemainingSpace') }}:</span>
              <span :style="{ color: createDeviceStorageInfo.isLow ? '#F56C6C' : '#606266' }">{{ createDeviceStorageInfo.text }}</span>
              <el-progress
                :percentage="createDeviceStorageInfo.remainingPercent"
                :stroke-width="6"
                :show-text="false"
                :status="createDeviceStorageInfo.isLow ? 'exception' : 'success'"
                style="width: 140px;"
              ></el-progress>
            </div>
            <span v-if="createDeviceStorageInfo.isLow" style="color: #F56C6C;">{{ $t('common.insufficientSpace') }}</span>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span>{{ $t('common.apiVersion') }}: {{ createDeviceApiVersion }}</span>
              <span v-if="createDeviceApiLatestVersion">/ {{ $t('common.latestVersion') }} {{ createDeviceApiLatestVersion }}</span>
              <el-button v-if="createDeviceApiNeedsUpgrade" size="small" type="warning" @click="upgradeCreateDeviceApiVersion">{{ $t('common.upgrade') }}</el-button>
              <span v-if="createDeviceApiNeedsUpgrade" style="color: #F56C6C;">{{ $t('common.notLatestVersion') }}</span>
            </div>
          </template>
        </div>
      </div>

      <!-- 容器模式表单 -->
      <div v-if="createForm.createType === 'container'" class="create-dialog-container-mode" style="padding: 0 20px;">
        <el-form :model="createForm" label-width="100px">
          <el-form-item :label="$t('common.deviceIP')">
            <template v-if="createMode === 'multi-device-batch'">
              <div style="margin-bottom: 10px;">
                <el-radio-group v-model="batchDeviceTypeFilter" size="small" @change="selectedBatchDevices = []">
                  <el-radio-button label="p_series">{{ $t('common.pSeries') }}</el-radio-button>
                  <el-radio-button label="other_series">{{ $t('common.otherSeries') }}</el-radio-button>
                </el-radio-group>
              </div>
              <el-select 
                v-model="selectedBatchDevices" 
                multiple 
                :placeholder="$t('common.pleaseSelectDevice')"
                collapse-tags
                collapse-tags-tooltip
                filterable
                style="width: 100%"
              >
                <el-option
                  v-for="device in filteredBatchDevices"
                  :key="device.id"
                  :label="device.ip + (device.name ? ' (' + device.name + ')' : '')"
                  :value="device.ip"
                >
                </el-option>
              </el-select>
            </template>
            <template v-else>
              <el-input :value="createDevice ? createDevice.ip : ''" disabled></el-input>
            </template>
          </el-form-item>
          <el-form-item :label="$t('common.androidVersion')">
            <el-radio-group v-model="createForm.containerAndroidVersion">
              <el-radio label="10">Android 10</el-radio>
              <el-radio v-if="!isPSeriesOrBatchP" label="12">Android 12</el-radio>
              <el-radio label="14">Android 14</el-radio>
              <el-radio label="custom">{{ $t('common.customImage') }}</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item v-if="createMode !== 'multi-device-batch' || selectedBatchDevices.length > 0" :label="$t('common.imageAddress')">
             <el-select v-if="createForm.containerAndroidVersion !== 'custom'" v-model="createForm.containerImageSelect" :placeholder="$t('common.pleaseSelect')" style="width: 100%;">
                <!-- <el-option label="自定义镜像" value="custom"></el-option> -->
                <el-option 
                  v-for="image in filteredContainerImages" 
                  :key="image.url" 
                  :label="image.name" 
                  :value="image.url"
                ></el-option>
             </el-select>
             <div v-if="createForm.containerAndroidVersion === 'custom' || createForm.containerImageSelect === 'custom'" style="width: 100%;">
                <el-input v-model="createForm.containerCustomImageUrl"></el-input>
             </div>
          </el-form-item>

          <div style="display: flex; gap: 20px;">
            <el-form-item :label="$t('common.name')" style="flex: 1;">
              <el-input v-model="createForm.containerName" placeholder="T100"></el-input>
            </el-form-item>
            <el-form-item v-if="createMode !== 'batch'" :label="$t('common.cloudMachineCount')" style="flex: 1;">
              <el-input-number v-model="createForm.containerCount" :min="1" :max="24" style="width: 100%;"></el-input-number>
            </el-form-item>
          </div>

          <el-form-item v-if="createMode === 'batch'" :label="$t('common.slot')">
              <!-- <div style="margin-bottom: 5px;">选择坑位 ({{ isPSeries ? '24' : '12' }}坑位):</div> -->
              <div>
                  <div style="margin-bottom: 5px; font-size: 12px; display: flex; gap: 10px; flex-wrap: wrap;">
                      <span style="display: flex; align-items: center;"><span style="display: inline-block; width: 10px; height: 10px; background-color: #409EFF; margin-right: 4px; border-radius: 2px;"></span>{{ $t('common.normal') }}</span>
                      <span style="display: flex; align-items: center;"><span style="display: inline-block; width: 10px; height: 10px; background-color: #E6A23C; margin-right: 4px; border-radius: 2px;"></span>{{ $t('common.expiringSoon') }}</span>
                      <span style="display: flex; align-items: center;"><span style="display: inline-block; width: 10px; height: 10px; background-color: #F56C6C; margin-right: 4px; border-radius: 2px;"></span>{{ $t('common.expired') }}</span>
                      <span style="display: flex; align-items: center;"><span style="display: inline-block; width: 10px; height: 10px; background-color: #909399; margin-right: 4px; border-radius: 2px;"></span>{{ $t('common.noInstance') }}</span>
                  </div>
                  <el-checkbox-group v-model="createForm.selectedSlots" size="small" class="batch-slot-checkbox-group" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px;">
                      <el-checkbox-button v-for="i in (isPSeries ? 24 : 12)" :key="i" :label="i" style="width: 100%; margin: 0;" :class="getSlotClass(i)">
                          {{ i }}
                      </el-checkbox-button>
                  </el-checkbox-group>
              </div>
          </el-form-item>
          <el-form-item v-if="createMode === 'batch'" :label="$t('common.singleSlotCount')">
              <el-input-number 
              v-model="createForm.containerCount" 
              :min="1" 
              style="width: 100%;"
              :placeholder="$t('common.quantity')"
              ></el-input-number>
          </el-form-item>

          <el-form-item :label="$t('common.resolution')">
             <el-select v-model="createForm.containerResolution" :placeholder="$t('common.pleaseSelect')" style="width: 100%;">
                <el-option label="720 X 1280" value="720x1280x320"></el-option>
                <el-option label="1080 X 1920" value="1080x1920x420"></el-option>
                <el-option label="1200 X 1920（平板）" value="1200x1920x240"></el-option>
                <el-option label="1600 X 2560（平板）" value="1600x2560x320"></el-option>
                <el-option :label="$t('common.customResolution')" value="custom"></el-option>
             </el-select>
             
             <!-- 自定义分辨率输入框 -->
             <div v-if="createForm.containerResolution === 'custom'" class="custom-resolution-container" style="margin-top: 15px;">
                <div style="display: flex; gap: 20px; margin-bottom: 15px;">
                  <div style="flex: 1; display: flex; align-items: center;">
                    <label style="width: 60px; color: var(--el-text-color-regular);">{{ $t('common.deviceWidth') }}</label>
                    <el-input v-model="createForm.containerCustomResolution.width" style="flex: 1;"></el-input>
                  </div>
                  <div style="flex: 1; display: flex; align-items: center;">
                    <label style="width: 60px; color: var(--el-text-color-regular);">{{ $t('common.deviceHeight') }}</label>
                    <el-input v-model="createForm.containerCustomResolution.height" style="flex: 1;"></el-input>
                  </div>
                </div>
                <div style="display: flex; gap: 20px; align-items: center;">
                  <div style="flex: 1; display: flex; align-items: center;">
                    <label style="width: 60px; color: var(--el-text-color-regular);">DPI</label>
                    <el-input v-model="createForm.containerCustomResolution.dpi" style="flex: 1;"></el-input>
                  </div>
                  <div style="flex: 1; color: #f56c6c; font-size: 12px;">
                    {{ $t('common.resolutionWarning') }}
                  </div>
                </div>
             </div>
          </el-form-item>

          <div style="display: flex; gap: 20px;">
            <el-form-item :label="$t('common.dnsType')" style="flex: 1;">
              <el-select v-model="createForm.containerDns" :placeholder="$t('common.pleaseSelect')" style="width: 100%;">
                <el-option :label="$t('common.aliDNS')" value="223.5.5.5"></el-option>
                <el-option :label="$t('common.googleDNS')" value="8.8.8.8"></el-option>
                <el-option :label="$t('common.custom')" value="custom"></el-option>
              </el-select>
            </el-form-item>
            <el-form-item :label="$t('common.dnsAddress')" style="flex: 1;">
              <el-input v-if="createForm.containerDns === 'custom'" v-model="createForm.containerCustomDns" placeholder="223.5.5.5"></el-input>
              <el-input v-else :value="createForm.containerDns" disabled></el-input>
            </el-form-item>
          </div>

          <div style="display: flex; gap: 20px; align-items: center;">
            <el-form-item :label="$t('common.sandboxMode')" style="flex: 1;">
               <el-switch v-model="createForm.containerSandboxMode" :active-text="$t('common.enable')" :inactive-text="$t('common.disable')" inline-prompt @change="handleSandboxModeChange"></el-switch>
            </el-form-item>
            <el-form-item v-if="createForm.containerSandboxMode" :label="$t('common.dataDiskSize')" style="flex: 1;">
               <el-radio-group v-model="createForm.containerDataDiskSize">
                 <el-radio label="16G">16G</el-radio>
                 <el-radio label="32G">32G</el-radio>
                 <el-radio label="64G">64G</el-radio>
               </el-radio-group>
            </el-form-item>
          </div>

          <div style="display: flex; gap: 20px; align-items: center;">
            <el-form-item :label="$t('common.secureMode')" style="flex: 1;">
               <el-switch v-model="createForm.containerEnforce" :active-text="$t('common.enable')" :inactive-text="$t('common.disable')" inline-prompt></el-switch>
            </el-form-item>
            <el-form-item :label="$t('common.compatMode')" style="flex: 1;">
              <el-switch v-model="createForm.containerCompatMode" :active-text="$t('common.enable')" :inactive-text="$t('common.disable')" inline-prompt></el-switch>
            </el-form-item>
          </div>

          <div v-if="createMode !== 'multi-device-batch'" style="display: flex; gap: 20px; align-items: center;">
            <el-form-item :label="$t('common.networkManagement')" style="flex: 1;">
              <el-select v-model="createForm.vpcGroupId" :placeholder="$t('common.selectGroup')" clearable @change="handleVpcGroupChange" style="width: 130px;" :disabled="createForm.containerNetworkCardType === 'public' && createForm.containerMacVlanIp">
                <el-option v-for="group in vpcGroupList" :key="group.id" :label="group.alias" :value="group.id"></el-option>
              </el-select>
              <el-select v-if="createForm.vpcGroupId && createForm.vpcSelectMode === 'specified'" v-model="createForm.vpcNodeId" :placeholder="$t('common.selectNode')" style="width: 130px; margin-left: 10px;">
                <el-option v-for="node in vpcNodeList" :key="node.id" :label="node.remarks" :value="node.id"></el-option>
              </el-select>
              <el-radio-group v-if="createForm.vpcGroupId" v-model="createForm.vpcSelectMode" style="margin-left: 10px;">
                <el-radio label="specified">{{ $t('common.specifiedNode') }}</el-radio>
                <el-radio label="random">{{ $t('common.randomNode') }}</el-radio>
              </el-radio-group>
            </el-form-item>
          </div>
          
          <!-- 容器模式网卡类型选择 -->
          <el-form-item v-if="createMode !== 'multi-device-batch'" :label="$t('common.networkCardType')">
            <el-radio-group v-model="createForm.containerNetworkCardType" @change="handleContainerNetworkCardTypeChange">
              <el-radio label="private">{{ $t('common.privateNetworkCard') }}({{ $t('common.sharedIP') }})</el-radio>
              <el-radio label="public" :disabled="isPublicNetworkDevice">{{ $t('common.publicNetworkCard') }}({{ $t('common.independentIP') }})</el-radio>
            </el-radio-group>
            
            <!-- 网卡类型功能说明 -->
            <!-- <div style="margin-top: 8px; padding: 8px 12px; background: #f5f7fa; border-radius: 4px; font-size: 12px; line-height: 1.6; color: var(--el-text-color-regular);">
              <div style="margin-bottom: 6px;">
                <span style="font-weight: bold; color: #409EFF;">私有网卡：</span>
                在设备内创建独立的网关和掩码，为每个容器分配该网关下的IP地址。可实现容器间网络隔离，仍可使用网络管理的IP代理功能。
              </div>
              <div>
                <span style="font-weight: bold; color: #67C23A;">公有网卡：</span>
                容器直接使用设备所在局域网的网关和掩码，与设备处于同一网段。容器间无法实现网络隔离，且设置后将无法使用网络管理的IP代理功能。
              </div>
            </div> -->
            
            <!-- 公有网卡 macVlan 提示 -->
            <div v-if="createForm.containerNetworkCardType === 'public' && !hasMacVlan && !fetchingNetworkCards" style="margin-top: 5px; font-size: 12px; line-height: 1.2;">
              <span style="color: #F56C6C;">{{ $t('common.noMacVlanDetected') }}
              </span>
            </div>
          </el-form-item>
          
          <!-- 容器模式私有网卡选择 -->
          <el-form-item :label="$t('common.networkCardSelection')" v-if="createMode !== 'multi-device-batch' && createForm.containerNetworkCardType === 'private'" key="container-nic-select">
            <el-select 
              v-model="createForm.containerMytBridgeName" 
              :placeholder="$t('common.pleaseSelectNetworkCard')" 
              :loading="fetchingNetworkCards"
              clearable
              filterable
            >
              <el-option
                v-for="item in networkCardList"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </el-form-item>
          
          <!-- 容器模式 MacVlan IP 输入框 -->
          <el-form-item 
            v-if="createForm.containerNetworkCardType === 'public' && hasMacVlan" 
            label="MacVlan IP"
          >
            <el-input v-model="createForm.containerMacVlanIp" :placeholder="getMacVlanIpPlaceholder()"></el-input>
            
            <!-- 批量创建时显示IP范围 -->
            <div v-if="createForm.containerMacVlanIp && createMode === 'batch' && ((createForm.selectedSlots ? createForm.selectedSlots.length : 1) * createForm.containerCount) > 1" style="margin-top: 5px; font-size: 12px; color: #409EFF;">
              <el-icon><InfoFilled /></el-icon>
              {{ $t('common.batchCreateTip').replace('{count}', (createForm.selectedSlots ? createForm.selectedSlots.length : 1) * createForm.containerCount).replace('{range}', calculateIpRange(createForm.containerMacVlanIp, (createForm.selectedSlots ? createForm.selectedSlots.length : 1) * createForm.containerCount)) }}
            </div>
            
            <!-- MacVlan网络信息和注意事项 -->
            <div style="margin-top: 8px;">
              <div v-if="currentDeviceMacVlanInfo.subnet || currentDeviceMacVlanInfo.gw" style="font-size: 12px; color: var(--el-text-color-regular); margin-bottom: 5px;">
                <span v-if="currentDeviceMacVlanInfo.subnet">子网: {{ currentDeviceMacVlanInfo.subnet }}</span>
                <span v-if="currentDeviceMacVlanInfo.gw" style="margin-left: 10px;">网关: {{ currentDeviceMacVlanInfo.gw }}</span>
              </div>
              <el-alert 
                type="warning" 
                :closable="false"
                style="padding: 8px 12px;"
              >
                <template #title>
                  <div style="font-size: 12px; line-height: 1.6;">
                    <div style="font-weight: bold; margin-bottom: 4px;">⚠️ 重要提示</div>
                    <div>1. 请确保起始IP在子网范围内</div>
                    <div>2. <span style="color: #F56C6C; font-weight: bold;">请务必确认IP地址未被占用</span>,否则会造成IP冲突导致无法访问</div>
                    <div>3. 批量创建时将按顺序使用连续的IP地址(需手动确保可用)</div>
                    <div v-if="createMode === 'batch' && createForm.containerMacVlanIp">4. 当前将使用IP范围: {{ calculateIpRange(createForm.containerMacVlanIp, (createForm.selectedSlots ? createForm.selectedSlots.length : 1) * createForm.containerCount) }}</div>
                  </div>
                </template>
              </el-alert>
            </div>
          </el-form-item>
        </el-form>
      </div>

      <!-- 左右分栏布局 -->
      <div v-else class="create-dialog-left-right">
        <!-- 左侧内容 -->
        <div class="create-dialog-left">
          <el-form :model="createForm" label-width="100px">
            <el-form-item :label="$t('common.deviceIP')">
              <template v-if="createMode === 'multi-device-batch'">
                <div style="margin-bottom: 10px;">
                  <el-radio-group v-model="batchDeviceTypeFilter" size="small" @change="selectedBatchDevices = []">
                    <el-radio-button label="p_series">{{ $t('common.pSeries') }}</el-radio-button>
                    <el-radio-button label="other_series">{{ $t('common.otherSeries') }}</el-radio-button>
                  </el-radio-group>
                </div>
                <el-select 
                  v-model="selectedBatchDevices" 
                  multiple 
                  :placeholder="$t('common.pleaseSelectDevice')"
                  collapse-tags
                  collapse-tags-tooltip
                  filterable
                  style="width: 100%"
                >
                  <el-option
                    v-for="device in filteredBatchDevices"
                    :key="device.id"
                    :label="device.ip + (device.name ? ' (' + device.name + ')' : '')"
                    :value="device.ip"
                  >
                  </el-option>
                </el-select>
              </template>
              <template v-else>
                <el-input :value="createDevice ? createDevice.ip : ''" disabled></el-input>
              </template>
            </el-form-item>
            <el-form-item :label="$t('common.containerName')">
              <el-input v-model="createForm.name" :placeholder="$t('common.enterContainerNamePrefix')"></el-input>
            </el-form-item>
            <el-form-item :label="$t('common.slot')">
              <template v-if="createMode === 'batch'">
                <!-- <div style="margin-bottom: 5px;">选择坑位 ({{ isPSeries ? '24' : '12' }}坑位):</div> -->
                <div>
                    <div style="margin-bottom: 5px; font-size: 12px; display: flex; gap: 10px; flex-wrap: wrap;">
                        <span style="display: flex; align-items: center;"><span style="display: inline-block; width: 10px; height: 10px; background-color: #409EFF; margin-right: 4px; border-radius: 2px;"></span>{{ $t('common.normal') }}</span>
                        <span style="display: flex; align-items: center;"><span style="display: inline-block; width: 10px; height: 10px; background-color: #E6A23C; margin-right: 4px; border-radius: 2px;"></span>{{ $t('common.expiringSoon') }}</span>
                        <span style="display: flex; align-items: center;"><span style="display: inline-block; width: 10px; height: 10px; background-color: #F56C6C; margin-right: 4px; border-radius: 2px;"></span>{{ $t('common.expired') }}</span>
                        <span style="display: flex; align-items: center;"><span style="display: inline-block; width: 10px; height: 10px; background-color: #909399; margin-right: 4px; border-radius: 2px;"></span>{{ $t('common.noInstance') }}</span>
                    </div>
                    <el-checkbox-group v-model="createForm.selectedSlots" size="small" class="batch-slot-checkbox-group" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px;">
                        <el-checkbox-button v-for="i in (isPSeries ? 24 : 12)" :key="i" :label="i" style="width: 100%; margin: 0;" :class="getSlotClass(i)">
                            {{ i }}
                        </el-checkbox-button>
                    </el-checkbox-group>
                </div>
              </template>
              <template v-else>
                <el-input v-model="createForm.startSlot" disabled></el-input>
              </template>
            </el-form-item>
            <el-form-item v-if="createMode === 'batch'" :label="$t('common.singleSlotCountLabel')">
                <el-input-number 
                v-model="createForm.count" 
                :min="1" 
                style="width: 100%;"
                :placeholder="$t('common.quantity')"
                ></el-input-number>
            </el-form-item>
            <!-- 安卓版本 -->
            <el-form-item :label="$t('common.androidVersion')">
              <el-select v-model="createForm.androidVersion" style="width: 100%;">
                <el-option v-if="createDeviceApiVersionNumber === null || createDeviceApiVersionNumber >= 99" label="Android 10" value="10"></el-option>
                <el-option v-if="createDeviceApiVersionNumber === null || createDeviceApiVersionNumber >= 99" label="Android 11" value="11"></el-option>
                <el-option v-if="createDeviceApiVersionNumber === null || createDeviceApiVersionNumber >= 99" label="Android 13" value="13"></el-option>
                <el-option label="Android 14" value="14"></el-option>
                <el-option v-if="createDeviceApiVersionNumber === null || createDeviceApiVersionNumber >= 99" label="Android 15" value="15"></el-option>
                <el-option v-if="createDeviceApiVersionNumber === null || createDeviceApiVersionNumber >= 99" label="Android 16" value="16"></el-option>
                <el-option v-if="createDeviceApiVersionNumber === null || createDeviceApiVersionNumber >= 99" label="Android 17" value="17"></el-option>
              </el-select>
            </el-form-item>
            <!-- 镜像分类 -->
            <el-form-item :label="$t('common.imageCategory')">
              <el-radio-group v-model="createForm.imageCategory">
                <el-radio label="online">{{ $t('common.onlineImage') }}</el-radio>
                <el-radio label="special">{{ $t('common.specialImage') }}</el-radio>
                <el-radio label="local">{{ $t('common.localImage') }}</el-radio>
              </el-radio-group>
            </el-form-item>
            
            <!-- 在线镜像选择 -->
            <el-form-item v-if="createForm.imageCategory === 'online'" :label="$t('common.imageSelection')">
              <el-select v-model="createForm.imageSelect" @change="handleImageSelectChange" :loading="fetchingImages" style="width: 100%;" filterable>
                <el-option :label="$t('common.customImage')" value="custom"></el-option>
                <!-- 使用按安卓版本过滤的镜像列表 -->
                <el-option
                  v-for="image in androidVersionFilteredImageList"
                  :key="image.url"
                  :label="image.name"
                  :value="image.url"
                ></el-option>
              </el-select>
            </el-form-item>

            <!-- 特质镜像选择 -->
            <el-form-item v-if="createForm.imageCategory === 'special'" :label="$t('common.imageSelection')">
              <el-select v-model="createForm.imageSelect" @change="handleImageSelectChange" :loading="fetchingImages" style="width: 100%;" filterable>
                <el-option
                  v-for="image in specialImageList"
                  :key="image.url"
                  :label="image.name"
                  :value="image.url"
                ></el-option>
              </el-select>
            </el-form-item>

            <!-- 本地镜像选择（已按设备类型过滤：P系列设备只显示P系列镜像，非P系列只显示非P系列镜像） -->
            <el-form-item v-if="createForm.imageCategory === 'local'" :label="$t('common.imageSelection')">
              <el-select v-model="createForm.localImageUrl" :placeholder="$t('common.pleaseSelectLocalImage')" style="width: 100%;" filterable>
                <el-option
                  v-for="image in filteredLocalCachedImages"
                  :key="image.url"
                  :label="image.name"
                  :value="image.url"
                ></el-option>
              </el-select>
            </el-form-item>

            <!-- 自定义镜像地址 -->
            <el-form-item v-if="createForm.imageCategory === 'online' && createForm.imageSelect === 'custom'" :label="$t('common.customImageAddress')">
              <el-input v-model="createForm.customImageUrl" :placeholder="$t('common.enterImageAddress')"></el-input>
            </el-form-item>

            <!-- 在线镜像缓存到本地创建选项 -->
            <el-form-item v-if="createForm.imageCategory === 'online'" :label="$t('common.creationMethod')">
              <div style="display: flex; align-items: center;">
                <el-checkbox v-model="createForm.cacheToLocal">{{ $t('common.cacheToLocal') }}</el-checkbox>
                <el-tooltip 
                  :content="$t('common.cacheToLocalTip')" 
                  placement="top" 
                  effect="dark"
                  :popper-options="{
                    modifiers: [
                      {
                        name: 'offset',
                        options: {
                          offset: [0, 10]
                        }
                      }
                    ]
                  }"
                >
                  <el-icon style="margin-left: 8px; cursor: help; color: var(--el-text-color-secondary); font-size: 14px;">
                    <QuestionFilled />
                  </el-icon>
                </el-tooltip>
              </div>
            </el-form-item>
            
            <!-- S5代理设置（SDK版本>=25时支持） -->
            <el-form-item :label="$t('common.s5Proxy')" style="margin-bottom: 0;">
              <el-select v-model="createForm.s5Type" :placeholder="$t('common.pleaseSelectProxyType')" style="width: 100%;">
                <el-option :label="$t('common.noProxy')" value="0"></el-option>
                <el-option :label="$t('common.localDNSParsing')" value="1"></el-option>
                <el-option :label="$t('common.serverDNSParsing')" value="2"></el-option>
              </el-select>
            </el-form-item>

            <!-- 是否设置锁屏密码 -->
            <el-form-item :label="$t('common.lockScreenPassword')" style="margin-bottom: 0;">
              <el-input v-model="createForm.lockScreenPassword" :placeholder="$t('common.noLockScreen')" style="width: 100%;"></el-input>
            </el-form-item>

            <div style="display: flex; gap: 20px; align-items: center;">
              <el-form-item :label="$t('common.secureMode')" style="flex: 1;">
                <el-switch v-model="createForm.enforce" :active-text="$t('common.enable')" :inactive-text="$t('common.disable')" inline-prompt></el-switch>
              </el-form-item>
              <el-form-item :label="$t('common.compatMode')" style="flex: 1;">
                <el-switch v-model="createForm.compatMode" :active-text="$t('common.enable')" :inactive-text="$t('common.disable')" inline-prompt></el-switch>
              </el-form-item>
            </div>

            <!-- ADB端口（安全模式下显示） -->
            <el-form-item v-if="createForm.enforce" label="ADB端口">
              <el-input-number v-model="createForm.adbPort" :min="0" :max="65535" :step="1" controls-position="right" style="width: 200px;" @change="validateAdbPort"></el-input-number>
              <span style="margin-left: 8px; color: var(--el-text-color-secondary); font-size: 12px;">设置0不开启ADB</span>
            </el-form-item>
            
            <div v-if="createForm.s5Type !== '0'" style="margin-top: 0; margin-bottom: 20px; padding: 15px; background-color: #f5f7fa; border-radius: 4px;">
              <div style="display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; gap: 10px; align-items: center;">
                  <label style="width: 40px; text-align: right;">IP:</label>
                  <el-input v-model="createForm.s5IP" :placeholder="$t('common.enterIP')" style="flex: 1;"></el-input>
                  <label style="margin-left: 20px;">{{ $t('common.port') }}:</label>
                  <el-input v-model="createForm.s5Port" :placeholder="$t('common.enterPort')" style="flex: 1;"></el-input>
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                  <label style="width: 40px; text-align: right;">{{ $t('common.user') }}:</label>
                  <el-input v-model="createForm.s5User" :placeholder="$t('common.enterUser')" style="flex: 1;"></el-input>
                  <label style="margin-left: 20px;">{{ $t('common.password') }}:</label>
                  <el-input v-model="createForm.s5Password" type="password" :placeholder="$t('common.enterPassword2')" style="flex: 1;"></el-input>
                </div>
              </div>
            </div>
          </el-form>
        </div>
        
        <!-- 右侧内容 -->
        <div class="create-dialog-right">
          <el-form :model="createForm" label-width="100px">
           
            <el-form-item v-if="createForm.networkMode === 'myt'" :label="$t('common.ipAddress')">
              <el-input v-model="createForm.ipaddr" :placeholder="$t('common.enterStartIP')"></el-input>
            </el-form-item>
            <el-form-item :label="$t('common.dnsAddress')">
              <el-select v-model="createForm.dns" :placeholder="$t('common.pleaseSelectDNSAddress')">
                <el-option :label="'223.5.5.5 (' + $t('common.aliCloud') + ')'" value="223.5.5.5"></el-option>
                <el-option label="8.8.8.8 (Google)" value="8.8.8.8"></el-option>
                <el-option :label="$t('common.custom')" value="custom"></el-option>
              </el-select>
              <el-input v-if="createForm.dns === 'custom'" v-model="createForm.customDns" :placeholder="$t('common.enterCustomDNSAddress')" style="margin-top: 10px;"></el-input>
            </el-form-item>
            <el-form-item :label="$t('common.sandboxSize')">
              <el-input-number v-model="createForm.sandboxSize" :min="1" :max="2000" :step="1" suffix="GB"></el-input-number>
            </el-form-item>
            <el-form-item :label="$t('common.resolution')">
              <el-select v-model="createForm.resolution">
                <el-option :label="$t('common.customResolution')" value="custom"></el-option>
                <el-option :label="$t('common.defaultResolution')" value="default"></el-option>
                <el-option label="720x1280x320" value="720x1280x320"></el-option>
                <el-option label="1080x1920x420" value="1080x1920x420"></el-option>
                <el-option label="1200x1920x240（平板）" value="1200x1920x240"></el-option>
                <el-option label="1600x2560x320（平板）" value="1600x2560x320"></el-option>
              </el-select>
              <div v-if="createForm.resolution === 'custom'" class="custom-resolution-form" style="margin-top: 10px;">
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <label style="width: 60px; color: var(--el-text-color-regular); flex-shrink: 0;">{{ $t('common.width') }}</label>
                    <el-input v-model="createForm.customResolution.width" style="flex: 1;"></el-input>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <label style="width: 60px; color: var(--el-text-color-regular); flex-shrink: 0;">{{ $t('common.height') }}</label>
                    <el-input v-model="createForm.customResolution.height" style="flex: 1;"></el-input>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <label style="width: 60px; color: var(--el-text-color-regular); flex-shrink: 0;">DPI</label>
                    <el-input v-model="createForm.customResolution.dpi" style="flex: 1;"></el-input>
                  </div>
                </div>
                <div style="margin-top: 8px; color: #f56c6c; font-size: 12px;">
                  请注意，自定义分辨率可能引发样式适配异常
                </div>
              </div>
            </el-form-item>
            <!-- 地区选择（SDK版本>=25时显示） -->
            <el-form-item :label="$t('common.modelCountry')">
              <el-select 
                v-model="createForm.countryCode" 
                :placeholder="$t('common.pleaseSelectModelCountry')" 
                :loading="countryListLoading" 
                filterable
                @focus="fetchCountryList"
              >
                <el-option 
                  v-for="country in countryList" 
                  :key="country.countryCode" 
                  :label="`${country.countryName} (${getCountryEnglishName(country.countryCode)})`" 
                  :value="country.countryCode"
                ></el-option>
              </el-select>
            </el-form-item>
            <!-- V3设备显示型号选择 -->
            <el-form-item v-if="showV3Options && createMode !== 'multi-device-batch'" :label="$t('common.modelType')">
              <el-radio-group v-model="createForm.modelType" @change="handleModelTypeChange">
                <el-radio label="online">{{ $t('common.onlineModel') }}</el-radio>
                <el-radio label="local">{{ $t('common.localModel') }}</el-radio>
                <el-radio label="backup">{{ $t('common.backupModel') }}</el-radio>
              </el-radio-group>
            </el-form-item>
            <!-- V3设备显示在线型号选择 -->
            <el-form-item v-if="showV3Options && createForm.modelType === 'online' && !isSpecialModelLocked" :label="$t('common.phoneModel')">
              <el-select v-model="createForm.modelName" :placeholder="$t('common.pleaseSelectPhoneModel')" :loading="fetchingModels" filterable>
                <el-option :label="$t('common.random')" value="random"></el-option>
                <el-option 
                  v-for="model in androidVersionFilteredPhoneModels" 
                  :key="model.id" 
                  :label="model.name" 
                  :value="model.name"
                ></el-option>
              </el-select>
            </el-form-item>
            <!-- 特质镜像 + 安卓15 + 在线机型 时固定 Samsung_S24 机型 -->
            <el-form-item v-if="showV3Options && createForm.modelType === 'online' && isSpecialModelLocked" :label="$t('common.phoneModel')">
              <el-select v-model="createForm.modelName" disabled>
                <el-option label="Samsung_S24" value="Samsung_S24"></el-option>
              </el-select>
            </el-form-item>
            <!-- V3设备显示本地型号选择 -->
            <el-form-item v-if="showV3Options && createForm.modelType === 'local'" :label="$t('common.localModel')">
              <el-select v-model="createForm.localModel" :placeholder="$t('common.pleaseSelectLocalModel')" :loading="fetchingModels" clearable filterable>
                <el-option :label="$t('common.random')" value="random"></el-option>
                <el-option 
                  v-for="model in localPhoneModels" 
                  :key="model.id || model.name" 
                  :label="model.name" 
                  :value="model.name"
                ></el-option>
              </el-select>
            </el-form-item>
            <!-- V3设备显示备份机型选择 -->
            <el-form-item v-if="showV3Options && createForm.modelType === 'backup'" :label="$t('common.backupModel')">
              <el-select v-model="createForm.modelStatic" :placeholder="$t('common.pleaseSelectBackupModel')" :loading="fetchingBackupModels" filterable>
                <el-option :label="$t('common.random')" value="random"></el-option>
                <el-option 
                  v-for="model in backupPhoneModels" 
                  :key="model.name" 
                  :label="model.name" 
                  :value="model.name"
                ></el-option>
              </el-select>
            </el-form-item>
            
            <el-form-item :label="$t('common.advancedOptions')">
              <el-checkbox v-model="createForm.enableMagisk">{{ $t('common.enableMagisk') }}</el-checkbox>
              <el-checkbox v-model="createForm.enableGMS" style="margin-left: 20px;">{{ $t('common.enableGMS') }}</el-checkbox>
            </el-form-item>

            <el-form-item :label="$t('common.latitude') + ' / ' + $t('common.longitude')">
              <el-input v-model="createForm.latitude" :placeholder="$t('common.latitude')" style="width: 110px;"></el-input>
              <span style="margin: 0 8px;">/</span>
              <el-input v-model="createForm.longitud" :placeholder="$t('common.longitude')" style="width: 110px;"></el-input>
            </el-form-item>

            <el-form-item v-if="createMode !== 'multi-device-batch'" :label="$t('common.networkManagement')">
              <el-select v-model="createForm.vpcGroupId" :placeholder="$t('common.selectGroup')" clearable @change="handleVpcGroupChange" style="width: 130px;" :disabled="createForm.networkCardType === 'public' && createForm.macVlanIp">
                <el-option v-for="group in vpcGroupList" :key="group.id" :label="group.alias" :value="group.id" />
              </el-select>
              <el-select v-if="createForm.vpcGroupId && createForm.vpcSelectMode === 'specified'" v-model="createForm.vpcNodeId" :placeholder="$t('common.selectNode')" style="width: 130px; margin-left: 10px;">
                <el-option v-for="node in vpcNodeList" :key="node.id" :label="node.remarks" :value="node.id" />
              </el-select>
              <el-radio-group v-if="createForm.vpcGroupId" v-model="createForm.vpcSelectMode">
                <el-radio label="specified">{{ $t('common.specifiedNode') }}</el-radio>
                <el-radio label="random">{{ $t('common.randomNode') }}</el-radio>
              </el-radio-group>
              <!-- <div v-if="createForm.networkCardType === 'public' && createForm.macVlanIp" style="margin-top: 5px; font-size: 12px; color: var(--el-text-color-secondary);">
                提示：设置了MacVlan（公有网卡）后，网络管理选项被禁用
              </div> -->
            </el-form-item>

            <el-form-item :label="$t('common.randomSystemFiles')">
              <el-switch v-model="createForm.randomFile"></el-switch>
            </el-form-item>

            <!-- V3设备网卡选择 -->
            <template v-if="showV3Options && createMode !== 'multi-device-batch'">
              <el-form-item :label="$t('common.networkCardType')">
                <el-radio-group v-model="createForm.networkCardType" @change="handleNetworkCardTypeChange">
                  <el-radio label="private">{{ $t('common.privateNetworkCard') }}({{ $t('common.sharedIP') }})</el-radio>
                  <el-radio label="public" :disabled="isPublicNetworkDevice">{{ $t('common.publicNetworkCard') }}({{ $t('common.independentIP') }})</el-radio>
                </el-radio-group>
                
                <!-- 网卡类型功能说明 -->
                <!-- <div style="margin-top: 8px; padding: 8px 12px; background: #f5f7fa; border-radius: 4px; font-size: 12px; line-height: 1.6; color: var(--el-text-color-regular);">
                  <div style="margin-bottom: 6px;">
                    <span style="font-weight: bold; color: #409EFF;">私有网卡：</span>
                    在设备内创建独立的网关和掩码，为每个虚拟机分配该网关下的IP地址。可实现虚拟机间网络隔离，仍可使用网络管理的IP代理功能。
                  </div>
                  <div>
                    <span style="font-weight: bold; color: #67C23A;">公有网卡：</span>
                    虚拟机直接使用设备所在局域网的网关和掩码，与设备处于同一网段。虚拟机间无法实现网络隔离，且设置后将无法使用网络管理的IP代理功能。
                  </div>
                </div> -->
                
                <!-- 公有网卡 macVlan 提示 -->
                <div v-if="createForm.networkCardType === 'public' && !hasMacVlan && !fetchingNetworkCards" style="margin-top: 5px; font-size: 12px; line-height: 1.2;">
                  <span style="color: #F56C6C;">{{ $t('common.noMacVlanDetected') }}
                  </span>
                </div>
              </el-form-item>
              
              <el-form-item :label="$t('common.networkCardSelection')" v-if="createForm.networkCardType === 'private'" key="create-nic-select">
                <el-select 
                  v-model="createForm.mytBridgeName" 
                  :placeholder="$t('common.pleaseSelectNetworkCard')" 
                  :loading="fetchingNetworkCards"
                  clearable
                  filterable
                >
                  <el-option
                    v-for="item in networkCardList"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                  />
                </el-select>
              </el-form-item>
              
              <!-- MacVlan IP 输入框 -->
              <el-form-item 
                v-if="createForm.networkCardType === 'public' && hasMacVlan" 
                label="MacVlan IP"
              >
                 <el-input v-model="createForm.macVlanIp" :placeholder="getMacVlanIpPlaceholder()"></el-input>
                 
                 <!-- 批量创建时显示IP范围 -->
                 <div v-if="createForm.macVlanIp && createMode === 'batch' && ((createForm.selectedSlots ? createForm.selectedSlots.length : 1) * createForm.count) > 1" style="margin-top: 5px; font-size: 12px; color: #409EFF;">
                   <el-icon><InfoFilled /></el-icon>
                   {{ $t('common.batchCreateTip').replace('{count}', (createForm.selectedSlots ? createForm.selectedSlots.length : 1) * createForm.count).replace('{range}', calculateIpRange(createForm.macVlanIp, (createForm.selectedSlots ? createForm.selectedSlots.length : 1) * createForm.count)) }}
                 </div>
                 
                 <!-- MacVlan网络信息和注意事项 -->
                 <div style="margin-top: 8px;">
                   <div v-if="currentDeviceMacVlanInfo.subnet || currentDeviceMacVlanInfo.gw" style="font-size: 12px; color: var(--el-text-color-regular); margin-bottom: 5px;">
                     <span v-if="currentDeviceMacVlanInfo.subnet">子网: {{ currentDeviceMacVlanInfo.subnet }}</span>
                     <span v-if="currentDeviceMacVlanInfo.gw" style="margin-left: 10px;">网关: {{ currentDeviceMacVlanInfo.gw }}</span>
                   </div>
                   <el-alert 
                     type="warning" 
                     :closable="false"
                     style="padding: 8px 12px;"
                   >
                     <template #title>
                       <div style="font-size: 12px; line-height: 1.6;">
                         <div style="font-weight: bold; margin-bottom: 4px;">⚠️ 重要提示</div>
                         <div>1. 请确保起始IP在子网范围内</div>
                         <div>2. <span style="color: #F56C6C; font-weight: bold;">请务必确认IP地址未被占用</span>,否则会造成IP冲突导致无法访问</div>
                         <div>3. 批量创建时将按顺序使用连续的IP地址(需手动确保可用)</div>
                         <div v-if="createMode === 'batch' && createForm.macVlanIp">4. 当前将使用IP范围: {{ calculateIpRange(createForm.macVlanIp, (createForm.selectedSlots ? createForm.selectedSlots.length : 1) * createForm.count) }}</div>
                       </div>
                     </template>
                   </el-alert>
                 </div>
              </el-form-item>
            </template>

          </el-form>
        </div>
      </div>
    </div>
    
    <!-- 弹窗底部 -->
    <template #footer>
      <div class="create-dialog-footer">
        <el-button @click="handleCreateCancel">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleCreateSubmit">{{ $t('common.confirm') }}</el-button>
      </div>
    </template>
  </el-dialog>
  </div>
  
  <!-- 更新镜像弹窗 -->
  <el-dialog
    v-model="updateImageDialogVisible"
    :title="$t('common.updateImage')"
    width="900px"
    :before-close="handleUpdateImageCancel"
  >
    <!-- 弹窗内容 -->
    <div class="create-dialog-content">
      <!-- 容器模式 (V2) -->
      <div v-if="updateImageContainer && updateImageContainer.androidType === 'V2'" class="create-dialog-container-mode" style="padding: 0 20px;">
        <div class="create-dialog-container-mode-title">{{ $t('common.updateImageWarning') }}</div>
        <el-form :model="updateImageForm" label-width="100px">
          <el-form-item :label="$t('common.imageAddress')">
             <el-select v-model="updateImageForm.imageSelect" :placeholder="$t('common.pleaseSelect')" style="width: 100%;">
              <el-option :label="$t('common.customImage')" value="custom"></el-option>
                <el-option 
                  v-for="image in filteredContainerImagesForUpdate" 
                  :key="image.url" 
                  :label="image.name" 
                  :value="image.url"
                ></el-option>
             </el-select>
             
             <!-- 自定义镜像URL输入框 -->
             <div v-if="updateImageForm.imageSelect === 'custom'" style="margin-top: 10px;width: 100%;">
               <el-input 
                 v-model="updateImageForm.customImageUrl" 
                 :placeholder="$t('common.enterCustomImageAddress')"
                 clearable
               ></el-input>
             </div>
          </el-form-item>

          <div style="display: flex; gap: 20px;">
            <el-form-item label="名称" style="flex: 1;">
              <el-input :value="updateImageContainer ? (() => {
                const nameParts = updateImageContainer.name.split('_');
                return nameParts[nameParts.length - 1] || updateImageContainer.name;
              })() : ''" disabled></el-input>
            </el-form-item>
            <!-- <el-form-item label="云机数量" style="flex: 1;">
              <el-input-number :model-value="1" disabled style="width: 100%;"></el-input-number>
            </el-form-item> -->
          </div>

          <el-form-item label="分辨率">
             <el-select v-model="updateImageForm.resolution" placeholder="请选择" style="width: 100%;">
                <el-option label="720 X 1280" value="720x1280x320"></el-option>
                <el-option label="1080 X 1920" value="1080x1920x420"></el-option>
                <el-option label="自定义分辨率" value="custom"></el-option>
             </el-select>
             
             <!-- 自定义分辨率输入框 -->
             <div v-if="updateImageForm.resolution === 'custom'" class="custom-resolution-container" style="margin-top: 15px;">
                <div style="display: flex; gap: 20px; margin-bottom: 15px;">
                  <div style="flex: 1; display: flex; align-items: center;">
                    <label style="width: 60px; color: var(--el-text-color-regular);">设备宽</label>
                    <el-input v-model="updateImageForm.customResolution.width" style="flex: 1;"></el-input>
                  </div>
                  <div style="flex: 1; display: flex; align-items: center;">
                    <label style="width: 60px; color: var(--el-text-color-regular);">设备长</label>
                    <el-input v-model="updateImageForm.customResolution.height" style="flex: 1;"></el-input>
                  </div>
                </div>
                <div style="display: flex; gap: 20px; align-items: center;">
                  <div style="flex: 1; display: flex; align-items: center;">
                    <label style="width: 60px; color: var(--el-text-color-regular);">DPI</label>
                    <el-input v-model="updateImageForm.customResolution.dpi" style="flex: 1;"></el-input>
                  </div>
                  <div style="flex: 1; color: #f56c6c; font-size: 12px;">
                    请注意，自定义分辨率可能引发样式适配异常
                  </div>
                </div>
             </div>
          </el-form-item>

          <div style="display: flex; gap: 20px;">
            <el-form-item label="DNS 类型" style="flex: 1;">
              <el-select v-model="updateImageForm.dns" placeholder="请选择" style="width: 100%;">
                <el-option label="阿里DNS(223.5.5.5)" value="223.5.5.5"></el-option>
                <el-option label="Google(8.8.8.8)" value="8.8.8.8"></el-option>
                <el-option label="自定义" value="custom"></el-option>
              </el-select>
            </el-form-item>
            <el-form-item label="DNS 地址" style="flex: 1;">
              <el-input v-if="updateImageForm.dns === 'custom'" v-model="updateImageForm.customDns" placeholder="223.5.5.5"></el-input>
              <el-input v-else :value="updateImageForm.dns" disabled></el-input>
            </el-form-item>
          </div>
          
          <div style="display: flex; gap: 20px; align-items: center;">
            <el-form-item label="网络管理" style="flex: 1;">
              <el-select v-model="updateImageForm.vpcGroupId" placeholder="选择分组" clearable @change="handleVpcGroupChange" style="width: 130px;" :disabled="updateImageForm.networkCardType === 'public' && updateImageForm.macVlanIp">
                <el-option v-for="group in vpcGroupList" :key="group.id" :label="group.alias" :value="group.id" />
              </el-select>
              <el-select v-if="updateImageForm.vpcGroupId && updateImageForm.vpcSelectMode === 'specified'" v-model="updateImageForm.vpcNodeId" placeholder="选择节点" style="width: 130px; margin-left: 10px;">
                <el-option v-for="node in vpcNodeList" :key="node.id" :label="extractNodeDisplayName(node.remarks)" :value="node.id" />
              </el-select>
              <el-radio-group v-if="updateImageForm.vpcGroupId" v-model="updateImageForm.vpcSelectMode" style="margin-left: 10px;">
                <el-radio label="specified">指定节点</el-radio>
                <el-radio label="random">随机节点</el-radio>
              </el-radio-group>
            </el-form-item>
          </div>

          <el-form-item label="网卡类型">
            <el-radio-group v-model="updateImageForm.networkCardType" @change="handleUpdateNetworkCardTypeChange">
              <el-radio label="private">{{ $t('common.privateNetworkCard') }}({{ $t('common.sharedIP') }})</el-radio>
              <el-radio label="public" :disabled="isActiveDevicePublic">{{ $t('common.publicNetworkCard') }}({{ $t('common.independentIP') }})</el-radio>
            </el-radio-group>
            
            <!-- 网卡类型功能说明 -->
            <!-- <div style="margin-top: 8px; padding: 8px 12px; background: #f5f7fa; border-radius: 4px; font-size: 12px; line-height: 1.6; color: var(--el-text-color-regular);">
              <div style="margin-bottom: 6px;">
                <span style="font-weight: bold; color: #409EFF;">私有网卡：</span>
                在设备内创建独立的网关和掩码，为每个容器分配该网关下的IP地址。可实现容器间网络隔离，仍可使用网络管理的IP代理功能。
              </div>
              <div>
                <span style="font-weight: bold; color: #67C23A;">公有网卡：</span>
                容器直接使用设备所在局域网的网关和掩码，与设备处于同一网段。容器间无法实现网络隔离，且设置后将无法使用网络管理的IP代理功能。
              </div>
            </div> -->
            
            <div v-if="updateImageForm.networkCardType === 'public' && !hasMacVlan && !fetchingNetworkCards" style="margin-top: 5px; font-size: 12px; line-height: 1.2;">
              <span style="color: #F56C6C;">未检测到MacVlan配置，请前往网络管理-公有网卡创建</span>
            </div>
          </el-form-item>

          <el-form-item v-if="updateImageForm.networkCardType === 'private'" label="网卡选择">
            <el-select
              v-model="updateImageForm.mytBridgeName"
              placeholder="请选择网卡"
              :loading="fetchingNetworkCards"
              clearable
              filterable
              style="width: 100%;"
            >
              <el-option
                v-for="item in networkCardList"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item v-if="updateImageForm.networkCardType === 'public' && hasMacVlan" label="MacVlan IP">
            <el-input v-model="updateImageForm.macVlanIp" :placeholder="getMacVlanIpPlaceholder()"></el-input>
            
            <!-- MacVlan网络信息和注意事项 -->
            <div style="margin-top: 8px;">
              <div v-if="currentDeviceMacVlanInfo.subnet || currentDeviceMacVlanInfo.gw" style="font-size: 12px; color: var(--el-text-color-regular); margin-bottom: 5px;">
                <span v-if="currentDeviceMacVlanInfo.subnet">子网: {{ currentDeviceMacVlanInfo.subnet }}</span>
                <span v-if="currentDeviceMacVlanInfo.gw" style="margin-left: 10px;">网关: {{ currentDeviceMacVlanInfo.gw }}</span>
              </div>
              <el-alert 
                type="warning" 
                :closable="false"
                style="padding: 8px 12px;"
              >
                <template #title>
                  <div style="font-size: 12px; line-height: 1.6;">
                    <div style="font-weight: bold; margin-bottom: 4px;">⚠️ 重要提示</div>
                    <div>1. 请确保IP在子网范围内</div>
                    <div>2. <span style="color: #F56C6C; font-weight: bold;">请务必确认IP地址未被占用</span>,否则会造成IP冲突导致无法访问</div>
                  </div>
                </template>
              </el-alert>
            </div>
          </el-form-item>

          <el-form-item :label="$t('common.secureMode')">
            <el-switch v-model="updateImageForm.enforce" :active-text="$t('common.enable')" :inactive-text="$t('common.disable')" inline-prompt></el-switch>
          </el-form-item>
        </el-form>
      </div>

      <!-- 模拟器模式 (V0/V1/V3) -->
      <div v-else class="create-dialog-left-right">
        <!-- 左侧内容 -->
        <div class="create-dialog-left">
          <el-form :model="updateImageForm" label-width="100px">
            <el-form-item label="设备IP">
              <el-input :value="activeDevice ? activeDevice.ip : ''" disabled></el-input>
            </el-form-item>
            <el-form-item label="容器名称">
              <el-input :value="updateImageContainer ? (() => {
                const nameParts = updateImageContainer.name.split('_');
                return nameParts[nameParts.length - 1] || updateImageContainer.name;
              })() : ''" disabled></el-input>
            </el-form-item>
            <el-form-item label="当前镜像">
              <el-input :value="updateImageContainer ? getImageDisplayName(updateImageContainer.image) : ''" disabled></el-input>
            </el-form-item>
            <!-- V3设备显示型号选择 -->
            <!-- <el-form-item v-if="activeDevice && activeDevice.version === 'v3'" label="手机型号">
              <el-select v-model="updateImageForm.modelName" placeholder="请选择手机型号" :loading="fetchingModels" filterable>
                <el-option 
                  v-for="model in phoneModels" 
                  :key="model.id" 
                  :label="model.name" 
                  :value="model.name"
                ></el-option>
              </el-select>
            </el-form-item> -->
            <el-form-item :label="$t('common.imageSelection')">
              <el-select v-model="updateImageForm.imageSelect" @change="handleImageSelectChange" :loading="fetchingImages" style="width: 100%;" filterable>
                <el-option :label="$t('common.customImage')" value="custom"></el-option>
                <!-- 使用从API获取的镜像列表（按 os_ver 过滤） -->
                <el-option 
                  v-for="image in filteredImageListForUpdate" 
                  :key="image.url" 
                  :label="image.name" 
                  :value="image.url"
                ></el-option>
              </el-select>
            </el-form-item>
            <el-form-item v-if="updateImageForm.imageSelect === 'custom'" :label="$t('common.customImageAddress')">
              <el-input v-model="updateImageForm.customImageUrl" :placeholder="$t('common.enterImageAddress')"></el-input>
            </el-form-item>
            <el-form-item label="DNS地址">
              <el-select v-model="updateImageForm.dns" placeholder="请选择DNS地址">
                <el-option label="223.5.5.5 (阿里云)" value="223.5.5.5"></el-option>
                <el-option label="8.8.8.8 (Google)" value="8.8.8.8"></el-option>
                <el-option label="自定义" value="custom"></el-option>
              </el-select>
              <el-input v-if="updateImageForm.dns === 'custom'" v-model="updateImageForm.customDns" placeholder="输入自定义DNS地址" style="margin-top: 10px;"></el-input>
            </el-form-item>
            
            <el-form-item label="网络管理">
              <el-select v-model="updateImageForm.vpcGroupId" placeholder="选择分组" clearable @change="handleVpcGroupChange" :disabled="updateImageForm.networkCardType === 'public' && updateImageForm.macVlanIp" style="width: 130px;">
                <el-option v-for="group in vpcGroupList" :key="group.id" :label="group.alias" :value="group.id" />
              </el-select>
              <el-select v-if="updateImageForm.vpcGroupId && updateImageForm.vpcSelectMode === 'specified'" v-model="updateImageForm.vpcNodeId" placeholder="选择节点" style="width: 130px; margin-left: 10px;">
                <el-option v-for="node in vpcNodeList" :key="node.id" :label="extractNodeDisplayName(node.remarks)" :value="node.id" />
              </el-select>
              <el-radio-group v-if="updateImageForm.vpcGroupId" v-model="updateImageForm.vpcSelectMode">
                <el-radio label="specified">指定节点</el-radio>
                <el-radio label="random">随机节点</el-radio>
              </el-radio-group>
            </el-form-item>
            
            <el-form-item label="随机系统文件">
              <el-switch v-model="updateImageForm.randomFile"></el-switch>
            </el-form-item>

            <el-form-item :label="$t('common.secureMode')">
              <el-switch v-model="updateImageForm.enforce" :active-text="$t('common.enable')" :inactive-text="$t('common.disable')" inline-prompt></el-switch>
            </el-form-item>
          </el-form>
        </div>
        
        <!-- 右侧内容 -->
        <div class="create-dialog-right">
          <el-form :model="updateImageForm" label-width="100px">
            <!-- V3设备显示高级选项 -->
            <el-form-item v-if="activeDevice && activeDevice.version === 'v3'" label="高级选项">
              <el-checkbox v-model="updateImageForm.enableMagisk">启用Magisk</el-checkbox>
              <el-checkbox v-model="updateImageForm.enableGMS" style="margin-left: 20px;">启用GMS</el-checkbox>
            </el-form-item>
            <!-- V3设备网卡选择 -->
            <template v-if="activeDevice && activeDevice.version === 'v3'">
              <el-form-item label="网卡类型">
                <el-radio-group v-model="updateImageForm.networkCardType" @change="handleUpdateNetworkCardTypeChange">
                  <el-radio label="private">{{ $t('common.privateNetworkCard') }}({{ $t('common.sharedIP') }})</el-radio>
                  <el-radio label="public" :disabled="isActiveDevicePublic">{{ $t('common.publicNetworkCard') }}({{ $t('common.independentIP') }})</el-radio>
                </el-radio-group>
                
                <!-- 网卡类型功能说明 -->
                <!-- <div style="margin-top: 8px; padding: 8px 12px; background: #f5f7fa; border-radius: 4px; font-size: 12px; line-height: 1.6; color: var(--el-text-color-regular);">
                  <div style="margin-bottom: 6px;">
                    <span style="font-weight: bold; color: #409EFF;">私有网卡：</span>
                    在设备内创建独立的网关和掩码，为每个虚拟机分配该网关下的IP地址。可实现虚拟机间网络隔离，仍可使用网络管理的IP代理功能。
                  </div>
                  <div>
                    <span style="font-weight: bold; color: #67C23A;">公有网卡：</span>
                    虚拟机直接使用设备所在局域网的网关和掩码，与设备处于同一网段。虚拟机间无法实现网络隔离，且设置后将无法使用网络管理的IP代理功能。
                  </div>
                </div> -->
                
                <!-- 公有网卡 macVlan 提示 -->
                <div v-if="updateImageForm.networkCardType === 'public' && !hasMacVlan && !fetchingNetworkCards" style="margin-top: 5px; font-size: 12px; line-height: 1.2;">
                  <span style="color: #F56C6C;">
                    未检测到MacVlan配置，请前往<span style="color: #409EFF; cursor: pointer; text-decoration: underline;" @click="activeTab = 'network'; activeNetworkTab = 'public-nic'">网络管理-公有网卡</span>创建
                  </span>
                </div>
              </el-form-item>
              
              
              <el-form-item label="网卡选择" v-if="updateImageForm.networkCardType === 'private'" key="update-nic-select">
                <el-select 
                  v-model="updateImageForm.mytBridgeName" 
                  placeholder="请选择网卡" 
                  :loading="fetchingNetworkCards"
                  clearable
                  filterable
                >
                  <el-option
                    v-for="item in networkCardList"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                  />
                </el-select>
              </el-form-item>
              
              
              <!-- MacVlan IP 输入框 -->
              <el-form-item 
                v-if="updateImageForm.networkCardType === 'public' && hasMacVlan" 
                label="MacVlan IP"
              >
                 <el-input v-model="updateImageForm.macVlanIp" :placeholder="getMacVlanIpPlaceholder()"></el-input>
                 
                 <!-- MacVlan网络信息和注意事项 -->
                 <div style="margin-top: 8px;">
                   <div v-if="currentDeviceMacVlanInfo.subnet || currentDeviceMacVlanInfo.gw" style="font-size: 12px; color: var(--el-text-color-regular); margin-bottom: 5px;">
                     <span v-if="currentDeviceMacVlanInfo.subnet">子网: {{ currentDeviceMacVlanInfo.subnet }}</span>
                     <span v-if="currentDeviceMacVlanInfo.gw" style="margin-left: 10px;">网关: {{ currentDeviceMacVlanInfo.gw }}</span>
                   </div>
                   <el-alert 
                     type="warning" 
                     :closable="false"
                     style="padding: 8px 12px;"
                   >
                     <template #title>
                         <div style="font-size: 12px; line-height: 1.6;">
                         <div style="font-weight: bold; margin-bottom: 4px;">{{ $t('common.importantTip') }}</div>
                         <div>1. {{ $t('common.ensureIPInSubnet') }}</div>
                         <div>2. <span style="color: #F56C6C; font-weight: bold;">{{ $t('common.ensureIPNotUsed') }}</span>,{{ $t('common.ipConflictWarning') }}</div>
                       </div>
                     </template>
                   </el-alert>
                 </div>
              </el-form-item>
            </template>
          </el-form>
        </div>
      </div>
    </div>
    
    <!-- 弹窗底部 -->
    <template #footer>
      <div class="create-dialog-footer">
        <el-button @click="handleUpdateImageCancel">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleUpdateImageSubmit" :loading="updateImageLoading">{{ $t('common.confirm') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 批量更新镜像对话框 -->
  <el-dialog
    v-model="batchUpdateImageDialogVisible"
    :title="$t('common.batchUpdateImage')"
    width="640px"
    :close-on-click-modal="false"
  >
    <div v-for="(group, gIdx) in batchUpdateImageGroups" :key="group.groupKey" :style="{ marginBottom: gIdx < batchUpdateImageGroups.length - 1 ? '20px' : '0' }">
      <!-- 分组标题 -->
      <div style="font-weight:600;font-size:14px;color:var(--el-text-color-primary);padding:6px 0 10px 0;border-bottom:1px solid #ebeef5;margin-bottom:12px;">
        {{ group.groupLabel }}
        <span style="font-weight:400;color:var(--el-text-color-secondary);font-size:12px;margin-left:8px;">{{ $t('common.totalCloudMachines', { count: group.containers.length }) }}</span>
      </div>

      <el-form label-width="90px">
        <!-- 若同时含 V2 和 V3，让用户选择版本 -->
        <el-form-item v-if="group.hasV2 && group.hasV3" :label="$t('common.updateVersion')">
          <el-radio-group v-model="group.androidType" @change="group.selectedUrl = ''; group.customUrl = ''">
            <el-radio label="V3">{{ $t('common.v3Simulator') }}</el-radio>
            <el-radio label="V2">{{ $t('common.v2Container') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-else :label="$t('common.versionType')">
          <span style="color:var(--el-text-color-regular);">{{ group.androidType === 'V2' ? $t('common.v2Container') : $t('common.v3Simulator') }}</span>
        </el-form-item>

        <!-- V2 模式：安卓版本选择 -->
        <el-form-item v-if="group.androidType === 'V2'" :label="$t('common.androidVersion')">
          <el-radio-group v-model="group.v2AndroidVersion" @change="group.selectedUrl = ''">
            <el-radio :label="10">Android 10</el-radio>
            <el-radio v-if="!isBatchImagePSeries(group.deviceName)" :label="12">Android 12</el-radio>
            <el-radio :label="14">Android 14</el-radio>
          </el-radio-group>
        </el-form-item>

        <!-- 镜像选择 -->
        <el-form-item :label="$t('common.imageSelection')">
          <el-select
            v-model="group.selectedUrl"
            filterable
            style="width: 100%;"
            :placeholder="$t('common.pleaseSelectImage')"
          >
            <el-option :label="$t('common.customImage')" value="custom" />
            <template v-if="group.androidType === 'V3'">
              <el-option
                v-for="img in getBatchUpdateV3List(group.deviceName)"
                :key="img.url"
                :label="img.name"
                :value="img.url"
              />
            </template>
            <template v-else>
              <el-option
                v-for="img in getBatchUpdateV2List(group.deviceName, group.v2AndroidVersion)"
                :key="img.url"
                :label="img.name"
                :value="img.url"
              />
            </template>
          </el-select>
          <div
            v-if="group.androidType === 'V2' && getBatchUpdateV2List(group.deviceName, group.v2AndroidVersion).length === 0 && group.selectedUrl !== 'custom'"
            style="color:var(--el-text-color-secondary);font-size:12px;margin-top:4px;"
          >
            {{ $t('common.noImageForVersion') }}
          </div>
        </el-form-item>

        <!-- 自定义地址 -->
        <el-form-item v-if="group.selectedUrl === 'custom'" :label="$t('common.customAddress')">
          <el-input
            v-model="group.customUrl"
            :placeholder="$t('common.enterImageURL')"
            clearable
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div class="create-dialog-footer">
        <el-button @click="batchUpdateImageDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button
          type="primary"
          @click="executeBatchUpdateImage"
        >{{ $t('common.confirmUpdate') }}</el-button>
      </div>
    </template>
  </el-dialog>
  
  <!-- IP连接测试弹窗 -->
  <el-dialog
    v-model="ipTestVisible"
    :title="$t('common.ipTestTitle')"
    width="500px"
    center
  >
    <div class="ip-test-container">
      <el-form label-width="80px">
        <el-form-item :label="$t('common.ipAddress')">
          <el-input v-model="testIp" :placeholder="$t('common.enterIP')" size="small"></el-input>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="small" style="margin-right: 10px;" @click="ElMessage.info('功能正在开发中')">{{ $t('common.startTest') }}</el-button>
          <el-button size="small" @click="ipTestVisible = false">{{ $t('common.cancel') }}</el-button>
        </el-form-item>
      </el-form>
    </div>
  </el-dialog>
  
  <!-- 添加macvlan网络弹窗 -->
  <el-dialog
    v-model="addMacvlanDialogVisible"
    :title="$t('common.addMacvlanNetwork')"
    width="600px"
    :before-close="handleAddMacvlanCancel"
  >
    <div class="add-macvlan-content">
      <el-form :model="addMacvlanForm" label-width="120px">
        <el-form-item :label="$t('common.networkName')" required>
          <el-input v-model="addMacvlanForm.networkName" :placeholder="$t('common.enterNetworkName')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.physicalInterface')" required>
          <el-input v-model="addMacvlanForm.parentInterface" :placeholder="$t('common.enterPhysicalInterface')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.subnet')" required>
          <el-input v-model="addMacvlanForm.subnet" :placeholder="$t('common.enterSubnet')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.gateway')" required>
          <el-input v-model="addMacvlanForm.gateway" :placeholder="$t('common.enterGateway')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.ipRange')">
          <el-input v-model="addMacvlanForm.ipRange" :placeholder="$t('common.enterIPRange')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.isolationMode')">
          <el-checkbox v-model="addMacvlanForm.isPrivate">{{ $t('common.enablePrivateIsolation') }}</el-checkbox>
          <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-top: 5px;">
            {{ $t('common.isolationTip') }}
          </div>
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleAddMacvlanCancel">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleAddMacvlanSubmit" :loading="addMacvlanLoading">{{ $t('common.confirm') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 修改网络弹窗 -->
  <el-dialog
    v-model="editNetworkDialogVisible"
    :title="$t('common.editNetwork')"
    width="600px"
    :before-close="handleEditNetworkCancel"
  >
    <div class="edit-network-content">
      <el-form :model="editNetworkForm" label-width="120px">
        <el-form-item :label="$t('common.networkName')" required>
          <el-input v-model="editNetworkForm.networkName" :placeholder="$t('common.enterNetworkName')" disabled></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.subnet')" required>
          <el-input v-model="editNetworkForm.subnet" :placeholder="$t('common.enterSubnet')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.gateway')" required>
          <el-input v-model="editNetworkForm.gateway" :placeholder="$t('common.enterGateway')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.ipRange')">
          <el-input v-model="editNetworkForm.ipRange" :placeholder="$t('common.enterIPRange')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.isolationMode')">
          <el-checkbox v-model="editNetworkForm.isPrivate">{{ $t('common.enablePrivateIsolation') }}</el-checkbox>
          <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-top: 5px;">
            {{ $t('common.isolationTip') }}
          </div>
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleEditNetworkCancel">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleEditNetworkSubmit" :loading="editNetworkLoading">{{ $t('common.confirm') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- API详情对话框 -->
  <el-dialog 
    v-model="apiDetailsVisible" 
    :title="$t('common.apiDetails')" 
    width="600px"
    :close-on-click-modal="false"
    style="max-height: 600px;"
  >
    <div v-if="apiDetailsData" class="api-details-content">
      <div class="api-details-header">
        <p><strong>{{ $t('common.slot') }}:</strong> {{ apiDetailsData.slotNum }}</p>
        <p><strong>{{ $t('common.instanceName') }}:</strong> {{ apiDetailsData.instanceName }}</p>
        <p><strong>{{ $t('common.deviceIP') }}:</strong> {{ apiDetailsData.deviceIp }}</p>
        <p><strong>{{ $t('common.deviceVersion') }}:</strong> {{ apiDetailsData.deviceVersion }}</p>
      </div>
      
      <div class="api-details-table">
        <h4>{{ $t('common.portMappingInfo') }}</h4>
        <el-table :data="Object.values(apiDetailsData.portMappings)" size="small" class="port-mapping-table">
          <el-table-column prop="description" :label="$t('common.service')" width="150"></el-table-column>
          <el-table-column :label="$t('common.portMapping')" width="120">
            <template #default="{ row }">
              {{ row.originalPort }} → {{ row.mappedPort }}
            </template>
          </el-table-column>
          <el-table-column prop="url" :label="$t('common.accessAddress')" min-width="200">
            <template #default="{ row }">
              <span style="cursor: pointer; color: #409EFF;" @click="copyToClipboard(row.url)">
                {{ row.url }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      
      <div class="api-details-footer">
        <p style="color: var(--el-text-color-secondary); font-size: 12px; margin-top: 10px;">
          {{ $t('common.clickToCopy') }}
        </p>
      </div>
    </div>
    
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="apiDetailsVisible = false">{{ $t('common.close') }}</el-button>
      </span>
    </template>
  </el-dialog>

  <!-- S5代理设置弹窗 -->
  <el-dialog
    v-model="s5ProxyDialogVisible"
    :title="$t('common.setS5Proxy')"
    width="550px"
  >
    <el-form :model="s5ProxyForm" label-width="120px">
      <el-form-item :label="$t('common.cloudMachineName')">
        <el-input
          v-model="s5ProxyForm.cloudMachineName"
          :placeholder="$t('common.cloudMachineName')"
          readonly
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.s5Info')">
        <el-input
          v-model="s5ProxyForm.vpcInfo"
          :placeholder="$t('common.s5InfoFormat')"
          @blur="parseVpcInfo"
          clearable
        >
          <template #append>
            <el-button @click="parseVpcInfo">{{ $t('common.parseAndFill') }}</el-button>
          </template>
        </el-input>
        <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px;">
          {{ $t('common.s5InfoExample') }}
        </div>
      </el-form-item>
      <el-form-item :label="$t('common.s5ServerAddress')" required>
        <el-input
          v-model="s5ProxyForm.s5ServerAddress"
          :placeholder="$t('common.enterS5ServerAddress')"
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.s5Port')" required>
        <el-input
          v-model="s5ProxyForm.s5Port"
          :placeholder="$t('common.enterS5Port')"
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.username')">
        <el-input
          v-model="s5ProxyForm.username"
          :placeholder="$t('common.enterUsername')"
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.password')">
        <el-input
          v-model="s5ProxyForm.password"
          :placeholder="$t('common.enterPassword')"
          type="password"
          show-password
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.dnsMode')">
        <el-radio-group v-model="s5ProxyForm.dnsMode">
          <el-radio label="local">{{ $t('common.localDNS') }}</el-radio>
          <el-radio label="server">{{ $t('common.serverDNS') }}</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="s5ProxyDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleS5ProxySubmit" :loading="s5ProxyLoading">
          {{ s5ProxyLoading ? $t('common.submitting') : $t('common.submitNow') }}
        </el-button>
      </span>
    </template>
  </el-dialog>

  <!-- 设置VPC对话框 -->
  <el-dialog v-model="vpcSetDialogVisible" :title="$t('cloudMachine.setVpc')" width="450px" :close-on-click-modal="false">
    <div v-loading="vpcSetLoading">
      <el-form label-width="80px">
        <el-form-item :label="$t('common.selectGroup')">
          <el-select v-model="vpcSetGroupId" :placeholder="$t('common.selectGroup')" clearable style="width: 100%">
            <el-option v-for="group in vpcSetGroupList" :key="group.id" :label="group.alias" :value="group.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="vpcSetGroupId" :label="$t('common.selectNode')">
          <el-radio-group v-model="vpcSetSelectMode" style="margin-bottom: 8px;">
            <el-radio value="random">{{ $t('common.randomNode') }}</el-radio>
            <el-radio value="specified">{{ $t('common.specifiedNode') }}</el-radio>
          </el-radio-group>
          <el-select v-if="vpcSetSelectMode === 'specified'" v-model="vpcSetNodeId" :placeholder="$t('common.selectNode')" style="width: 100%">
            <el-option v-for="node in vpcSetNodeList" :key="node.id" :label="node.remarks || node.id" :value="node.id" />
          </el-select>
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <el-button @click="vpcSetDialogVisible = false">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" @click="submitVpcSet" :loading="vpcSetLoading">{{ $t('common.confirm') }}</el-button>
    </template>
  </el-dialog>

  <!-- 移动实例对话框 -->
  <el-dialog v-model="moveInstanceDialogVisible" :title="$t('cloudMachine.moveInstance')" width="420px">
    <el-form :model="moveInstanceForm" label-width="100px">
      <el-form-item :label="$t('cloudMachine.containerName')">
        <el-input v-model="moveInstanceForm.name" disabled />
      </el-form-item>
      <el-form-item :label="$t('cloudMachine.targetSlot')" required>
        <el-select v-model="moveInstanceForm.indexNum" :placeholder="$t('cloudMachine.enterTargetSlot')">
          <el-option v-for="slot in moveInstanceAvailableSlots" :key="slot" :label="slot" :value="slot" />
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('cloudMachine.startAfterMove')">
        <el-switch v-model="moveInstanceForm.start" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="moveInstanceDialogVisible = false">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" @click="submitMoveInstance" :loading="moveInstanceLoading">{{ $t('common.confirm') }}</el-button>
    </template>
  </el-dialog>

  <!-- 右键菜单 -->
  <div 
    v-if="contextMenuVisible"
    ref="contextMenuRef"
    class="context-menu"
    :style="{ left: contextMenuPosition.x + 'px', top: contextMenuPosition.y + 'px' }"
  >
  <div class="context-menu-item" @click="handleSetStream">
     <el-icon><Setting /></el-icon>
     <span>{{ $t('cloudMachine.setStream') }}</span>
   </div>
   <div class="context-menu-item" @click="handleUpdateImage">
     <el-icon><Refresh /></el-icon>
     <span>{{ $t('cloudMachine.updateImage') }}</span>
   </div>
   <div class="context-menu-item" @click="showApiDetails">
     <el-icon><InfoFilled /></el-icon>
     <span>{{ $t('cloudMachine.apiDetails') }}</span>
   </div>
   <div class="context-menu-item" @click="handleRename">
     <el-icon><Edit /></el-icon>
     <span>{{ $t('cloudMachine.renameDevice') }}</span>
   </div>
   <div class="context-menu-item" @click="handleShake">
     <el-icon><Edit /></el-icon>
     <span>{{ $t('cloudMachine.shake') }}</span>
   </div>
   <div class="context-menu-item" @click="handleGPS">
     <el-icon><Edit /></el-icon>
     <span>{{ $t('cloudMachine.setGPS') }}</span>
   </div>
   <div class="context-menu-item" @click="handleUploadGoogleCert">
     <el-icon><Edit /></el-icon>
     <span>{{ $t('cloudMachine.uploadGoogleCert') }}</span>
   </div>
   <div class="context-menu-item" @click="handleRestart">
     <el-icon><Refresh /></el-icon>
     <span>{{ $t('cloudMachine.restart') }}</span>
   </div>
   <div class="context-menu-item" @click="handleMoveInstance">
     <el-icon><Rank /></el-icon>
     <span>{{ $t('cloudMachine.moveInstance') }}</span>
   </div>
   <div class="context-menu-item" @click="handleDelete">
     <el-icon><Delete /></el-icon>
     <span>{{ $t('common.delete') }}</span>
   </div>
   <div class="context-menu-item" @click="handleShutdown">
     <el-icon><Close /></el-icon>
     <span>{{ $t('cloudMachine.shutdown') }}</span>
   </div>
   <div class="context-menu-item" @click="setS5Agent">
     <el-icon><Close /></el-icon>
     <span>{{ $t('cloudMachine.setS5Agent') }}</span>
   </div>
   <div class="context-menu-item" @click="closeS5Agent">
     <el-icon><Close /></el-icon>
     <span>{{ $t('cloudMachine.closeS5Agent') }}</span>
   </div>
   <div class="context-menu-item" @click="openVpcSetDialog">
     <el-icon><Connection /></el-icon>
     <span>{{ $t('cloudMachine.setVpc') }}</span>
   </div>
   <div class="context-menu-item" @click="handleSwitchBackup">
     <el-icon><Switch /></el-icon>
     <span>{{ $t('cloudMachine.switchBackup') }}</span>
   </div>
   <div class="context-menu-item" @click="handleFileManager">
     <el-icon><FolderOpened /></el-icon>
     <span>{{ $t('cloudMachine.fileManager') }}</span>
   </div>
   <div class="context-menu-item" @click="handleFileUpload">
     <el-icon><Upload /></el-icon>
     <span>{{ $t('cloudMachine.fileUpload') }}</span>
   </div>
   <div class="context-menu-item" @click="handleApkUpload">
     <el-icon><Upload /></el-icon>
     <span>{{ $t('cloudMachine.apkUpload') }}</span>
   </div>
   <div v-if="getCurrentContextMenuContainer()?.androidType === 'V2'" class="context-menu-item" @click="handleOneKeyNewDevice">
     <el-icon><Switch /></el-icon>
     <span>{{ $t('cloudMachine.oneKeyNewDevice') }}</span>
   </div>
   <div v-else class="context-menu-item" @click="handleSwitchModel">
     <el-icon><Switch /></el-icon>
     <span>{{ $t('cloudMachine.switchModel') }}</span>
   </div>
   <div class="context-menu-item" @click="handleResetContainer">
     <el-icon><Refresh /></el-icon>
     <span>{{ $t('cloudMachine.resetContainer') }}</span>
   </div>
  </div>
  
  <!-- 文件上传输入 -->
  <input
    ref="fileInput"
    type="file"
    style="display: none"
    @change="handleFileSelect"
  />


  <!-- 密码设置对话框 -->
  <el-dialog
    v-model="passwordDialogVisible"
    :title="$t('common.setDevicePassword')"
    width="400px"
  >
    <el-form :model="passwordForm" label-width="80px">
      <el-form-item label="密码">
        <el-input
          v-model="passwordForm.password"
          type="password"
          placeholder="请输入密码"
          show-password
        ></el-input>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="passwordDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSetPassword" :loading="passwordLoading">
          {{ passwordLoading ? '设置中...' : '确定' }}
        </el-button>
      </span>
    </template>
  </el-dialog>


  <!-- 授权同步对话框 -->
  <el-dialog
    v-model="syncAuthDialogVisible"
    :title="$t('common.syncAuthLogin')"
    width="400px"
  >
    <el-form :model="syncAuthForm" label-width="80px">
      <el-form-item :label="$t('common.username')" required>
        <el-input
          v-model="syncAuthForm.username"
          :placeholder="$t('common.enterUsername')"
          autocomplete="off"
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.password')" required>
        <el-input
          v-model="syncAuthForm.password"
          type="password"
          :placeholder="$t('common.enterPassword')"
          show-password
        ></el-input>
      </el-form-item>
      <el-form-item>
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <el-checkbox v-model="syncAuthForm.saveCredentials">{{ $t('common.rememberCredentials') }}</el-checkbox>
          <el-link type="primary" :underline="false" @click="openForgotPasswordDialog" style="font-size: 13px;">忘记密码</el-link>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleSyncAuthCancel">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleSyncAuthSubmit" :loading="syncAuthLoading">
          {{ syncAuthLoading ? $t('common.loggingIn') : $t('common.login') }}
        </el-button>
        <el-button type="success" @click="openRegisterDialog">{{ $t('common.register') }}</el-button>
      </span>
    </template>
  </el-dialog>

  <!-- 注册对话框 -->
  <el-dialog
    v-model="registerDialogVisible"
    :title="$t('common.userRegistration')"
    width="400px"
  >
    <el-form :model="registerForm" label-width="100px">
      <el-form-item :label="$t('common.phoneNumber')" required>
        <el-input
          v-model="registerForm.phone"
          :placeholder="$t('common.enterPhoneNumber')"
          autocomplete="off"
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.loginPassword')" required>
        <el-input
          v-model="registerForm.password"
          type="password"
          :placeholder="$t('common.enterLoginPassword')"
          show-password
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.confirmPassword')" required>
        <el-input
          v-model="registerForm.confirmPassword"
          type="password"
          :placeholder="$t('common.enterPasswordAgain')"
          show-password
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.phoneVerificationCode')" required>
        <div style="display: flex; gap: 10px;">
          <el-input
            v-model="registerForm.vcode"
            :placeholder="$t('common.enterVerificationCode')"
            style="flex: 1;"
          ></el-input>
          <el-button 
            @click="sendVcode" 
            :loading="sendVcodeLoading"
            :disabled="vcodeCountdown > 0"
            style="width: 120px;"
          >
            {{ vcodeCountdown > 0 ? `${vcodeCountdown}${$t('common.retryAfterSeconds')}` : $t('common.getVerificationCode') }}
          </el-button>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleRegisterCancel">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleRegisterSubmit" :loading="registerLoading">
          {{ registerLoading ? $t('common.registering') : $t('common.register') }}
        </el-button>
      </span>
    </template>
  </el-dialog>

  <!-- 忘记密码对话框 -->
  <el-dialog
    v-model="forgotPasswordDialogVisible"
    title="忘记密码"
    width="400px"
    @close="handleForgotPasswordClose"
  >
    <el-form :model="forgotPasswordForm" label-width="0">
      <el-form-item>
        <el-input
          v-model="forgotPasswordForm.phone"
          placeholder="手机号码"
          autocomplete="off"
          clearable
        ></el-input>
        <div v-if="forgotPasswordErrors.phone" class="fp-error-app">
          <el-icon style="margin-right:3px;"><WarningFilled /></el-icon>{{ forgotPasswordErrors.phone }}
        </div>
      </el-form-item>
      <el-form-item>
        <el-input
          v-model="forgotPasswordForm.newPassword"
          type="password"
          placeholder="新密码"
          show-password
          clearable
        ></el-input>
        <div v-if="forgotPasswordErrors.newPassword" class="fp-error-app">
          <el-icon style="margin-right:3px;"><WarningFilled /></el-icon>{{ forgotPasswordErrors.newPassword }}
        </div>
      </el-form-item>
      <el-form-item>
        <el-input
          v-model="forgotPasswordForm.confirmPassword"
          type="password"
          placeholder="确认新密码"
          show-password
          clearable
        ></el-input>
        <div v-if="forgotPasswordErrors.confirmPassword" class="fp-error-app">
          <el-icon style="margin-right:3px;"><WarningFilled /></el-icon>{{ forgotPasswordErrors.confirmPassword }}
        </div>
      </el-form-item>
      <el-form-item>
        <div style="display: flex; gap: 10px; width: 100%;">
          <el-input
            v-model="forgotPasswordForm.vcode"
            placeholder="手机验证码"
            style="flex: 1;"
            clearable
          ></el-input>
          <el-button
            type="primary"
            @click="sendForgotPasswordVcode"
            :loading="fpVcodeLoading"
            :disabled="fpIsCountingDown"
            style="white-space: nowrap;"
          >
            {{ fpVcodeButtonText }}
          </el-button>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <div style="width: 100%; display: flex; flex-direction: column;">
        <el-button
          type="primary"
          style="width: 100%; margin-bottom: 10px;"
          :loading="forgotPasswordLoading"
          @click="handleForgotPasswordSubmit"
        >
          {{ forgotPasswordLoading ? '重置中...' : '重置密码' }}
        </el-button>
        <div style="text-align: center; font-size: 13px; color: #666;">
          还没有账号？<el-link type="primary" :underline="false" @click="openRegisterFromForgot">立即注册</el-link>
        </div>
      </div>
    </template>
  </el-dialog>

  <!-- 文件管理器对话框 -->
  <el-dialog v-model="fileManagerVisible" :title="$t('cloudMachine.fileManager')" width="80%" top="5vh" :close-on-click-modal="false" destroy-on-close>
    <div class="file-manager-container">
      <!-- Android端 -->
      <div class="file-panel">
        <div class="file-panel-header">
          <span style="font-weight: 600;">{{ $t('common.cloudMachine') }}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <el-button size="small" @click="androidGoUp" :disabled="androidCurrentPath === '/'"><el-icon><Back /></el-icon></el-button>
            <el-input v-model="androidCurrentPath" size="small" readonly style="flex: 1;" />
            <el-button size="small" @click="fetchAndroidFiles(androidCurrentPath)">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </div>
        </div>
        <el-table :data="androidFileList" v-loading="androidFileLoading" size="small" height="400" style="width: 100%;" @row-dblclick="androidNavigate">
          <el-table-column width="30">
            <template #default="scope">
              <el-icon v-if="scope.row.isDir"><FolderOpened /></el-icon>
              <el-icon v-else><Document /></el-icon>
            </template>
          </el-table-column>
          <el-table-column prop="name" :label="$t('common.name')" show-overflow-tooltip />
          <el-table-column :label="$t('common.size')" width="100" align="right">
            <template #default="scope">
              {{ scope.row.isDir ? '-' : formatFileSize(scope.row.size) }}
            </template>
          </el-table-column>
          <el-table-column :label="$t('common.operation')" width="80" align="center">
            <template #default="scope">
              <el-button v-if="!scope.row.isDir" type="primary" size="small" link @click="downloadCloudFile(scope.row)">{{ $t('common.download') }}</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 本地端 -->
      <div class="file-panel">
        <div class="file-panel-header">
          <span style="font-weight: 600;">Windows</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <el-button size="small" @click="localGoUp" :disabled="!localCurrentPath"><el-icon><Back /></el-icon></el-button>
            <el-input v-model="localCurrentPath" size="small" style="flex: 1;" @keyup.enter="fetchLocalFiles(localCurrentPath)" />
            <el-button size="small" @click="localSelectDirectory">
              <el-icon><FolderOpened /></el-icon>
            </el-button>
            <el-button size="small" @click="fetchLocalFiles(localCurrentPath)">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </div>
        </div>
        <el-table :data="localFileList" v-loading="localFileLoading" size="small" height="400" style="width: 100%;" @row-dblclick="localNavigate">
          <el-table-column width="30">
            <template #default="scope">
              <el-icon v-if="scope.row.isDir"><FolderOpened /></el-icon>
              <el-icon v-else><Document /></el-icon>
            </template>
          </el-table-column>
          <el-table-column prop="name" :label="$t('common.name')" show-overflow-tooltip />
          <el-table-column :label="$t('common.size')" width="100" align="right">
            <template #default="scope">
              {{ scope.row.isDir ? '-' : formatFileSize(scope.row.size) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </el-dialog>

  <!-- 下载云机文件对话框 -->
  <el-dialog v-model="downloadCloudFileDialogVisible" :title="$t('common.download')" width="450px" :close-on-click-modal="false">
    <el-form label-width="100px">
      <el-form-item :label="$t('common.name')">
        <span>{{ downloadFileInfo.name }}</span>
      </el-form-item>
      <el-form-item :label="$t('cloudMachine.savePath')">
        <div style="display: flex; align-items: center; gap: 8px; width: 100%;">
          <el-input v-model="localCurrentPath" size="small" readonly style="flex: 1;" />
          <el-button size="small" @click="localSelectDirectory">
            <el-icon><FolderOpened /></el-icon>
          </el-button>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="downloadCloudFileDialogVisible = false">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" @click="submitDownloadCloudFile" :loading="downloadCloudFileLoading">{{ $t('common.confirm') }}</el-button>
    </template>
  </el-dialog>

  <!-- 共享文件选择对话框 -->
  <el-dialog
    v-model="sharedFilesDialogVisible"
    title="选择要上传的文件"
    width="600px"
  >
    <div v-loading="filesLoading" element-loading-text="加载文件中...">
      <div class="dialog-header" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <h3 style="margin: 0;">文件列表</h3>
          <el-button 
            type="text" 
            size="small" 
            @click="changeFileSort('name')"
            :class="{ 'sort-active': fileSortType === 'name' }"
          >
            名称 {{ fileSortType === 'name' ? (fileSortOrder === 'asc' ? '↑' : '↓') : '' }}
          </el-button>
          <el-button 
            type="text" 
            size="small" 
            @click="changeFileSort('time')"
            :class="{ 'sort-active': fileSortType === 'time' }"
          >
            时间 {{ fileSortType === 'time' ? (fileSortOrder === 'asc' ? '↑' : '↓') : '' }}
          </el-button>
        </div>
        <el-button type="primary" size="small" @click="openSharedDirectory">
          打开共享目录
        </el-button>
      </div>

      <!-- 上传路径说明 -->
      <div style="margin-bottom: 8px; padding: 6px 12px; background: #ecf5ff; border-radius: 4px; border: 1px solid #d9ecff; font-size: 12px; color: #409eff;">
        📤 上传完成路径: /sdcard/upload/
      </div>

      <!-- 共享目录路径设置 -->
      <div style="margin-bottom: 12px; padding: 10px 12px; background: #f5f7fa; border-radius: 4px; border: 1px solid #e4e7ed;">
        <div style="font-size: 12px; color: var(--el-text-color-regular); margin-bottom: 8px; font-weight: 500;">📂 文件来源目录</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <el-input
            v-model="singleUploadSharedDirInfo.path"
            placeholder="共享目录路径"
            size="small"
            :readonly="true"
            style="flex: 1;"
          />
          <el-button size="small" type="primary" :loading="singleUploadSharedDirLoading" @click="handleSelectSingleUploadSharedDir">
            浏览
          </el-button>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
          <el-tag v-if="singleUploadSharedDirInfo.isDefault" type="info" size="small">默认目录</el-tag>
          <el-tag v-else type="success" size="small">自定义目录</el-tag>
          <el-button
            v-if="!singleUploadSharedDirInfo.isDefault"
            type="text"
            size="small"
            style="color: var(--el-text-color-secondary); padding: 0;"
            :loading="singleUploadSharedDirLoading"
            @click="handleResetSingleUploadSharedDir"
          >
            恢复默认
          </el-button>
        </div>
      </div>

      <div v-if="sharedFileTree" class="file-tree">
        <!-- 递归渲染目录树 -->
        <div class="tree-node">
          <div class="node-checkbox">
            <el-checkbox
              :model-value="isSharedDirectoryFullySelected(sharedFileTree)"
              :indeterminate="isSharedDirectoryPartiallySelected(sharedFileTree)"
              @change="() => handleSharedNodeSelectionChange(sharedFileTree)"
            ></el-checkbox>
          </div>
          <span class="node-icon" v-if="sharedFileTree.isDir && sharedFileTree.children && sharedFileTree.children.length > 0" @click.stop="toggleNodeExpanded(sharedFileTree)">
            {{ sharedFileTree.expanded ? '▼' : '▶' }}
          </span>
          <span class="node-icon" v-else-if="sharedFileTree.isDir">
            📁
          </span>
          <span class="node-name" @click="toggleNodeExpanded(sharedFileTree)">{{ sharedFileTree.name }}</span>
        </div>
        <!-- 递归渲染子节点 -->
        <template v-if="sharedFileTree.expanded && sharedFileTree.isDir && sharedFileTree.children && sharedFileTree.children.length > 0">
          <div class="tree-children">
            <div v-for="child in sharedFileTree.children" :key="child.path">
              <div class="tree-node">
                <div class="node-checkbox" v-if="child.isDir">
                  <el-checkbox
                    :model-value="isSharedDirectoryFullySelected(child)"
                    :indeterminate="isSharedDirectoryPartiallySelected(child)"
                    @change="() => handleSharedNodeSelectionChange(child)"
                  ></el-checkbox>
                </div>
                <div class="node-checkbox" v-else>
                  <el-checkbox
                    :model-value="selectedFiles.includes(child.path)"
                    @change="(val) => handleSharedFileCheckChange(child.path, val)"
                  >{{ child.name }}</el-checkbox>
                </div>
                <span class="node-icon" v-if="child.isDir && child.children && child.children.length > 0" @click.stop="toggleNodeExpanded(child)">
                  {{ child.expanded ? '▼' : '▶' }}
                </span>
                <span class="node-icon" v-else-if="child.isDir">
                  📁
                </span>
                <span class="node-name" v-if="child.isDir" @click="toggleNodeExpanded(child)">{{ child.name }}</span>
                <span class="node-size" v-if="!child.isDir">{{ (child.size / 1024).toFixed(2) }} KB</span>
                <span class="node-date" v-if="!child.isDir">{{ new Date(child.modTime * 1000).toLocaleString() }}</span>

              </div>
              <!-- 递归渲染子目录 -->
              <template v-if="child.expanded && child.isDir && child.children && child.children.length > 0">
                <div class="tree-children">
                  <div v-for="grandchild in child.children" :key="grandchild.path">
                    <div class="tree-node">
                      <div class="node-checkbox" v-if="grandchild.isDir">
                        <el-checkbox
                          :model-value="isSharedDirectoryFullySelected(grandchild)"
                          :indeterminate="isSharedDirectoryPartiallySelected(grandchild)"
                          @change="() => handleSharedNodeSelectionChange(grandchild)"
                        ></el-checkbox>
                      </div>
                      <div class="node-checkbox" v-else>
                        <el-checkbox
                          :model-value="selectedFiles.includes(grandchild.path)"
                          @change="(val) => handleSharedFileCheckChange(grandchild.path, val)"
                        >{{ grandchild.name }}</el-checkbox>
                      </div>
                      <span class="node-icon" v-if="grandchild.isDir && grandchild.children && grandchild.children.length > 0" @click.stop="toggleNodeExpanded(grandchild)">
                        {{ grandchild.expanded ? '▼' : '▶' }}
                      </span>
                      <span class="node-icon" v-else-if="grandchild.isDir">
                        📁
                      </span>
                      <span class="node-name" v-if="grandchild.isDir" @click="toggleNodeExpanded(grandchild)">{{ grandchild.name }}</span>
                      <span class="node-size" v-if="!grandchild.isDir">{{ (grandchild.size / 1024).toFixed(2) }} KB</span>
                      <span class="node-date" v-if="!grandchild.isDir">{{ new Date(grandchild.modTime * 1000).toLocaleString() }}</span>

                    </div>
                    <!-- 递归渲染更深层次的子目录 -->
                    <template v-if="grandchild.expanded && grandchild.isDir && grandchild.children && grandchild.children.length > 0">
                      <div class="tree-children">
                        <div v-for="greatgrandchild in grandchild.children" :key="greatgrandchild.path">
                          <div class="tree-node">
                            <div class="node-checkbox" v-if="greatgrandchild.isDir">
                              <el-checkbox
                                :model-value="isSharedDirectoryFullySelected(greatgrandchild)"
                                :indeterminate="isSharedDirectoryPartiallySelected(greatgrandchild)"
                                @change="() => handleSharedNodeSelectionChange(greatgrandchild)"
                              ></el-checkbox>
                            </div>
                            <div class="node-checkbox" v-else>
                              <el-checkbox
                                :model-value="selectedFiles.includes(greatgrandchild.path)"
                                @change="(val) => handleSharedFileCheckChange(greatgrandchild.path, val)"
                              >{{ greatgrandchild.name }}</el-checkbox>
                            </div>
                            <span class="node-icon" v-if="greatgrandchild.isDir && greatgrandchild.children && greatgrandchild.children.length > 0" @click.stop="toggleNodeExpanded(greatgrandchild)">
                              {{ greatgrandchild.expanded ? '▼' : '▶' }}
                            </span>
                            <span class="node-icon" v-else-if="greatgrandchild.isDir">
                              📁
                            </span>
                            <span class="node-name" v-if="greatgrandchild.isDir" @click="toggleNodeExpanded(greatgrandchild)">{{ greatgrandchild.name }}</span>
                            <span class="node-size" v-if="!greatgrandchild.isDir">{{ (greatgrandchild.size / 1024).toFixed(2) }} KB</span>
                            <span class="node-date" v-if="!greatgrandchild.isDir">{{ new Date(greatgrandchild.modTime * 1000).toLocaleString() }}</span>

                          </div>
                          <!-- 递归渲染更深层次的子目录 -->
                          <template v-if="greatgrandchild.expanded && greatgrandchild.isDir && greatgrandchild.children && greatgrandchild.children.length > 0">
                            <div class="tree-children">
                              <div v-for="deepchild in greatgrandchild.children" :key="deepchild.path">
                                <div class="tree-node">
                                  <div class="node-checkbox" v-if="deepchild.isDir">
                                    <el-checkbox
                                      :model-value="isSharedDirectoryFullySelected(deepchild)"
                                      :indeterminate="isSharedDirectoryPartiallySelected(deepchild)"
                                      @change="() => handleSharedNodeSelectionChange(deepchild)"
                                    ></el-checkbox>
                                  </div>
                                  <div class="node-checkbox" v-else>
                                    <el-checkbox
                                      :model-value="selectedFiles.includes(deepchild.path)"
                                      @change="(val) => handleSharedFileCheckChange(deepchild.path, val)"
                                    >{{ deepchild.name }}</el-checkbox>
                                  </div>
                                  <span class="node-icon" v-if="deepchild.isDir">
                                    📁
                                  </span>
                                  <span class="node-name" v-if="deepchild.isDir">{{ deepchild.name }}</span>
                                  <span class="node-size" v-if="!deepchild.isDir">{{ (deepchild.size / 1024).toFixed(2) }} KB</span>
                                  <span class="node-date" v-if="!deepchild.isDir">{{ new Date(deepchild.modTime * 1000).toLocaleString() }}</span>
                                </div>
                              </div>
                            </div>
                          </template>
                        </div>
                      </div>
                    </template>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
      <div v-else class="no-files">
        <el-empty description="共享目录中没有文件"></el-empty>
        <el-button type="primary" style="margin-top: 16px;" @click="openSharedDirectory">
          打开共享目录
        </el-button>
      </div>
    </div>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="sharedFilesDialogVisible = false">取消</el-button>
        <el-button 
          type="primary" 
          @click="handleUploadToCloudMachine" 
          :loading="uploadLoading"
          :disabled="selectedFiles.length === 0"
        >
          {{ uploadLoading ? '上传中...' : '上传' }}
        </el-button>
         <el-button 
          type="primary" 
          @click="handleUploadRefresh" 
        >
          刷新共享文件
        </el-button>
      </span>
    </template>
  </el-dialog>

  <!-- 批量认证对话框 -->
  <el-dialog
    v-model="batchAuthDialogVisible"
    title="设备批量认证"
    width="600px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-alert
      :title="`需要对 ${batchAuthDevices.length} 个设备进行认证`"
      type="warning"
      :closable="false"
      style="margin-bottom: 16px;"
    >
      <template #default>
        <div style="font-size: 13px;">
          请为以下设备输入认证密码
        </div>
      </template>
    </el-alert>
    
    <!-- 设备列表 -->
    <div style="max-height: 400px; overflow-y: auto;">
      <el-form label-width="100px">
        <div 
          v-for="(item, index) in batchAuthDevices" 
          :key="item.device.ip"
          style="padding: 12px; margin-bottom: 12px; border: 1px solid #dcdfe6; border-radius: 4px;"
          :style="{
            borderColor: item.status === 'success' ? '#67c23a' : item.status === 'failed' ? '#f56c6c' : '#dcdfe6',
            backgroundColor: item.status === 'success' ? '#f0f9ff' : item.status === 'failed' ? '#fef0f0' : '#fff'
          }"
        >
          <!-- 设备标题 -->
          <div style="display: flex; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: bold; font-size: 14px;">设备 {{ index + 1 }}: {{ item.device.ip }}</span>
            <el-tag 
              v-if="item.status === 'verifying'" 
              type="info" 
              size="small" 
              style="margin-left: 8px;"
            >
              验证中...
            </el-tag>
            <el-tag 
              v-else-if="item.status === 'success'" 
              type="success" 
              size="small" 
              style="margin-left: 8px;"
            >
              ✓ 认证成功
            </el-tag>
            <el-tag 
              v-else-if="item.status === 'failed'" 
              type="danger" 
              size="small" 
              style="margin-left: 8px;"
            >
              ✗ 认证失败
            </el-tag>
          </div>
          
          <!-- 密码输入 -->
          <el-form-item label="密码" :required="true" style="margin-bottom: 8px;">
            <el-input
              v-model="item.password"
              type="password"
              placeholder="请输入设备密码"
              show-password
              :disabled="item.status === 'verifying' || item.status === 'success'"
              @keyup.enter="handleBatchAuthSubmit"
            >
              <template #append v-if="item.status === 'success'">
                <el-icon color="#67c23a"><CircleCheck /></el-icon>
              </template>
              <template #append v-else-if="item.status === 'failed'">
                <el-icon color="#f56c6c"><CircleClose /></el-icon>
              </template>
            </el-input>
          </el-form-item>
          
          <!-- 错误提示 -->
          <div v-if="item.status === 'failed' && item.errorMsg" style="color: #f56c6c; font-size: 12px; margin-top: 4px;">
            {{ item.errorMsg }}
          </div>
          
          <!-- 保存密码选项 -->
          <el-form-item style="margin-bottom: 0;">
            <el-checkbox 
              v-model="item.savePassword"
              :disabled="item.status === 'verifying' || item.status === 'success'"
            >
              自动保存密码
            </el-checkbox>
          </el-form-item>
        </div>
      </el-form>
    </div>
    
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleBatchAuthCancel" :disabled="batchAuthLoading">取消</el-button>
        <el-button 
          type="primary" 
          @click="handleBatchAuthSubmit" 
          :loading="batchAuthLoading"
          :disabled="batchAuthDevices.every(item => item.status === 'success')"
        >
          {{ batchAuthLoading ? '认证中...' : '确定' }}
        </el-button>
      </span>
    </template>
  </el-dialog>

  <!-- 机型切换对话框 -->
  <el-dialog
    v-model="switchModelDialogVisible"
    :title="`切换机型 - ${currentSwitchContainer?.name || ''}`"
    width="500px"
  >
    <div style="padding: 10px 0;">
      <el-form label-width="80px">
        <el-form-item label="机型来源">
          <el-radio-group v-model="switchModelType" @change="handleSwitchModelTypeChange">
            <el-radio-button label="online">线上机型</el-radio-button>
            <el-radio-button label="local">本地机型</el-radio-button>
            <el-radio-button label="backup">备份机型</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="选择机型">
          <el-select v-model="tempModelId" style="width: 100%;" placeholder="请选择要切换的机型" filterable :loading="fetchingModels || fetchingBackupModels">
            <el-option 
              v-for="model in displayedModels" 
              :key="model.id" 
              :label="model.name" 
              :value="model.id"
            ></el-option>
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.modelCountry')">
          <el-select
            v-model="switchCountryCode"
            :placeholder="$t('common.pleaseSelectModelCountry')"
            :loading="countryListLoading"
            filterable
            @focus="fetchCountryList"
          >
            <el-option
              v-for="country in countryList"
              :key="country.countryCode"
              :label="`${country.countryName} (${getCountryEnglishName(country.countryCode)})`"
              :value="country.countryCode"
            ></el-option>
          </el-select>
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="cancelSwitchModel" :disabled="switchingModel">取消</el-button>
        <el-button type="primary" @click="confirmSwitchModel" :loading="switchingModel" :disabled="switchingModel">
          {{ switchingModel ? '正在切换' : '确定' }}
        </el-button>
      </span>
    </template>
  </el-dialog>

  <!-- 设置推流弹窗 -->
  <el-dialog
    v-model="setStreamDialogVisible"
    title="设置推流"
    width="50%"
    :close-on-click-modal="false"
  >
    <el-form >
      <el-form-item label="推流类型">
        <el-select v-model="streamType" style="width: 100%;" placeholder="请选择推流类型">
          <el-option label="图片" value="image"></el-option>
          <el-option label="视频" value="video"></el-option>
          <el-option label="APP" value="app"></el-option>
          <!-- <el-option label="RTMP" value="rtmp"></el-option> -->
        </el-select>
      </el-form-item>
      
      <el-form-item v-if="streamType === 'image' || streamType === 'video'" label="文件路径">
        <el-input v-model="streamFilePath" placeholder="请选择文件" readonly>
          <template #append>
            <el-button @click="selectStreamFolder">选择文件</el-button>
          </template>
        </el-input>
        <p style="margin-top: 20px;color: red;">选择图片或视频会自动推送到设备内</p>
      </el-form-item>
      
      <el-form-item v-if="streamType === 'app'">
        <div class="qrcode-container" v-loading="qrCodeLoading" style="display: flex; flex-direction: column; align-items: center; width: 100%;">
          <h4>扫码连接</h4>
          <img v-if="qrCodeUrl" :src="qrCodeUrl" alt="连接二维码" style="width: 200px; height: 200px;" />
          <div v-else-if="!qrCodeLoading">二维码生成失败</div>
          
          <div style="margin-top: 10px;">
            <el-popover
              placement="bottom"
              :width="200"
              trigger="hover"
            >
              <template #reference>
                <el-button link type="primary">APP下载地址</el-button>
              </template>
              <div style="text-align: center;">
                <img v-if="appDownloadQrCodeUrl" :src="appDownloadQrCodeUrl" style="width: 150px; height: 150px;" />
                <div v-else>生成中...</div>
                <div style="font-size: 12px; margin-top: 5px;">扫码下载APP</div>
              </div>
            </el-popover>
          </div>
          <div style="margin-top: 10px;color: red;">
            <p>注意：推流手机必须与设备同在一个局域网内>否则无法连接</p>
            <p>使用方法：安装APP后扫码增加云机，如出现相机黑屏，请如下操作</p>
            <p>扩展服务>设置摄像头视频源>手机摄像头映射>保存</p>
          </div>
        </div>
      </el-form-item>
      
      <!-- <el-form-item v-if="streamType === 'rtmp'" label="RTMP地址">
        <el-input v-model="rtmpUrl" placeholder="请输入RTMP推流地址，如 rtmp://example.com/live/stream"></el-input>
      </el-form-item> -->
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="cancelSetStream">取消</el-button>
        <el-button type="primary" @click="confirmSetStream" :loading="setStreamLoading">确定</el-button>
      </span>
    </template>
  </el-dialog>

  <!-- 设备详情弹窗 -->
  <el-dialog
    v-model="deviceDetailsDialogVisible"
    :title="$t('common.deviceDetails')"
    :before-close="handleDeviceDetailsDialogClose"
    center
    :close-on-click-modal="true"
    :close-on-press-escape="true"
    class="device-details-dialog"
    style="--el-dialog-width: 1300px;"
    top="6vh"
  >
    <div v-if="activeDevice" class="device-details-content">
      <!-- 悬浮功能栏 -->
      <div class="floating-toolbar">
        <div class="device-info">
          <span class="device-ip-text">{{ activeDevice?.ip || $t('common.noDeviceSelected') }}</span>
          <el-button 
            type="primary" 
            size="small" 
            @click="activeDevice && (fetchAndroidContainers(activeDevice, true), fetchDeviceDetailCloudMachines())"
            :disabled="!activeDevice || loading"
            class="refresh-button"
          >
            <el-icon :class="{ 'is-rotating': loading }"><Refresh /></el-icon> {{ $t('common.refreshCloudMachines') }}
          </el-button>
          <span class="divider">|</span>
          <el-button 
            :type="currentRightTab === 'instance' ? 'primary' : 'text'" 
            size="small" 
            class="toolbar-button" 
            :class="{ active: currentRightTab === 'instance' }"
            @click="currentRightTab = 'instance'"
          >{{ $t('common.instance') }}</el-button>
          <!-- <el-button 
            :type="currentRightTab === 'image' ? 'primary' : 'text'" 
            size="small" 
            class="toolbar-button" 
            :class="{ active: currentRightTab === 'image' }"
            @click="currentRightTab = 'image'"
          >{{ $t('common.image') }}</el-button> -->
          <!-- <el-button 
            :type="currentRightTab === 'network' ? 'primary' : 'text'" 
            size="small" 
            class="toolbar-button" 
            :class="{ active: currentRightTab === 'network' }"
            @click="currentRightTab = 'network'"
          >{{ $t('common.network') }}</el-button> -->
          <el-button 
            :type="currentRightTab === 'host' ? 'primary' : 'text'" 
            size="small" 
            class="toolbar-button" 
            :class="{ active: currentRightTab === 'host' }"
            @click="currentRightTab = 'host'"
          >{{ $t('common.host') }}</el-button>
        </div>
        
        <!-- 批量操作按钮 -->
        <el-space wrap class="batch-actions">
          <template v-if="currentRightTab === 'instance'">
            <el-input
              v-model="deviceDetailSearchKeyword"
              :placeholder="$t('common.searchMachineName')"
              size="small"
              clearable
              style="width: 180px;"
              prefix-icon="Search"
            />
            <!-- <el-button @click="handleBatchAction('restart')" size="small">批量重启</el-button>
            <el-button @click="handleBatchAction('reset')" size="small">批量重置</el-button>
            <el-button @click="handleBatchAction('start')" size="small">批量启动</el-button>
            <el-button @click="handleBatchAction('shutdown')" size="small">批量关机</el-button> -->
            <!-- <el-button type="danger" @click="handleBatchAction('delete')" size="small">批量删除</el-button> -->
            <!-- <el-button type="primary" @click="handleBatchAction('new')" size="small">批量新机</el-button> -->
          </template>
          <el-button 
            v-if="currentRightTab === 'image'"
            type="info" 
            size="small" 
            @click="refreshImageList" 
            :disabled="!activeDevice || fetchingImages"
            class="refresh-button"
          >
            <el-icon :class="{ 'is-rotating': fetchingImages }"><Refresh /></el-icon> {{ $t('common.refreshImages') }}
          </el-button>
          <el-button 
            v-if="currentRightTab === 'network'"
            type="info" 
            size="small" 
            @click="activeDevice && fetchDockerNetworks(activeDevice)" 
            :disabled="!activeDevice || dockerNetworksLoading"
            class="refresh-button"
          >
            <el-icon :class="{ 'is-rotating': dockerNetworksLoading }"><Refresh /></el-icon> {{ $t('common.refreshNetworkList') }}
          </el-button>
          <!-- 🔧 移除刷新主机信息按钮，使用心跳机制自动更新 -->
        </el-space>
      </div>
      
      <!-- 右侧内容区域，根据标签页切换显示不同内容 -->
      <!-- 实例标签页 -->
      <div v-if="currentRightTab === 'instance'" class="table-container" style="padding-bottom: 20px;">
        <el-table 
          :data="deviceDetailGroupedInstances" 
          stripe 
          size="small" 
          class="slot-table"
          :tree-props="{ children: '_children', hasChildren: 'hasChildren' }"
          row-key="id"
        >
          <el-table-column :label="$t('common.slot')" width="140" align="center">
            <template #default="scope">
              <div class="slot-cell-content">
                <span class="slot-number">
                  <!-- <el-button 
                    v-if="scope.row.showFoldButton"
                    size="mini" 
                    type="text"
                    class="fold-button"
                  >
                  </el-button> -->
                  {{ scope.row.slotNum }}
                </span>
                <el-button 
                  v-if="scope.row.isFirstInSlot"
                  size="mini" 
                  type="primary" 
                  @click="showCreateDialog(activeDevice, 'slot', scope.row.slotNum)"
                  class="create-button"
                  :disabled="!activeDevice"
                >
                  {{ $t('common.create') }}
                </el-button>
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="$t('common.instanceName')" width="110">
            <template #default="scope">
              {{ formatInstanceName(scope.row.name) }}
            </template>
          </el-table-column>
          <el-table-column prop="ip" :label="$t('common.ipAddress')" width="130"></el-table-column>
          <el-table-column :label="$t('common.systemImage')" width="200" align="center">
            <template #default="scope">
              <div 
                style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
                :title="getImageDisplayName(scope.row.image)"
              >
                {{ getImageDisplayName(scope.row.image) }}
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="$t('common.createTime')" width="160">
            <template #default="scope">
              {{ scope.row.created ? new Date(scope.row.created).toLocaleString('zh-CN') : scope.row.createTime }}
            </template>
          </el-table-column>
          <el-table-column prop="status" :label="$t('common.status')" width="140" align="center">
            <template #default="scope">
              <el-tag
                :type="scope.row.status === 'running' ? 'success' : scope.row.status === 'restarting' ? 'warning' : 'info'"
                size="small"
                class="status-tag-normal"
              >
                {{ scope.row.status === 'running' ? $t('common.running') : (scope.row.status === 'shutdown' || scope.row.status === 'exited') ? $t('common.shutdown') : scope.row.status === 'created' ? $t('common.created') : $t('common.restarting') }}
              </el-tag>
              <el-tag
                v-if="slotStates[scope.row.slotNum] && slotStates[scope.row.slotNum].state === 1"
                type="warning"
                size="small"
                style="margin-left: 4px;"
              >{{ $t('common.expiringSoon') }}</el-tag>
              <el-tag
                v-if="slotStates[scope.row.slotNum] && slotStates[scope.row.slotNum].state === 2"
                type="danger"
                size="small"
                style="margin-left: 4px;"
              >{{ $t('common.expired') }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="modelName" :label="$t('common.model')" width="140">
              <template #default="scope">
              {{ formatInstanceModel(scope.row.modelPath) || $t('common.none') }}
            </template>
          </el-table-column>
          <el-table-column :label="$t('common.operation')" width="200" fixed="right" align="center">
            <template #default="scope">
              <el-space size="mini" wrap>
                <el-button
                  v-if="!(slotStates[scope.row.slotNum] && slotStates[scope.row.slotNum].state === 2) || scope.row.status === 'running'"
                  size="mini"
                  :type="scope.row.status === 'running' ? 'warning' : 'success'"
                  @click="() => {
                    // 检查是否为空坑位（没有云机）
                    if (!scope.row.name || scope.row.name === '') {
                      ElMessage.warning($t('common.slotNoMachine').replace('{slot}', scope.row.slotNum));
                      return;
                    }
                    // 已到期云机不允许开机（强制关机）
                    if (scope.row.status !== 'running' && slotStates[scope.row.slotNum] && slotStates[scope.row.slotNum].state === 2) {
                      ElMessage.warning($t('common.expiredCannotStart'));
                      return;
                    }

                    const action = scope.row.status === 'running' ? $t('common.shutdown') : $t('common.startUp');
                    ElMessageBox.confirm($t('common.confirmAction').replace('{action}', action).replace('{name}', scope.row.name), $t('common.operationConfirm'), {
                      confirmButtonText: $t('common.confirm'),
                      cancelButtonText: $t('common.cancel'),
                      type: 'warning'
                    }).then(async () => {
                      try {
                        if (scope.row.status === 'running') {
                          await stopContainer(activeDevice, scope.row.name);
                        } else {
                          await startContainer(activeDevice, scope.row.name);
                        }
                        ElMessage.success($t('common.actionSuccess').replace('{action}', action));
                        await fetchDeviceDetailCloudMachines();
                      } catch (error) {
                        ElMessage.error($t('common.actionFailed').replace('{action}', action).replace('{error}', error.message));
                      }
                    }).catch(() => {});
                  }"
                >
                  {{ scope.row.status === 'running' ? $t('common.shutdown') : $t('common.startUp') }}
                </el-button>
                <el-button 
                  size="mini" 
                  type="danger"
                  @click="() => {
                    // 检查是否为空坑位（没有云机）
                    if (!scope.row.name || scope.row.name === '') {
                      ElMessage.warning($t('common.slotCannotDelete').replace('{slot}', scope.row.slotNum));
                      return;
                    }
                    handleDeviceDetailDeleteContainer(scope.row);
                  }"
                >
                  {{ $t('common.delete') }}
                </el-button>
                <template v-if="scope.row.status === 'running'">
                  <el-button
                    size="mini"
                    type="primary"
                    @click="() => { try { startProjection({ ip: scope.row.networkName == 'myt' ? scope.row.ip : activeDevice?.ip }, scope.row) } catch (error) { console.error('打开投屏失败:', error) } }"
                  >
                    {{ $t('common.openProjection') }}
                  </el-button>
                </template>
                <el-button
                  size="mini"
                  type="info"
                  @click="showUpdateImageDialog(scope.row)"
                >
                  {{ $t('common.updateImage') }}
                </el-button>
              </el-space>
            </template>
          </el-table-column>
        </el-table>
      </div>
      
      <!-- 主机标签页 -->
      <div v-if="currentRightTab === 'host'" class="host-info-container">
        <el-card shadow="hover" class="host-info-card">
          
          
          <div v-if="activeDevice" class="host-info-content">
            <!-- 基本信息 -->
            <el-descriptions :title="$t('common.basicInfo')" :column="2" border>
              <el-descriptions-item :label="$t('common.hostName')">{{ activeDevice.name }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.hostIP')">{{ activeDevice.ip }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.deviceID')">{{ (activeDevice.version === 'v3' && v3DeviceInfo.originalData?.deviceId) ? v3DeviceInfo.originalData.deviceId : activeDevice.id }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.deviceVersion')">{{ activeDevice.version }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.firmwareVersion')">{{ v3DeviceInfo.originalData?.version || $t('common.loading') }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.modelVersion')">{{ v3DeviceInfo.originalData?.model || $t('common.loading') }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.deviceUptime')">{{ v3DeviceUptimeMinutes }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.cpuTemp')">{{ v3DeviceInfo.originalData?.cputemp || $t('common.loading') }}°C</el-descriptions-item>
              <el-descriptions-item :label="$t('common.cpuLoad')">{{ v3DeviceInfo.originalData?.cpuload || $t('common.loading') }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.memoryTotal')">{{ formatSize(v3DeviceInfo.originalData?.memtotal) }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.memoryUsed')">{{ formatSize(v3DeviceInfo.originalData?.memuse) }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.diskTotal')">{{ formatSize(v3DeviceInfo.originalData?.mmctotal) }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.diskUsed')">{{ formatSize(v3DeviceInfo.originalData?.mmcuse) }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.diskModel')">{{ v3DeviceInfo.originalData?.mmcmodel || $t('common.loading') }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.diskTemp')">{{ v3DeviceInfo.originalData?.mmctemp || $t('common.loading') }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.diskRead')">{{ v3DeviceInfo.originalData?.mmcread || $t('common.loading') }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.diskWrite')">{{ v3DeviceInfo.originalData?.mmcwrite || $t('common.loading') }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.networkIP')">{{ v3DeviceInfo.originalData?.ip || $t('common.loading') }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.macAddress')">{{ v3DeviceInfo.originalData?.hwaddr || $t('common.loading') }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.networkSpeed')">{{ v3DeviceInfo.originalData?.speed || $t('common.loading') }}</el-descriptions-item>
              <el-descriptions-item :label="$t('common.eth0Network')">{{ v3DeviceInfo.originalData?.netWork_eth0 || $t('common.loading') }}</el-descriptions-item>
            </el-descriptions>
            
            <!-- V3设备额外信息 -->
            <div v-if="activeDevice.version === 'v3'" class="v3-info-section">
          
              
              <!-- 密码管理功能 -->
              <div class="password-section" style="margin-top: 20px;">
                <el-divider>{{ $t('common.passwordManagement') }}</el-divider>
                <el-space>
                  <el-button 
                    type="primary" 
                    size="small" 
                    @click="showPasswordDialog"
                    :disabled="!activeDevice"
                  >
                    {{ $t('common.setPassword') }}
                  </el-button>
                  <el-button 
                    type="warning" 
                    size="small" 
                    @click="handleClosePassword"
                    :disabled="!activeDevice"
                  >
                    {{ $t('common.closePassword') }}
                  </el-button>
                  <span class="password-hint" style="color: var(--el-text-color-regular); font-size: 12px;">
                    {{ $t('common.passwordHint') }}
                  </span>
                </el-space>
              </div>

              <div style="text-align: end;">
                <el-button type="warning" size="small" @click="handleCleanDisk">
                  {{ $t('common.cleanDiskData') }}
                </el-button>
                <el-button type="danger" size="small" @click="handleRebootDevice">
                  {{ $t('common.rebootDevice') }}
                </el-button>
              </div>
              
              <!-- SDK升级功能 - 不在设备详情页面显示 -->
              <div v-if="showUpgradeButton && !isViewingDeviceDetails" class="upgrade-section">
                <el-divider>{{ $t('common.sdkUpgrade') }}</el-divider>
                <el-space>
                  <span>{{ $t('common.currentSDKVersion') }}: {{ v3LatestInfo.originalData?.currentVersion }}</span>
                  <span>{{ $t('common.latestSDKVersion') }}: {{ v3LatestInfo.originalData?.latestVersion }}</span>
                  <el-button 
                    type="primary" 
                    @click="upgradeSDK"
                    :loading="upgrading"
                    :disabled="upgrading"
                  >
                    <template v-if="upgrading && upgradeProgress > 0">
                      {{ $t('common.upgrading') }} ({{ upgradeProgress.toFixed(1) }}%)
                    </template>
                    <template v-else>
                      {{ $t('common.upgradeSDK') }}
                    </template>
                  </el-button>
                </el-space>
              </div>
            </div>
          </div>
          
          <div v-else class="no-device-selected">
            <el-empty :description="$t('common.selectDeviceFirst')" :image-size="100"></el-empty>
          </div>
        </el-card>
      </div>
      
      <!-- 网络标签页 -->
      <div v-if="currentRightTab === 'network'" class="network-info-container">
        <el-card shadow="hover" class="network-info-card">
          <template #header>
            <div class="card-header">
              <span>Docker网络列表</span>
              <el-space>
                <el-button 
                  type="primary" 
                  size="small" 
                  @click="showAddMacvlanDialog()" 
                  :disabled="!activeDevice"
                >
                  <el-icon><Plus /></el-icon> 添加macvlan网络
                </el-button>
              </el-space>
            </div>
          </template>
          
          <div v-if="activeDevice" class="network-info-content">
            <!-- 加载状态 -->
            <div v-if="dockerNetworksLoading" class="network-loading">
              <el-skeleton :rows="5" animated></el-skeleton>
            </div>
            <!-- 错误状态 -->
            <div v-else-if="dockerNetworksError" class="network-error">
              <el-alert
                title="加载失败"
                :description="dockerNetworksError"
                type="error"
                show-icon
              ></el-alert>
            </div>
            
            <!-- 网络列表 -->
            <div v-else-if="dockerNetworks.length > 0" class="table-container">
              <el-table :data="dockerNetworks" stripe size="small" class="network-table">
                  <el-table-column prop="Name" label="网络名称" width="180"></el-table-column>
                  <el-table-column prop="ID" label="网络ID" width="120"></el-table-column>
                  <el-table-column label="网段" width="150">
                    <template #default="scope">
                      <span v-if="scope.row.IPAM?.Config?.[0]?.Subnet">{{ scope.row.IPAM.Config[0].Subnet }}</span>
                      <span v-else>无</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="Driver" label="驱动" width="100"></el-table-column>
                  <el-table-column prop="Scope" label="范围" width="100"></el-table-column>
                  <el-table-column label="网关" width="150">
                    <template #default="scope">
                      <span v-if="scope.row.IPAM?.Config?.[0]?.Gateway">{{ scope.row.IPAM.Config[0].Gateway }}</span>
                      <span v-else>无</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="IP范围" width="150">
                    <template #default="scope">
                      <span v-if="scope.row.IPAM?.Config?.[0]?.IPRange">{{ scope.row.IPAM.Config[0].IPRange }}</span>
                      <span v-else>无</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="Containers" label="容器数量" width="120">
                    <template #default="scope">
                      <span>{{ Object.keys(scope.row.Containers || {}).length }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="Internal" label="私有" width="80">
                    <template #default="scope">
                      <el-tag v-if="scope.row.Internal" type="danger" size="small">是</el-tag>
                      <el-tag v-else type="success" size="small">否</el-tag>
                    </template>
                  </el-table-column>
              </el-table>
            </div>
            <!-- 空状态 -->
            <div v-else class="network-empty">
              <el-empty description="暂无网络信息" :image-size="100"></el-empty>
            </div>
          </div>
          
          <div v-else class="no-device-selected">
            <el-empty description="请先选择设备" :image-size="100"></el-empty>
          </div>
        </el-card>
      </div>
      
      <!-- 镜像标签页 -->
      <div v-if="currentRightTab === 'image'" class="image-list-container">
        <div v-if="activeDevice" class="image-list-content">
          <div v-if="isLoadingBoxImages" class="image-loading">
            <el-skeleton :rows="5" animated></el-skeleton>
          </div>
          <div v-else-if="matchedBoxImages.length === 0" class="no-images">
            <el-empty description="暂无已下载镜像信息" :image-size="100"></el-empty>
          </div>
          <div v-else class="image-items">
            <div v-for="(image, index) in matchedBoxImages" :key="index" class="image-item">
              <el-card shadow="hover" class="image-card">
                <template #header>
                  <div class="card-header">
                    <span>{{ image.onlineImageName }}</span>
                    <el-button
                      type="danger"
                      size="small"
                      @click="handleDeleteImage(image)"
                      class="delete-button"
                    >
                    <el-icon><Delete /></el-icon> 删除
                    </el-button>
                  </div>
                </template>
                <div class="image-info">
                  <div class="image-details">
                    <p>线上镜像名称: {{ image.onlineImageName }}</p>
                    <p>镜像大小: {{ image.size }}</p>
                    <p>创建时间: {{ image.createTime }}</p>
                    <p v-if="image.matched" style="color: #67c23a;">✓ 已与线上镜像匹配</p>
                    <p v-else style="color: var(--el-text-color-secondary);">✗ 未与线上镜像匹配</p>
                    <p v-if="image.matched" style="font-size: 12px; color: var(--el-text-color-secondary);">线上URL: {{ image.onlineImageUrl }}</p>
                    <p v-else style="font-size: 12px; color: var(--el-text-color-secondary);">设备中URL: {{ image.url }}</p>
                  </div>
                </div>
              </el-card>
            </div>
          </div>
        </div>
        
        <div v-else class="no-device-selected">
          <el-empty description="请先选择设备" :image-size="100"></el-empty>
        </div>
      </div>
    </div>
    
    <div v-else class="no-device-selected">
      <el-empty description="请先选择设备" :image-size="100"></el-empty>
    </div>
  </el-dialog>

  <!-- 终端相关HTML结构 -->
  <div id="login-overlay" style="display: none;">
    <div class="login-box">
      <h2 style="text-align:center">Docker Console</h2>
      <div class="form-group">
        <label>容器 ID 或 名称</label>
        <input type="text" id="containerId" placeholder="例如: T1001">
      </div>
      <div class="form-group">
        <label>Shell 程序</label>
        <select id="shell">
          <option value="/bin/sd">/bin/sd</option>
          <option value="/bin/bash">/bin/bash</option>
          <option value="/bin/sh">/bin/sh</option>
        </select>
      </div>
      <button class="btn" onclick="connectDocker()">连 接</button>
    </div>
  </div>

  <div id="terminal"></div>

  <!-- 批量切换机型对话框 -->
  <el-dialog
    v-model="batchSwitchModelDialogVisible"
    title="批量新机"
    width="900px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :before-close="handleBatchSwitchModelCancel"
  >
    <!-- 切换机型时的加载覆盖层 -->
    <div 
      v-if="batchSwitchingModel" 
      class="switching-model-overlay"
    >
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>切换机型中...</span>
    </div>
    
    <div class="batch-switch-model-content">
      <!-- 左侧：坑位列表 -->
      <div class="slots-section" style="width: 30%; float: left; margin-right: 20px;">
        <h3 style="margin-bottom: 10px;">可选坑位</h3>
        <div class="available-slots">
          <div 
            v-for="target in batchSwitchModelTargets" 
            :key="target.id || target.indexNum"
            class="slot-item"
            :class="{ 
              'dragging': draggingSlot === target.id || draggingSlot === target.indexNum,
              'v2-container': target.androidType === 'V2'
            }"
            :draggable="target.androidType !== 'V2'"
            @dragstart="handleSlotDragStart($event, target)"
            @dragover.prevent
            @dragenter.prevent
            @drop="handleSlotDropInAvailableArea($event, target)"
            :title="target.androidType === 'V2' ? 'V2容器只能使用随机机型' : ''"
          >
            <!-- {{ cloudManageMode === 'slot' ? `坑位${target.indexNum}` : `云机${target.ip}` }} -->
              {{ formatInstanceName(target.name) }}
              <span v-if="target.androidType === 'V2'" style="color: #F56C6C; font-size: 10px; margin-left: 4px;">(V2)</span>
          </div>
        </div>
      </div>
      
      <!-- 右侧：机型分配区域 -->
      <div class="models-section" style="width: 65%; float: right;">
        <div class="models-header" style="display: flex; justify-content: space-between; margin-bottom: 16px;">
          <h3>机型分配</h3>
          <div class="models-actions">
            <el-button 
              type="primary" 
              @click="addNewModelSlot('online')"
              :disabled="batchSwitchingModel"
            >
              添加线上
            </el-button>
            <el-button 
              type="primary" 
              @click="addNewModelSlot('local')"
              :disabled="batchSwitchingModel"
            >
              添加本地
            </el-button>
            <el-button 
              type="primary" 
              @click="addNewModelSlot('backup')"
              :disabled="batchSwitchingModel"
            >
              添加备份
            </el-button>
          </div>
        </div>
        
        <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;"><span style="font-size: 13px; white-space: nowrap;">地区选择:</span><el-select v-model="batchSwitchCountryCode" placeholder="选择国家" :loading="countryListLoading" filterable size="small" style="width: 260px;" @focus="fetchCountryList"><el-option v-for="country in countryList" :key="country.countryCode" :label="`${country.countryName} (${getCountryEnglishName(country.countryCode)})`" :value="country.countryCode"></el-option></el-select></div>
        <!-- 机型列表 -->
        <div class="model-slots-container">
          <!-- 确保至少显示一个机型分配槽 -->
          <div 
            v-for="(modelSlot, index) in modelSlots" 
            :key="index"
            class="model-slot"
            @dragover.prevent
            @dragenter.prevent
            @drop="handleSlotDropInModelSlot($event, index)"
          >
            <div class="model-slot-header">
              <div class="model-selector">
                <el-select 
                  v-model="modelSlot.modelId" 
                  :placeholder="modelSlot.type === 'local' ? '选择本地机型' : (modelSlot.type === 'backup' ? '选择备份机型' : '选择线上机型')" 
                  style="width: 200px;"
                  :disabled="batchSwitchingModel"
                >
                  <!-- 添加随机选项 -->
                  <el-option 
                    label="随机" 
                    value="random"
                  >
                    <div style="display: flex; justify-content: space-between;">
                      <span>随机</span>
                      <span style="color: var(--el-text-color-secondary); font-size: 12px;">random</span>
                    </div>
                  </el-option>
                  
                  <!-- 线上机型 -->
                  <template v-if="!modelSlot.type || modelSlot.type === 'online'">
                    <el-option 
                      v-for="model in filteredPhoneModelsForBatch"
                      :key="model.id"
                      :label="model.name"
                      :value="model.id"
                    >
                      <div style="display: flex; justify-content: space-between;">
                        <span>{{ model.name }}</span>
                        <span style="color: var(--el-text-color-secondary); font-size: 12px;">{{ model.id }}</span>
                      </div>
                    </el-option>
                  </template>

                  <!-- 本地机型 -->
                  <template v-else-if="modelSlot.type === 'local'">
                    <el-option 
                      v-for="model in localPhoneModels" 
                      :key="model.name" 
                      :label="model.name" 
                      :value="model.name"
                    >
                      <div style="display: flex; justify-content: space-between;">
                        <span>{{ model.name }}</span>
                      </div>
                    </el-option>
                  </template>

                  <!-- 备份机型 -->
                  <template v-else-if="modelSlot.type === 'backup'">
                    <el-option 
                      v-for="model in backupPhoneModels" 
                      :key="model.name" 
                      :label="model.name" 
                      :value="model.name"
                    >
                      <div style="display: flex; justify-content: space-between;">
                        <span>{{ model.name }}</span>
                      </div>
                    </el-option>
                  </template>
                </el-select>
                
                <!-- 显示机型类型标签 -->
                <el-tag 
                  size="small" 
                  :type="!modelSlot.type || modelSlot.type === 'online' ? 'primary' : (modelSlot.type === 'local' ? 'success' : 'warning')"
                  style="margin-left: 10px;"
                >
                  {{ !modelSlot.type || modelSlot.type === 'online' ? '线上机型' : (modelSlot.type === 'local' ? '本地机型' : '备份机型') }}
                </el-tag>
              </div>
              <div class="model-actions">
                <el-button 
                  type="danger" 
                  size="mini" 
                  @click="removeModelSlot(index)"
                  :disabled="batchSwitchingModel || modelSlots.length <= 1"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
            
            <div class="assigned-slots">
              <div 
                v-for="assignedSlot in modelSlot.assignedSlots" 
                :key="assignedSlot.id || assignedSlot.indexNum"
                class="assigned-slot-item"
                :class="{ 'v2-container': assignedSlot.androidType === 'V2' }"
                :draggable="assignedSlot.androidType !== 'V2'"
                @dragstart="handleSlotDragStart($event, assignedSlot)"
                :title="assignedSlot.androidType === 'V2' ? 'V2容器只能使用随机机型' : ''"
              >
                <!-- {{ cloudManageMode === 'slot' ? `坑位${assignedSlot.indexNum}` : `云机${assignedSlot.ip}` }} -->
                  {{ formatInstanceName(assignedSlot.name) }}
                  <span v-if="assignedSlot.androidType === 'V2'" style="color: #F56C6C; font-size: 10px; margin-left: 4px;">(V2)</span>
              </div>
              <div v-if="modelSlot.assignedSlots.length === 0" class="no-slots-assigned">
                拖放坑位到此处
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleBatchSwitchModelCancel" :disabled="batchSwitchingModel">
          取消
        </el-button>
        <el-button type="primary" @click="confirmBatchSwitchModel" :disabled="batchSwitchingModel || !isModelSlotsValid">
          确定
        </el-button>
      </span>
    </template>
  </el-dialog>

  <!-- 更新提示弹窗 -->
  <UpdateDialog
    v-model:visible="updateDialogVisible"
    :update-info="updateInfo"
  />

  <!-- 设置MacVlanIP对话框 -->
  <el-dialog
    v-model="macVlanDialogVisible"
    title="设置MacVlanIP"
    width="400px"
  >
    <el-form :model="macVlanForm" label-width="100px">
      <el-form-item label="容器名称">
        <el-input v-model="macVlanForm.name" disabled></el-input>
      </el-form-item>
      <el-form-item label="MacVlanIP" required>
        <el-input v-model="macVlanForm.ip" placeholder="请输入MacVlanIP"></el-input>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="macVlanDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="confirmSetMacVlanIP" :loading="macVlanLoading">
          {{ $t('common.confirm') }}
        </el-button>
      </span>
    </template>
  </el-dialog>

  <!-- GPS定位设置弹窗 -->
  <el-dialog
    v-model="gpsDialogVisible"
    :title="$t('common.setIPLocation')"
    width="400px"
    :close-on-click-modal="false"
  >
    <el-form :model="gpsForm" label-width="80px">
      <el-form-item :label="$t('common.locationIP')">
        <el-input v-model="gpsForm.ip" :placeholder="$t('common.leaveEmptyForCurrentIP')"></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.countryRegion')">
        <el-select v-model="gpsForm.country" :placeholder="$t('common.pleaseSelectCountryRegion')" filterable>
          <el-option
            v-for="(info, code) in countryMap"
            :key="code"
            :label="`${info.name} (${info.en})`"
            :value="code"
          >
            <span style="float: left">{{ info.name }} ({{ info.en }})</span>
            <span style="float: right; color: #8492a6; font-size: 13px">{{ code }}</span>
          </el-option>
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="gpsDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submitGPS" :loading="gpsLoading">
          {{ $t('common.confirm') }}
        </el-button>
      </span>
    </template>
  </el-dialog>

  <!-- 上传 Google 证书弹窗 -->
  <el-dialog
    v-model="googleCertDialogVisible"
    :title="$t('common.uploadGoogleCert')"
    width="460px"
    :close-on-click-modal="false"
  >
    <!-- 隐藏的文件选择 input，仅接受 pem / xml -->
    <input
      ref="googleCertInputRef"
      type="file"
      accept=".pem,.xml"
      style="display: none"
      @change="onGoogleCertFileChange"
    />

    <div style="padding: 8px 0;">
      <div style="margin-bottom: 12px; color: var(--el-text-color-regular); font-size: 13px;">
        {{ $t('common.supportedFormats') }}：<strong>.pem</strong>、<strong>.xml</strong>
      </div>

      <!-- 文件选择区 -->
      <div
        style="
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          border: 1px dashed #d9d9d9;
          border-radius: 6px;
          background: #fafafa;
          cursor: pointer;
        "
        @click="triggerGoogleCertInput"
      >
        <el-icon :size="22" style="color: #409eff; flex-shrink: 0;"><Upload /></el-icon>
        <span
          v-if="googleCertFileName"
          style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--el-text-color-primary); font-size: 14px;"
        >{{ googleCertFileName }}</span>
        <span v-else style="flex: 1; color: #aaa; font-size: 14px;">{{ $t('common.clickToSelectCert') }}</span>
        <el-button
          v-if="googleCertFileName"
          type="primary"
          link
          size="small"
          style="flex-shrink: 0;"
          @click.stop="triggerGoogleCertInput"
        >{{ $t('common.reselect') }}</el-button>
      </div>
    </div>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="googleCertDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button
          type="primary"
          @click="submitGoogleCert"
          :loading="googleCertLoading"
          :disabled="!googleCertFileName"
        >
          {{ googleCertLoading ? $t('common.uploading') : $t('common.confirmUpload') }}
        </el-button>
      </span>
    </template>
  </el-dialog>

  <!-- ===== 设置弹窗 ===== -->
  <el-dialog
    v-model="settingsDialogVisible"
    :title="$t('common.settings')"
    width="500px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div style="padding: 8px 0;">
      <div style="margin-bottom: 20px;">
        <div style="font-weight: bold; margin-bottom: 12px; color: var(--el-text-color-primary); font-size: 14px;">
          文件保存路径
        </div>
        <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 12px; line-height: 1.6;">
          设置下载镜像、本地机型、备份机型、备份云机等文件的保存位置。<br>
          默认保存在 C 盘系统目录，建议修改到其他磁盘以避免 C 盘空间不足。
        </div>

        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <el-input
            v-model="storagePathInfo.path"
            placeholder="请选择或输入保存路径"
            style="flex: 1;"
            :readonly="true"
          >
            <template #prefix>
              <el-icon><FolderOpened /></el-icon>
            </template>
          </el-input>
          <el-button
            type="primary"
            :loading="settingsLoading"
            @click="handleSelectDirectory"
          >
            浏览
          </el-button>
        </div>

        <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
          <el-tag v-if="storagePathInfo.isDefault" type="info" size="small">当前为默认路径</el-tag>
          <el-tag v-else type="success" size="small">已自定义路径</el-tag>
          <el-button
            v-if="!storagePathInfo.isDefault"
            type="text"
            size="small"
            style="color: var(--el-text-color-secondary);"
            @click="handleResetStoragePath"
            :loading="settingsLoading"
          >
            恢复默认
          </el-button>
        </div>

        <div v-if="storagePathInfo.defaultPath" style="margin-top: 10px; font-size: 12px; color: var(--el-text-color-placeholder);">
          默认路径：{{ storagePathInfo.defaultPath }}
        </div>

        <el-alert
          title="修改保存路径后，已有文件不会自动迁移，请手动将旧目录中的文件复制到新路径。"
          type="warning"
          show-icon
          :closable="false"
          style="margin-top: 12px;"
        />
      </div>

      <!-- APK自动授权设置 -->
      <div style="margin-bottom: 20px;">
        <div style="font-weight: bold; margin-bottom: 12px; color: var(--el-text-color-primary); font-size: 14px;">
          {{ t('common.autoGrantApkPermission') }}
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.6; flex: 1; padding-right: 16px;">
            {{ t('common.autoGrantApkPermissionDesc') }}
          </div>
          <el-switch v-model="autoGrantApkPermission" />
        </div>
      </div>
    </div>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="settingsDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="settingsLoading"
          @click="handleSaveSettings"
        >
          保存
        </el-button>
      </span>
    </template>
  </el-dialog>
  <!-- ===== 设置弹窗 END ===== -->

</template>

<style>
@import './styles/create-dialog.css';
@import './styles/terminal.css';
@import './styles/image-management.css';
@import './styles/layout.css';
@import './styles/device-host.css';
@import './styles/cloud-machine.css';
@import './styles/dialogs.css';
</style>
