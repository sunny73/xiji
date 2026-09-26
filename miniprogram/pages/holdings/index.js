const api = require('../../services/api')
const fmt = require('../../utils/format')
const ui = require('../../utils/ui')
const decorate = require('../../utils/decorate')
const { createGuard } = require('../../utils/seq')

Page({
  data: {
    loading: true,
    error: '',
    filters: [{ id: '', name: '全部' }],
    filterIndex: 0,
    holdings: [],
    totalCostText: '0.00',
    count: 0,
    hasAccounts: true,
  },

  onLoad() {
    // 快速连点账户筛选时，先发的请求可能后回来；用序号守卫丢弃过期响应
    this.guard = createGuard()
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
    this.setData({ loading: true, error: '' })

    return api.accounts
      .list()
      .then(function (accounts) {
        if (!that.guard.isCurrent(token)) return
        const filters = [{ id: '', name: '全部' }].concat(
          accounts.map(function (a) {
            return { id: a.id, name: a.name }
          })
        )
        // 账户被删掉之后 filterIndex 可能越界，夹回 0，否则会读到 undefined
        const filterIndex = Math.min(that.data.filterIndex, filters.length - 1)
        that.setData({
          filters: filters,
          filterIndex: filterIndex < 0 ? 0 : filterIndex,
          hasAccounts: accounts.length > 0,
        })
        return that.fetchHoldings(token)
      })
      .catch(function (err) {
        if (!that.guard.isCurrent(token)) return
        that.setData({ loading: false, error: err.message || '加载失败' })
      })
  },

  fetchHoldings(token) {
    const that = this
    const filter = this.data.filters[this.data.filterIndex] || { id: '' }

    return api.holdings
      .list({ account_id: filter.id })
      .then(function (list) {
        if (!that.guard.isCurrent(token)) return
        const holdings = (list || []).map(decorate.holding)
        let totalCost = 0
        holdings.forEach(function (h) {
          if (h.costAmount !== null) totalCost += h.costAmount
        })
        that.setData({
          loading: false,
          error: '',
          holdings: holdings,
          count: holdings.length,
          totalCostText: fmt.money(totalCost),
        })
      })
      .catch(function (err) {
        if (!that.guard.isCurrent(token)) return
        that.setData({ loading: false, error: err.message || '加载失败' })
      })
  },

  onFilterChange(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.filterIndex) return
    const that = this
    const token = this.guard.next()
    this.setData({ filterIndex: index, loading: true }, function () {
      that.fetchHoldings(token)
    })
  },

  retry() {
    this.load()
  },

  goDetail(e) {
    ui.navTo('/pages/holding-detail/index?id=' + e.currentTarget.dataset.id)
  },

  goCreate() {
    if (!this.data.hasAccounts) {
      ui.confirm({
        title: '还没有账户',
        content: '持仓必须属于某个账户，先去创建一个吧',
        confirmText: '去创建',
      }).then(function (ok) {
        if (ok) ui.navTo('/pages/accounts/index')
      })
      return
    }
    ui.navTo('/pages/holding-create/index')
  },
})
