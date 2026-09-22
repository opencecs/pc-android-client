<!--
  批量更新镜像对话框

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 batchUpdateImage* 等换成组件内的通用名）。
  状态与逻辑仍留在 App.vue，通过 props / emit 对接：
    - visible ←→ batchUpdateImageDialogVisible
    - groups  ←→ batchUpdateImageGroups（数组按引用传入，子组件就地改 group.selectedUrl /
                group.androidType / group.v2AndroidVersion / group.customUrl，等价于原来直接改）
    - isPSeries / getV3List / getV2List ←→ 同名函数（App.vue 本地定义，按机型名取可选镜像列表）
    - cancel  → 关闭（原来就是 batchUpdateImageDialogVisible = false）
    - confirm → executeBatchUpdateImage
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="$t('common.batchUpdateImage')"
    width="640px"
    :close-on-click-modal="false"
  >
    <div v-for="(group, gIdx) in groups" :key="group.groupKey" :style="{ marginBottom: gIdx < groups.length - 1 ? '20px' : '0' }">
      <!-- 分组标题 -->
      <div style="font-weight:600;font-size:14px;color:var(--el-text-color-primary);padding:6px 0 10px 0;border-bottom:1px solid #ebeef5;margin-bottom:12px;">
        {{ group.groupLabel }}
        <span style="font-weight:400;color:var(--el-text-color-secondary);font-size:12px;margin-left:8px;">{{ $t('common.totalCloudMachines', { count: group.containers.length }) }}</span>
      </div>

      <el-form label-width="90px">
        <!-- 若同时含 V2 和 V3，让用户选择版本 -->
        <el-form-item v-if="group.hasV2 && group.hasV3" :label="$t('common.updateVersion')">
          <el-radio-group v-model="group.androidType" @change="group.selectedUrl = ''; group.customUrl = ''">
            <el-radio label="V3">{{ $t('common.v3Simulator') }}</el-radio>
            <el-radio label="V2">{{ $t('common.v2Container') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-else :label="$t('common.versionType')">
          <span style="color:var(--el-text-color-regular);">{{ group.androidType === 'V2' ? $t('common.v2Container') : $t('common.v3Simulator') }}</span>
        </el-form-item>

        <!-- V2 模式：安卓版本选择 -->
        <el-form-item v-if="group.androidType === 'V2'" :label="$t('common.androidVersion')">
          <el-radio-group v-model="group.v2AndroidVersion" @change="group.selectedUrl = ''">
            <el-radio :label="10">Android 10</el-radio>
            <el-radio v-if="!isPSeries(group.deviceName)" :label="12">Android 12</el-radio>
            <el-radio :label="14">Android 14</el-radio>
          </el-radio-group>
        </el-form-item>

        <!-- 镜像选择 -->
        <el-form-item :label="$t('common.imageSelection')">
          <el-select
            v-model="group.selectedUrl"
            filterable
            style="width: 100%;"
            :placeholder="$t('common.pleaseSelectImage')"
          >
            <el-option :label="$t('common.customImage')" value="custom" />
            <template v-if="group.androidType === 'V3'">
              <el-option
                v-for="img in getV3List(group.deviceName)"
                :key="img.url"
                :label="img.name"
                :value="img.url"
              />
            </template>
            <template v-else>
              <el-option
                v-for="img in getV2List(group.deviceName, group.v2AndroidVersion)"
                :key="img.url"
                :label="img.name"
                :value="img.url"
              />
            </template>
          </el-select>
          <div
            v-if="group.androidType === 'V2' && getV2List(group.deviceName, group.v2AndroidVersion).length === 0 && group.selectedUrl !== 'custom'"
            style="color:var(--el-text-color-secondary);font-size:12px;margin-top:4px;"
          >
            {{ $t('common.noImageForVersion') }}
          </div>
        </el-form-item>

        <!-- 自定义地址 -->
        <el-form-item v-if="group.selectedUrl === 'custom'" :label="$t('common.customAddress')">
          <el-input
            v-model="group.customUrl"
            :placeholder="$t('common.enterImageURL')"
            clearable
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div class="create-dialog-footer">
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button
          type="primary"
          @click="emit('confirm')"
        >{{ $t('common.confirmUpdate') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  groups: { type: Array, default: () => [] },
  isPSeries: { type: Function, default: () => false },
  getV3List: { type: Function, default: () => [] },
  getV2List: { type: Function, default: () => [] },
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
