const api = require('../../services/api')
const fmt = require('../../utils/format')
const ui = require('../../utils/ui')
const decorate = require('../../utils/decorate')
const { STATUS_FILTERS } = require('../../utils/constants')
const { createGuard } = require('../../utils/seq')

const PAGE_SIZE = 20

Page({
  data: {
    loading: true,
    loadingMore: false,
    error: '',

    items: [],
    total: 0,
    page: 1,
    hasMore: false,

    statusFilters: STATUS_FILTERS,
    statusIndex: 0,

    years: [],
    yearIndex: 0,
    year: 0,

    receivedText: '0.00',
    pendingText: '0.00',
  },

  onLoad() {
    const y = fmt.today().year
    const years = []
    for (let i = 0; i < 6; i++) years.push(y - i)
    // 切筛选/切年份/下拉刷新会互相打断，用序号守卫避免"新筛选配旧数据"
    this.guard = createGuard()
    this.setData({ years: years, yearIndex: 0, year: y })
  },

  onUnload() {
    if (this.guard) this.guard.invalidate()
  },

  // 从"记一笔"返回后要立刻刷新
  onShow() {
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadMore()
  },

  reload() {
    // 只有"重新加载"才递增守卫。分页**不能**递增——分页是在既有结果上追加，
    // 若也递增，用户翻页会让在途的第 1 页失效，前 20 条被静默丢掉。
    const token = this.guard.next()
    this.token = token
    this.setData({
      loading: true,
      error: '',
      items: [],
      page: 1,
      // 必须和 items 一起复位：否则列表已清空但 hasMore 还是 true，
      // 用户一滑就触发 loadMore，第一页数据永远补不回来
      hasMore: false,
      loadingMore: false,
    })
    return Promise.all([this.fetchPage(1, token), this.fetchSummary(token)])
  },

  loadMore() {
    const token = this.token
    // 重新加载已经把列表清了，这次分页作废
    if (!this.guard.isCurrent(token)) return Promise.resolve()
    const next = this.data.page + 1
    this.setData({ loadingMore: true })
    return this.fetchPage(next, token)
  },

  fetchPage(page, token) {
    const that = this
    const status = STATUS_FILTERS[this.data.statusIndex].value

    return api.dividends
      .list({
        year: this.data.year,
        status: status,
        page: page,
        page_size: PAGE_SIZE,
      })
      .then(function (res) {
        // 已经有更新的请求（切了筛选 / 重新加载）在跑，这一页直接丢弃
        if (!that.guard.isCurrent(token)) return
        const fresh = (res.items || []).map(decorate.dividend)
        const items = page === 1 ? fresh : that.data.items.concat(fresh)
        that.setData({
          loading: false,
          loadingMore: false,
          error: '',
          items: items,
          total: res.total || 0,
          page: page,
          hasMore: page * PAGE_SIZE < (res.total || 0),
        })
      })
      .catch(function (err) {
        if (!that.guard.isCurrent(token)) return
        that.setData({ loading: false, loadingMore: false, error: err.message || '加载失败' })
      })
  },

  /** 顶部合计走 dashboard 接口，保证和首页数字一致（不受分页影响） */
  fetchSummary(token) {
    const that = this
    return api.dashboard
      .get({ year: this.data.year })
      .then(function (res) {
        // 和列表用同一个守卫：否则快速切年份会出现"列表是 2025、总计是 2026"
        if (!that.guard.isCurrent(token)) return
        that.setData({
          receivedText: fmt.money(res.summary.received),
          pendingText: fmt.money(res.summary.pending),
        })
      })
      .catch(function () {
        /* 汇总失败不影响列表，静默 */
      })
  },

  // --- 交互 ---------------------------------------------------------------

  onStatusChange(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.statusIndex) return
    const that = this
    this.setData({ statusIndex: index }, function () {
      that.reload()
    })
  },

  onYearChange(e) {
    const index = Number(e.detail.value)
    const that = this
    this.setData({ yearIndex: index, year: this.data.years[index] }, function () {
      that.reload()
    })
  },

  retry() {
    this.reload()
  },

  goCreate() {
    ui.navTo('/pages/dividend-create/index')
  },

  goDetail(e) {
    ui.navTo('/pages/dividend-create/index?id=' + e.currentTarget.dataset.id)
  },

  /** 待收 -> 已到账。支付日期默认不变（后端只在传了 payment_date 时才改） */
  markReceived(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    api.dividends
      .markReceived(id)
      .then(function () {
        ui.success('已确认到账')
        that.reload()
      })
      .catch(ui.error)
  },
})
