/**
 * 从 App.vue 抽出的纯工具函数（不依赖任何组件状态）。
 * 由 App.vue 拆分阶段 2 迁出，函数体与原实现逐字相同。
 */


// 返回设备的 host:port，若 ip 已含端口则直接使用，否则追加默认 8000
export const getDeviceAddr = (ip) => {
  if (!ip) return ip
  const lastColon = ip.lastIndexOf(':')
  if (lastColon === -1) return ip + ':8000'
  return /^\d+$/.test(ip.slice(lastColon + 1)) ? ip : ip + ':8000'
}

export const FORBIDDEN_ADB_PORTS = new Set([9082, 9083, 10000, 10001, 10006, 10007, 10008])


// 从容器实例中动态获取 ADB 端口
// 优先读取实例的 adbPort 字段，否则从 portBindings 中排除已知端口后推断
export const getInstanceAdbPort = (instance) => {
  if (!instance) return 5555
  // 优先使用实例中保存的 adbPort 字段
  if (instance.adbPort && instance.adbPort !== 0) {
    return Number(instance.adbPort)
  }
  // 从 portBindings 中推断：排除已知端口后，剩余的可能是 ADB 端口
  const knownPorts = new Set([8000, 9082, 9083, 10000, 10001, 10006, 10007, 10008])
  const bindings = instance.portBindings || instance.PortBindings
  if (bindings) {
    for (const [key] of Object.entries(bindings)) {
      const portNum = parseInt(key.split('/')[0])
      if (!isNaN(portNum) && !knownPorts.has(portNum)) {
        // 找到一个非已知端口，可能就是 ADB 端口
        return portNum
      }
    }
  }
  // 默认回退到 5555
  return 5555
}


// 从容器信息中提取端口映射
export const extractPort = (container, portNumber) => {
  // 优先从容器的缓存中获取端口映射，避免重复计算
  // 注意：OpenCecs 公网设备不缓存，因为端口映射表可能在首次调用后才填充
  const isPublicDevice = container.deviceIp && container.deviceIp.includes(':')
  const cacheKey = `_cachedPort${portNumber}`
  if (!isPublicDevice && container[cacheKey]) {
    return container[cacheKey]
  }
  
  let mappedPort = null
  const portKeyTcp = `${portNumber}/tcp`
  const portKeyUdp = `${portNumber}/udp`
  
  // 支持V3 API格式: container.portBindings['port/tcp'][0].HostPort
  if (container.portBindings) {
    const portBinding = container.portBindings[portKeyTcp] || container.portBindings[portKeyUdp]
    if (portBinding && portBinding.length > 0) {
      mappedPort = portBinding[0].HostPort
    }
  }
  
  // 支持Docker API原生格式: container.Ports数组
  if (!mappedPort && container.Ports && Array.isArray(container.Ports)) {
    // 查找PrivatePort为指定端口的端口映射（先TCP后UDP）
    const port = container.Ports.find(p => p.PrivatePort === portNumber && p.Type === 'tcp')
      || container.Ports.find(p => p.PrivatePort === portNumber && p.Type === 'udp')
    if (port && port.PublicPort) {
      mappedPort = port.PublicPort
    }
  }
  
  // 兼容旧版Docker API格式（通过端口名查找）
  if (!mappedPort && container.NetworkSettings && container.NetworkSettings.Ports) {
    const portBinding = container.NetworkSettings.Ports[portKeyTcp] || container.NetworkSettings.Ports[portKeyUdp]
    if (portBinding && portBinding.length > 0) {
      mappedPort = portBinding[0].HostPort
    }
  }
  
  // 兼容V3 API的另一种格式
  if (!mappedPort && container.PortBindings) {
    const portBinding = container.PortBindings[portKeyTcp] || container.PortBindings[portKeyUdp]
    if (portBinding && portBinding.length > 0) {
      mappedPort = portBinding[0].HostPort
    }
  }

  // OpenCecs 公网设备：将 HostPort（局域网端口）转换为公网端口映射
  // 当 deviceIp 包含 ":"（格式为 publicIp:publicPort）时，说明是公网设备
  if (mappedPort && container.deviceIp && container.deviceIp.includes(':')) {
    // 先精确匹配 deviceIp，如果找不到则按公网 IP 前缀模糊匹配
    // （因为每次创建 8000 端口映射可能得到不同的公网端口，旧容器的 deviceIp 可能过时）
    let portMap = window.openCecsPortMap?.get(container.deviceIp)
    if (!portMap && window.openCecsPortMap) {
      const ipPrefix = container.deviceIp.split(':')[0] + ':'
      for (const [key, map] of window.openCecsPortMap) {
        if (key.startsWith(ipPrefix)) {
          portMap = map
          break
        }
      }
    }
    if (portMap) {
      const publicPort = portMap.get(Number(mappedPort))
      if (publicPort) {
        mappedPort = publicPort
      }
    }
  }
  
  // 缓存端口映射结果，避免重复计算
  container[cacheKey] = mappedPort
  return mappedPort
}


