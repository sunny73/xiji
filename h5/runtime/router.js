/**
 * 页面路由 + 渲染。
 *
 * 负责把小程序那套"页面栈 + Page 配置 + setData"跑起来：
 *   - 按需 require 页面模块，接住它传给 Page() 的配置对象
 *   - 造页面实例，onLoad(query) → onShow() → 渲染
 *   - setData 触发重新渲染（渲染的是完整 HTML，不是补丁——页面小，够快）
 *   - 事件用委托，而不是每次渲染都重新 addEventListener
 */

const wxml = require('./wxml')
const ui = require('./ui')

const bundle = window.__DM_BUNDLE__
const appJson = bundle.appConfig

const configCache = {}
const astCache = {}
const tabInstances = {}

let refs = { body: null, navTitle: null, tabbar: null }
let stack = []
let currentTitle = ''

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function parseUrl(url) {
  const raw = String(url || '')
  const qIndex = raw.indexOf('?')
  const pathPart = qIndex < 0 ? raw : raw.slice(0, qIndex)
  const qs = qIndex < 0 ? '' : raw.slice(qIndex + 1)
  const route = pathPart.replace(/^\//, '')

  const query = {}
  qs.split('&')
    .filter(Boolean)
    .forEach(function (pair) {
      const i = pair.indexOf('=')
      const k = i < 0 ? pair : pair.slice(0, i)
      const v = i < 0 ? '' : pair.slice(i + 1)
      query[decodeURIComponent(k)] = decodeURIComponent(v)
    })
  return { route: route, query: query }
}

function assetUrl(p) {
  if (!p) return ''
  return '/mp-assets/' + String(p).replace(/^assets\//, '')
}

function isTabRoute(route) {
  const list = (appJson.tabBar && appJson.tabBar.list) || []
  return list.some(function (i) {
    return i.pagePath === route
  })
}

// ---------------------------------------------------------------------------
// 页面实例
// ---------------------------------------------------------------------------

function loadConfig(route) {
  if (configCache[route]) return configCache[route]
  let captured = null
  const previous = window.Page
  window.Page = function (cfg) {
    captured = cfg
  }
  try {
    __require(route + '.js')
  } catch (e) {
    console.error('[h5] 加载页面失败 ' + route, e)
  } finally {
    window.Page = previous
  }
  configCache[route] = captured || {}
  return configCache[route]
}

function compileFor(route) {
  if (!astCache[route]) {
    const source = bundle.wxml[route]
    astCache[route] = wxml.parse(source || '<view>缺少 WXML</view>')
  }
  return astCache[route]
}

function createInstance(route) {
  const cfg = loadConfig(route)
  const inst = {}

  // 页面方法平铺到实例上（页面代码就是这么用 this 的）
  Object.keys(cfg).forEach(function (key) {
    if (key !== 'data') inst[key] = cfg[key]
  })
  inst.data = JSON.parse(JSON.stringify(cfg.data || {}))
  inst.__route = route

  inst.setData = function (patch, callback) {
    Object.keys(patch || {}).forEach(function (key) {
      inst.data[key] = patch[key]
    })
    // 只有当前正在展示的页面才需要重渲染
    if (current() && current().instance === inst) render()
    if (typeof callback === 'function') callback()
  }

  return inst
}

function getInstance(route) {
  if (isTabRoute(route)) {
    if (!tabInstances[route]) tabInstances[route] = createInstance(route)
    return tabInstances[route]
  }
  return createInstance(route)
}

function current() {
  return stack[stack.length - 1] || null
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function render() {
  const entry = current()
  if (!entry || !refs.body) return
  const inst = entry.instance

  const cfg = configCache[entry.route] || {}
  const title =
    cfg.navigationBarTitleText || (appJson.window && appJson.window.navigationBarTitleText) || ''
  if (refs.navTitle) refs.navTitle.textContent = title || currentTitle || ''

  // 记住焦点和光标位置：整块 innerHTML 替换会丢掉它们，输入框会"打一个字就失焦"
  const active = document.activeElement
  const focusKey =
    active && active.getAttribute && active.getAttribute('data-wx-input') ? active.getAttribute('data-wx-input') : null
  const selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null
  const selEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null
  const scrollTop = refs.body.scrollTop

  const result = wxml.render(compileFor(entry.route), inst.data)
  refs.body.innerHTML = result.html
  entry.pickers = result.pickers

  if (focusKey) {
    const next = refs.body.querySelector('[data-wx-input="' + focusKey.replace(/"/g, '\\"') + '"]')
    if (next) {
      next.focus()
      if (selStart !== null && next.setSelectionRange) {
        try {
          next.setSelectionRange(selStart, selEnd)
        } catch (e) {
          /* number 类型 input 不支持 */
        }
      }
    }
  }
  if (scrollTop) refs.body.scrollTop = scrollTop

  renderTabbar()
}

function renderTabbar() {
  const tabBar = appJson.tabBar
  if (!refs.tabbar) return
  if (!tabBar || !tabBar.list) {
    refs.tabbar.style.display = 'none'
    return
  }
  const entry = current()
  const active = entry && isTabRoute(entry.route)
  refs.tabbar.style.display = active ? 'flex' : 'none'
  if (!active) return

  refs.tabbar.innerHTML = tabBar.list
    .map(function (item) {
      const on = item.pagePath === entry.route
      const icon = on ? item.selectedIconPath : item.iconPath
      return (
        '<div class="h5-tab' + (on ? ' h5-tab--on' : '') + '" data-tab="' + item.pagePath + '">' +
        '<img class="h5-tab-icon" src="' + assetUrl(icon) + '" alt="">' +
        '<span class="h5-tab-text">' + item.text + '</span>' +
        '</div>'
      )
    })
    .join('')
}

// ---------------------------------------------------------------------------
// 事件委托
// ---------------------------------------------------------------------------

function datasetOf(node) {
  const ds = {}
  if (!node || !node.attributes) return ds
  for (let i = 0; i < node.attributes.length; i++) {
    const attr = node.attributes[i]
    if (attr.name.indexOf('data-') !== 0) continue
    if (attr.name.indexOf('data-wx-') === 0) continue
    const key = attr.name.slice(5).replace(/-([a-z])/g, function (_, c) {
      return c.toUpperCase()
    })
    ds[key] = attr.value
  }
  return ds
}

function callHandler(node, kind, detail) {
  const name = node.getAttribute('data-wx-' + kind)
  if (!name) return
  const entry = current()
  if (!entry) return
  const fn = entry.instance[name]
  if (typeof fn !== 'function') {
    console.warn('[h5] 页面 ' + entry.route + ' 没有方法 ' + name)
    return
  }
  const dataset = datasetOf(node)
  fn.call(entry.instance, {
    type: kind,
    currentTarget: { dataset: dataset, id: node.id, offsetLeft: 0, offsetTop: 0 },
    target: { dataset: dataset, id: node.id },
    detail: detail || {},
  })
}

function onBodyClick(e) {
  // picker 优先：它自己是个弹层触发器，不再参与 tap 冒泡
  const pickerEl = e.target.closest && e.target.closest('[data-wx-picker]')
  if (pickerEl && refs.body.contains(pickerEl)) {
    openPicker(pickerEl)
    return
  }

  // 从内到外依次触发 tap（小程序是冒泡的），遇到 catch 就停
  const chain = []
  let node = e.target
  while (node && node !== refs.body) {
    if (node.getAttribute && node.getAttribute('data-wx-tap')) chain.push(node)
    node = node.parentElement
  }
  for (let i = 0; i < chain.length; i++) {
    callHandler(chain[i], 'tap', {})
    if (chain[i].getAttribute('data-wx-catch') === '1') break
  }
}

function onBodyInput(e) {
  const node = e.target.closest && e.target.closest('[data-wx-input]')
  if (node && refs.body.contains(node)) callHandler(node, 'input', { value: e.target.value })
}

function onBodyBlur(e) {
  const node = e.target.closest && e.target.closest('[data-wx-blur]')
  if (node && refs.body.contains(node)) callHandler(node, 'blur', { value: e.target.value })
}

function onBodyChange(e) {
  const node = e.target.closest && e.target.closest('[data-wx-change]')
  if (node && refs.body.contains(node)) callHandler(node, 'change', { value: e.target.value })
}

const KEY_TO_TAP = { Enter: 'confirm' }

function onBodyKeydown(e) {
  const kind = KEY_TO_TAP[e.key]
  if (!kind) return
  const node = e.target.closest && e.target.closest('[data-wx-' + kind + ']')
  if (node && refs.body.contains(node)) callHandler(node, kind, { value: e.target.value })
}

function openPicker(node) {
  const entry = current()
  const id = node.getAttribute('data-wx-picker')
  const def = entry && entry.pickers && entry.pickers[id]
  if (!def || def.disabled) return
  ui.picker({
    mode: def.mode,
    range: def.range,
    rangeKey: def.rangeKey,
    value: def.value,
    start: def.start,
    end: def.end,
    success: function (res) {
      if (def.handler) {
        // picker 的 change 事件里 detail.value 是选中项下标
        const probe = { getAttribute: function () { return def.handler } }
        callHandler(probe, 'change', { value: res.value })
      }
    },
  })
}

function bindEvents() {
  refs.body.addEventListener('click', onBodyClick)
  refs.body.addEventListener('input', onBodyInput)
  refs.body.addEventListener('blur', onBodyBlur, true)
  refs.body.addEventListener('change', onBodyChange)
  refs.body.addEventListener('keydown', onBodyKeydown)

  refs.tabbar.addEventListener('click', function (e) {
    const tab = e.target.closest && e.target.closest('[data-tab]')
    if (tab) switchTab('/' + tab.getAttribute('data-tab'))
  })
}

// ---------------------------------------------------------------------------
// 导航
// ---------------------------------------------------------------------------

function enter(entry, query) {
  const inst = entry.instance
  if (!inst.__loaded) {
    inst.__loaded = true
    if (typeof inst.onLoad === 'function') inst.onLoad(query || {})
  }
  if (typeof inst.onShow === 'function') inst.onShow()
}

function navigateTo(url) {
  const parsed = parseUrl(url)
  if (!bundle.wxml[parsed.route]) {
    ui.toast('页面不存在：' + parsed.route)
    return
  }
  if (isTabRoute(parsed.route)) return switchTab(url)
  const entry = { route: parsed.route, query: parsed.query, instance: getInstance(parsed.route) }
  stack.push(entry)
  enter(entry, parsed.query)
  render()
}

function redirectTo(url) {
  const parsed = parseUrl(url)
  const leaving = stack.pop()
  if (leaving && typeof leaving.instance.onUnload === 'function') leaving.instance.onUnload()
  const entry = { route: parsed.route, query: parsed.query, instance: getInstance(parsed.route) }
  stack.push(entry)
  enter(entry, parsed.query)
  render()
}

function switchTab(url) {
  const parsed = parseUrl(url)
  const leaving = current()
  if (leaving && typeof leaving.instance.onHide === 'function') leaving.instance.onHide()
  stack = []
  const entry = { route: parsed.route, query: parsed.query, instance: getInstance(parsed.route) }
  stack.push(entry)
  enter(entry, parsed.query)
  render()
}

function navigateBack(delta, opts) {
  const steps = delta || 1
  if (stack.length <= 1) {
    if (opts && opts.fail) opts.fail({ errMsg: 'navigateBack:fail 已经是第一个页面' })
    return
  }
  for (let i = 0; i < steps; i++) {
    const leaving = stack.pop()
    if (leaving && typeof leaving.instance.onUnload === 'function') leaving.instance.onUnload()
  }
  const entry = current()
  if (entry) {
    if (typeof entry.instance.onShow === 'function') entry.instance.onShow()
    render()
  }
}

function reLaunch(url) {
  stack.forEach(function (entry) {
    if (typeof entry.instance.onUnload === 'function') entry.instance.onUnload()
  })
  stack = []
  navigateTo(url)
}

function setTitle(title) {
  currentTitle = title
  if (refs.navTitle) refs.navTitle.textContent = title || ''
}

// ---------------------------------------------------------------------------

function start(dom, startUrl) {
  refs.body = dom.body
  refs.navTitle = dom.navTitle
  refs.tabbar = dom.tabbar
  bindEvents()

  const first = startUrl || '/' + appJson.pages[0]
  const parsed = parseUrl(first)
  const entry = { route: parsed.route, query: parsed.query, instance: getInstance(parsed.route) }
  stack = [entry]
  enter(entry, parsed.query)
  render()
}

module.exports = {
  start: start,
  render: render,
  navigateTo: navigateTo,
  redirectTo: redirectTo,
  switchTab: switchTab,
  navigateBack: navigateBack,
  reLaunch: reLaunch,
  setTitle: setTitle,
  parseUrl: parseUrl,
  _stack: function () {
    return stack
  },
}
