<!--
  设置 MacVlanIP 弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 macVlan* 前缀换成组件内的通用名）。
  状态仍留在 App.vue，通过 props / emit 双向对接：
    - visible  ←→ macVlanDialogVisible
    - form     ←→ macVlanForm（对象按引用传入，子组件就地改属性即等价于原来直接改 macVlanForm）
    - loading  ←→ macVlanLoading
    - confirm  →  confirmSetMacVlanIP
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    title="设置MacVlanIP"
    width="400px"
  >
    <el-form :model="form" label-width="100px">
      <el-form-item label="容器名称">
        <el-input v-model="form.name" disabled></el-input>
      </el-form-item>
      <el-form-item label="MacVlanIP" required>
        <el-input v-model="form.ip" placeholder="请输入MacVlanIP"></el-input>
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
  form: { type: Object, default: () => ({ name: '', ip: '' }) },
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