// 从容器信息中提取9082端口的映射端口
export const extractPort9082 = (container) => {
  if (container && (container.networkName === 'myt' || container.networkMode === 'myt' || container.network === 'myt')) {
    return 9082
  }
  return extractPort(container, 9082)
};


// 获取SDK端口
export const getSDKPort = (version, sys_ver) => {
  // v3设备且系统版本为5时使用8000端口，否则使用81端口
  if (version === 'v3' && sys_ver === '5') {
    return '8000'
  }
  return '81'
}


// 获取端口映射信息
export const getPortMappings = (instance, device) => {
  console.log('getPortMappings', device)
  // 保留原始 device 用于查 openCecsPortMap
  const originalDevice = device
  const isPublicDevice = device && device.includes(':')
  // OpenCecs 公网设备：device 可能是 publicIp:publicPort，提取纯 IP
  if (isPublicDevice) device = device.split(':')[0]

  // 查找 OpenCecs 端口映射表
  let portMap = null
  if (isPublicDevice && window.openCecsPortMap) {
    portMap = window.openCecsPortMap.get(originalDevice)
    if (!portMap) {
      const ipPrefix = device + ':'
      for (const [key, map] of window.openCecsPortMap) {
        if (key.startsWith(ipPrefix)) { portMap = map; break }
      }
    }
  }

  // Docker 8000 端口：公网设备用映射端口，局域网设备用 8000
  const dockerPort = portMap ? (portMap.get(8000) || 8000) : 8000
  const dockerUrl = isPublicDevice ? `http://${device}:${dockerPort}/docker` : `http://${getDeviceAddr(device)}/docker`

  // 如果没有实例（空坑位），则显示原始端口
  if (!instance) {
    return {
      androidApi: {
        originalPort: 9082,
        mappedPort: portMap ? (portMap.get(9082) || 9082) : 9082,
        description: '安卓设备管理API',
        url: `${device}:${portMap ? (portMap.get(9082) || 9082) : 9082}`,
        isMapped: !!(portMap && portMap.get(9082))
      },
      controlApi: {
        originalPort: 9083,
        mappedPort: portMap ? (portMap.get(9083) || 9083) : 9083,
        description: 'RPA自动化API',
        url: `${device}:${portMap ? (portMap.get(9083) || 9083) : 9083}`,
        isMapped: !!(portMap && portMap.get(9083))
      },
      adb: {
        originalPort: 5555,
        mappedPort: portMap ? (portMap.get(5555) || 5555) : 5555,
        description: 'AndroidADB(默认)',
        url: `${device}:${portMap ? (portMap.get(5555) || 5555) : 5555}`,
        isMapped: !!(portMap && portMap.get(5555))
      },
      dockerApi: {
        originalPort: 8000,
        mappedPort: dockerPort,
        description: 'Docker管理接口',
        url: dockerUrl,
        isMapped: dockerPort !== 8000
      }
    }
  }
  
  // 从容器实例中提取真实端口映射
  // myt 网络模式：容器有独立IP，直接用原始端口，不存在端口映射
  const isMytNetwork = instance && (instance.networkName === 'myt' || instance.networkMode === 'myt')
  const androidApiPort = isMytNetwork ? 9082 : (extractPort(instance, 9082) || 9082)
  const controlApiPort = isMytNetwork ? 9083 : (extractPort(instance, 9083) || 9083)
  // 从容器实例中动态获取 ADB 端口（优先从 adbPort 字段读取，否则从 portBindings 中推断）
  const instanceAdbPort = getInstanceAdbPort(instance)
  const adbPort = isMytNetwork ? instanceAdbPort : (extractPort(instance, instanceAdbPort) || instanceAdbPort)
  
  return {
    androidApi: {
      originalPort: 9082,
      mappedPort: androidApiPort,
      description: '安卓设备管理API',
      url: `${device}:${androidApiPort}`,
      isMapped: androidApiPort !== 9082
    },
    controlApi: {
      originalPort: 9083,
      mappedPort: controlApiPort,
      description: 'RPA自动化API',
      url: `${device}:${controlApiPort}`,
      isMapped: controlApiPort !== 9083
    },
    adb: {
      originalPort: instanceAdbPort,
      mappedPort: adbPort,
      description: 'AndroidADB',
      url: `${device}:${adbPort}`,
      isMapped: adbPort !== instanceAdbPort
    },
    dockerApi: {
      originalPort: 8000,
      mappedPort: dockerPort,
      description: 'Docker管理接口',
      url: dockerUrl,
      isMapped: dockerPort !== 8000
    }
  }
}

