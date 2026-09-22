<!--
  设置 VPC 弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 vpcSet* 前缀换成组件内的通用名）。
  状态仍留在 App.vue，通过 props / emit 对接：
    - visible       ←→ vpcSetDialogVisible
    - loading       ←→ vpcSetLoading
    - groupList     ←→ vpcSetGroupList
    - nodeList      ←→ vpcSetNodeList
    - groupId / selectMode / nodeId ←→ 同名（均为双向）
    - confirm       →  submitVpcSet
-->
<template>
  <el-dialog v-model="dialogVisible" :title="$t('cloudMachine.setVpc')" width="450px" :close-on-click-modal="false">
    <div v-loading="loading">
      <el-form label-width="80px">
        <el-form-item :label="$t('common.selectGroup')">
          <el-select v-model="groupIdModel" :placeholder="$t('common.selectGroup')" clearable style="width: 100%">
            <el-option v-for="group in groupList" :key="group.id" :label="group.alias" :value="group.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="groupId" :label="$t('common.selectNode')">
          <el-radio-group v-model="selectModeModel" style="margin-bottom: 8px;">
            <el-radio value="random">{{ $t('common.randomNode') }}</el-radio>
            <el-radio value="specified">{{ $t('common.specifiedNode') }}</el-radio>
          </el-radio-group>
          <el-select v-if="selectMode === 'specified'" v-model="nodeIdModel" :placeholder="$t('common.selectNode')" style="width: 100%">
            <el-option v-for="node in nodeList" :key="node.id" :label="node.remarks || node.id" :value="node.id" />
          </el-select>
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" @click="emit('confirm')" :loading="loading">{{ $t('common.confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  groupList: { type: Array, default: () => [] },
  nodeList: { type: Array, default: () => [] },
  groupId: { type: String, default: '' },
  nodeId: { type: String, default: '' },
  selectMode: { type: String, default: 'random' },
})

const emit = defineEmits([
  'update:visible',
  'update:groupId',
  'update:nodeId',
  'update:selectMode',
  'confirm',
])

const dialogVisible = ref(false)

const groupIdModel = computed({
  get: () => props.groupId,
  set: (v) => emit('update:groupId', v),
})
const nodeIdModel = computed({
  get: () => props.nodeId,
  set: (v) => emit('update:nodeId', v),
})
const selectModeModel = computed({
  get: () => props.selectMode,
  set: (v) => emit('update:selectMode', v),
})

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
