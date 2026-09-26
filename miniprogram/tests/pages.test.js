/**
 * 页面级回归测试。
 *
 * 这里的每一条都对应一次**真实修过的 bug**（见代码注释里的 P0-x 编号），
 * 目的不是"提高覆盖率"，而是让别人改坏这些地方时立刻变红。
 */

const { createWxMock, withWx, assert } = require('./harness')
const { loadPage, createPage, deferred, flush } = require('./page-harness')

const api = require('../services/api')

/** 临时替换 api 上的方法，返回一个恢复函数 */
function stub(obj, key, impl) {
  const original = obj[key]
  obj[key] = impl
  return function restore() {
    obj[key] = original
  }
}

module.exports = function (t) {
  // ======================================================================
  // P0-3：分红列表的守卫粒度
  // ======================================================================
  t.test('分红列表 reload 必须把 hasMore/loadingMore 一起复位', function () {
    const page = createPage(loadPage('../pages/dividends/index.js'), {
      items: [{ id: 'old' }],
      page: 1,
      hasMore: true,
      loadingMore: false,
      year: 2026,
    })

    const restoreList = stub(api.dividends, 'list', function () {
      return deferred().promise // 一直挂着，模拟请求在途
    })
    const restoreDash = stub(api.dashboard, 'get', function () {
      return deferred().promise
    })

    page.onLoad()
    page.reload()

    // ★ 关键断言：不修的话 hasMore 还是 true，用户一滑就会触发 loadMore，
    //   而 loadMore 会让在途的第 1 页失效 —— 前 20 条被静默丢掉
    assert.strictEqual(page.data.hasMore, false, 'reload 后 hasMore 必须为 false')
    assert.strictEqual(page.data.loadingMore, false, 'reload 后 loadingMore 必须为 false')
    assert.deepStrictEqual(page.data.items, [], 'reload 后列表应清空')

    restoreList()
    restoreDash()
  })

  t.test('★ 回归 P0-3：reload 在途时触底不应丢掉第一页', function () {
    const page = createPage(loadPage('../pages/dividends/index.js'), { year: 2026 })

    const firstPage = deferred()
    const calls = []
    const restoreList = stub(api.dividends, 'list', function (params) {
      calls.push(params.page)
      return firstPage.promise
    })
    const restoreDash = stub(api.dashboard, 'get', function () {
      return Promise.resolve({ summary: { received: 0, pending: 0 } })
    })

    page.onLoad()
    page.reload()
    // 列表被清空的那一刻旧代码 hasMore 仍是 true，用户顺手一滑……
    page.onReachBottom()

    assert.deepStrictEqual(calls, [1], '只能请求第 1 页，不能因为触底而请求第 2 页')

    firstPage.resolve({ total: 1, items: [{ id: 'x1' }] })
    return flush().then(function () {
      assert.deepStrictEqual(
        page.data.items.map(function (i) { return i.id }),
        ['x1'],
        '第一页数据必须被应用'
      )
      restoreList()
      restoreDash()
    })
  })

  t.test('★ 回归 P0-3：分页请求不应让在途的第 1 页失效', function () {
    const page = createPage(loadPage('../pages/dividends/index.js'), { year: 2026 })

    const page1 = deferred()
    const page2 = deferred()
    const restoreList = stub(api.dividends, 'list', function (params) {
      return params.page === 1 ? page1.promise : page2.promise
    })
    const restoreDash = stub(api.dashboard, 'get', function () {
      return Promise.resolve({ summary: { received: 0, pending: 0 } })
    })

    page.onLoad()
    page.reload()

    // 手动构造"第 1 页已在途、用户又触底"的局面
    page.data.hasMore = true
    page.onReachBottom()

    page1.resolve({ total: 40, items: [{ id: 'x1' }] })
    return flush()
      .then(function () {
        // 第 1 页先回来，必须被应用（旧代码此时它已被 loadMore 作废）
        assert.deepStrictEqual(
          page.data.items.map(function (i) { return i.id }),
          ['x1'],
          '第 1 页不应被分页请求作废'
        )
        page2.resolve({ total: 40, items: [{ id: 'x2' }] })
        return flush()
      })
      .then(function () {
        assert.deepStrictEqual(
          page.data.items.map(function (i) { return i.id }),
          ['x1', 'x2'],
          '第 2 页应追加在后面'
        )
        restoreList()
        restoreDash()
      })
  })

  // ======================================================================
  // P1-2：持仓列表的账户筛选竞态
  // ======================================================================
  t.test('★ 回归 P1-2：持仓筛选的过期响应必须被丢弃', function () {
    const page = createPage(loadPage('../pages/holdings/index.js'))

    const accountA = deferred()
    const calls = []
    const restoreAccounts = stub(api.accounts, 'list', function () {
      return Promise.resolve([{ id: 'A', name: '账户A' }, { id: 'B', name: '账户B' }])
    })
    const restoreHoldings = stub(api.holdings, 'list', function (params) {
      calls.push(params.account_id)
      return params.account_id === 'A' ? accountA.promise : Promise.resolve([])
    })

    page.onLoad()

    return page
      .load()
      .then(function () {
        // 现在 filters = [全部, A, B]，切到 A（请求挂住）
        page.onFilterChange({ currentTarget: { dataset: { index: 1 } } })
        // 再切到 B
        page.onFilterChange({ currentTarget: { dataset: { index: 2 } } })
        return flush()
      })
      .then(function () {
        assert.deepStrictEqual(calls, ['', 'A', 'B'], '三次请求的 account_id 顺序')
        // A 的响应最后才回来 —— 它已经过期了，不能覆盖 B 的结果
        accountA.resolve([])
        return flush()
      })
      .then(function () {
        assert.strictEqual(page.data.loading, false, 'loading 应已结束')
        assert.strictEqual(
          page.data.filterIndex,
          2,
          '高亮的 chip 仍是 B（列表内容不该影响选中态）'
        )
        restoreAccounts()
        restoreHoldings()
      })
  })

  // ======================================================================
  // P0-1 / P0-2：改了标的代码必须作废缓存的 security
  // ======================================================================
  t.test('★ 回归 P0-1：持仓表单改代码后清掉已查到的标的', function () {
    const page = createPage(loadPage('../pages/holding-create/index.js'), {
      security: { id: 'sec-old', code: '601988', name: '中国银行' },
      notFound: false,
    })

    page.onCodeInput({ detail: { value: '601857' } })

    assert.strictEqual(page.data.code, '601857')
    assert.strictEqual(page.data.security, null, 'security 必须被清空')
    assert.strictEqual(page.data.notFound, false)
  })

  t.test('★ 回归 P0-2：分红表单改代码后清掉已查到的标的', function () {
    const page = createPage(loadPage('../pages/dividend-create/index.js'), {
      security: { id: 'sec-old', code: '601988', name: '中国银行' },
      notFound: false,
    })

    page.onCodeInput({ detail: { value: '601857' } })

    assert.strictEqual(page.data.security, null, 'security 必须被清空')
  })

  t.test('★ 回归 P0-1：ensureSecurity 不会复用 code 对不上的缓存', function () {
    const page = createPage(loadPage('../pages/holding-create/index.js'), {
      code: '601857',
      name: '',
      security: { id: 'sec-old', code: '601988', name: '中国银行' },
    })

    let created = null
    const restore = stub(api.securities, 'create', function (payload) {
      created = payload
      return Promise.resolve({ id: 'sec-new', code: payload.code, name: payload.name })
    })

    return page.ensureSecurity('601857', '中国石油').then(function (security) {
      assert.ok(created, 'code 不一致时必须重新创建，而不是复用旧的')
      assert.strictEqual(created.code, '601857')
      assert.strictEqual(security.id, 'sec-new')
      restore()
    })
  })

  t.test('ensureSecurity 在 code 一致时复用缓存（不多打一次请求）', function () {
    const page = createPage(loadPage('../pages/holding-create/index.js'), {
      code: '601988',
      security: { id: 'sec-1', code: '601988', name: '中国银行' },
    })

    let called = false
    const restore = stub(api.securities, 'create', function () {
      called = true
      return Promise.resolve({})
    })

    return page.ensureSecurity('601988', '中国银行').then(function (security) {
      assert.strictEqual(called, false, 'code 一致时不该重新创建')
      assert.strictEqual(security.id, 'sec-1')
      restore()
    })
  })

  // ======================================================================
  // P1-3：查询失败时必须让"新标的"表单出现，否则用户被卡死
  // ======================================================================
  t.test('★ 回归 P1-3：标的查询失败时按"新标的"处理，名称框才会出现', function () {
    const page = createPage(loadPage('../pages/holding-create/index.js'), { code: '601988' })

    const restore = stub(api.securities, 'list', function () {
      return Promise.reject(new Error('网络抖动'))
    })

    return page.lookup().then(function () {
      assert.strictEqual(page.data.looking, false, '不能一直显示"查询中"')
      assert.strictEqual(page.data.notFound, true, '必须置 notFound 才能渲染名称输入框')
      restore()
    })
  })

  t.test('★ 回归 P1-4：清空代码时作废在途查询，旧标的不能"复活"', function () {
    const page = createPage(loadPage('../pages/holding-create/index.js'))

    const inflight = deferred()
    const restore = stub(api.securities, 'list', function () {
      return inflight.promise
    })

    page.data.code = '601988'
    const p = page.lookup()

    // 用户把输入框清空
    page.onCodeInput({ detail: { value: '' } })
    assert.strictEqual(page.data.security, null)

    // 之前那个请求现在才回来
    inflight.resolve([{ id: 'sec-1', code: '601988', name: '中国银行' }])
    return p
      .then(function () {
        return flush()
      })
      .then(function () {
        assert.strictEqual(page.data.security, null, '在途响应不能把已清空的标的填回来')
        assert.strictEqual(page.data.looking, false, 'looking 应被复位')
        restore()
      })
  })

  // ======================================================================
  // P1-5：缺少 id 参数不应无限转圈
  // ======================================================================
  t.test('★ 回归 P1-5：持仓详情缺 id 时给出错误而不是永久 loading', function () {
    const page = createPage(loadPage('../pages/holding-detail/index.js'))

    return withWx(createWxMock({}).wx, function () {
      page.onLoad({})
      assert.strictEqual(page.data.loading, false, 'loading 必须结束')
      assert.ok(page.data.error, '应给出可读的错误提示')
    })
  })

  t.test('持仓详情带 id 时正常进入加载态', function () {
    const page = createPage(loadPage('../pages/holding-detail/index.js'))
    page.onLoad({ id: 'h-1' })
    assert.strictEqual(page.data.id, 'h-1')
    assert.strictEqual(page.data.loading, true, '有 id 时应该去加载')
  })
}
