/**
 * 页面级测试装置。
 *
 * 小程序页面模块依赖全局的 `Page()`，在 Node 里本来跑不起来。
 * 但页面里的逻辑（reload / onReachBottom / onCodeInput 这些）恰恰是最容易出 bug 的地方——
 * 本次审查找到的 3 个 P0 全在页面层。
 *
 * 做法：临时挂一个 `Page` 全局把配置对象接住，再造一个假的页面实例
 * （有 data 和 setData），就能像调用普通对象方法一样测页面逻辑了。
 *
 * 这不是渲染测试（WXML 仍然测不了），但覆盖了"状态机"这一层。
 */

/** 加载页面模块并取出它传给 Page() 的配置对象 */
function loadPage(relPath) {
  const resolved = require.resolve(relPath)
  let captured = null

  const previous = global.Page
  global.Page = function (config) {
    captured = config
  }

  try {
    delete require.cache[resolved]
    require(resolved)
  } finally {
    if (previous === undefined) delete global.Page
    else global.Page = previous
  }

  if (!captured) throw new Error(relPath + ' 没有调用 Page()')
  return captured
}

/** 深拷贝一份纯 JSON 的 data，避免多个页面实例共享同一份初始数据 */
function cloneData(data) {
  return JSON.parse(JSON.stringify(data || {}))
}

/**
 * 用页面配置造一个可调用的假页面实例。
 * @param {object} config loadPage() 的返回值
 * @param {object} [overrides] 覆盖初始 data
 */
function createPage(config, overrides) {
  const page = Object.assign({}, config)
  page.data = Object.assign(cloneData(config.data), overrides || {})

  page.setData = function (patch, callback) {
    Object.keys(patch || {}).forEach(function (k) {
      page.data[k] = patch[k]
    })
    if (typeof callback === 'function') callback()
  }

  // 记录 setData 被调用的次数，方便断言"有没有白渲染"
  page.__setDataCalls = 0
  const rawSetData = page.setData
  page.setData = function (patch, callback) {
    page.__setDataCalls++
    return rawSetData(patch, callback)
  }

  return page
}

/**
 * 可以手动控制何时 resolve 的 Promise —— 用来构造"请求在途"的时序。
 */
function deferred() {
  let resolve
  let reject
  const promise = new Promise(function (res, rej) {
    resolve = res
    reject = rej
  })
  return { promise: promise, resolve: resolve, reject: reject }
}

/** 让所有已 resolve 的 promise 回调跑完 */
function flush() {
  return new Promise(function (r) {
    setTimeout(r, 0)
  })
}

module.exports = { loadPage, createPage, deferred, flush, cloneData }
