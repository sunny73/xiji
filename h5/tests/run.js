#!/usr/bin/env node
/**
 * H5 预览运行时的单元测试。
 *
 *     cd h5 && node tests/run.js
 *
 * 零依赖，和 miniprogram/tests/run.js 共用同一套极简测试框架
 * （harness 是开发工具，跨目录引用比复制一份好）。
 *
 * 只测**纯函数**部分：表达式求值、WXSS 转换、WXML 解析与渲染成 HTML。
 * 需要真实 DOM 的部分（事件委托、焦点恢复、选择器弹层）跑不了 Node，
 * 靠 h5/tests/smoke.js 在浏览器里自检。
 */

const { createSuite } = require('../../miniprogram/tests/harness')

const FILES = ['units', 'expr', 'wxml']

const GREEN = '\033[32m'
const RED = '\033[31m'
const DIM = '\033[2m'
const RESET = '\033[0m'

async function main() {
  let passed = 0
  const failures = []

  console.log('\nH5 预览运行时测试\n')

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

    process.stdout.write(`${file.padEnd(10)}`)
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
