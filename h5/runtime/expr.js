/**
 * WXML 表达式求值。
 *
 * 思路：编译成 JS 函数后用 `with(scope)` 执行。难点是 WXML 里引用不存在的字段
 * 会渲染成空，而 JS 会抛 ReferenceError —— 所以 scope 用一个"什么都认"的 Proxy
 * 包起来：has() 永远返回 true，get() 对不存在的键返回 undefined。
 *
 * 安全性说明：这些表达式**全部来自仓库里的 WXML 文件**，不是用户输入，
 * 所以用 new Function 是可以接受的（预览工具跑在本地）。
 */

/** 编译缓存：同一个表达式只编译一次 */
const fnCache = new Map()

function compile(expr) {
  if (fnCache.has(expr)) return fnCache.get(expr)
  let fn
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function('$scope', 'with ($scope) { return (' + expr + ') }')
  } catch (e) {
    fn = null
  }
  fnCache.set(expr, fn)
  return fn
}

/**
 * 把普通对象包装成 WXML 作用域。
 * has() 恒为 true 是关键：否则 with 会在找不到变量时向外层（全局）查找，
 * 找不到就抛 ReferenceError。
 */
function makeScope(vars) {
  return new Proxy(vars || {}, {
    has() {
      return true
    },
    get(target, key) {
      if (key === Symbol.unscopables) return undefined
      return target[key]
    },
  })
}

/** 基于父作用域派生一个子作用域（给 wx:for 的 item/index 用），走原型链继承 */
function extendScope(parentVars, extra) {
  const child = Object.create(parentVars || null)
  Object.keys(extra || {}).forEach(function (k) {
    child[k] = extra[k]
  })
  return child
}

/**
 * 求值。返回原始值（可能是 number / boolean / object）。
 * 求值失败返回 undefined，让调用方决定怎么兜底。
 */
function evaluate(expr, vars) {
  const fn = compile(expr)
  if (!fn) return undefined
  try {
    return fn(makeScope(vars))
  } catch (e) {
    return undefined
  }
}

/** 求值并转成字符串，用于文本插值和属性。undefined/null/false 渲染成空串 */
function evaluateText(expr, vars) {
  const value = evaluate(expr, vars)
  if (value === undefined || value === null || value === false) return ''
  return String(value)
}

module.exports = { compile, makeScope, extendScope, evaluate, evaluateText }
