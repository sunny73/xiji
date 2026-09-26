/**
 * wx.* 的浏览器实现。
 *
 * 目标：让 miniprogram/services/ 和所有页面代码**一行都不用改**就能跑。
 * 所以回调和返回值的形状必须严格对齐小程序的约定
 * （statusCode 走 success 而不是 reject、storage 缺键返回 ''、等等）。
 */

const ui = require('./ui')

const PREFIX = 'dmh5:'

// --- storage ---------------------------------------------------------------

function getStorageSync(key) {
  const raw = localStorage.getItem(PREFIX + key)
  if (raw === null) return ''
  try {
    return JSON.parse(raw)
  } catch (e) {
    return raw
  }
}

function setStorageSync(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value))
}

function removeStorageSync(key) {
  localStorage.removeItem(PREFIX + key)
}

function clearStorageSync() {
  Object.keys(localStorage)
    .filter(function (k) {
      return k.indexOf(PREFIX) === 0
    })
    .forEach(function (k) {
      localStorage.removeItem(k)
    })
}

// --- request ---------------------------------------------------------------

function toQuery(data) {
  if (!data) return ''
  return Object.keys(data)
    .filter(function (k) {
      const v = data[k]
      return v !== undefined && v !== null && v !== ''
    })
    .map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(data[k])
    })
    .join('&')
}

function request(options) {
  const opts = options || {}
  const method = (opts.method || 'GET').toUpperCase()
  let url = opts.url
  let body

  if (method === 'GET') {
    const qs = toQuery(opts.data)
    if (qs) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs
  } else if (opts.data !== undefined && opts.data !== null) {
    body = typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data)
  }

  fetch(url, {
    method: method,
    headers: Object.assign({}, opts.header || {}),
    body: body,
  })
    .then(function (res) {
      return res.text().then(function (text) {
        let data = null
        if (text) {
          try {
            data = JSON.parse(text)
          } catch (e) {
            data = text
          }
        }
        // 和小程序一致：4xx/5xx 也走 success，由业务层看 statusCode
        if (opts.success) opts.success({ statusCode: res.status, data: data, header: {} })
      })
    })
    .catch(function (err) {
      if (opts.fail) opts.fail({ errMsg: 'request:fail ' + (err && err.message) })
      if (opts.complete) opts.complete()
    })
}

// --- login -----------------------------------------------------------------

function login(options) {
  const opts = options || {}
  // 预览环境没有微信，给一个稳定的伪 code。
  // 后端 WECHAT_MOCK=true 时它会被推导成 openid；不过我们默认走 dev-login，用不到这里。
  setTimeout(function () {
    if (opts.success) opts.success({ code: 'h5-preview-code', errMsg: 'login:ok' })
  }, 0)
}

// --- 其他 ------------------------------------------------------------------

const noop = function () {}

const wx = {
  // storage
  getStorageSync: getStorageSync,
  setStorageSync: setStorageSync,
  removeStorageSync: removeStorageSync,
  clearStorageSync: clearStorageSync,

  // 网络与登录
  request: request,
  login: login,

  // 交互反馈
  showToast: function (o) {
    ui.toast(o)
  },
  hideToast: noop,
  showLoading: function (o) {
    ui.showLoading(o)
  },
  hideLoading: ui.hideLoading,
  showModal: ui.showModal,
  showActionSheet: ui.showActionSheet,

  // 下拉刷新：预览里由外层容器接管，这里只需要不报错
  stopPullDownRefresh: noop,
  startPullDownRefresh: noop,

  // 导航：由 router 在启动时注入（避免循环依赖）
  navigateTo: noop,
  redirectTo: noop,
  switchTab: noop,
  navigateBack: noop,
  reLaunch: noop,

  // 导航栏标题：同样由 router 注入
  setNavigationBarTitle: noop,

  getSystemInfoSync: function () {
    return { platform: 'devtools', system: 'H5 Preview', windowWidth: 375, windowHeight: 667 }
  },
}

/** 由 router 调用，把导航能力接上去 */
function installNavigation(nav) {
  wx.navigateTo = function (o) {
    nav.navigateTo(o.url, o)
  }
  wx.redirectTo = function (o) {
    nav.redirectTo(o.url, o)
  }
  wx.switchTab = function (o) {
    nav.switchTab(o.url, o)
  }
  wx.navigateBack = function (o) {
    nav.navigateBack((o && o.delta) || 1, o)
  }
  wx.reLaunch = function (o) {
    nav.reLaunch(o.url, o)
  }
  wx.setNavigationBarTitle = function (o) {
    nav.setTitle(o.title)
  }
}

module.exports = { wx: wx, installNavigation: installNavigation }
