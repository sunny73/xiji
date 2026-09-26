/**
 * 环境配置。
 *
 * 和小程序版的区别：uni-app 要同时发小程序和 H5，两边的接口地址规则不一样 ——
 *   - H5 开发：走 vite 代理到后端（见 vite.config.js），浏览器视角**同源**，
 *     所以完全不用改后端的 CORS 配置
 *   - 小程序：没有代理这回事，request 合法域名必须是完整 https 地址
 * 这里用 uni-app 的条件编译把差异收在一处。
 */

/** 改成 'prod' 就是生产配置 */
const ENV = 'dev'

/** ⚠️ 上线前改成你自己的域名（必须 HTTPS 且已 ICP 备案） */
const PROD_BASE = 'https://api.example.com/api/v1'

// 开发环境的地址：各平台规则不一样，用条件编译分开写。
//
// ⚠️ 条件编译是**构建期**做代码裁剪，在纯 Node（比如单元测试）里
// `// #ifdef` 只是普通注释，块内的赋值照样会执行 ——
// 所以 Node 里 devBase 会是 '/api/v1'。写测试时要知道这一点。
let devBase = PROD_BASE

// #ifdef H5
// H5 跑在浏览器里，用相对路径走 vite 代理（同源，不用动后端 CORS）
devBase = '/api/v1'
// #endif

// #ifdef MP-WEIXIN
// 小程序没有代理这回事，request 域名只能是完整地址。
// 模拟器：127.0.0.1 就是本机（配合开发者工具的「不校验合法域名」）
// 真机联调：换成电脑的局域网 IP，例如 http://192.168.1.8:8000/api/v1
devBase = 'http://127.0.0.1:8000/api/v1'
// #endif

const config = {
  env: ENV,

  baseUrl: ENV === 'prod' ? PROD_BASE : devBase,

  // 开发环境用固定 openid 免微信登录（后端 /auth/dev-login）。
  // 不这么做的话，开发者工具每次 uni.login 返回的 code 都不同，
  // 而后端 WECHAT_MOCK=true 时 openid 由 code 推导 —— 每次启动都会变成新用户。
  //
  // 生产环境必须为空字符串：留着的后果是客户端去调 /auth/dev-login，
  // 而生产环境的 ALLOW_DEV_LOGIN=false 会让它返回 404，用户直接登录不了。
  devOpenid: ENV === 'prod' ? '' : 'dev-local-user',

  // 微信登录失败时是否降级到 /auth/dev-login。生产必须 false。
  allowDevLoginFallback: ENV !== 'prod',
}

export default config
