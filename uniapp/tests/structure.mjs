#!/usr/bin/env node
/**
 * 静态结构校验（uni-app 版）。
 *
 *     cd uniapp && node tests/structure.mjs
 *
 * 小程序渲染没法在 Node 里跑，但很多低级错误是静态就能抓的。
 * 这个脚本检查的是 uni-app 特有的坑 + 从原生版继承下来的几条硬规则。
 *
 * 说明：**跨平台构建产物**的检查也在这里（build:mp-weixin 之后跑）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const problems = []
const checks = []

function check(name, fn) {
  try {
    const detail = fn()
    checks.push({ name, ok: true, detail })
  } catch (e) {
    checks.push({ name, ok: false, detail: e.message })
    problems.push(name + '：' + e.message)
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}
function readJson(rel) {
  return JSON.parse(read(rel))
}
function walk(dir, out = []) {
  const abs = path.join(SRC, dir)
  if (!fs.existsSync(abs)) return out
  for (const name of fs.readdirSync(abs)) {
    const rel = path.posix.join(dir, name)
    if (fs.statSync(path.join(SRC, rel)).isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

const pagesJson = readJson('src/pages.json')

// ---------------------------------------------------------------------------
// 页面与配置
// ---------------------------------------------------------------------------

check('pages.json 是合法 JSON 且声明了 10 个页面', () => {
  if (!Array.isArray(pagesJson.pages)) throw new Error('pages 不是数组')
  if (pagesJson.pages.length !== 10) throw new Error('实际 ' + pagesJson.pages.length + ' 个')
  return pagesJson.pages.length + ' 个'
})

check('每个页面的 .vue 文件都存在', () => {
  const missing = pagesJson.pages
    .map((p) => 'src/' + p.path + '.vue')
    .filter((f) => !exists(f))
  if (missing.length) throw new Error('缺文件：' + missing.join(', '))
  return pagesJson.pages.length + ' 个'
})

check('每个页面都有 template 和 script setup', () => {
  const bad = []
  pagesJson.pages.forEach((p) => {
    const src = read('src/' + p.path + '.vue')
    if (!src.includes('<template>')) bad.push(p.path + ' 缺 <template>')
    if (!src.includes('<script setup>')) bad.push(p.path + ' 缺 <script setup>')
  })
  if (bad.length) throw new Error(bad.join('；'))
  return 'OK'
})

check('tabBar 的图标文件都存在（在 src/static 下）', () => {
  const list = (pagesJson.tabBar && pagesJson.tabBar.list) || []
  if (list.length !== 5) throw new Error('tabBar 应有 5 项，实际 ' + list.length)
  const missing = []
  list.forEach((item) => {
    ;[item.iconPath, item.selectedIconPath].forEach((p) => {
      if (!p) return
      if (!exists('src/' + p)) missing.push(p)
    })
    if (!pagesJson.pages.some((pg) => pg.path === item.pagePath)) {
      missing.push(item.pagePath + ' 未在 pages 中声明')
    }
  })
  if (missing.length) throw new Error('问题：' + missing.join(', '))
  return list.length + ' 项'
})

check('tabBar 图标都小于 40KB（微信限制）', () => {
  const list = pagesJson.tabBar.list
  const big = []
  list.forEach((item) => {
    const size = fs.statSync(path.join(SRC, item.iconPath)).size
    if (size >= 40 * 1024) big.push(item.iconPath + ' ' + size + 'B')
  })
  if (big.length) throw new Error(big.join(', '))
  return 'OK'
})

// ---------------------------------------------------------------------------
// 代码规则（这几条是从原生版继承下来的硬规则）
// ---------------------------------------------------------------------------

const srcJs = walk('utils').concat(walk('services'))
const allSrc = walk('.')

check('没有残留的小程序 API（应该用 uni.*）', () => {
  const bad = []
  for (const rel of allSrc) {
    if (!rel.endsWith('.js') && !rel.endsWith('.vue')) continue
    // 先把注释整段去掉再找 —— 文档里会写"原版用 wx.showActionSheet"这种对比说明，
    // 那是注释不是调用，不该被算成问题
    const src = read('src/' + rel)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    src.split('\n').forEach((line, i) => {
      if (/\bwx\.[a-zA-Z]/.test(line)) bad.push(rel + ':' + (i + 1))
    })
  }
  if (bad.length) throw new Error('发现 ' + bad.join(', '))
  return 'OK'
})

check('页面脚本里不用 this（组合式 API 不应该有 this）', () => {
  const bad = []
  pagesJson.pages.forEach((p) => {
    const src = read('src/' + p.path + '.vue')
    const script = src.slice(src.indexOf('<script setup>'))
    script.split('\n').forEach((line, i) => {
      const code = line.split('//')[0]
      if (/\bthis\s*\./.test(code)) bad.push(p.path + ' 第' + (i + 1) + '行')
    })
  })
  if (bad.length) throw new Error(bad.join('；'))
  return 'OK'
})

check('api.js 里没有构造 amount（金额只能后端算）', () => {
  const src = read('src/services/api.js')
  const offenders = src
    .split('\n')
    .filter((line) => /amount\s*:/.test(line) && line.indexOf('//') < 0 && line.indexOf('*') < 0)
  if (offenders.length) throw new Error(offenders.join(' | '))
  return 'OK'
})

check('services 层覆盖了后端所有业务模块', () => {
  const src = read('src/services/api.js')
  const names = ['authApi', 'accountApi', 'securityApi', 'holdingApi', 'dividendApi', 'dashboardApi', 'statisticsApi']
  const missing = names.filter((n) => !src.includes(n))
  if (missing.length) throw new Error('缺 ' + missing.join(', '))
  return names.length + ' 个'
})

// ---------------------------------------------------------------------------
// 生产配置安全（这两条错了会导致上线后登录不了 / 被伪造登录）
// ---------------------------------------------------------------------------

check('config.js 里生产环境不允许微信登录降级', () => {
  const src = read('src/utils/config.js')
  if (!/allowDevLoginFallback:\s*ENV\s*!==\s*'prod'/.test(src)) {
    throw new Error('allowDevLoginFallback 必须跟 ENV 绑定')
  }
  if (!/devOpenid:\s*ENV\s*===\s*'prod'\s*\?\s*''/.test(src)) {
    throw new Error('生产环境的 devOpenid 必须为空')
  }
  return 'OK'
})

check('vite 依赖版本与 @dcloudio/vite-plugin-uni 的 peerDependencies 匹配', () => {
  const pkg = readJson('package.json')
  const vite = pkg.devDependencies.vite
  if (vite !== '5.2.8') throw new Error('vite 必须是 5.2.8（peer 依赖是精确版本），实际 ' + vite)
  const dcloud = pkg.dependencies['@dcloudio/uni-app']
  const allSame = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter(([k]) => k.startsWith('@dcloudio/'))
    .every(([, v]) => v === dcloud)
  if (!allSame) throw new Error('所有 @dcloudio/* 必须是同一个版本')
  return 'vite ' + vite
})

// ---------------------------------------------------------------------------
// 构建产物（只在已经 build 过的时候检查）
// ---------------------------------------------------------------------------

const MP_DIST = 'dist/build/mp-weixin'
if (fs.existsSync(path.join(ROOT, MP_DIST))) {
  check('小程序产物：app.json 的页面数与 pages.json 一致', () => {
    const appJson = JSON.parse(read(MP_DIST + '/app.json'))
    if (appJson.pages.length !== pagesJson.pages.length) {
      throw new Error('产物 ' + appJson.pages.length + ' vs 源 ' + pagesJson.pages.length)
    }
    return appJson.pages.length + ' 个'
  })

  check('小程序产物：每个页面都有 wxml/js/json', () => {
    const missing = []
    pagesJson.pages.forEach((p) => {
      ;['wxml', 'js', 'json'].forEach((ext) => {
        if (!exists(MP_DIST + '/' + p.path + '.' + ext)) missing.push(p.path + '.' + ext)
      })
    })
    if (missing.length) throw new Error('缺 ' + missing.join(', '))
    return 'OK'
  })

  check('小程序产物：tabBar 图标被打包进去', () => {
    const missing = pagesJson.tabBar.list
      .map((i) => MP_DIST + '/static/tabbar/' + path.basename(i.iconPath))
      .filter((f) => !exists(f))
    if (missing.length) throw new Error('缺 ' + missing.join(', '))
    return 'OK'
  })

  check('★ 小程序产物的接口地址是开发期可达的（不是占位域名）', () => {
    // 曾经踩过：#ifdef H5 在 MP-WEIXIN 构建时被裁掉，devBase 保持成了
    // https://api.example.com —— 模拟器一打开就"连不上后端"，而且不报编译错。
    const appJs = read(MP_DIST + '/utils/config.js')
    const m = /baseUrl:\s*"([^"]+)"/.exec(appJs)
    if (!m) throw new Error('产物里找不到 baseUrl')
    const url = m[1]
    if (url.includes('api.example.com')) {
      throw new Error('还是占位域名 ' + url + '，小程序会连不上后端')
    }
    if (!/^https?:\/\//.test(url)) {
      throw new Error('小程序端必须是完整地址（不能是相对路径）：' + url)
    }
    return url
  })

  check('小程序产物：不含 vite / vue 的开发期代码', () => {
    const appJs = read(MP_DIST + '/common/vendor.js')
    if (appJs.includes('sourceMappingURL=data:')) throw new Error('产物里有内联 sourcemap')
    return 'OK'
  })
}

// ---------------------------------------------------------------------------

console.log('\nuni-app 静态结构校验\n')
for (const c of checks) {
  const mark = c.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`
  console.log(`  ${mark} ${c.name.padEnd(46)} ${DIM}${c.detail}${RESET}`)
}

console.log()
if (problems.length) {
  console.log(`${RED}${problems.length} 项不通过${RESET}`)
  process.exitCode = 1
} else {
  console.log(`${GREEN}${checks.length} 项全部通过${RESET}`)
}
