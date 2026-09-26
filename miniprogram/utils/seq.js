/**
 * 请求序号守卫，用来丢弃"过期"的异步响应。
 *
 * 场景：用户快速连点日历的上一月箭头。两个请求都发出去了，但**后发的可能先回来**，
 * 于是界面显示的是上上个月的数据配着上个月的标题。网络越慢越容易出现。
 *
 * 用法：
 *     const guard = createGuard()
 *     const token = guard.next()
 *     fetch().then((data) => {
 *       if (!guard.isCurrent(token)) return   // 已经有更新的请求了，丢弃
 *       this.setData(...)
 *     })
 */

function createGuard() {
  let latest = 0
  return {
    /** 开始一次新请求，返回它的序号 */
    next() {
      latest += 1
      return latest
    },
    /** 这个序号是否仍是最新的 */
    isCurrent(token) {
      return token === latest
    },
    /** 让所有在途请求失效（例如页面卸载时） */
    invalidate() {
      latest += 1
    },
  }
}

module.exports = { createGuard }
