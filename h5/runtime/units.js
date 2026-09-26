/**
 * WXSS 转换：把小程序样式变成浏览器能吃的 CSS。
 *
 * 两件事：
 *   1. rpx → px。rpx 是"屏幕宽 750 份"的相对单位。预览用固定 375px 宽的手机壳，
 *      所以 1rpx = 375/750 = 0.5px，换算后和真机等比。
 *   2. `page { ... }` 选择器 → `.wx-page { ... }`。
 *      小程序里 page 是根节点；预览里对应的就是我们那个 375px 的容器。
 *      注意不能误伤 `.page { ... }` 这类类选择器。
 */

/** rpx → px（按 375px 设计宽度） */
const RPX_PER_PX = 2 // 1px = 2rpx

function rpxToPx(css) {
  return css.replace(/(-?\d*\.?\d+)rpx\b/g, function (_, num) {
    const px = parseFloat(num) / RPX_PER_PX
    // 去掉浮点尾巴：14.0 -> 14，12.5 -> 12.5
    return String(Math.round(px * 1000) / 1000) + 'px'
  })
}

/**
 * `page` 选择器重写。
 *
 * 只在"选择器的起始位置"替换，所以 .page / #page / wx-page 都不会被误伤：
 *   - 行首（允许缩进）——注意 app.wxss 里 `page {` 前面是个注释块，不是 `}`
 *   - 或者紧跟在 `}` `,` `;` 之后
 * 后面必须紧跟 `,` 或 `{`，否则 `page` 只是别的选择器的一部分。
 */
function rewritePageSelector(css) {
  return css.replace(/(^|[}{,;])([ \t]*)page([ \t]*)([,{])/gm, function (_, lead, sp1, sp2, tail) {
    return lead + sp1 + '.wx-page' + sp2 + tail
  })
}

/** 完整转换 */
function transformWxss(css) {
  return rewritePageSelector(rpxToPx(css))
}

module.exports = { RPX_PER_PX, rpxToPx, rewritePageSelector, transformWxss }
