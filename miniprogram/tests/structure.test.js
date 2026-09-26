/**
 * 静态结构校验。
 *
 * 小程序的页面渲染没法在 Node 里跑，但很多低级错误其实是**静态**就能抓到的：
 *   - app.json 里声明了页面，但文件没建全
 *   - tabBar 图标路径写错 / 文件不存在
 *   - WXML 里 bindtap="save" 但 JS 里根本没有 save 方法（点击毫无反应）
 *   - WXML 标签没闭合
 *   - wx:for 少了 wx:key（小程序会 warning，列表还会复用错乱）
 *   - require 了一个不存在的模块
 *   - 模板里引用了 data 里不存在的字段（渲染出空白）
 *
 * 这些如果不检查，要等打开开发者工具点到那个按钮才发现。
 */

const fs = require('fs')
const path = require('path')
const { assert } = require('./harness')

const ROOT = path.resolve(__dirname, '..')

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

function parseJson(rel) {
  return JSON.parse(read(rel))
}

/** 极简 WXML 标签配对检查（跳过注释、自闭合、属性里的引号内容） */
function assertBalancedTags(wxml, file) {
  const stripped = wxml.replace(/<!--[\s\S]*?-->/g, '')
  const re = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  const stack = []
  let m
  while ((m = re.exec(stripped)) !== null) {
    const isClose = m[0].charAt(1) === '/'
    const tag = m[1]
    const selfClose = m[3] === '/'
    if (isClose) {
      const top = stack.pop()
      assert.strictEqual(
        top,
        tag,
        file + ' 标签不匹配：</' + tag + '> 对应的是 <' + top + '>'
      )
    } else if (!selfClose) {
      stack.push(tag)
    }
  }
  assert.strictEqual(
    stack.length,
    0,
    file + ' 有未闭合的标签：' + stack.map(function (s) { return '<' + s + '>' }).join(' ')
  )
}

/** 取出所有事件绑定：bindtap="fn" / bind:tap="fn" / catchtap="fn" */
function extractHandlers(wxml) {
  const names = []
  const re = /\b(?:bind|catch):?[a-zA-Z]+\s*=\s*"([^"]+)"/g
  let m
  while ((m = re.exec(wxml)) !== null) {
    const value = m[1].trim()
    // 跳过动态绑定（{{...}}）和空值
    if (!value || value.indexOf('{{') >= 0) continue
    names.push(value)
  }
  return names
}

/** 取出 wx:for 的 item/index 变量名，避免把它们当成 data 字段 */
function extractLoopVars(wxml) {
  const vars = ['item', 'index', 'true', 'false', 'null', 'undefined']
  const re = /wx:for-(?:item|index)\s*=\s*"([^"]+)"/g
  let m
  while ((m = re.exec(wxml)) !== null) vars.push(m[1].trim())
  return vars
}

