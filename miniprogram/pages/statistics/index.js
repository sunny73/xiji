const api = require('../../services/api')
const fmt = require('../../utils/format')
const ui = require('../../utils/ui')
const decorate = require('../../utils/decorate')
const { createGuard } = require('../../utils/seq')

Page({
  data: {
    loading: true,
    error: '',

    years: [],
    yearIndex: 0,
    year: 0,

    totalText: '0.00',
    count: 0,

    monthBars: [],
    selectedMonthIndex: -1,
    selectedMonth: null,

    bySecurity: [],
    yearly: [],
  },

  onLoad() {
    const y = fmt.today().year
    const years = []
    for (let i = 0; i < 6; i++) years.push(y - i)
    // 快速切换年份时丢弃过期响应，否则会出现"标题是 2026、数据是 2025"
    this.guard = createGuard()
    this.setData({ years: years, yearIndex: 0, year: y })
  },

  onUnload() {
    if (this.guard) this.guard.invalidate()
  },

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
    const token = this.guard.next()
    const year = this.data.year
    this.setData({ loading: true, error: '' })

    // 只统计**已到账**：页面标题写的是"全年到账"，把待收也算进来
    // 会让它比首页的"已到账"多出一截，数字对不上。待收去「分红」页看待收筛选。
    return Promise.all([
      api.statistics.monthly({ year: year, status: 'received' }),
      api.statistics.bySecurity({ year: year, status: 'received' }),
      api.statistics.yearly({ status: 'received' }),
    ])
      .then(function (results) {
        if (!that.guard.isCurrent(token)) return
        that.apply(results[0], results[1], results[2])
      })
      .catch(function (err) {
        if (!that.guard.isCurrent(token)) return
        that.setData({ loading: false, error: err.message || '加载失败' })
      })
  },

  apply(monthly, bySecurity, yearly) {
    const bars = decorate.monthlyBars(monthly || [])
    // 提出来用：下面的 filter/map 回调里 this 不是页面实例，
    // 直接写 this.data.year 会在有数据时抛 TypeError（统计页整个白屏）
    const currentYear = this.data.year

    // 默认选中金额最高的那个月，用户一眼就知道看图该看哪
    let bestIndex = -1
    let bestAmount = 0
    bars.forEach(function (b, i) {
      if (b.amount > bestAmount) {
        bestAmount = b.amount
        bestIndex = i
      }
    })

    const yearRow = (yearly || []).filter(function (r) {
      return r.year === currentYear
    })[0]

    this.setData({
      loading: false,
      error: '',
      monthBars: bars,
      selectedMonthIndex: bestIndex,
      selectedMonth: bestIndex >= 0 ? bars[bestIndex] : null,
      bySecurity: (bySecurity || []).map(decorate.securityStat),
      // 历年对比同样只看已到账，否则和上面的总计不一致
      yearly: (yearly || []).map(function (r) {
        return {
          year: r.year,
          amountText: fmt.money(r.amount),
          count: r.count,
          isCurrent: r.year === currentYear,
        }
      }),
      totalText: yearRow ? fmt.money(yearRow.amount) : '0.00',
      count: yearRow ? yearRow.count : 0,
    })
  },

  onYearChange(e) {
    const index = Number(e.detail.value)
    const that = this
    this.setData({ yearIndex: index, year: this.data.years[index] }, function () {
      that.load()
    })
  },

  onBarTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({
      selectedMonthIndex: index,
      selectedMonth: this.data.monthBars[index] || null,
    })
  },

  retry() {
    this.load()
  },

  goCalendar() {
    ui.navTo('/pages/calendar/index')
  },

  goDividends() {
    ui.switchTab('/pages/dividends/index')
  },
})
