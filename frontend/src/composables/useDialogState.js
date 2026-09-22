/**
 * 组件模板引用 + 各类弹窗状态集合：
 *   - 子组件 ref：机型 / 实例 / 网络 / 云机备份 / AI 助理 / RPA Agent / OpenCecs / 客服
 *   - 弹窗状态：切换机型、右键菜单、API 详情、IP 测试、S5 代理、VPC 列表、重命名、公告
 *   - 重命名逻辑（handleRename / submitRename）与系统公告（fetchAnnouncement / closeAnnouncement）
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 依赖的 App.vue 状态（instances / cloudManageMode / activeDevice / selectedCloudDevice /
 * selectedCloudMachines）通过依赖对象传入；contextMenuContainer 与 initCloudMachineGroups
 * 在 App.vue 下方才声明，用惰性依赖避免 TDZ。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { renameAndroidContainer, triggerAndroidRefresh, getAnnouncement } from '../services/api.js'

export function useDialogState({
  instances,
  cloudManageMode,
  activeDevice,
  selectedCloudDevice,
  selectedCloudMachines,
}, lazyDeps = {}) {
  // 以下依赖来自 App.vue 下方才声明的对象，用惰性依赖避免 TDZ
  const {
    getContextMenuContainer,
    initCloudMachineGroups,
  } = lazyDeps

  // contextMenuContainer 是 App.vue 下方的 ref，用代理把 .value 的读 / 写转发到真实对象
  const proxyRef = (get) => ({
    get value() { return get().value },
    set value(v) { get().value = v },
  })
  const contextMenuContainer = proxyRef(getContextMenuContainer)

  const modelManagementRef = ref(null)

  // 实例管理组件引用
  const instanceManagementRef = ref(null)

  // 网络管理组件引用
  const networkManagementRef = ref(null)

  // 云机管理组件引用
  const backupManagementRef = ref(null)

  // AI助理组件引用
  const aiAssistantRef = ref(null)

  // RPA Agent 组件引用
  const rpaAgentRef = ref(null)

  // OpenCecs 管理组件引用
  const opencecsManagementRef = ref(null)

  // 客服组件引用
  const customerServiceRef = ref(null)
  // 客服未读消息数
  const customerServiceUnreadCount = ref(0)

  // 处理未读消息数变化
  const handleUnreadCountChange = (count) => {
    customerServiceUnreadCount.value = count
    console.log('客服未读消息数更新:', count)
  }



  // 临时变量
  const tempModelName = ref('') // 临时存储机型选择
  const tempModelId = ref('') // 临时存储机型ID
  const switchModelType = ref('online') // 机型切换类型: online, local, backup
  const switchCountryCode = ref('CN') // 切换机型国家代码
  const switchModelDialogVisible = ref(false) // 机型切换对话框可见性
  const currentSwitchContainer = ref(null) // 当前要切换机型的容器
  const switchingModel = ref(false) // 机型切换加载状态
  // 右键菜单相关
  const contextMenuVisible = ref(false)
  const contextMenuPosition = ref({ x: 0, y: 0 })
  const contextMenuRef = ref(null)
  const contextMenuSlot = ref(0)

  // API详情相关
  const apiDetailsVisible = ref(false)
  const apiDetailsData = ref(null)

  // IP测试弹窗
  const ipTestVisible = ref(false)
  const testIp = ref('')
  // S5代理设置弹窗
  const s5ProxyDialogVisible = ref(false)
  const s5ProxyForm = ref({
    cloudMachineName: '',
    s5ServerAddress: '',
    s5Port: '',
    username: '',
    password: '',
    vpcInfo: '',
    dnsMode: 'server', // local: 本地域名解析, server: 服务端域名解析
  })
  const s5ProxyLoading = ref(false)
  const vpcProxyList = ref([]) // VPC代理列表，中转设置-已有VPC选项使用

  // 重命名相关状态
  const renameDialogVisible = ref(false)
  const renameForm = ref({
    name: '',
    newName: '',
    prefix: '',
    standby: ''
  })
  const renameLoading = ref(false)

  // 公告弹窗相关状态
  const announcementVisible = ref(false)
  const announcementData = ref({
    title: '',
    content: '',
    displayDuration: 0
  })
  let announcementTimer = null
  let countdownTimer = null
  const countdown = ref(0) // 倒计时秒数

  // 处理重命名
  const handleRename = (targetContainer = null) => {
    // 获取云机对象：优先使用传入的参数，否则尝试从右键菜单选中的索引获取
    let container = targetContainer

    // 如果传入的是鼠标事件对象（可能是直接点击而非传递了row），则视为null
    if (container instanceof Event || (container && container.type === 'click')) {
      container = null
    }
    console.log('处理重命名', instances.value[contextMenuSlot.value], contextMenuSlot.value, instances.value)
    if (!container) {
      // 尝试从右键菜单获取
      // 检查是否是批量模式
      if (cloudManageMode.value === 'batch') {
        // 批量模式下，contextMenuSlot.value 可能不适用或者需要特殊处理
        // 尝试通过 contextMenuContainer 获取
        container = contextMenuContainer.value
      } else {
        container = instances.value.find(item => item.indexNum == contextMenuSlot.value)
      }
    }

    if (!container) {
      ElMessage.warning('未找到选中的云机')
      return
    }

    // 获取云机名称
    let containerName = ''
    if (typeof container.name === 'string') {
      containerName = container.name
    } else if (typeof container.ID === 'string') {
      containerName = container.ID
    } else if (container.name && typeof container.name === 'object') {
       // 适配可能的数据结构
       containerName = container.name.name || container.name.id || String(container.name)
    } else {
       containerName = String(container.name || container.ID || '')
    }

    // 处理名称显示，如果包含_则只显示最后一部分
    let simpleName = containerName
    let prefix = ''

    // 检查是否符合特定格式（包含下划线）
    if (containerName.includes('_')) {
      const lastUnderscoreIndex = containerName.lastIndexOf('_')
      if (lastUnderscoreIndex !== -1 && lastUnderscoreIndex < containerName.length - 1) {
        simpleName = containerName.substring(lastUnderscoreIndex + 1)
        prefix = containerName.substring(0, lastUnderscoreIndex + 1)
      }
    }

    renameForm.value.name = simpleName // 显示给用户的简单名称（不含前缀）
    //renameForm.value.newName = simpleName // 输入框默认显示简单名称
    renameForm.value.prefix = prefix // 保存前缀
    renameForm.value.standby = containerName // 保存原始完整名称

    // 保存设备信息，用于批量模式下也能正确找到设备
    if (container) {
      renameForm.value.deviceIp = container.deviceIp
      renameForm.value.deviceVersion = container.deviceVersion
    }

    renameDialogVisible.value = true
    contextMenuVisible.value = false
  }

  // 提交重命名
  const submitRename = async () => {
    if (!renameForm.value.newName || renameForm.value.newName.trim() === '') {
      ElMessage.warning('请输入新名称')
      return
    }

    // 校验新名称：不允许包含中文和特殊字符_
    const chineseRegex = /[\u4e00-\u9fa5]/
    if (chineseRegex.test(renameForm.value.newName) || renameForm.value.newName.includes('_')) {
      ElMessage.error('云机名称不允许包含中文和特殊字符_')
      return
    }

    // 构建完整的新名称
    const finalNewName = renameForm.value.prefix + renameForm.value.newName

    if (finalNewName === renameForm.value.name) {
      ElMessage.info('名称未发生变化')
      renameDialogVisible.value = false
      return
    }

    try {
      renameLoading.value = true

      // 确定当前操作的设备
      let targetDevice = activeDevice.value

      // 如果是批量模式且没有 activeDevice，尝试从容器信息中获取设备
      if (!targetDevice && cloudManageMode.value === 'batch' && selectedCloudDevice.value) {
          targetDevice = selectedCloudDevice.value
      }

      // 优先使用 renameForm 中保存的设备信息（如果有）
      if (renameForm.value.deviceIp) {
        targetDevice = {
          ip: renameForm.value.deviceIp,
          version: renameForm.value.deviceVersion || 'v3'
        }
      }

      // 如果还是没有设备信息，尝试从renameForm.value.standby（如果它包含了设备信息）或者通过遍历查找
      if (!targetDevice) {
         // 这是一个最后的尝试，通常 activeDevice 或 selectedCloudDevice 应该被设置
         // 如果容器对象里有 deviceIp，我们可以尝试查找
         // 但在此处我们没有直接访问容器对象，只有名字
      }

      if (!targetDevice) {
          ElMessage.error('未选择设备')
          return
      }

      const result = await renameAndroidContainer(
        targetDevice,
        renameForm.value.standby,
        finalNewName
      )

      if (result && result.code === 0) {
        ElMessage.success('修改名称成功')
        renameDialogVisible.value = false

        // 清除输入框内容
        renameForm.value.newName = ''

        // 刷新容器列表 - 触发后端立即刷新安卓缓存
        await triggerAndroidRefresh([targetDevice.ip])

        // 如果是批量模式，更新选中列表中的名称
        if (cloudManageMode.value === 'batch') {
          const oldName = renameForm.value.standby
          const targetMachine = selectedCloudMachines.value.find(
            m => m.deviceIp === targetDevice.ip && m.name === oldName
          )

          if (targetMachine) {
            targetMachine.name = finalNewName
            console.log('批量模式下更新云机名称:', oldName, '->', finalNewName)
          }
        }

        // 重新初始化分组数据，以更新树形结构
        initCloudMachineGroups()
      } else {
        const errorMsg = result?.message || '修改名称失败'
        ElMessage.error(errorMsg)
      }

    } catch (error) {
      console.error('修改名称失败:', error)
      if (error.message === 'Authentication Failed') {
          // 认证失败处理，这里简单提示，实际可能需要弹出认证框
          ElMessage.error('认证失败，请重新登录设备')
      } else {
          const errorMsg = error.response?.data?.message || error.message || '未知错误'
          ElMessage.error(`修改名称失败: ${errorMsg}`)
      }
    } finally {
      renameLoading.value = false
    }
  }

  // 获取系统公告
  const fetchAnnouncement = async () => {
    try {
      const result = await getAnnouncement()

      console.log('[fetchAnnouncement] 公告接口返回:', result)

      // 检查返回结果是否有效
      if (!result) {
        console.log('[fetchAnnouncement] 公告接口返回为空')
        return
      }

      // 检查是否成功获取数据
      if (result.code_id !== 200) {
        console.log('[fetchAnnouncement] 公告接口返回错误:', result.msg)
        return
      }

      // 检查data是否为null或空数组（无公告时）
      if (!result.data || (Array.isArray(result.data) && result.data.length === 0)) {
        console.log('[fetchAnnouncement] 当前无公告')
        return
      }

      // data为数组，默认取第一条展示
      const firstItem = Array.isArray(result.data) ? result.data[0] : result.data
      if (!firstItem) {
        console.log('[fetchAnnouncement] 公告数据为空')
        return
      }

      const { title, content, displayDuration } = firstItem
      console.log('[fetchAnnouncement] 公告数据:', { title, content, displayDuration })

      announcementData.value.title = title || '系统通知'
      announcementData.value.content = content || ''
      announcementData.value.displayDuration = displayDuration || 0

      // 显示弹窗
      announcementVisible.value = true
      console.log('[fetchAnnouncement] 显示公告弹窗')

      // 如果设置了自动关闭时间，启动定时器和倒计时
      if (displayDuration > 0) {
        // 清除之前的定时器（如果存在）
        if (announcementTimer) {
          clearTimeout(announcementTimer)
        }
        if (countdownTimer) {
          clearInterval(countdownTimer)
        }

        // 初始化倒计时
        countdown.value = displayDuration

        // 启动倒计时（每秒更新）
        countdownTimer = setInterval(() => {
          countdown.value--
          if (countdown.value <= 0) {
            clearInterval(countdownTimer)
            countdownTimer = null
          }
        }, 1000)

        // 设置自动关闭定时器
        announcementTimer = setTimeout(() => {
          announcementVisible.value = false
          console.log('[fetchAnnouncement] 公告自动关闭')
        }, displayDuration * 1000)

        console.log(`[fetchAnnouncement] 设置${displayDuration}秒后自动关闭`)
      } else {
        countdown.value = 0
      }
    } catch (error) {
      console.error('[fetchAnnouncement] 获取公告失败:', error)
      // 静默失败，不影响用户使用
    }
  }

  // 关闭公告弹窗
  const closeAnnouncement = () => {
    announcementVisible.value = false

    // 清除定时器
    if (announcementTimer) {
      clearTimeout(announcementTimer)
      announcementTimer = null
    }
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    countdown.value = 0
  }

  return {
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
  }
}
