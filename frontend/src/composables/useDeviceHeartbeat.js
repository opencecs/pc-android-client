/**
 * 设备心跳：从后端拉设备状态并回填前端缓存，以及把设备 IP 列表同步给后端监控服务。
 *   - fetchDevicesStatusFromBackend：查一次后端状态表，更新 devicesStatusCache /
 *     devicesLastUpdateTime / deviceFirmwareInfo / deviceVersionInfo，并处理在线离线迁移
 *   - updateHeartbeatDevices：把当前设备 IP 列表 + 名称映射下发给后端监控
 *   - heartbeatUnknownIpWarned：状态表里出现、设备列表里找不到的 IP 的去重提醒表
 *
 * 由 App.vue 拆分阶段 3 迁出，函数体与原实现逐字相同（脚本搬运，非手抄）。
 *
 * 状态留在 App.vue，通过依赖对象传入；getDevicesStatus / updateMonitoredDevices /
 * triggerAndroidRefresh 由本模块自己 import。
 */
import { getDevicesStatus, updateMonitoredDevices } from '../services/deviceHeartbeat.js'
import { triggerAndroidRefresh } from '../services/api.js'

export function useDeviceHeartbeat({
  devices,
  devicesStatusCache,
  devicesLastUpdateTime,
  deviceFirmwareInfo,
  deviceVersionInfo,
  cloudManageMode,
  selectedCloudDevice,
  instances,
  allInstances,
}) {
  const heartbeatUnknownIpWarned = new Set();

  // 从后端获取设备状态并更新前端缓存
  const fetchDevicesStatusFromBackend = async () => {
    try {
      const statusMap = await getDevicesStatus();

      if (!statusMap || Object.keys(statusMap).length === 0) {
        console.warn('[心跳] ⚠️ 后端返回的状态为空');
        return;
      }
      // 只报数量，不要把整个 statusMap 交给 console.log：这一行每秒执行一次，
      // DevTools 打开时每秒都要留一份 N 台设备的完整对象图（控制台 DOM 与内存
      // 一路涨，界面正是这样开始卡的），而它要表达的信息只有"多少台"。
      console.log('[心跳] 后端返回状态，设备数:', Object.keys(statusMap).length);

      // console.log('[心跳] ✓ 收到设备状态更新:');
      // console.log('[心跳] 状态数据样例:', Object.entries(statusMap)[0]); // 打印第一个设备的完整数据

      // N 台设备 × 每台一次 find = 每秒 O(N²)，设备一多这本身就是卡的来源。
      // 先按 IP 建一次索引，循环里 O(1) 查表。
      const deviceByIp = new Map();
      for (const d of devices.value) deviceByIp.set(d.ip, d);

      // 更新前端状态缓存
      let updatedCount = 0;
      let changedCount = 0;

      for (const [ip, statusInfo] of Object.entries(statusMap)) {
        const device = deviceByIp.get(ip);

        if (!device) {
          // 状态表每秒回来一次，不拦着就是每秒一条警告刷屏（控制台越堆越大）
          if (!heartbeatUnknownIpWarned.has(ip)) {
            heartbeatUnknownIpWarned.add(ip);
            console.warn(`[心跳] ⚠️ 找不到IP为 ${ip} 的设备`);
          }
          continue;
        }

        const newStatus = statusInfo.status;
        const oldStatus = devicesStatusCache.value.get(device.id);

        // 更新状态缓存
        devicesStatusCache.value.set(device.id, newStatus);
        devicesLastUpdateTime.value.set(device.id, Date.now());
        updatedCount++;

        // 设备离线：只清存储信息（显示"未知"）。API 版本信息保留——老 SDK(<208)
        // 设备会被判"离线"但列表还要显示它的 API 版本（启动时版本队列会现场探到，
        // 探不到的真死机设备本来就没有值，不会误留旧值）
        if (newStatus === 'offline') {
          // 清除存储信息
          deviceFirmwareInfo.value.delete(device.id);
          // console.log(`[心跳] 🔒 设备 ${ip} 离线，已清除缓存数据`);
        } else {
          // 设备在线，更新数据

          // 如果有 API 版本信息，更新到 deviceVersionInfo
          if (statusInfo.apiVersion && statusInfo.apiVersion !== '') {
            const currentVersionInfo = deviceVersionInfo.value.get(device.id) || {};

            // 🔧 智能更新策略: 只要新版本是有效正数就更新，避免升级中读到 "0"/旧值被"只增不减"锁永久锁死
            const currentApiVersion = parseInt(currentVersionInfo.currentVersion || '0');
            const newApiVersion = parseInt(statusInfo.apiVersion || '0');
            const isValidNewVersion = !Number.isNaN(newApiVersion) && newApiVersion > 0;

            // 新版本为有效正数即更新（不比大小），确保升级后新版本能正常同步上来
            if (isValidNewVersion) {
              deviceVersionInfo.value.set(device.id, {
                ...currentVersionInfo,
                currentVersion: statusInfo.apiVersion,
                latestVersion: statusInfo.latestVersion || currentVersionInfo.latestVersion,
                lastUpdateTime: Date.now()
              });

              if (newApiVersion !== currentApiVersion) {
                // console.log(`[心跳] 📈 设备 ${ip} API版本更新: ${currentVersionInfo.currentVersion} -> ${statusInfo.apiVersion}`);
              }
            } else {
              // console.log(`[心跳] ⏸️ 设备 ${ip} API版本无效，跳过更新(新=${statusInfo.apiVersion})`);
            }
          }

          // 🔧 更新 deviceFirmwareInfo (包括 responseTime)
          const currentFirmwareInfo = deviceFirmwareInfo.value.get(device.id) || {};

          // 🔧 缓存上次的延迟值: 只有新延迟>0时才更新,否则保留旧值
          const newResponseTime = statusInfo.responseTime && statusInfo.responseTime > 0 
            ? statusInfo.responseTime 
            : (currentFirmwareInfo.responseTime || 0);

          const updatedFirmwareInfo = {
            ...currentFirmwareInfo,
            responseTime: newResponseTime  // TCP Ping延迟(毫秒) - 缓存上次有效值
          };

          // 如果有存储信息，更新完整设备信息
          if (statusInfo.storageTotal && statusInfo.storageTotal > 0) {
            updatedFirmwareInfo.sdkVersion = statusInfo.sdkVersion || currentFirmwareInfo.sdkVersion;  // SDK版本
            updatedFirmwareInfo.deviceModel = statusInfo.deviceModel || currentFirmwareInfo.deviceModel;  // 设备型号
            updatedFirmwareInfo.originalData = {
                // 保留旧数据
                ...(currentFirmwareInfo.originalData || {}),
                // 更新存储信息（MB）
                mmctotal: statusInfo.storageTotal || 0,
                mmcuse: statusInfo.storageUsed || 0,
                mmcfree: statusInfo.storageFree || 0,
                // 更新 CPU 信息
                cputemp: statusInfo.cpuTemp || 0,
                cpuload: statusInfo.cpuLoad || '0%',
                // 更新内存信息（MB）
                // ⚠️ memtotal 不在事件流里：实测 system/stats 一帧只有 cputemp cpuload memuse
                // mmctotal mmcuse mmcread mmcwrite mmctemp sysuptime 九个键，Go 侧那条
                // 周期 REST 兜底也已经删了（见 device_heartbeat.go 定时器2 的位置）。
                // 所以这几个流给不了的字段取不到时要**沿用上一次的真值**（选中设备时
                // 前端自己打的那次 /info/device，fetchV3DeviceInfo），写 0/'' 会把它们冲掉：
                // 内存列的分母、网速、硬盘型号、MAC 都是这么没的。
                memtotal: statusInfo.memoryTotal || (currentFirmwareInfo.originalData?.memtotal || 0),
                memuse: statusInfo.memoryUsed || 0,
                // 更新网络信息
                speed: statusInfo.speed || (currentFirmwareInfo.originalData?.speed || '0'),
                network4g: statusInfo.network4g || (currentFirmwareInfo.originalData?.network4g || 'n'),
                netWork_eth0: statusInfo.networkEth0 || (currentFirmwareInfo.originalData?.netWork_eth0 || 'n'),
                // 更新硬盘信息
                mmcread: statusInfo.mmcRead || '0',
                mmcwrite: statusInfo.mmcWrite || '0',
                mmcmodel: statusInfo.mmcModel || (currentFirmwareInfo.originalData?.mmcmodel || ''),
                mmctemp: statusInfo.mmcTemp || '0',
                // 更新系统运行时间
                sysuptime: statusInfo.sysUptime || '0',
                // 更新设备基本信息
                model: statusInfo.deviceModel || (currentFirmwareInfo.originalData?.model || ''),
                version: statusInfo.sdkVersion || (currentFirmwareInfo.originalData?.version || ''),
                ip: statusInfo.ip || ip,
                ip_1: statusInfo.ip_1 || (currentFirmwareInfo.originalData?.ip_1 || ''),
                hwaddr: statusInfo.hwaddr || (currentFirmwareInfo.originalData?.hwaddr || ''),
                hwaddr_1: statusInfo.hwaddr_1 || (currentFirmwareInfo.originalData?.hwaddr_1 || ''),
                deviceId: statusInfo.deviceId || (currentFirmwareInfo.originalData?.deviceId || '')
              };
            updatedFirmwareInfo.lastUpdateTime = Date.now();

            // console.log(`[心跳] 💾 设备 ${ip} 完整信息更新: SDK=${statusInfo.sdkVersion}, CPU=${statusInfo.cpuTemp}°C/${statusInfo.cpuLoad}, 内存=${statusInfo.memoryUsed}/${statusInfo.memoryTotal}MB, 磁盘=${statusInfo.mmcModel}/${statusInfo.mmcTemp}°C, 网速=${statusInfo.speed}, 延迟=${statusInfo.responseTime}ms`);
          }

          // 🔧 更新 deviceFirmwareInfo (始终更新，包括只有responseTime的情况)
          deviceFirmwareInfo.value.set(device.id, updatedFirmwareInfo);
        }

        // 如果状态发生变化，输出日志
        if (oldStatus !== newStatus) {
          const ts = new Date().toLocaleTimeString()
          changedCount++;

          // ✅ 如果设备从离线变为在线（含首次判定在线：oldStatus === undefined），触发后端立即刷新安卓缓存
          if ((oldStatus === 'offline' || oldStatus === undefined) && newStatus === 'online') {
            console.log(`[心跳][${ts}] ✅ 设备上线  IP: ${ip}  名称: ${device.name || '-'}  ID: ${device.id}  延迟: ${statusInfo.responseTime ?? '-'}ms  API: ${statusInfo.apiVersion || '-'}`)
            triggerAndroidRefresh([ip]).catch(err => {
              console.error(`[心跳][${ts}] ❌ 触发设备 ${ip} 安卓缓存刷新失败:`, err);
            });
          }

          // ✅ 如果设备从在线变为离线，且是坑位模式当前选中设备，清空安卓列表
          if (oldStatus === 'online' && newStatus === 'offline') {
            console.log(`[心跳][${ts}] ❌ 设备离线  IP: ${ip}  名称: ${device.name || '-'}  ID: ${device.id}  上次延迟: ${statusInfo.responseTime ?? '-'}ms`)
            if (cloudManageMode.value === 'slot' && selectedCloudDevice.value?.ip === ip) {
              instances.value = []
              allInstances.value = []
              console.log(`[心跳][${ts}] 🗑️ 坑位模式：设备 ${ip} 离线，已清空安卓列表`)
            }
          }

          // 其他状态变化（如首次判定离线：undefined -> offline）
          if (!((oldStatus === 'offline' || oldStatus === undefined) && newStatus === 'online') &&
              !(oldStatus === 'online' && newStatus === 'offline')) {
            console.log(`[心跳][${ts}] 🔄 设备状态变化  IP: ${ip}  名称: ${device.name || '-'}  ${oldStatus ?? '首次'} -> ${newStatus}`)
          }
        }
      }

      // console.log(`[心跳] 更新完成: ${updatedCount}个设备已更新, ${changedCount}个状态发生变化`);
      // console.log('[心跳] 当前状态缓存:', Array.from(devicesStatusCache.value.entries()));
    } catch (error) {
      console.error('[心跳] ❌ 获取设备状态失败:');
      console.error('[心跳] 错误详情:', error);
      console.error('[心跳] 错误堆栈:', error.stack);
    }
  }

  // 更新监控设备列表（当设备列表变化时调用）
  const updateHeartbeatDevices = async () => {
    try {
      const deviceIPs = [...new Set(devices.value.map(device => device.ip))];
      const deviceNamesMap = {}
      // 同IP多设备时，以最后添加的设备名称为准
      devices.value.forEach(d => { deviceNamesMap[d.ip] = d.name || d.ip })
      await updateMonitoredDevices(deviceIPs, deviceNamesMap);
      // console.log('[心跳] 已更新监控设备列表');
    } catch (error) {
      // console.error('[心跳] 更新监控设备列表失败:', error);
    }
  }

  return {
    heartbeatUnknownIpWarned,
    fetchDevicesStatusFromBackend,
    updateHeartbeatDevices,
  }
}
