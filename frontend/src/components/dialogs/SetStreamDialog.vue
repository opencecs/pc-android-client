<!--
  设置推流弹窗

  从 App.vue 拆分阶段 4 迁出，模板与原来逐字相同（仅把 setStream* / streamType 等换成组件内的通用名）。
  状态仍留在 App.vue（在 useDialogState 里），通过 props / emit 对接：
    - visible       ←→ setStreamDialogVisible
    - loading       ←→ setStreamLoading
    - streamType    ←→ streamType（双向）
    - streamFilePath ←→ streamFilePath（双向）
    - qrCodeLoading / qrCodeUrl / appDownloadQrCodeUrl ←→ 同名（只读展示）
    - select-file → selectStreamFolder
    - cancel      → cancelSetStream
    - confirm     → confirmSetStream
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    title="设置推流"
    width="50%"
    :close-on-click-modal="false"
  >
    <el-form >
      <el-form-item label="推流类型">
        <el-select v-model="streamTypeModel" style="width: 100%;" placeholder="请选择推流类型">
          <el-option label="图片" value="image"></el-option>
          <el-option label="视频" value="video"></el-option>
          <el-option label="APP" value="app"></el-option>
          <!-- <el-option label="RTMP" value="rtmp"></el-option> -->
        </el-select>
      </el-form-item>

      <el-form-item v-if="streamType === 'image' || streamType === 'video'" label="文件路径">
        <el-input v-model="streamFilePathModel" placeholder="请选择文件" readonly>
          <template #append>
            <el-button @click="emit('select-file')">选择文件</el-button>
          </template>
        </el-input>
        <p style="margin-top: 20px;color: red;">选择图片或视频会自动推送到设备内</p>
      </el-form-item>

      <el-form-item v-if="streamType === 'app'">
        <div class="qrcode-container" v-loading="qrCodeLoading" style="display: flex; flex-direction: column; align-items: center; width: 100%;">
          <h4>扫码连接</h4>
          <img v-if="qrCodeUrl" :src="qrCodeUrl" alt="连接二维码" style="width: 200px; height: 200px;" />
          <div v-else-if="!qrCodeLoading">二维码生成失败</div>

          <div style="margin-top: 10px;">
            <el-popover
              placement="bottom"
              :width="200"
              trigger="hover"
            >
              <template #reference>
                <el-button link type="primary">APP下载地址</el-button>
              </template>
              <div style="text-align: center;">
                <img v-if="appDownloadQrCodeUrl" :src="appDownloadQrCodeUrl" style="width: 150px; height: 150px;" />
                <div v-else>生成中...</div>
                <div style="font-size: 12px; margin-top: 5px;">扫码下载APP</div>
              </div>
            </el-popover>
          </div>
          <div style="margin-top: 10px;color: red;">
            <p>注意：推流手机必须与设备同在一个局域网内>否则无法连接</p>
            <p>使用方法：安装APP后扫码增加云机，如出现相机黑屏，请如下操作</p>
            <p>扩展服务>设置摄像头视频源>手机摄像头映射>保存</p>
          </div>
        </div>
      </el-form-item>

      <!-- <el-form-item v-if="streamType === 'rtmp'" label="RTMP地址">
        <el-input v-model="rtmpUrl" placeholder="请输入RTMP推流地址，如 rtmp://example.com/live/stream"></el-input>
      </el-form-item> -->
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="emit('cancel')">取消</el-button>
        <el-button type="primary" @click="emit('confirm')" :loading="loading">确定</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  streamType: { type: String, default: 'image' },
  streamFilePath: { type: String, default: '' },
  qrCodeLoading: { type: Boolean, default: false },
  qrCodeUrl: { type: String, default: '' },
  appDownloadQrCodeUrl: { type: String, default: '' },
})

const emit = defineEmits([
  'update:visible',
  'update:streamType',
  'update:streamFilePath',
  'select-file',
  'cancel',
  'confirm',
])

const dialogVisible = ref(false)

const streamTypeModel = computed({
  get: () => props.streamType,
  set: (v) => emit('update:streamType', v),
})
const streamFilePathModel = computed({
  get: () => props.streamFilePath,
  set: (v) => emit('update:streamFilePath', v),
})

watch(() => props.visible, (newVal) => {
  dialogVisible.value = newVal
})

watch(dialogVisible, (newVal) => {
  emit('update:visible', newVal)
})
</script>
