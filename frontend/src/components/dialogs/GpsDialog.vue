<!--
  GPS 定位设置弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 gps* 前缀换成组件内的通用名）。
  状态仍留在 App.vue，通过 props / emit 对接：
    - visible ←→ gpsDialogVisible
    - form    ←→ gpsForm（对象按引用传入，子组件就地改属性即等价于原来直接改 gpsForm）
    - loading ←→ gpsLoading
    - confirm →  submitGPS
  countryMap 由本组件自己 import（与原 App.vue 同一个来源）。
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.setIPLocation')"
    width="400px"
    :close-on-click-modal="false"
  >
    <el-form :model="form" label-width="80px">
      <el-form-item :label="$t('common.locationIP')">
        <el-input v-model="form.ip" :placeholder="$t('common.leaveEmptyForCurrentIP')"></el-input>
      </el-form-item>
      <el-form-item :label="$t('common.countryRegion')">
        <el-select v-model="form.country" :placeholder="$t('common.pleaseSelectCountryRegion')" filterable>
          <el-option
            v-for="(info, code) in countryMap"
            :key="code"
            :label="`${info.name} (${info.en})`"
            :value="code"
          >
            <span style="float: left">{{ info.name }} ({{ info.en }})</span>
            <span style="float: right; color: #8492a6; font-size: 13px">{{ code }}</span>
          </el-option>
        </el-select>
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
import { countryMap } from '../../countryData.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  form: { type: Object, default: () => ({ ip: '', country: '' }) },
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
