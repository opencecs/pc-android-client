<!--
  系统公告弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 announcementVisible 换成组件内的通用名）。
  状态仍留在 App.vue（在 useDialogState 里），通过 props / emit 对接：
    - visible ←→ announcementVisible
    - data    ←→ announcementData（对象按引用传入，只读展示）
    - countdown ←→ countdown
    - close   →  closeAnnouncement（点"我知道了"和弹窗自身 close 事件都走它，与原逻辑一致）
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="data.title"
    width="520px"
    :close-on-click-modal="false"
    :show-close="false"
    @close="emit('close')"
    class="announcement-dialog"
  >
    <div class="announcement-content">
      <div class="announcement-icon">
        <el-icon :size="48" color="#409EFF">
          <BellFilled />
        </el-icon>
      </div>
      <div class="announcement-text">
        {{ data.content }}
      </div>
    </div>
    <template #footer>
      <div class="announcement-footer">
        <el-button type="primary" @click="emit('close')" size="large">
          {{ $t('common.understood') }}
          <span v-if="countdown > 0" class="countdown-badge">
            {{ countdown }}s
          </span>
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { BellFilled } from '@element-plus/icons-vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  data: { type: Object, default: () => ({ title: '', content: '' }) },
  countdown: { type: Number, default: 0 },
})

const emit = defineEmits(['update:visible', 'close'])

const dialogVisible = ref(false)

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
