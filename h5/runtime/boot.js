/**
 * 预览启动入口。
 *
 * 顺序很重要：
 *   1. 先把 utils/config 的 baseUrl 指向预览服务（同源，由 server.js 代理到后端，绕开 CORS）
 *   2. 再装 wx / App / Page 全局——app.js 一被执行就会用到 App()
 *   3. 执行 app.js
 *   4. 启动路由，渲染第一个页面
 */

const router = require('./router')
const shim = require('./wx-shim')

function boot() {
  const preview = window.__DM_PREVIEW__ || {}

  // 支持 ?page=/pages/holdings/index 直接打开某个页面（逐页排查时很有用）
  try {
    const deepLink = new URLSearchParams(window.location.search).get('page')
    if (deepLink) preview.startPage = deepLink
  } catch (e) {
    /* 老浏览器没有 URLSearchParams，忽略即可 */
  }

  // 1) 改配置。config 是模块单例，这里改完 services/http.js 立刻生效
  const config = __require('utils/config.js')
  config.baseUrl = preview.apiBase || '/api/v1'
  if (preview.devOpenid) config.devOpenid = preview.devOpenid
  // 预览没有微信，允许降级到 dev-login
  config.allowDevLoginFallback = true
  config.env = 'dev'

  // 2) 装全局
  window.wx = shim.wx
  shim.installNavigation(router)

  let appConfig = null
  window.App = function (cfg) {
    appConfig = cfg
  }
  // 具体页面由 router 在 require 时临时接管 window.Page
  window.Page = function () {}

  // 3) 跑 app.js（注册 App、挂 globalData、触发静默登录）
  __require('app.js')
  if (appConfig) {
    window.__DM_APP__ = appConfig
    if (typeof appConfig.onLaunch === 'function') {
      try {
        appConfig.onLaunch.call(appConfig)
      } catch (e) {
        console.error('[h5] app.onLaunch 出错', e)
      }
    }
  }

  // 4) 启动
  router.start(
    {
      body: document.getElementById('h5-body'),
      navTitle: document.getElementById('h5-nav-title'),
      tabbar: document.getElementById('h5-tabbar'),
    },
    preview.startPage
  )

  document.body.classList.add('h5-ready')
  console.log('[h5] 预览已启动', {
    apiBase: config.baseUrl,
    pages: (window.__DM_BUNDLE__.appConfig.pages || []).length,
  })
}

module.exports = boot
