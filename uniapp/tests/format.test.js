/** utils/format.js 的测试 */

import * as fmt from '../src/utils/format.js'

export default function (t) {
  // --- toNumber -----------------------------------------------------------
  t.eq(fmt.toNumber(1234.5), 1234.5, 'toNumber 保留数字')
  t.eq(fmt.toNumber('1234.5'), 1234.5, 'toNumber 解析字符串')
  t.eq(fmt.toNumber(null), 0, 'toNumber(null) = 0')
  t.eq(fmt.toNumber(undefined), 0, 'toNumber(undefined) = 0')
  t.eq(fmt.toNumber('abc'), 0, 'toNumber 非法值 = 0')
  t.eq(fmt.toNumber(''), 0, 'toNumber 空串 = 0')
  t.eq(fmt.toNumber(0), 0, 'toNumber(0) = 0')

  // --- thousands / money ---------------------------------------------------
  t.eq(fmt.thousands('1234567'), '1,234,567', '千分位')
  t.eq(fmt.thousands('999'), '999', '三位以内不加分隔')
  t.eq(fmt.thousands('1000'), '1,000', '四位数加分隔')

  t.eq(fmt.money(1900), '1,900.00', 'money 固定两位小数')
  t.eq(fmt.money(1234567.891), '1,234,567.89', 'money 千分位 + 两位小数')
  t.eq(fmt.money(0), '0.00', 'money(0)')
  t.eq(fmt.money(null), '0.00', 'money(null) 不崩')
  t.eq(fmt.money(-500.5), '-500.50', 'money 负数')
  t.eq(fmt.money(1900.004), '1,900.00', 'money 四舍五入到分')
  t.eq(fmt.money(1900.005), '1,900.01', 'money 进位')
  t.eq(fmt.money(1900, { sign: true }), '+1,900.00', 'money 显示正号')
  t.eq(fmt.money(-1900, { sign: true }), '-1,900.00', 'money 负数优先于正号')
  t.eq(fmt.money(1900, { trimZero: true }), '1,900', 'trimZero 省略 .00')
  t.eq(fmt.money(1900.5, { trimZero: true }), '1,900.50', 'trimZero 只省略全零小数')
  t.eq(fmt.money(0.19, { decimals: 4, trimTrailing: true }), '0.19', 'trimTrailing 去掉末尾 0')
  t.eq(fmt.money(4.12, { decimals: 4, trimTrailing: true }), '4.12', 'trimTrailing 4.1200 -> 4.12')
  t.eq(fmt.money(1, { decimals: 4, trimTrailing: true }), '1', 'trimTrailing 全为 0 时连小数点一起去掉')
  t.eq(fmt.money(0, { trimTrailing: true }), '0', 'trimTrailing(0)')
  t.eq(fmt.numberTrim(0.19, 4), '0.19', 'numberTrim 单价')
  t.eq(fmt.numberTrim(0.333333, 4), '0.3333', 'numberTrim 截到 4 位')
  t.eq(fmt.numberTrim(10000), '10,000', 'numberTrim 股数带千分位')

  t.eq(fmt.moneyShort(1900), '1,900', 'moneyShort 省略零小数')
  t.eq(fmt.moneyCompact(12800), '1.28万', 'moneyCompact 万')
  t.eq(fmt.moneyCompact(10000), '1万', 'moneyCompact 整万')
  t.eq(fmt.moneyCompact(9999), '9,999', 'moneyCompact 不足一万')
  t.eq(fmt.moneyCompact(-20000), '-2万', 'moneyCompact 负数')

  t.eq(fmt.percent(0.1234), '12.3%', 'percent 默认一位小数')
  t.eq(fmt.percent(0.1234, 2), '12.34%', 'percent 指定位数')

  // --- 日期 ---------------------------------------------------------------
  t.eq(fmt.parseDate('2026-09-20'), { year: 2026, month: 9, day: 20 }, 'parseDate')
  t.eq(fmt.parseDate('2026-9-2'), { year: 2026, month: 9, day: 2 }, 'parseDate 容忍不补零')
  t.eq(fmt.parseDate('2026/09/20'), null, 'parseDate 只认 - 分隔')
  t.eq(fmt.parseDate(''), null, 'parseDate 空串')
  t.eq(fmt.parseDate(null), null, 'parseDate null')

  t.eq(fmt.pad2(9), '09', 'pad2')
  t.eq(fmt.pad2(12), '12', 'pad2 两位不变')
  t.eq(fmt.dateISO('2026-9-2'), '2026-09-02', 'dateISO 补零')

  // dateCN 依赖"今年"，用固定 today 避免跨年时测试突然变红
  const todayIn2026 = new Date(2026, 5, 15)
  t.eq(fmt.dateCN('2026-09-20', { withYear: false }), '9月20日', 'dateCN 不带年')
  t.eq(fmt.dateCN('2026-09-20', { withYear: true }), '2026年9月20日', 'dateCN 带年')
  t.eq(fmt.dateCN('bad'), '', 'dateCN 非法输入返回空串')

  // daysUntil：用注入日期，避开"今天恰好是几号"的时间炸弹
  t.eq(fmt.daysUntil('2026-06-18', todayIn2026), 3, 'daysUntil 未来')
  t.eq(fmt.daysUntil('2026-06-15', todayIn2026), 0, 'daysUntil 今天')
  t.eq(fmt.daysUntil('2026-06-10', todayIn2026), -5, 'daysUntil 过去')
  t.eq(fmt.daysUntil('2026-07-15', todayIn2026), 30, 'daysUntil 跨月')
  t.eq(fmt.daysUntil('bad', todayIn2026), null, 'daysUntil 非法输入')

  // 跨夏令时：3 月第二个周日前后，用 UTC 计算才不会出现 0.96 天被 round 成 1
  t.eq(fmt.daysUntil('2026-03-10', new Date(2026, 2, 8)), 2, 'daysUntil 跨夏令时仍准确')

  t.eq(fmt.countdownText(0), '今天到账', 'countdown 0')
  t.eq(fmt.countdownText(1), '明天到账', 'countdown 1')
  t.eq(fmt.countdownText(5), '5 天后', 'countdown n')
  t.eq(fmt.countdownText(-1), '昨天', 'countdown -1')
  t.eq(fmt.countdownText(-3), '3 天前', 'countdown 过去 n')
  t.eq(fmt.countdownText(null), '', 'countdown null')

  t.eq(fmt.daysBetween('2026-01-01', '2026-12-31'), 364, 'daysBetween')
  t.eq(fmt.daysBetween('2024-02-28', '2024-03-01'), 2, 'daysBetween 闰年')

  // --- cleanParams --------------------------------------------------------
  t.eq(
    fmt.cleanParams({ a: 1, b: '', c: null, d: undefined, e: 0, f: 'x' }),
    { a: 1, e: 0, f: 'x' },
    'cleanParams 只去掉空值，保留 0'
  )

  // --- 金额预览（仅供表单显示）---------------------------------------------
  t.eq(fmt.calcDividendAmount(10000, 0.19), 1900, '预览：10000 × 0.19')
  t.eq(fmt.calcDividendAmount('10000', '0.19'), 1900, '预览：接受字符串')
  t.eq(fmt.calcDividendAmount(3, 0.333333), 1, '预览：0.999999 进位到 1')
  t.eq(fmt.calcDividendAmount(0, 0.19), 0, '预览：股数为 0')
  t.eq(fmt.calcDividendAmount(-1, 0.19), 0, '预览：负数返回 0')
  t.eq(fmt.calcDividendAmount('', ''), 0, '预览：空输入返回 0')
}
