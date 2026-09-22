<!--
  忘记密码对话框

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 forgotPassword* / fp* 换成组件内的通用名）。
  状态与逻辑仍留在 App.vue（在 useAuthForms 里），通过 props / emit 对接：
    - visible         ←→ forgotPasswordDialogVisible
    - form            ←→ forgotPasswordForm（对象按引用传入，子组件就地改 phone / newPassword /
                         confirmPassword / vcode）
    - errors          ←→ forgotPasswordErrors（对象按引用传入，只读展示）
    - loading         ←→ forgotPasswordLoading
    - vcodeLoading    ←→ fpVcodeLoading
    - isCountingDown  ←→ fpIsCountingDown
    - vcodeButtonText ←→ fpVcodeButtonText（computed，倒计时文案）
    - close      → handleForgotPasswordClose
    - submit     → handleForgotPasswordSubmit
    - send-vcode → sendForgotPasswordVcode
    - open-register → openRegisterFromForgot
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    title="忘记密码"
    width="400px"
    @close="emit('close')"
  >
    <el-form :model="form" label-width="0">
      <el-form-item>
        <el-input
          v-model="form.phone"
          placeholder="手机号码"
          autocomplete="off"
          clearable
        ></el-input>
        <div v-if="errors.phone" class="fp-error-app">
          <el-icon style="margin-right:3px;"><WarningFilled /></el-icon>{{ errors.phone }}
        </div>
      </el-form-item>
      <el-form-item>
        <el-input
          v-model="form.newPassword"
          type="password"
          placeholder="新密码"
          show-password
          clearable
        ></el-input>
        <div v-if="errors.newPassword" class="fp-error-app">
          <el-icon style="margin-right:3px;"><WarningFilled /></el-icon>{{ errors.newPassword }}
        </div>
      </el-form-item>
      <el-form-item>
        <el-input
          v-model="form.confirmPassword"
          type="password"
          placeholder="确认新密码"
          show-password
          clearable
        ></el-input>
        <div v-if="errors.confirmPassword" class="fp-error-app">
          <el-icon style="margin-right:3px;"><WarningFilled /></el-icon>{{ errors.confirmPassword }}
        </div>
      </el-form-item>
      <el-form-item>
        <div style="display: flex; gap: 10px; width: 100%;">
          <el-input
            v-model="form.vcode"
            placeholder="手机验证码"
            style="flex: 1;"
            clearable
          ></el-input>
          <el-button
            type="primary"
            @click="emit('send-vcode')"
            :loading="vcodeLoading"
            :disabled="isCountingDown"
            style="white-space: nowrap;"
          >
            {{ vcodeButtonText }}
          </el-button>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <div style="width: 100%; display: flex; flex-direction: column;">
        <el-button
          type="primary"
          style="width: 100%; margin-bottom: 10px;"
          :loading="loading"
          @click="emit('submit')"
        >
          {{ loading ? '重置中...' : '重置密码' }}
        </el-button>
        <div style="text-align: center; font-size: 13px; color: #666;">
          还没有账号？<el-link type="primary" :underline="false" @click="emit('open-register')">立即注册</el-link>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { WarningFilled } from '@element-plus/icons-vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  form: { type: Object, default: () => ({ phone: '', newPassword: '', confirmPassword: '', vcode: '' }) },
  errors: { type: Object, default: () => ({ phone: '', newPassword: '', confirmPassword: '' }) },
  loading: { type: Boolean, default: false },
  vcodeLoading: { type: Boolean, default: false },
  isCountingDown: { type: Boolean, default: false },
  vcodeButtonText: { type: String, default: '' },
})

const emit = defineEmits(['update:visible', 'close', 'submit', 'send-vcode', 'open-register'])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
