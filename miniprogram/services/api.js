/**
 * 业务接口层。
 *
 * 职责：
 *   1. 拼 baseUrl、带 token
 *   2. 401 时自动重新登录并**重放一次**原请求
 *   3. 把 HTTP 错误翻译成能直接 toast 的中文
 *
 * 页面里只调这里的函数，不直接碰 wx.request。
 */

const http = require('./http')
const auth = require('./auth')
const config = require('../utils/config')
const { cleanParams } = require('../utils/format')

/** 把后端返回体转成 Error */
function buildError(res) {
  const status = res.statusCode
  const body = res.data
  let detail = ''

  if (body && typeof body === 'object') {
    if (typeof body.detail === 'string') {
      detail = body.detail
    } else if (Array.isArray(body.detail)) {
      // FastAPI 的 422：detail 是 [{loc, msg, type}, ...]
      detail = body.detail
        .map(function (d) {
          const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : ''
          return (field ? field + ': ' : '') + (d.msg || '')
        })
        .join('；')
    }
  }

  const fallback = {
    400: '请求不合法',
    401: '登录已过期，请重新进入小程序',
    403: '没有权限',
    404: '数据不存在或无权访问',
    409: '数据冲突',
    422: '参数不合法',
    500: '服务器出错了，请稍后重试',
  }
  const message = detail || fallback[status] || '请求失败（HTTP ' + status + '）'

  const err = new Error(message)
  err.statusCode = status
  err.detail = detail
  err.body = body
  return err
}

/**
 * 发起一个业务请求。
 * @param {object} options
 * @param {string} options.url
 * @param {string} [options.method]
 * @param {object} [options.data]
 * @param {boolean} [options.needAuth=true]
 */
function call(options) {
  const opts = options || {}
  const needAuth = opts.needAuth !== false
  const retried = opts._retried === true

  const header = {}
  if (needAuth) {
    const token = auth.getToken()
    if (token) header.Authorization = 'Bearer ' + token
  }

  return http
    .rawRequest({
      url: config.baseUrl + opts.url,
      method: opts.method,
      data: opts.data,
      header: header,
    })
    .then(function (res) {
      if (res.statusCode >= 200 && res.statusCode < 300) return res.data

      // token 过期：重新登录后**只重放一次**，避免死循环
      if (res.statusCode === 401 && needAuth && !retried) {
        auth.logout()
        return auth.login().then(function () {
          return call(Object.assign({}, opts, { _retried: true }))
        })
      }
      throw buildError(res)
    })
}

// --- 认证 -------------------------------------------------------------------

const authApi = {
  me: function () {
    return call({ url: '/auth/me' })
  },
  updateMe: function (data) {
    return call({ url: '/auth/me', method: 'PATCH', data: data })
  },
}

// --- 账户 -------------------------------------------------------------------

const accountApi = {
  list: function () {
    return call({ url: '/accounts' })
  },
  create: function (data) {
    return call({ url: '/accounts', method: 'POST', data: data })
  },
  update: function (id, data) {
    return call({ url: '/accounts/' + id, method: 'PUT', data: data })
  },
  remove: function (id) {
    return call({ url: '/accounts/' + id, method: 'DELETE' })
  },
}

// --- 证券 -------------------------------------------------------------------

const securityApi = {
  /** @param {{keyword?: string, limit?: number}} params */
  list: function (params) {
    return call({ url: '/securities', data: cleanParams(params) })
  },
  /** 幂等：同 code+market 会返回已存在的那条，所以可以先建后查 */
  create: function (data) {
    return call({ url: '/securities', method: 'POST', data: data })
  },
  detail: function (id) {
    return call({ url: '/securities/' + id })
  },
}

// --- 持仓 -------------------------------------------------------------------

const holdingApi = {
  list: function (params) {
    return call({ url: '/holdings', data: cleanParams(params) })
  },
  detail: function (id) {
    return call({ url: '/holdings/' + id })
  },
  create: function (data) {
    return call({ url: '/holdings', method: 'POST', data: data })
  },
  update: function (id, data) {
    return call({ url: '/holdings/' + id, method: 'PUT', data: data })
  },
  remove: function (id) {
    return call({ url: '/holdings/' + id, method: 'DELETE' })
  },
}

// --- 分红 -------------------------------------------------------------------

const dividendApi = {
  /**
   * @param {{account_id?, year?, month?, status?, page?, page_size?}} params
   * @returns {Promise<{total, page, page_size, items}>}
   */
  list: function (params) {
    return call({ url: '/dividends', data: cleanParams(params) })
  },
  detail: function (id) {
    return call({ url: '/dividends/' + id })
  },
  /**
   * ⚠️ 不要传 amount —— 后端的 Create 结构里没有这个字段且禁止额外字段，
   * 传了会直接 422。金额由后端按 shares × per_share 计算。
   */
  create: function (data) {
    return call({ url: '/dividends', method: 'POST', data: data })
  },
  update: function (id, data) {
    return call({ url: '/dividends/' + id, method: 'PUT', data: data })
  },
  remove: function (id) {
    return call({ url: '/dividends/' + id, method: 'DELETE' })
  },
  markReceived: function (id, paymentDate) {
    const body = {}
    if (paymentDate) body.payment_date = paymentDate
    return call({ url: '/dividends/' + id + '/receive', method: 'POST', data: body })
  },
}

// --- 首页 / 统计 -------------------------------------------------------------

const dashboardApi = {
  get: function (params) {
    return call({ url: '/dashboard', data: cleanParams(params) })
  },
  estimated: function (params) {
    return call({ url: '/dashboard/estimated', data: cleanParams(params) })
  },
}

const statisticsApi = {
  yearly: function (params) {
    return call({ url: '/statistics/yearly', data: cleanParams(params) })
  },
  monthly: function (params) {
    return call({ url: '/statistics/monthly', data: cleanParams(params) })
  },
  bySecurity: function (params) {
    return call({ url: '/statistics/securities', data: cleanParams(params) })
  },
  calendar: function (params) {
    return call({ url: '/statistics/calendar', data: cleanParams(params) })
  },
}

module.exports = {
  call: call,
  buildError: buildError,
  auth: authApi,
  accounts: accountApi,
  securities: securityApi,
  holdings: holdingApi,
  dividends: dividendApi,
  dashboard: dashboardApi,
  statistics: statisticsApi,
}
