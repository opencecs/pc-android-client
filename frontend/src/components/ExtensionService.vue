<template>
  <div class="extension-service-container" style="height: 100%; display: flex; gap: 12px;">
    <!-- 左侧：设备列表 -->
    <div class="device-list-panel" style="width: 45%; height: 100%;">
      <el-card shadow="hover" style="height: 100%; overflow: auto;">
        <template #header>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: bold;">{{ t('extension.deviceList') }}</span>
            <el-tag type="info" size="small">{{ devices.length }} {{ t('extension.onlineDevices') }}</el-tag>
          </div>
        </template>
        <el-table
          :data="devices"
          size="small"
          stripe
          highlight-current-row
          @current-change="handleDeviceSelect"
          style="width: 100%;"
          :row-class-name="getRowClassName"
        >
          <el-table-column :label="t('extension.deviceIP')" min-width="140" align="center">
            <template #default="scope">
              <span>{{ scope.row.ip }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('extension.deviceModel')" min-width="100" align="center">
            <template #default="scope">
              <el-tag size="small" type="info">{{ scope.row.name || t('extension.unknown') }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('extension.firmwareVersion')" min-width="120" align="center">
            <template #default="scope">
              <span>{{ formatFirmwareVersion(scope.row) }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('extension.firmwareStatus')" min-width="110" align="center">
            <template #default="scope">
              <el-tag
                v-if="getFirmwareCheck(scope.row).supported"
                :type="getFirmwareCheck(scope.row).isLatest ? 'success' : 'danger'"
                size="small"
              >
                {{ getFirmwareCheck(scope.row).isLatest ? t('extension.firmwareMet') : t('extension.firmwareNotMet') }}
              </el-tag>
              <el-tag v-else type="info" size="small">{{ t('extension.modelNotSupported') }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="服务状态" min-width="140" align="center">
            <template #default="scope">
              <div style="display: flex; gap: 4px; justify-content: center; flex-wrap: wrap;">
                <el-tag v-if="getDeviceServiceStatus(scope.row.ip).mytPanel" type="success" size="small">互联</el-tag>
                <el-tag v-if="getDeviceServiceStatus(scope.row.ip).tunnel" type="warning" size="small">穿透</el-tag>
                <el-tag v-if="getDeviceServiceStatus(scope.row.ip).mytAgent" type="primary" size="small">Agent</el-tag>
                <span v-if="!getDeviceServiceStatus(scope.row.ip).mytPanel && !getDeviceServiceStatus(scope.row.ip).tunnel && !getDeviceServiceStatus(scope.row.ip).mytAgent" style="color: #c0c4cc; font-size: 12px;">未安装</span>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <!-- 右侧：设备详情 + 操作 -->
    <div class="device-detail-panel" style="width: 55%; height: 100%; overflow: auto;">
      <div v-if="!selectedDevice" style="display: flex; align-items: center; justify-content: center; height: 100%;">
        <el-empty :description="t('extension.noDeviceSelected')" />
      </div>

      <div v-else style="display: flex; flex-direction: column; gap: 12px;">
        <!-- 设备信息卡片 -->
        <el-card shadow="hover">
          <template #header>
            <span style="font-weight: bold;">{{ selectedDevice.ip }} - {{ selectedDevice.name || t('extension.unknown') }}</span>
          </template>
          <el-descriptions :column="2" size="small" border>
            <el-descriptions-item :label="t('extension.deviceIP')">{{ selectedDevice.ip }}</el-descriptions-item>
            <el-descriptions-item :label="t('extension.deviceModel')">{{ selectedDevice.name || t('extension.unknown') }}</el-descriptions-item>
            <el-descriptions-item :label="t('extension.firmwareVersion')">{{ formatFirmwareVersion(selectedDevice) }}</el-descriptions-item>
            <el-descriptions-item :label="t('extension.requiredVersion')">
              <span style="font-weight: bold; color: #409EFF;">
                {{ getFirmwareCheck(selectedDevice).latestVersion || '-' }}
              </span>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 固件不满足条件时提示升级 -->
        <el-alert
          v-if="getFirmwareCheck(selectedDevice).supported && !getFirmwareCheck(selectedDevice).isLatest"
          type="warning"
          :closable="false"
          show-icon
        >
          <template #title>
            <span style="font-weight: bold;">{{ t('extension.firmwareNotMetAlert') }}</span>
          </template>
          <div style="margin-top: 8px;">
            <p>{{ t('extension.currentVersion') }}: {{ getFirmwareCheck(selectedDevice).currentVersion || t('extension.unknown') }}</p>
            <p>{{ t('extension.requiredVersion') }}: {{ getFirmwareCheck(selectedDevice).latestVersion }}</p>
          </div>
          <div style="margin-top: 12px;">
            <el-button type="primary" size="small" @click="openUrl('https://doc.opencecs.com/download')">
              {{ t('extension.upgradeFirmware') }}
            </el-button>
          </div>
        </el-alert>

        <!-- 不支持的型号 -->
        <el-alert
          v-if="!getFirmwareCheck(selectedDevice).supported"
          type="info"
          :closable="false"
          show-icon
        >
          <template #title>
            <span>{{ t('extension.modelNotSupported') }}</span>
          </template>
        </el-alert>

        <!-- 服务列表 -->
        <el-card shadow="hover">
          <template #header>
            <span style="font-weight: bold;">{{ t('extension.serviceList') }}</span>
          </template>

          <!-- 固件不满足时提示 -->
          <el-alert
            v-if="!canInstallService"
            type="warning"
            :closable="false"
            show-icon
            style="margin-bottom: 12px;"
          >
            <template #title>
              <span>{{ t('extension.firmwareNotMetAlert') }}</span>
            </template>
          </el-alert>

          <!-- 魔云互联 -->
          <div class="service-item">
            <div class="service-info">
              <div class="service-name">{{ t('extension.mytPanel') }}</div>
              <div class="service-desc">{{ t('extension.mytPanelDesc') }}</div>
            </div>
            <div class="service-actions">
              <el-button
                type="primary"
                size="small"
                :disabled="!canInstallService"
                :loading="installingMytPanel"
                @click="installMytPanel"
              >
                {{ t('extension.install') }}
              </el-button>
              <el-button
                type="danger"
                size="small"
                :disabled="!canInstallService"
                :loading="uninstallingMytPanel"
                @click="uninstallMytPanel"
              >
                {{ t('extension.uninstall') }}
              </el-button>
              <el-button
                type="info"
                size="small"
                @click="showUsageGuide('mytPanel')"
              >
                {{ t('extension.usageGuide') }}
              </el-button>
            </div>
          </div>
          <!-- 魔云互联面板信息 -->
          <div v-if="mytPanelStatus" class="service-status-box">
            <el-alert :type="mytPanelStatus.type" :closable="false" show-icon>
              <template #title>{{ mytPanelStatus.message }}</template>
            </el-alert>
            <div v-if="mytPanelStatus.url" style="margin-top: 8px; display: flex; gap: 8px;">
              <el-button type="primary" size="small" @click="openUrl(mytPanelStatus.url)">
                {{ t('extension.openPanel') }}
              </el-button>
            </div>
          </div>

          <el-divider style="margin: 12px 0;" />

          <!-- 公网穿透 -->
          <div class="service-item">
            <div class="service-info">
              <div class="service-name">{{ t('extension.tunnel') }}</div>
              <div class="service-desc">{{ t('extension.tunnelDesc') }}</div>
            </div>
            <div class="service-actions">
              <el-button type="primary" size="small" :disabled="!canInstallService" :loading="installingTunnel" @click="installTunnel">
                {{ t('extension.install') }}
              </el-button>
              <el-button type="danger" size="small" :disabled="!canInstallService" :loading="uninstallingTunnel" @click="uninstallTunnelAll">
                卸载
              </el-button>
              <el-button type="info" size="small" @click="showUsageGuide('tunnel')">
                {{ t('extension.usageGuide') }}
              </el-button>
            </div>
          </div>
          <!-- 公网穿透面板信息 -->
          <div v-if="tunnelStatus" class="service-status-box">
            <el-alert :type="tunnelStatus.type" :closable="false" show-icon>
              <template #title>{{ tunnelStatus.message }}</template>
            </el-alert>
            <div v-if="tunnelStatus.serverAddr" style="margin-top: 6px; font-size: 13px; color: #606266;">
              服务端地址: <span style="font-weight: 600;">{{ tunnelStatus.serverAddr }}:7500</span>
            </div>
            <div v-if="tunnelStatus.webAddress || tunnelStatus.remoteAddress" style="margin-top: 8px; display: flex; gap: 8px;">
              <el-button v-if="tunnelStatus.webAddress" type="primary" size="small" @click="openTunnelWeb(tunnelStatus)">
                Web管理界面
              </el-button>
              <el-button v-if="tunnelStatus.remoteAddress" type="success" size="small" @click="copyText(tunnelStatus.remoteAddress)">
                复制SSH地址
              </el-button>
            </div>
          </div>

          <el-divider style="margin: 12px 0;" />

          <!-- MYT Agent -->
          <div class="service-item">
            <div class="service-info">
              <div class="service-name">{{ t('extension.mytAgent') }}</div>
              <div class="service-desc">{{ t('extension.mytAgentDesc') }}</div>
              <div style="margin-top: 4px; font-size: 12px;">
                <span style="color: #909399;">{{ t('extension.mytAgentSdkRequired') }}: </span>
                <span :style="{ color: mytAgentSdkMet ? '#67C23A' : '#E6A23C', fontWeight: 'bold' }">
                  ≥ 177
                </span>
                <span style="color: #909399; margin-left: 8px;">{{ t('extension.mytAgentSdkCurrent') }}: </span>
                <span style="color: #606266; font-weight: bold;">
                  {{ getSdkIntVersion(selectedDevice) || '-' }}
                </span>
              </div>
              <div v-if="!mytAgentSdkMet" class="service-warn" style="margin-top: 4px; color: #E6A23C; font-size: 12px;">
                {{ t('extension.mytAgentSdkNotMet') }}
              </div>
            </div>
            <div class="service-actions">
              <el-button
                type="primary"
                size="small"
                :disabled="!mytAgentSdkMet"
                :loading="installingMytAgent"
                @click="installMytAgent"
              >
                {{ t('extension.install') }}
              </el-button>
              <el-button
                type="danger"
                size="small"
                :loading="uninstallingMytAgent"
                @click="uninstallMytAgent"
              >
                {{ t('extension.uninstall') }}
              </el-button>
              <el-button type="info" size="small" @click="openUrl('https://doc.opencecs.com/workflow/myt-agent')">
                {{ t('extension.usageGuide') }}
              </el-button>
            </div>
          </div>
          <!-- MYT Agent 面板信息 -->
          <div v-if="mytAgentStatus" class="service-status-box">
            <el-alert :type="mytAgentStatus.type" :closable="false" show-icon>
              <template #title>{{ mytAgentStatus.message }}</template>
            </el-alert>
            <div v-if="mytAgentStatus.agentWebUrl" style="margin-top: 8px; display: flex; gap: 8px;">
              <el-button type="primary" size="small" @click="openUrl(mytAgentStatus.agentWebUrl)">
                打开 Agent 面板
              </el-button>
            </div>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 使用说明对话框 -->
    <el-dialog
      v-model="usageDialogVisible"
      :title="usageDialogTitle"
      width="550px"
    >
      <div v-if="usageGuideType === 'mytPanel'" class="usage-guide">
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item :label="t('extension.sshAccount')">
            <span style="font-weight: bold;">user</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('extension.sshPassword')">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: bold;">{{ showPassword ? 'myt' : '****' }}</span>
              <el-button size="small" text type="primary" @click="showPassword = !showPassword">
                {{ showPassword ? t('extension.hidePassword') : t('extension.showPassword') }}
              </el-button>
              <el-button size="small" text type="primary" @click="copyText('myt')">{{ t('extension.copyPassword') }}</el-button>
            </div>
          </el-descriptions-item>
          <el-descriptions-item :label="t('extension.accessUrl')">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: bold; color: #409EFF;">{{ mytPanelURL }}</span>
              <el-button size="small" text type="primary" @click="copyText(mytPanelURL)">{{ t('extension.copyPassword') }}</el-button>
            </div>
          </el-descriptions-item>
        </el-descriptions>
        <el-divider />
        <div style="line-height: 2;">
          <p><strong>1.</strong> {{ t('extension.guideInstall') }}</p>
          <p><strong>2.</strong> {{ t('extension.guideAccess') }}</p>
          <p><strong>3.</strong> {{ t('extension.guideLogin') }}</p>
          <p><strong>4.</strong> {{ t('extension.guideSSH') }}</p>
        </div>
      </div>

      <div v-if="usageGuideType === 'tunnel'" class="usage-guide">
        <div style="line-height: 2; font-size: 14px;">
          <p><strong>什么是公网穿透？</strong></p>
          <p style="color: #909399;">公网穿透可以将内网设备的服务暴露到公网，让你从任何地方远程访问。</p>
          <el-divider />
          <p><strong>使用步骤：</strong></p>
          <p><strong>1.</strong> 准备一台有公网 IP 的 Linux 服务器</p>
          <p><strong>2.</strong> 在左侧选择设备，点击"安装"，填写服务器地址和SSH信息</p>
          <p><strong>3.</strong> 点击"一键安装"，系统将自动在服务器上部署frps服务端，并在设备上安装frpc客户端</p>
          <p><strong>4.</strong> 安装成功后，通过公网服务器的端口即可远程访问该设备</p>
          <p><strong>5.</strong> 安装成功后可点击"Web管理界面"按钮，可视化管理和配置代理规则</p>
          <el-divider />
          <p><strong>管理界面登录：</strong></p>
          <p>账号：<code style="background: #f5f7fa; padding: 2px 6px; border-radius: 4px;">admin</code></p>
          <p>密码：<code style="background: #f5f7fa; padding: 2px 6px; border-radius: 4px;">admin</code></p>
          <el-divider />
          <p><strong>参数说明：</strong></p>
          <p><strong>服务器地址：</strong>您的公网服务器 IP 地址</p>
          <p><strong>SSH端口：</strong>服务器 SSH 登录端口（默认 22）</p>
          <p><strong>frps绑定端口：</strong>frps 服务端监听端口（默认 7000）</p>
          <p style="margin-top: 8px;cursor: pointer;color: #409EFF;" @click="openUrl('https://gofrp.org/zh-cn/docs/')"> 查看 frp 官方文档</p>
        </div>
      </div>

      <div v-if="usageGuideType === 'mytAgent'" class="usage-guide">
        <div style="line-height: 2; font-size: 14px;">
          <p><strong>{{ t('extension.mytAgent') }}</strong></p>
          <p style="color: #909399;">{{ t('extension.mytAgentGuideIntro') }}</p>
          <el-divider />
          <p><strong>{{ t('extension.mytAgentGuideReq') }}</strong></p>
          <p><strong>1.</strong> {{ t('extension.mytAgentGuideStep1') }}</p>
          <p><strong>2.</strong> {{ t('extension.mytAgentGuideStep2') }}</p>
          <p><strong>3.</strong> {{ t('extension.mytAgentGuideStep3') }}</p>
        </div>
      </div>
    </el-dialog>

    <!-- 公网穿透安装配置对话框 -->
    <el-dialog
      v-model="tunnelConfigDialogVisible"
      title="安装公网穿透"
      width="500px"
      top="5vh"
    >
      <el-form label-position="top" size="default">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px;">
          <template #title>
            系统将自动在您的服务器上部署 frps 服务端，并在所选设备上安装 frpc 客户端
          </template>
        </el-alert>
        <el-form-item label="服务器地址">
          <el-input v-model="tunnelServerAddr" placeholder="请输入您的公网服务器IP地址" />
        </el-form-item>
        <el-form-item label="服务器SSH端口">
          <el-input-number v-model="tunnelServerSSHPort" :min="1" :max="65535" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="SSH用户名">
          <el-input v-model="tunnelServerSSHUser" />
        </el-form-item>
        <el-form-item label="SSH密码">
          <el-input v-model="tunnelServerSSHPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="frps绑定端口">
          <el-input-number v-model="tunnelServerPort" :min="1" :max="65535" style="width: 100%;" />
        </el-form-item>
        <el-divider content-position="center">管理界面登录（默认 admin）</el-divider>
        <el-form-item label="管理界面账号">
          <el-input v-model="tunnelDashboardUser" placeholder="默认 admin" />
        </el-form-item>
        <el-form-item label="管理界面密码">
          <el-input v-model="tunnelDashboardPassword" type="password" show-password placeholder="默认 admin" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tunnelConfigDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="installingTunnel" @click="doInstallTunnel">一键安装</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, getCurrentInstance } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { InstallMytPanel, UninstallMytPanel, InstallTunnel, UninstallTunnel, InstallTunnelServer, UninstallTunnelServer, OpenInBrowser } from '../../bindings/edgeclient/app'
import { getDevicePassword, saveDevicePassword } from '../services/api.js'

const { proxy } = getCurrentInstance()

const t = (key, params) => {
  const _ = proxy.$i18n.locale
  let text = proxy.$i18n.t(key)
  if (params) {
    Object.keys(params).forEach(param => {
      text = text.replace(`{${param}}`, params[param])
    })
  }
  return text
}

const props = defineProps({
  devices: {
    type: Array,
    default: () => []
  },
  deviceFirmwareInfo: {
    type: Map,
    default: () => new Map()
  },
  deviceVersionInfo: {
    type: Map,
    default: () => new Map()
  },
  devicesStatusCache: {
    type: Map,
    default: () => new Map()
  }
})

defineEmits(['upgrade-device'])

// 各型号最新固件版本要求
const LATEST_FIRMWARE_VERSIONS = {
  'r1q_v3': 'v0.2.0',
  'q1n_v3': 'v0.3.7',
  'q1_v3': 'v0.7.9',
  'c1_v3': 'v0.5.7',
  'r1s_v3': 'v0.4.6',
  'p1_v3': 'v0.8.0',
  'r1p_v3': 'v0.8.0',
}

// 状态
const selectedDevice = ref(null)
const showPassword = ref(false)
const installingMytPanel = ref(false)
const uninstallingMytPanel = ref(false)
const installingTunnel = ref(false)
const uninstallingTunnel = ref(false)
const installingMytAgent = ref(false)
const uninstallingMytAgent = ref(false)
// 每个服务独立的面板状态，互不影响
const mytPanelStatus = ref(null)
const tunnelStatus = ref(null)
const mytAgentStatus = ref(null)
const usageDialogVisible = ref(false)
const usageGuideType = ref('')
const usageDialogTitle = computed(() => {
  if (usageGuideType.value === 'mytPanel') return t('extension.mytPanel') + ' - ' + t('extension.usageGuide')
  if (usageGuideType.value === 'tunnel') return t('extension.tunnel') + ' - ' + t('extension.usageGuide')
  if (usageGuideType.value === 'mytAgent') return t('extension.mytAgent') + ' - ' + t('extension.usageGuide')
  return t('extension.usageGuide')
})

// ===== 持久化服务安装状态缓存 =====
// key: device.ip, value: { mytPanel, tunnel, mytAgent, mytPanelStatus, tunnelStatus, mytAgentStatus, tunnelServerAddr, tunnelServerPort }
const SERVICE_CACHE_KEY = 'extensionServiceStatusCache'
const loadServiceCache = () => {
  try {
    const raw = localStorage.getItem(SERVICE_CACHE_KEY)
    if (raw) return new Map(JSON.parse(raw))
  } catch (e) {
    console.error('[扩展服务] 加载缓存失败:', e)
  }
  return new Map()
}
const serviceStatusCache = ref(loadServiceCache())
const saveServiceCache = () => {
  try {
    localStorage.setItem(SERVICE_CACHE_KEY, JSON.stringify([...serviceStatusCache.value]))
  } catch (e) {
    console.error('[扩展服务] 保存缓存失败:', e)
  }
}
// 更新某设备的服务状态
const updateDeviceServiceStatus = (deviceIP, status) => {
  serviceStatusCache.value.set(deviceIP, { ...serviceStatusCache.value.get(deviceIP), ...status })
  saveServiceCache()
}
// 获取某设备的服务状态
const getDeviceServiceStatus = (deviceIP) => {
  return serviceStatusCache.value.get(deviceIP) || {}
}

// 提取标准 semver 版本号
const extractSemver = (v) => {
  if (!v) return '0.0.0'
  const match = String(v).match(/v?(\d+\.\d+\.\d+)/)
  return match ? match[1] : '0.0.0'
}

// 版本比较函数
const compareVersions = (v1, v2) => {
  const a = extractSemver(v1).split('.').map(Number)
  const b = extractSemver(v2).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0)
  }
  return 0
}

// 检查固件是否满足扩展服务要求
const getFirmwareCheck = (device) => {
  if (!device) return { supported: false, isLatest: false, currentVersion: '', latestVersion: '' }
  let modelName = (device.name || '').toLowerCase()
  const firmwareInfo = props.deviceFirmwareInfo.get(device.id)
  const sdkVer = firmwareInfo?.sdkVersion || ''

  // Q1_v3 需要通过固件版本区分 Q1n 和 Q1
  if (modelName === 'q1_v3') {
    if (sdkVer.toLowerCase().includes('q1n')) {
      modelName = 'q1n_v3'
    }
  }

  const latestVersion = LATEST_FIRMWARE_VERSIONS[modelName]
  if (!latestVersion) return { supported: false, isLatest: false, currentVersion: '', latestVersion: '', reason: 'unsupported_model' }
  const currentVersion = sdkVer
  const isLatest = compareVersions(currentVersion, latestVersion) >= 0
  return { supported: true, isLatest, currentVersion, latestVersion }
}

// 格式化固件版本
const formatFirmwareVersion = (device) => {
  if (!device) return t('extension.unknown')
  const firmwareInfo = props.deviceFirmwareInfo.get(device.id)
  if (!firmwareInfo?.sdkVersion) return t('extension.unknown')
  const match = firmwareInfo.sdkVersion.match(/v(\d+\.\d+\.\d+)/)
  return match ? `v${match[1]}` : firmwareInfo.sdkVersion
}

// 是否可以安装服务
const canInstallService = computed(() => {
  if (!selectedDevice.value) return false
  const check = getFirmwareCheck(selectedDevice.value)
  return check.supported && check.isLatest
})

// MYT Agent 要求 SDK 版本 >= 165
// SDK 整数版本来自设备 /info 接口的 currentVersion 字段（deviceVersionInfo）
const MYT_AGENT_MIN_SDK = 177
const getSdkIntVersion = (device) => {
  if (!device) return 0
  const versionInfo = props.deviceVersionInfo.get(device.id)
  const cur = versionInfo?.currentVersion
  const num = Number(cur)
  return isNaN(num) ? 0 : num
}
const mytAgentSdkMet = computed(() => {
  if (!selectedDevice.value) return false
  return getSdkIntVersion(selectedDevice.value) >= MYT_AGENT_MIN_SDK
})

// 魔云互联访问URL
const mytPanelURL = computed(() => {
  if (!selectedDevice.value) return ''
  return `http://${extractPureIP(selectedDevice.value.ip)}:8081`
})

// 提取纯IP
const extractPureIP = (ip) => {
  if (!ip) return ''
  if (ip.includes(':')) {
    const lastColon = ip.lastIndexOf(':')
    const afterColon = ip.slice(lastColon + 1)
    if (/^\d+$/.test(afterColon)) return ip.slice(0, lastColon)
  }
  return ip
}

// 选择设备
const handleDeviceSelect = (row) => {
  if (!row) return
  selectedDevice.value = row
  // 从缓存恢复该设备各服务的面板状态
  const cached = getDeviceServiceStatus(row.ip)
  mytPanelStatus.value = cached.mytPanelStatus || null
  tunnelStatus.value = cached.tunnelStatus || null
  mytAgentStatus.value = cached.mytAgentStatus || null
  // 恢复公网穿透服务器配置
  if (cached.tunnelServerAddr) tunnelServerAddr.value = cached.tunnelServerAddr
  if (cached.tunnelServerPort) tunnelServerPort.value = cached.tunnelServerPort
}

// 行样式
const getRowClassName = ({ row }) => {
  if (selectedDevice.value && row.id === selectedDevice.value.id) return 'current-row'
  return ''
}

// 复制文本
const copyText = (text) => {
  navigator.clipboard.writeText(text).then(() => {
    ElMessage.success(t('extension.copied'))
  }).catch(() => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    ElMessage.success(t('extension.copied'))
  })
}

