#!/usr/bin/env node
/**
 * 把小程序打包成浏览器可运行的 bundle。
 *
 *     cd h5 && node build.js
 *     → h5/dist/bundle.js   （小程序逻辑 + WXML 模板 + 页面配置）
 *     → h5/dist/app.css     （转换后的 WXSS）
 *
 * 做四件事：
 *   1. 所有 .js 包成 CommonJS 模块，require 的相对路径**在构建期**解析成绝对 id
 *   2. WXML 原样内嵌（运行时用 runtime/wxml.js 编译）
 *   3. WXSS 转换：rpx→px、page 选择器→.wx-page
 *   4. 校验 WXML 只用了预览支持的语法子集，超了就报错退出
 *
 * 第 4 条很重要：预览是"用另一套渲染器解释同一份模板"，
 * 如果不检查，某个页面用了新语法就会在预览里静默渲染成空白，
 * 而真机上却是好的——那种 bug 最难查。
 */

const fs = require('fs')
const path = require('path')

const MP_ROOT = path.resolve(__dirname, '..', 'miniprogram')
const RT_ROOT = path.resolve(__dirname, 'runtime')
const DIST = path.resolve(__dirname, 'dist')

// 预览运行时也一起打进 bundle（浏览器里没有 CommonJS，所以统一走 __require）。
// 顺序有意义：boot 最后执行，它负责装全局再启动路由。
const RUNTIME_FILES = [
  'expr.js', 'units.js', 'wxml.js', 'ui.js', 'wx-shim.js', 'router.js', 'boot.js',
]

// 预览运行时的能力边界（和 runtime/wxml.js 保持一致）
const SUPPORTED_TAGS = new Set([
  'view', 'text', 'block', 'input', 'picker', 'scroll-view', 'image', 'button', 'navigator',
])
const SUPPORTED_DIRECTIVES = new Set([
  'wx:if', 'wx:elif', 'wx:else', 'wx:for', 'wx:for-item', 'wx:for-index', 'wx:key',
])
const SUPPORTED_EVENTS = new Set(['tap', 'input', 'change', 'blur', 'confirm', 'focus'])

const RED = '\033[31m'
const YELLOW = '\033[33m'
const GREEN = '\033[32m'
const DIM = '\033[2m'
const RESET = '\033[0m'

function read(rel) {
  return fs.readFileSync(path.join(MP_ROOT, rel), 'utf8')
}

function exists(rel) {
  return fs.existsSync(path.join(MP_ROOT, rel))
}

function readRuntime(name) {
  return fs.readFileSync(path.join(RT_ROOT, name), 'utf8')
}

/** 递归收集某个目录下的所有 .js（相对 miniprogram 的路径） */
function collectJs(dir, out) {
  const abs = path.join(MP_ROOT, dir)
  if (!fs.existsSync(abs)) return out
  for (const name of fs.readdirSync(abs)) {
    const rel = path.posix.join(dir, name)
    const stat = fs.statSync(path.join(MP_ROOT, rel))
    if (stat.isDirectory()) collectJs(rel, out)
    else if (name.endsWith('.js')) out.push(rel)
  }
  return out
}

