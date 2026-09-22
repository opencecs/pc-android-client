<!--
  机型切换对话框

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 switch* / temp* 前缀换成组件内的通用名）。
  状态与逻辑仍留在 App.vue（在 useBatchSwitchModel 里），通过 props / emit 对接：
    - visible      ←→ switchModelDialogVisible
    - container    ←→ currentSwitchContainer（只读展示标题）
    - switchModelType / tempModelId / switchCountryCode ←→ 同名（均为双向）
    - fetchingModels / fetchingBackupModels / displayedModels / countryList / countryListLoading ←→ 同名
    - type-change → handleSwitchModelTypeChange
    - fetch-country-list → fetchCountryList
    - cancel / confirm → cancelSwitchModel / confirmSwitchModel
  getCountryEnglishName 由本组件自己 import（与原 App.vue 同一个来源）。
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="`切换机型 - ${container?.name || ''}`"
    width="500px"
  >
    <div style="padding: 10px 0;">
      <el-form label-width="80px">
        <el-form-item label="机型来源">
          <el-radio-group v-model="switchModelTypeModel" @change="(v) => emit('type-change', v)">
            <el-radio-button label="online">线上机型</el-radio-button>
            <el-radio-button label="local">本地机型</el-radio-button>
            <el-radio-button label="backup">备份机型</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="选择机型">
          <el-select v-model="tempModelIdModel" style="width: 100%;" placeholder="请选择要切换的机型" filterable :loading="fetchingModels || fetchingBackupModels">
            <el-option
              v-for="model in displayedModels"
              :key="model.id"
              :label="model.name"
              :value="model.id"
            ></el-option>
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.modelCountry')">
          <el-select
            v-model="switchCountryCodeModel"
            :placeholder="$t('common.pleaseSelectModelCountry')"
            :loading="countryListLoading"
            filterable
            @focus="emit('fetch-country-list')"
          >
            <el-option
              v-for="country in countryList"
              :key="country.countryCode"
              :label="`${country.countryName} (${getCountryEnglishName(country.countryCode)})`"
              :value="country.countryCode"
            ></el-option>
          </el-select>
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="emit('cancel')" :disabled="switchingModel">取消</el-button>
        <el-button type="primary" @click="emit('confirm')" :loading="switchingModel" :disabled="switchingModel">
          {{ switchingModel ? '正在切换' : '确定' }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { getCountryEnglishName } from '../../countryData.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  container: { type: Object, default: null },
  switchModelType: { type: String, default: 'online' },
  tempModelId: { type: [String, Number], default: '' },
  switchCountryCode: { type: String, default: '' },
  fetchingModels: { type: Boolean, default: false },
  fetchingBackupModels: { type: Boolean, default: false },
  displayedModels: { type: Array, default: () => [] },
  countryList: { type: Array, default: () => [] },
  countryListLoading: { type: Boolean, default: false },
  switchingModel: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:visible',
  'update:switchModelType',
  'update:tempModelId',
  'update:switchCountryCode',
  'type-change',
  'fetch-country-list',
  'cancel',
  'confirm',
])

const dialogVisible = ref(false)

const switchModelTypeModel = computed({
  get: () => props.switchModelType,
  set: (v) => emit('update:switchModelType', v),
})
const tempModelIdModel = computed({
  get: () => props.tempModelId,
  set: (v) => emit('update:tempModelId', v),
})
const switchCountryCodeModel = computed({
  get: () => props.switchCountryCode,
  set: (v) => emit('update:switchCountryCode', v),
})

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
