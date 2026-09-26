/**
 * 最底层的 HTTP 封装，只做一件事：把 wx.request 变成 Promise。
 *
 * 这里**不碰 token、不做重试**，那些在 auth.js / api.js 里。
 * 分层是为了避免循环依赖：http ← auth ← api，单向的。
 */

const config = require('../utils/config')

/** 把 wx.request 的 errMsg 翻译成用户能看懂的话 */
function networkMessage(err) {
  const msg = (err && err.errMsg) || ''
  if (msg.indexOf('domain list') >= 0 || msg.indexOf('not in domain') >= 0) {
    return '请求域名未配置：开发时请在开发者工具「详情 → 本地设置」勾选「不校验合法域名」'
  }
  if (msg.indexOf('timeout') >= 0) {
    return '请求超时，请检查后端是否已启动'
  }
  if (msg.indexOf('fail') >= 0) {
    return '连不上后端，请确认服务已启动且地址正确'
  }
  return msg || '网络异常'
}

/**
 * @param {object} options
 * @param {string} options.url      完整 URL
 * @param {string} [options.method] GET/POST/PUT/DELETE
 * @param {object} [options.data]
 * @param {object} [options.header]
 * @returns {Promise<{statusCode:number, data:any}>} 只要不是网络层失败就一定 resolve，
 *          由调用方根据 statusCode 决定怎么处理（401 要重登，不能在这里吞掉）
 */
function rawRequest(options) {
  const opts = options || {}
  return new Promise((resolve, reject) => {
    wx.request({
      url: opts.url,
      method: opts.method || 'GET',
      data: opts.data,
      header: Object.assign({ 'Content-Type': 'application/json' }, opts.header || {}),
      timeout: opts.timeout || 15000,
      success(res) {
        resolve({ statusCode: res.statusCode, data: res.data, header: res.header })
      },
      fail(err) {
        const e = new Error(networkMessage(err))
        e.isNetworkError = true
        e.raw = err
        e.baseUrl = config.baseUrl
        reject(e)
      },
    })
  })
}

module.exports = { rawRequest, networkMessage, config }