// 打开URL（使用系统默认浏览器）
const openUrl = (url) => {
  OpenInBrowser(url)
}

// 打开公网穿透 Web 管理界面，自动携带设备 frpc 的真实管理凭据（免去手动输入）
// 使用 URL 内嵌 Basic Auth 格式：http://user:pass@host:port/
const openTunnelWeb = (status) => {
  if (!status || !status.webAddress) return
  let url = status.webAddress
  if (status.frpcWebUser && status.frpcWebPassword) {
    const [scheme, rest] = url.split('://')
    if (rest && !rest.includes('@')) {
      url = `${scheme}://${encodeURIComponent(status.frpcWebUser)}:${encodeURIComponent(status.frpcWebPassword)}@${rest}`
    }
  }
  openUrl(url)
}

// 显示使用说明
const showUsageGuide = (type) => {
  usageGuideType.value = type
  usageDialogVisible.value = true
}

// 安装魔云互联
const installMytPanel = async () => {
  if (!selectedDevice.value) return
  installingMytPanel.value = true
  mytPanelStatus.value = null
  try {
    const ip = extractPureIP(selectedDevice.value.ip)
    const result = await InstallMytPanel(ip)
    if (result.success) {
      const msg = result.url
        ? `${t('extension.installSuccess')} - ${t('extension.accessUrl')}: ${result.url}`
        : t('extension.installSuccess')
      mytPanelStatus.value = { type: 'success', message: msg, url: result.url || '' }
      updateDeviceServiceStatus(selectedDevice.value.ip, { mytPanel: true, mytPanelStatus: { type: 'success', message: msg, url: result.url || '' } })
      ElMessage.success(msg)
    } else {
      mytPanelStatus.value = { type: 'error', message: result.message || t('extension.installFailed') }
      ElMessage.error(result.message || t('extension.installFailed'))
    }
  } catch (e) {
    console.error('[扩展服务] 安装魔云互联失败:', e)
    mytPanelStatus.value = { type: 'error', message: t('extension.installFailed') + `: ${e.message || e}` }
    ElMessage.error(t('extension.installFailed') + `: ${e.message || e}`)
  } finally {
    installingMytPanel.value = false
  }
}

