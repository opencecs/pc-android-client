<!--
  IP 连接测试弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 ipTestVisible / testIp 换成组件内的通用名）。
  状态仍留在 App.vue（在 useDialogState 里），通过 props / emit 对接：
    - visible ←→ ipTestVisible
    - testIp  ←→ testIp（双向）
  原模板里的 ElMessage 是 App.vue 顶层 import，这里自己 import 同一份。
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.ipTestTitle')"
    width="500px"
    center
  >
    <div class="ip-test-container">
      <el-form label-width="80px">
        <el-form-item :label="$t('common.ipAddress')">
          <el-input v-model="testIpModel" :placeholder="$t('common.enterIP')" size="small"></el-input>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="small" style="margin-right: 10px;" @click="ElMessage.info('功能正在开发中')">{{ $t('common.startTest') }}</el-button>
          <el-button size="small" @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        </el-form-item>
      </el-form>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  visible: { type: Boolean, default: false },
  testIp: { type: String, default: '' },
})

const emit = defineEmits(['update:visible', 'update:testIp'])

const dialogVisible = ref(false)

const testIpModel = computed({
  get: () => props.testIp,
  set: (v) => emit('update:testIp', v),
})

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
