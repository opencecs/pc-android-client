/**
 * 设备分组 CRUD + localStorage 持久化。
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同。
 *
 * 需要宿主状态的 ref / 函数通过依赖对象传入（本仓库不用 provide/inject）：
 *   devices / deviceGroups / deviceGroupFilter 三个 ref，
 *   saveDevicesToLocalStorage、initCloudMachineGroups 两个宿主函数。
 * `ElMessage` 按本仓库惯例由本模块自己 import。
 *
 * 注意：`initCloudMachineGroups` 在 App.vue 里声明得比本 composable 的调用点晚，
 * 因此 App.vue 侧以 `() => initCloudMachineGroups()` 惰性传入，避免求值时的 TDZ。
 */
import { ElMessage } from 'element-plus'

export function useDeviceGroups({
  devices,
  deviceGroups,
  deviceGroupFilter,
  saveDevicesToLocalStorage,
  initCloudMachineGroups,
}) {
  // 分组管理方法
  const addDeviceGroup = (groupName) => {
    const name = groupName || `新分组${deviceGroups.value.length + 1}`
    if (!deviceGroups.value.includes(name)) {
      deviceGroups.value.push(name)
      saveDeviceGroupsToLocalStorage()
    }
    return name
  }

  const renameDeviceGroup = (oldName, newName) => {
    const index = deviceGroups.value.indexOf(oldName)
    if (index !== -1 && newName && !deviceGroups.value.includes(newName)) {
      // 更新分组列表
      deviceGroups.value[index] = newName
      // 更新所有属于该分组的设备
      devices.value.forEach(device => {
        if (device.group === oldName) {
          device.group = newName
        }
      })
      // 如果当前筛选的是被重命名的分组，更新筛选
      if (deviceGroupFilter.value === oldName) {
        deviceGroupFilter.value = newName
      }
      saveDevicesToLocalStorage()
      saveDeviceGroupsToLocalStorage()
    }
  }

  const deleteDeviceGroup = (groupName) => {
    if (groupName === '默认分组') {
      ElMessage.warning('默认分组不能删除')
      return
    }
    const index = deviceGroups.value.indexOf(groupName)
    if (index !== -1) {
      deviceGroups.value.splice(index, 1)
      // 将属于该分组的设备移回默认分组
      devices.value.forEach(device => {
        if (device.group === groupName) {
          device.group = '默认分组'
        }
      })
      // 如果当前筛选的是被删除的分组，重置为全部
      if (deviceGroupFilter.value === groupName) {
        deviceGroupFilter.value = '全部'
      }
      saveDevicesToLocalStorage()
      saveDeviceGroupsToLocalStorage()
      // 重新初始化云机分组
      initCloudMachineGroups()
      ElMessage.success(`分组 "${groupName}" 已删除，设备已移至默认分组`)
    }
  }

  const moveDeviceToGroup = (deviceId, targetGroup) => {
    const device = devices.value.find(d => d.id === deviceId)
    if (device) {
      const oldGroup = device.group || '默认分组'
      device.group = targetGroup
      saveDevicesToLocalStorage()
      // 重新初始化云机分组
      initCloudMachineGroups()
      ElMessage.success(`设备 ${device.ip} 已从 "${oldGroup}" 移动到 "${targetGroup}"`)
    }
  }

  const saveDeviceGroupsToLocalStorage = () => {
    try {
      localStorage.setItem('edgeclient_device_groups', JSON.stringify(deviceGroups.value))
    } catch (error) {
      console.error('保存设备分组到本地存储失败:', error)
    }
  }

  const loadDeviceGroupsFromLocalStorage = () => {
    try {
      const savedGroups = localStorage.getItem('edgeclient_device_groups')
      if (savedGroups) {
        deviceGroups.value = JSON.parse(savedGroups)
      }
    } catch (error) {
      console.error('从本地存储加载设备分组失败:', error)
    }
  }

  return {
    addDeviceGroup,
    renameDeviceGroup,
    deleteDeviceGroup,
    moveDeviceToGroup,
    saveDeviceGroupsToLocalStorage,
    loadDeviceGroupsFromLocalStorage,
  }
}