// 卸载魔云互联
const uninstallMytPanel = async () => {
  if (!selectedDevice.value) return
  try {
    await ElMessageBox.confirm(t('extension.uninstallConfirm'), t('extension.uninstall'), {
      confirmButtonText: t('extension.confirmUninstall'),
      cancelButtonText: t('extension.cancelUninstall'),
      type: 'warning',
    })
  } catch {
    return // 用户取消
  }
  uninstallingMytPanel.value = true
  mytPanelStatus.value = null
  try {
    const ip = extractPureIP(selectedDevice.value.ip)
    const result = await UninstallMytPanel(ip)
    if (result.success) {
      mytPanelStatus.value = { type: 'success', message: t('extension.uninstallSuccess') }
      updateDeviceServiceStatus(selectedDevice.value.ip, { mytPanel: false, mytPanelStatus: { type: 'success', message: t('extension.uninstallSuccess') } })
      ElMessage.success(t('extension.uninstallSuccess'))
    } else {
      mytPanelStatus.value = { type: 'error', message: result.message || t('extension.uninstallFailed') }
      ElMessage.error(result.message || t('extension.uninstallFailed'))
    }
  } catch (e) {
    console.error('[扩展服务] 卸载魔云互联失败:', e)
    mytPanelStatus.value = { type: 'error', message: t('extension.uninstallFailed') + `: ${e.message || e}` }
    ElMessage.error(t('extension.uninstallFailed') + `: ${e.message || e}`)
  } finally {
    uninstallingMytPanel.value = false
  }
}

