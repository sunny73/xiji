/** h5/runtime/wxml.js 的测试：解析 + 渲染成 HTML 字符串 */

const wxml = require('../runtime/wxml')
const { assert } = require('../../miniprogram/tests/harness')

function render(src, vars) {
  return wxml.render(wxml.parse(src), vars || {})
}

function html(src, vars) {
  return render(src, vars).html
}

module.exports = function (t) {
  // ======================================================================
  // 解析
  // ======================================================================
  t.test('解析：基本结构', function () {
    const ast = wxml.parse('<view class="a"><text>hi</text></view>')
    assert.strictEqual(ast.children.length, 1)
    const view = ast.children[0]
    assert.strictEqual(view.tag, 'view')
    assert.strictEqual(wxml.getAttr(view, 'class'), 'a')
    assert.strictEqual(view.children[0].tag, 'text')
    assert.strictEqual(view.children[0].children[0].value, 'hi')
  })

  t.test('解析：自闭合标签不进栈', function () {
    const ast = wxml.parse('<view><input value="1" /><text>x</text></view>')
    const view = ast.children[0]
    assert.strictEqual(view.children.length, 2)
    assert.strictEqual(view.children[0].tag, 'input')
    assert.strictEqual(view.children[1].tag, 'text')
  })

  t.test('解析：注释被忽略', function () {
    const ast = wxml.parse('<view><!-- <text>不该出现</text> --><text>ok</text></view>')
    const view = ast.children[0]
    assert.strictEqual(view.children.length, 1)
    assert.strictEqual(view.children[0].tag, 'text')
  })

  t.test('★ 解析：属性值里的 > 不会提前结束标签', function () {
    // 我们的模板里确实有 wx:if="{{yearly.length > 1}}"
    const ast = wxml.parse('<view wx:if="{{yearly.length > 1}}" class="a">x</view>')
    const view = ast.children[0]
    assert.strictEqual(wxml.getAttr(view, 'wx:if'), '{{yearly.length > 1}}')
    assert.strictEqual(wxml.getAttr(view, 'class'), 'a')
  })

  t.test('解析：单引号包裹的属性值', function () {
    const ast = wxml.parse("<view class='a b'>x</view>")
    assert.strictEqual(wxml.getAttr(ast.children[0], 'class'), 'a b')
  })

  t.test('解析：无值属性', function () {
    const ast = wxml.parse('<view><input disabled /></view>')
    const input = ast.children[0].children[0]
    assert.strictEqual(wxml.getAttr(input, 'disabled'), '')
    assert.strictEqual(wxml.hasAttr(input, 'disabled'), true)
  })

  t.test('解析：多行属性（我们的模板大量这么写）', function () {
    const ast = wxml.parse('<view\n  wx:for="{{list}}"\n  wx:key="id"\n  class="x"\n>y</view>')
    const node = ast.children[0]
    assert.strictEqual(wxml.getAttr(node, 'wx:for'), '{{list}}')
    assert.strictEqual(wxml.getAttr(node, 'wx:key'), 'id')
    assert.strictEqual(wxml.getAttr(node, 'class'), 'x')
  })

  // ======================================================================
  // 渲染：标签与属性
  // ======================================================================
  t.eq(html('<view class="a">x</view>'), '<div class="a">x</div>', 'view -> div')
  t.eq(html('<text>hi</text>'), '<span>hi</span>', 'text -> span')
  t.eq(html('<block><text>a</text><text>b</text></block>'), '<span>a</span><span>b</span>', 'block 不产生标签')
  t.eq(html('<scroll-view scroll-x class="c">x</scroll-view>'),
    '<div class="c wx-scroll-x">x</div>', 'scroll-view 加横向滚动类')
  t.eq(html('<view class="a {{on ? \'b\' : \'\'}}">x</view>', { on: true }), '<div class="a b">x</div>', 'class 里插值')
  t.eq(html('<view data-id="x" data-index="2">y</view>'), '<div data-id="x" data-index="2">y</div>', 'data-* 透传')

  // ======================================================================
  // 渲染：文本插值
  // ======================================================================
  t.eq(html('<text>{{name}}</text>', { name: '中国银行' }), '<span>中国银行</span>', '基本插值')
  t.eq(html('<text>{{a}} 股 × {{b}}</text>', { a: 100, b: 0.19 }), '<span>100 股 × 0.19</span>', '多个插值')
  t.eq(html('<text>{{missing}}</text>', {}), '<span></span>', '缺失字段渲染成空')
  t.eq(html('<text>¥{{amount}}</text>', { amount: 1900 }), '<span>¥1900</span>', '前后缀文本')

  // ======================================================================
  // 渲染：转义（防注入 / 防破版）
  // ======================================================================
  t.eq(html('<text>{{v}}</text>', { v: '<script>x</script>' }),
    '<span>&lt;script&gt;x&lt;/script&gt;</span>', '文本被转义')
  t.eq(html('<view class="{{v}}">x</view>', { v: '" onmouseover="x' }),
    '<div class="&quot; onmouseover=&quot;x">x</div>', '★ 属性值被转义，不会逃逸出属性')

  // ======================================================================
  // 渲染：wx:if / wx:elif / wx:else
  // ======================================================================
  const IFSRC = [
    '<view wx:if="{{s === 1}}">one</view>',
    '<view wx:elif="{{s === 2}}">two</view>',
    '<view wx:else>other</view>',
  ].join('\n')

  // 兄弟节点之间的换行会作为文本保留在输出里，所以这里 trim 后再比
  t.eq(html(IFSRC, { s: 1 }).trim(), '<div>one</div>', 'wx:if 命中（else 分支被吃掉）')
  t.eq(html(IFSRC, { s: 2 }).trim(), '<div>two</div>', 'wx:elif 命中')
  t.eq(html(IFSRC, { s: 9 }).trim(), '<div>other</div>', '走到 wx:else')
  t.eq(html('<view wx:if="{{no}}">x</view>', {}), '', '条件为假时整块消失')

  t.test('只有 wx:if 命中时才渲染，其余分支一个都不输出', function () {
    const out = html(IFSRC, { s: 1 })
    assert.strictEqual(out.indexOf('two'), -1, 'elif 分支不应出现')
    assert.strictEqual(out.indexOf('other'), -1, 'else 分支不应出现')
  })

  t.test('★ wx:elif/else 中间隔着换行缩进也能正确串联', function () {
    // 真实模板就是多行缩进写的；如果串联失败，会同时渲染多个分支
    const src = '<view wx:if="{{a}}">A</view>\n      <view wx:else>B</view>'
    assert.strictEqual(html(src, { a: true }).indexOf('B'), -1, 'a 为真时不该出现 B')
    assert.strictEqual(html(src, { a: false }).indexOf('A'), -1, 'a 为假时不该出现 A')
  })

  // ======================================================================
  // 渲染：wx:for
  // ======================================================================
  t.eq(
    html('<view wx:for="{{list}}" wx:key="*this">{{item}}</view>', { list: [1, 2] }),
    '<div>1</div><div>2</div>',
    'wx:for 基本展开'
  )
  t.eq(
    html('<view wx:for="{{list}}" wx:key="i">{{index}}:{{item}}</view>', { list: ['a', 'b'] }),
    '<div>0:a</div><div>1:b</div>',
    'index 从 0 开始'
  )
  t.eq(
    html('<view wx:for="{{items}}" wx:for-item="row" wx:key="id">{{row.n}}</view>', { items: [{ id: 1, n: 'x' }] }),
    '<div>x</div>',
    'wx:for-item 改名'
  )
  t.eq(html('<view wx:for="{{empty}}" wx:key="id">x</view>', { empty: [] }), '', '空数组不渲染')
  t.eq(html('<view wx:for="{{missing}}" wx:key="id">x</view>', {}), '', '列表缺失不报错')

  t.test('嵌套 wx:for 时内层能读到外层的变量', function () {
    const src =
      '<view wx:for="{{outer}}" wx:for-item="o" wx:key="id">' +
      '<text wx:for="{{o.c}}" wx:for-item="c" wx:key="*this">{{o.n}}-{{c}}</text>' +
      '</view>'
    const vars = { outer: [{ id: 1, n: 'A', c: [1, 2] }, { id: 2, n: 'B', c: [3] }] }
    assert.strictEqual(html(src, vars), '<div><span>A-1</span><span>A-2</span></div><div><span>B-3</span></div>')
  })

  t.test('★ wx:for 的元素上不能再带 wx:for（避免无限递归）', function () {
    const out = html('<view wx:for="{{list}}" wx:key="id" data-i="{{index}}">x</view>', { list: [1, 2, 3] })
    assert.strictEqual((out.match(/<div/g) || []).length, 3, '正好渲染 3 个，没有递归')
  })

  // ======================================================================
  // 渲染：事件 → data-wx-*
  // ======================================================================
  t.eq(html('<view bindtap="go">x</view>'), '<div data-wx-tap="go">x</div>', 'bindtap')
  t.eq(html('<view catchtap="go">x</view>'),
    '<div data-wx-tap="go" data-wx-catch="1">x</div>', 'catchtap 标记 catch')
  t.eq(html('<input bindinput="onIn" />'),
    '<input data-wx-input="onIn" type="text" autocomplete="off">', 'bindinput')
  t.eq(html('<view bind:tap="go">x</view>'), '<div data-wx-tap="go">x</div>', 'bind:tap 带冒号也认')
  t.test('未知事件名被忽略，不会产生非法属性', function () {
    const out = html('<view bindanimationfinish="x">y</view>')
    assert.strictEqual(out.indexOf('bind'), -1, out)
  })

  // ======================================================================
  // 渲染：input
  // ======================================================================
  t.test('input value', function () {
    const out = html('<input value="{{v}}" />', { v: '100' })
    assert.ok(out.indexOf('value="100"') >= 0, out)
    assert.ok(out.indexOf('type="text"') >= 0, out)
  })

  t.test('input type=digit -> inputmode=decimal（唤起数字键盘）', function () {
    const out = html('<input type="digit" value="{{v}}" />', { v: '1' })
    assert.ok(out.indexOf('inputmode="decimal"') >= 0, out)
    assert.ok(out.indexOf('value="1"') >= 0, out)
  })

  t.test('input placeholder', function () {
    assert.ok(html('<input placeholder="如 601988" />').indexOf('placeholder="如 601988"') >= 0)
  })

  t.test('input disabled', function () {
    const out = html('<input disabled />')
    assert.ok(/\sdisabled(\s|>)/.test(out), out)
  })

  t.test('input type=nickname 也降级成 text', function () {
    assert.ok(html('<input type="nickname" />').indexOf('type="text"') >= 0)
  })
  t.test('value 为空时不输出 value 属性（否则浏览器会显示上一次的值）', function () {
    assert.strictEqual(html('<input value="{{v}}" />', { v: '' }),
      '<input type="text" autocomplete="off">')
  })

  // ======================================================================
  // 渲染：picker（收集到 ctx.pickers，由运行时弹选择器）
  // ======================================================================
  t.test('picker 被收集到 pickers 表里，并渲染成可点击的 div', function () {
    const result = render(
      '<picker range="{{opts}}" range-key="label" value="{{i}}" bindchange="onPick">' +
        '<view class="row">{{opts[i].label}}</view></picker>',
      { opts: [{ label: 'A' }, { label: 'B' }], i: 1 }
    )
    assert.strictEqual(result.html, '<div data-wx-picker="p1"><div class="row">B</div></div>')
    const p = result.pickers.p1
    assert.ok(p, 'picker 应被登记')
    assert.strictEqual(p.range.length, 2)
    assert.strictEqual(p.rangeKey, 'label')
    assert.strictEqual(p.value, 1)
    assert.strictEqual(p.handler, 'onPick')
    assert.strictEqual(p.mode, 'selector')
  })

  t.test('★ disabled="{{false}}" 不算禁用（属性存在 != 生效）', function () {
    // 真实模板：disabled="{{!accountNames.length}}" —— 有账户时值是 false，
    // 如果只看"属性是否存在"，所有 picker 都会被锁死、点了没反应
    const enabled = render('<picker range="{{r}}" disabled="{{!r.length}}" bindchange="f">x</picker>', { r: ['a'] })
    assert.strictEqual(enabled.pickers.p1.disabled, false, '有选项时不应禁用')

    const disabled = render('<picker range="{{r}}" disabled="{{!r.length}}" bindchange="f">x</picker>', { r: [] })
    assert.strictEqual(disabled.pickers.p1.disabled, true, '没选项时应禁用')

    const bare = render('<picker range="{{r}}" disabled bindchange="f">x</picker>', { r: ['a'] })
    assert.strictEqual(bare.pickers.p1.disabled, true, '裸 disabled 属性算禁用')
  })

  t.test('date 模式的 picker 保留 start/end', function () {
    const result = render('<picker mode="date" start="2000-01-01" end="2100-12-31" bindchange="onDate">x</picker>', {})
    const p = result.pickers.p1
    assert.strictEqual(p.mode, 'date')
    assert.strictEqual(p.start, '2000-01-01')
    assert.strictEqual(p.end, '2100-12-31')
  })

  t.test('picker 的 data-* 透传（模板里靠它定位）', function () {
    const result = render('<picker data-index="{{index}}" bindchange="f">x</picker>', { index: 2 })
    assert.ok(result.html.indexOf('data-index="2"') >= 0, result.html)
  })

  // ======================================================================
  // 综合：模拟一段真实模板
  // ======================================================================
  t.test('综合：列表 + 条件 + 事件（贴近真实页面结构）', function () {
    const src =
      '<view class="card card-tight">' +
      '<block wx:if="{{items.length}}">' +
      '<view wx:for="{{items}}" wx:key="id" class="list-item" data-id="{{item.id}}" bindtap="goDetail">' +
      '<text class="name">{{item.name}}</text>' +
      '<text wx:if="{{!item.done}}" class="tag" catchtap="mark" data-id="{{item.id}}">确认</text>' +
      '</view>' +
      '</block>' +
      '<view wx:else class="placeholder">还没有记录</view>' +
      '</view>'

    const out = html(src, { items: [{ id: 1, name: '甲', done: false }, { id: 2, name: '乙', done: true }] })
    assert.ok(out.indexOf('甲') >= 0 && out.indexOf('乙') >= 0, '两个 item 都渲染')
    assert.strictEqual((out.match(/确认/g) || []).length, 1, '只有未完成的才有"确认"按钮')
    assert.ok(out.indexOf('还没有记录') < 0, '有数据时不显示空态')
    assert.ok(out.indexOf('data-wx-tap="goDetail"') >= 0, '行点击绑定存在')
    assert.ok(out.indexOf('data-wx-catch="1"') >= 0, 'catchtap 标记存在')

    const empty = html(src, { items: [] })
    assert.ok(empty.indexOf('还没有记录') >= 0, '空数组时显示空态')
    assert.ok(empty.indexOf('list-item') < 0, '空数组时没有列表行')
  })
}
