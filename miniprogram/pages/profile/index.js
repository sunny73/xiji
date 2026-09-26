const api = require('../../services/api')
const auth = require('../../services/auth')
const config = require('../../utils/config')
const ui = require('../../utils/ui')

Page({
  data: {
    loading: true,
    user: null,
    initial: '我',
    nickname: '',
    editing: false,
    saving: false,

    baseUrl: config.baseUrl,
    env: config.env,
    devOpenid: config.devOpenid || '',

    accountCount: 0,
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  refresh() {
    const that = this
    this.setData({ loading: true })

    // 先渲染缓存里的用户，避免白屏；再拉一次最新的
    const cached = auth.getUser()
    if (cached) this.applyUser(cached)

    return api.auth
      .me()
      .then(function (user) {
        that.applyUser(user)
        return api.accounts.list()
      })
      .then(function (accounts) {
        that.setData({ loading: false, accountCount: accounts.length })
      })
      .catch(function () {
        // /auth/me 失败交给 api 层的 401 重试处理；这里只结束 loading
        that.setData({ loading: false })
      })
  },

  applyUser(user) {
    const nickname = (user && user.nickname) || ''
    this.setData({
      user: user,
      nickname: nickname,
      initial: nickname ? nickname.slice(0, 1) : '我',
    })
  },

  // --- 昵称 ---------------------------------------------------------------

  startEdit() {
    this.setData({ editing: true })
  },

  cancelEdit() {
    const u = this.data.user || {}
    this.setData({ editing: false, nickname: u.nickname || '' })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  saveNickname() {
    if (this.data.saving) return
    const that = this
    const nickname = String(this.data.nickname || '').trim()

    if (!nickname) {
      ui.toast('昵称不能为空')
      return
    }
    if (nickname.length > 100) {
      ui.toast('昵称太长了')
      return
    }

    this.setData({ saving: true })
    api.auth
      .updateMe({ nickname: nickname })
      .then(function (user) {
        wx.setStorageSync(auth.USER_KEY, user)
        that.applyUser(user)
        that.setData({ saving: false, editing: false })
        ui.success('已保存')
      })
      .catch(function (err) {
        that.setData({ saving: false })
        ui.error(err)
      })
  },

  // --- 跳转 ---------------------------------------------------------------

  goAccounts() {
    ui.navTo('/pages/accounts/index')
  },

  goCalendar() {
    ui.navTo('/pages/calendar/index')
  },

  goHoldings() {
    ui.switchTab('/pages/holdings/index')
  },

  // --- 开发工具 -----------------------------------------------------------

  showBaseUrl() {
    ui.confirm({
      title: '后端地址',
      content: config.baseUrl + '\n\n真机调试时要改成电脑的局域网 IP，例如 http://192.168.1.8:8000/api/v1',
      confirmText: '知道了',
      cancelText: '关闭',
    })
  },

  /** 换一个 openid 登录，用来验证「A 用户看不到 B 用户数据」 */
  switchUser() {
    wx.showModal({
      title: '切换开发身份',
      editable: true,
      placeholderText: '输入 openid，如 tester-b',
      success(res) {
        if (!res.confirm) return
        const openid = String(res.content || '').trim()
        if (!openid) return
        ui.loading('切换中')
        auth
          .switchDevUser(openid)
          .then(function () {
            ui.hideLoading()
            ui.success('已切换为 ' + openid)
            setTimeout(function () {
              wx.reLaunch({ url: '/pages/home/index' })
            }, 800)
          })
          .catch(function (err) {
            ui.hideLoading()
            ui.error(err)
          })
      },
    })
  },

  logout() {
    ui.confirm({
      title: '退出登录',
      content: '本地登录凭证会被清除，下次进入需重新登录',
      confirmText: '退出',
      danger: true,
    }).then(function (ok) {
      if (!ok) return
      auth.logout()
      wx.reLaunch({ url: '/pages/home/index' })
    })
  },
})