// 安装公网穿透 - 需要填写服务器配置
const tunnelServerAddr = ref('')
const tunnelServerPort = ref(7000)
const tunnelServerSSHPort = ref(22)
const tunnelServerSSHUser = ref('root')
const tunnelServerSSHPassword = ref('')
const tunnelDashboardUser = ref('admin')
const tunnelDashboardPassword = ref('admin')
const tunnelConfigDialogVisible = ref(false)

const installTunnel = () => {
  if (!selectedDevice.value) return
  tunnelConfigDialogVisible.value = true
}

const doInstallTunnel = async () => {
  if (!tunnelServerAddr.value) {
    ElMessage.warning('请填写服务器地址')
    return
  }
  if (!tunnelServerSSHPassword.value) {
    ElMessage.warning('请填写SSH密码')
    return
  }
  tunnelConfigDialogVisible.value = false
  installingTunnel.value = true
  tunnelStatus.value = null
  try {
    // 第一步：在用户服务器上安装frps服务端
    ElMessage.info('正在安装服务端(frps)到服务器...')
    const serverResult = await InstallTunnelServer(
      tunnelServerAddr.value,
      tunnelServerSSHUser.value || 'user',
      tunnelServerSSHPassword.value || 'myt',
      tunnelServerSSHPort.value || 22,
      tunnelServerPort.value || 7000,
      7500,
      tunnelDashboardUser.value || 'admin',
      tunnelDashboardPassword.value || 'admin'
    )
    if (!serverResult.success) {
      tunnelStatus.value = { type: 'error', message: serverResult.message || '服务端安装失败' }
      ElMessage.error(serverResult.message || '服务端安装失败')
      return
    }
    if (serverResult.alreadyInstalled) {
      ElMessage.info('检测到服务端(frps)已安装且正在运行，跳过重新安装，直接安装客户端(frpc)到设备...')
    } else {
      ElMessage.success('服务端安装成功，正在安装客户端(frpc)到设备...')
    }

    // 第二步：在设备上安装frpc客户端
    const ip = extractPureIP(selectedDevice.value.ip)
    // frpc 管理界面凭据固定使用用户填写的密码（与命令安装时一致）
    // 不能使用 serverResult.dashboardPassword：那是 frps 服务端面板的密码，损坏会导致设备 frpc 管理界面无法登录
    const result = await InstallTunnel(ip, tunnelServerAddr.value, tunnelServerPort.value, '', tunnelDashboardUser.value || 'admin', tunnelDashboardPassword.value || 'admin')
    if (result.success) {
      const msg = result.message || t('extension.installSuccess')
      tunnelStatus.value = {
        type: 'success',
        message: msg,
        url: result.webAddress || result.remoteAddress || '',
        webAddress: result.webAddress || '',
        remoteAddress: result.remoteAddress || '',
        serverAddr: tunnelServerAddr.value,
        serverPort: tunnelServerPort.value || 7000,
        frpcWebUser: result.frpcWebUser || '',
        frpcWebPassword: result.frpcWebPassword || '',
      }
      updateDeviceServiceStatus(selectedDevice.value.ip, {
        tunnel: true,
        tunnelStatus: { ...tunnelStatus.value },
        tunnelServerAddr: tunnelServerAddr.value,
        tunnelServerPort: tunnelServerPort.value || 7000,
      })
      ElMessage.success(msg)
    } else {
      tunnelStatus.value = { type: 'error', message: result.message || t('extension.installFailed') }
      ElMessage.error(result.message || t('extension.installFailed'))
    }
  } catch (e) {
    console.error('[扩展服务] 安装公网穿透失败:', e)
    tunnelStatus.value = { type: 'error', message: t('extension.installFailed') + `: ${e.message || e}` }
    ElMessage.error(t('extension.installFailed') + `: ${e.message || e}`)
  } finally {
    installingTunnel.value = false
  }
}

