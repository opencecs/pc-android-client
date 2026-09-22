<!--
  添加 macvlan 网络弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 addMacvlan* 前缀换成组件内的通用名）。
  状态仍留在 App.vue，通过 props / emit 对接：
    - visible ←→ addMacvlanDialogVisible
    - form    ←→ addMacvlanForm（对象按引用传入，子组件就地改属性即等价于原来直接改）
    - loading ←→ addMacvlanLoading
    - before-close → handleAddMacvlanCancel（原处理函数不看 done 参数，自己关弹窗，这里同样只转发通知）
    - confirm      → handleAddMacvlanSubmit
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.addMacvlanNetwork')"
    width="600px"
    :before-close="handleBeforeClose"
  >
    <div class="add-macvlan-content">
      <el-form :model="form" label-width="120px">
        <el-form-item :label="$t('common.networkName')" required>
          <el-input v-model="form.networkName" :placeholder="$t('common.enterNetworkName')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.physicalInterface')" required>
          <el-input v-model="form.parentInterface" :placeholder="$t('common.enterPhysicalInterface')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.subnet')" required>
          <el-input v-model="form.subnet" :placeholder="$t('common.enterSubnet')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.gateway')" required>
          <el-input v-model="form.gateway" :placeholder="$t('common.enterGateway')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.ipRange')">
          <el-input v-model="form.ipRange" :placeholder="$t('common.enterIPRange')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('common.isolationMode')">
          <el-checkbox v-model="form.isPrivate">{{ $t('common.enablePrivateIsolation') }}</el-checkbox>
          <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-top: 5px;">
            {{ $t('common.isolationTip') }}
          </div>
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="emit('before-close')">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="emit('confirm')" :loading="loading">{{ $t('common.confirm') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  form: { type: Object, default: () => ({ networkName: '', parentInterface: '', subnet: '', gateway: '', ipRange: '', isPrivate: false }) },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible', 'before-close', 'confirm'])

const dialogVisible = ref(false)

// 原 :before-close="handleAddMacvlanCancel" 的处理函数不接收 done，只负责把弹窗置为 false，
// 所以这里保持同样的"只通知、不调 done"行为（关窗由父组件改 visible 驱动）。
const handleBeforeClose = () => {
  emit('before-close')
}

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
