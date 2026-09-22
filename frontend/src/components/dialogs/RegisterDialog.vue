<!--
  注册对话框

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 register* / sendVcode* 等换成组件内的通用名）。
  状态与逻辑仍留在 App.vue（在 useAuthForms 里），通过 props / emit 对接：
    - visible      ←→ registerDialogVisible
    - form         ←→ registerForm（对象按引用传入，子组件就地改 phone / password /
                      confirmPassword / vcode）
    - loading      ←→ registerLoading
    - vcodeLoading ←→ sendVcodeLoading
    - countdown    ←→ vcodeCountdown
    - cancel     → handleRegisterCancel
    - submit     → handleRegisterSubmit
    - send-vcode → sendVcode
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.userRegistration')"
    width="400px"
  >
    <el-form :model="form" label-width="100px">
      <el-form-item :label="$t('common.phoneNumber')" required>
        <el-input
          v-model="form.phone"
          :placeholder="$t('common.enterPhoneNumber')"
          autocomplete="off"
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.loginPassword')" required>
        <el-input
          v-model="form.password"
          type="password"
          :placeholder="$t('common.enterLoginPassword')"
          show-password
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.confirmPassword')" required>
        <el-input
          v-model="form.confirmPassword"
          type="password"
          :placeholder="$t('common.enterPasswordAgain')"
          show-password
        ></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.phoneVerificationCode')" required>
        <div style="display: flex; gap: 10px;">
          <el-input
            v-model="form.vcode"
            :placeholder="$t('common.enterVerificationCode')"
            style="flex: 1;"
          ></el-input>
          <el-button
            @click="emit('send-vcode')"
            :loading="vcodeLoading"
            :disabled="countdown > 0"
            style="width: 120px;"
          >
            {{ countdown > 0 ? `${countdown}${$t('common.retryAfterSeconds')}` : $t('common.getVerificationCode') }}
          </el-button>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="emit('cancel')">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="emit('submit')" :loading="loading">
          {{ loading ? $t('common.registering') : $t('common.register') }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  form: { type: Object, default: () => ({ phone: '', password: '', confirmPassword: '', vcode: '' }) },
  loading: { type: Boolean, default: false },
  vcodeLoading: { type: Boolean, default: false },
  countdown: { type: Number, default: 0 },
})

const emit = defineEmits(['update:visible', 'cancel', 'submit', 'send-vcode'])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
