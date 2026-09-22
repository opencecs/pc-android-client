<!--
  下载云机文件弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 download* / localCurrentPath 换成组件内的通用名）。
  状态仍留在 App.vue（在 useFileManager 里），通过 props / emit 对接：
    - visible    ←→ downloadCloudFileDialogVisible
    - loading    ←→ downloadCloudFileLoading
    - fileInfo   ←→ downloadFileInfo（对象按引用传入，只读展示）
    - currentPath ←→ localCurrentPath（双向）
    - select-directory → localSelectDirectory
    - confirm          → submitDownloadCloudFile
-->
<template>
  <el-dialog v-model="dialogVisible" :title="$t('common.download')" width="450px" :close-on-click-modal="false">
    <el-form label-width="100px">
      <el-form-item :label="$t('common.name')">
        <span>{{ fileInfo.name }}</span>
      </el-form-item>
      <el-form-item :label="$t('cloudMachine.savePath')">
        <div style="display: flex; align-items: center; gap: 8px; width: 100%;">
          <el-input v-model="currentPathModel" size="small" readonly style="flex: 1;" />
          <el-button size="small" @click="emit('select-directory')">
            <el-icon><FolderOpened /></el-icon>
          </el-button>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" @click="emit('confirm')" :loading="loading">{{ $t('common.confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { FolderOpened } from '@element-plus/icons-vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  fileInfo: { type: Object, default: () => ({ name: '' }) },
  currentPath: { type: String, default: '' },
})

const emit = defineEmits(['update:visible', 'update:currentPath', 'select-directory', 'confirm'])

const dialogVisible = ref(false)

const currentPathModel = computed({
  get: () => props.currentPath,
  set: (v) => emit('update:currentPath', v),
})

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
