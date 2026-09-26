const api = require('../../services/api')
const auth = require('../../services/auth')
const fmt = require('../../utils/format')
const ui = require('../../utils/ui')
const decorate = require('../../utils/decorate')

function greeting() {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

Page({
  data: {
    loading: true,
    error: '',
    year: 0,
    greeting: '',
    userName: '',
    summary: { estimatedText: '0.00', receivedText: '0.00', pendingText: '0.00' },
    next: null,
    currentMonth: null,
    recent: [],
  },

  onLoad() {
    const user = auth.getUser()
    this.setData({
      year: fmt.today().year,
      greeting: greeting(),
      userName: (user && user.nickname) || '',
    })
  },

  // 用 onShow 而不是 onLoad：从"记一笔"返回后要立刻看到新数据
  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })
    return api.dashboard
      .get({ year: this.data.year })
      .then(function (res) {
        that.apply(res)
      })
      .catch(function (err) {
        that.setData({ loading: false, error: err.message || '加载失败' })
      })
  },

  apply(res) {
    const cm = res.current_month || { month: 0, amount: 0 }
    this.setData({
      loading: false,
      error: '',
      year: res.year,
      summary: decorate.summary(res.summary),
      next: res.next_dividend ? decorate.nextDividend(res.next_dividend) : null,
      currentMonth: {
        month: cm.month,
        monthLabel: cm.month + ' 月',
        amountText: fmt.money(cm.amount),
        amountShortText: fmt.moneyShort(cm.amount),
      },
      recent: (res.recent_dividends || []).map(decorate.dividend),
    })
  },

  retry() {
    this.load()
  },

  // --- 导航 ---------------------------------------------------------------

  goCreate() {
    ui.navTo('/pages/dividend-create/index')
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id) ui.navTo('/pages/dividend-create/index?id=' + id)
  },

  goHoldings() {
    ui.switchTab('/pages/holdings/index')
  },

  goDividends() {
    ui.switchTab('/pages/dividends/index')
  },

  goCalendar() {
    ui.navTo('/pages/calendar/index')
  },

  goStatistics() {
    ui.switchTab('/pages/statistics/index')
  },
})