// 构造设备 API 请求头（含 Basic Auth 鉴权）
// 复用全局设备密码表（与添加设备时输入的密码同一份存储）
const buildDeviceAuthHeaders = (device) => {
  if (!device) return {}
  const savedPassword = getDevicePassword(device.ip)
  if (!savedPassword) return {}
  const auth = btoa(`admin:${savedPassword}`)
  return { 'Authorization': `Basic ${auth}` }
}

// 请求设备密码（401 时弹窗让用户输入，成功后存入全局设备密码表）
const promptDevicePassword = async (device) => {
  if (!device) return null
  try {
    const { value: password } = await ElMessageBox.prompt(
      `请输入设备 ${device.ip} 的密码`,
      t('extension.deviceAuthRequired'),
      {
        confirmButtonText: t('extension.confirm'),
        cancelButtonText: t('extension.cancel'),
        inputType: 'password',
        inputPlaceholder: t('extension.devicePasswordPlaceholder'),
        closeOnClickModal: false,
      }
    )
    if (password) {
      await saveDevicePassword(device.ip, password)
      return password
    }
  } catch {
    return null
  }
  return null
}

// 安装 MYT Agent：调用设备端 http://ip:8000/mytVpn/start
const installMytAgent = async () => {
  if (!selectedDevice.value) return
  if (!mytAgentSdkMet.value) {
    ElMessage.warning(t('extension.mytAgentSdkNotMet'))
    return
  }
  installingMytAgent.value = true
  mytAgentStatus.value = null
  try {
    const ip = extractPureIP(selectedDevice.value.ip)
    const url = `http://${ip}:8000/mytVpn/start`
    const doRequest = async (headers) => {
      return await fetch(url, { method: 'POST', headers })
    }
    let headers = buildDeviceAuthHeaders(selectedDevice.value)
    let resp = await doRequest(headers)
    // 401 → 弹窗让用户输入密码后重试一次
    if (resp.status === 401) {
      const password = await promptDevicePassword(selectedDevice.value)
      if (!password) {
        mytAgentStatus.value = { type: 'error', message: t('extension.installFailed') }
        ElMessage.error(t('extension.installFailed'))
        return
      }
      headers = buildDeviceAuthHeaders(selectedDevice.value)
      resp = await doRequest(headers)
    }
    const text = await resp.text().catch(() => '')
    if (resp.ok) {
      mytAgentStatus.value = {
        type: 'success',
        message: t('extension.installSuccess'),
        agentWebUrl: 'https://agent.opencecs.com/'
      }
      updateDeviceServiceStatus(selectedDevice.value.ip, { mytAgent: true, mytAgentStatus: { ...mytAgentStatus.value } })
      ElMessage.success(t('extension.installSuccess'))
    } else {
      const msg = text || `${t('extension.installFailed')} (HTTP ${resp.status})`
      mytAgentStatus.value = { type: 'error', message: msg }
      ElMessage.error(msg)
    }
  } catch (e) {
    console.error('[扩展服务] 安装 MYT Agent 失败:', e)
    mytAgentStatus.value = { type: 'error', message: t('extension.installFailed') + `: ${e.message || e}` }
    ElMessage.error(t('extension.installFailed') + `: ${e.message || e}`)
  } finally {
    installingMytAgent.value = false
  }
}

