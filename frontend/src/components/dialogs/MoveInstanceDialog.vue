<!--
  移动实例对话框

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 moveInstance* 前缀换成组件内的通用名）。
  状态仍留在 App.vue（在 useContainerActions 里），通过 props / emit 对接：
    - visible        ←→ moveInstanceDialogVisible
    - form           ←→ moveInstanceForm（对象按引用传入，子组件就地改属性即等价于原来直接改）
    - availableSlots ←→ moveInstanceAvailableSlots
    - loading        ←→ moveInstanceLoading
    - confirm        →  submitMoveInstance
-->
<template>
  <el-dialog v-model="dialogVisible" :title="$t('cloudMachine.moveInstance')" width="420px">
    <el-form :model="form" label-width="100px">
      <el-form-item :label="$t('cloudMachine.containerName')">
        <el-input v-model="form.name" disabled />
      </el-form-item>
      <el-form-item :label="$t('cloudMachine.targetSlot')" required>
        <el-select v-model="form.indexNum" :placeholder="$t('cloudMachine.enterTargetSlot')">
          <el-option v-for="slot in availableSlots" :key="slot" :label="slot" :value="slot" />
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('cloudMachine.startAfterMove')">
        <el-switch v-model="form.start" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" @click="emit('confirm')" :loading="loading">{{ $t('common.confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  form: { type: Object, default: () => ({ name: '', indexNum: null, start: true }) },
  availableSlots: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible', 'confirm'])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
