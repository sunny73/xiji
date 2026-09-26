/**
 * 小程序入口。
 *
 * 启动时做一次静默登录：登录失败**不阻塞**进入首页——首页自己有加载态和重试，
 * 而如果在这里 await 登录，网络差的时候用户会卡在空白启动页。
 */

const auth = require('./services/auth')
const config = require('./utils/config')

App({
  globalData: {
    user: null,
    config,
  },

  onLaunch() {
    auth
      .ensureLogin()
      .then((user) => {
        this.globalData.user = user
      })
      .catch((err) => {
        // 登录失败不弹窗：用户可能只是还没配好后端地址，首页会给出更具体的提示
        console.warn('[app] 静默登录失败：', err && err.message)
      })
  },

  onError(err) {
    console.error('[app] 未捕获错误：', err)
  },
})