/** 把一个模块的 require('./x') 改写成 __require('绝对id') */
function rewriteRequires(source, moduleId) {
  const dir = path.posix.dirname(moduleId)
  return source.replace(/require\(\s*(['"])(\.[^'"]+)\1\s*\)/g, function (whole, quote, spec) {
    let target = path.posix.normalize(path.posix.join(dir, spec))
    if (!target.endsWith('.js')) target += '.js'
    return '__require(' + JSON.stringify(target) + ')'
  })
}

// ---------------------------------------------------------------------------
// WXML 语法校验
// ---------------------------------------------------------------------------

function validateWxml(source, label) {
  const problems = []
  const stripped = source.replace(/<!--[\s\S]*?-->/g, '')

  // 标签
  const tagRe = /<\/?([a-zA-Z][\w-]*)/g
  let m
  while ((m = tagRe.exec(stripped)) !== null) {
    if (!SUPPORTED_TAGS.has(m[1])) {
      problems.push('不支持的标签 <' + m[1] + '>')
    }
  }

  // 指令
  const dirRe = /\s(wx:[\w-]+)\s*=/g
  while ((m = dirRe.exec(stripped)) !== null) {
    if (!SUPPORTED_DIRECTIVES.has(m[1])) {
      problems.push('不支持的指令 ' + m[1])
    }
  }

  // 事件
  const evRe = /\s(bind|catch):?([a-zA-Z]+)\s*=/g
  while ((m = evRe.exec(stripped)) !== null) {
    if (!SUPPORTED_EVENTS.has(m[2].toLowerCase())) {
      problems.push('不支持的事件 bind/catch' + m[2])
    }
  }

  if (problems.length) {
    const uniq = Array.from(new Set(problems))
    throw new Error(
      label + ' 用到了 H5 预览渲染器不支持的语法：\n    - ' + uniq.join('\n    - ') +
      '\n  要么在 h5/runtime/wxml.js 里补上支持，要么改模板。'
    )
  }
}

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

function build() {
  const appJson = JSON.parse(read('app.json'))
  const modules = {}
  const wxmlSources = {}
  const pageConfigs = {}
  const pageWxss = {}

  // --- JS 模块 -----------------------------------------------------------
  const jsFiles = ['app.js']
  collectJs('services', jsFiles)
  collectJs('utils', jsFiles)
  collectJs('pages', jsFiles)

  for (const rel of jsFiles) {
    if (!exists(rel)) continue
    const src = read(rel)
    modules[rel] = rewriteRequires(src, rel)
  }

  // --- 预览运行时 ---------------------------------------------------------
  for (const name of RUNTIME_FILES) {
    const id = 'runtime/' + name
    modules[id] = rewriteRequires(readRuntime(name), id)
  }

  // --- 页面 --------------------------------------------------------------
  for (const page of appJson.pages) {
    const wxmlRel = page + '.wxml'
    const jsonRel = page + '.json'
    const wxssRel = page + '.wxss'

    if (!exists(wxmlRel)) throw new Error('缺少 ' + wxmlRel)
    const wxmlSource = read(wxmlRel)
    validateWxml(wxmlSource, wxmlRel)
    wxmlSources[page] = wxmlSource

    pageConfigs[page] = exists(jsonRel) ? JSON.parse(read(jsonRel)) : {}
    pageWxss[page] = exists(wxssRel) ? read(wxssRel) : ''
  }

  // --- 样式 --------------------------------------------------------------
  const units = require('./runtime/units')
  const cssParts = ['/* app.wxss */', units.transformWxss(read('app.wxss'))]
  for (const page of appJson.pages) {
    if (!pageWxss[page]) continue
    cssParts.push('\n/* ' + page + '.wxss */')
    cssParts.push(units.transformWxss(pageWxss[page]))
  }

  // --- 输出 --------------------------------------------------------------
  fs.mkdirSync(DIST, { recursive: true })

  const bundle =
    '/* 由 h5/build.js 生成，请勿手改。源文件在 miniprogram/ */\n' +
    'window.__DM_BUNDLE__ = {\n' +
    '  appConfig: ' + JSON.stringify(appJson) + ',\n' +
    '  pageConfigs: ' + JSON.stringify(pageConfigs) + ',\n' +
    '  wxml: ' + JSON.stringify(wxmlSources) + ',\n' +
    '  modules: {\n' +
    Object.keys(modules)
      .map(function (id) {
        return '    ' + JSON.stringify(id) + ': function (module, exports, __require) {\n' +
          modules[id] + '\n    }'
      })
      .join(',\n') +
    '\n  }\n};\n' +
    fs.readFileSync(path.join(RT_ROOT, 'loader.js'), 'utf8')


  // 自检：拼字符串很容易漏掉一个闭合括号，那种 bug 只有到浏览器里才炸。
  // 这里先用 vm.Script 过一遍语法，构建期就能拦住。
  try {
    new (require('vm').Script)(bundle, { filename: 'bundle.js' })
  } catch (e) {
    throw new Error('生成的 bundle 语法错误：' + e.message + '\n  （多半是 build.js 拼串时漏了括号）')
  }

  fs.writeFileSync(path.join(DIST, 'bundle.js'), bundle)
  fs.writeFileSync(path.join(DIST, 'app.css'), cssParts.join('\n'))

  const kb = function (f) {
    return (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(1) + ' KB'
  }

  console.log(`${GREEN}✓${RESET} 打包完成`)
  console.log(`  ${DIM}模块${RESET}     ${Object.keys(modules).length} 个（小程序 ${jsFiles.length} + 运行时 ${RUNTIME_FILES.length}）+ loader`)
  console.log(`  ${DIM}页面${RESET}     ${appJson.pages.length} 个（WXML 语法校验通过）`)
  console.log(`  ${DIM}样式${RESET}     app.wxss + ${appJson.pages.length} 个页面 wxss`)
  console.log(`  ${DIM}产物${RESET}     dist/bundle.js ${kb('bundle.js')}   dist/app.css ${kb('app.css')}`)
}

try {
  build()
} catch (e) {
  console.error(`${RED}✗ 打包失败${RESET}\n`)
  console.error('  ' + String(e.message).split('\n').join('\n  '))
  process.exitCode = 1
}
