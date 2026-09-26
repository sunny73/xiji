#!/usr/bin/env node
/**
 * 逐页渲染验证（uni-app H5 构建产物）。
 *
 *     cd uniapp && npm run build:h5 && node scripts/serve.js &
 *     node tests/render.mjs
 *
 * 用无头 Chrome 真的把每个页面跑起来（执行 Vue、发真实请求、拿真实数据渲染），
 * 然后检查：
 *   1. 页面有没有渲染出内容（空白 = 某个环节炸了）
 *   2. 有没有 undefined / NaN / [object Object] / "0 股 × 0" 这类脏数据
 *   3. 跨页数字是否一致（首页/分红/统计的"已到账"必须是同一个值）
 *
 * 这一层在原生版抓到过 3 个真 bug，所以照搬过来。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
]

const BASE = process.env.DM_PREVIEW_URL || 'http://127.0.0.1:5174'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

/** 渲染出来但明显不对的内容 */
const SUSPICIOUS = [
  { re: /undefined/, why: '渲染出了 undefined（字段没拿到）' },
  { re: /\bNaN\b/, why: '渲染出了 NaN（数值计算失败）' },
  { re: /\[object Object\]/, why: '把对象直接插进模板了' },
  { re: /\b0 股 × 0\b/, why: '股数/每股金额没取到（接口漏字段？）' },
  { re: /加载失败/, why: '页面报错了' },
]

function findChrome() {
  return CHROME_CANDIDATES.find((p) => fs.existsSync(p)) || null
}

function dumpDom(chrome, url) {
  return execFileSync(
    chrome,
    ['--headless', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=9000', '--dump-dom', url],
    { maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  )
}

/** uni-app H5 把页面渲染在 <uni-page-body> 里 */
function extractBodyText(dom) {
  const m = /<uni-page-body[^>]*>([\s\S]*?)<\/uni-page-body>/.exec(dom)
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

function curl(args) {
  return JSON.parse(execFileSync('curl', ['-s', '--noproxy', '*', ...args], { encoding: 'utf8' }))
}

function main() {
  const chrome = findChrome()
  if (!chrome) {
    console.error(`${RED}找不到 Chrome 系浏览器，无法做无头渲染验证${RESET}`)
    process.exitCode = 2
    return
  }

  // 详情页要真实 id
  let sample = {}
  try {
    const login = curl([
      '-X', 'POST', '-H', 'Content-Type: application/json',
      '-d', '{"openid":"dev-local-user"}',
      BASE + '/api/v1/auth/dev-login',
    ])
    const auth = ['-H', 'Authorization: Bearer ' + login.access_token]
    const holdings = curl(auth.concat([BASE + '/api/v1/holdings']))
    const dividends = curl(auth.concat([BASE + '/api/v1/dividends?page_size=1']))
    sample.holdingId = holdings[0] && holdings[0].id
    sample.dividendId = dividends.items[0] && dividends.items[0].id
  } catch (e) {
    console.error(`${RED}拿不到演示数据，先确认后端在跑且已 seed_demo.py${RESET}`)
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

  console.log(`\nuni-app 逐页渲染验证（无头 Chrome）\n  ${DIM}${BASE}${RESET}\n`)

  let failed = 0
  const issues = []
  const texts = {}

  for (const [name, route] of pages) {
    // uni-app H5 默认 hash 路由
    const url = BASE + '/#/' + route.replace(/^\//, '')
    let dom
    try {
      dom = dumpDom(chrome, url)
    } catch (e) {
      console.log(`  ${RED}✗${RESET} ${name.padEnd(10)} 无头渲染进程失败`)
      issues.push(name + ': 无头渲染失败')
      failed++
      continue
    }

    const text = extractBodyText(dom)
    texts[name] = text

    if (text === null) {
      console.log(`  ${RED}✗${RESET} ${name.padEnd(10)} 页面主体没渲染出来`)
      issues.push(name + ': 主体为空')
      failed++
      continue
    }

    const hits = SUSPICIOUS.filter((s) => s.re.test(text)).map((s) => s.why)

    if (hits.length) {
      console.log(`  ${RED}✗${RESET} ${name.padEnd(10)} ${hits.join('；')}`)
      issues.push(name + ': ' + hits.join('；') + '\n        ' + text.slice(0, 160))
      failed++
    } else if (!text) {
      console.log(`  ${RED}✗${RESET} ${name.padEnd(10)} 渲染出来是空的`)
      issues.push(name + ': 内容为空')
      failed++
    } else {
      console.log(`  ${GREEN}✓${RESET} ${name.padEnd(10)} ${DIM}${text.slice(0, 68)}…${RESET}`)
    }
  }

  // --- 跨页一致性 ---------------------------------------------------------
  console.log()
  const homeReceived = /已到账分红\s*¥([\d,]+\.\d{2})/.exec(texts['首页'] || '')
  if (homeReceived) {
    const amount = homeReceived[1]
    const missing = ['分红', '统计'].filter((n) => (texts[n] || '').indexOf('¥' + amount) < 0)
    if (!missing.length) {
      console.log(`  ${GREEN}✓${RESET} 跨页一致   首页/分红/统计 的"已到账"都是 ¥${amount}`)
    } else {
      console.log(`  ${RED}✗${RESET} 跨页不一致 首页已到账 ¥${amount}，但 ${missing.join('、')} 上找不到`)
      issues.push('跨页数字不一致：首页已到账 ¥' + amount)
      failed++
    }
  }

  console.log()
  if (failed) {
    console.log(`${RED}${failed} 个页面有问题：${RESET}\n`)
    issues.forEach((i) => console.log('  - ' + i))
    process.exitCode = 1
    return
  }
  console.log(`${GREEN}全部 ${pages.length} 个页面渲染正常${RESET}`)
}

main()
