/**
 * 认证 / 授权同步 / 注册 / 忘记密码 / 批量认证。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue（本仓库惯例：状态在 App.vue 顶层，逻辑抽 composable），
 * 需要的一堆 ref / 宿主函数通过依赖对象传入，不用 provide/inject。
 * ElMessage / CryptoJS / GetPhoneVCode / Register 由本模块自己 import。
 *
 * `t` 是 App.vue 里的本地 i18n 包装（基于 getCurrentInstance().proxy），
 * 通过依赖对象传入。
 */
import { ElMessage } from 'element-plus'
import CryptoJS from 'crypto-js'
import { GetPhoneVCode, Register } from '../../bindings/edgeclient/app'

export function useAuthForms({
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
}) {
  // 显示认证对话框（批量模式）
  const showAuthDialog = (device, callback) => {
    console.log(`[认证] 收到认证请求: ${device.ip}`)

    // 检查该设备是否已经在批量认证列表中
    const existingIndex = batchAuthDevices.value.findIndex(item => item.device.ip === device.ip)
    if (existingIndex !== -1) {
      console.log(`[认证] 设备 ${device.ip} 已在批量认证列表中，更新回调函数`)
      batchAuthDevices.value[existingIndex].callback = callback
      return
    }

    // 添加到批量认证列表
    batchAuthDevices.value.push({
      device,
      callback,
      password: '',          // 密码输入框
      savePassword: true,    // 是否保存密码
      status: 'pending',     // pending: 等待输入, verifying: 验证中, success: 成功, failed: 失败
      errorMsg: ''           // 错误信息
    })

    console.log(`[认证] 当前批量认证列表长度: ${batchAuthDevices.value.length}`)

    // 清除之前的定时器
    if (batchAuthCollectTimeout.value) {
      clearTimeout(batchAuthCollectTimeout.value)
    }

    // 延迟200ms收集所有设备，避免设备陆续添加时频繁弹窗
    batchAuthCollectTimeout.value = setTimeout(() => {
      if (batchAuthDevices.value.length > 0) {
        console.log(`[认证] 📋 开始批量认证，共 ${batchAuthDevices.value.length} 个设备`)
        batchAuthDialogVisible.value = true
      }
    }, 200)
  }


  // 显示授权同步对话框
  const showSyncAuthDialog = () => {
    const syncAuthDeviceStr = localStorage.getItem('syncAuthCredentials')
    console.log('syncAuthDeviceStr:', syncAuthDeviceStr)
    if(syncAuthDeviceStr) {
      try {
        const syncAuthDevice = JSON.parse(syncAuthDeviceStr)
        syncAuthForm.value = {
          username: syncAuthDevice.username || '',
          password: syncAuthDevice.password || '',
          saveCredentials: syncAuthDevice.saveCredentials || false
        }
      } catch (error) {
        console.error('Failed to parse syncAuthCredentials:', error)
        syncAuthForm.value = {
          username: '',
          password: '',
          saveCredentials: false
        }
      }
    } else {
        syncAuthForm.value = {
        username: '',
        password: '',
        saveCredentials: false
      }
    }
    syncAuthDialogVisible.value = true
  }

  // 处理授权过期（错误码3030）
  const handleAuthExpired = async () => {
    console.log('授权过期，错误码3030')

    // 检查本地存储是否有记住的凭证
    const savedCredentials = localStorage.getItem('syncAuthCredentials')

    if (savedCredentials) {
      try {
        const credentials = JSON.parse(savedCredentials)
        if (credentials.saveCredentials) {
          console.log('发现已保存的凭证，自动重新登录')
          // 静默处理，不打扰用户（自动重新登录在后台进行）
          // ElMessage.warning(t('auth.loginExpiredAutoRelogin'))

          // 使用保存的凭证重新登录
          const params = {
            username: credentials.username,
            password: CryptoJS.MD5(credentials.password).toString(),
            _ts: new Date().getTime(),
          }

          const sortedKeys = Object.keys(params).sort()
          const paramStr = sortedKeys.map(k => `${params[k]}`).join('#') + '#' + '454&*&*fsdff'
          const sign = CryptoJS.MD5(paramStr).toString()
          const formData = new URLSearchParams()
          formData.append('type', 'login')

          const data = {
            uname: params.username,
            pwd: params.password,
            _ts: params._ts,
            _sign: sign
          }
          formData.append('data', JSON.stringify(data))

          const response = await fetch('https://moyunteng.com/api/sp_api.php', {
            method: 'POST',
            body: formData
          })
          const result = await response.json()

          if (result.code == 200) {
            console.log('自动重新登录成功')
            // 静默处理成功，不显示提示
            // ElMessage.success('自动重新登录成功')
            token.value = result.data.token
            uname.value = result.data.uname
            localStorage.setItem('token', result.data.token)
            localStorage.setItem('uname', result.data.uname)
            // 重新获取设备绑定状态
            fetchDeviceBindStatus()
          } else {
            console.error('自动重新登录失败:', result.msg)
            // 失败时才显示错误提示
            ElMessage.error('登录已过期，请重新登录')
            clearAuthAndRefresh()
          }
        } else {
          clearAuthAndRefresh()
        }
      } catch (error) {
        console.error('解析保存的凭证失败:', error)
        clearAuthAndRefresh()
      }
    } else {
      clearAuthAndRefresh()
    }
  }

  // 清空登录信息并刷新页面
  const clearAuthAndRefresh = () => {
    ElMessage.warning('登录已过期，请重新登录')
    token.value = null
    uname.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('uname')
    localStorage.removeItem('syncAuthCredentials')
    // 刷新页面
    window.location.reload()
  }

  // 处理授权同步提交
  const handleSyncAuthSubmit = async () => {
    if (!syncAuthForm.value.username || !syncAuthForm.value.password) {
      ElMessage.warning(proxy.$i18n.t('common.enterUsernameAndPassword'))
      return
    }

    syncAuthLoading.value = true
    try {
      // 准备签名参数
      const params = {
        username: syncAuthForm.value.username,
        password: CryptoJS.MD5(syncAuthForm.value.password).toString(),
        _ts: new Date().getTime(),
      }

      // const data = {
      //   uname: params.username,
      //   pwd: CryptoJS.MD5(params.password).toString(),
      //   _ts: new Date().getTime(),
      // }

      const sortedKeys = Object.keys(params).sort();
      const paramStr = sortedKeys.map(k => `${params[k]}`).join('#') + '#' + '454&*&*fsdff';
      console.log('paramStr:', paramStr)
      const sign = CryptoJS.MD5(paramStr).toString();
      const formData = new URLSearchParams();
      formData.append('type', 'login');
      console.log('data:', sign)
      // 将除 type 外的所有参数放入 data 对象中
      const data = {
          uname: params.username,
          pwd: params.password,
          _ts: params._ts,
          _sign: sign
      }
      // 将 data 转为字符串格式传入
      formData.append('data', JSON.stringify(data));

      try { 
          // 模拟请求，实际项目中请使用fetch或其他HTTP库进行请求
         const response = await fetch('https://moyunteng.com/api/sp_api.php', {
            method: 'POST',
            body: formData
         })
         const result = await response.json()
         console.log('response:', result)
        if (result.code == 200) {
          ElMessage.success(proxy.$i18n.t('common.loginSuccess'))
          token.value = result.data.token
          uname.value = result.data.uname
          localStorage.setItem('token', result.data.token)
          localStorage.setItem('uname', result.data.uname)
          localStorage.setItem('uid', result.data.uid)
          // 登录成功后启动同步授权定时器
          startSyncAuthTimer()
          fetchDeviceBindStatus()
         } else{
          ElMessage.error(result.msg)
         }
       } catch (error) {
        console.error(error)
        ElMessage.error(error)
      }


      if (syncAuthForm.value.saveCredentials) {
        // 保存凭证到本地存储
        localStorage.setItem('syncAuthCredentials', JSON.stringify({
          username: syncAuthForm.value.username,
          password: syncAuthForm.value.password,
          saveCredentials: syncAuthForm.value.saveCredentials
        }))
      } else {
        // 未勾选记住凭证，清除旧的保存凭证
        localStorage.removeItem('syncAuthCredentials')
      }
      syncAuthDialogVisible.value = false
    } catch (error) {
      console.error(proxy.$i18n.t('common.syncAuthFailed') + ':', error)
      ElMessage.error(proxy.$i18n.t('common.syncAuthFailed') + ': ' + error.message)
    } finally {
      syncAuthLoading.value = false
    }
  }

  // 处理授权同步取消
  const handleSyncAuthCancel = () => {
    syncAuthDialogVisible.value = false
  }

  // 处理用户信息更新（从子组件接收）
  const handleUpdateUserInfo = (userInfo) => {
    if (userInfo.token) {
      token.value = userInfo.token
    }
    if (userInfo.uname) {
      uname.value = userInfo.uname
    }
    if (userInfo.uid) {
      // uid 存储在 localStorage 中，已经在子组件中处理
    }
    // 登录成功后启动同步授权定时器
    startSyncAuthTimer()
    // 重新获取设备绑定状态
    fetchDeviceBindStatus()
  }

  // 打开注册对话框
  const openRegisterDialog = () => {
    syncAuthDialogVisible.value = false
    registerDialogVisible.value = true
    registerForm.value = {
      phone: '',
      password: '',
      confirmPassword: '',
      vcode: '',
      vkey: ''
    }
  }

  // 发送验证码
  const sendVcode = async () => {
    if (!registerForm.value.phone) {
      ElMessage.warning('请输入手机号')
      return
    }

    // 验证手机号格式
    const phoneReg = /^1[3-9]\d{9}$/
    if (!phoneReg.test(registerForm.value.phone)) {
      ElMessage.warning(proxy.$i18n.t('common.enterCorrectPhone'))
      return
    }

    sendVcodeLoading.value = true
    try {
      const result = await GetPhoneVCode(registerForm.value.phone, token.value || '')
      console.log('获取验证码结果:', result)
      if (result.code == 200) {
        // 保存vkey供注册时使用
        if (result.data && result.data.vkey) {
          registerForm.value.vkey = result.data.vkey
        }
        ElMessage.success(proxy.$i18n.t('common.vcodeSentSuccess'))
        // 开始倒计时
        vcodeCountdown.value = 60
        vcodeTimer.value = setInterval(() => {
          vcodeCountdown.value--
          if (vcodeCountdown.value <= 0) {
            clearInterval(vcodeTimer.value)
            vcodeTimer.value = null
          }
        }, 1000)
      } else {
        ElMessage.error(result.msg || proxy.$i18n.t('common.sendCode') + '失败')
      }
    } catch (error) {
      console.error('发送验证码失败:', error)
      ElMessage.error(proxy.$i18n.t('common.sendCode') + '失败: ' + error.message)
    } finally {
      sendVcodeLoading.value = false
    }
  }

  // 处理注册提交
  const handleRegisterSubmit = async () => {
    if (!registerForm.value.phone) {
      ElMessage.warning(proxy.$i18n.t('common.enterPhone'))
      return
    }
    if (!registerForm.value.password) {
      ElMessage.warning(proxy.$i18n.t('common.enterPassword'))
      return
    }
    if (!registerForm.value.confirmPassword) {
      ElMessage.warning(proxy.$i18n.t('common.enterConfirmPassword'))
      return
    }
    if (registerForm.value.password !== registerForm.value.confirmPassword) {
      ElMessage.warning(proxy.$i18n.t('common.passwordMismatch'))
      return
    }
    if (!registerForm.value.vcode) {
      ElMessage.warning(proxy.$i18n.t('common.enterVCode'))
      return
    }
    if (!registerForm.value.vkey) {
      ElMessage.warning(proxy.$i18n.t('common.getVCodeFirst'))
      return
    }

    registerLoading.value = true
    try {
      const result = await Register(
        registerForm.value.phone,
        registerForm.value.password,
        registerForm.value.vcode,
        registerForm.value.vkey
      )

      if (result.code === 200 || result.code === 0) {
        ElMessage.success(proxy.$i18n.t('common.registerSuccess'))
        registerDialogVisible.value = false
        // 注册成功后自动填充登录表单
        syncAuthForm.value.username = registerForm.value.phone
        syncAuthForm.value.password = registerForm.value.password
        syncAuthDialogVisible.value = true
      } else {
        ElMessage.error(result.message || result.msg || proxy.$i18n.t('common.registerFailed'))
      }
    } catch (error) {
      console.error(proxy.$i18n.t('common.registerFailed') + ':', error)
      ElMessage.error(proxy.$i18n.t('common.registerFailed') + ': ' + error.message)
    } finally {
      registerLoading.value = false
    }
  }

  // 处理注册取消
  const handleRegisterCancel = () => {
    registerDialogVisible.value = false
    // 清除倒计时
    if (vcodeTimer.value) {
      clearInterval(vcodeTimer.value)
      vcodeTimer.value = null
      vcodeCountdown.value = 0
    }
  }

  // 忘记密码：打开弹窗
  const openForgotPasswordDialog = () => {
    forgotPasswordForm.value = { phone: '', newPassword: '', confirmPassword: '', vcode: '', vkey: '' }
    forgotPasswordErrors.value = { phone: '', newPassword: '', confirmPassword: '' }
    fpVcodeCountdown.value = 0
    if (fpVcodeTimer.value) {
      clearInterval(fpVcodeTimer.value)
      fpVcodeTimer.value = null
    }
    forgotPasswordDialogVisible.value = true
  }

  // 忘记密码：关闭弹窗
  const handleForgotPasswordClose = () => {
    forgotPasswordDialogVisible.value = false
    if (fpVcodeTimer.value) {
      clearInterval(fpVcodeTimer.value)
      fpVcodeTimer.value = null
      fpVcodeCountdown.value = 0
    }
  }

  // 忘记密码：获取验证码
  const sendForgotPasswordVcode = async () => {
    forgotPasswordErrors.value.phone = ''
    if (!forgotPasswordForm.value.phone) {
      forgotPasswordErrors.value.phone = '手机号码不能为空'
      return
    }
    const phoneReg = /^1[3-9]\d{9}$/
    if (!phoneReg.test(forgotPasswordForm.value.phone)) {
      forgotPasswordErrors.value.phone = '请输入正确的手机号'
      return
    }
    fpVcodeLoading.value = true
    try {
      const result = await GetPhoneVCode(forgotPasswordForm.value.phone, token.value || '')
      if (result.code == 200 || result.code == 0) {
        forgotPasswordForm.value.vkey = result.data && result.data.vkey ? result.data.vkey : ''
        ElMessage.success('验证码已发送')
        fpVcodeCountdown.value = 60
        fpVcodeTimer.value = setInterval(() => {
          fpVcodeCountdown.value--
          if (fpVcodeCountdown.value <= 0) {
            clearInterval(fpVcodeTimer.value)
            fpVcodeTimer.value = null
          }
        }, 1000)
      } else {
        ElMessage.error(result.msg || '发送验证码失败')
      }
    } catch (error) {
      console.error('发送验证码失败:', error)
      ElMessage.error('发送验证码失败: ' + error.message)
    } finally {
      fpVcodeLoading.value = false
    }
  }

  // 忘记密码：验证码按钮文字
  const fpVcodeButtonText = computed(() => {
    return fpVcodeCountdown.value > 0 ? `${fpVcodeCountdown.value}s后重试` : '获取验证码'
  })

  // 忘记密码：是否倒计时中
  const fpIsCountingDown = computed(() => fpVcodeCountdown.value > 0)

  // 忘记密码：提交重置
  const handleForgotPasswordSubmit = async () => {
    forgotPasswordErrors.value = { phone: '', newPassword: '', confirmPassword: '' }
    let hasError = false
    if (!forgotPasswordForm.value.phone) {
      forgotPasswordErrors.value.phone = '手机号码不能为空'
      hasError = true
    } else if (!/^1[3-9]\d{9}$/.test(forgotPasswordForm.value.phone)) {
      forgotPasswordErrors.value.phone = '请输入正确的手机号'
      hasError = true
    }
    if (!forgotPasswordForm.value.newPassword) {
      forgotPasswordErrors.value.newPassword = '新密码不能为空'
      hasError = true
    }
    if (!forgotPasswordForm.value.confirmPassword) {
      forgotPasswordErrors.value.confirmPassword = '确认新密码不能为空'
      hasError = true
    } else if (forgotPasswordForm.value.newPassword !== forgotPasswordForm.value.confirmPassword) {
      forgotPasswordErrors.value.confirmPassword = '两次输入的密码不一致'
      hasError = true
    }
    if (!forgotPasswordForm.value.vcode) {
      ElMessage.warning('请输入验证码')
      hasError = true
    }
    if (!forgotPasswordForm.value.vkey) {
      ElMessage.warning('请先获取验证码')
      hasError = true
    }
    if (hasError) return

    forgotPasswordLoading.value = true
    try {
      const resp = await fetch('https://www.moyunteng.com/api/api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          type: 'find_pwd',
          data: JSON.stringify({
            uname: forgotPasswordForm.value.phone,
            pwd: CryptoJS.MD5(forgotPasswordForm.value.newPassword).toString(),
            vcode: forgotPasswordForm.value.vcode,
            vkey: forgotPasswordForm.value.vkey
          })
        })
      })
      const result = await resp.json()
      if (result.code == 0 || result.code == 200) {
        ElMessage.success('密码重置成功，请重新登录')
        handleForgotPasswordClose()
        syncAuthDialogVisible.value = true
      } else {
        ElMessage.error(result.msg || '密码重置失败')
      }
    } catch (error) {
      console.error('密码重置失败:', error)
      ElMessage.error('密码重置失败: ' + error.message)
    } finally {
      forgotPasswordLoading.value = false
    }
  }

  // 忘记密码弹窗内跳转注册
  const openRegisterFromForgot = () => {
    handleForgotPasswordClose()
    openRegisterDialog()
  }

  // 处理批量认证提交
  const handleBatchAuthSubmit = async () => {
    // 只认证已输入密码的设备，未输入密码的跳过
    const devicesWithPassword = batchAuthDevices.value.filter(item => item.password && item.status !== 'success' && item.status !== 'verifying')
    if (devicesWithPassword.length === 0) {
      ElMessage.warning('请至少为一个设备输入密码')
      return
    }

    batchAuthLoading.value = true

    try {
      console.log(`[认证] 🚀 开始批量认证 ${devicesWithPassword.length} 个设备（共 ${batchAuthDevices.value.length} 个）`)

      // 并行验证已输入密码的设备
      const authPromises = devicesWithPassword.map(async (item) => {
        item.status = 'verifying'

        try {
          // 验证密码是否正确
          await getContainers(item.device, item.password)

          // 认证成功
          item.status = 'success'
          console.log(`[认证] ✅ 设备 ${item.device.ip} 认证成功`)

          // 认证成功，移除取消标记
          authCancelledDevices.value.delete(item.device.ip)

          // 保存密码到本地存储并同步到后端
          if (item.savePassword) {
            await saveDevicePassword(item.device.ip, item.password)
          }

          // 执行回调函数
          if (item.callback) {
            try {
              await item.callback(item.password)
            } catch (error) {
              console.error(`[认证] 回调执行失败 (${item.device.ip}):`, error)
            }
          }

          return { device: item.device.ip, success: true }
        } catch (error) {
          // 认证失败
          item.status = 'failed'
          item.errorMsg = '密码错误'
          console.error(`[认证] ❌ 设备 ${item.device.ip} 认证失败:`, error)
          return { device: item.device.ip, success: false, error: '密码错误' }
        }
      })

      // 等待所有认证完成
      const results = await Promise.all(authPromises)

      // 统计结果
      const successCount = results.filter(r => r.success).length
      const failCount = results.filter(r => !r.success).length

      console.log(`[认证] 📊 批量认证完成: 成功 ${successCount} 个, 失败 ${failCount} 个`)

      if (failCount === 0 && batchAuthDevices.value.every(item => item.status === 'success')) {
        // 全部成功（包括之前已成功的）
        ElMessage.success(`所有设备认证成功`)
        batchAuthDialogVisible.value = false
        batchAuthDevices.value = []
      } else if (successCount === 0 && failCount === 0) {
        // 没有新的认证结果（都是已成功的）
        batchAuthDialogVisible.value = false
        batchAuthDevices.value = []
      } else {
        if (successCount > 0) ElMessage.success(`${successCount} 个设备认证成功`)
        if (failCount > 0) ElMessage.error(`${failCount} 个设备认证失败，请检查密码`)
        // 移除成功的设备，保留失败的和无密码的继续输入
        batchAuthDevices.value = batchAuthDevices.value.filter(item => item.status !== 'success')
      }
    } catch (error) {
      console.error('[认证] 批量认证过程出错:', error)
      ElMessage.error('批量认证失败')
    } finally {
      batchAuthLoading.value = false
    }
  }

  // 处理批量认证取消
  const handleBatchAuthCancel = () => {
    console.log(`[认证] ⚠️ 用户取消批量认证，共 ${batchAuthDevices.value.length} 个设备`)

    // 取消认证的设备标记为离线，并记录到已取消列表，避免心跳重复弹窗
    batchAuthDevices.value.forEach(item => {
      const device = item.device
      devicesStatusCache.value.set(device.id, 'offline')
      authCancelledDevices.value.add(device.ip)
      // 清除该设备的缓存数据
      deviceVersionInfo.value.delete(device.id)
      deviceFirmwareInfo.value.delete(device.id)
      deviceCloudMachinesCache.value.set(device.ip, [])
      deviceAllInstancesCache.value.set(device.ip, [])
      // 如果是当前选中设备，清空云机列表
      if (activeDevice.value && activeDevice.value.ip === device.ip) {
        instances.value = []
        allInstances.value = []
        updateCloudMachines()
      }
    })

    batchAuthDialogVisible.value = false
    batchAuthDevices.value = []

    ElMessage.info('已取消设备认证，设备已标记为离线')
  }

  return {
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
  }
}
