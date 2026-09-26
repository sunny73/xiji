/**
 * 交互反馈的统一封装。
 *
 * 页面里不要直接写 uni.showToast，原因有两个：
 *   1. 文案风格会飘（"保存失败" / "保存不成功" / "操作失败"）
 *   2. 出错时到底该 toast 还是该内联显示，需要一个统一决策点
 */

/** 普通提示 */
function toast(title, icon) {
  uni.showToast({
    title: String(title || ''),
    icon: icon || 'none',
    duration: 2000,
  })
}

/** 成功提示（带对勾图标） */
function success(title) {
  uni.showToast({ title: title || '已完成', icon: 'success', duration: 1500 })
}

/** 把 Error 对象直接转成提示 */
function error(err) {
  const message = err && err.message ? err.message : '操作失败，请稍后重试'
  uni.showToast({ title: message, icon: 'none', duration: 2500 })
}

function loading(title) {
  uni.showLoading({ title: title || '加载中', mask: true })
}

function hideLoading() {
  uni.hideLoading()
}

/**
 * 确认框，Promise 化。
 * @returns {Promise<boolean>}
 */
function confirm(options) {
  const opts = options || {}
  return new Promise(function (resolve) {
    uni.showModal({
      title: opts.title || '确认',
      content: opts.content || '',
      confirmText: opts.confirmText || '确定',
      cancelText: opts.cancelText || '取消',
      confirmColor: opts.danger ? '#D9534F' : '#0B7A5A',
      success(res) {
        resolve(!!res.confirm)
      },
      fail() {
        resolve(false)
      },
    })
  })
}

/** 危险操作确认（删除），文案统一 */
function confirmDelete(name) {
  return confirm({
    title: '确认删除',
    content: '删除后无法恢复' + (name ? '，确定删除「' + name + '」吗？' : '，确定吗？'),
    confirmText: '删除',
    danger: true,
  })
}

function navTo(url) {
  uni.navigateTo({ url: url })
}

function switchTab(url) {
  uni.switchTab({ url: url })
}

function back(delta) {
  uni.navigateBack({ delta: delta || 1 })
}

export {
  toast,
  success,
  error,
  loading,
  hideLoading,
  confirm,
  confirmDelete,
  navTo,
  switchTab,
  back,
}
