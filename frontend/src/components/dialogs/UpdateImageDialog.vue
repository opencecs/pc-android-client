<!--
  更新镜像对话框

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 updateImage* / handle* 等换成组件内的通用名）。
  状态与逻辑仍留在 App.vue（多数在 useCloudMachineUpdate / useCreateDialog 里），通过 props / emit 对接：
    - visible ←→ updateImageDialogVisible；loading ←→ updateImageLoading
    - container ←→ updateImageContainer；form ←→ updateImageForm（对象按引用传入，就地改属性）
    - filteredContainerImages / filteredImageList / vpcGroupList / vpcNodeList / networkCardList ←→ 同名
    - isActiveDevicePublic / hasMacVlan / fetchingNetworkCards / fetchingImages ←→ 同名
    - currentDeviceMacVlanInfo / activeDevice ←→ 同名
    - getImageDisplayName / getMacVlanIpPlaceholder ←→ 同名（函数式 prop）
    - vpc-group-change / network-card-type-change / image-select-change / cancel / submit → 同名处理函数
    - goto-public-nic → 原来内联写的 activeTab = 'network'; activeNetworkTab = 'public-nic'
  extractNodeDisplayName 由本组件自己 import（与原 App.vue 同一个来源）。
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.updateImage')"
    width="900px"
    :before-close="() => emit('cancel')"
  >
    <!-- 弹窗内容 -->
    <div class="create-dialog-content">
      <!-- 容器模式 (V2) -->
      <div v-if="container && container.androidType === 'V2'" class="create-dialog-container-mode" style="padding: 0 20px;">
        <div class="create-dialog-container-mode-title">{{ $t('common.updateImageWarning') }}</div>
        <el-form :model="form" label-width="100px">
          <el-form-item :label="$t('common.imageAddress')">
             <el-select v-model="form.imageSelect" :placeholder="$t('common.pleaseSelect')" style="width: 100%;">
              <el-option :label="$t('common.customImage')" value="custom"></el-option>
                <el-option 
                  v-for="image in filteredContainerImages" 
                  :key="image.url" 
                  :label="image.name" 
                  :value="image.url"
                ></el-option>
             </el-select>
             
             <!-- 自定义镜像URL输入框 -->
             <div v-if="form.imageSelect === 'custom'" style="margin-top: 10px;width: 100%;">
               <el-input 
                 v-model="form.customImageUrl" 
                 :placeholder="$t('common.enterCustomImageAddress')"
                 clearable
               ></el-input>
             </div>
          </el-form-item>

          <div style="display: flex; gap: 20px;">
            <el-form-item label="名称" style="flex: 1;">
              <el-input :value="container ? (() => {
                const nameParts = container.name.split('_');
                return nameParts[nameParts.length - 1] || container.name;
              })() : ''" disabled></el-input>
            </el-form-item>
            <!-- <el-form-item label="云机数量" style="flex: 1;">
              <el-input-number :model-value="1" disabled style="width: 100%;"></el-input-number>
            </el-form-item> -->
          </div>

          <el-form-item label="分辨率">
             <el-select v-model="form.resolution" placeholder="请选择" style="width: 100%;">
                <el-option label="720 X 1280" value="720x1280x320"></el-option>
                <el-option label="1080 X 1920" value="1080x1920x420"></el-option>
                <el-option label="自定义分辨率" value="custom"></el-option>
             </el-select>
             
             <!-- 自定义分辨率输入框 -->
             <div v-if="form.resolution === 'custom'" class="custom-resolution-container" style="margin-top: 15px;">
                <div style="display: flex; gap: 20px; margin-bottom: 15px;">
                  <div style="flex: 1; display: flex; align-items: center;">
                    <label style="width: 60px; color: var(--el-text-color-regular);">设备宽</label>
                    <el-input v-model="form.customResolution.width" style="flex: 1;"></el-input>
                  </div>
                  <div style="flex: 1; display: flex; align-items: center;">
                    <label style="width: 60px; color: var(--el-text-color-regular);">设备长</label>
                    <el-input v-model="form.customResolution.height" style="flex: 1;"></el-input>
                  </div>
                </div>
                <div style="display: flex; gap: 20px; align-items: center;">
                  <div style="flex: 1; display: flex; align-items: center;">
                    <label style="width: 60px; color: var(--el-text-color-regular);">DPI</label>
                    <el-input v-model="form.customResolution.dpi" style="flex: 1;"></el-input>
                  </div>
                  <div style="flex: 1; color: #f56c6c; font-size: 12px;">
                    请注意，自定义分辨率可能引发样式适配异常
                  </div>
                </div>
             </div>
          </el-form-item>

          <div style="display: flex; gap: 20px;">
            <el-form-item label="DNS 类型" style="flex: 1;">
              <el-select v-model="form.dns" placeholder="请选择" style="width: 100%;">
                <el-option label="阿里DNS(223.5.5.5)" value="223.5.5.5"></el-option>
                <el-option label="Google(8.8.8.8)" value="8.8.8.8"></el-option>
                <el-option label="自定义" value="custom"></el-option>
              </el-select>
            </el-form-item>
            <el-form-item label="DNS 地址" style="flex: 1;">
              <el-input v-if="form.dns === 'custom'" v-model="form.customDns" placeholder="223.5.5.5"></el-input>
              <el-input v-else :value="form.dns" disabled></el-input>
            </el-form-item>
          </div>
          
          <div style="display: flex; gap: 20px; align-items: center;">
            <el-form-item label="网络管理" style="flex: 1;">
              <el-select v-model="form.vpcGroupId" placeholder="选择分组" clearable @change="emit('vpc-group-change')" style="width: 130px;" :disabled="form.networkCardType === 'public' && form.macVlanIp">
                <el-option v-for="group in vpcGroupList" :key="group.id" :label="group.alias" :value="group.id" />
              </el-select>
              <el-select v-if="form.vpcGroupId && form.vpcSelectMode === 'specified'" v-model="form.vpcNodeId" placeholder="选择节点" style="width: 130px; margin-left: 10px;">
                <el-option v-for="node in vpcNodeList" :key="node.id" :label="extractNodeDisplayName(node.remarks)" :value="node.id" />
              </el-select>
              <el-radio-group v-if="form.vpcGroupId" v-model="form.vpcSelectMode" style="margin-left: 10px;">
                <el-radio label="specified">指定节点</el-radio>
                <el-radio label="random">随机节点</el-radio>
              </el-radio-group>
            </el-form-item>
          </div>

          <el-form-item label="网卡类型">
            <el-radio-group v-model="form.networkCardType" @change="emit('network-card-type-change')">
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
            
            <div v-if="form.networkCardType === 'public' && !hasMacVlan && !fetchingNetworkCards" style="margin-top: 5px; font-size: 12px; line-height: 1.2;">
              <span style="color: #F56C6C;">未检测到MacVlan配置，请前往网络管理-公有网卡创建</span>
            </div>
          </el-form-item>

          <el-form-item v-if="form.networkCardType === 'private'" label="网卡选择">
            <el-select
              v-model="form.mytBridgeName"
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

          <el-form-item v-if="form.networkCardType === 'public' && hasMacVlan" label="MacVlan IP">
            <el-input v-model="form.macVlanIp" :placeholder="getMacVlanIpPlaceholder()"></el-input>
            
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
            <el-switch v-model="form.enforce" :active-text="$t('common.enable')" :inactive-text="$t('common.disable')" inline-prompt></el-switch>
          </el-form-item>
        </el-form>
      </div>

      <!-- 模拟器模式 (V0/V1/V3) -->
      <div v-else class="create-dialog-left-right">
        <!-- 左侧内容 -->
        <div class="create-dialog-left">
          <el-form :model="form" label-width="100px">
            <el-form-item label="设备IP">
              <el-input :value="activeDevice ? activeDevice.ip : ''" disabled></el-input>
            </el-form-item>
            <el-form-item label="容器名称">
              <el-input :value="container ? (() => {
                const nameParts = container.name.split('_');
                return nameParts[nameParts.length - 1] || container.name;
              })() : ''" disabled></el-input>
            </el-form-item>
            <el-form-item label="当前镜像">
              <el-input :value="container ? getImageDisplayName(container.image) : ''" disabled></el-input>
            </el-form-item>
            <!-- V3设备显示型号选择 -->
            <!-- <el-form-item v-if="activeDevice && activeDevice.version === 'v3'" label="手机型号">
              <el-select v-model="form.modelName" placeholder="请选择手机型号" :loading="fetchingModels" filterable>
                <el-option 
                  v-for="model in phoneModels" 
                  :key="model.id" 
                  :label="model.name" 
                  :value="model.name"
                ></el-option>
              </el-select>
            </el-form-item> -->
            <el-form-item :label="$t('common.imageSelection')">
              <el-select v-model="form.imageSelect" @change="emit('image-select-change')" :loading="fetchingImages" style="width: 100%;" filterable>
                <el-option :label="$t('common.customImage')" value="custom"></el-option>
                <!-- 使用从API获取的镜像列表（按 os_ver 过滤） -->
                <el-option 
                  v-for="image in filteredImageList" 
                  :key="image.url" 
                  :label="image.name" 
                  :value="image.url"
                ></el-option>
              </el-select>
            </el-form-item>
            <el-form-item v-if="form.imageSelect === 'custom'" :label="$t('common.customImageAddress')">
              <el-input v-model="form.customImageUrl" :placeholder="$t('common.enterImageAddress')"></el-input>
            </el-form-item>
            <el-form-item label="DNS地址">
              <el-select v-model="form.dns" placeholder="请选择DNS地址">
                <el-option label="223.5.5.5 (阿里云)" value="223.5.5.5"></el-option>
                <el-option label="8.8.8.8 (Google)" value="8.8.8.8"></el-option>
                <el-option label="自定义" value="custom"></el-option>
              </el-select>
              <el-input v-if="form.dns === 'custom'" v-model="form.customDns" placeholder="输入自定义DNS地址" style="margin-top: 10px;"></el-input>
            </el-form-item>
            
            <el-form-item label="网络管理">
              <el-select v-model="form.vpcGroupId" placeholder="选择分组" clearable @change="emit('vpc-group-change')" :disabled="form.networkCardType === 'public' && form.macVlanIp" style="width: 130px;">
                <el-option v-for="group in vpcGroupList" :key="group.id" :label="group.alias" :value="group.id" />
              </el-select>
              <el-select v-if="form.vpcGroupId && form.vpcSelectMode === 'specified'" v-model="form.vpcNodeId" placeholder="选择节点" style="width: 130px; margin-left: 10px;">
                <el-option v-for="node in vpcNodeList" :key="node.id" :label="extractNodeDisplayName(node.remarks)" :value="node.id" />
              </el-select>
              <el-radio-group v-if="form.vpcGroupId" v-model="form.vpcSelectMode">
                <el-radio label="specified">指定节点</el-radio>
                <el-radio label="random">随机节点</el-radio>
              </el-radio-group>
            </el-form-item>
            
            <el-form-item label="随机系统文件">
              <el-switch v-model="form.randomFile"></el-switch>
            </el-form-item>

            <el-form-item :label="$t('common.secureMode')">
              <el-switch v-model="form.enforce" :active-text="$t('common.enable')" :inactive-text="$t('common.disable')" inline-prompt></el-switch>
            </el-form-item>
          </el-form>
        </div>
        
        <!-- 右侧内容 -->
        <div class="create-dialog-right">
          <el-form :model="form" label-width="100px">
            <!-- V3设备显示高级选项 -->
            <el-form-item v-if="activeDevice && activeDevice.version === 'v3'" label="高级选项">
              <el-checkbox v-model="form.enableMagisk">启用Magisk</el-checkbox>
              <el-checkbox v-model="form.enableGMS" style="margin-left: 20px;">启用GMS</el-checkbox>
            </el-form-item>
            <!-- V3设备网卡选择 -->
            <template v-if="activeDevice && activeDevice.version === 'v3'">
              <el-form-item label="网卡类型">
                <el-radio-group v-model="form.networkCardType" @change="emit('network-card-type-change')">
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
                <div v-if="form.networkCardType === 'public' && !hasMacVlan && !fetchingNetworkCards" style="margin-top: 5px; font-size: 12px; line-height: 1.2;">
                  <span style="color: #F56C6C;">
                    未检测到MacVlan配置，请前往<span style="color: #409EFF; cursor: pointer; text-decoration: underline;" @click="emit('goto-public-nic')">网络管理-公有网卡</span>创建
                  </span>
                </div>
              </el-form-item>
              
              
              <el-form-item label="网卡选择" v-if="form.networkCardType === 'private'" key="update-nic-select">
                <el-select 
                  v-model="form.mytBridgeName" 
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
                v-if="form.networkCardType === 'public' && hasMacVlan" 
                label="MacVlan IP"
              >
                 <el-input v-model="form.macVlanIp" :placeholder="getMacVlanIpPlaceholder()"></el-input>
                 
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
        <el-button @click="emit('cancel')">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="emit('submit')" :loading="loading">{{ $t('common.confirm') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { extractNodeDisplayName } from '../../utils/format.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  container: { type: Object, default: null },
  form: { type: Object, default: () => ({}) },
  filteredContainerImages: { type: Array, default: () => [] },
  filteredImageList: { type: Array, default: () => [] },
  vpcGroupList: { type: Array, default: () => [] },
  vpcNodeList: { type: Array, default: () => [] },
  networkCardList: { type: Array, default: () => [] },
  isActiveDevicePublic: { type: Boolean, default: false },
  hasMacVlan: { type: Boolean, default: false },
  fetchingNetworkCards: { type: Boolean, default: false },
  fetchingImages: { type: Boolean, default: false },
  currentDeviceMacVlanInfo: { type: Object, default: () => ({}) },
  activeDevice: { type: Object, default: null },
  getImageDisplayName: { type: Function, default: (v) => v },
  getMacVlanIpPlaceholder: { type: Function, default: () => '' },
})

const emit = defineEmits([
  'update:visible',
  'vpc-group-change',
  'network-card-type-change',
  'image-select-change',
  'goto-public-nic',
  'cancel',
  'submit',
])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
