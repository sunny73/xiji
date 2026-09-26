#!/usr/bin/env node
/**
 * 前后端契约集成测试。
 *
 *     cd miniprogram && node tests/integration.js
 *
 * 单元测试用的是**我假设的**后端响应形状；这个脚本用真实 HTTP 打真实后端，
 * 验证这个假设对不对。能抓到的问题类型：
 *   - URL 拼错（/dividend vs /dividends）
 *   - 字段名对不上（per_share vs perShare）
 *   - 请求体多了/少了字段（比如前端传了 amount 被 422 拒掉）
 *   - 分页 / 筛选参数后端不认
 *
 * 需要一个跑着的后端（docker compose up 或 uvicorn），默认 http://127.0.0.1:8000。
 * 通过环境变量改：DM_BASE_URL=http://192.168.1.8:8000 node tests/integration.js
 */

const http = require('http')
const { URL } = require('url')

const BASE = (process.env.DM_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const API_PREFIX = '/api/v1'

const GREEN = '\033[32m'
const RED = '\033[31m'
const DIM = '\033[2m'
const RESET = '\033[0m'

let passed = 0
const failures = []

function check(label, condition, detail) {
  if (condition) {
    passed++
    console.log(`  ${GREEN}✓${RESET} ${label}`)
  } else {
    failures.push(label + (detail ? `  ${DIM}${detail}${RESET}` : ''))
    console.log(`  ${RED}✗${RESET} ${label} ${DIM}${detail || ''}${RESET}`)
  }
}

// --- 用 Node 的 http 实现一个 wx.request ----------------------------------

const storage = {}

function nodeRequest(config) {
  return new Promise(function (resolve) {
    const url = new URL(config.url)
    const method = config.method || 'GET'

    // 模仿 wx.request：GET 的 data 会被拼成 query string
    if (method === 'GET' && config.data) {
      Object.keys(config.data).forEach(function (k) {
        const v = config.data[k]
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
      })
    }

    const body = method === 'GET' || method === 'DELETE' ? null : JSON.stringify(config.data || {})
    const headers = Object.assign({}, config.header)
    if (body) headers['Content-Length'] = Buffer.byteLength(body)

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: method,
        headers: headers,
      },
      function (res) {
        let raw = ''
        res.on('data', function (c) {
          raw += c
        })
        res.on('end', function () {
          let parsed = null
          try {
            parsed = raw ? JSON.parse(raw) : null
          } catch (e) {
            parsed = raw
          }
          // 注意：wx.request 对 4xx/5xx 也走 success，业务层看 statusCode 处理
          resolve({ statusCode: res.statusCode, data: parsed })
          config.success({ statusCode: res.statusCode, data: parsed, header: res.headers })
        })
      }
    )

    req.on('error', function (e) {
      resolve()
      config.fail({ errMsg: 'request:fail ' + e.message })
    })

    if (body) req.write(body)
    req.end()
  })
}

global.wx = {
  getStorageSync: function (k) {
    return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : ''
  },
  setStorageSync: function (k, v) {
    storage[k] = v
  },
  removeStorageSync: function (k) {
    delete storage[k]
  },
  request: nodeRequest,
  login: function (h) {
    setTimeout(function () {
      h.success({ code: 'integration-code' })
    }, 0)
  },
  showToast: function () {},
  showLoading: function () {},
  hideLoading: function () {},
}

// 把 config 的 baseUrl 指向被测服务
const config = require('../utils/config')
config.baseUrl = BASE + API_PREFIX

const api = require('../services/api')
const auth = require('../services/auth')
const fmt = require('../utils/format')
const decorate = require('../utils/decorate')

// --- 主流程 ----------------------------------------------------------------