export const getDeviceTypeName = (deviceName) => {
  if (!deviceName) return 'unknown'
  // 从设备名称中提取型号，例如q1_v2 -> q1, p1_v3 -> p1
  const parts = deviceName.split('_')
  return parts[0] || 'unknown'
}


// 获取设备类型颜色
export const getDeviceTypeColor = (deviceName) => {
  const deviceType = getDeviceTypeName(deviceName)
  const colorMap = {
    'q1': '#409EFF', // 蓝色
    'p1': '#67C23A', // 绿色
    'm48': '#E6A23C', // 黄色
    'c1': '#F56C6C', // 红色
    'a1': '#909399', // 灰色
    'r1p': '#67C23A' // 归入 P 类，使用绿色
  }
  return colorMap[deviceType] || '#909399' // 默认灰色
}


// 解析容器坑位编号
export const parseContainerSlot = (container, device) => {
  console.log('parseContainerSlot called with container:', container?.name, 'device:', device?.ip, 'version:', device?.version);
  
  // 1. 识别系统插件容器，直接返回null
  const image = container.Image || container.image;
  const name = container.Name || container.Names?.[0];
  const isSystemContainer = image?.includes('myt_sdk') || 
                           image?.includes('myt_vpc_plugin') ||
                           name?.includes('myt_sdk') ||
                           name?.includes('myt_vpc_plugin');
  
  if (isSystemContainer) {
    console.log('System container detected, returning null');
    return null;
  }
  
  // 2. 优先从容器的indexNum字段获取
  if (container.indexNum) {
    console.log('Found slot from indexNum:', container.indexNum);
    return container.indexNum;
  }
  
  // 对于Docker API返回的容器，尝试从Labels获取idx
  if (container.Config && container.Config.Labels && container.Config.Labels.idx) {
    const slot = parseInt(container.Config.Labels.idx);
    console.log('Found slot from Config.Labels.idx:', slot);
    return slot;
  }
  
  // 尝试从docker inspect的Labels直接获取idx（不同Docker API版本可能有不同的字段）
  if (container.Labels && container.Labels.idx) {
    const slot = parseInt(container.Labels.idx);
    console.log('Found slot from Labels.idx:', slot);
    return slot;
  }
  
  // 从设备路径推断idx（参考api/main.go的逻辑）
  if (container.HostConfig && container.HostConfig.Devices) {
    for (const dev of container.HostConfig.Devices) {
      if (dev.PathInContainer && dev.PathInContainer.includes('/dev/vndbinder')) {
        const parts = dev.PathOnHost.split('binder')
        if (parts.length > 1) {
          const num = parseInt(parts[1])
          if (!isNaN(num)) {
            const slot = Math.floor(num / 3);
            console.log('Found slot from device path:', slot);
            return slot;
          }
        }
      }
    }
  }
  
  // 从容器名称中提取坑位编号，例如 "android-1" -> 1
  if (container.Name || container.Names) {
    const name = container.Name || container.Names[0];
    if (name) {
      const match = name.match(/-(\d+)/);
      if (match && match[1]) {
        const slot = parseInt(match[1]);
        console.log('Found slot from container name:', slot);
        return slot;
      }
    }
  }
  
  // 默认返回null
  console.log('No slot found, returning null');
  return null;
}
