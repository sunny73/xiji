const api = require('../../services/api')
const ui = require('../../utils/ui')
const decorate = require('../../utils/decorate')
const { ACCOUNT_TYPES } = require('../../utils/constants')

Page({
  data: {
    loading: true,
    error: '',
    accounts: [],

    showForm: false,
    editingId: '',
    formTitle: '新建账户',
    formName: '',
    typeOptions: ACCOUNT_TYPES,
    formTypeIndex: 0,
    submitting: false,
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
    this.setData({ loading: true, error: '' })
    return api.accounts
      .list()
      .then(function (list) {
        that.setData({
          loading: false,
          accounts: (list || []).map(decorate.account),
        })
      })
      .catch(function (err) {
        that.setData({ loading: false, error: err.message || '加载失败' })
      })
  },

  // --- 表单 ---------------------------------------------------------------

  openCreate() {
    this.setData({
      showForm: true,
      editingId: '',
      formTitle: '新建账户',
      formName: '',
      formTypeIndex: 0,
    })
  },

  openEdit(account) {
    let typeIndex = 0
    ACCOUNT_TYPES.forEach(function (t, i) {
      if (t.value === account.type) typeIndex = i
    })
    this.setData({
      showForm: true,
      editingId: account.id,
      formTitle: '编辑账户',
      formName: account.name,
      formTypeIndex: typeIndex,
    })
  },

  closeForm() {
    this.setData({ showForm: false, submitting: false })
  },

  onNameInput(e) {
    this.setData({ formName: e.detail.value })
  },

  onTypeChange(e) {
    this.setData({ formTypeIndex: Number(e.detail.value) })
  },

  submit() {
    if (this.data.submitting) return
    const that = this
    const name = String(this.data.formName || '').trim()

    if (!name) {
      ui.toast('请填写账户名称')
      return
    }
    if (name.length > 100) {
      ui.toast('名称太长了')
      return
    }

    const payload = {
      name: name,
      type: ACCOUNT_TYPES[this.data.formTypeIndex].value,
    }

    this.setData({ submitting: true })

    const request = this.data.editingId
      ? api.accounts.update(this.data.editingId, payload)
      : api.accounts.create(payload)

    request
      .then(function () {
        that.setData({ submitting: false, showForm: false })
        ui.success(that.data.editingId ? '已保存' : '已创建')
        return that.load()
      })
      .catch(function (err) {
        that.setData({ submitting: false })
        ui.error(err)
      })
  },

  // --- 行操作 -------------------------------------------------------------

  onAccountTap(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    const account = this.data.accounts.filter(function (a) {
      return a.id === id
    })[0]
    if (!account) return

    wx.showActionSheet({
      itemList: ['重命名 / 改类型', '删除账户'],
      itemColor: '#1A1D24',
      success(res) {
        if (res.tapIndex === 0) that.openEdit(account)
        else if (res.tapIndex === 1) that.remove(account)
      },
      fail() {
        /* 用户取消 */
      },
    })
  },

  remove(account) {
    const that = this
    ui.confirm({
      title: '删除账户',
      content:
        '「' + account.name + '」下的持仓和分红记录会一并删除，且无法恢复。确定吗？',
      confirmText: '删除',
      danger: true,
    }).then(function (ok) {
      if (!ok) return
      api.accounts
        .remove(account.id)
        .then(function () {
          ui.success('已删除')
          return that.load()
        })
        .catch(ui.error)
    })
  },

  retry() {
    this.load()
  },
})
