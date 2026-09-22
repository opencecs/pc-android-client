<!--
  设置设备密码弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 password* 前缀换成组件内的通用名）。
  状态仍留在 App.vue，通过 props / emit 对接：
    - visible ←→ passwordDialogVisible
    - form    ←→ passwordForm（对象按引用传入，子组件就地改属性即等价于原来直接改）
    - loading ←→ passwordLoading
    - confirm →  handleSetPassword
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.setDevicePassword')"
    width="400px"
  >
    <el-form :model="form" label-width="80px">
      <el-form-item label="密码">
        <el-input
          v-model="form.password"
          type="password"
          placeholder="请输入密码"
          show-password
        ></el-input>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="emit('confirm')" :loading="loading">
          {{ loading ? '设置中...' : '确定' }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  form: { type: Object, default: () => ({ password: '' }) },
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
