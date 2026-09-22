/**
 * 从 App.vue 抽出的纯工具函数（不依赖任何组件状态）。
 * 由 App.vue 拆分阶段 2 迁出，函数体与原实现逐字相同。
 */

export const formatSize = (mbValue) => {
  if (!mbValue || mbValue === '加载中...') return '加载中...'
  const value = parseFloat(mbValue)
  if (isNaN(value)) return mbValue
  if (value >= 1024) {
    return `${(value / 1024).toFixed(2)} GB`
  }
  return `${value} MB`
}


// 计算MacVlan IP范围
export const calculateIpRange = (startIp, count) => {
  if (!startIp || count <= 0) return ''
  
  try {
    const parts = startIp.split('.').map(Number)
    if (parts.length !== 4 || parts.some(isNaN)) return '无效的IP地址'
    
    // 计算结束IP
    let [a, b, c, d] = parts
    d += count - 1
    
    // 处理进位
    while (d > 255) {
      d -= 256
      c += 1
    }
    while (c > 255) {
      c -= 256
      b += 1
    }
    while (b > 255) {
      b -= 256
      a += 1
    }
    
    if (a > 255) return '超出IP范围'
    
    const endIp = `${a}.${b}.${c}.${d}`
    return `${startIp} - ${endIp}`
  } catch (error) {
    return '计算失败'
  }
}


// 提取节点显示名称
export const extractNodeDisplayName = (remarks) => {
  if (!remarks) return ''
  const parts = remarks.split('_')
  return parts.length > 0 ? parts[parts.length - 1] : remarks
}


// 自然排序辅助函数：将字符串拆分为 [文本, 数字, 文本, 数字, ...] 段，用于自然排序
export const naturalSortKey = (str) => {
  if (!str) return []
  const parts = []
  const regex = /(\D+|\d+)/g
  let match
  while ((match = regex.exec(str)) !== null) {
    // 数字段转为数值，文本段保持原样并转小写用于大小写不敏感排序
    parts.push(/^\d+$/.test(match[1]) ? Number(match[1]) : match[1].toLowerCase())
  }
  return parts
}


// 提取名称最后一段（如 1778046657165_6_0_copy_A1 -> A1）
export const extractShortName = (name) => {
  if (!name) return ''
  const parts = name.split('_')
  return parts.length > 0 ? parts[parts.length - 1] : name
}

export const arrayBufferToBase64 = (buffer) => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

export const generateTaskId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9)
}


// 格式化实例名称，隐藏特定格式的前缀
export const formatInstanceName = (name) => {
  if (!name) return name
  
  // 匹配格式：[任意字符]_数字_名称
  // 例如：p1e847b84af914895b56a14557d1813d_2_T00022222222 -> T00022222222
  // 例如：p1e847b84af914895b56a14557d1813d_4_sjz_cs -> sjz_cs
  const match = name.match(/^.+_\d+_(.+)$/)
  if (match && match.length > 1) {
    return match[1] // 只返回最后一个下划线后的名称部分
  }
  
  return name // 返回原始名称
}

export const formatInstanceModel = (path) => {
  if (!path) return ''
  
  // 匹配格式：[任意字符]_数字_名称
  // 例如：p1e847b84af914895b56a14557d1813d_2_T00022222222 -> T00022222222
  // 例如：p1e847b84af914895b56a14557d1813d_4_sjz_cs -> sjz_cs
  // 例如：/mmc/data/.../22111317PG -> 22111317PG
  
  // 尝试从路径中提取最后一部分作为机型
  const pathParts = path.split('/')
  const lastPart = pathParts[pathParts.length - 1]
  
  // 检查是否是有效的机型名称（非空且不包含路径分隔符）
  if (lastPart && !lastPart.includes('/')) {
    return lastPart
  }
  
  return path // 无法提取时返回原始名称
}
