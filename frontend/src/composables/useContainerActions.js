/**
 * 云机右键菜单动作：更新镜像、重启、删除、移动实例、重置、关机，
 * 以及 S5 代理设置、推流设置（含二维码）两个子弹窗的逻辑。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue（moveInstance* / qrCode* 这几个随逻辑一起搬进来，仍解构回 App.vue），
 * 需要的 ref / 宿主函数通过依赖对象传入，不用 provide/inject。
 * ElMessage / ElMessageBox / CryptoJS / QRCode 与 wails binding HttpRequest 由本模块自己 import。
 *
 * `t` 是 App.vue 里的本地 i18n 包装，通过依赖对象传入。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import CryptoJS from 'crypto-js'
import QRCode from 'qrcode'
import { HttpRequest } from '../../bindings/edgeclient/app'

export function useContainerActions({
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
}) {
  const handleUpdateImage = () => {
    const container = getCurrentContextMenuContainer()
    if (container) {
      showUpdateImageDialog(container)
    }
    closeContextMenu()
  }

  const handleRestart = () => {
    const container = getCurrentContextMenuContainer()
    if (container) {
      handleContainerAction(container, 'restart')
    }
    closeContextMenu()
  }

  const setS5Agent = async () => {
    const container = getCurrentContextMenuContainer()
    if(container) {
      // 初始化表单数据（先使用缓存数据，避免闪烁）
      s5ProxyForm.value = {
        cloudMachineName: formatInstanceName(container.name) || container.name,
        s5ServerAddress: container.s5IP || '',
        s5Port: container.s5Port || '',
        username: container.s5User || '',
        password: container.s5Password || '',
        dnsMode: container.s5Type == 0 || container.s5Type == 2 ? 'server' : 'local',
        relayType: container.s5RelayType || '0',
        relayVpcId: container.s5RelayVpcId || '',
        relayAddress: container.s5RelayAddress || ''
      }

      // 显示S5代理设置弹窗
      s5ProxyDialogVisible.value = true

      // 加载VPC代理列表（中转设置使用），从设备API获取真实节点
      try {
        let deviceIp = (container.networkName === 'myt' || container.networkMode === 'myt' || container.network === 'myt') && container.ip
          ? container.ip
          : container.deviceIp
        if (deviceIp && deviceIp.includes(':')) deviceIp = deviceIp.split(':')[0]
        const targetDevice = deviceIp ? { ip: deviceIp } : (cloudManageMode.value === 'slot' ? selectedCloudDevice.value : activeDevice.value)
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
      // 每次都调用接口获取最新的s5代理详情
      try {
        // 构造请求参数
        let host = (container.networkName === 'myt' || container.networkMode === 'myt' || container.network === 'myt') && container.ip
          ? container.ip
          : container.deviceIp
        // OpenCecs 公网设备：deviceIp 含端口，提取纯 IP
        if (host && host.includes(':')) host = host.split(':')[0]
        const port = extractPort9082(container) || 9082
        const requestParams = {
          url: `http://${host}:${port}/proxy`,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          },
          body: ''
        };

        console.log('正在获取最新S5代理详情...');
        // 调用Wails后端的HttpRequest函数获取s5代理详情
        const response = await HttpRequest(requestParams);
        console.log('获取S5代理详情响应:', response);

        // 处理响应
        let result;
        if (response.body && typeof response.body === 'object') {
          result = response.body;
        } else {
          // 如果body不是JSON对象，尝试解析raw字段
          try {
            result = JSON.parse(response.raw);
          } catch (e) {
            result = { code: response.status };
          }
        }

        console.log('获取S5代理详情结果:', result);

        // 更新表单数据为最新数据
        if (result.code === 200 || result.success) {
          parseAndFillSocks5Url(result.data.addr)
          s5ProxyForm.value.dnsMode = result.data.type == 1 ? 'local' : 'server';
          console.log('S5代理信息已更新为最新数据');
        }
      } catch (error) {
        console.error('获取S5代理详情失败:', error);
        // 获取失败不影响弹窗显示，继续使用缓存数据
        console.log('使用缓存的S5代理信息');
      }
    }
    closeContextMenu()
  }

  const parseAndFillSocks5Url = (url) => {
    // 检查url是否为空或undefined
    if (!url) {
      return false;
    }

    // socks5://[user:pass@]host:port
    // 密码可能含 @，必须以最后一个 @ 切分 user-info 与 host，正则的 [^@] 无法处理含 @ 的密码
    const prefix = 'socks5://';
    if (!url.startsWith(prefix)) return false;
    const rest = url.slice(prefix.length);

    let userInfo = '';
    let hostPart = rest;
    const atIdx = rest.lastIndexOf('@');
    if (atIdx !== -1) {
      userInfo = rest.slice(0, atIdx);
      hostPart = rest.slice(atIdx + 1);
    }

    let username = '';
    let password = '';
    if (userInfo) {
      const colonIdx = userInfo.indexOf(':');
      if (colonIdx === -1) {
        username = userInfo;
      } else {
        username = userInfo.slice(0, colonIdx);
        password = userInfo.slice(colonIdx + 1);
      }
    }

    // host:port —— host 可能是 IPv6（含冒号），但 S5 代理场景一般用 IPv4/域名，按最后一个冒号切 port
    let s5ServerAddress = '';
    let s5Port = '';
    const lastColon = hostPart.lastIndexOf(':');
    if (lastColon !== -1) {
      s5ServerAddress = hostPart.slice(0, lastColon);
      s5Port = hostPart.slice(lastColon + 1);
    } else {
      s5ServerAddress = hostPart;
    }

    if (!s5ServerAddress || !s5Port) return false;

    s5ProxyForm.value.username = username || '';
    s5ProxyForm.value.password = password || '';
    s5ProxyForm.value.s5ServerAddress = s5ServerAddress;
    s5ProxyForm.value.s5Port = s5Port;

    return true;
  }

  // 解析S5信息并自动填写
  const parseVpcInfo = () => {
    const vpcInfo = s5ProxyForm.value.vpcInfo?.trim()

    if (!vpcInfo) {
      return
    }

    // 格式: 地址:端口:用户名:密码 (用户名和密码可选)
    const parts = vpcInfo.split(':')

    if (parts.length < 2) {
      ElMessage.warning('S5信息格式不正确，至少需要地址和端口')
      return
    }

    // 解析地址和端口
    s5ProxyForm.value.s5ServerAddress = parts[0] || ''
    s5ProxyForm.value.s5Port = parts[1] || ''

    // 解析用户名（可选，第3部分）
    if (parts.length >= 3 && parts[2]) {
      s5ProxyForm.value.username = parts[2]
    } else {
      s5ProxyForm.value.username = ''
    }

    // 解析密码（可选，第4部分）
    if (parts.length >= 4 && parts[3]) {
      s5ProxyForm.value.password = parts[3]
    } else {
      s5ProxyForm.value.password = ''
    }

    ElMessage.success('S5信息解析成功')
  }

  const handleS5ProxySubmit = async () => {
    const container = getCurrentContextMenuContainer()
    if(!container) return

    // 表单验证
    if (!s5ProxyForm.value.s5ServerAddress) {
      ElMessage.error('请输入s5服务器地址')
      return
    }

    if (!s5ProxyForm.value.s5Port) {
      ElMessage.error('请输入s5端口')
      return
    }

    try {
      s5ProxyLoading.value = true

      // 准备请求参数
      const dnsModeValue = s5ProxyForm.value.dnsMode === 'local' ? '1' : '2'

      let host = (container.networkName === 'myt' || container.networkMode === 'myt' || container.network === 'myt') && container.ip
        ? container.ip
        : container.deviceIp
      // OpenCecs 公网设备：deviceIp 含端口，提取纯 IP
      if (host && host.includes(':')) host = host.split(':')[0]
      const port = extractPort9082(container) || 9082
      const requestParams = {
        url: `http://${host}:${port}/proxy?cmd=2&ip=${s5ProxyForm.value.s5ServerAddress}&port=${s5ProxyForm.value.s5Port}&usr=${s5ProxyForm.value.username}&pwd=${s5ProxyForm.value.password}&type=${dnsModeValue}`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        body: ''
      };

      // 调用Wails后端的HttpRequest函数
      const response = await HttpRequest(requestParams);
      console.log('设置SOCKS5代理请求响应:', response);

      // 处理响应
      let result;
      if (response.body && typeof response.body === 'object') {
        result = response.body;
      } else {
        // 如果body不是JSON对象，尝试解析raw字段
        try {
          result = JSON.parse(response.raw);
        } catch (e) {
          result = { code: response.status };
        }
      }

      // 处理响应结果
      if (result.code === 200 || result.success) {
        ElMessage.success('S5代理设置成功')
        s5ProxyDialogVisible.value = false
      } else {
        ElMessage.error('S5代理设置失败: ' + (result.msg || result.message || '未知错误'))
      }
    } catch (error) {
      console.error('设置S5代理失败:', error)
      ElMessage.error('设置S5代理失败: ' + error.message)
    } finally {
      s5ProxyLoading.value = false
    }
  }

  const closeS5Agent = async  () => { 
    const container = getCurrentContextMenuContainer()
    console.log('关闭S5代理:', container, extractPort9082(container) || 9082)
    if(container) {
      try {
        let host = (container.networkName === 'myt' || container.networkMode === 'myt' || container.network === 'myt') && container.ip
          ? container.ip
          : container.deviceIp
        // OpenCecs 公网设备：deviceIp 含端口，提取纯 IP
        if (host && host.includes(':')) host = host.split(':')[0]
        const port = extractPort9082(container) || 9082
       // 构造请求参数
        const requestParams = {
          url: `http://${host}:${port}/proxy?cmd=3`,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          },
          body: ''
        };

        // 调用Wails后端的HttpRequest函数
        const response = await HttpRequest(requestParams);
        console.log('关闭SOCKS5代理请求响应:', response);

        // 处理响应
        let result;
        if (response.body && typeof response.body === 'object') {
          result = response.body;
        } else {
          // 如果body不是JSON对象，尝试解析raw字段
          try {
            result = JSON.parse(response.raw);
          } catch (e) {
            result = { code: response.status };
          }
        }
        console.log('关闭SOCKS5代理响应:', result)

        // 根据API返回结果显示相应消息
        if (result.code == 200 || result.success) {
          ElMessage.success('SOCKS5代理已关闭')
        } else {
          ElMessage.warning(`关闭SOCKS5代理失败: ${result.msg || result.message || '未知错误'}`)
        }
      } catch (error) {
        console.error('关闭SOCKS5代理失败:', error)
        ElMessage.error(`关闭SOCKS5代理失败: ${error.message}`)
      }
    }
    closeContextMenu()
  }

  const handleDelete = () => {
    const container = getCurrentContextMenuContainer()
    if (container) {
      handleContainerAction(container, 'delete')
    }
    closeContextMenu()
  }

  // 计算每个坑位的备份数量
  const getBackupCount = (slotNum) => {
    return allInstances.value.filter(inst => 
      inst.indexNum === slotNum && 
      inst.status === 'shutdown'
    ).length
  }

  // 移动实例
  const moveInstanceDialogVisible = ref(false)
  const moveInstanceForm = ref({ name: '', indexNum: '', start: false })
  const moveInstanceLoading = ref(false)
  const moveInstanceCurrentSlot = ref(0)

  const moveInstanceAvailableSlots = computed(() => {
    const device = activeDevice.value
    let maxSlots = 12
    if (device && device.id && device.id.toLowerCase().startsWith('p')) {
      maxSlots = 24
    }
    const slots = []
    for (let i = 1; i <= maxSlots; i++) {
      if (i !== moveInstanceCurrentSlot.value) {
        slots.push(i)
      }
    }
    return slots
  })

  const handleMoveInstance = () => {
    const container = getCurrentContextMenuContainer()
    if (!container) {
      ElMessage.warning('请先选择云机')
      closeContextMenu()
      return
    }
    moveInstanceCurrentSlot.value = container.indexNum || 0
    moveInstanceForm.value = {
      name: container.name || '',
      indexNum: '',
      start: false
    }
    moveInstanceDialogVisible.value = true
    closeContextMenu()
  }

  const submitMoveInstance = async () => {
    if (!moveInstanceForm.value.indexNum) {
      ElMessage.warning('请输入目标坑位')
      return
    }
    moveInstanceLoading.value = true
    try {
      let targetDevice = activeDevice.value
      const container = getCurrentContextMenuContainer()
      if (cloudManageMode.value === 'batch' && container && container.deviceIp) {
        targetDevice = devices.value.find(d => d.ip === container.deviceIp) || { ip: container.deviceIp, version: 'v3' }
      }
      if (!targetDevice) {
        ElMessage.error('没有选中设备')
        return
      }

      const password = getDevicePassword(targetDevice.ip)
      const headers = { 'Content-Type': 'application/json' }
      if (password) {
        headers['Authorization'] = 'Basic ' + btoa('admin:' + password)
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)

      const response = await fetch(
        `http://${getDeviceAddr(targetDevice.ip)}/android/move`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: moveInstanceForm.value.name,
            indexNum: Number(moveInstanceForm.value.indexNum),
            start: moveInstanceForm.value.start
          }),
          signal: controller.signal
        }
      )
      clearTimeout(timer)
      const data = await response.json()
      if (data.code === 0) {
        ElMessage.success('移动成功')
        moveInstanceDialogVisible.value = false
        await fetchAndroidContainers(targetDevice, true)
      } else {
        ElMessage.error(data.message || '移动失败')
      }
    } catch (error) {
      ElMessage.error('移动失败: ' + (error.message || '未知错误'))
    } finally {
      moveInstanceLoading.value = false
    }
  }

  const handleResetContainer = async () => {
    const container = getCurrentContextMenuContainer()
    console.log('handleResetContainer called with container:', container)

    // 已到期云机强制关机：禁止重置
    if (container) {
      const slotNum = container.indexNum
      if (slotNum != null) {
        const info = slotStates.value[slotNum]
        if (info && info.state === 2) {
          ElMessage.warning(t('common.expiredCannotStart'))
          return
        }
      }
    }

    // 确定目标设备
    let targetDevice = activeDevice.value
    if (cloudManageMode.value === 'batch' && container && container.deviceIp) {
      targetDevice = devices.value.find(d => d.ip === container.deviceIp) || { ip: container.deviceIp, version: 'v3' }
    }

    // 确保 targetDevice 包含 androidType，供 resetAndroidContainer 使用
    if (targetDevice && container) {
      targetDevice.androidType = container.androidType
    }

    console.log('targetDevice:', targetDevice)

    if (container && targetDevice && targetDevice.version === 'v3') {
      try {
        // 使用自定义弹窗让用户选择重置后是否开机
        let startAfterReset = true
        await new Promise((resolve, reject) => {
          ElMessageBox.confirm(
            '确定要重置此容器吗？重置后容器将会被恢复到初始状态。',
            '重置容器',
            {
              confirmButtonText: '重置并开机',
              cancelButtonText: '仅重置(不开机)',
              distinguishCancelAndClose: true,
              type: 'warning',
              showClose: true
            }
          ).then(() => {
            startAfterReset = true
            console.log('[重置容器] 用户选择: 重置并开机, start=true')
            resolve()
          }).catch((action) => {
            console.log('[重置容器] catch action:', action, typeof action)
            if (action === 'close') {
              // 用户点了 X 或按 ESC，取消操作
              reject('cancel')
            } else {
              // 用户点了"仅重置(不开机)"按钮
              startAfterReset = false
              console.log('[重置容器] 用户选择: 仅重置(不开机), start=false')
              resolve()
            }
          })
        })

        // 重置容器前，清空该容器的截图缓存，避免显示旧截图
        clearContainerScreenshotCache(targetDevice, container)

        // 调用重置容器API
        const result = await resetAndroidContainer(targetDevice, container.name, null, startAfterReset)

        if (result.code === 0) {
          ElMessage.success('容器重置成功')
          // 刷新容器列表
          await fetchAndroidContainers(targetDevice, true)
        } else {
          ElMessage.error(`容器重置失败: ${result.message || '未知错误'}`)
        }
      } catch (error) {
        if (error !== 'cancel') {
          console.error('重置容器失败:', error)
          ElMessage.error(`重置容器失败: ${error.message || '未知错误'}`)
        }
      }
    } else if (targetDevice && targetDevice.version !== 'v3') {
      ElMessage.warning('该设备版本不支持重置容器功能')
    } else {
      ElMessage.warning('请先选择设备')
    }
    closeContextMenu()
  }

  // 设置推流
  const handleSetStream = async () => {
    try {
      // 获取当前容器
      const container = getCurrentContextMenuContainer()
      if (!container) {
        console.warn('设置推流：无法获取容器信息')
        // 重置表单
        streamType.value = ''
        streamFilePath.value = ''
        rtmpUrl.value = ''
        setStreamDialogVisible.value = true
        return
      }

      // 确定目标设备
      let targetDevice = activeDevice.value
      if (cloudManageMode.value === 'batch' && container.deviceIp) {
        targetDevice = devices.value.find(d => d.ip === container.deviceIp) || { ip: container.deviceIp, version: 'v3' }
      }

      if (!targetDevice) {
        console.warn('设置推流：无法获取目标设备')
        // 重置表单
        streamType.value = ''
        streamFilePath.value = ''
        rtmpUrl.value = ''
        setStreamDialogVisible.value = true
        return
      }

      // 获取 9082 端口（使用 extractPort9082 自动处理公网设备端口映射）
      const port = extractPort9082(container) || 9082
      let host = (container.networkName === 'myt' || container.networkMode === 'myt' || container.network === 'myt') && container.ip
        ? container.ip
        : targetDevice.ip
      // OpenCecs 公网设备：deviceIp 含端口，提取纯 IP
      if (host && host.includes(':')) host = host.split(':')[0]

      // 调用停止摄像头接口
      const stopUrl = `http://${host}:${port}/camera?cmd=stop`
      console.log('停止摄像头接口:', stopUrl)

      try {
        await HttpRequest({
          url: stopUrl,
          method: 'GET'
        })
        console.log('摄像头已停止')
      } catch (error) {
        console.warn('停止摄像头失败（可能未启动）:', error)
        // 忽略错误，继续显示设置推流对话框
      }
    } catch (error) {
      console.error('设置推流准备失败:', error)
    }

    // 重置表单
    streamType.value = ''
    streamFilePath.value = ''
    rtmpUrl.value = ''
    setStreamDialogVisible.value = true
  }

  // 选择流类型变化处理
  // const handleStreamTypeChange = (type) => {
  //   streamFilePath.value = ''
  //   rtmpUrl.value = ''
  // }

  // 选择文件夹处理
  const selectStreamFolder = async () => {
    try {
      let result
      if (streamType.value === 'image') {
        result = await SelectImageFile()
      } else if (streamType.value === 'video') {
        result = await SelectVideoFile()
      } else {
        return
      }

      if (result && result.success && result.path) {
        streamFilePath.value = result.path
      }
    } catch (error) {
      console.error('选择文件失败:', error)
      ElMessage.error('选择文件失败')
    }
  }

  // 安装APP处理
  // const handleInstallApp = async () => {
    // TODO: 实现APP安装逻辑
    // ElMessage.info('APP安装功能开发中')
  // }

  const qrCodeUrl = ref('')
  const appDownloadQrCodeUrl = ref('')
  const qrCodeLoading = ref(false)

  // 生成APP连接二维码
  const generateAppQRCode = async () => {
    qrCodeLoading.value = true
    try {
      const container = getCurrentContextMenuContainer()
      if (!container) {
        // 可能是批量操作或其他情况，暂时忽略或提示
        console.warn('生成二维码失败：无法获取容器信息')
        return
      }

      let n = container.name || ''
      // 处理名称显示，将长ID替换为4位随机数
      if (n && n.includes('_')) {
        const parts = n.split('_')
        // 如果第一部分是长ID（比如长度大于10），则替换为4位随机数
        if (parts.length >= 2 && parts[0].length > 10) {
           const randomPrefix = Math.floor(1000 + Math.random() * 9000)
           const suffix = n.substring(n.indexOf('_'))
           n = `${randomPrefix}${suffix}`
        }
      }
      let ip = container.networkName == 'myt' ? container.ip : activeDevice.value?.ip || ''
      // OpenCecs 公网设备：deviceIp 含端口，提取纯 IP
      if (ip && ip.includes(':')) ip = ip.split(':')[0]

      // 使用 extractPort 自动处理公网端口映射（OpenCecs 设备会返回映射后的公网端口）
      const t = extractPort(container, 10000) || 10000
      const u = extractPort(container, 10001) || 10001
      const i = extractPort(container, 9082) || 9082

      // c: tcp 2375 或 10008
      // let c = extractPort(container, 2375)
      // if (!c) c = extractPort(container, 10008)

      const ct = extractPort(container, 10006) || 10006
      const cu = extractPort(container, 10007) || 10007

      const rawStr = `n=${n}&ip=${ip}&t=${t}&u=${u}&i=${i}&ct=${ct}&cu=${cu}`
      console.log('二维码原始字符串:', rawStr)

      // Base64 编码 (处理中文)
      const base64Str = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(rawStr))

      qrCodeUrl.value = await QRCode.toDataURL(base64Str)

      // 生成APP下载二维码
      const downloadUrl = 'http://d.moyunteng.com/download/mytcloudphone_v1.3_20260302.apk'
      appDownloadQrCodeUrl.value = await QRCode.toDataURL(downloadUrl)

    } catch (error) {
      console.error('生成二维码失败:', error)
      ElMessage.error('生成二维码失败')
    } finally {
      qrCodeLoading.value = false
    }
  }

  // 监听流类型变化
  watch(streamType, async (newType) => {
    // 切换类型时清空文件路径
    streamFilePath.value = ''

    if (newType === 'app') {
      await generateAppQRCode()
    } else {
      qrCodeUrl.value = ''
      appDownloadQrCodeUrl.value = ''
    }
  })

  // 确认设置推流
  const confirmSetStream = async () => {
    if (!streamType.value) {
      ElMessage.warning('请选择推流类型')
      return
    }

    if (streamType.value === 'app') {
      // APP模式下，只是为了展示二维码，点击确定后直接关闭即可
      setStreamDialogVisible.value = false
      return
    }

    if ((streamType.value === 'image' || streamType.value === 'video') && !streamFilePath.value) {
      ElMessage.warning('请选择文件')
      return
    }

    if (streamType.value === 'rtmp' && !rtmpUrl.value) {
      ElMessage.warning('请输入RTMP推流地址')
      return
    }

    try {
      setStreamLoading.value = true
      const container = getCurrentContextMenuContainer()
      if (!container) {
        ElMessage.error('无法获取当前容器信息')
        return
      }

      if (streamType.value === 'image' || streamType.value === 'video') {
        // 上传文件到云机
        await authRetry(activeDevice.value, async (password) => {
          const result = await UploadFileToCloudMachine(
            activeDevice.value.ip,
            activeDevice.value.version || 'v3',
            container.name,
            streamFilePath.value,
            password
          )

          if (!result.success) {
            if (result.message && (result.message.includes('Authentication Failed') || result.message.includes('401'))) {
              throw new Error('Authentication Failed')
            }
            throw new Error(result.message)
          }

          // 上传成功后调用 modifydev 接口
          const fileName = streamFilePath.value.split(/[/\\]/).pop()
          const targetPath = `/storage/emulated/0/upload/${fileName}`
          let host = (container.networkName === 'myt' || container.networkMode === 'myt' || container.network === 'myt') && container.ip
            ? container.ip
            : activeDevice.value.ip
          // OpenCecs 公网设备：deviceIp 含端口，提取纯 IP
          if (host && host.includes(':')) host = host.split(':')[0]
          const modifyDevUrl = `http://${host}:${extractPort9082(container) || 9082}/modifydev`

          // 使用 x-www-form-urlencoded 格式发送数据
          // 注意：这里手动拼接字符串，避免 URLSearchParams 对路径进行编码，因为后端可能不支持解码
          const bodyStr = `cmd=4&type=${streamType.value}&path=${targetPath}`

          console.log('调用modifydev接口:', modifyDevUrl, bodyStr)

          const modifyResult = await HttpRequest({
            url: modifyDevUrl,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: bodyStr
          })

          console.log('modifydev接口返回结果:', modifyResult)

          if (!modifyResult.success) {
            throw new Error(`推流设置接口调用失败: ${modifyResult.status}`)
          }
        })
      }

      // TODO: 调用后端API设置推流
      ElMessage.success('推流设置成功')
      setStreamDialogVisible.value = false
    } catch (error) {
      if (error !== 'cancel') {
        console.error('设置推流失败:', error)
        ElMessage.error(`设置推流失败: ${error.message || '未知错误'}`)
      }
    } finally {
      setStreamLoading.value = false
    }
  }

  // 取消设置推流
  const cancelSetStream = () => {
    setStreamDialogVisible.value = false
    streamType.value = ''
    streamFilePath.value = ''
    rtmpUrl.value = ''
  }
  const handleShutdown = () => {
    const container = getCurrentContextMenuContainer()
    if (container) {
      handleContainerAction(container, 'stop')
    }
    closeContextMenu()
  }

  return {
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
  }
}
