/** utils/security.js 的测试：防止"表单显示 A、实际写 B" */

const sec = require('../utils/security')

module.exports = function (t) {
  const cached = { id: 'sec-1', code: '601988', name: '中国银行' }

  // --- normalizeCode ------------------------------------------------------
  t.eq(sec.normalizeCode('601988'), '601988', 'normalize 数字代码')
  t.eq(sec.normalizeCode(' aapl '), 'AAPL', 'normalize 去空格 + 转大写')
  t.eq(sec.normalizeCode(null), '', 'normalize null')
  t.eq(sec.normalizeCode(undefined), '', 'normalize undefined')

  // --- canReuseSecurity ---------------------------------------------------
  t.eq(sec.canReuseSecurity(cached, '601988'), true, '代码一致 -> 可复用')
  t.eq(sec.canReuseSecurity(cached, ' 601988 '), true, '忽略空格')
  t.eq(sec.canReuseSecurity(cached, 'aapl'), false, '代码不同 -> 不能复用')

  // ★ 这一条就是本次修掉的 bug：把代码改掉之后，绝不能继续用旧标的
  t.eq(
    sec.canReuseSecurity(cached, '601857'),
    false,
    '★ 用户改了代码后必须作废旧缓存（否则持仓会记到错误标的上）'
  )

  t.eq(sec.canReuseSecurity(null, '601988'), false, '没有缓存 -> 不能复用')
  t.eq(sec.canReuseSecurity(undefined, '601988'), false, 'undefined 缓存')
  t.eq(sec.canReuseSecurity({}, '601988'), false, '空对象缓存')
  t.eq(sec.canReuseSecurity({ code: '601988' }, '601988'), false, '缺 id 的缓存不可用')
  t.eq(sec.canReuseSecurity({ id: 'x' }, '601988'), false, '缺 code 的缓存不可用')
  t.eq(sec.canReuseSecurity(cached, ''), false, '输入为空 -> 不能复用')
  t.eq(sec.canReuseSecurity(cached, null), false, '输入 null')

  // --- resolveSecurity ----------------------------------------------------
  const reuse = sec.resolveSecurity(cached, '601988')
  t.eq(reuse.security, cached, 'resolve: 复用原对象')
  t.eq(reuse.needsCreate, false, 'resolve: 不需要新建')

  const fresh = sec.resolveSecurity(cached, '601857')
  t.eq(fresh.security, null, 'resolve: 不复用')
  t.eq(fresh.needsCreate, true, 'resolve: 需要新建')

  const empty = sec.resolveSecurity(null, '601857')
  t.eq(empty.security, null, 'resolve: 无缓存')
  t.eq(empty.needsCreate, true, 'resolve: 无缓存时要新建')
}
