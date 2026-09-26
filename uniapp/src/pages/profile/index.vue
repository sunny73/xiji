<template>
  <view class="page">
    <!-- 用户 -->
    <view class="card user-card">
      <view class="avatar">{{ initial }}</view>
      <view class="flex-1 col user-info">
        <template v-if="!editing">
          <text class="user-name">{{ nickname || '未设置昵称' }}</text>
          <text class="muted" @tap="startEdit">点击修改昵称</text>
        </template>
        <template v-else>
          <input
            class="nickname-input"
            type="nickname"
            placeholder="输入昵称"
            placeholder-class="form-placeholder"
            :value="nickname"
            @input="nickname = $event.detail.value"
          />
          <view class="nickname-actions">
            <text class="mini-link" @tap="cancelEdit">取消</text>
            <text class="mini-link mini-link--primary" @tap="saveNickname">
              {{ saving ? '保存中…' : '保存' }}
            </text>
          </view>
        </template>
      </view>
    </view>

    <!-- 数据 -->
    <view class="card card-tight">
      <view class="list-item list-item--tap" @tap="goAccounts">
        <text class="flex-1">投资账户</text>
        <text class="muted">{{ accountCount }} 个</text>
        <text class="chevron">›</text>
      </view>
      <view class="list-item list-item--tap" @tap="goHoldings">
        <text class="flex-1">我的持仓</text>
        <text class="chevron">›</text>
      </view>
      <view class="list-item list-item--tap" @tap="goCalendar">
        <text class="flex-1">分红日历</text>
        <text class="chevron">›</text>
      </view>
    </view>

    <!-- 开发工具（生产环境不该出现，用 env 控制） -->
    <template v-if="isDev">
      <view class="section-head">
        <text class="section-title">开发工具</text>
      </view>

      <view class="card card-tight">
        <view class="list-item list-item--tap" @tap="showBaseUrl">
          <text class="flex-1">后端地址</text>
          <text class="muted ellipsis url-text">{{ baseUrl }}</text>
          <text class="chevron">›</text>
        </view>
        <view class="list-item list-item--tap" @tap="switchUser">
          <text class="flex-1">切换开发身份</text>
          <text class="muted ellipsis url-text">{{ devOpenid || '未固定' }}</text>
          <text class="chevron">›</text>
        </view>
      </view>
    </template>

    <!-- 账号 -->
    <view class="card card-tight">
      <view class="list-item list-item--tap" @tap="logout">
        <text class="flex-1 c-danger">退出登录</text>
      </view>
    </view>

    <view class="about">分红管家 v0.1.0 · uni-app</view>
  </view>
</template>

<script setup>
/**
 * 「我的」页。
 *
 * 和原版的差异：wx.showModal({ editable: true }) 在 H5 上不可用，
 * 所以「切换开发身份」改成跳到一个输入浮层（用 uni.showModal 的 editable，
 * 小程序端支持，H5 端 uni-app 也做了 polyfill —— 这里保留原写法并做兜底）。
 */
import { ref } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import * as api from '../../services/api'
import * as auth from '../../services/auth'
import config from '../../utils/config'
import * as ui from '../../utils/ui'

const loading = ref(false)
const nickname = ref('')
const initial = ref('我')
const editing = ref(false)
const saving = ref(false)
const accountCount = ref(0)

const baseUrl = config.baseUrl
const devOpenid = config.devOpenid || ''
const isDev = config.env === 'dev'

onShow(() => {
  refresh()
})

onPullDownRefresh(async () => {
  await refresh()
  uni.stopPullDownRefresh()
})

function applyUser(user) {
  const name = (user && user.nickname) || ''
  nickname.value = name
  initial.value = name ? name.slice(0, 1) : '我'
}