// 卸载 MYT Agent：调用设备端 http://ip:8000/mytVpn/uninstall
const uninstallMytAgent = async () => {
  if (!selectedDevice.value) return
  try {
    await ElMessageBox.confirm(t('extension.uninstallConfirm'), t('extension.uninstall'), {
      confirmButtonText: t('extension.confirmUninstall'),
      cancelButtonText: t('extension.cancelUninstall'),
      type: 'warning',
    })
  } catch {
    return
  }
  uninstallingMytAgent.value = true
  mytAgentStatus.value = null
  try {
    const ip = extractPureIP(selectedDevice.value.ip)
    const url = `http://${ip}:8000/mytVpn/uninstall`
    const doRequest = async (headers) => {
      return await fetch(url, { method: 'POST', headers })
    }
    let headers = buildDeviceAuthHeaders(selectedDevice.value)
    let resp = await doRequest(headers)
    if (resp.status === 401) {
      const password = await promptDevicePassword(selectedDevice.value)
      if (!password) {
        mytAgentStatus.value = { type: 'error', message: t('extension.uninstallFailed') }
        ElMessage.error(t('extension.uninstallFailed'))
        return
      }
      headers = buildDeviceAuthHeaders(selectedDevice.value)
      resp = await doRequest(headers)
    }
    const text = await resp.text().catch(() => '')
    if (resp.ok) {
      mytAgentStatus.value = { type: 'success', message: t('extension.uninstallSuccess') }
      updateDeviceServiceStatus(selectedDevice.value.ip, { mytAgent: false, mytAgentStatus: { type: 'success', message: t('extension.uninstallSuccess') } })
      ElMessage.success(t('extension.uninstallSuccess'))
    } else {
      const msg = text || `${t('extension.uninstallFailed')} (HTTP ${resp.status})`
      mytAgentStatus.value = { type: 'error', message: msg }
      ElMessage.error(msg)
    }
  } catch (e) {
    console.error('[扩展服务] 卸载 MYT Agent 失败:', e)
    mytAgentStatus.value = { type: 'error', message: t('extension.uninstallFailed') + `: ${e.message || e}` }
    ElMessage.error(t('extension.uninstallFailed') + `: ${e.message || e}`)
  } finally {
    uninstallingMytAgent.value = false
  }
}

