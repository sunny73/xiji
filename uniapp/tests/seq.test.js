/** utils/seq.js 的测试：请求序号守卫 */

import {createGuard} from '../src/utils/seq.js'

export default function (t) {
  t.test('最新一次请求被认定为有效', function () {
    const g = createGuard()
    const a = g.next()
    t.ok(g.isCurrent(a), '刚发出的请求应该是有效的')
  })

  t.test('新的请求会让旧的失效（模拟"后发先至"）', function () {
    const g = createGuard()
    const first = g.next()
    const second = g.next()

    // 第二个请求先回来了 -> 有效；第一个随后回来 -> 必须被丢弃
    t.ok(g.isCurrent(second), '后发的请求有效')
    t.ok(!g.isCurrent(first), '先发的旧请求必须被丢弃')
  })

  t.test('invalidate 之后所有在途请求都失效（页面卸载场景）', function () {
    const g = createGuard()
    const token = g.next()
    g.invalidate()
    t.ok(!g.isCurrent(token), '卸载后回来的响应不应再 setData')
  })

  t.test('依次串行请求时每次都有效', function () {
    const g = createGuard()
    const a = g.next()
    t.ok(g.isCurrent(a))
    const b = g.next()
    t.ok(g.isCurrent(b))
    t.ok(!g.isCurrent(a))
  })

  t.test('两个 guard 互不干扰', function () {
    const g1 = createGuard()
    const g2 = createGuard()
    const a = g1.next()
    g2.next()
    t.ok(g1.isCurrent(a), 'g2 的请求不该影响 g1')
  })

  t.test('token 单调递增，不会因为回绕而误判', function () {
    const g = createGuard()
    const tokens = []
    for (let i = 0; i < 5; i++) tokens.push(g.next())
    t.eq(tokens, [1, 2, 3, 4, 5], '序号从 1 开始递增')
  })
}
