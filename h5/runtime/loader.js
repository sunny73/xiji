/**
 * 预览的模块加载器 + 启动。
 *
 * 这个文件**不是**一个模块，而是被 build.js 原样追加到 bundle 末尾的引导代码。
 * 浏览器里没有 CommonJS，所以这里提供最小实现：模块表来自 __DM_BUNDLE__.modules，
 * 每个模块被包成 function (module, exports, __require)。
 *
 * __require 挂到 window 上是必要的：router.js 需要在运行时按需加载页面模块，
 * 它引用的是自由变量 __require，会解析到这里。
 */
(function () {
  var modules = (window.__DM_BUNDLE__ || {}).modules || {}
  var cache = {}

  function __require(id) {
    if (cache[id]) return cache[id].exports
    var mod = { exports: {} }
    cache[id] = mod
    if (!modules[id]) {
      throw new Error('模块不存在：' + id + '（build.js 漏打包了？）')
    }
    modules[id](mod, mod.exports, __require)
    return mod.exports
  }

  window.__require = __require

  function showFatal(err) {
    console.error('[h5] 预览启动失败', err)
    var target = document.getElementById('h5-body')
    if (!target) return
    var pre = document.createElement('pre')
    pre.style.cssText = 'white-space:pre-wrap;font-size:12px;margin:10px 0 0'
    pre.textContent = String((err && err.stack) || err)
    var box = document.createElement('div')
    box.style.cssText =
      'padding:20px;font:13px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;color:#d9534f'
    var title = document.createElement('b')
    title.textContent = '预览启动失败'
    box.appendChild(title)
    box.appendChild(pre)
    target.innerHTML = ''
    target.appendChild(box)
  }

  function boot() {
    try {
      __require('runtime/boot.js')()
    } catch (err) {
      showFatal(err)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
