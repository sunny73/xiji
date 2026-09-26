/**
 * 预览用的 UI 覆盖层：toast / loading / modal / actionSheet / picker。
 *
 * 这些在小程序里是系统原生组件，浏览器里没有对应物，所以用 DOM 自己搭一套。
 * 行为尽量对齐 wx 的回调约定（success({confirm})、success({tapIndex}) 等），
 * 这样页面代码一行都不用改。
 */

function overlayRoot() {
  let root = document.getElementById('h5-overlay')
  if (!root) {
    root = document.createElement('div')
    root.id = 'h5-overlay'
    document.body.appendChild(root)
  }
  return root
}

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined && text !== null) node.textContent = text
  return node
}

function clearFrom(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node)
}

// --- toast -----------------------------------------------------------------

let toastNode = null
let toastTimer = null

function toast(options) {
  const opts = typeof options === 'string' ? { title: options } : options || {}
  clearFrom(toastNode)
  clearTimeout(toastTimer)

  toastNode = el('div', 'h5-toast')
  if (opts.icon === 'success') {
    const mark = el('div', 'h5-toast-icon', '✓')
    toastNode.appendChild(mark)
  }
  toastNode.appendChild(el('div', 'h5-toast-text', opts.title || ''))
  overlayRoot().appendChild(toastNode)

  toastTimer = setTimeout(function () {
    clearFrom(toastNode)
    toastNode = null
  }, opts.duration || 2000)
}

// --- loading ---------------------------------------------------------------

let loadingNode = null

function showLoading(options) {
  const opts = typeof options === 'string' ? { title: options } : options || {}
  hideLoading()
  loadingNode = el('div', 'h5-loading')
  loadingNode.appendChild(el('div', 'h5-spinner'))
  loadingNode.appendChild(el('div', 'h5-loading-text', opts.title || '加载中'))
  overlayRoot().appendChild(loadingNode)
}

function hideLoading() {
  clearFrom(loadingNode)
  loadingNode = null
}

// --- modal -----------------------------------------------------------------

/**
 * @param {object} opts 兼容 wx.showModal 的参数
 *   { title, content, editable, placeholderText, confirmText, cancelText,
 *     confirmColor, success({confirm, cancel, content}), fail() }
 */
function showModal(opts) {
  const o = opts || {}
  const root = overlayRoot()
  const mask = el('div', 'h5-mask')
  const box = el('div', 'h5-modal')

  if (o.title) box.appendChild(el('div', 'h5-modal-title', o.title))

  let input = null
  if (o.editable) {
    input = document.createElement('input')
    input.className = 'h5-modal-input'
    input.placeholder = o.placeholderText || ''
    box.appendChild(input)
    if (o.content) box.appendChild(el('div', 'h5-modal-content', o.content))
  } else if (o.content) {
    box.appendChild(el('div', 'h5-modal-content', o.content))
  }

  const actions = el('div', 'h5-modal-actions')
  if (o.showCancel !== false) {
    const cancel = el('div', 'h5-modal-btn', o.cancelText || '取消')
    cancel.onclick = function () {
      cleanup()
      if (o.success) o.success({ confirm: false, cancel: true, content: '' })
    }
    actions.appendChild(cancel)
  }
  const confirm = el('div', 'h5-modal-btn h5-modal-btn--primary', o.confirmText || '确定')
  if (o.confirmColor) confirm.style.color = o.confirmColor
  confirm.onclick = function () {
    const value = input ? input.value : ''
    cleanup()
    if (o.success) o.success({ confirm: true, cancel: false, content: value })
  }
  actions.appendChild(confirm)
  box.appendChild(actions)

  function cleanup() {
    clearFrom(mask)
  }

  mask.appendChild(box)
  root.appendChild(mask)
  if (input) setTimeout(function () { input.focus() }, 30)
}

// --- actionSheet -----------------------------------------------------------

function showActionSheet(opts) {
  const o = opts || {}
  const root = overlayRoot()
  const mask = el('div', 'h5-mask h5-mask--bottom')
  const sheet = el('div', 'h5-sheet')

  ;(o.itemList || []).forEach(function (label, index) {
    const item = el('div', 'h5-sheet-item', label)
    if (o.itemColor) item.style.color = o.itemColor
    item.onclick = function () {
      cleanup()
      if (o.success) o.success({ tapIndex: index })
    }
    sheet.appendChild(item)
  })

  const cancel = el('div', 'h5-sheet-item h5-sheet-cancel', '取消')
  cancel.onclick = function () {
    cleanup()
    if (o.fail) o.fail({ errMsg: 'showActionSheet:fail cancel' })
  }
  sheet.appendChild(cancel)

  function cleanup() {
    clearFrom(mask)
  }

  mask.appendChild(sheet)
  mask.onclick = function (e) {
    if (e.target === mask) {
      cleanup()
      if (o.fail) o.fail({ errMsg: 'showActionSheet:fail cancel' })
    }
  }
  root.appendChild(mask)
}

// --- picker ----------------------------------------------------------------

/**
 * 小程序 picker 的浏览器替身。
 * @param {object} opts { mode, range, rangeKey, value, start, end, success({value}) , fail() }
 */
function picker(opts) {
  const o = opts || {}

  // 日期模式直接用原生 date input，体验最好
  if (o.mode === 'date' || o.mode === 'time') {
    const input = document.createElement('input')
    input.type = o.mode === 'date' ? 'date' : 'time'
    if (o.start) input.min = o.start
    if (o.end) input.max = o.end
    input.value = o.value || ''
    input.style.position = 'fixed'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'
    document.body.appendChild(input)
    if (input.showPicker) {
      try {
        input.showPicker()
      } catch (e) {
        input.click()
      }
    } else {
      input.click()
    }
    input.onchange = function () {
      document.body.removeChild(input)
      if (o.success) o.success({ value: input.value })
    }
    input.onblur = function () {
      setTimeout(function () {
        if (input.parentNode) document.body.removeChild(input)
      }, 300)
    }
    return
  }

  const root = overlayRoot()
  const mask = el('div', 'h5-mask h5-mask--bottom')
  const sheet = el('div', 'h5-sheet')

  const range = o.range || []
  const current = Number(o.value) || 0

  range.forEach(function (item, index) {
    const label = o.rangeKey ? item && item[o.rangeKey] : item
    const node = el('div', 'h5-sheet-item' + (index === current ? ' h5-sheet-item--on' : ''), label)
    node.onclick = function () {
      clearFrom(mask)
      if (o.success) o.success({ value: index })
    }
    sheet.appendChild(node)
  })

  const cancel = el('div', 'h5-sheet-item h5-sheet-cancel', '取消')
  cancel.onclick = function () {
    clearFrom(mask)
    if (o.fail) o.fail({ errMsg: 'picker:fail cancel' })
  }
  sheet.appendChild(cancel)

  mask.appendChild(sheet)
  root.appendChild(mask)
}

module.exports = { toast, showLoading, hideLoading, showModal, showActionSheet, picker, el, clearFrom }
