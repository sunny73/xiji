const api = require('../../services/api')
const fmt = require('../../utils/format')
const ui = require('../../utils/ui')
const v = require('../../utils/validate')
const decorate = require('../../utils/decorate')

Page({
  data: {
    id: '',
    loading: true,
    error: '',

    holding: null,
    editing: false,
    editShares: '',
    editCostPrice: '',
    submitting: false,

    dividends: [],
    dividendTotalText: '0.00',
    dividendCount: 0,
    loadingDividends: true,
  },

  onLoad(query) {
    const id = (query && query.id) || ''
    if (!id) {
      // 正常入口都会带 id，但扫码/分享等场景可能没有。
      // 不处理的话 loading 一直是 true，页面永远停在"加载中…"
      this.setData({ id: '', loading: false, error: '缺少持仓参数，请从持仓列表进入' })
      return
    }
    this.setData({ id: id })
  },

  onShow() {
    if (this.data.id) this.load()
  },

  onPullDownRefresh() {
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })

    return api.holdings
      .detail(this.data.id)
      .then(function (raw) {
        const holding = decorate.holding(raw)
        that.setData({
          loading: false,
          holding: holding,
          editShares: String(holding.shares),
          editCostPrice: holding.costPrice === null ? '' : String(holding.costPrice),
        })
        wx.setNavigationBarTitle({ title: holding.securityName || '持仓详情' })
        return that.loadDividends(holding)
      })
      .catch(function (err) {
        that.setData({ loading: false, error: err.message || '加载失败' })
      })
  },

  loadDividends(holding) {
    const that = this
    this.setData({ loadingDividends: true })

    return api.dividends
      .list({ security_id: holding.securityId, page_size: 50 })
      .then(function (res) {
        const items = (res.items || []).map(decorate.dividend)
        let total = 0
        items.forEach(function (d) {
          if (d.isReceived) total += d.amount
        })
        that.setData({
          loadingDividends: false,
          dividends: items,
          dividendCount: res.total || items.length,
          dividendTotalText: fmt.money(total),
        })
      })
      .catch(function () {
        that.setData({ loadingDividends: false })
      })
  },

  // --- 编辑 ---------------------------------------------------------------

  startEdit() {
    this.setData({ editing: true })
  },

  cancelEdit() {
    const h = this.data.holding
    this.setData({
      editing: false,
      editShares: String(h.shares),
      editCostPrice: h.costPrice === null ? '' : String(h.costPrice),
    })
  },

  onSharesInput(e) {
    this.setData({ editShares: e.detail.value })
  },

  onCostInput(e) {
    this.setData({ editCostPrice: e.detail.value })
  },

  save() {
    if (this.data.submitting) return
    const that = this

    const sharesCheck = v.parseAmount(this.data.editShares, {
      label: '股数',
      min: 0.0001,
      decimals: 4,
    })
    const costCheck = v.parseAmount(this.data.editCostPrice, {
      label: '成本价',
      optional: true,
      min: 0,
      decimals: 4,
    })

    const message = v.firstError([sharesCheck, costCheck])
    if (message) {
      ui.toast(message)
      return
    }

    this.setData({ submitting: true })
    api.holdings
      .update(this.data.id, {
        shares: sharesCheck.value,
        cost_price: costCheck.value,
      })
      .then(function (raw) {
        const holding = decorate.holding(raw)
        that.setData({
          submitting: false,
          editing: false,
          holding: holding,
          editShares: String(holding.shares),
          editCostPrice: holding.costPrice === null ? '' : String(holding.costPrice),
        })
        ui.success('已保存')
      })
      .catch(function (err) {
        that.setData({ submitting: false })
        ui.error(err)
      })
  },

  remove() {
    const that = this
    const h = this.data.holding
    if (!h) return

    ui.confirmDelete(h.securityName).then(function (ok) {
      if (!ok) return
      api.holdings
        .remove(that.data.id)
        .then(function () {
          ui.success('已删除')
          setTimeout(function () {
            ui.back()
          }, 600)
        })
        .catch(ui.error)
    })
  },

  // --- 跳转 ---------------------------------------------------------------

  addDividend() {
    const h = this.data.holding
    if (!h) return
    ui.navTo(
      '/pages/dividend-create/index?account_id=' +
        h.accountId +
        '&security_id=' +
        h.securityId +
        '&security_name=' +
        encodeURIComponent(h.securityName)
    )
  },

  goDividend(e) {
    ui.navTo('/pages/dividend-create/index?id=' + e.currentTarget.dataset.id)
  },
})
