<!--
  API 详情对话框

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 apiDetails* 换成组件内的通用名）。
  状态仍留在 App.vue（在 useDialogState 里），通过 props / emit 对接：
    - visible ←→ apiDetailsVisible
    - data    ←→ apiDetailsData（对象按引用传入，只读展示）
  copyToClipboard 由本组件自己 import（与原 App.vue 同一个来源）。
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.apiDetails')"
    width="600px"
    :close-on-click-modal="false"
    style="max-height: 600px;"
  >
    <div v-if="data" class="api-details-content">
      <div class="api-details-header">
        <p><strong>{{ $t('common.slot') }}:</strong> {{ data.slotNum }}</p>
        <p><strong>{{ $t('common.instanceName') }}:</strong> {{ data.instanceName }}</p>
        <p><strong>{{ $t('common.deviceIP') }}:</strong> {{ data.deviceIp }}</p>
        <p><strong>{{ $t('common.deviceVersion') }}:</strong> {{ data.deviceVersion }}</p>
      </div>

      <div class="api-details-table">
        <h4>{{ $t('common.portMappingInfo') }}</h4>
        <el-table :data="Object.values(data.portMappings)" size="small" class="port-mapping-table">
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
        <el-button @click="dialogVisible = false">{{ $t('common.close') }}</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { copyToClipboard } from '../../utils/clipboard.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  data: { type: Object, default: null },
})

const emit = defineEmits(['update:visible'])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
