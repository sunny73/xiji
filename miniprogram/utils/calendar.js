/**
 * 日历网格计算。纯函数，Node 里可测。
 *
 * 微信小程序没有现成的日历组件（也不该为此装一个几百 KB 的库），
 * 自己算 6x7 网格就够：首页 / 日历页共用。
 */

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

function toISO(year, month, day) {
  return year + '-' + pad2(month) + '-' + pad2(day)
}

/** 某年某月有多少天。用"下个月第 0 天"这个技巧，自动处理闰年 */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/**
 * 生成月历网格（固定 6 行 x 7 列，避免月份切换时高度跳动）。
 *
 * @param {number} year
 * @param {number} month 1-12
 * @returns {Array<{day:number, iso:string, inMonth:boolean, isToday:boolean, isWeekend:boolean}>}
 */
function monthMatrix(year, month, todayDate) {
  const now = todayDate || new Date()
  const todayISO = toISO(now.getFullYear(), now.getMonth() + 1, now.getDate())

  const firstWeekday = new Date(year, month - 1, 1).getDay() // 0=周日
  const total = daysInMonth(year, month)

  const cells = []
  // 上个月的补位
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  const prevTotal = daysInMonth(prevYear, prevMonth)
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const day = prevTotal - i
    cells.push(makeCell(prevYear, prevMonth, day, false, todayISO))
  }

  // 本月
  for (let day = 1; day <= total; day++) {
    cells.push(makeCell(year, month, day, true, todayISO))
  }

  // 下个月的补位，凑满 6 行
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  let day = 1
  while (cells.length < 42) {
    cells.push(makeCell(nextYear, nextMonth, day, false, todayISO))
    day++
  }

  return cells
}

function makeCell(year, month, day, inMonth, todayISO) {
  const iso = toISO(year, month, day)
  const weekday = new Date(year, month - 1, day).getDay()
  return {
    day: day,
    iso: iso,
    month: month,
    inMonth: inMonth,
    isToday: iso === todayISO,
    isWeekend: weekday === 0 || weekday === 6,
  }
}

/**
 * 把月历网格切成 6 行，方便 WXML 里用嵌套 wx:for 渲染。
 */
function monthRows(cells) {
  const rows = []
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7))
  }
  return rows
}

/** 上一个月 / 下一个月，返回 {year, month} */
function shiftMonth(year, month, delta) {
  const base = new Date(year, month - 1 + delta, 1)
  return { year: base.getFullYear(), month: base.getMonth() + 1 }
}

module.exports = {
  WEEK_LABELS,
  daysInMonth,
  monthMatrix,
  monthRows,
  shiftMonth,
  pad2,
  toISO,
}
