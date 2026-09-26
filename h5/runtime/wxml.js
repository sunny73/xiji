/**
 * WXML 编译器 + 渲染器。
 *
 * 设计要点：**渲染成 HTML 字符串，而不是直接操作 DOM**。
 *   - 纯函数 → 可以在 Node 里跑测试（浏览器 DOM 测不了）
 *   - 浏览器侧只要 container.innerHTML = html 就行
 *   - 事件用委托（data-wx-* 属性）而不是逐个 addEventListener
 *
 * 覆盖的语法就是本仓库实际用到的子集：
 *   标签：view / text / block / input / picker / scroll-view
 *   指令：wx:if / wx:elif / wx:else / wx:for / wx:for-item / wx:for-index / wx:key
 *   事件：bindtap / catchtap / bindinput / bindchange / bindblur
 *
 * tests/structure.test.js 里有一条检查会确保小程序没有用超出这个子集的语法。
 */

const { evaluate, evaluateText, extendScope } = require('./expr')

/** 这些标签在 HTML 里没有闭合标签，渲染时要自闭合 */
const VOID_TAGS = new Set(['input', 'image', 'img', 'br'])

/** WXML 标签 → HTML 标签 */
const TAG_MAP = {
  view: 'div',
  text: 'span',
  'scroll-view': 'div',
  image: 'img',
  input: 'input',
  picker: 'div',
  button: 'button',
  navigator: 'a',
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (c) {
    return HTML_ESCAPES[c]
  })
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

const NAME_CHAR = /[a-zA-Z0-9:_-]/
const ATTR_STOP = /[\s=>/]/

/**
 * 把 WXML 文本解析成 AST。
 * 手写而不是用 DOMParser：Node 里没有 DOM，而且 WXML 的属性里可能有 `>`（如 {{a > b}}）。
 */
function parse(src) {
  const root = { type: 'root', tag: '#root', attrs: [], children: [] }
  const stack = [root]
  let i = 0

  function pushText(text) {
    if (!text) return
    stack[stack.length - 1].children.push({ type: 'text', value: text })
  }

  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      pushText(src.slice(i))
      break
    }
    if (lt > i) pushText(src.slice(i, lt))

    // 注释
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt)
      i = end < 0 ? src.length : end + 3
      continue
    }

    // 闭合标签
    if (src.charAt(lt + 1) === '/') {
      const gt = src.indexOf('>', lt)
      if (stack.length > 1) stack.pop()
      i = gt < 0 ? src.length : gt + 1
      continue
    }

    // 开始标签
    let j = lt + 1
    let name = ''
    while (j < src.length && NAME_CHAR.test(src.charAt(j))) {
      name += src.charAt(j)
      j++
    }

    const attrs = []
    let selfClose = false
    while (j < src.length) {
      while (j < src.length && /\s/.test(src.charAt(j))) j++
      if (src.charAt(j) === '>') {
        j++
        break
      }
      if (src.charAt(j) === '/' && src.charAt(j + 1) === '>') {
        selfClose = true
        j += 2
        break
      }
      // 属性名
      let an = ''
      while (j < src.length && !ATTR_STOP.test(src.charAt(j))) {
        an += src.charAt(j)
        j++
      }
      while (j < src.length && /\s/.test(src.charAt(j))) j++

      let av = null
      if (src.charAt(j) === '=') {
        j++
        while (j < src.length && /\s/.test(src.charAt(j))) j++
        const quote = src.charAt(j)
        if (quote === '"' || quote === "'") {
          const end = src.indexOf(quote, j + 1)
          av = src.slice(j + 1, end < 0 ? src.length : end)
          j = end < 0 ? src.length : end + 1
        } else {
          let v = ''
          while (j < src.length && !/[\s>]/.test(src.charAt(j))) {
            v += src.charAt(j)
            j++
          }
          av = v
        }
      }
      if (an) attrs.push({ name: an, value: av === null ? '' : av, bare: av === null })
    }

    const node = { type: 'element', tag: name, attrs: attrs, children: [] }
    stack[stack.length - 1].children.push(node)
    if (!selfClose && !VOID_TAGS.has(name)) stack.push(node)
    i = j
  }

  return root
}

// ---------------------------------------------------------------------------
// 属性工具
// ---------------------------------------------------------------------------

function getAttr(node, name) {
  for (let i = 0; i < node.attrs.length; i++) {
    if (node.attrs[i].name === name) return node.attrs[i].value
  }
  return null
}

function hasAttr(node, name) {
  return getAttr(node, name) !== null
}

/** 把 "前缀{{expr}}后缀" 里的插值全部替换掉 */
function interpolate(template, vars) {
  if (template.indexOf('{{') < 0) return template
  return template.replace(/\{\{([\s\S]*?)\}\}/g, function (_, expr) {
    return evaluateText(expr, vars)
  })
}

