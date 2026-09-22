<!--
  设备选择对话框（上传镜像前选设备）

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 showDeviceSelectionDialog 等换成组件内的通用名）。
  状态与逻辑仍留在 App.vue，通过 props / emit 对接：
    - visible       ←→ showDeviceSelectionDialog
    - devices       ←→ sortedCompatibleDevicesList（只读展示）
    - devicesStatusCache    ←→ 同名（ref(new Map()) 里的 Map，按引用传入，只读 .get）
    - refreshingDevicesForUpload / uploading ←→ refreshingDevicesForUpload / isUploadingToMultipleDevices
    - getDeviceStorageInfo / getDeviceRowClassName / checkDeviceSelectable
                    ←→ 同名函数（App.vue 本地定义，闭包依赖 devicesStatusCache，按 Function prop 传入）
    - tableRefSetter ←→ setDeviceSelectionTableRef（把 el-table 实例交回 App.vue：
                        handleDeviceSelectionDialogClose 里要用 clearSelection() 清掉勾选）
    - close            → handleDeviceSelectionDialogClose
    - refresh          → refreshDeviceListForUpload
    - selection-change → handleUploadDeviceSelectionChange（回传 selection）
    - upload           → handleUploadAfterDeviceSelection
  三处 t(...) 改写为 $t(...)：原 App.vue 的本地 t 与全局 $t 都读同一个响应式 locale，
  且这三处（dialog.addDeviceTitle / common.cancel / common.upload）都不带参数，行为一致。
  Refresh 图标由本组件自己 import。
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('dialog.addDeviceTitle')"
    width="600px"
    :close-on-click-modal="false"
    @close="emit('close')"
  >
    <!-- 上传进度已整合到任务列表 -->

    <div class="device-selection-container">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h4 style="margin: 0;">
          {{ $t('common.pleaseSelectDeviceForUpload') }}
          <span style="color: #409eff; font-weight: 500; margin-left: 8px;">
            ({{ $t('model.onlineDeviceCount', { count: devices.length }) }})
          </span>
        </h4>
        <el-button
          type="primary"
          size="small"
          :icon="Refresh"
          @click="emit('refresh')"
          :loading="refreshingDevicesForUpload"
        >
          刷新列表
        </el-button>
      </div>

      <!-- 空状态提示 -->
      <div v-if="devices.length === 0" class="empty-devices">
        <el-empty :description="$t('common.noCompatibleDevices')" :image-size="100"></el-empty>
      </div>

      <!-- 设备列表 -->
      <el-table
        v-else
        :ref="tableRefSetter"
        :data="devices"
        stripe
        size="small"
        max-height="400"
        class="device-selection-table"
        @selection-change="(selection) => emit('selection-change', selection)"
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
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button
          type="primary"
          @click="emit('upload')"
          :loading="uploading"
        >
          {{ $t('common.upload') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  devices: { type: Array, default: () => [] },
  devicesStatusCache: { type: Object, default: () => new Map() },
  refreshingDevicesForUpload: { type: Boolean, default: false },
  uploading: { type: Boolean, default: false },
  getDeviceStorageInfo: { type: Function, default: () => null },
  getDeviceRowClassName: { type: Function, default: () => '' },
  checkDeviceSelectable: { type: Function, default: () => true },
  tableRefSetter: { type: Function, default: null },
})

const emit = defineEmits([
  'update:visible',
  'close',
  'refresh',
  'selection-change',
  'upload',
])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