/** 取出模板里引用的顶层标识符：{{a.b}} -> a */
function extractBindings(wxml) {
  const names = {}
  const body = wxml.replace(/<!--[\s\S]*?-->/g, '')
  const re = /\{\{([^}]*)\}\}/g
  let m
  while ((m = re.exec(body)) !== null) {
    // 先剥掉字符串字面量：'tag--muted' 里的 muted 不是 data 字段
    const expr = m[1].replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    const idRe = /(^|[^.\w'"])([a-zA-Z_$][\w$]*)/g
    let id
    while ((id = idRe.exec(expr)) !== null) {
      names[id[2]] = true
    }
  }
  return Object.keys(names)
}

/**
 * 从 openIndex 处的开括号开始，找到配对闭括号的下标。跳过字符串字面量。
 */
function matchBracket(src, openIndex, open, close) {
  let depth = 0
  let quote = null
  for (let i = openIndex; i < src.length; i++) {
    const c = src.charAt(i)
    if (quote) {
      if (c === quote && src.charAt(i - 1) !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 按顶层逗号切分函数实参（跳过括号/方括号/花括号和字符串里的逗号） */
function splitTopLevelArgs(src) {
  const parts = []
  let current = ''
  let depth = 0
  let quote = null
  for (let i = 0; i < src.length; i++) {
    const c = src.charAt(i)
    if (quote) {
      current += c
      if (c === quote && src.charAt(i - 1) !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      current += c
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    if (c === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += c
  }
  parts.push(current)
  return parts
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length
}

/**
 * 找出"作为回调传入的 function"里未绑定的 this。
 *
 * 这是小程序里最隐蔽的一类 bug：`arr.map(function (x) { return this.data.y })`
 * 里的 this 不是页面实例，而是 undefined/global —— 一旦数组非空，整个页面直接崩。
 */
function findUnboundThisCallbacks(src) {
  const problems = []
  const callbackRe = /[,(]\s*function\s*\(/g
  let m
  while ((m = callbackRe.exec(src)) !== null) {
    // 注意：JS 的 RegExp 结果是数组，用 .index，没有 Python 的 .start()
    const start = m.index
    // 正则最后一位就是那个 '('
    const parenStart = start + m[0].length - 1
    const parenEnd = matchBracket(src, parenStart, '(', ')')
    if (parenEnd < 0) continue

    const braceStart = src.indexOf('{', parenEnd)
    if (braceStart < 0) continue
    const braceEnd = matchBracket(src, braceStart, '{', '}')
    if (braceEnd < 0) continue

    const body = src.slice(braceStart, braceEnd + 1)
    const after = src.slice(braceEnd + 1, braceEnd + 20)
    if (/\bthis\./.test(body) && after.trim().indexOf('.bind(this)') !== 0) {
      problems.push('L' + lineOf(src, start) + ' ' + body.replace(/\s+/g, ' ').slice(0, 60))
    }
  }
  return problems
}

/**
 * 找出 `setData(data, this.method)` 这种没有绑定的方法引用。
 *
 * 微信官方文档**没有**规定 setData 回调里的 this 指向，
 * 所以不能依赖运行时替我们绑好；参照上面的规范，必须显式 .bind(this)。
 *
 * 这个检查是补盲区的：findUnboundThisCallbacks 的正则只匹配 `function (` 匿名函数，
 * 而 `}, this.updatePreview)` 这种"方法引用"形式完全在它视野之外。
 */
function findUnboundSetDataHandlers(src) {
  const problems = []
  const re = /\.setData\s*\(/g
  let m
  while ((m = re.exec(src)) !== null) {
    const parenStart = m.index + m[0].length - 1
    const parenEnd = matchBracket(src, parenStart, '(', ')')
    if (parenEnd < 0) continue
    const args = src.slice(parenStart + 1, parenEnd)
    const second = splitTopLevelArgs(args)[1]
    if (second && /^\s*this\s*\.\s*[\w$]+\s*$/.test(second)) {
      problems.push('L' + lineOf(src, m.index) + ' setData(data, ' + second.trim() + ') 缺少 .bind(this)')
    }
  }
  return problems
}

module.exports = function (t) {
  // --- 顶层文件 -----------------------------------------------------------

  t.test('app.json / sitemap.json / project.config.json 都是合法 JSON', function () {
    parseJson('app.json')
    parseJson('sitemap.json')
    parseJson('project.config.json')
  })

  const app = parseJson('app.json')

  t.test('app.json 至少声明了 10 个页面', function () {
    assert.ok(Array.isArray(app.pages), 'pages 必须是数组')
    assert.ok(app.pages.length >= 10, '实际 ' + app.pages.length)
  })

  t.test('每个页面的 .js / .wxml / .json / .wxss 都存在', function () {
    const missing = []
    app.pages.forEach(function (p) {
      ;['js', 'wxml', 'json', 'wxss'].forEach(function (ext) {
        if (!exists(p + '.' + ext)) missing.push(p + '.' + ext)
      })
    })
    assert.deepStrictEqual(missing, [], '缺文件：' + missing.join(', '))
  })

  t.test('每个页面的 .json 都是合法 JSON', function () {
    app.pages.forEach(function (p) {
      parseJson(p + '.json')
    })
  })

  t.test('tabBar 的图标文件都存在', function () {
    assert.ok(app.tabBar && Array.isArray(app.tabBar.list), '必须有 tabBar')
    const missing = []
    app.tabBar.list.forEach(function (item) {
      assert.ok(exists(item.iconPath), '缺图标 ' + item.iconPath)
      assert.ok(exists(item.selectedIconPath), '缺选中图标 ' + item.selectedIconPath)
      // 图标必须是 tabBar 里声明的页面之一
      assert.ok(app.pages.indexOf(item.pagePath) >= 0, item.pagePath + ' 未在 pages 中声明')
    })
    assert.deepStrictEqual(missing, [])
  })

  t.test('tabBar 图标都小于 40KB（微信的限制）', function () {
    app.tabBar.list.forEach(function (item) {
      const size = fs.statSync(path.join(ROOT, item.iconPath)).size
      assert.ok(size < 40 * 1024, item.iconPath + ' 有 ' + size + ' 字节')
    })
  })

  // --- 逐页面检查 ---------------------------------------------------------

  const pageProblems = []

  app.pages.forEach(function (page) {
    const wxml = read(page + '.wxml')
    const js = read(page + '.js')
    const label = page.split('/').slice(-2).join('/')

    // 1) 标签闭合
    try {
      assertBalancedTags(wxml, label + '.wxml')
    } catch (e) {
      pageProblems.push(e.message)
      return
    }

    // 2) 事件处理函数必须在 JS 里存在
    extractHandlers(wxml).forEach(function (fn) {
      // JS 里可能是 save() {...} 也可能是 save: function () {...}
      const pattern = new RegExp('\\b' + fn.replace(/[$]/g, '\\$') + '\\s*[:(]')
      if (!pattern.test(js)) {
        pageProblems.push(label + '.wxml 绑定了 ' + fn + '，但 ' + label + '.js 里没有这个方法')
      }
    })

    // 3) wx:for 必须有 wx:key
    const tagRe = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\/?>/g
    let m
    while ((m = tagRe.exec(wxml)) !== null) {
      const attrs = m[2]
      if (/\bwx:for\s*=/.test(attrs) && !/wx:key\s*=/.test(attrs)) {
        pageProblems.push(label + '.wxml 的 <' + m[1] + '> 有 wx:for 但缺 wx:key')
      }
    }

    // 4) 模板里引用的 data 字段必须在 JS 里出现过
    const loopVars = extractLoopVars(wxml)
    extractBindings(wxml).forEach(function (name) {
      if (loopVars.indexOf(name) >= 0) return
      if (js.indexOf(name) < 0) {
        pageProblems.push(label + '.wxml 引用了 ' + name + '，但 ' + label + '.js 里找不到')
      }
    })
  })

  t.test('所有页面的静态检查通过（标签闭合 / 事件处理函数 / wx:key / data 字段）', function () {
    assert.deepStrictEqual(pageProblems, [], '\n      - ' + pageProblems.join('\n      - '))
  })

  t.test('页面 JS 里没有"回调中的 this 未绑定"（会导致运行时崩页）', function () {
    const problems = []
    app.pages.forEach(function (page) {
      findUnboundThisCallbacks(read(page + '.js')).forEach(function (p) {
        problems.push(page + '.js ' + p)
      })
    })
    assert.deepStrictEqual(
      problems,
      [],
      '\n      回调里用 this 必须 .bind(this)，或先 const that = this\n      - ' +
        problems.join('\n      - ')
    )
  })

  t.test('setData 的数据回调不能直接传方法引用（官方未规定回调的 this）', function () {
    const problems = []
    app.pages.forEach(function (page) {
      findUnboundSetDataHandlers(read(page + '.js')).forEach(function (p) {
        problems.push(page + '.js ' + p)
      })
    })
    assert.deepStrictEqual(
      problems,
      [],
      '\n      应为 this.method.bind(this) 或闭包 that.method()\n      - ' +
        problems.join('\n      - ')
    )
  })

  // --- 模块依赖 -----------------------------------------------------------

  t.test('所有 require 的相对路径都存在', function () {
    const missing = []
    const files = []

    function walk(dir) {
      fs.readdirSync(dir).forEach(function (name) {
        const full = path.join(dir, name)
        const stat = fs.statSync(full)
        if (stat.isDirectory()) {
          if (name === 'node_modules' || name === '.git') return
          walk(full)
        } else if (name.endsWith('.js')) {
          files.push(full)
        }
      })
    }
    walk(ROOT)

    files.forEach(function (file) {
      const src = fs.readFileSync(file, 'utf8')
      const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g
      let m
      while ((m = re.exec(src)) !== null) {
        const target = path.resolve(path.dirname(file), m[1])
        if (!fs.existsSync(target) && !fs.existsSync(target + '.js')) {
          missing.push(path.relative(ROOT, file) + " -> require('" + m[1] + "')")
        }
      }
    })

    assert.deepStrictEqual(missing, [], '\n      - ' + missing.join('\n      - '))
  })

  // --- 关键契约 -----------------------------------------------------------

  t.test('api.js 里没有任何地方把 amount 塞进写请求', function () {
    const src = read('services/api.js')
    // 只允许出现 amount 作为注释/说明，不允许 `amount:` 出现在请求体构造里
    const lines = src.split('\n')
    const offenders = lines.filter(function (line) {
      return /amount\s*:/.test(line) && line.indexOf('//') < 0 && line.indexOf('*') < 0
    })
    assert.deepStrictEqual(offenders, [], '发现疑似构造 amount 的代码：' + offenders.join(' | '))
  })

  t.test('api.js 覆盖了后端所有业务模块', function () {
    const exported = require('../services/api')
    ;['auth', 'accounts', 'securities', 'holdings', 'dividends', 'dashboard', 'statistics'].forEach(
      function (key) {
        assert.ok(exported[key], 'api 缺少 ' + key)
      }
    )
  })

  t.test('config 里 dev 环境默认固定 openid（否则每次启动都是新用户）', function () {
    const config = require('../utils/config')
    if (config.env === 'dev') {
      assert.ok(config.devOpenid, 'dev 环境应该设置 devOpenid')
    }
  })

  t.test('生产配置不允许降级到 dev-login', function () {
    const src = read('utils/config.js')
    const prodBlock = src.split('prod:')[1] || ''
    assert.ok(
      /allowDevLoginFallback:\s*false/.test(prodBlock),
      'prod 必须显式关闭 dev-login 降级'
    )
    assert.ok(/devOpenid:\s*''/.test(prodBlock), 'prod 不能设置固定 openid')
  })
}
