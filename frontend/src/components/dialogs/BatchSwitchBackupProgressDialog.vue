<!--
  批量切换云机进度对话框

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 batchSwitchBackup* 换成组件内的通用名）。
  状态仍留在 App.vue（在 useBackupListState 里），全部是只读展示 + 关闭，通过 props / emit 对接：
    - visible    ←→ batchSwitchBackupProgressVisible
    - list       ←→ batchSwitchBackupProgressList
    - total / done ←→ batchSwitchBackupTotal / batchSwitchBackupDone
    - cloudManageMode ←→ cloudManageMode
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    title="批量切换云机进度"
    width="520px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="done >= total"
  >
    <div style="padding: 0 4px;">
      <!-- 总进度条 -->
      <div style="margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 13px; color: var(--el-text-color-regular);">总进度</span>
          <span style="font-size: 13px; color: var(--el-text-color-primary); font-weight: 500;">
            {{ done }} / {{ total }}
          </span>
        </div>
        <el-progress
          :percentage="total > 0 ? Math.round(done / total * 100) : 0"
          :status="done >= total
            ? (list.some(i => i.status === 'failed') ? 'exception' : 'success')
            : ''"
          :stroke-width="12"
        />
      </div>
      <!-- 每台云机进度列表 -->
      <div style="max-height: 320px; overflow-y: auto;">
        <div
          v-for="item in list"
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
        :disabled="done < total"
        @click="dialogVisible = false"
      >
        {{ done < total ? '处理中...' : '关闭' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Loading } from '@element-plus/icons-vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  list: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  done: { type: Number, default: 0 },
  cloudManageMode: { type: String, default: 'slot' },
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