// 卸载公网穿透
// 一键卸载公网穿透（客户端+服务端）
const uninstallTunnelAll = async () => {
  if (!selectedDevice.value) return
  try {
    await ElMessageBox.confirm('确认卸载公网穿透？将卸载该设备上的 frpc 客户端。服务端 frps 不受影响，其他设备可继续使用。', '卸载公网穿透', {
      confirmButtonText: '确认卸载',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  uninstallingTunnel.value = true
  tunnelStatus.value = null
  try {
    // 卸载客户端（frpc）
    const ip = extractPureIP(selectedDevice.value.ip)
    const clientResult = await UninstallTunnel(ip)
    if (clientResult.success) {
      ElMessage.success('客户端卸载成功')
    } else {
      ElMessage.warning(clientResult.message || '客户端卸载失败')
    }

    tunnelStatus.value = { type: 'success', message: '公网穿透客户端已卸载，服务端不受影响' }
    updateDeviceServiceStatus(selectedDevice.value.ip, { tunnel: false, tunnelStatus: { type: 'success', message: '公网穿透客户端已卸载，服务端不受影响' } })
  } catch (e) {
    console.error('[扩展服务] 卸载公网穿透失败:', e)
    tunnelStatus.value = { type: 'error', message: `卸载失败: ${e.message || e}` }
    ElMessage.error(`卸载失败: ${e.message || e}`)
  } finally {
    uninstallingTunnel.value = false
  }
}
</script>

<style scoped>
.extension-service-container {
  padding: 0;
}

.device-list-panel :deep(.el-card__body) {
  padding: 0;
}

.service-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.service-info {
  flex: 1;
  min-width: 0;
}

.service-name {
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 4px;
}

.service-desc {
  color: #909399;
  font-size: 12px;
}

.service-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.service-status-box {
  margin-top: 10px;
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 6px;
}

.usage-guide p {
  margin: 0;
}
</style>
