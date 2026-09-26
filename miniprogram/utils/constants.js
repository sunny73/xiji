/**
 * 常量与枚举。
 *
 * 这些值和后端保持一致（见 backend/app/models/dividend.py 的 DIVIDEND_STATUSES 等）。
 * 后端才是唯一权威：这里只用于显示，不做校验。
 */

const DIVIDEND_STATUS = {
  pending: { label: '待收', cls: 'tag--pending' },
  received: { label: '已到账', cls: 'tag--received' },
}

const STATUS_FILTERS = [
  { value: '', label: '全部' },
  { value: 'received', label: '已到账' },
  { value: 'pending', label: '待收' },
]

const ACCOUNT_TYPES = [
  { value: 'personal', label: '个人' },
  { value: 'spouse', label: '家人' },
  { value: 'long_term', label: '长期' },
  { value: 'retirement', label: '退休' },
  { value: 'other', label: '其他' },
]

const MARKETS = [
  { value: 'CN', label: 'A股' },
  { value: 'HK', label: '港股' },
  { value: 'US', label: '美股' },
]

const SECURITY_TYPES = [
  { value: 'STOCK', label: '股票' },
  { value: 'ETF', label: 'ETF' },
  { value: 'FUND', label: '基金' },
  { value: 'BOND', label: '债券' },
  { value: 'REIT', label: 'REITs' },
]

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/** 按 value 找 label，找不到返回原值，避免页面显示空白 */
function labelOf(list, value) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].value === value) return list[i].label
  }
  return value || ''
}

module.exports = {
  DIVIDEND_STATUS,
  STATUS_FILTERS,
  ACCOUNT_TYPES,
  MARKETS,
  SECURITY_TYPES,
  MONTHS,
  labelOf,
}
