/** h5/runtime/units.js 的测试：WXSS → CSS */

const units = require('../runtime/units')

module.exports = function (t) {
  // --- rpx → px -----------------------------------------------------------
  t.eq(units.rpxToPx('font-size: 28rpx;'), 'font-size: 14px;', '28rpx -> 14px')
  t.eq(units.rpxToPx('padding: 0 32rpx;'), 'padding: 0 16px;', '多个值')
  t.eq(units.rpxToPx('width: 750rpx;'), 'width: 375px;', '750rpx 正好是整屏宽')
  t.eq(units.rpxToPx('border-radius: 999rpx;'), 'border-radius: 499.5px;', '小数保留')
  t.eq(units.rpxToPx('margin: -8rpx;'), 'margin: -4px;', '负值')
  t.eq(units.rpxToPx('height: 0.5rpx;'), 'height: 0.25px;', '小于 1rpx')
  t.eq(units.rpxToPx('width: 100px;'), 'width: 100px;', 'px 原样保留')
  t.eq(units.rpxToPx('width: 2em;'), 'width: 2em;', 'em 不受影响')

  // 不能把属性名/类名里的 rpx 字样误伤（用 \b 边界）
  t.eq(units.rpxToPx('.rpx-box { width: 10rpx; }'), '.rpx-box { width: 5px; }', '类名里的 rpx 不动')

  // --- page 选择器重写 ----------------------------------------------------
  t.eq(units.rewritePageSelector('page { color: red; }'), '.wx-page { color: red; }', '起始位置的 page')
  t.eq(
    units.rewritePageSelector('.a { x: 1 }\npage { color: red; }'),
    '.a { x: 1 }\n.wx-page { color: red; }',
    '} 之后的 page'
  )
  t.eq(
    units.rewritePageSelector('.page { padding: 24rpx; }'),
    '.page { padding: 24rpx; }',
    '★ .page 类选择器不能被误改成 .wx-page'
  )
  t.eq(units.rewritePageSelector('#page { x: 1 }'), '#page { x: 1 }', '#page 不动')
  t.eq(units.rewritePageSelector('.my-page { x: 1 }'), '.my-page { x: 1 }', '.my-page 不动')
  t.eq(
    units.rewritePageSelector('page, .other { x: 1 }'),
    '.wx-page, .other { x: 1 }',
    'page 在选择器列表里'
  )
  // ★ 真实 app.wxss 里 `page {` 前面是一个注释块，不是 `}` —— 曾经漏掉过这种情况
  t.eq(
    units.rewritePageSelector('/**\n * 设计变量\n */\n\npage {\n  color: red;\n}'),
    '/**\n * 设计变量\n */\n\n.wx-page {\n  color: red;\n}',
    '★ 注释块之后的行首 page'
  )
  t.eq(
    units.rewritePageSelector('  page { x: 1 }'),
    '  .wx-page { x: 1 }',
    '缩进的 page'
  )
  t.eq(
    units.rewritePageSelector('.a { x: 1 }\n.b { y: 2 }\npage { z: 3 }'),
    '.a { x: 1 }\n.b { y: 2 }\n.wx-page { z: 3 }',
    '多行之后的行首 page'
  )
  t.eq(units.rewritePageSelector('.wx-page { x: 1 }'), '.wx-page { x: 1 }', '已转换的不再重复处理')

  // --- 组合 ---------------------------------------------------------------
  const out = units.transformWxss('page {\n  font-size: 28rpx;\n}\n.page { padding: 24rpx; }')
  t.eq(
    out,
    '.wx-page {\n  font-size: 14px;\n}\n.page { padding: 12px; }',
    '整体转换'
  )

  // 幂等性：同一段 CSS 转两次不应继续变化
  t.eq(units.transformWxss(out), out, '转换是幂等的（px 不会再被转）')
}
