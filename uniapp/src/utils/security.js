/**
 * 标的（security）输入解析。
 *
 * 为什么值得单独抽一个模块：
 *   表单里有两种状态——"用户输入了代码" 和 "我们缓存了一个查询结果"。
 *   只要这两者可能不一致，就必须有一个**唯一**的地方来决定信谁。
 *   否则就会出现：用户把 601988 改成 601857，代码却没把缓存的 security 清掉，
 *   最后把持仓/分红记到了 601988 上（而且用户几乎不可能发现）。
 */

/** 代码比较：忽略大小写和首尾空格，避免 ' aapl ' 和 'AAPL' 被当成两个 */
function normalizeCode(code) {
  return String(code === null || code === undefined ? '' : code)
    .trim()
    .toUpperCase()
}

/**
 * 缓存的 security 能否复用于当前代码。
 *
 * **必须同时校验 code**：缓存来自上一次查询，用户完全可能已经改了输入框。
 *
 * @param {object|null} cached 上一次查询到的 security，形如 {id, code, name}
 * @param {string} code 当前输入框里的代码
 * @returns {boolean}
 */
function canReuseSecurity(cached, code) {
  if (!cached || !cached.id || !cached.code) return false
  const want = normalizeCode(code)
  if (!want) return false
  return normalizeCode(cached.code) === want
}

/**
 * 决定提交时用哪个 security。
 *
 * @returns {{security: object|null, needsCreate: boolean}}
 *   security 非空 → 直接复用；needsCreate 为 true → 需要调 POST /securities
 */
function resolveSecurity(cached, code) {
  if (canReuseSecurity(cached, code)) {
    return { security: cached, needsCreate: false }
  }
  return { security: null, needsCreate: true }
}

export {
  normalizeCode,
  canReuseSecurity,
  resolveSecurity,
}
