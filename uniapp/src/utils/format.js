/**
 * 格式化工具。全是纯函数，方便直接用 Node 跑测试（见 tests/format.test.js）。
 *
 * 金额一律从后端拿到的就是 number（后端已经把 Decimal 序列化成 number 了），
 * 所以这里只负责显示，不做任何业务计算。
 */

/** 转成有限数字，非法值一律当 0 —— 页面里不想到处写 `|| 0` */
function toNumber(value) {
  const n = typeof value === 'number' ? value : parseFloat(value)
  return isFinite(n) ? n : 0
}

/** 千分位。手写而不用 toLocaleString：小程序 JS 核心对这个 API 的支持不一致 */
function thousands(intStr) {
  return String(intStr).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 金额格式化。
 * @param {number|string} value
 * @param {object} [opts]
 * @param {number} [opts.decimals=2] 小数位
 * @param {boolean} [opts.sign=false] 正数是否显示 + 号
 * @param {boolean} [opts.trimZero=false] 整数时省略小数部分（1900.00 -> 1,900）
 * @param {boolean} [opts.trimTrailing=false] 去掉小数末尾的 0（0.1900 -> 0.19）
 *
 * trimZero 和 trimTrailing 是两个不同的诉求，所以分开：
 *   - 金额用 trimZero：1900.00 显示成 1,900，但 1900.50 仍然保留两位（钱的习惯写法）
 *   - 单价/股数用 trimTrailing：0.1900 显示成 0.19，4.1200 显示成 4.12
 */
function money(value, opts) {
  const o = opts || {}
  const decimals = o.decimals === undefined ? 2 : o.decimals
  const sign = o.sign ? (toNumber(value) > 0 ? '+' : '') : ''
  const fixed = Math.abs(toNumber(value)).toFixed(decimals)
  const parts = fixed.split('.')
  let out = thousands(parts[0])
  let frac = parts[1] || ''

  if (o.trimTrailing) {
    frac = frac.replace(/0+$/, '')
  } else if (o.trimZero && /^0+$/.test(frac)) {
    frac = ''
  }

  if (frac) out += '.' + frac
  return (toNumber(value) < 0 ? '-' : sign) + out
}

/** 金额（自动省略无意义的小数）：1234.00 -> 1,234；1234.56 -> 1,234.56 */
function moneyShort(value) {
  return money(value, { trimZero: true })
}

/** 大额压缩显示：12800 -> 1.28万；用在卡片里的次要位置 */
function moneyCompact(value) {
  const n = toNumber(value)
  const abs = Math.abs(n)
  if (abs >= 10000) {
    const sign = n < 0 ? '-' : ''
    return sign + (abs / 10000).toFixed(2).replace(/\.?0+$/, '') + '万'
  }
  return moneyShort(n)
}

/** 单价 / 股数：去掉末尾无意义的 0（0.1900 -> 0.19，4.1200 -> 4.12） */
function numberTrim(value, decimals) {
  return money(value, { decimals: decimals === undefined ? 4 : decimals, trimTrailing: true })
}

/** 百分比显示，入参是 0~1 的比例 */
function percent(value, decimals) {
  const d = decimals === undefined ? 1 : decimals
  return (toNumber(value) * 100).toFixed(d) + '%'
}

/**
 * 解析 "YYYY-MM-DD"。
 * 刻意不用 new Date(str)：那会按 UTC 解析，在东八区之外的机器上会差一天。
 */
function parseDate(value) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value == null ? '' : value))
  if (!m) return null
  return { year: +m[1], month: +m[2], day: +m[3] }
}

/** 今天（本地时区）的 {year, month, day} */
function today(todayDate) {
  const d = todayDate || new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

/** "2026-09-20" -> "9月20日"；跨年时带上年份 */
function dateCN(value, opts) {
  const p = parseDate(value)
  if (!p) return ''
  const o = opts || {}
  const t = today()
  const withYear = o.withYear === undefined ? p.year !== t.year : o.withYear
  const base = p.month + '月' + p.day + '日'
  return withYear ? p.year + '年' + base : base
}

/** "2026-09-20" -> "2026-09-20"（补零，用于表单回显） */
function dateISO(value) {
  const p = parseDate(value)
  if (!p) return ''
  return p.year + '-' + pad2(p.month) + '-' + pad2(p.day)
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/**
 * 距今天还有几天（正数=未来）。用 UTC 时间戳相减，绕开夏令时导致的 23/25 小时问题。
 */
function daysUntil(value, todayDate) {
  const p = parseDate(value)
  if (!p) return null
  const t = today(todayDate)
  const a = Date.UTC(p.year, p.month - 1, p.day)
  const b = Date.UTC(t.year, t.month - 1, t.day)
  return Math.round((a - b) / 86400000)
}

/** 人话版倒计时 */
function countdownText(days) {
  if (days === null || days === undefined) return ''
  if (days === 0) return '今天到账'
  if (days === 1) return '明天到账'
  if (days > 1) return days + ' 天后'
  if (days === -1) return '昨天'
  return Math.abs(days) + ' 天前'
}

/** 月份区间文案："2026年1月 - 12月" */
function yearLabel(year) {
  return year + '年'
}

/** 两个日期间隔的天数（用于持仓天数之类，暂未使用但测试覆盖） */
function daysBetween(fromISO, toISO) {
  const a = parseDate(fromISO)
  const b = parseDate(toISO)
  if (!a || !b) return null
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000
  )
}

/** 过滤掉对象里的空字符串/undefined，用于构造请求参数 */
function cleanParams(params) {
  const out = {}
  Object.keys(params || {}).forEach((k) => {
    const v = params[k]
    if (v !== undefined && v !== null && v !== '') out[k] = v
  })
  return out
}

/**
 * ⚠️ 只用于**表单实时预览**，不要拿这个结果去提交或存储。
 *
 * 真正的金额一律由后端按 shares × per_share 计算（见 backend/app/core/money.py）。
 * 前端重复算一遍的唯一目的是让用户边填边看到数字，减少"我填的对不对"的焦虑。
 */
function calcDividendAmount(shares, perShare) {
  const s = toNumber(shares)
  const p = toNumber(perShare)
  if (s <= 0 || p < 0) return 0
  // +Number.EPSILON 抵消二进制浮点误差（1.005 * 100 = 100.49999999999999）
  return Math.round((s * p + Number.EPSILON) * 100) / 100
}

export {
  toNumber,
  thousands,
  money,
  moneyShort,
  moneyCompact,
  numberTrim,
  percent,
  parseDate,
  today,
  dateCN,
  dateISO,
  daysUntil,
  countdownText,
  yearLabel,
  daysBetween,
  cleanParams,
  calcDividendAmount,
  pad2,
}
