/**
 * 极简测试运行器。
 *
 * 为什么不用 Jest / Mocha：
 *   本机没有可用的前端工具链（Homebrew 不可用、CLT 太旧），装 npm 包要拉一堆依赖；
 *   而小程序代码是 CommonJS + 纯逻辑，用 assert 就够了。
 *   零依赖的另一个好处是：任何人 clone 下来 `node tests/run.js` 就能跑。
 */

import * as assert from 'assert'

function deepEqual(actual, expected) {
  // assert.deepStrictEqual 对 NaN / -0 的判定更严格，这里正是我们要的
  assert.deepStrictEqual(actual, expected)
}

/**
 * 创建一个测试集合。
 * @param {string} file 文件名，用于失败时定位
 */
function createSuite(file) {
  const cases = []

  return {
    file: file,
    cases: cases,

    /** 注册一个测试；fn 可以返回 Promise */
    test(name, fn) {
      cases.push({ name: name, fn: fn })
    },

    /** 断言相等 */
    eq(actual, expected, name) {
      cases.push({
        name: name,
        fn: function () {
          deepEqual(actual, expected)
        },
      })
    },

    /** 断言为真 */
    ok(value, name) {
      cases.push({
        name: name,
        fn: function () {
          assert.ok(value, name)
        },
      })
    },

    /** 断言抛出异常，并把异常传给 inspect 做进一步校验 */
    throws(fn, name, inspect) {
      cases.push({
        name: name,
        fn: function () {
          let threw = null
          try {
            const r = fn()
            // 支持 async 函数
            if (r && typeof r.then === 'function') {
              return r.then(
                function () {
                  assert.fail('期望抛错，但正常返回了')
                },
                function (e) {
                  if (inspect) inspect(e)
                }
              )
            }
          } catch (e) {
            threw = e
          }
          assert.ok(threw, '期望抛错，但正常返回了')
          if (inspect) inspect(threw)
        },
      })
    },
  }
}

/** 构造一个 uni 全局对象的替身，供 services/ 层测试使用 */
function createUniMock(options) {
  const opts = options || {}
  const storage = Object.assign({}, opts.storage || {})
  const requests = []

  // 默认的响应路由：opts.respond(config) -> {statusCode, data}
  // 传入整个 config（而不是拆开的参数），测试里才能校验 header / method
  const respond =
    opts.respond ||
    function () {
      return { statusCode: 200, data: {} }
    }

  const uni = {
    // --- storage ---
    getStorageSync(key) {
      return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : ''
    },
    setStorageSync(key, value) {
      storage[key] = value
    },
    removeStorageSync(key) {
      delete storage[key]
    },

    // --- network ---
    request(config) {
      requests.push(config)
      const result = respond(config)
      if (result && result.__fail) {
        setTimeout(function () {
          config.fail({ errMsg: result.errMsg || 'request:fail' })
        }, 0)
      } else {
        setTimeout(function () {
          config.success({
            statusCode: result.statusCode,
            data: result.data,
            header: {},
          })
        }, 0)
      }
    },

    // --- login ---
    login(handler) {
      if (opts.loginFails) {
        setTimeout(function () {
          handler.fail({ errMsg: 'login:fail mock' })
        }, 0)
      } else {
        setTimeout(function () {
          handler.success({ code: opts.loginCode || 'mock-code-123' })
        }, 0)
      }
    },

    // --- UI（测试里只要不炸就行） ---
    showToast() {},
    showLoading() {},
    hideLoading() {},
    showModal() {},
    showActionSheet() {},
    stopPullDownRefresh() {},
    setNavigationBarTitle() {},
    navigateTo() {},
    switchTab() {},
    navigateBack() {},
    reLaunch() {},
    redirectTo() {},
  }

  return { uni: uni, storage: storage, requests: requests }
}

/** 临时把 uni 挂到 global，跑完恢复 */
function withUni(mock, fn) {
  const previous = global.uni
  global.uni = mock
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      return result.then(
        function (v) {
          global.uni = previous
          return v
        },
        function (e) {
          global.uni = previous
          throw e
        }
      )
    }
    global.uni = previous
    return result
  } catch (e) {
    global.uni = previous
    throw e
  }
}

export { createSuite, createUniMock, withUni, assert }
