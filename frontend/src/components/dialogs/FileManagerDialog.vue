<!--
  文件管理器对话框（云机端 / 本地端双栏）

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 fileManager* 换成组件内的通用名，
  并把路径的双向绑定改成 props + update: 事件）。
  状态与逻辑仍留在 App.vue（在 useFileManager 里），通过 props / emit 对接：
    - visible             ←→ fileManagerVisible
    - androidCurrentPath  ←→ androidCurrentPath（双向，云机侧路径；输入框 readonly）
    - localCurrentPath    ←→ localCurrentPath（双向，本地侧路径；与下载云机文件弹窗共用同一个 ref，
                            所以必须回写 App.vue，不能留在子组件里）
    - androidFileList / androidFileLoading / localFileList / localFileLoading ←→ 同名（只读展示）
    - formatFileSize ←→ 同名（App.vue 本地函数）
    - android-go-up / local-go-up           → androidGoUp / localGoUp
    - android-navigate / local-navigate     → androidNavigate / localNavigate（回传 row）
    - fetch-android-files / fetch-local-files → fetchAndroidFiles / fetchLocalFiles（回传 path）
    - local-select-directory               → localSelectDirectory
    - download-cloud-file                  → downloadCloudFile（回传 row）
  Back / Refresh / FolderOpened / Document 图标由本组件自己 import。
-->
<template>
  <el-dialog v-model="dialogVisible" :title="$t('cloudMachine.fileManager')" width="80%" top="5vh" :close-on-click-modal="false" destroy-on-close>
    <div class="file-manager-container">
      <!-- Android端 -->
      <div class="file-panel">
        <div class="file-panel-header">
          <span style="font-weight: 600;">{{ $t('common.cloudMachine') }}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <el-button size="small" @click="emit('android-go-up')" :disabled="androidCurrentPath === '/'"><el-icon><Back /></el-icon></el-button>
            <el-input v-model="androidCurrentPathModel" size="small" readonly style="flex: 1;" />
            <el-button size="small" @click="emit('fetch-android-files', androidCurrentPath)">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </div>
        </div>
        <el-table :data="androidFileList" v-loading="androidFileLoading" size="small" height="400" style="width: 100%;" @row-dblclick="(row) => emit('android-navigate', row)">
          <el-table-column width="30">
            <template #default="scope">
              <el-icon v-if="scope.row.isDir"><FolderOpened /></el-icon>
              <el-icon v-else><Document /></el-icon>
            </template>
          </el-table-column>
          <el-table-column prop="name" :label="$t('common.name')" show-overflow-tooltip />
          <el-table-column :label="$t('common.size')" width="100" align="right">
            <template #default="scope">
              {{ scope.row.isDir ? '-' : formatFileSize(scope.row.size) }}
            </template>
          </el-table-column>
          <el-table-column :label="$t('common.operation')" width="80" align="center">
            <template #default="scope">
              <el-button v-if="!scope.row.isDir" type="primary" size="small" link @click="emit('download-cloud-file', scope.row)">{{ $t('common.download') }}</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 本地端 -->
      <div class="file-panel">
        <div class="file-panel-header">
          <span style="font-weight: 600;">Windows</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <el-button size="small" @click="emit('local-go-up')" :disabled="!localCurrentPath"><el-icon><Back /></el-icon></el-button>
            <el-input v-model="localCurrentPathModel" size="small" style="flex: 1;" @keyup.enter="emit('fetch-local-files', localCurrentPath)" />
            <el-button size="small" @click="emit('local-select-directory')">
              <el-icon><FolderOpened /></el-icon>
            </el-button>
            <el-button size="small" @click="emit('fetch-local-files', localCurrentPath)">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </div>
        </div>
        <el-table :data="localFileList" v-loading="localFileLoading" size="small" height="400" style="width: 100%;" @row-dblclick="(row) => emit('local-navigate', row)">
          <el-table-column width="30">
            <template #default="scope">
              <el-icon v-if="scope.row.isDir"><FolderOpened /></el-icon>
              <el-icon v-else><Document /></el-icon>
            </template>
          </el-table-column>
          <el-table-column prop="name" :label="$t('common.name')" show-overflow-tooltip />
          <el-table-column :label="$t('common.size')" width="100" align="right">
            <template #default="scope">
              {{ scope.row.isDir ? '-' : formatFileSize(scope.row.size) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Back, Refresh, FolderOpened, Document } from '@element-plus/icons-vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  androidCurrentPath: { type: String, default: '/' },
  localCurrentPath: { type: String, default: '' },
  androidFileList: { type: Array, default: () => [] },
  androidFileLoading: { type: Boolean, default: false },
  localFileList: { type: Array, default: () => [] },
  localFileLoading: { type: Boolean, default: false },
  formatFileSize: { type: Function, default: (v) => v },
})

const emit = defineEmits([
  'update:visible',
  'update:androidCurrentPath',
  'update:localCurrentPath',
  'android-go-up',
  'android-navigate',
  'fetch-android-files',
  'local-go-up',
  'local-navigate',
  'local-select-directory',
  'fetch-local-files',
  'download-cloud-file',
])

const dialogVisible = ref(false)

const androidCurrentPathModel = computed({
  get: () => props.androidCurrentPath,
  set: (v) => emit('update:androidCurrentPath', v),
})
const localCurrentPathModel = computed({
  get: () => props.localCurrentPath,
  set: (v) => emit('update:localCurrentPath', v),
})

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
