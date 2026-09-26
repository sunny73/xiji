#!/usr/bin/env node
/**
 * uni-app 版的单元测试入口。
 *
 *     cd uniapp && npm test
 *
 * 和原生版共用同一套极简测试框架（零依赖）。这里测的是**纯逻辑**：
 * 格式化、校验、日历、装饰层、请求守卫、标的解析、网络层。
 *
 * 页面渲染没法在 Node 里测 —— 那部分靠 tests/render.mjs：
 * 用无头 Chrome 把构建出来的 H5 真跑一遍。
 */

import { createSuite } from './harness.js'

const FILES = ['format', 'validate', 'calendar', 'decorate', 'seq', 'security', 'api']

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const FRIENDLY = {
  format: '金额/日期格式化',
  validate: '表单校验',
  calendar: '日历网格',
  decorate: '展示层装饰',
  seq: '请求序号守卫',
  security: '标的输入解析',
  api: '网络层 + 401 重登',
}

async function main() {
  let passed = 0
  const failures = []

  console.log('\nuni-app 单元测试\n')

  for (const file of FILES) {
    let suite
    try {
      suite = createSuite(file)
      const mod = await import('./' + file + '.test.js')
      mod.default(suite)
    } catch (e) {
      failures.push({ file, name: '(加载测试文件)', error: e })
      console.log(`${RED}✗${RESET} ${file}.test.js 加载失败：${e.message}`)
      continue
    }

    process.stdout.write(`${file.padEnd(10)}`)
    for (const c of suite.cases) {
      try {
        await c.fn()
        passed++
        process.stdout.write(`${GREEN}.${RESET}`)
      } catch (e) {
        failures.push({ file, name: c.name, error: e })
        process.stdout.write(`${RED}F${RESET}`)
      }
    }
    console.log(`${DIM}  ${suite.cases.length}  ${FRIENDLY[file] || ''}${RESET}`)
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
          .map((l) => '      ' + l)
          .join('\n')
      )
    }
    console.log(`\n${RED}${passed} passed, ${failures.length} failed${RESET}`)
    process.exitCode = 1
    return
  }

  console.log(`${GREEN}${passed} passed${RESET}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
