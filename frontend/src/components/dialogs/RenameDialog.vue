<!--
  云机重命名弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 rename* 前缀换成组件内的通用名）。
  状态仍留在 App.vue（在 useDialogState 里），通过 props / emit 对接：
    - visible ←→ renameDialogVisible
    - form    ←→ renameForm（对象按引用传入，子组件就地改属性即等价于原来直接改）
    - loading ←→ renameLoading
    - confirm →  submitRename
  原模板里的 t('...') 与 $t('...') 等价（都走 globalProperties 上的同一份 i18n），本组件统一用 $t。
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('cloudMachine.renameCloudMachine')"
    width="400px"
    :close-on-click-modal="false"
  >
    <el-form :model="form" label-width="80px">
      <el-form-item :label="$t('cloudMachine.currentName')">
        <el-input v-model="form.name" disabled></el-input>
      </el-form-item>
      <el-form-item :label="$t('cloudMachine.newName')">
        <el-input v-model="form.newName" :placeholder="$t('cloudMachine.enterNewName')"></el-input>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="emit('confirm')" :loading="loading">
          {{ $t('common.confirm') }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  form: { type: Object, default: () => ({ name: '', newName: '' }) },
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
