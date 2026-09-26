const api = require('../../services/api')
const fmt = require('../../utils/format')
const ui = require('../../utils/ui')
const cal = require('../../utils/calendar')
const decorate = require('../../utils/decorate')
const { createGuard } = require('../../utils/seq')

Page({
  data: {
    weekLabels: cal.WEEK_LABELS,
    year: 0,
    month: 0,
    monthLabel: '',

    rows: [],
    loading: true,
    error: '',

    selectedDate: '',
    selectedDateText: '',
    selectedItems: [],
    selectedTotalText: '0.00',
  },

  onLoad() {
    const t = fmt.today()
    // 快速连点月份箭头时，先发的请求可能后回来；用序号守卫丢弃过期响应
    this.guard = createGuard()
    this.setData({ year: t.year, month: t.month })
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

    return api.statistics
      .calendar({ year: this.data.year, month: this.data.month })
      .then(function (list) {
        if (!that.guard.isCurrent(token)) return
        that.apply(list || [])
      })
      .catch(function (err) {
        if (!that.guard.isCurrent(token)) return
        that.setData({ loading: false, error: err.message || '加载失败' })
      })
  },

  apply(list) {
    // 放进实例而不是 data：setData 会把这个对象整个序列化传到视图层，
    // 日历数据里带着完整 items，塞进 data 会让每次 setData 都很重
    const dayMap = {}
    list.forEach(function (d) {
      dayMap[d.date] = {
        total: fmt.toNumber(d.total),
        totalText: fmt.money(d.total),
        totalShortText: fmt.moneyCompact(d.total),
        items: (d.items || []).map(decorate.dividend),
      }
    })
    this.dayMap = dayMap

    this.allCells = cal.monthMatrix(this.data.year, this.data.month)
    this.setData({
      loading: false,
      error: '',
      monthLabel: this.data.year + ' 年 ' + this.data.month + ' 月',
      rows: this.buildRows(),
    })
  },

  /** 把选中态和"这天有没有分红"算进单元格 */
  buildRows() {
    const selected = this.data.selectedDate
    const dayMap = this.dayMap || {}
    const cells = (this.allCells || []).map(function (c) {
      const hit = dayMap[c.iso]
      return Object.assign({}, c, {
        hasDividend: !!hit,
        amountText: hit ? hit.totalShortText : '',
        isSelected: c.iso === selected,
      })
    })

    // 每行额外挂一个 key：WXML 的 wx:key 只认"item 上的属性"或保留字 *this，
    // 写 wx:key="index" 是无效的（index 不是保留字），item 又是数组，会取到 undefined
    return cal.monthRows(cells).map(function (rowCells, i) {
      return { key: 'week-' + i, cells: rowCells }
    })
  },

  // --- 月份切换 -----------------------------------------------------------

  prevMonth() {
    this.shift(-1)
  },

  nextMonth() {
    this.shift(1)
  },

  shift(delta) {
    const next = cal.shiftMonth(this.data.year, this.data.month, delta)
    const that = this
    this.setData(
      {
        year: next.year,
        month: next.month,
        selectedDate: '',
        selectedItems: [],
        selectedDateText: '',
        selectedTotalText: '0.00',
      },
      function () {
        that.load()
      }
    )
  },

  goToday() {
    const t = fmt.today()
    const that = this
    this.setData({ year: t.year, month: t.month }, function () {
      that.load()
    })
  },

  // --- 选日期 -------------------------------------------------------------

  onDayTap(e) {
    const iso = e.currentTarget.dataset.iso
    const hit = (this.dayMap || {})[iso]
    this.setData(
      {
        selectedDate: iso,
        selectedDateText: fmt.dateCN(iso, { withYear: true }),
        selectedItems: hit ? hit.items : [],
        selectedTotalText: hit ? hit.totalText : '0.00',
      },
      this.buildRowsInto.bind(this)
    )
  },

  buildRowsInto() {
    this.setData({ rows: this.buildRows() })
  },

  retry() {
    this.load()
  },

  goDividend(e) {
    ui.navTo('/pages/dividend-create/index?id=' + e.currentTarget.dataset.id)
  },
})
