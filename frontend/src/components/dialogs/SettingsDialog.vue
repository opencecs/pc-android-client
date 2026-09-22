<!--
  设置弹窗（文件保存路径 + APK 自动授权）

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 settings* / storagePathInfo 前缀换成组件内的通用名）。
  状态仍留在 App.vue，通过 props / emit 对接：
    - visible           ←→ settingsDialogVisible
    - storagePathInfo   ←→ storagePathInfo（对象按引用传入，子组件就地改属性即等价于原来直接改）
    - loading           ←→ settingsLoading
    - autoGrantApkPermission ←→ autoGrantApkPermission（双向）
    - select-directory / reset-storage-path / save → handleSelectDirectory / handleResetStoragePath / handleSaveSettings
  原模板里的 t('...') 与 $t('...') 等价（都走 globalProperties 上的同一份 i18n），本组件统一用 $t。
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.settings')"
    width="500px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div style="padding: 8px 0;">
      <div style="margin-bottom: 20px;">
        <div style="font-weight: bold; margin-bottom: 12px; color: var(--el-text-color-primary); font-size: 14px;">
          文件保存路径
        </div>
        <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 12px; line-height: 1.6;">
          设置下载镜像、本地机型、备份机型、备份云机等文件的保存位置。<br>
          默认保存在 C 盘系统目录，建议修改到其他磁盘以避免 C 盘空间不足。
        </div>

        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <el-input
            v-model="storagePathInfo.path"
            placeholder="请选择或输入保存路径"
            style="flex: 1;"
            :readonly="true"
          >
            <template #prefix>
              <el-icon><FolderOpened /></el-icon>
            </template>
          </el-input>
          <el-button
            type="primary"
            :loading="loading"
            @click="emit('select-directory')"
          >
            浏览
          </el-button>
        </div>

        <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
          <el-tag v-if="storagePathInfo.isDefault" type="info" size="small">当前为默认路径</el-tag>
          <el-tag v-else type="success" size="small">已自定义路径</el-tag>
          <el-button
            v-if="!storagePathInfo.isDefault"
            type="text"
            size="small"
            style="color: var(--el-text-color-secondary);"
            @click="emit('reset-storage-path')"
            :loading="loading"
          >
            恢复默认
          </el-button>
        </div>

        <div v-if="storagePathInfo.defaultPath" style="margin-top: 10px; font-size: 12px; color: var(--el-text-color-placeholder);">
          默认路径：{{ storagePathInfo.defaultPath }}
        </div>

        <el-alert
          title="修改保存路径后，已有文件不会自动迁移，请手动将旧目录中的文件复制到新路径。"
          type="warning"
          show-icon
          :closable="false"
          style="margin-top: 12px;"
        />
      </div>

      <!-- APK自动授权设置 -->
      <div style="margin-bottom: 20px;">
        <div style="font-weight: bold; margin-bottom: 12px; color: var(--el-text-color-primary); font-size: 14px;">
          {{ $t('common.autoGrantApkPermission') }}
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.6; flex: 1; padding-right: 16px;">
            {{ $t('common.autoGrantApkPermissionDesc') }}
          </div>
          <el-switch v-model="autoGrantModel" />
        </div>
      </div>
    </div>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="loading"
          @click="emit('save')"
        >
          保存
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { FolderOpened } from '@element-plus/icons-vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  storagePathInfo: { type: Object, default: () => ({ path: '', isDefault: true, defaultPath: '' }) },
  loading: { type: Boolean, default: false },
  autoGrantApkPermission: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:visible',
  'update:autoGrantApkPermission',
  'select-directory',
  'reset-storage-path',
  'save',
])

const dialogVisible = ref(false)

// 开关是父组件的 ref，这里做一层可写代理回抛
const autoGrantModel = computed({
  get: () => props.autoGrantApkPermission,
  set: (v) => emit('update:autoGrantApkPermission', v),
})

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
