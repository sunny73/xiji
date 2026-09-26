/**
 * 登录与 token 管理。
 *
 * 登录流程：
 *   开发环境（config.devOpenid 非空）→ POST /auth/dev-login，用**固定 openid**
 *   生产环境                        → wx.login() 拿 code → POST /auth/wechat-login
 *
 * 为什么开发环境不直接走 wx.login：
 *   开发者工具每次 wx.login 返回的 code 都不一样，而后端 WECHAT_MOCK=true 时
 *   openid 是由 code 推导的 —— 结果就是**每次启动都是新用户**，刚录的数据"消失"了。
 *   固定 openid 才能让本地开发有稳定的身份。
 */

const http = require('./http')
const config = require('../utils/config')

const TOKEN_KEY = 'dm_token'
const USER_KEY = 'dm_user'

/** 并发登录去重：多个页面同时触发 401 时只发一次登录请求 */
let loginInFlight = null

function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || ''
  } catch (e) {
    return ''
  }
}

function getUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null
  } catch (e) {
    return null
  }
}

function isLoggedIn() {
  return !!getToken()
}

function saveSession(token, user) {
  wx.setStorageSync(TOKEN_KEY, token)
  if (user) wx.setStorageSync(USER_KEY, user)
  return user
}

function logout() {
  try {
    wx.removeStorageSync(TOKEN_KEY)
    wx.removeStorageSync(USER_KEY)
  } catch (e) {
    /* 清缓存失败不影响主流程 */
  }
}

/** 把 wx.login 包成 Promise */
function wxLogin() {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || !wx.login) {
      reject(new Error('当前环境不支持 wx.login'))
      return
    }
    wx.login({
      success(res) {
        if (res && res.code) resolve(res.code)
        else reject(new Error('wx.login 没有返回 code'))
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || 'wx.login 失败'))
      },
    })
  })
}

/** 从响应里抽出 token，顺便把格式不对的情况挡在这里 */
function pickToken(res) {
  if (res.statusCode !== 200 || !res.data || !res.data.access_token) {
    const detail = res.data && res.data.detail
    throw new Error(
      typeof detail === 'string' ? detail : '登录失败（HTTP ' + res.statusCode + '）'
    )
  }
  return res.data
}

function wechatLogin(code) {
  return http
    .rawRequest({
      url: config.baseUrl + '/auth/wechat-login',
      method: 'POST',
      data: { code },
    })
    .then(pickToken)
}

function devLogin(openid, nickname) {
  return http
    .rawRequest({
      url: config.baseUrl + '/auth/dev-login',
      method: 'POST',
      data: { openid, nickname: nickname || undefined },
    })
    .then(pickToken)
}

/** 真正执行登录，不做并发去重 */
function doLogin(options) {
  const opts = options || {}
  const openid = opts.openid || config.devOpenid

  if (openid && !opts.forceWechat) {
    return devLogin(openid, opts.nickname)
  }

  return wxLogin()
    .then(wechatLogin)
    .catch((err) => {
      if (!config.allowDevLoginFallback) throw err
      // 没配 AppID / 后端 WECHAT_MOCK=false 时降级，保证本地开发不被登录卡住
      console.warn('[auth] 微信登录失败，降级到 dev-login：', err.message)
      return devLogin('dev-fallback-user', opts.nickname)
    })
}

/**
 * 登录并保存会话。
 * @returns {Promise<object>} user
 */
function login(options) {
  if (loginInFlight) return loginInFlight

  loginInFlight = doLogin(options)
    .then((data) => saveSession(data.access_token, data.user))
    .then(
      (user) => {
        loginInFlight = null
        return user
      },
      (err) => {
        loginInFlight = null
        throw err
      }
    )

  return loginInFlight
}

/** 有 token 就直接用（过期交给 api.js 的 401 重试处理），否则登录 */
function ensureLogin() {
  if (isLoggedIn()) return Promise.resolve(getUser())
  return login()
}

/** 切换开发身份：换一个 openid 重新登录，用来验证多用户数据隔离 */
function switchDevUser(openid, nickname) {
  logout()
  return login({ openid: openid, nickname: nickname })
}

module.exports = {
  TOKEN_KEY,
  USER_KEY,
  getToken,
  getUser,
  isLoggedIn,
  ensureLogin,
  login,
  logout,
  switchDevUser,
}
