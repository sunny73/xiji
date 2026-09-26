/**
 * 表单校验。纯函数，Node 里可直接测。
 *
 * 前端校验**不是**为了替代后端校验，只是为了让用户不用等一次网络往返才知道
 * "股数没填"。后端仍然是唯一权威（金额计算、业务规则都在那边）。
 */

/**
 * 解析一个金额/数量输入。
 * @param {string|number} input
 * @param {object} [opts]
 * @param {string} [opts.label]     字段名，用于拼错误文案
 * @param {boolean} [opts.optional] 允许为空
 * @param {number} [opts.min]       最小值（含）
 * @param {number} [opts.decimals]  最多几位小数
 * @returns {{ok: boolean, value?: number|null, message?: string}}
 */
function parseAmount(input, opts) {
  const o = opts || {}
  const label = o.label || '数值'
  const raw = String(input === null || input === undefined ? '' : input).trim()

  if (raw === '') {
    if (o.optional) return { ok: true, value: null }
    return { ok: false, message: '请填写' + label }
  }

  // 刻意不用 Number() 直接转：它会把 "1e3"、" 12 "、"0x10" 都当合法输入
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return { ok: false, message: label + '只能是数字' }
  }

  const n = Number(raw)
  if (!isFinite(n)) {
    return { ok: false, message: label + '格式不正确' }
  }

  if (o.min !== undefined && n < o.min) {
    // 股数填 0 时说"必须大于 0"比"不能小于 0.0001"好懂得多
    const msg = n === 0 && o.min > 0 ? label + '必须大于 0' : label + '不能小于 ' + o.min
    return { ok: false, message: msg }
  }
  if (o.max !== undefined && n > o.max) {
    return { ok: false, message: label + '超出允许范围' }
  }

  if (o.decimals !== undefined) {
    const dot = raw.indexOf('.')
    if (dot >= 0 && raw.length - dot - 1 > o.decimals) {
      return { ok: false, message: label + '最多 ' + o.decimals + ' 位小数' }
    }
  }

  return { ok: true, value: n }
}

/** 必填文本 */
function requiredText(input, label) {
  const raw = String(input === null || input === undefined ? '' : input).trim()
  if (!raw) return { ok: false, message: '请填写' + (label || '内容') }
  return { ok: true, value: raw }
}

/** 证券代码：字母数字，长度 1-30（和后端 VARCHAR(30) 对齐） */
function securityCode(input) {
  const raw = String(input === null || input === undefined ? '' : input).trim()
  if (!raw) return { ok: false, message: '请填写标的代码' }
  if (raw.length > 30) return { ok: false, message: '标的代码太长了' }
  if (!/^[A-Za-z0-9.\-]+$/.test(raw)) {
    return { ok: false, message: '标的代码只能包含字母、数字、. 或 -' }
  }
  return { ok: true, value: raw.toUpperCase() }
}

/** "YYYY-MM-DD" 日期 */
function dateString(input, label) {
  const raw = String(input === null || input === undefined ? '' : input).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, message: '请选择' + (label || '日期') }
  }
  const parts = raw.split('-').map(Number)
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  // 排除 2026-02-31 这种"格式对但日期不存在"的输入
  if (
    d.getUTCFullYear() !== parts[0] ||
    d.getUTCMonth() !== parts[1] - 1 ||
    d.getUTCDate() !== parts[2]
  ) {
    return { ok: false, message: '日期不存在' }
  }
  return { ok: true, value: raw }
}

/** 依次校验，返回第一个错误；全部通过则返回 null */
function firstError(results) {
  for (let i = 0; i < results.length; i++) {
    if (results[i] && !results[i].ok) return results[i].message
  }
  return null
}

module.exports = {
  parseAmount,
  requiredText,
  securityCode,
  dateString,
  firstError,
}
