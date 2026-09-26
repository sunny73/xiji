/**
 * 把后端返回的原始对象"装扮"成模板能直接渲染的结构。
 *
 * 为什么单独一层：
 *   页面只该关心"渲染什么"，不该关心"金额怎么格式化""状态叫什么名字"。
 *   而且这一层是纯函数，可以在 Node 里直接测（见 tests/decorate.test.js）。
 */

const fmt = require('./format')
const { DIVIDEND_STATUS, labelOf, MARKETS, SECURITY_TYPES, ACCOUNT_TYPES } = require('./constants')

/** 分红记录 */
function dividend(raw) {
  const d = raw || {}
  const status = DIVIDEND_STATUS[d.status] || { label: d.status || '', cls: 'tag--muted' }
  const security = d.security || {}
  return {
    id: d.id,
    accountId: d.account_id,
    accountName: d.account_name || '',
    securityId: d.security_id,
    securityName: d.security_name || security.name || '',
    securityCode: d.security_code || security.code || '',
    paymentDate: d.payment_date,
    dateText: fmt.dateCN(d.payment_date),
    fullDateText: fmt.dateCN(d.payment_date, { withYear: true }),
    shares: fmt.toNumber(d.shares),
    sharesText: fmt.numberTrim(d.shares, 4),
    perShare: fmt.toNumber(d.per_share),
    perShareText: fmt.numberTrim(d.per_share, 4),
    amount: fmt.toNumber(d.amount),
    amountText: fmt.money(d.amount),
    amountShortText: fmt.moneyShort(d.amount),
    status: d.status,
    statusLabel: status.label,
    statusCls: status.cls,
    isReceived: d.status === 'received',
    note: d.note || '',
  }
}

/** 持仓 */
function holding(raw) {
  const h = raw || {}
  const security = h.security || {}
  return {
    id: h.id,
    accountId: h.account_id,
    accountName: h.account_name || '',
    securityId: h.security_id,
    securityName: security.name || '',
    securityCode: security.code || '',
    securityMarket: security.market || '',
    marketLabel: labelOf(MARKETS, security.market),
    typeLabel: labelOf(SECURITY_TYPES, security.type),
    shares: fmt.toNumber(h.shares),
    sharesText: fmt.numberTrim(h.shares, 4),
    costPrice: h.cost_price === null || h.cost_price === undefined ? null : fmt.toNumber(h.cost_price),
    costPriceText:
      h.cost_price === null || h.cost_price === undefined
        ? ''
        : fmt.numberTrim(h.cost_price, 4),
    // 数值版成本金额：页面要拿它做求和，不能去解析格式化后的字符串（千分位、逗号会坑人）
    costAmount:
      h.cost_amount === null || h.cost_amount === undefined ? null : fmt.toNumber(h.cost_amount),
    costAmountText:
      h.cost_amount === null || h.cost_amount === undefined ? '' : fmt.money(h.cost_amount),
  }
}

/** 账户 */
function account(raw) {
  const a = raw || {}
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    typeLabel: labelOf(ACCOUNT_TYPES, a.type),
  }
}

/** Dashboard 的三段汇总 */
function summary(raw) {
  const s = raw || {}
  return {
    estimated: fmt.toNumber(s.estimated),
    received: fmt.toNumber(s.received),
    pending: fmt.toNumber(s.pending),
    estimatedText: fmt.money(s.estimated),
    receivedText: fmt.money(s.received),
    pendingText: fmt.money(s.pending),
  }
}

/** 最近一笔预计分红 */
function nextDividend(raw) {
  const n = raw || {}
  return {
    securityId: n.security_id,
    securityName: n.security_name || '',
    securityCode: n.security_code || '',
    paymentDate: n.payment_date,
    dateText: fmt.dateCN(n.payment_date, { withYear: true }),
    amount: fmt.toNumber(n.amount),
    amountText: fmt.money(n.amount),
    daysLeft: n.days_left,
    countdownText: fmt.countdownText(n.days_left),
    isSoon: typeof n.days_left === 'number' && n.days_left >= 0 && n.days_left <= 3,
  }
}

/** 按月统计的一根柱子，顺便算好百分比高度（WXSS 不支持算数表达式） */
function monthlyBars(raw, maxAmount) {
  const rows = raw || []
  const max = maxAmount || Math.max.apply(null, rows.map(function (r) { return fmt.toNumber(r.amount) }).concat([1]))
  return rows.map(function (r) {
    const amount = fmt.toNumber(r.amount)
    return {
      month: r.month,
      monthLabel: r.month + '月',
      amount: amount,
      amountText: fmt.money(amount),
      amountShortText: fmt.moneyCompact(amount),
      count: r.count || 0,
      // 最低留 4% 高度，否则金额为 0 的月份柱子完全消失，看起来像图表坏了
      heightPercent: amount > 0 ? Math.max(4, Math.round((amount / max) * 100)) : 0,
    }
  })
}

/** 按标的统计的一行 */
function securityStat(raw) {
  const r = raw || {}
  return {
    securityId: r.security_id,
    securityCode: r.security_code,
    securityName: r.security_name,
    amount: fmt.toNumber(r.amount),
    amountText: fmt.money(r.amount),
    count: r.count || 0,
  }
}

module.exports = {
  dividend,
  holding,
  account,
  summary,
  nextDividend,
  monthlyBars,
  securityStat,
}