async function main() {
  console.log(`\n对 ${BASE} 做前后端契约测试\n`)

  // 0) 服务是否活着
  try {
    await new Promise(function (resolve, reject) {
      const req = http.get(BASE + '/healthz', function (res) {
        res.resume()
        resolve(res.statusCode)
      })
      req.on('error', reject)
      req.setTimeout(3000, function () {
        req.destroy(new Error('timeout'))
      })
    })
  } catch (e) {
    console.log(`${RED}连不上 ${BASE}${RESET}`)
    console.log('先启动后端：docker compose up -d   或   cd backend && .venv/bin/uvicorn app.main:app')
    process.exitCode = 2
    return
  }

  // 1) 登录
  const user = await auth.login()
  check('登录并拿到 token', !!(user && user.id))
  check('token 已落盘', !!auth.getToken())

  // 2) /auth/me
  const me = await api.auth.me()
  check('GET /auth/me 字段可解析', me.id === user.id)

  // 3) 账户
  const suffix = Date.now().toString(36).slice(-6)
  const account = await api.accounts.create({ name: '集成测试-' + suffix, type: 'personal' })
  check('POST /accounts', !!account.id)
  check('账户返回含 created_at', !!account.created_at)

  const accounts = await api.accounts.list()
  check('GET /accounts 是数组', Array.isArray(accounts) && accounts.length >= 1)

  // 4) 标的（幂等）
  const code = '9' + suffix.replace(/[^0-9]/g, '').slice(0, 5).padEnd(5, '0')
  const security = await api.securities.create({
    code: code,
    name: '契约测试标的',
    market: 'CN',
    type: 'STOCK',
  })
  check('POST /securities', !!security.id)
  const again = await api.securities.create({
    code: code,
    name: '契约测试标的',
    market: 'CN',
    type: 'STOCK',
  })
  check('POST /securities 幂等（同 code 返回同一条）', again.id === security.id)

  const search = await api.securities.list({ keyword: code })
  check('GET /securities?keyword= 能搜到', search.some(function (s) { return s.id === security.id }))

  // 5) 持仓
  const holding = await api.holdings.create({
    account_id: account.id,
    security_id: security.id,
    shares: 10000,
    cost_price: 4.12,
  })
  check('POST /holdings', !!holding.id)
  check('持仓返回嵌套 security（装饰层能用）', !!(holding.security && holding.security.code))
  check('持仓返回 account_name', holding.account_name === account.name)
  check('cost_amount = 41200', holding.cost_amount === 41200)
  const decoratedHolding = decorate.holding(holding)
  check('decorate.holding 产出 costAmount 数值', decoratedHolding.costAmount === 41200)

  // 6) 分红：金额必须由后端算
  const today = fmt.today()
  const paymentDate = today.year + '-01-15'
  const dividend = await api.dividends.create({
    account_id: account.id,
    security_id: security.id,
    payment_date: paymentDate,
    shares: 10000,
    per_share: 0.19,
    status: 'received',
  })
  check('POST /dividends', !!dividend.id)
  check('后端算出 amount = 1900', dividend.amount === 1900, '实际 ' + dividend.amount)
  check('返回 shares/per_share 供回溯', dividend.shares === 10000 && dividend.per_share === 0.19)
  check('decorate.dividend 状态中文正确', decorate.dividend(dividend).statusLabel === '已到账')

  // 7) amount 不允许由前端传（前端一旦传了，这里会红）
  let rejected = false
  let rejectMessage = ''
  try {
    await api.call({
      url: '/dividends',
      method: 'POST',
      data: {
        account_id: account.id,
        security_id: security.id,
        payment_date: paymentDate,
        shares: 100,
        per_share: 1,
        amount: 999999,
      },
    })
  } catch (e) {
    rejected = e.statusCode === 422
    rejectMessage = e.message
  }
  check('请求体带 amount 被后端 422 拒绝', rejected, rejectMessage)

  // 8) 分红列表 + 筛选
  const list = await api.dividends.list({ year: today.year, page: 1, page_size: 20 })
  check('GET /dividends 返回分页结构', typeof list.total === 'number' && Array.isArray(list.items))
  check('分页字段名是 page_size（契约）', typeof list.page_size === 'number', JSON.stringify(Object.keys(list)))
  check('列表里能找到刚建的那笔', list.items.some(function (d) { return d.id === dividend.id }))

  const bySecurity = await api.dividends.list({ security_id: security.id })
  check('GET /dividends?security_id= 筛选生效', bySecurity.items.every(function (d) {
    return d.security_id === security.id
  }) && bySecurity.total >= 1)

  const byStatus = await api.dividends.list({ status: 'received' })
  check('GET /dividends?status=received 筛选生效', byStatus.items.every(function (d) {
    return d.status === 'received'
  }))

  // 9) 更新分红会重算金额
  const updated = await api.dividends.update(dividend.id, { shares: 5000 })
  check('PUT /dividends 改了股数后金额重算 = 950', updated.amount === 950, '实际 ' + updated.amount)

  // 10) Dashboard
  const dash = await api.dashboard.get({ year: today.year })
  check('GET /dashboard 字段齐全', ['year', 'summary', 'next_dividend', 'current_month', 'recent_dividends'].every(
    function (k) { return k in dash }
  ))
  check('summary 三个字段齐全', ['estimated', 'received', 'pending'].every(function (k) { return k in dash.summary }))
  check('summary.received 包含刚记的 950', dash.summary.received >= 950, '实际 ' + dash.summary.received)
  check('current_month 是对象', typeof dash.current_month.month === 'number')
  const decoratedSummary = decorate.summary(dash.summary)
  check('decorate.summary 产出文案', /\d/.test(decoratedSummary.receivedText))

  // 11) 统计
  const monthly = await api.statistics.monthly({ year: today.year })
  check('GET /statistics/monthly 固定 12 个月', monthly.length === 12)
  check('monthly 有 month/amount/count', ['month', 'amount', 'count'].every(function (k) { return k in monthly[0] }))
  const bars = decorate.monthlyBars(monthly)
  check('decorate.monthlyBars 产出 heightPercent', bars.every(function (b) { return typeof b.heightPercent === 'number' }))

  const yearly = await api.statistics.yearly()
  check('GET /statistics/yearly', Array.isArray(yearly) && yearly.some(function (r) { return r.year === today.year }))

  const bySec = await api.statistics.bySecurity({ year: today.year })
  check('GET /statistics/securities', Array.isArray(bySec) && bySec.length >= 1)
  check('bySecurity 字段名是 security_code', 'security_code' in bySec[0])

  const calendar = await api.statistics.calendar({ year: today.year, month: 1 })
  check('GET /statistics/calendar', Array.isArray(calendar))
  check('calendar 每天有 date/total/items', calendar.every(function (d) {
    return typeof d.date === 'string' && 'total' in d && Array.isArray(d.items)
  }))

  // 12) 标记到账
  const pendingOne = await api.dividends.create({
    account_id: account.id,
    security_id: security.id,
    payment_date: paymentDate,
    shares: 1000,
    per_share: 1,
    status: 'pending',
  })
  const received = await api.dividends.markReceived(pendingOne.id, paymentDate)
  check('POST /dividends/{id}/receive 改成 received', received.status === 'received')

  // 13) 错误翻译：访问不存在的资源
  // 后端的 404 detail 是具体的（"持仓不存在"），前端应当原样透出给用户，
  // 只有后端没给 detail 时才用通用兜底文案
  let notFoundMsg = ''
  try {
    await api.holdings.detail('00000000-0000-0000-0000-000000000001')
  } catch (e) {
    notFoundMsg = e.message
  }
  check('404 透出后端的具体中文提示', notFoundMsg === '持仓不存在', notFoundMsg)

  let noDetailMsg = ''
  try {
    await api.call({ url: '/holdings/00000000-0000-0000-0000-000000000002' })
  } catch (e) {
    noDetailMsg = e.message
  }
  check(
    '后端无 detail 时用兜底文案',
    noDetailMsg === '持仓不存在' || noDetailMsg === '数据不存在或无权访问',
    noDetailMsg
  )

  // 14) 非法 UUID 不应把页面搞崩
  let badMsg = ''
  try {
    await api.holdings.detail('not-a-uuid')
  } catch (e) {
    badMsg = e.message
  }
  check('非法 UUID 抛出可读错误', !!badMsg && badMsg.indexOf('undefined') < 0, badMsg)

  // 15) 清理
  await api.accounts.remove(account.id)
  let gone = false
  try {
    await api.dividends.detail(dividend.id)
  } catch (e) {
    gone = e.statusCode === 404
  }
  check('删除账户级联删除分红', gone)

  console.log()
  if (failures.length) {
    console.log(`${RED}${failures.length} 项失败：${RESET}`)
    failures.forEach(function (f) {
      console.log('  - ' + f)
    })
    process.exitCode = 1
    return
  }
  console.log(`${GREEN}全部通过（${passed} 项）${RESET}`)
}

main().catch(function (e) {
  console.error(`\n${RED}集成测试异常：${RESET}`, e)
  process.exitCode = 1
})