async function refresh() {
  loading.value = true

  // 先渲染缓存里的用户，避免白屏；再拉一次最新的
  applyUser(auth.getUser())

  try {
    applyUser(await api.auth.me())
    const accounts = await api.accounts.list()
    accountCount.value = accounts.length
  } catch (err) {
    // /auth/me 失败交给 api 层的 401 重试处理；这里只结束 loading
  } finally {
    loading.value = false
  }
}

// --- 昵称 ---------------------------------------------------------------

function startEdit() {
  editing.value = true
}

function cancelEdit() {
  applyUser(auth.getUser())
  editing.value = false
}

async function saveNickname() {
  if (saving.value) return

  const name = String(nickname.value || '').trim()
  if (!name) {
    ui.toast('昵称不能为空')
    return
  }
  if (name.length > 100) {
    ui.toast('昵称太长了')
    return
  }

  saving.value = true
  try {
    const user = await api.auth.updateMe({ nickname: name })
    uni.setStorageSync(auth.USER_KEY, user)
    applyUser(user)
    editing.value = false
    ui.success('已保存')
  } catch (err) {
    ui.error(err)
  } finally {
    saving.value = false
  }
}

// --- 跳转 ---------------------------------------------------------------

function goAccounts() {
  ui.navTo('/pages/accounts/index')
}

function goCalendar() {
  ui.navTo('/pages/calendar/index')
}

function goHoldings() {
  ui.switchTab('/pages/holdings/index')
}

// --- 开发工具 -----------------------------------------------------------

function showBaseUrl() {
  ui.confirm({
    title: '后端地址',
    content: config.baseUrl + '\n\n真机调试时改成电脑的局域网 IP，例如 http://192.168.1.8:8000/api/v1',
    confirmText: '知道了',
    cancelText: '关闭',
  })
}

/** 换一个 openid 登录，用来验证「A 用户看不到 B 用户数据」 */
function switchUser() {
  uni.showModal({
    title: '切换开发身份',
    editable: true,
    placeholderText: '输入 openid，如 tester-b',
    success: async (res) => {
      if (!res.confirm) return
      const openid = String(res.content || '').trim()
      if (!openid) return

      ui.loading('切换中')
      try {
        await auth.switchDevUser(openid)
        ui.hideLoading()
        ui.success('已切换为 ' + openid)
        setTimeout(() => uni.reLaunch({ url: '/pages/home/index' }), 800)
      } catch (err) {
        ui.hideLoading()
        ui.error(err)
      }
    },
  })
}

async function logout() {
  const ok = await ui.confirm({
    title: '退出登录',
    content: '本地登录凭证会被清除，下次进入需重新登录',
    confirmText: '退出',
    danger: true,
  })
  if (!ok) return
  auth.logout()
  uni.reLaunch({ url: '/pages/home/index' })
}
</script>

<style scoped>
/* 我的 */

.user-card {
  display: flex;
  align-items: center;
}

.avatar {
  width: 112rpx;
  height: 112rpx;
  border-radius: 56rpx;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-size: 44rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 28rpx;
  flex-shrink: 0;
}

.user-info {
  justify-content: center;
}

.user-name {
  font-size: 34rpx;
  font-weight: 600;
  margin-bottom: 6rpx;
}

.nickname-input {
  font-size: 32rpx;
  border-bottom: 1rpx solid var(--c-line);
  padding-bottom: 8rpx;
  width: 100%;
}

.nickname-actions {
  display: flex;
  margin-top: 16rpx;
}

.mini-link {
  font-size: 26rpx;
  color: var(--c-text-3);
  margin-right: 36rpx;
}

.mini-link--primary {
  color: var(--c-primary);
  font-weight: 500;
}

.section-head {
  margin: 8rpx 0 16rpx;
  padding: 0 4rpx;
}

.section-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--c-text-2);
}

.chevron {
  color: var(--c-text-3);
  font-size: 36rpx;
  margin-left: 12rpx;
}

.url-text {
  max-width: 340rpx;
}

.about {
  text-align: center;
  font-size: 22rpx;
  color: var(--c-text-3);
  padding: 40rpx 0 20rpx;
}
</style>
