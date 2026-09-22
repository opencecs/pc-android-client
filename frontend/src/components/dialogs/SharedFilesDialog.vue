<!--
  共享文件选择对话框（单机上传用）

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 sharedFiles* / selectedFiles 等换成组件内的通用名）。
  状态与逻辑仍留在 App.vue（多数在 useFileManager 里），通过 props / emit 对接：
    - visible        ←→ sharedFilesDialogVisible
    - loading        ←→ filesLoading
    - uploadLoading  ←→ uploadLoading
    - sharedDirInfo  ←→ singleUploadSharedDirInfo（对象按引用传入，只读展示 + 浏览按钮改它）
    - sharedDirLoading ←→ singleUploadSharedDirLoading
    - tree           ←→ sharedFileTree
    - selectedFiles  ←→ selectedFiles（数组按引用传入）
    - fileSortType / fileSortOrder ←→ 同名（只读展示）
    - change-file-sort / open-shared-directory / select-shared-dir / reset-shared-dir
    - node-selection-change / file-check-change / upload / upload-refresh → 同名处理函数
  toggleNodeExpanded 由本组件自己 import（与原 App.vue 同一个来源）。
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    title="选择要上传的文件"
    width="600px"
  >
    <div v-loading="loading" element-loading-text="加载文件中...">
      <div class="dialog-header" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <h3 style="margin: 0;">文件列表</h3>
          <el-button
            type="text"
            size="small"
            @click="emit('change-file-sort', 'name')"
            :class="{ 'sort-active': fileSortType === 'name' }"
          >
            名称 {{ fileSortType === 'name' ? (fileSortOrder === 'asc' ? '↑' : '↓') : '' }}
          </el-button>
          <el-button
            type="text"
            size="small"
            @click="emit('change-file-sort', 'time')"
            :class="{ 'sort-active': fileSortType === 'time' }"
          >
            时间 {{ fileSortType === 'time' ? (fileSortOrder === 'asc' ? '↑' : '↓') : '' }}
          </el-button>
        </div>
        <el-button type="primary" size="small" @click="emit('open-shared-directory')">
          打开共享目录
        </el-button>
      </div>

      <!-- 上传路径说明 -->
      <div style="margin-bottom: 8px; padding: 6px 12px; background: #ecf5ff; border-radius: 4px; border: 1px solid #d9ecff; font-size: 12px; color: #409eff;">
        📤 上传完成路径: /sdcard/upload/
      </div>

      <!-- 共享目录路径设置 -->
      <div style="margin-bottom: 12px; padding: 10px 12px; background: #f5f7fa; border-radius: 4px; border: 1px solid #e4e7ed;">
        <div style="font-size: 12px; color: var(--el-text-color-regular); margin-bottom: 8px; font-weight: 500;">📂 文件来源目录</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <el-input
            v-model="sharedDirInfo.path"
            placeholder="共享目录路径"
            size="small"
            :readonly="true"
            style="flex: 1;"
          />
          <el-button size="small" type="primary" :loading="sharedDirLoading" @click="emit('select-shared-dir')">
            浏览
          </el-button>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
          <el-tag v-if="sharedDirInfo.isDefault" type="info" size="small">默认目录</el-tag>
          <el-tag v-else type="success" size="small">自定义目录</el-tag>
          <el-button
            v-if="!sharedDirInfo.isDefault"
            type="text"
            size="small"
            style="color: var(--el-text-color-secondary); padding: 0;"
            :loading="sharedDirLoading"
            @click="emit('reset-shared-dir')"
          >
            恢复默认
          </el-button>
        </div>
      </div>

      <div v-if="tree" class="file-tree">
        <!-- 递归渲染目录树 -->
        <div class="tree-node">
          <div class="node-checkbox">
            <el-checkbox
              :model-value="isSharedDirectoryFullySelected(tree)"
              :indeterminate="isSharedDirectoryPartiallySelected(tree)"
              @change="() => emit('node-selection-change', tree)"
            ></el-checkbox>
          </div>
          <span class="node-icon" v-if="tree.isDir && tree.children && tree.children.length > 0" @click.stop="toggleNodeExpanded(tree)">
            {{ tree.expanded ? '▼' : '▶' }}
          </span>
          <span class="node-icon" v-else-if="tree.isDir">
            📁
          </span>
          <span class="node-name" @click="toggleNodeExpanded(tree)">{{ tree.name }}</span>
        </div>
        <!-- 递归渲染子节点 -->
        <template v-if="tree.expanded && tree.isDir && tree.children && tree.children.length > 0">
          <div class="tree-children">
            <div v-for="child in tree.children" :key="child.path">
              <div class="tree-node">
                <div class="node-checkbox" v-if="child.isDir">
                  <el-checkbox
                    :model-value="isSharedDirectoryFullySelected(child)"
                    :indeterminate="isSharedDirectoryPartiallySelected(child)"
                    @change="() => emit('node-selection-change', child)"
                  ></el-checkbox>
                </div>
                <div class="node-checkbox" v-else>
                  <el-checkbox
                    :model-value="selectedFiles.includes(child.path)"
                    @change="(val) => emit('file-check-change', child.path, val)"
                  >{{ child.name }}</el-checkbox>
                </div>
                <span class="node-icon" v-if="child.isDir && child.children && child.children.length > 0" @click.stop="toggleNodeExpanded(child)">
                  {{ child.expanded ? '▼' : '▶' }}
                </span>
                <span class="node-icon" v-else-if="child.isDir">
                  📁
                </span>
                <span class="node-name" v-if="child.isDir" @click="toggleNodeExpanded(child)">{{ child.name }}</span>
                <span class="node-size" v-if="!child.isDir">{{ (child.size / 1024).toFixed(2) }} KB</span>
                <span class="node-date" v-if="!child.isDir">{{ new Date(child.modTime * 1000).toLocaleString() }}</span>

              </div>
              <!-- 递归渲染子目录 -->
              <template v-if="child.expanded && child.isDir && child.children && child.children.length > 0">
                <div class="tree-children">
                  <div v-for="grandchild in child.children" :key="grandchild.path">
                    <div class="tree-node">
                      <div class="node-checkbox" v-if="grandchild.isDir">
                        <el-checkbox
                          :model-value="isSharedDirectoryFullySelected(grandchild)"
                          :indeterminate="isSharedDirectoryPartiallySelected(grandchild)"
                          @change="() => emit('node-selection-change', grandchild)"
                        ></el-checkbox>
                      </div>
                      <div class="node-checkbox" v-else>
                        <el-checkbox
                          :model-value="selectedFiles.includes(grandchild.path)"
                          @change="(val) => emit('file-check-change', grandchild.path, val)"
                        >{{ grandchild.name }}</el-checkbox>
                      </div>
                      <span class="node-icon" v-if="grandchild.isDir && grandchild.children && grandchild.children.length > 0" @click.stop="toggleNodeExpanded(grandchild)">
                        {{ grandchild.expanded ? '▼' : '▶' }}
                      </span>
                      <span class="node-icon" v-else-if="grandchild.isDir">
                        📁
                      </span>
                      <span class="node-name" v-if="grandchild.isDir" @click="toggleNodeExpanded(grandchild)">{{ grandchild.name }}</span>
                      <span class="node-size" v-if="!grandchild.isDir">{{ (grandchild.size / 1024).toFixed(2) }} KB</span>
                      <span class="node-date" v-if="!grandchild.isDir">{{ new Date(grandchild.modTime * 1000).toLocaleString() }}</span>

                    </div>
                    <!-- 递归渲染更深层次的子目录 -->
                    <template v-if="grandchild.expanded && grandchild.isDir && grandchild.children && grandchild.children.length > 0">
                      <div class="tree-children">
                        <div v-for="greatgrandchild in grandchild.children" :key="greatgrandchild.path">
                          <div class="tree-node">
                            <div class="node-checkbox" v-if="greatgrandchild.isDir">
                              <el-checkbox
                                :model-value="isSharedDirectoryFullySelected(greatgrandchild)"
                                :indeterminate="isSharedDirectoryPartiallySelected(greatgrandchild)"
                                @change="() => emit('node-selection-change', greatgrandchild)"
                              ></el-checkbox>
                            </div>
                            <div class="node-checkbox" v-else>
                              <el-checkbox
                                :model-value="selectedFiles.includes(greatgrandchild.path)"
                                @change="(val) => emit('file-check-change', greatgrandchild.path, val)"
                              >{{ greatgrandchild.name }}</el-checkbox>
                            </div>
                            <span class="node-icon" v-if="greatgrandchild.isDir && greatgrandchild.children && greatgrandchild.children.length > 0" @click.stop="toggleNodeExpanded(greatgrandchild)">
                              {{ greatgrandchild.expanded ? '▼' : '▶' }}
                            </span>
                            <span class="node-icon" v-else-if="greatgrandchild.isDir">
                              📁
                            </span>
                            <span class="node-name" v-if="greatgrandchild.isDir" @click="toggleNodeExpanded(greatgrandchild)">{{ greatgrandchild.name }}</span>
                            <span class="node-size" v-if="!greatgrandchild.isDir">{{ (greatgrandchild.size / 1024).toFixed(2) }} KB</span>
                            <span class="node-date" v-if="!greatgrandchild.isDir">{{ new Date(greatgrandchild.modTime * 1000).toLocaleString() }}</span>

                          </div>
                          <!-- 递归渲染更深层次的子目录 -->
                          <template v-if="greatgrandchild.expanded && greatgrandchild.isDir && greatgrandchild.children && greatgrandchild.children.length > 0">
                            <div class="tree-children">
                              <div v-for="deepchild in greatgrandchild.children" :key="deepchild.path">
                                <div class="tree-node">
                                  <div class="node-checkbox" v-if="deepchild.isDir">
                                    <el-checkbox
                                      :model-value="isSharedDirectoryFullySelected(deepchild)"
                                      :indeterminate="isSharedDirectoryPartiallySelected(deepchild)"
                                      @change="() => emit('node-selection-change', deepchild)"
                                    ></el-checkbox>
                                  </div>
                                  <div class="node-checkbox" v-else>
                                    <el-checkbox
                                      :model-value="selectedFiles.includes(deepchild.path)"
                                      @change="(val) => emit('file-check-change', deepchild.path, val)"
                                    >{{ deepchild.name }}</el-checkbox>
                                  </div>
                                  <span class="node-icon" v-if="deepchild.isDir">
                                    📁
                                  </span>
                                  <span class="node-name" v-if="deepchild.isDir">{{ deepchild.name }}</span>
                                  <span class="node-size" v-if="!deepchild.isDir">{{ (deepchild.size / 1024).toFixed(2) }} KB</span>
                                  <span class="node-date" v-if="!deepchild.isDir">{{ new Date(deepchild.modTime * 1000).toLocaleString() }}</span>
                                </div>
                              </div>
                            </div>
                          </template>
                        </div>
                      </div>
                    </template>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
      <div v-else class="no-files">
        <el-empty description="共享目录中没有文件"></el-empty>
        <el-button type="primary" style="margin-top: 16px;" @click="emit('open-shared-directory')">
          打开共享目录
        </el-button>
      </div>
    </div>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          @click="emit('upload')"
          :loading="uploadLoading"
          :disabled="selectedFiles.length === 0"
        >
          {{ uploadLoading ? '上传中...' : '上传' }}
        </el-button>
         <el-button
          type="primary"
          @click="emit('upload-refresh')"
        >
          刷新共享文件
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { toggleNodeExpanded } from '../../utils/fileTree.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  uploadLoading: { type: Boolean, default: false },
  sharedDirInfo: { type: Object, default: () => ({ path: '', isDefault: true, defaultPath: '' }) },
  sharedDirLoading: { type: Boolean, default: false },
  tree: { type: Object, default: null },
  selectedFiles: { type: Array, default: () => [] },
  fileSortType: { type: String, default: 'name' },
  fileSortOrder: { type: String, default: 'asc' },
  isSharedDirectoryFullySelected: { type: Function, default: () => false },
  isSharedDirectoryPartiallySelected: { type: Function, default: () => false },
})

const emit = defineEmits([
  'update:visible',
  'change-file-sort',
  'open-shared-directory',
  'select-shared-dir',
  'reset-shared-dir',
  'node-selection-change',
  'file-check-change',
  'upload',
  'upload-refresh',
])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
