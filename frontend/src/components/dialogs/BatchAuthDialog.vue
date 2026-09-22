<!--
  设备批量认证对话框

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 batchAuth* 换成组件内的通用名）。
  状态与逻辑仍留在 App.vue（在 useAuthForms 里），通过 props / emit 对接：
    - visible ←→ batchAuthDialogVisible
    - devices ←→ batchAuthDevices（数组按引用传入，子组件就地改 item.password / item.savePassword，
                并读 item.status / item.errorMsg 显示认证结果，等价于原来直接改）
    - loading ←→ batchAuthLoading
    - cancel → handleBatchAuthCancel
    - submit → handleBatchAuthSubmit
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    title="设备批量认证"
    width="600px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-alert
      :title="`需要对 ${devices.length} 个设备进行认证`"
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
          v-for="(item, index) in devices"
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
              @keyup.enter="emit('submit')"
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
        <el-button @click="emit('cancel')" :disabled="loading">取消</el-button>
        <el-button
          type="primary"
          @click="emit('submit')"
          :loading="loading"
          :disabled="devices.every(item => item.status === 'success')"
        >
          {{ loading ? '认证中...' : '确定' }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { CircleCheck, CircleClose } from '@element-plus/icons-vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  devices: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible', 'cancel', 'submit'])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
