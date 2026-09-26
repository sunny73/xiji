const api = require('../../services/api')
const ui = require('../../utils/ui')
const v = require('../../utils/validate')
const { MARKETS, SECURITY_TYPES } = require('../../utils/constants')
const sec = require('../../utils/security')

Page({
  data: {
    accounts: [],
    accountNames: [],
    accountIndex: 0,

    code: '',
    name: '',
    marketIndex: 0,
    typeIndex: 0,
    marketOptions: MARKETS,
    typeOptions: SECURITY_TYPES,

    // 查询到的已有标的；为空表示"这是个新标的，需要填名称"
    security: null,
    looking: false,
    notFound: false,
    codeTouched: false,

    shares: '',
    costPrice: '',
    submitting: false,
  },

  onLoad(query) {
    this.presetAccountId = (query && query.account_id) || ''
    this.loadAccounts()
  },

  loadAccounts() {
    const that = this
    api.accounts
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
            content: '持仓必须属于某个账户，先去创建一个吧',
            confirmText: '去创建',
          }).then(function (ok) {
            if (ok) wx.redirectTo({ url: '/pages/accounts/index' })
            else ui.back()
          })
        }
      })
      .catch(function (err) {
        ui.error(err)
      })
  },

  // --- 输入 ---------------------------------------------------------------

  onAccountChange(e) {
    this.setData({ accountIndex: Number(e.detail.value) })
  },

  onCodeInput(e) {
    // 一旦用户改了代码，之前查到的 security 立刻作废。
    // 不这么做的话：查 601988 得到"中国银行" -> 改成 601857 -> 保存，
    // 会拿着旧 security 建仓，持仓就记到错误标的上，而且用户看不出来。
    // lastLookup 置空 = 作废在途的查询请求，否则它回来时会把已清掉的 security 又填回去
    this.lastLookup = null
    this.setData({
      code: e.detail.value,
      codeTouched: true,
      security: null,
      notFound: false,
      looking: false,
    })
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },

  onSharesInput(e) {
    this.setData({ shares: e.detail.value })
  },

  onCostInput(e) {
    this.setData({ costPrice: e.detail.value })
  },

  onMarketChange(e) {
    this.setData({ marketIndex: Number(e.detail.value) })
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) })
  },

  /** 失焦时去后端查一下这个代码是否已存在 */
  onCodeBlur() {
    this.lookup()
  },

  lookup() {
    const that = this
    const checked = v.securityCode(this.data.code)
    if (!checked.ok) {
      // 代码不合法（比如被清空了）：清干净并作废在途请求，
      // 否则稍后返回的旧响应会把已经清掉的 security 又"复活"
      this.lastLookup = null
      this.setData({ security: null, notFound: false, looking: false })
      return Promise.resolve(null)
    }
    const code = checked.value
    this.setData({ looking: true })
    this.lastLookup = code

    return api.securities
      .list({ keyword: code, limit: 20 })
      .then(function (list) {
        // 用户可能已经改了输入框，丢弃过期结果
        if (that.lastLookup !== code) return null
        const hit = (list || []).filter(function (s) {
          return String(s.code).toUpperCase() === code
        })[0]
        if (hit) {
          that.setData({ looking: false, security: hit, name: hit.name, notFound: false })
        } else {
          that.setData({ looking: false, security: null, notFound: true })
        }
        return hit || null
      })
      .catch(function () {
        if (that.lastLookup !== code) return
        // 查不到（网络抖了 / 401 重试失败）时按"新标的"处理：
        // 否则 notFound 一直是 false，名称输入框不渲染，用户每次保存都被
        // 提示"请填写标的名称"却根本没有地方可填
        that.setData({ looking: false, security: null, notFound: true })
      })
  },

  // --- 保存 ---------------------------------------------------------------

  save() {
    if (this.data.submitting) return
    const that = this
    const d = this.data

    if (!d.accounts.length) {
      ui.toast('请先创建账户')
      return
    }

    const codeCheck = v.securityCode(d.code)
    const sharesCheck = v.parseAmount(d.shares, { label: '股数', min: 0.0001, decimals: 4 })
    const costCheck = v.parseAmount(d.costPrice, {
      label: '成本价',
      optional: true,
      min: 0,
      decimals: 4,
    })

    // 只有当缓存的 security 确实对应当前代码时才算"已存在"。
    // 否则（用户改过代码）必须按新标的处理，要求填名称。
    const reuse = sec.canReuseSecurity(d.security, codeCheck.ok ? codeCheck.value : '')
    const nameCheck = reuse ? { ok: true } : v.requiredText(d.name, '标的名称')

    const message = v.firstError([codeCheck, nameCheck, sharesCheck, costCheck])
    if (message) {
      ui.toast(message)
      return
    }

    this.setData({ submitting: true })

    this.ensureSecurity(codeCheck.value, nameCheck.value)
      .then(function (security) {
        return api.holdings.create({
          account_id: d.accounts[d.accountIndex].id,
          security_id: security.id,
          shares: sharesCheck.value,
          cost_price: costCheck.value,
        })
      })
      .then(function () {
        ui.success('已添加')
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
   * 拿到可用的 security：能复用就复用，否则先建（POST /securities 是幂等的）。
   *
   * 复用前**必须**确认缓存里的 code 和当前输入一致 —— 用户可能查完 601988
   * 之后又把代码改成了 601857，这时复用旧对象会把持仓记到错误的标的上。
   */
  ensureSecurity(code, name) {
    const resolved = sec.resolveSecurity(this.data.security, code)
    if (resolved.security) return Promise.resolve(resolved.security)
    return api.securities.create({
      code: code,
      name: name,
      market: MARKETS[this.data.marketIndex].value,
      type: SECURITY_TYPES[this.data.typeIndex].value,
    })
  },
})
