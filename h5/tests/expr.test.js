/** h5/runtime/expr.js 的测试 */

const expr = require('../runtime/expr')

module.exports = function (t) {
  const vars = {
    name: '中国银行',
    amount: 1900,
    zero: 0,
    empty: '',
    flag: false,
    yes: true,
    nested: { a: { b: '深' } },
    list: [10, 20, 30],
    items: [{ id: 1, n: 'a' }, { id: 2, n: 'b' }],
  }

  // --- 基本求值 -----------------------------------------------------------
  t.eq(expr.evaluate('amount', vars), 1900, '读数字')
  t.eq(expr.evaluate('nested.a.b', vars), '深', '深层路径')
  t.eq(expr.evaluate('list[1]', vars), 20, '下标')
  t.eq(expr.evaluate('items[0].n', vars), 'a', '下标 + 属性')
  t.eq(expr.evaluate('amount + 100', vars), 2000, '算术')
  t.eq(expr.evaluate("'¥' + amount", vars), '¥1900', '字符串拼接')
  t.eq(expr.evaluate('amount === 1900', vars), true, '严格相等')

  // --- 缺失字段不抛异常（WXML 渲染成空，JS 会抛 ReferenceError）-----------
  t.eq(expr.evaluate('notExist', vars), undefined, '缺失的顶层字段返回 undefined')
  t.eq(expr.evaluate('notExist.deep.deeper', vars), undefined, '缺失路径不抛异常')
  t.eq(expr.evaluate('nested.missing.x', vars), undefined, '中途缺失也不抛')
  t.eq(expr.evaluateText('notExist', vars), '', '缺失字段渲染成空串')

  // --- undefined / null / false 都渲染成空 ---------------------------------
  t.eq(expr.evaluateText('missing', vars), '', 'undefined -> 空串')
  t.eq(expr.evaluateText('flag', vars), '', 'false -> 空串（和 WXML 一致）')
  t.eq(expr.evaluateText('yes', vars), 'true', 'true -> "true"')
  t.eq(expr.evaluateText('zero', vars), '0', '数字 0 渲染成 "0" 而不是空')
  t.eq(expr.evaluateText('empty', vars), '', '空字符串 -> 空串')

  // --- 语法错误的表达式不能把整个页面炸掉 ----------------------------------
  t.eq(expr.evaluate('(((', vars), undefined, '语法错误返回 undefined')
  t.eq(expr.evaluate('undefinedField.foo()', vars), undefined, '对 undefined 调方法不抛')

  // --- 三元 / 逻辑（实际模板里用得最多的形式）------------------------------
  t.eq(expr.evaluate("items.length > 1 ? 'many' : 'one'", vars), 'many', '三元')
  t.eq(expr.evaluate("!items.length", vars), false, '取反')
  t.eq(expr.evaluate("'a' || 'b'", vars), 'a', '或')

  // --- 作用域 -------------------------------------------------------------
  t.test('extendScope 通过原型链继承父作用域', function () {
    const child = expr.extendScope(vars, { item: { id: 9 }, index: 0 })
    t.eq(expr.evaluate('item.id', child), 9, '子作用域能读到自己的 item')
    t.eq(expr.evaluate('amount', child), 1900, '子作用域也能读到父级的 amount')
    t.eq(expr.evaluate('index', child), 0, 'index 为 0 时不应被当成缺失')
  })

  t.test('makeScope 对 Symbol.unscopables 返回 undefined', function () {
    const scope = expr.makeScope({ a: 1 })
    // with 语句会读这个 symbol，返回非 undefined 会干扰作用域查找
    t.eq(scope[Symbol.unscopables], undefined, 'unscopables 必须返回 undefined')
    t.eq(scope.a, 1, '正常读取')
    t.eq(scope.zzz, undefined, '未知键返回 undefined')
  })

  t.test('编译结果被缓存（同一个表达式只编译一次）', function () {
    const a = expr.compile('1 + 1')
    const b = expr.compile('1 + 1')
    t.eq(a === b, true, '同表达式复用同一个函数')
  })

  t.test('不会污染全局作用域', function () {
    // with(proxy) 把所有标识符都拦截了，所以模板里读不到 Math
    t.eq(expr.evaluate('Math.max(1,2)', vars), undefined, 'Math 被作用域遮蔽（符合预期）')
  })
}