/** 属性的值可能是 {{ }} 表达式；纯表达式时保留原始类型（数字/布尔） */
function evaluateAttrValue(raw, vars) {
  const trimmed = raw.trim()
  const only = /^\{\{([\s\S]*)\}\}$/.exec(trimmed)
  if (only) return evaluate(only[1], vars)
  return interpolate(raw, vars)
}

/**
 * 求值一个**指令**的值（wx:if / wx:elif / wx:for）。
 *
 * 必须先把 `{{ }}` 剥掉：`evaluate('{{list}}')` 是语法错误，
 * 会静默返回 undefined —— 表现就是"条件永远为假、列表永远是空"。
 * 这类 bug 不会报错，只会让页面莫名其妙地空着。
 */
function evalDirective(raw, vars) {
  if (raw === null || raw === undefined) return undefined
  const trimmed = String(raw).trim()
  const only = /^\{\{([\s\S]*)\}\}$/.exec(trimmed)
  return evaluate(only ? only[1] : trimmed, vars)
}

function isWhitespaceText(node) {
  return node.type === 'text' && node.value.trim() === ''
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

/**
 * 布尔属性求值。
 *
 * 不能只看"属性存不存在"：模板里普遍写的是 `disabled="{{!accountNames.length}}"`，
 * 属性一直都在，值为 false 时才表示可用。只看存在性会把所有 picker 都锁死，
 * 表现是"点了完全没反应"——很难往属性求值上想。
 * 裸属性（`<input disabled>`，解析出来的值是 ''）按 true 处理。
 */
function boolAttr(node, name, vars) {
  const raw = getAttr(node, name)
  if (raw === null) return false
  if (raw === '') return true
  return truthy(evaluateAttrValue(raw, vars))
}

function renderElement(node, vars, ctx) {
  // block 只是个分组容器，不产生真实标签
  if (node.tag === 'block') return renderChildren(node.children, vars, ctx)

  // wx:for 优先于普通渲染
  if (hasAttr(node, 'wx:for')) return renderFor(node, vars, ctx)

  if (node.tag === 'picker') return renderPicker(node, vars, ctx)

  const htmlTag = TAG_MAP[node.tag] || 'div'
  const parts = []

  // class（scroll-view 需要额外挂一个类名让 CSS 能横向滚动）
  let cls = getAttr(node, 'class')
  cls = cls === null ? '' : interpolate(cls, vars)
  if (node.tag === 'scroll-view' && hasAttr(node, 'scroll-x')) {
    cls = (cls + ' wx-scroll-x').trim()
  }
  if (cls) parts.push('class="' + escapeHtml(cls) + '"')

  const style = getAttr(node, 'style')
  if (style !== null) parts.push('style="' + escapeHtml(interpolate(style, vars)) + '"')

  // 事件 → data-wx-* 交给容器做事件委托
  parts.push.apply(parts, eventAttrs(node))

  // 透传 data-*
  node.attrs.forEach(function (a) {
    if (a.name.indexOf('data-') === 0) {
      parts.push(a.name + '="' + escapeHtml(interpolate(a.value, vars)) + '"')
    }
  })

  if (node.tag === 'input') {
    const type = getAttr(node, 'type')
    // 小程序的 digit 在浏览器里对应的键盘提示是 inputmode=decimal
    if (type === 'digit' || type === 'number') {
      parts.push('type="text" inputmode="decimal"')
    } else {
      parts.push('type="text"')
    }
    const value = getAttr(node, 'value')
    if (value !== null) {
      const v = interpolate(value, vars)
      if (v !== '') parts.push('value="' + escapeHtml(v) + '"')
    }
    const ph = getAttr(node, 'placeholder')
    if (ph !== null) parts.push('placeholder="' + escapeHtml(ph) + '"')
    if (boolAttr(node, 'disabled', vars)) parts.push('disabled')
    parts.push('autocomplete="off"')
  }

  const attrStr = parts.length ? ' ' + parts.join(' ') : ''
  const inner = renderChildren(node.children, vars, ctx)

  if (VOID_TAGS.has(node.tag)) return '<' + htmlTag + attrStr + '>'
  return '<' + htmlTag + attrStr + '>' + inner + '</' + htmlTag + '>'
}

/**
 * picker 在预览里没法用系统原生弹层，改成：渲染成一个 div，
 * 点击时由运行时弹出底部选择器。选项数据通过 ctx.pickers 带出去。
 */
function renderPicker(node, vars, ctx) {
  const id = 'p' + ++ctx.seq
  const rangeRaw = getAttr(node, 'range')
  const range = rangeRaw === null ? [] : evaluateAttrValue(rangeRaw, vars) || []
  const rangeKey = getAttr(node, 'range-key')
  const value = getAttr(node, 'value') === null ? 0 : evaluateAttrValue(getAttr(node, 'value'), vars)
  const changeHandler = getAttr(node, 'bindchange') || getAttr(node, 'bind:tap') || null
  const disabled = boolAttr(node, 'disabled', vars)
  const mode = getAttr(node, 'mode') || 'selector'

  ctx.pickers[id] = {
    id: id,
    mode: mode,
    range: range,
    rangeKey: rangeKey,
    value: typeof value === 'number' ? value : parseInt(value, 10) || 0,
    handler: changeHandler,
    disabled: disabled,
    // date 模式会用到的范围
    start: getAttr(node, 'start'),
    end: getAttr(node, 'end'),
  }

  const attrs = []
  const cls = getAttr(node, 'class')
  if (cls) attrs.push('class="' + escapeHtml(interpolate(cls, vars)) + '"')
  const style = getAttr(node, 'style')
  if (style !== null) attrs.push('style="' + escapeHtml(interpolate(style, vars)) + '"')
  attrs.push('data-wx-picker="' + id + '"')
  node.attrs.forEach(function (a) {
    if (a.name.indexOf('data-') === 0) {
      attrs.push(a.name + '="' + escapeHtml(interpolate(a.value, vars)) + '"')
    }
  })

  const inner = renderChildren(node.children, vars, ctx)
  return '<div ' + attrs.join(' ') + '>' + inner + '</div>'
}

/** 事件属性 → data-wx-* */
function eventAttrs(node) {
  const out = []
  node.attrs.forEach(function (a) {
    const m = /^(bind|catch):?([a-zA-Z]+)$/.exec(a.name)
    if (!m) return
    const kind = m[2].toLowerCase()
    if (['tap', 'input', 'change', 'blur', 'confirm', 'focus'].indexOf(kind) < 0) return
    out.push('data-wx-' + kind + '="' + escapeHtml(a.value) + '"')
    if (m[1] === 'catch') out.push('data-wx-catch="1"')
  })
  return out
}

/** 渲染 wx:for */
function renderFor(node, vars, ctx) {
  const list = evalDirective(getAttr(node, 'wx:for'), vars)
  const itemName = getAttr(node, 'wx:for-item') || 'item'
  const indexName = getAttr(node, 'wx:for-index') || 'index'
  const items = Array.isArray(list) ? list : list && typeof list.length === 'number' ? list : []

  // 复制一份但去掉 wx:for / wx:key，避免递归
  const clone = {
    type: 'element',
    tag: node.tag,
    attrs: node.attrs.filter(function (a) {
      return a.name.indexOf('wx:for') !== 0 && a.name !== 'wx:key'
    }),
    children: node.children,
  }

  let out = ''
  for (let i = 0; i < items.length; i++) {
    const extra = {}
    extra[itemName] = items[i]
    extra[indexName] = i
    out += renderElement(clone, extendScope(vars, extra), ctx)
  }
  return out
}

/** 渲染兄弟节点，处理 wx:if / wx:elif / wx:else 链 */
function renderChildren(children, vars, ctx) {
  let out = ''
  let i = 0

  while (i < children.length) {
    const node = children[i]

    if (node.type === 'text') {
      out += escapeHtml(interpolate(node.value, vars))
      i++
      continue
    }

    if (hasAttr(node, 'wx:if')) {
      let taken = truthy(evalDirective(getAttr(node, 'wx:if'), vars))
      if (taken) out += renderElement(node, vars, ctx)
      i++

      // 往后吃掉紧跟的 wx:elif / wx:else（中间可能隔着换行缩进的空白文本节点）
      while (i < children.length) {
        const sib = children[i]
        if (sib.type === 'text') {
          if (isWhitespaceText(sib)) {
            out += escapeHtml(interpolate(sib.value, vars))
            i++
            continue
          }
          break
        }
        if (hasAttr(sib, 'wx:elif')) {
          if (!taken && truthy(evalDirective(getAttr(sib, 'wx:elif'), vars))) {
            taken = true
            out += renderElement(sib, vars, ctx)
          }
          i++
          continue
        }
        if (hasAttr(sib, 'wx:else')) {
          if (!taken) {
            taken = true
            out += renderElement(sib, vars, ctx)
          }
          i++
          continue
        }
        break
      }
      continue
    }

    out += renderElement(node, vars, ctx)
    i++
  }

  return out
}

function truthy(v) {
  return !!(v && v !== 'false' && v !== '0')
}

/**
 * 渲染入口。
 * @returns {{html: string, pickers: object}}
 */
function render(ast, vars) {
  const ctx = { pickers: {}, seq: 0 }
  const html = renderChildren(ast.children, vars, ctx)
  return { html: html, pickers: ctx.pickers }
}

/** 解析 + 缓存的便捷封装 */
const astCache = new Map()
function compile(source, cacheKey) {
  if (cacheKey && astCache.has(cacheKey)) return astCache.get(cacheKey)
  const ast = parse(source)
  if (cacheKey) astCache.set(cacheKey, ast)
  return ast
}

module.exports = {
  VOID_TAGS,
  TAG_MAP,
  escapeHtml,
  parse,
  compile,
  render,
  interpolate,
  evalDirective,
  boolAttr,
  getAttr,
  hasAttr,
}
