/**
 * 从 App.vue 抽出的纯工具函数（不依赖任何组件状态）。
 * 由 App.vue 拆分阶段 2 迁出，函数体与原实现逐字相同。
 */

import { ElMessage } from 'element-plus'


// 复制到剪贴板
export const copyToClipboard = (text) => {
  navigator.clipboard.writeText(text).then(() => {
    ElMessage.success('已复制到剪贴板')
  }).catch(err => {
    console.error('复制失败:', err)
    ElMessage.error('复制失败')
  })
}
