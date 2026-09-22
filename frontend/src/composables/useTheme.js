/**
 * 主题模式（日间/夜间）+「安装 APK 自动授权」开关。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同。
 *
 * 注意：原 App.vue 在模块（setup）顶层直接执行了
 * `applyThemeMode()` / `cleanupThemeResidue()` / 首次 `startDarkObserver()`，
 * 这里改为在 `useTheme()` 调用时执行。调用点仍放在 `<script setup>` 顶层且位置不变，
 * 因此求值时机与拆分前一致（不能挪进 onMounted）。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

export function useTheme() {
  const isDarkTheme = ref(localStorage.getItem('theme-mode') === 'dark')

  // 安装APK自动授权开关
  const autoGrantApkPermission = ref(false)
  try {
    const saved = localStorage.getItem('autoGrantApkPermission')
    if (saved !== null) autoGrantApkPermission.value = saved === 'true'
  } catch (e) {
    console.warn('读取autoGrantApkPermission失败:', e)
  }

  // 跟随 Element Plus 官方做法：切换 html.dark class
  const applyThemeMode = () => {
    const html = document.documentElement
    html.classList.toggle('dark', isDarkTheme.value)
    html.style.colorScheme = isDarkTheme.value ? 'dark' : 'light'
  }

  // 批量查找并替换 DOM 中计算后仍为白色/浅灰的背景色
  const fixDarkBackgrounds = () => {
    if (!isDarkTheme.value) return
    const lightBgs = {
      'rgb(255, 255, 255)': 'rgb(0, 0, 0)',
      'rgba(255, 255, 255, 1)': 'rgb(0, 0, 0)',
      'rgb(245, 247, 250)': 'rgb(0, 0, 0)',
      'rgb(240, 242, 245)': 'rgb(0, 0, 0)',
      'rgb(250, 250, 250)': 'rgb(0, 0, 0)',
      'rgb(245, 245, 245)': 'rgb(0, 0, 0)',
      'rgb(255, 247, 230)': 'rgb(0, 0, 0)',
    }
    const all = document.querySelectorAll('*')
    for (const el of all) {
      const bg = getComputedStyle(el).backgroundColor
      const replacement = lightBgs[bg]
      if (replacement) {
        el.style.setProperty('background-color', replacement, 'important')
        el.dataset.darkBg = '1'
      }
    }
  }

  // 清除 fixDarkBackgrounds 注入的内联背景色，恢复组件原始样式
  const clearDarkOverrides = () => {
    document.querySelectorAll('[data-dark-bg]').forEach(el => {
      el.style.removeProperty('background-color')
      delete el.dataset.darkBg
    })
  }

  // MutationObserver: 深色模式下持续修复新增 DOM 节点的白色背景
  // 仅在 composable 内部使用，不再暴露给 App.vue
  let darkObserver = null
  const startDarkObserver = () => {
    if (darkObserver) return
    darkObserver = new MutationObserver(() => {
      if (isDarkTheme.value) fixDarkBackgrounds()
    })
    darkObserver.observe(document.body, { childList: true, subtree: true })
  }
  const stopDarkObserver = () => {
    if (darkObserver) { darkObserver.disconnect(); darkObserver = null }
  }

  const toggleThemeMode = () => {
    isDarkTheme.value = !isDarkTheme.value
    localStorage.setItem('theme-mode', isDarkTheme.value ? 'dark' : 'light')
    applyThemeMode()
    if (isDarkTheme.value) {
      requestAnimationFrame(fixDarkBackgrounds)
      startDarkObserver()
    } else {
      stopDarkObserver()
      clearDarkOverrides()
    }
    cleanupThemeResidue()
    ElMessage.success(isDarkTheme.value ? '已切换为夜间模式' : '已切换为日间模式')
  }

  const cleanupThemeResidue = () => {
    document.querySelectorAll('.dark').forEach(el => {
      if (el !== document.documentElement) {
        el.classList.remove('dark')
      }
    })
  }

  applyThemeMode()
  cleanupThemeResidue()
  if (isDarkTheme.value) {
    requestAnimationFrame(fixDarkBackgrounds)
    startDarkObserver()
  }

  return {
    isDarkTheme,
    autoGrantApkPermission,
    applyThemeMode,
    fixDarkBackgrounds,
    clearDarkOverrides,
    startDarkObserver,
    stopDarkObserver,
    toggleThemeMode,
    cleanupThemeResidue,
  }
}
