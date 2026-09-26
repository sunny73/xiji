/**
 * 网络层测试：services/http.js + services/auth.js + services/api.js
 *
 * 这一层最值得测，因为它同时管着三件容易出错的事：
 *   1. token 过期后的重新登录（重放**只能一次**，否则死循环）
 *   2. 错误信息翻译（后端返回的 422 是数组，直接 toast 会显示 [object Object]）
 *   3. 请求参数清洗（空字符串不能发出去，否则后端会把 "" 当有效值）
 */

import {createUniMock, withUni, assert} from './harness.js'

import * as http from '../src/services/http.js'
import * as auth from '../src/services/auth.js'
import * as api from '../src/services/api.js'
import config from '../src/utils/config.js'

const LOGIN_OK = {
  statusCode: 200,
  data: { access_token: 'fresh-token', token_type: 'bearer', expires_in: 100, user: { id: 'u1' } },
}

export default function (t) {
  // --- 纯函数：错误翻译 ---------------------------------------------------

  t.test('buildError: FastAPI 422 的数组 detail 会拼成人话', function () {
    const err = api.buildError({
      statusCode: 422,
      data: {
        detail: [
          { loc: ['body', 'amount'], msg: 'Extra inputs are not permitted' },
          { loc: ['body', 'shares'], msg: 'Input should be greater than 0' },
        ],
      },
    })
    assert.strictEqual(err.statusCode, 422)
    assert.ok(err.message.indexOf('amount') >= 0, '应包含字段名，实际：' + err.message)
    assert.ok(err.message.indexOf('shares') >= 0)
    assert.ok(err.message.indexOf('；') >= 0, '多个错误用分号连接')
    assert.ok(err.message.indexOf('[object') < 0, '不能出现 [object Object]')
  })

  t.test('buildError: 字符串 detail 直接用', function () {
    const err = api.buildError({ statusCode: 409, data: { detail: '该账户下已存在此标的的持仓' } })
    assert.strictEqual(err.message, '该账户下已存在此标的的持仓')
  })

  t.test('buildError: 404 用兜底文案，不暴露"存在但无权"', function () {
    const err = api.buildError({ statusCode: 404, data: {} })
    assert.strictEqual(err.message, '数据不存在或无权访问')
  })

  t.test('buildError: 500 有兜底文案', function () {
    assert.strictEqual(api.buildError({ statusCode: 500, data: null }).message, '服务器出错了，请稍后重试')
  })

  t.test('buildError: 未知状态码也不显示 undefined', function () {
    const msg = api.buildError({ statusCode: 418, data: {} }).message
    assert.ok(msg.indexOf('418') >= 0, msg)
  })

  t.test('networkMessage: 域名未配置时给出可操作提示', function () {
    const msg = http.networkMessage({ errMsg: 'request:fail url not in domain list' })
    assert.ok(msg.indexOf('不校验合法域名') >= 0, msg)
  })

  t.test('networkMessage: 超时时提示检查后端', function () {
    assert.ok(http.networkMessage({ errMsg: 'request:fail timeout' }).indexOf('超时') >= 0)
  })

  t.test('networkMessage: 兜底不返回空字符串', function () {
    assert.ok(http.networkMessage({}).length > 0)
    assert.ok(http.networkMessage(null).length > 0)
  })

  // --- 请求组装 -----------------------------------------------------------

  t.test('GET 成功：返回 data，并带上 Bearer token', function () {
    const mock = createUniMock({
      storage: { dm_token: 'tok-1' },
      respond: function (cfg) {
        if (/\/holdings$/.test(cfg.url)) return { statusCode: 200, data: [{ id: 'h1' }] }
        return { statusCode: 500, data: {} }
      },
    })

    return withUni(mock.uni, function () {
      return api.holdings.list().then(function (list) {
        assert.strictEqual(list.length, 1)
        assert.strictEqual(mock.requests[0].header.Authorization, 'Bearer tok-1')
        assert.strictEqual(mock.requests[0].method, 'GET')
        assert.ok(
          mock.requests[0].url.indexOf(config.baseUrl) === 0,
          'URL 必须以 baseUrl 开头：' + mock.requests[0].url
        )
      })
    })
  })

  t.test('没登录时不硬塞 Authorization 头', function () {
    const mock = createUniMock({
      respond: function () {
        return { statusCode: 200, data: [] }
      },
    })
    return withUni(mock.uni, function () {
      return api.securities.list({ keyword: '601988' }).then(function () {
        assert.strictEqual(mock.requests[0].header.Authorization, undefined)
      })
    })
  })

  t.test('cleanParams: 空字符串/null 参数不会发出去，但保留 0', function () {
    const mock = createUniMock({
      storage: { dm_token: 't' },
      respond: function () {
        return { statusCode: 200, data: { total: 0, items: [] } }
      },
    })
    return withUni(mock.uni, function () {
      return api.dividends
        .list({ year: 2026, status: '', account_id: null, month: undefined, page: 1, page_size: 20 })
        .then(function () {
          assert.deepStrictEqual(mock.requests[0].data, { year: 2026, page: 1, page_size: 20 })
        })
    })
  })

  t.test('创建分红时不会替调用方补 amount 字段（回归防护）', function () {
    const mock = createUniMock({
      storage: { dm_token: 't' },
      respond: function () {
        return { statusCode: 201, data: { id: 'd1', amount: 1900 } }
      },
    })
    const payload = {
      account_id: 'a1',
      security_id: 's1',
      payment_date: '2026-09-20',
      shares: 10000,
      per_share: 0.19,
      status: 'pending',
    }
    return withUni(mock.uni, function () {
      return api.dividends.create(payload).then(function () {
        const sent = mock.requests[0].data
        assert.deepStrictEqual(sent, payload)
        assert.ok(!('amount' in sent), 'amount 必须由后端算，前端不能传')
      })
    })
  })

  // --- 401 重新登录 -------------------------------------------------------

  t.test('401：自动重新登录并重放一次，成功后令牌被更新', function () {
    let dividendCalls = 0
    const mock = createUniMock({
      storage: { dm_token: 'stale-token' },
      respond: function (cfg) {
        if (/\/auth\/dev-login$/.test(cfg.url)) return LOGIN_OK
        if (/\/dividends$/.test(cfg.url)) {
          dividendCalls++
          const authz = (cfg.header || {}).Authorization
          if (authz === 'Bearer fresh-token') {
            return { statusCode: 200, data: { total: 1, page: 1, page_size: 20, items: [{ id: 'd1' }] } }
          }
          return { statusCode: 401, data: { detail: '未登录或登录已过期' } }
        }
        return { statusCode: 500, data: {} }
      },
    })

    return withUni(mock.uni, function () {
      return api.dividends.list().then(function (res) {
        assert.strictEqual(dividendCalls, 2, '原请求 + 重放一次 = 2 次')
        assert.strictEqual(res.items.length, 1)
        assert.strictEqual(mock.storage.dm_token, 'fresh-token', '新 token 已落盘')
      })
    })
  })

  t.test('401：重放后仍失败就抛错，绝不无限循环', function () {
    let businessCalls = 0
    const mock = createUniMock({
      storage: { dm_token: 'bad' },
      respond: function (cfg) {
        if (/\/auth\/dev-login$/.test(cfg.url)) return LOGIN_OK
        businessCalls++
        return { statusCode: 401, data: { detail: '未登录' } }
      },
    })

    return withUni(mock.uni, function () {
      return api.accounts.list().then(
        function () {
          throw new Error('本应失败')
        },
        function (err) {
          assert.strictEqual(err.statusCode, 401)
          assert.strictEqual(businessCalls, 2, '最多重放一次')
        }
      )
    })
  })

  t.test('401：并发请求只触发一次登录', function () {
    let loginCalls = 0
    let needFresh = true
    const mock = createUniMock({
      storage: { dm_token: 'stale' },
      respond: function (cfg) {
        if (/\/auth\/dev-login$/.test(cfg.url)) {
          loginCalls++
          return LOGIN_OK
        }
        const authz = (cfg.header || {}).Authorization
        if (authz === 'Bearer fresh-token') {
          needFresh = false
          return { statusCode: 200, data: [] }
        }
        return { statusCode: 401, data: { detail: '未登录' } }
      },
    })

    return withUni(mock.uni, function () {
      return Promise.all([
        api.accounts.list(),
        api.holdings.list(),
        api.dividends.list(),
      ]).then(function () {
        assert.strictEqual(loginCalls, 1, '三个并发 401 只应登录一次，实际 ' + loginCalls)
        assert.strictEqual(needFresh, false)
      })
    })
  })

  t.test('401：登录接口本身失败时，把登录错误抛出来', function () {
    const mock = createUniMock({
      storage: { dm_token: 'stale' },
      respond: function (cfg) {
        if (/\/auth\/dev-login$/.test(cfg.url)) {
          return { statusCode: 500, data: { detail: '服务端炸了' } }
        }
        return { statusCode: 401, data: { detail: '未登录' } }
      },
    })

    return withUni(mock.uni, function () {
      return api.accounts.list().then(
        function () {
          throw new Error('本应失败')
        },
        function (err) {
          assert.ok(err.message.indexOf('服务端炸了') >= 0, err.message)
        }
      )
    })
  })

  t.test('业务 401 之外的错误不会被当成登录问题重试', function () {
    let calls = 0
    const mock = createUniMock({
      storage: { dm_token: 't' },
      respond: function () {
        calls++
        return { statusCode: 409, data: { detail: '已存在' } }
      },
    })
    return withUni(mock.uni, function () {
      return api.holdings.create({}).then(
        function () {
          throw new Error('本应失败')
        },
        function (err) {
          assert.strictEqual(err.statusCode, 409)
          assert.strictEqual(calls, 1, '409 不该重试')
        }
      )
    })
  })

  // --- 网络层失败 ---------------------------------------------------------

  t.test('网络失败：抛出的错误带 isNetworkError，便于页面区分处理', function () {
    const mock = createUniMock({
      storage: { dm_token: 't' },
      respond: function () {
        return { __fail: true, errMsg: 'request:fail timeout' }
      },
    })
    return withUni(mock.uni, function () {
      return api.dashboard.get().then(
        function () {
          throw new Error('本应失败')
        },
        function (err) {
          assert.strictEqual(err.isNetworkError, true)
          assert.ok(err.message.indexOf('超时') >= 0, err.message)
        }
      )
    })
  })

  // --- 登录 ---------------------------------------------------------------

  t.test('开发环境登录走 dev-login 且用固定 openid', function () {
    const mock = createUniMock({
      respond: function (cfg) {
        if (/\/auth\/dev-login$/.test(cfg.url)) return LOGIN_OK
        return { statusCode: 500, data: {} }
      },
    })
    return withUni(mock.uni, function () {
      return auth.login().then(function (user) {
        const cfg = mock.requests[0]
        assert.ok(/\/auth\/dev-login$/.test(cfg.url), '应调 dev-login，实际 ' + cfg.url)
        assert.strictEqual(cfg.data.openid, config.devOpenid)
        assert.strictEqual(user.id, 'u1')
        assert.strictEqual(mock.storage.dm_token, 'fresh-token')
      })
    })
  })

  t.test('ensureLogin：已有 token 时不再打登录接口', function () {
    const mock = createUniMock({
      storage: { dm_token: 't', dm_user: { id: 'u9' } },
      respond: function () {
        return { statusCode: 200, data: {} }
      },
    })
    return withUni(mock.uni, function () {
      return auth.ensureLogin().then(function (user) {
        assert.strictEqual(mock.requests.length, 0, '不该发任何请求')
        assert.strictEqual(user.id, 'u9')
      })
    })
  })

  t.test('logout 清掉 token 和用户缓存', function () {
    const mock = createUniMock({ storage: { dm_token: 't', dm_user: { id: 'u' } } })
    return withUni(mock.uni, function () {
      auth.logout()
      assert.strictEqual(auth.getToken(), '')
      assert.strictEqual(auth.getUser(), null)
      assert.strictEqual(auth.isLoggedIn(), false)
    })
  })

  t.test('登录响应缺 access_token 时报错而不是写入 undefined', function () {
    const mock = createUniMock({
      respond: function () {
        return { statusCode: 200, data: { user: { id: 'u1' } } }
      },
    })
    return withUni(mock.uni, function () {
      return auth.login().then(
        function () {
          throw new Error('本应失败')
        },
        function (err) {
          assert.ok(err.message.indexOf('登录失败') >= 0, err.message)
          assert.strictEqual(mock.storage.dm_token, undefined)
        }
      )
    })
  })

  t.test('切换开发身份会先清掉旧会话', function () {
    const mock = createUniMock({
      storage: { dm_token: 'old', dm_user: { id: 'old' } },
      respond: function (cfg) {
        if (/\/auth\/dev-login$/.test(cfg.url)) {
          return {
            statusCode: 200,
            data: {
              access_token: 'tok-b',
              user: { id: 'u-b' },
            },
          }
        }
        return { statusCode: 500, data: {} }
      },
    })
    return withUni(mock.uni, function () {
      return auth.switchDevUser('tester-b').then(function () {
        assert.strictEqual(mock.requests[0].data.openid, 'tester-b')
        assert.strictEqual(mock.storage.dm_token, 'tok-b')
      })
    })
  })

  // --- 未登录时也能用的接口 ------------------------------------------------

  t.test('needAuth=false 的请求不带 token', function () {
    const mock = createUniMock({
      storage: { dm_token: 't' },
      respond: function () {
        return { statusCode: 200, data: {} }
      },
    })
    return withUni(mock.uni, function () {
      return api.call({ url: '/public', needAuth: false }).then(function () {
        assert.strictEqual(mock.requests[0].header.Authorization, undefined)
      })
    })
  })
}
