#!/usr/bin/env node
/**
 * 逐页渲染验证。
 *
 *     cd h5 && node tests/render.js
 *
 * 用无头 Chrome 真的把每个页面跑起来（执行 JS、发真实请求、拿真实数据渲染），
 * 然后把可见文本抓出来，检查：
 *   1. 页面有没有渲染出内容（空白 = 某个环节炸了）
 *   2. 有没有渲染出 undefined / NaN / [object Object] / "0 股 × 0" 这类脏数据
 *   3. 页面自身有没有报错
 *
 * 为什么值得单独做这一层：
 *   单元测试用的是**我以为的**数据形状。今天就是靠这一层才发现
 *   后端的 RecentDividend 漏了 shares/per_share，首页显示"0 股 × 0"。
 *
 * 前提：预览服务已在跑（node server.js），且后端有演示数据。
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
]

const BASE = process.env.DM_PREVIEW_URL || 'http://127.0.0.1:3000'

const GREEN = '\033[32m'
const RED = '\033[31m'
const DIM = '\033[2m'
const RESET = '\033[0m'

/** 会渲染出来但明显不对的内容 */
const SUSPICIOUS = [
  { re: /undefined/, why: '渲染出了 undefined（字段没拿到）' },
  { re: /\bNaN\b/, why: '渲染出了 NaN（数值计算失败）' },
  { re: /\[object Object\]/, why: '把对象直接插进模板了' },
  { re: /\b0 股 × 0\b/, why: '股数/每股金额没取到（接口漏字段？）' },
  { re: /¥0\.00\s*$/, why: '金额是 0 —— 可能数据没加载出来' },
  { re: /加载失败|预览启动失败/, why: '页面报错了' },
]

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function dumpDom(chrome, url) {
  const out = execFileSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--virtual-time-budget=9000',
      '--dump-dom',
      url,
    ],
    { maxBuffer: 24 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  )
  return out
}

function extractBodyText(dom) {
  const m = /id="h5-body">([\s\S]*?)<div class="h5-tabbar"/.exec(dom)
  if (!m) return null
  return m[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTitle(dom) {
  const m = /id="h5-nav-title"[^>]*>([^<]*)</.exec(dom)
  return m ? m[1] : ''
}

function main() {
  const chrome = findChrome()
  if (!chrome) {
    console.error(`${RED}找不到 Chrome 系浏览器，无法做无头渲染验证${RESET}`)
    process.exitCode = 2
    return
  }

  // 需要 id 的详情页：先从接口拿一个真实 id 出来
  let sample = {}
  try {
    const login = JSON.parse(
      execFileSync(
        'curl',
        [
          '-s', '--noproxy', '*', '-X', 'POST',
          '-H', 'Content-Type: application/json',
          '-d', '{"openid":"dev-local-user"}',
          BASE + '/api/v1/auth/dev-login',
        ],
        { encoding: 'utf8' }
      )
    )
    const auth = ['-s', '--noproxy', '*', '-H', 'Authorization: Bearer ' + login.access_token]
    const holdings = JSON.parse(execFileSync('curl', auth.concat([BASE + '/api/v1/holdings']), { encoding: 'utf8' }))
    const dividends = JSON.parse(
      execFileSync('curl', auth.concat([BASE + '/api/v1/dividends?page_size=1']), { encoding: 'utf8' })
    )
    sample.holdingId = holdings[0] && holdings[0].id
    sample.dividendId = dividends.items[0] && dividends.items[0].id
    sample.securityId = holdings[0] && holdings[0].security_id
    sample.accountId = holdings[0] && holdings[0].account_id
  } catch (e) {
    console.error(`${RED}拿不到演示数据，先确认后端在跑且已执行 seed_demo.py${RESET}`)
    console.error('  ' + String(e.message).split('\n')[0])
    process.exitCode = 2
    return
  }

  const pages = [
    ['首页', '/pages/home/index'],
    ['持仓', '/pages/holdings/index'],
    ['分红', '/pages/dividends/index'],
    ['统计', '/pages/statistics/index'],
    ['我的', '/pages/profile/index'],
    ['日历', '/pages/calendar/index'],
    ['账户管理', '/pages/accounts/index'],
    ['添加持仓', '/pages/holding-create/index'],
    ['记一笔分红', '/pages/dividend-create/index'],
    ['持仓详情', '/pages/holding-detail/index?id=' + sample.holdingId],
    ['编辑分红', '/pages/dividend-create/index?id=' + sample.dividendId],
  ]

  console.log(`\n逐页渲染验证（无头 Chrome）\n  ${DIM}${BASE}${RESET}\n`)

  let failed = 0
  const issues = []
  const texts = {}

  for (const [name, route] of pages) {
    const url = BASE + '/?page=' + encodeURIComponent(route)
    let dom
    try {
      dom = dumpDom(chrome, url)
    } catch (e) {
      console.log(`  ${RED}✗${RESET} ${name.padEnd(10)} 渲染进程失败`)
      issues.push(name + ': 无头渲染失败')
      failed++
      continue
    }

    const text = extractBodyText(dom)
    const title = extractTitle(dom)
    texts[name] = text

    if (text === null) {
      console.log(`  ${RED}✗${RESET} ${name.padEnd(10)} 页面主体没渲染出来`)
      issues.push(name + ': 主体为空')
      failed++
      continue
    }

    const hits = SUSPICIOUS.filter(function (s) {
      return s.re.test(text)
    }).map(function (s) {
      return s.why
    })

    if (hits.length) {
      console.log(`  ${RED}✗${RESET} ${name.padEnd(10)} ${hits.join('；')}`)
      issues.push(name + ': ' + hits.join('；') + '\n        ' + text.slice(0, 160))
      failed++
    } else if (!text) {
      console.log(`  ${RED}✗${RESET} ${name.padEnd(10)} 渲染出来是空的`)
      issues.push(name + ': 内容为空')
      failed++
    } else {
      console.log(`  ${GREEN}✓${RESET} ${name.padEnd(10)} ${DIM}${title}${RESET}  ${text.slice(0, 62)}…`)
    }
  }

  // --- 跨页一致性 ---------------------------------------------------------
  // 同一个业务数字在不同页面上必须一样。曾经统计页没传 status，
  // 把"待收"也算进"全年到账"，比首页多出一截 —— 单页检查发现不了。
  console.log()
  const homeReceived = /已到账分红\s*¥([\d,]+\.\d{2})/.exec(texts['首页'] || '')
  if (homeReceived) {
    const amount = homeReceived[1]
    const others = ['分红', '统计'].filter(function (name) {
      return (texts[name] || '').indexOf('¥' + amount) >= 0
    })
    if (others.length === 2) {
      console.log(`  ${GREEN}✓${RESET} 跨页一致   首页/分红/统计 的"已到账"都是 ¥${amount}`)
    } else {
      console.log(`  ${RED}✗${RESET} 跨页不一致 首页已到账 ¥${amount}，但 ${['分红', '统计']
        .filter(function (n) { return others.indexOf(n) < 0 })
        .join('、')} 上找不到这个数字`)
      issues.push('跨页数字不一致：首页已到账 ¥' + amount)
      failed++
    }
  }

  console.log()
  if (failed) {
    console.log(`${RED}${failed}/${pages.length} 个页面有问题：${RESET}\n`)
    issues.forEach(function (i) {
      console.log('  - ' + i)
    })
    process.exitCode = 1
    return
  }
  console.log(`${GREEN}全部 ${pages.length} 个页面渲染正常${RESET}`)
}

main()
