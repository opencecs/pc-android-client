<!--
  上传 Google 证书弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 googleCert* 前缀换成组件内的通用名）。
  隐藏 input 与"选文件 / 重选"的点击逻辑一并搬进本组件；选中后把 File 对象上抛，
  由 App.vue 决定怎么存（googleCertFile / googleCertFileName）。
    - visible  ←→ googleCertDialogVisible
    - fileName ←→ googleCertFileName（只读展示用，由父组件控制，父组件打开弹窗时会清空）
    - loading  ←→ googleCertLoading
    - file-change → 选中的 File 对象
    - confirm     → submitGoogleCert
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.uploadGoogleCert')"
    width="460px"
    :close-on-click-modal="false"
  >
    <!-- 隐藏的文件选择 input，仅接受 pem / xml -->
    <input
      ref="googleCertInputRef"
      type="file"
      accept=".pem,.xml"
      style="display: none"
      @change="onGoogleCertFileChange"
    />

    <div style="padding: 8px 0;">
      <div style="margin-bottom: 12px; color: var(--el-text-color-regular); font-size: 13px;">
        {{ $t('common.supportedFormats') }}：<strong>.pem</strong>、<strong>.xml</strong>
      </div>

      <!-- 文件选择区 -->
      <div
        style="
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          border: 1px dashed #d9d9d9;
          border-radius: 6px;
          background: #fafafa;
          cursor: pointer;
        "
        @click="triggerGoogleCertInput"
      >
        <el-icon :size="22" style="color: #409eff; flex-shrink: 0;"><Upload /></el-icon>
        <span
          v-if="fileName"
          style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--el-text-color-primary); font-size: 14px;"
        >{{ fileName }}</span>
        <span v-else style="flex: 1; color: #aaa; font-size: 14px;">{{ $t('common.clickToSelectCert') }}</span>
        <el-button
          v-if="fileName"
          type="primary"
          link
          size="small"
          style="flex-shrink: 0;"
          @click.stop="triggerGoogleCertInput"
        >{{ $t('common.reselect') }}</el-button>
      </div>
    </div>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button
          type="primary"
          @click="emit('confirm')"
          :loading="loading"
          :disabled="!fileName"
        >
          {{ loading ? $t('common.uploading') : $t('common.confirmUpload') }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Upload } from '@element-plus/icons-vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  fileName: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible', 'file-change', 'confirm'])

const dialogVisible = ref(false)
const googleCertInputRef = ref(null)

// 点击"选择文件"按钮触发隐藏 input
const triggerGoogleCertInput = () => {
  googleCertInputRef.value && googleCertInputRef.value.click()
}

// 文件选择后把 File 对象上抛给父组件（父组件负责记录 File 与文件名）
const onGoogleCertFileChange = (e) => {
  const file = e.target.files[0]
  if (!file) return
  emit('file-change', file)
  // 重置 input 值，允许重复选同一文件也能触发 change
  e.target.value = ''
}

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
