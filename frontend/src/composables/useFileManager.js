/**
 * 文件管理：云机/本地文件浏览器、共享目录文件树与选择、文件上传（含 APK）与批量上传、
 * 下载云机文件到本地。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态（fileManager* / shared* / downloadCloudFile* 等）随本特性一起搬进来，
 * 仍解构回 App.vue 顶层，模板引用不受影响。
 * ElMessage / wails binding / 纯工具函数由本模块自己 import。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getDevicePassword } from '../services/api.js'
import { extractPort9082 } from '../utils/device.js'
import { collectSharedFilePaths } from '../utils/fileTree.js'
import {
  HttpRequest,
  ListLocalDirFiles,
  SelectDirectory,
  DownloadCloudFile,
  SelectZipFile,
  InstallAPKs,
  InstallAPK,
  ListSharedDirFiles,
  UploadFileToCloudMachine,
  UploadFileToSharedDir,
  OpenSharedDirectory,
} from '../../bindings/edgeclient/app'

export function useFileManager({
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
}, lazyDeps = {}) {
  // 任务队列在 App.vue 下方才创建，用惰性依赖避免 TDZ
  const { addTaskToQueue, executeTask } = lazyDeps
  // 文件管理器
  const fileManagerVisible = ref(false)
  const fileManagerContainer = ref(null)
  const fileManagerDeviceIp = ref('')
  const androidCurrentPath = ref('/')
  const androidFileList = ref([])
  const androidFileLoading = ref(false)
  const localCurrentPath = ref('')
  const localFileList = ref([])
  const localFileLoading = ref(false)

  const getDeviceAddrForFiles = (ip) => {
    if (!ip) return ip
    const lastColon = ip.lastIndexOf(':')
    if (lastColon === -1) return ip + ':8000'
    return /^\d+$/.test(ip.slice(lastColon + 1)) ? ip : ip + ':8000'
  }

  const fetchAndroidFiles = async (path) => {
    if (!fileManagerDeviceIp.value) return
    androidFileLoading.value = true
    try {
      const container = fileManagerContainer.value
      const port = extractPort9082(container) || 9082
      const host = (container?.networkName === 'myt' || container?.networkMode === 'myt' || container?.network === 'myt') && container?.ip
        ? container.ip
        : fileManagerDeviceIp.value.split(':')[0]

      const result = await HttpRequest({
        url: `http://${host}:${port}/files?list=${path}`,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: ''
      })

      if (result.success && result.body) {
        const body = result.body
        if (body.code === 200 && body.files) {
          androidFileList.value = body.files.map(f => ({
            name: f.name || '',
            isDir: !!f.flag,
            size: f.length || 0,
            modTime: ''
          }))
          androidCurrentPath.value = path
        } else {
          androidFileList.value = []
        }
      } else {
        androidFileList.value = []
      }
    } catch (e) {
      console.error('获取Android文件列表失败:', e)
      androidFileList.value = []
    } finally {
      androidFileLoading.value = false
    }
  }

  const fetchLocalFiles = async (path) => {
    localFileLoading.value = true
    try {
      const result = await ListLocalDirFiles(path)
      if (result.success) {
        localFileList.value = result.files || []
        localCurrentPath.value = result.path || path
      } else {
        localFileList.value = []
      }
    } catch (e) {
      console.error('获取本地文件列表失败:', e)
      localFileList.value = []
    } finally {
      localFileLoading.value = false
    }
  }

  const androidNavigate = (item) => {
    if (!item.isDir) return
    const newPath = androidCurrentPath.value === '/' ? `/${item.name}` : `${androidCurrentPath.value}/${item.name}`
    fetchAndroidFiles(newPath)
  }

  const androidGoUp = () => {
    if (androidCurrentPath.value === '/') return
    const parts = androidCurrentPath.value.split('/').filter(Boolean)
    parts.pop()
    fetchAndroidFiles(parts.length ? '/' + parts.join('/') : '/')
  }

  const localSelectDirectory = async () => {
    try {
      const result = await SelectDirectory(localCurrentPath.value || '')
      if (result.success && result.path) {
        fetchLocalFiles(result.path)
      }
    } catch (e) {
      console.error('选择目录失败:', e)
    }
  }

  const localNavigate = (item) => {
    if (!item.isDir) return
    fetchLocalFiles(item.path || `${localCurrentPath.value}\\${item.name}`)
  }

  const localGoUp = () => {
    if (!localCurrentPath.value) return
    const parts = localCurrentPath.value.replace(/\\/g, '/').split('/')
    parts.pop()
    fetchLocalFiles(parts.join('\\'))
  }

  // 下载云机文件到本地
  const downloadCloudFileDialogVisible = ref(false)
  const downloadCloudFileLoading = ref(false)
  const downloadFileInfo = ref({ name: '', path: '' })

  const downloadCloudFile = (row) => {
    const filePath = androidCurrentPath.value === '/' ? `/${row.name}` : `${androidCurrentPath.value}/${row.name}`
    downloadFileInfo.value = { name: row.name, path: filePath }
    downloadCloudFileDialogVisible.value = true
  }

  const submitDownloadCloudFile = async () => {
    downloadCloudFileLoading.value = true
    try {
      const container = fileManagerContainer.value
      const port = extractPort9082(container) || 9082
      const host = (container?.networkName === 'myt' || container?.networkMode === 'myt' || container?.network === 'myt') && container?.ip
        ? container.ip
        : fileManagerDeviceIp.value.split(':')[0]

      const downloadURL = `http://${host}:${port}/download?path=${encodeURIComponent(downloadFileInfo.value.path)}`
      const saveDir = localCurrentPath.value || ''

      if (!saveDir) {
        ElMessage.warning('请先在右侧选择保存目录')
        downloadCloudFileLoading.value = false
        return
      }

      const result = await DownloadCloudFile(downloadURL, saveDir)
      if (result.success) {
        ElMessage.success(result.message || '下载成功')
        downloadCloudFileDialogVisible.value = false
        fetchLocalFiles(localCurrentPath.value)
      } else {
        ElMessage.error(result.message || '下载失败')
      }
    } catch (e) {
      console.error('下载文件失败:', e)
      ElMessage.error('下载失败')
    } finally {
      downloadCloudFileLoading.value = false
    }
  }

  const handleFileUpload = () => {
    console.log('handleFileUpload called')
    console.log('contextMenuContainer.value:', contextMenuContainer.value)
    console.log('activeDevice.value:', activeDevice.value)
    console.log('cloudMachines.value:', cloudMachines.value)

    const container = contextMenuContainer.value
    console.log('Using container from contextMenuContainer.value:', container)

    if (container) {
      contextMenuContainerId.value = container.containerId || container.id || container.indexNum || contextMenuSlot.value
      console.log('Set contextMenuContainerId.value:', contextMenuContainerId.value)

      // 确保我们有设备信息
      if (!activeDevice.value || !activeDevice.value.ip) {
        // 尝试从容器信息中获取设备IP
        let deviceIp = null

        // 检查容器对象的各种可能的设备IP属性
        if (container.deviceIp) {
          deviceIp = container.deviceIp
        } else if (container.device_ip) {
          deviceIp = container.device_ip
        } else if (container.ip) {
          deviceIp = container.ip
        }

        console.log('Extracted deviceIp:', deviceIp)

        if (deviceIp) {
          activeDevice.value = {
            ip: deviceIp,
            version: 'v3' // 默认版本
          }
          console.log('Set activeDevice.value:', activeDevice.value)
        } else {
          // 如果无法从容器中获取设备IP，尝试使用云机列表中的信息
          const cloudMachine = cloudMachines.value.find(cm => cm.indexNum === container.indexNum)
          if (cloudMachine && cloudMachine.deviceIp) {
            deviceIp = cloudMachine.deviceIp
            activeDevice.value = {
              ip: deviceIp,
              version: 'v3' // 默认版本
            }
            console.log('Set activeDevice.value from cloudMachine:', activeDevice.value)
          } else {
            // 作为最后的 fallback，使用一个默认的设备IP（仅用于测试）
            console.warn('No device IP found, using default for testing')
            activeDevice.value = {
              ip: '127.0.0.1',
              version: 'v3'
            }
          }
        }
      }

      console.log('Final activeDevice.value:', activeDevice.value)

      if (activeDevice.value && activeDevice.value.ip) {
        // 打开共享文件选择对话框
        loadSharedFiles()
      } else {
        console.error('Device info incomplete:', { activeDevice: activeDevice.value, container: container })
        ElMessage.error('设备信息不完整，无法上传文件')
      }
    } else {
      console.error('No container found in contextMenuContainer.value')
      ElMessage.error('未找到容器信息，无法上传文件')
    }
    closeContextMenu()
  }

  // 上传APKS - 使用后端文件选择对话框选择ZIP压缩包
  const handleApkUpload = async () => {
    const container = contextMenuContainer.value
    if (!container) {
      ElMessage.error('未找到容器信息')
      closeContextMenu()
      return
    }
    const containerId = container.containerId || container.id || container.indexNum || contextMenuSlot.value
    closeContextMenu()

    if (!activeDevice.value?.ip) {
      ElMessage.error('设备信息不完整，无法上传APKS')
      return
    }

    try {
      // 调用后端 Wails 文件选择对话框，选择ZIP压缩包
      const selectResult = await SelectZipFile()
      if (!selectResult.success || !selectResult.path) {
        if (selectResult.message && selectResult.message !== '用户取消选择') {
          ElMessage.error(selectResult.message)
        }
        return
      }

      const password = getDevicePassword(activeDevice.value.ip) || ''
      const fileName = selectResult.path.split(/[/\\]/).pop() || 'APKS压缩包'

      try {
        ElMessage.info(`正在上传: ${fileName}`)
        const result = await InstallAPKs(
          activeDevice.value.ip,
          containerId,
          selectResult.path,
          password
        )
        if (result.success) {
          let msg = result.message || 'APKS安装包上传成功'
          if (result.installData) {
            const installData = result.installData
            if (typeof installData === 'object') {
              const results = []
              if (Array.isArray(installData)) {
                installData.forEach(item => {
                  const name = item.name || item.packageName || item.fileName || ''
                  const status = item.success || item.status || item.result || ''
                  if (name || status) results.push(`${name}: ${status}`)
                })
              } else {
                Object.entries(installData).forEach(([key, val]) => {
                  results.push(`${key}: ${typeof val === 'object' ? JSON.stringify(val) : val}`)
                })
              }
              if (results.length > 0) msg += '\n' + results.join('\n')
            } else if (typeof installData === 'string') {
              msg += '\n' + installData
            }
          }
          if (result.installResult && typeof result.installResult === 'string') {
            msg += '\n' + result.installResult
          }
          ElMessage.success(msg)
        } else {
          let msg = result.message || 'APKS安装失败'
          if (result.installData) {
            msg += '\n' + (typeof result.installData === 'string' ? result.installData : JSON.stringify(result.installData))
          }
          ElMessage.error(msg)
        }
      } catch (error) {
        console.error('上传APKS失败:', error)
        ElMessage.error(`上传失败: ${error.message || error}`)
      }
    } catch (error) {
      console.error('选择文件失败:', error)
      ElMessage.error(`选择文件失败: ${error.message || error}`)
    }
  }

  // 排序文件树节点
  const sortFileTreeNode = (node) => {
    if (!node || !node.children || node.children.length === 0) {
      return
    }

    node.children.sort((a, b) => {
      // 目录始终在文件之前
      if (a.isDir && !b.isDir) return -1
      if (!a.isDir && b.isDir) return 1

      // 根据排序类型和顺序排序
      let comparison = 0
      if (fileSortType.value === 'name') {
        comparison = a.name.localeCompare(b.name, 'zh-CN')
      } else if (fileSortType.value === 'time') {
        comparison = (a.modTime || 0) - (b.modTime || 0)
      }

      return fileSortOrder.value === 'asc' ? comparison : -comparison
    })

    // 递归排序子目录
    node.children.forEach(child => {
      if (child.isDir) {
        sortFileTreeNode(child)
      }
    })
  }

  // 切换文件排序
  const changeFileSort = (type) => {
    if (fileSortType.value === type) {
      fileSortOrder.value = fileSortOrder.value === 'asc' ? 'desc' : 'asc'
    } else {
      fileSortType.value = type
      fileSortOrder.value = 'desc'
    }

    // 重新排序文件树
    if (sharedFileTree.value) {
      sortFileTreeNode(sharedFileTree.value)
    }
  }

  // 加载共享目录文件
  const loadSharedFiles = async () => {
    try {
      filesLoading.value = true
      loadSingleUploadSharedDirPath()
      const result = await ListSharedDirFiles()
      if (result.success) {
        sharedFiles.value = []
        sharedFileTree.value = result.tree
        sharedRootPath.value = result.rootPath
        selectedFiles.value = []

        // 排序文件树
        if (sharedFileTree.value) {
          sortFileTreeNode(sharedFileTree.value)
        }

        // 默认展开第一个shared目录
        if (sharedFileTree.value && sharedFileTree.value.isDir) {
          sharedFileTree.value.expanded = true
        }

        sharedFilesDialogVisible.value = true
      } else {
        ElMessage.error(`加载共享文件失败: ${result.message}`)
      }
    } catch (error) {
      ElMessage.error(`加载共享文件失败: ${error.message}`)
    } finally {
      filesLoading.value = false
    }
  }


  // 刷新共享目录
  const handleUploadRefresh = async () => {
    try {
      filesLoading.value = true
      const result = await ListSharedDirFiles()
      if (result.success) {
        sharedFiles.value = []
        sharedFileTree.value = result.tree
        sharedRootPath.value = result.rootPath
        selectedFiles.value = []

        // 排序文件树
        if (sharedFileTree.value) {
          sortFileTreeNode(sharedFileTree.value)
        }

        // 默认展开第一个shared目录
        if (sharedFileTree.value && sharedFileTree.value.isDir) {
          sharedFileTree.value.expanded = true
        }

        sharedFilesDialogVisible.value = true
        ElMessage.success('刷新成功')
      } else {
        ElMessage.error(`加载共享文件失败: ${result.message}`)
      }
    } catch (error) {
      ElMessage.error(`加载共享文件失败: ${error.message}`)
    } finally {
      filesLoading.value = false
    }
  }

  // 递归处理目录树，提取所有文件
  const processFileTree = (node, callback) => {
    if (node.isDir) {
      if (node.children && node.children.length > 0) {
        node.children.forEach(child => {
          processFileTree(child, callback)
        })
      }
    } else {
      callback(node)
    }
  }

  // 计算目录的选择状态
  const getDirectorySelectionState = (node) => {
    if (!node.isDir || !node.children || node.children.length === 0) {
      return selectedFiles.value.includes(node.path) ? 'checked' : 'unchecked'
    }

    let checkedCount = 0
    let totalCount = 0

    // 递归计算所有子文件的选择状态
    const calculateSelection = (currentNode) => {
      if (currentNode.isDir) {
        if (currentNode.children && currentNode.children.length > 0) {
          currentNode.children.forEach(child => calculateSelection(child))
        }
      } else {
        totalCount++
        if (selectedFiles.value.includes(currentNode.path)) {
          checkedCount++
        }
      }
    }

    calculateSelection(node)

    if (totalCount === 0) {
      return 'unchecked'
    } else if (checkedCount === totalCount) {
      return 'checked'
    } else if (checkedCount > 0) {
      return 'indeterminate'
    } else {
      return 'unchecked'
    }
  }

  // 处理文件选择变化
  const handleNodeSelectionChange = (node, isDirectoryClick = false) => {
    if (node.isDir && isDirectoryClick) {
      // 点击目录的选择框，全选或取消全选
      const files = []

      // 递归收集所有文件
      const collectFiles = (currentNode) => {
        if (currentNode.isDir) {
          if (currentNode.children && currentNode.children.length > 0) {
            currentNode.children.forEach(child => collectFiles(child))
          }
        } else {
          files.push(currentNode.path)
        }
      }

      collectFiles(node)

      // 检查目录是否已全选
      const allSelected = files.every(filePath => selectedFiles.value.includes(filePath))

      if (allSelected) {
        // 取消选择所有文件
        selectedFiles.value = selectedFiles.value.filter(filePath => !files.includes(filePath))
      } else {
        // 选择所有文件
        files.forEach(filePath => {
          if (!selectedFiles.value.includes(filePath)) {
            selectedFiles.value.push(filePath)
          }
        })
      }
    }
    // 文件的选择由v-model自动处理
  }



  // 判断共享目录是否全选
  const isSharedDirectoryFullySelected = (node) => {
    if (!node || !node.isDir) return false
    if (!node.children || node.children.length === 0) return false

    const filePaths = collectSharedFilePaths(node)
    if (filePaths.length === 0) return false

    return filePaths.every(filePath => selectedFiles.value.includes(filePath))
  }

  // 判断共享目录是否部分选中
  const isSharedDirectoryPartiallySelected = (node) => {
    if (!node || !node.isDir) return false
    if (!node.children || node.children.length === 0) return false

    const filePaths = collectSharedFilePaths(node)
    if (filePaths.length === 0) return false

    const allSelected = filePaths.every(filePath => selectedFiles.value.includes(filePath))
    if (allSelected) return false

    const someSelected = filePaths.some(filePath => selectedFiles.value.includes(filePath))
    return someSelected
  }

  // 处理共享目录选择变化
  const handleSharedNodeSelectionChange = (node) => {
    if (!node || !node.isDir || !node.children) return

    const filePaths = collectSharedFilePaths(node)
    const currentState = isSharedDirectoryFullySelected(node)
    const shouldCheck = !currentState

    if (shouldCheck) {
      selectedFiles.value = [...new Set([...selectedFiles.value, ...filePaths])]
    } else {
      selectedFiles.value = selectedFiles.value.filter(filePath => !filePaths.includes(filePath))
    }
  }

  // 处理共享文件勾选变化
  const handleSharedFileCheckChange = (path, checked) => {
    if (checked) {
      if (!selectedFiles.value.includes(path)) {
        selectedFiles.value = [...selectedFiles.value, path]
      }
    } else {
      selectedFiles.value = selectedFiles.value.filter(p => p !== path)
    }
  }



  // 处理上传文件到云机
  const handleUploadToCloudMachine = async () => {
    if (selectedFiles.value.length === 0) {
      ElMessage.warning('请选择要上传的文件')
      return
    }

    if (!activeDevice.value || !activeDevice.value.ip || !contextMenuContainerId.value) {
      ElMessage.error('设备信息不完整，无法上传文件')
      return
    }

    try {
      uploadLoading.value = true
      const savedPassword = getDevicePassword(activeDevice.value.ip)

      // 逐个上传文件
      let successCount = 0
      for (const filePath of selectedFiles.value) {
        // 检查是否是APK文件
        if (filePath.toLowerCase().endsWith('.apk')) {
          // 安装APK
          const result = await InstallAPK(
            activeDevice.value.ip,
            activeDevice.value.version || 'v3',
            contextMenuContainerId.value,
            filePath,
            savedPassword || '',
            { replace: true, test: true, grant: autoGrantApkPermission.value, deleteAfterInstall: false }
          )

          if (result.success) {
            successCount++
            ElMessage.success(`APK安装成功: ${filePath.split('\\').pop().split('/').pop()}`)


          } else {
            ElMessage.error(`APK安装失败: ${result.message}`)
          }
        } else {
          // 普通文件上传
          const result = await UploadFileToCloudMachine(
            activeDevice.value.ip,
            activeDevice.value.version || 'v3',
            contextMenuContainerId.value,
            filePath,
            savedPassword || ''
          )

          if (result.success) {
            successCount++
            const fileName = filePath.split('\\').pop().split('/').pop()
            ElMessage.success('文件上传成功')
          }
        }
      }

      if (successCount > 0) {
        sharedFilesDialogVisible.value = false
        sharedFilesDialogVisible.value = false
      }
    } catch (error) {
      ElMessage.error(`处理文件失败: ${error.message}`)
    } finally {
      uploadLoading.value = false
    }
  }

  // 打开共享目录
  const openSharedDirectory = async () => {
    try {
      const result = await OpenSharedDirectory()
      if (result.success) {
        ElMessage.success('已打开共享目录')
      } else {
        ElMessage.error(`打开共享目录失败: ${result.message}`)
      }
    } catch (error) {
      ElMessage.error(`打开共享目录失败: ${error.message}`)
    }
  }

  // 处理批量上传
  const handleBatchUpload = async (uploadData) => {
    const { files, machines, cloudManageMode, selectedCloudDevice, apkOptions } = uploadData

    if (!files || files.length === 0) {
      ElMessage.warning('没有选中的文件')
      return
    }

    if (!machines || machines.length === 0) {
      ElMessage.warning('没有选中的云机')
      return
    }

    // 按设备分组，每台设备单独创建上传任务
    const devicesMap = new Map()

    if (cloudManageMode === 'slot' && selectedCloudDevice) {
      // 坑位模式：所有机器在同一设备上
      const deviceIP = selectedCloudDevice.ip
      const deviceVersion = selectedCloudDevice.version || 'v3'
      devicesMap.set(deviceIP, {
        deviceIP,
        deviceVersion,
        machines: machines.map(m => {
          const containerId = m.containerId ?? m.containerID ?? m.id ?? m.name ?? m.indexNum ?? ''
          return {
            ...m,
            containerID: containerId === '' ? '' : String(containerId)
          }
        })
      })
    } else if (cloudManageMode === 'batch') {
      // 批量模式：按设备IP分组，不同机器可能在不同设备上
      for (const machine of machines) {
        const deviceIP = machine.deviceIp
        const deviceVersion = machine.deviceVersion || 'v3'

        if (!devicesMap.has(deviceIP)) {
          devicesMap.set(deviceIP, {
            deviceIP,
            deviceVersion,
            machines: []
          })
        }

        const deviceInfo = devicesMap.get(deviceIP)
        const containerId = machine.containerId ?? machine.containerID ?? machine.id ?? machine.name ?? machine.indexNum ?? ''
        deviceInfo.machines.push({
          ...machine,
          containerID: containerId === '' ? '' : String(containerId)
        })
      }
    }

    if (devicesMap.size === 0) {
      ElMessage.error('设备信息不完整，无法上传文件')
      return
    }

    // 为每个设备创建上传任务
    const uploadTasks = []
    for (const [deviceIP, deviceInfo] of devicesMap) {
      for (const filePath of files) {
        const isAPK = filePath.toLowerCase().endsWith('.apk')
        uploadTasks.push({
          filePath,
          isAPK,
          deviceIP: deviceInfo.deviceIP,
          deviceVersion: deviceInfo.deviceVersion,
          machines: deviceInfo.machines,
          apkOptions: apkOptions || {} // 传递 APK 安装选项
        })
      }
    }

    // 添加到任务队列
    const taskId = addTaskToQueue('uploadFile', uploadTasks, {
      fileCount: files.length,
      machineCount: machines.length,
      deviceCount: devicesMap.size,
      hasAPK: files.some(f => f.toLowerCase().endsWith('.apk')),
      apkOptions: apkOptions || {} // 保存到任务元数据
    })

    // 执行任务
    executeTask(taskId)

    // 关闭对话框
    batchUploadDialogVisible.value = false

    ElMessage.success(`批量上传任务已添加到队列，共 ${files.length} 个文件上传到 ${machines.length} 个云机（${devicesMap.size} 台设备）`)
  }

  // 处理文件选择
  const handleFileSelect = async (event) => {
    const files = event.target.files
    if (files.length === 0) return

    try {
      const file = files[0]

      if (activeDevice.value && activeDevice.value.ip && contextMenuContainerId.value) {
        try {
          const savedPassword = getDevicePassword(activeDevice.value.ip)
          // 尝试获取文件路径，兼容不同浏览器环境
          let filePath = file.name

          // 注意：在Wails环境中，我们需要使用特殊方法获取文件路径
          // 但由于直接传递File对象会导致postMessage错误，我们将使用后端方法来处理
          // 这里我们将文件名传递给后端，后端会处理实际的文件读取

          if (!filePath) {
            ElMessage.error('无法获取文件名')
            return
          }

          const result = await UploadFileToSharedDir(
            activeDevice.value.ip,
            activeDevice.value.version || 'v3',
            contextMenuContainerId.value,
            filePath,
            savedPassword || ''
          )

          if (result.success) {
            ElMessage.success(`文件上传成功: ${file.name}`)
          } else {
            ElMessage.error(`文件上传失败: ${result.message}`)
          }
        } catch (error) {
          ElMessage.error(`上传失败: ${error.message}`)
        }
      } else {
        ElMessage.error('设备信息不完整，无法上传文件')
      }
    } catch (error) {
      ElMessage.error(`处理文件失败: ${error.message}`)
    }

    // 清空文件输入，允许重复选择同一个文件
    event.target.value = ''
    // 清空存储的容器ID
    contextMenuContainerId.value = ''
  }

  return {
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
  }
}
