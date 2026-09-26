const api = require('../../services/api')
const fmt = require('../../utils/format')
const ui = require('../../utils/ui')
const v = require('../../utils/validate')
const decorate = require('../../utils/decorate')
const { MARKETS, SECURITY_TYPES, DIVIDEND_STATUS } = require('../../utils/constants')
const sec = require('../../utils/security')

const STATUS_OPTIONS = [
  { value: 'pending', label: DIVIDEND_STATUS.pending.label },
  { value: 'received', label: DIVIDEND_STATUS.received.label },
]

Page({
  data: {
    // create | edit
    mode: 'create',
    id: '',

    accounts: [],
    accountNames: [],
    accountIndex: 0,

    code: '',
    name: '',
    marketIndex: 0,
    typeIndex: 0,
    marketOptions: MARKETS,
    typeOptions: SECURITY_TYPES,
    security: null,
    looking: false,
    notFound: false,
    presetLocked: false,

    paymentDate: '',
    shares: '',
    perShare: '',
    // ⚠️ 只是给用户看的实时预览，提交时**不会**带上这个字段
    amountPreview: '',

    statusOptions: STATUS_OPTIONS,
    statusIndex: 0,

    note: '',
    submitting: false,

    // 编辑模式下账户/标的不可改，只读展示
    lockedAccountName: '',
    lockedSecurityName: '',
  },

  onLoad(query) {
    const q = query || {}
    const today = fmt.today()
    this.presetAccountId = q.account_id || ''
    this.presetSecurityId = q.security_id || ''
    this.presetSecurityName = q.security_name ? decodeURIComponent(q.security_name) : ''

    this.setData({
      mode: q.id ? 'edit' : 'create',
      id: q.id || '',
      // 从持仓详情带 security_id 进来时，标的已确定，不再让用户搜一次
      presetLocked: !!q.security_id,
      paymentDate: fmt.dateISO(today.year + '-' + today.month + '-' + today.day),
    })

    if (q.id) this.loadForEdit(q.id)
    else this.loadAccounts()
  },

  // --- 初始化 -------------------------------------------------------------

  loadAccounts() {
    const that = this
    return api.accounts
      .list()
      .then(function (accounts) {
        const names = accounts.map(function (a) {
          return a.name
        })
        let index = 0
        if (that.presetAccountId) {
          accounts.forEach(function (a, i) {
            if (a.id === that.presetAccountId) index = i
          })
        }
        that.setData({ accounts: accounts, accountNames: names, accountIndex: index })

        if (!accounts.length) {
          ui.confirm({
            title: '还没有账户',
            content: '分红记录必须属于某个账户，先去创建一个吧',
            confirmText: '去创建',
          }).then(function (ok) {
            if (ok) wx.redirectTo({ url: '/pages/accounts/index' })
            else ui.back()
          })
          return
        }

        // 从持仓详情跳过来时带了 security_id，直接锁定标的
        if (that.presetSecurityId) {
          return api.securities.detail(that.presetSecurityId).then(function (sec) {
            that.setData({
              security: sec,
              code: sec.code,
              name: sec.name,
              notFound: false,
            })
          })
        }
        return null
      })
      .catch(function (err) {
        ui.error(err)
      })
  },

  loadForEdit(id) {
    const that = this
    ui.loading('加载中')

    return api.dividends
      .detail(id)
      .then(function (raw) {
        const d = decorate.dividend(raw)
        const statusIdx = STATUS_OPTIONS.map(function (s) {
          return s.value
        }).indexOf(d.status)

        that.setData({
          id: d.id,
          code: d.securityCode,
          name: d.securityName,
          security: { id: d.securityId, code: d.securityCode, name: d.securityName },
          paymentDate: d.paymentDate,
          shares: String(d.shares),
          perShare: String(d.perShare),
          note: d.note,
          statusIndex: statusIdx < 0 ? 0 : statusIdx,
          lockedAccountName: d.accountName,
          lockedSecurityName: d.securityName,
        })
        that.updatePreview()
        wx.setNavigationBarTitle({ title: '编辑分红' })
        ui.hideLoading()
      })
      .catch(function (err) {
        ui.hideLoading()
        ui.error(err)
      })
  },

  // --- 输入 ---------------------------------------------------------------

  onAccountChange(e) {
    this.setData({ accountIndex: Number(e.detail.value) })
  },

  onCodeInput(e) {
    // 改代码就作废缓存的 security：否则会把分红记到上一个标的上。
    // lastLookup 置空同时作废在途查询，避免旧响应把它又填回来。
    this.lastLookup = null
    this.setData({ code: e.detail.value, security: null, notFound: false, looking: false })
  },

  onCodeBlur() {
    this.lookup()
  },

  lookup() {
    const that = this
    const checked = v.securityCode(this.data.code)
    if (!checked.ok) {
      // 清空代码时也要作废在途请求，否则旧响应会把 security 又填回来
      this.lastLookup = null
      this.setData({ security: null, notFound: false, looking: false })
      return Promise.resolve()
    }
    const code = checked.value
    this.lastLookup = code
    this.setData({ looking: true })

    return api.securities
      .list({ keyword: code, limit: 20 })
      .then(function (list) {
        if (that.lastLookup !== code) return
        const hit = (list || []).filter(function (s) {
          return String(s.code).toUpperCase() === code
        })[0]
        if (hit) that.setData({ looking: false, security: hit, name: hit.name, notFound: false })
        else that.setData({ looking: false, security: null, notFound: true })
      })
      .catch(function () {
        if (that.lastLookup !== code) return
        // 查询失败时按"新标的"处理，保证名称输入框会出现，用户不会被卡住
        that.setData({ looking: false, security: null, notFound: true })
      })
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },

  onMarketChange(e) {
    this.setData({ marketIndex: Number(e.detail.value) })
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) })
  },

  onDateChange(e) {
    this.setData({ paymentDate: e.detail.value })
  },

  onSharesInput(e) {
    this.setData({ shares: e.detail.value }, this.updatePreview.bind(this))
  },

  onPerShareInput(e) {
    this.setData({ perShare: e.detail.value }, this.updatePreview.bind(this))
  },

  onStatusChange(e) {
    this.setData({ statusIndex: Number(e.detail.value) })
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value })
  },

  updatePreview() {
    const s = String(this.data.shares || '').trim()
    const p = String(this.data.perShare || '').trim()
    this.setData({
      amountPreview: s && p ? fmt.money(fmt.calcDividendAmount(s, p)) : '',
    })
  },

  // --- 保存 ---------------------------------------------------------------

  save() {
    if (this.data.submitting) return
    const that = this
    const d = this.data
    const isEdit = d.mode === 'edit'

    if (!isEdit && !d.accounts.length) {
      ui.toast('请先创建账户')
      return
    }

    const dateCheck = v.dateString(d.paymentDate, '派息日')
    const sharesCheck = v.parseAmount(d.shares, { label: '股数', min: 0.0001, decimals: 4 })
    const perShareCheck = v.parseAmount(d.perShare, {
      label: '每股分红',
      min: 0,
      decimals: 6,
    })
    const codeCheck = isEdit ? { ok: true } : v.securityCode(d.code)
    // 编辑模式标的不可改；新建时只有"缓存确实对应当前代码"才算已存在
    const reuse =
      isEdit || sec.canReuseSecurity(d.security, codeCheck.ok ? codeCheck.value : '')
    const nameCheck = reuse ? { ok: true } : v.requiredText(d.name, '标的名称')

    const message = v.firstError([codeCheck, nameCheck, dateCheck, sharesCheck, perShareCheck])
    if (message) {
      ui.toast(message)
      return
    }

    const payload = {
      payment_date: dateCheck.value,
      shares: sharesCheck.value,
      per_share: perShareCheck.value,
      status: STATUS_OPTIONS[d.statusIndex].value,
      note: d.note ? d.note : null,
    }
    // 注意：payload 里**没有 amount**。后端会按 shares × per_share 自己算，
    // 传了反而会被 422 拒绝（schema 里 extra="forbid"）。

    this.setData({ submitting: true })

    const request = isEdit
      ? api.dividends.update(d.id, payload)
      : this.ensureSecurity().then(function (security) {
          return api.dividends.create(
            Object.assign({}, payload, {
              account_id: d.accounts[d.accountIndex].id,
              security_id: security.id,
            })
          )
        })

    request
      .then(function () {
        ui.success(isEdit ? '已保存' : '已记录')
        setTimeout(function () {
          ui.back()
        }, 700)
      })
      .catch(function (err) {
        that.setData({ submitting: false })
        ui.error(err)
      })
  },

  /**
   * 标的不存在时先创建（POST /securities 是幂等的）。
   * code/name 不传则从 data 读（save() 里已经校验过，传进来更明确）。
   */
  ensureSecurity(code, name) {
    const d = this.data
    const targetCode = code || v.securityCode(d.code).value
    // 复用前必须确认缓存的 code 和当前输入一致，否则会写错标的
    const resolved = sec.resolveSecurity(d.security, targetCode)
    if (resolved.security) return Promise.resolve(resolved.security)
    return api.securities.create({
      code: targetCode,
      name: name || d.name,
      market: MARKETS[d.marketIndex].value,
      type: SECURITY_TYPES[d.typeIndex].value,
    })
  },

  remove() {
    const that = this
    ui.confirmDelete(this.data.lockedSecurityName).then(function (ok) {
      if (!ok) return
      api.dividends
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
})
