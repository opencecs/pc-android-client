/**
 * 从 App.vue 抽出的纯工具函数（不依赖任何组件状态）。
 * 由 App.vue 拆分阶段 2 迁出，函数体与原实现逐字相同。
 */


// 处理目录节点展开/折叠
export const toggleNodeExpanded = (node) => {
  if (node.isDir) {
    if (node.expanded === undefined) {
      node.expanded = true
    } else {
      node.expanded = !node.expanded
    }
  }
}


// 收集目录下所有文件路径
export const collectSharedFilePaths = (node) => {
  const filePaths = []
  const collect = (n) => {
    if (n.children) {
      n.children.forEach(child => {
        if (!child.isDir) {
          filePaths.push(child.path)
        } else {
          collect(child)
        }
      })
    }
  }
  collect(node)
  return filePaths
}
