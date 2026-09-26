#!/usr/bin/env node
/**
 * 小程序单元测试入口。
 *
 *     cd miniprogram && node tests/run.js
 *
 * 覆盖的是**纯逻辑**：格式化、校验、日历网格、装饰层、网络层。
 * 页面渲染（WXML）没法在 Node 里跑，那部分靠 tests/structure.test.js 做静态校验：
 * 文件是否齐全、JSON 是否合法、WXML 里绑定的事件处理函数在 JS 里是否真的存在。
 */

const { createSuite } = require('./harness')

const FILES = ['format', 'validate', 'calendar', 'decorate', 'seq', 'security', 'api', 'pages', 'structure']

const GREEN = '\033[32m'
const RED = '\033[31m'
const DIM = '\033[2m'
const RESET = '\033[0m'

async function main() {
  let passed = 0
  const failures = []

  for (const file of FILES) {
    let suite
    try {
      suite = createSuite(file)
      require('./' + file + '.test.js')(suite)
    } catch (e) {
      failures.push({ file: file, name: '(加载测试文件)', error: e })
      console.log(`${RED}✗${RESET} ${file}.test.js 加载失败`)
      continue
    }

    process.stdout.write(`${file.padEnd(12)}`)
    for (const c of suite.cases) {
      try {
        await c.fn()
        passed++
        process.stdout.write(`${GREEN}.${RESET}`)
      } catch (e) {
        failures.push({ file: file, name: c.name, error: e })
        process.stdout.write(`${RED}F${RESET}`)
      }
    }
    console.log(`${DIM}  ${suite.cases.length}${RESET}`)
  }

  console.log()
  if (failures.length) {
    console.log(`${RED}${failures.length} 个失败：${RESET}`)
    for (const f of failures) {
      console.log(`\n  ${RED}✗${RESET} [${f.file}] ${f.name}`)
      const msg = (f.error && f.error.message) || String(f.error)
      console.log(
        msg
          .split('\n')
          .map(function (l) {
            return '      ' + l
          })
          .join('\n')
      )
    }
    console.log(`\n${RED}${passed} passed, ${failures.length} failed${RESET}`)
    process.exitCode = 1
    return
  }

  console.log(`${GREEN}${passed} passed${RESET}`)
}

main().catch(function (e) {
  console.error(e)
  process.exitCode = 1
})
