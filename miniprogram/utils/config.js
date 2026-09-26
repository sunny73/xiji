/**
 * 环境配置。
 *
 * ⚠️ 真机调试注意：手机和电脑不在同一个"127.0.0.1"上。
 * 真机预览时把 baseUrl 改成电脑的局域网 IP，例如 http://192.168.1.8:8000/api/v1，
 * 并在微信开发者工具里打开「详情 → 本地设置 → 不校验合法域名」。
 */

const ENV = 'dev' // dev | prod

const ENVS = {
  dev: {
    baseUrl: 'http://127.0.0.1:8000/api/v1',

    // 开发环境用固定 openid 直接登录（后端 /auth/dev-login）。
    // 不这么做的话，开发者工具每次 wx.login 返回的 code 都不同，
    // 而后端 WECHAT_MOCK=true 时 openid 由 code 推导 —— 每次启动都会变成新用户，
    // 刚录的数据看起来就"消失"了。
    // 设为空字符串则改为走真实微信登录流程。
    devOpenid: 'dev-local-user',

    // 微信登录失败时是否允许降级到 /auth/dev-login（没配 AppID 时用）
    allowDevLoginFallback: true,
  },
  prod: {
    // 上线前改成你的 HTTPS 域名，并在微信公众平台配置 request 合法域名
    baseUrl: 'https://api.example.com/api/v1',
    devOpenid: '',
    allowDevLoginFallback: false,
  },
}

module.exports = Object.assign({ env: ENV }, ENVS[ENV] || ENVS.dev)
