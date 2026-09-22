<!--
  S5 代理设置弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 s5Proxy* 前缀换成组件内的通用名）。
  状态仍留在 App.vue，通过 props / emit 对接：
    - visible ←→ s5ProxyDialogVisible
    - form    ←→ s5ProxyForm（对象按引用传入，子组件就地改属性即等价于原来直接改）
    - loading ←→ s5ProxyLoading
    - parse   →  parseVpcInfo
    - confirm →  handleS5ProxySubmit
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.setS5Proxy')"
    width="550px"
  >
    <el-form :model="form" label-width="120px">
      <el-form-item :label="$t('common.cloudMachineName')">
        <el-input
          v-model="form.cloudMachineName"
          :placeholder="$t('common.cloudMachineName')"
          readonly
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.s5Info')">
        <el-input
          v-model="form.vpcInfo"
          :placeholder="$t('common.s5InfoFormat')"
          @blur="emit('parse')"
          clearable
        >
          <template #append>
            <el-button @click="emit('parse')">{{ $t('common.parseAndFill') }}</el-button>
          </template>
        </el-input>
        <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px;">
          {{ $t('common.s5InfoExample') }}
        </div>
      </el-form-item>
      <el-form-item :label="$t('common.s5ServerAddress')" required>
        <el-input
          v-model="form.s5ServerAddress"
          :placeholder="$t('common.enterS5ServerAddress')"
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.s5Port')" required>
        <el-input
          v-model="form.s5Port"
          :placeholder="$t('common.enterS5Port')"
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.username')">
        <el-input
          v-model="form.username"
          :placeholder="$t('common.enterUsername')"
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.password')">
        <el-input
          v-model="form.password"
          :placeholder="$t('common.enterPassword')"
          type="password"
          show-password
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.dnsMode')">
        <el-radio-group v-model="form.dnsMode">
          <el-radio label="local">{{ $t('common.localDNS') }}</el-radio>
          <el-radio label="server">{{ $t('common.serverDNS') }}</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="emit('confirm')" :loading="loading">
          {{ loading ? $t('common.submitting') : $t('common.submitNow') }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  form: { type: Object, default: () => ({ cloudMachineName: '', vpcInfo: '', s5ServerAddress: '', s5Port: '', username: '', password: '', dnsMode: 'local' }) },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible', 'parse', 'confirm'])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
