<!--
  切换云机（备份列表）悬浮窗口

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 backup* 前缀换成组件内的通用名）。
  状态与逻辑仍留在 App.vue（多数在 useBackupListState 里），通过 props / emit 对接：
    - visible    ←→ backupListVisible
    - loading    ←→ backupLoading
    - sortedList ←→ sortedBackupList
    - sortBy / sortOrder ←→ 同名
    - selectedList ←→ selectedBackupList
    - tableRefSetter → 把本组件渲染出的 el-table 实例回写给 App.vue 的 backupTableRef
                       （useBackupListState 刷新后要靠它恢复勾选，所以表格实例必须能被它拿到）
    - change-sort / batch-delete / selection-change / switch / rename / delete → 同名处理函数
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('cloudMachine.switchBackup')"
    width="70%"
  >
    <!-- 切换云机时的覆盖层 -->
    <div
      v-if="loading"
      class="switching-backup-overlay-dialog"
    >
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>切换中...</span>
    </div>

    <!-- 坑位选择 -->
    <!-- <div class="backup-slot-section" style="margin-bottom: 16px;">
      <span class="backup-section-label">坑位：</span>
      <el-select
        v-model="currentSlot"
        placeholder="选择坑位"
        style="width: 150px; margin-right: 12px;"
        @change="initBackupList"
        :disabled="backupLoading"
      >
        <el-option
          v-for="i in 12"
          :key="i"
          :label="i"
          :value="i"
        ></el-option>
      </el-select>
    </div> -->


    <!-- 备份列表 -->
    <div class="backup-list-container">
      <!-- 排序栏和批量操作 -->
      <div class="backup-sort-bar" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; gap: 16px;">
          <span class="backup-section-label">{{ $t('common.sortBy') }}</span>
          <el-button
            type="link"
            size="small"
            @click="emit('change-sort', 'name')"
            :class="{ active: sortBy === 'name' }"
            :disabled="loading"
          >
            {{ $t('common.name') }} {{ sortBy === 'name' ? (sortOrder === 'ascending' ? '↑' : '↓') : '' }}
          </el-button>
          <el-button
            type="link"
            size="small"
            @click="emit('change-sort', 'createTime')"
            :class="{ active: sortBy === 'createTime' }"
            :disabled="loading"
          >
            {{ $t('common.createTimeSort') }} {{ sortBy === 'createTime' ? (sortOrder === 'ascending' ? '↑' : '↓') : '' }}
          </el-button>
        </div>
        <div>
          <span v-if="selectedList.length > 0" style="margin-right: 12px; color: var(--el-text-color-secondary);">{{ $t('common.selectedItems', { count: selectedList.length }) }}</span>
          <el-button
            type="danger"
            size="small"
            @click="emit('batch-delete')"
            :loading="loading"
            :disabled="loading || selectedList.length === 0"
          >
            {{ $t('common.batchDelete') }}
          </el-button>
        </div>
      </div>

      <!-- 备份列表表格 -->
      <el-table
        :data="sortedList"
        stripe
        size="small"
        style="width: 100%;"
        :disabled="loading"
        @selection-change="(rows) => emit('selection-change', rows)"
        :row-key="row => row.id"
        :ref="tableRefSetter"
      >
        <el-table-column type="selection" width="50"></el-table-column>
        <el-table-column prop="name" :label="$t('cloudMachine.backupName')" width="150" show-overflow-tooltip>
           <template #default="scope">
            {{ formatInstanceName(scope.row.name) }}
          </template>
        </el-table-column>
        <el-table-column prop="createTime" :label="$t('common.createTimeSort')" width="180"></el-table-column>
        <el-table-column :label="$t('cloudMachine.remark')">
          <template #default="scope">
            {{ getImageDisplayName(scope.row.remark) }}
          </template>
        </el-table-column>

        <el-table-column prop="status" :label="$t('common.status')" width="120">
          <template #default="scope">
            <el-tag size="small" type="info" style="padding: 2px 8px;">{{ scope.row.status === 'running' ? $t('cloudMachine.running') : (scope.row.status === 'shutdown' || scope.row.status === 'exited') ? $t('cloudMachine.shutdown') : scope.row.status === 'created' ? $t('cloudMachine.created') : $t('cloudMachine.restarting') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="scope">
            <el-button
              size="small"
              type="primary"
              @click="emit('switch', scope.row.id)"
              :loading="loading"
              :disabled="loading"
              style="margin-right: 8px;"
            >
              切换
            </el-button>
             <el-button
              size="small"
              type="primary"
              @click="emit('rename', scope.row)"
              style="margin-right: 8px;"
            >
              修改名称
            </el-button>
            <el-button
              size="small"
              type="danger"
              @click="emit('delete', scope.row.id)"
              :loading="loading"
              :disabled="loading"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div style="padding: 20px; text-align: center; color: var(--el-text-color-secondary);">
            当前坑位没有可用的备份
          </div>
        </template>
      </el-table>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import { formatInstanceName } from '../../utils/format.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  sortedList: { type: Array, default: () => [] },
  sortBy: { type: String, default: 'name' },
  sortOrder: { type: String, default: 'ascending' },
  selectedList: { type: Array, default: () => [] },
  // 函数式 prop：子组件把 el-table 实例回写给父组件（useBackupListState 里的 backupTableRef）
  tableRefSetter: { type: Function, default: null },
  getImageDisplayName: { type: Function, default: (v) => v },
})

const emit = defineEmits([
  'update:visible',
  'change-sort',
  'batch-delete',
  'selection-change',
  'switch',
  'rename',
  'delete',
])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
