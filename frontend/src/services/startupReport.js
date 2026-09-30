/**
 * 启动上报（日活统计）的前端入口。
 *
 * 这是一条纯统计旁路：只把 uid 推给 Go 侧，除此之外不做任何事。
 * 因此所有异常都必须就地咽掉——接口报错、绑定未生成、Go 侧 panic 都好，
 * 一律只打 console.warn，绝不能中断调用方的流程（onMounted / 登录 / 授权同步）。
 */
import { SetStartupReportUid } from '../../bindings/edgeclient/app'

/**
 * 把 uid 回填给 Go 侧的启动上报服务。失败静默。
 * @param {string} uid 当前登录用户 uid，取不到传空串
 */
export function reportStartupUid(uid) {
  try {
    const p = SetStartupReportUid(uid || '')
    // 绑定返回 Promise；同步抛错（如绑定缺失）已被 try 兜住，这里兜异步拒绝
    if (p && typeof p.catch === 'function') {
      p.catch((e) => console.warn('[启动上报] 回填 uid 失败（忽略）:', e))
    }
  } catch (e) {
    console.warn('[启动上报] 回填 uid 失败（忽略）:', e)
  }
}
