<!--
  同步授权（登录）对话框

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 syncAuth* 换成组件内的通用名）。
  状态与逻辑仍留在 App.vue（在 useAuthForms 里），通过 props / emit 对接：
    - visible ←→ syncAuthDialogVisible
    - form    ←→ syncAuthForm（对象按引用传入，子组件就地改 username / password / saveCredentials）
    - loading ←→ syncAuthLoading
    - cancel → handleSyncAuthCancel
    - submit → handleSyncAuthSubmit
    - open-forgot-password → openForgotPasswordDialog
    - open-register        → openRegisterDialog
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.syncAuthLogin')"
    width="400px"
  >
    <el-form :model="form" label-width="80px">
      <el-form-item :label="$t('common.username')" required>
        <el-input
          v-model="form.username"
          :placeholder="$t('common.enterUsername')"
          autocomplete="off"
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.password')" required>
        <el-input
          v-model="form.password"
          type="password"
          :placeholder="$t('common.enterPassword')"
          show-password
        ></el-input>
      </el-form-item>
      <el-form-item>
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <el-checkbox v-model="form.saveCredentials">{{ $t('common.rememberCredentials') }}</el-checkbox>
          <el-link type="primary" :underline="false" @click="emit('open-forgot-password')" style="font-size: 13px;">忘记密码</el-link>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="emit('cancel')">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="emit('submit')" :loading="loading">
          {{ loading ? $t('common.loggingIn') : $t('common.login') }}
        </el-button>
        <el-button type="success" @click="emit('open-register')">{{ $t('common.register') }}</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  form: { type: Object, default: () => ({ username: '', password: '', saveCredentials: false }) },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible', 'cancel', 'submit', 'open-forgot-password', 'open-register'])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
