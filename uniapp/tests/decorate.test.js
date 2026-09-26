/** utils/decorate.js 的测试：后端原始对象 -> 模板可直接渲染的结构 */

import * as decorate from '../src/utils/decorate.js'

// 形状和后端 DividendRead 一致
const RAW_DIVIDEND = {
  id: 'd-1',
  account_id: 'acc-1',
  account_name: '我的账户',
  security_id: 'sec-1',
  payment_date: '2026-09-20',
  shares: 10000,
  per_share: 0.19,
  amount: 1900,
  status: 'received',
  note: '',
  security: { id: 'sec-1', code: '601988', name: '中国银行', market: 'CN', type: 'STOCK' },
}

export default function (t) {
  // --- dividend -----------------------------------------------------------
  const d = decorate.dividend(RAW_DIVIDEND)
  t.eq(d.amount, 1900, 'dividend: 保留数值')
  t.eq(d.amountText, '1,900.00', 'dividend: 金额文案')
  t.eq(d.sharesText, '10,000', 'dividend: 股数文案')
  t.eq(d.perShareText, '0.19', 'dividend: 每股分红文案')
  t.eq(d.statusLabel, '已到账', 'dividend: 状态中文')
  t.eq(d.statusCls, 'tag--received', 'dividend: 状态样式')
  t.eq(d.isReceived, true, 'dividend: isReceived')
  t.eq(d.securityName, '中国银行', 'dividend: 标的名')
  t.eq(d.securityCode, '601988', 'dividend: 标的代码')
  t.eq(d.dateText, '9月20日', 'dividend: 日期文案')

  const pending = decorate.dividend(
    Object.assign({}, RAW_DIVIDEND, { status: 'pending', amount: 320.5 })
  )
  t.eq(pending.statusLabel, '待收', 'dividend: 待收中文')
  t.eq(pending.isReceived, false, 'dividend: 待收 isReceived=false')
  t.eq(pending.amountText, '320.50', 'dividend: 待收金额')

  // 未知状态不能崩，也不能显示空白
  const weird = decorate.dividend(Object.assign({}, RAW_DIVIDEND, { status: 'zzz' }))
  t.eq(weird.statusLabel, 'zzz', 'dividend: 未知状态回退为原值')
  t.eq(weird.statusCls, 'tag--muted', 'dividend: 未知状态用灰色标签')

  // 极简返回体（没有嵌套 security）
  const flat = decorate.dividend({ id: 'x', amount: 1, status: 'received' })
  t.eq(flat.securityName, '', 'dividend: 缺 security 时不崩')
  t.eq(flat.amountText, '1.00', 'dividend: 缺 security 仍能格式化')

  t.eq(decorate.dividend(null).amountText, '0.00', 'dividend: null 不崩')

  // --- holding ------------------------------------------------------------
  const h = decorate.holding({
    id: 'h-1',
    account_id: 'acc-1',
    account_name: '我的账户',
    security_id: 'sec-1',
    shares: 10000,
    cost_price: 4.12,
    cost_amount: 41200,
    security: { id: 'sec-1', code: '601988', name: '中国银行', market: 'CN', type: 'STOCK' },
  })
  t.eq(h.sharesText, '10,000', 'holding: 股数')
  t.eq(h.costPriceText, '4.12', 'holding: 成本价')
  t.eq(h.costAmount, 41200, 'holding: 成本金额是数字（用于求和）')
  t.eq(h.costAmountText, '41,200.00', 'holding: 成本金额文案')
  t.eq(h.marketLabel, 'A股', 'holding: 市场中文名')
  t.eq(h.typeLabel, '股票', 'holding: 类型中文名')

  const noCost = decorate.holding({
    id: 'h-2',
    shares: 100,
    cost_price: null,
    cost_amount: null,
    security: { code: 'X', name: 'X' },
  })
  t.eq(noCost.costPrice, null, 'holding: 未填成本价是 null 而不是 0')
  t.eq(noCost.costAmount, null, 'holding: 未填成本金额是 null')
  t.eq(noCost.costPriceText, '', 'holding: 未填成本价显示空串')

  // --- account ------------------------------------------------------------
  const a = decorate.account({ id: 'a', name: '退休账户', type: 'retirement' })
  t.eq(a.typeLabel, '退休', 'account: 类型中文')
  t.eq(decorate.account({ id: 'b', name: 'x', type: 'zzz' }).typeLabel, 'zzz', 'account: 未知类型回退')

  // --- summary ------------------------------------------------------------
  const s = decorate.summary({ estimated: 12680, received: 7230, pending: 5450 })
  t.eq(s.receivedText, '7,230.00', 'summary: 已到账文案')
  t.eq(s.pendingText, '5,450.00', 'summary: 待收文案')
  t.eq(decorate.summary(null).estimatedText, '0.00', 'summary: null 不崩')

  // --- nextDividend -------------------------------------------------------
  const n = decorate.nextDividend({
    security_id: 'sec-2',
    security_code: '601857',
    security_name: '中国石油',
    payment_date: '2026-09-28',
    amount: 320,
    days_left: 2,
  })
  t.eq(n.amountText, '320.00', 'next: 金额')
  t.eq(n.countdownText, '2 天后', 'next: 倒计时文案')
  t.eq(n.isSoon, true, 'next: 3 天内算临近')
  t.eq(
    decorate.nextDividend({ days_left: 10, amount: 0 }).isSoon,
    false,
    'next: 10 天不算临近'
  )
  t.eq(
    decorate.nextDividend({ days_left: -1, amount: 0 }).isSoon,
    false,
    'next: 已过期不算临近'
  )

  // --- monthlyBars --------------------------------------------------------
  const bars = decorate.monthlyBars([
    { month: 1, amount: 800, count: 1 },
    { month: 2, amount: 0, count: 0 },
    { month: 3, amount: 1600, count: 2 },
  ])
  t.eq(bars.length, 3, 'bars: 数量')
  t.eq(bars[2].heightPercent, 100, 'bars: 最大月高度 100%')
  t.eq(bars[0].heightPercent, 50, 'bars: 一半金额 50% 高度')
  t.eq(bars[1].heightPercent, 0, 'bars: 金额为 0 时高度 0（不画柱子）')
  t.eq(bars[2].amountText, '1,600.00', 'bars: 金额文案')
  t.eq(bars[2].monthLabel, '3月', 'bars: 月份文案')

  // 全部为 0 时不能因为除以 0 产生 Infinity/NaN
  const zeros = decorate.monthlyBars([
    { month: 1, amount: 0, count: 0 },
    { month: 2, amount: 0, count: 0 },
  ])
  t.ok(
    zeros.every(function (b) {
      return b.heightPercent === 0
    }),
    'bars: 全为 0 时高度都是 0'
  )
  t.eq(decorate.monthlyBars([]).length, 0, 'bars: 空数组')
  t.eq(decorate.monthlyBars(null).length, 0, 'bars: null 不崩')

  // --- securityStat -------------------------------------------------------
  const st = decorate.securityStat({
    security_id: 'sec-1',
    security_code: '601988',
    security_name: '中国银行',
    amount: 3000,
    count: 2,
  })
  t.eq(st.amountText, '3,000.00', 'stat: 金额文案')
  t.eq(st.count, 2, 'stat: 笔数')
}
