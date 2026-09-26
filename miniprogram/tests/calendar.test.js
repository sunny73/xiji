/** utils/calendar.js 的测试 */

const cal = require('../utils/calendar')

module.exports = function (t) {
  t.eq(cal.WEEK_LABELS.length, 7, '表头 7 列')

  // --- daysInMonth --------------------------------------------------------
  t.eq(cal.daysInMonth(2026, 1), 31, '1 月 31 天')
  t.eq(cal.daysInMonth(2026, 2), 28, '平年 2 月 28 天')
  t.eq(cal.daysInMonth(2024, 2), 29, '闰年 2 月 29 天')
  t.eq(cal.daysInMonth(2000, 2), 29, '2000 是闰年（能被 400 整除）')
  t.eq(cal.daysInMonth(1900, 2), 28, '1900 不是闰年（能被 100 不能被 400）')
  t.eq(cal.daysInMonth(2026, 4), 30, '4 月 30 天')
  t.eq(cal.daysInMonth(2026, 12), 31, '12 月 31 天')

  // --- monthMatrix --------------------------------------------------------
  const m = cal.monthMatrix(2026, 9, new Date(2026, 8, 15))
  t.eq(m.length, 42, '固定 6 行 x 7 列 = 42 格（高度不跳）')

  const inMonth = m.filter(function (c) {
    return c.inMonth
  })
  t.eq(inMonth.length, 30, '9 月有 30 天在网格里')
  t.eq(inMonth[0].day, 1, '第一个本月格是 1 号')
  t.eq(inMonth[0].iso, '2026-09-01', 'iso 补零')

  // 2026-09-01 是周二，所以前面应该有 2 个上个月的补位
  const leading = m.slice(0, m.findIndex(function (c) {
    return c.inMonth
  }))
  t.eq(leading.length, 2, '9/1 是周二，前面补 2 天')
  t.eq(leading[0].iso, '2026-08-30', '补位从 8/30 开始')
  t.eq(leading[0].inMonth, false, '补位不属于本月')

  const todays = m.filter(function (c) {
    return c.isToday
  })
  t.eq(todays.length, 1, '只有一个"今天"')
  t.eq(todays[0].iso, '2026-09-15', '今天标记正确')

  // 周末标记
  const sep5 = m.filter(function (c) {
    return c.iso === '2026-09-05'
  })[0]
  t.eq(sep5.isWeekend, true, '周六标记为周末')
  const sep7 = m.filter(function (c) {
    return c.iso === '2026-09-07'
  })[0]
  t.eq(sep7.isWeekend, false, '周一不是周末')

  // 跨年 1 月：补位应该落到上一年 12 月
  const jan = cal.monthMatrix(2026, 1, new Date(2026, 0, 10))
  t.eq(jan[0].iso, '2025-12-28', '1 月的补位属于上一年 12 月')
  t.eq(jan.filter(function (c) { return c.inMonth }).length, 31, '1 月 31 天')

  // 12 月：尾部补位应该落到下一年 1 月
  const dec = cal.monthMatrix(2026, 12, new Date(2026, 11, 1))
  const last = dec[dec.length - 1]
  t.eq(last.inMonth, false, '12 月最后一格是补位')
  t.ok(last.iso.indexOf('2027-') === 0, '12 月尾部补位进入下一年')

  // 2 月且 1 号正好是周日 -> 没有前导补位
  const feb2015 = cal.monthMatrix(2015, 2, new Date(2015, 1, 1))
  t.eq(feb2015[0].iso, '2015-02-01', '2015-02-01 是周日，无前导补位')

  // --- monthRows ----------------------------------------------------------
  const rows = cal.monthRows(m)
  t.eq(rows.length, 6, '切成 6 行')
  t.ok(
    rows.every(function (r) {
      return r.length === 7
    }),
    '每行 7 格'
  )

  // --- shiftMonth ---------------------------------------------------------
  t.eq(cal.shiftMonth(2026, 9, 1), { year: 2026, month: 10 }, '下个月')
  t.eq(cal.shiftMonth(2026, 9, -1), { year: 2026, month: 8 }, '上个月')
  t.eq(cal.shiftMonth(2026, 12, 1), { year: 2027, month: 1 }, '12 月 +1 跨年')
  t.eq(cal.shiftMonth(2026, 1, -1), { year: 2025, month: 12 }, '1 月 -1 跨年')
  t.eq(cal.shiftMonth(2026, 1, -13), { year: 2024, month: 12 }, '跨多年')

  // --- toISO --------------------------------------------------------------
  t.eq(cal.toISO(2026, 9, 5), '2026-09-05', 'toISO 补零')
  t.eq(cal.toISO(2026, 12, 31), '2026-12-31', 'toISO 年末')
}
