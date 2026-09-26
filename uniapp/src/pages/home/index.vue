<template>
  <!-- 首页：一眼看到「今年收了多少 / 接下来还有多少」 -->
  <view class="page">
    <!-- 加载失败：给出可点击的重试，而不是一个空白页 -->
    <view v-if="error" class="error-card" @tap="load">
      <view class="error-title">加载失败</view>
      <view class="error-msg">{{ error }}</view>
      <view class="error-retry">点击重试</view>
    </view>

    <!-- 主卡片 -->
    <view class="hero">
      <view class="hero-top">
        <text class="hero-greet">{{ greeting }}{{ userName ? '，' + userName : '' }}</text>
        <text class="hero-year">{{ year }} 年</text>
      </view>
      <view class="hero-label">已到账分红</view>
      <view class="hero-value num">¥{{ summary.receivedText }}</view>
      <view class="hero-split">
        <view class="hero-split-item">
          <text class="hero-split-label">全年预计</text>
          <text class="hero-split-value num">¥{{ summary.estimatedText }}</text>
        </view>
        <view class="hero-divider"></view>
        <view class="hero-split-item">
          <text class="hero-split-label">待收</text>
          <text class="hero-split-value num">¥{{ summary.pendingText }}</text>
        </view>
      </view>
    </view>

    <!-- 最近一笔 -->
    <view v-if="next" class="card next-card">
      <view class="row-between">
        <view class="col">
          <text class="next-label">下一笔预计到账</text>
          <text class="next-name">
            {{ next.securityName }}
            <text class="next-code">{{ next.securityCode }}</text>
          </text>
        </view>
        <view class="next-amount num">¥{{ next.amountText }}</view>
      </view>
      <view class="next-foot">
        <text class="tag" :class="next.isSoon ? '' : 'tag--muted'">{{ next.countdownText }}</text>
        <text class="muted">{{ next.dateText }}</text>
      </view>
    </view>

    <!-- 本月 -->
    <view v-if="currentMonth" class="card month-card" @tap="goStatistics">
      <view class="row-between">
        <view class="col">
          <text class="muted">{{ currentMonth.monthLabel }}已到账</text>
          <text class="month-amount num">¥{{ currentMonth.amountText }}</text>
        </view>
        <text class="chevron">›</text>
      </view>
    </view>

    <!-- 快捷入口 -->
    <view class="quick">
      <view class="quick-item" @tap="goCreate">
        <view class="quick-icon">＋</view>
        <text class="quick-label">记一笔</text>
      </view>
      <view class="quick-item" @tap="goCalendar">
        <view class="quick-icon">日</view>
        <text class="quick-label">分红日历</text>
      </view>
      <view class="quick-item" @tap="goHoldings">
        <view class="quick-icon">仓</view>
        <text class="quick-label">我的持仓</text>
      </view>
      <view class="quick-item" @tap="goStatistics">
        <view class="quick-icon">统</view>
        <text class="quick-label">统计分析</text>
      </view>
    </view>

    <!-- 最近记录 -->
    <view class="row-between section-head">
      <text class="section-title">最近记录</text>
      <text class="section-more" @tap="goDividends">全部 ›</text>
    </view>

    <view class="card card-tight">
      <template v-if="recent.length">
        <view
          v-for="item in recent"
          :key="item.id"
          class="list-item list-item--tap"
          @tap="goDetail(item.id)"
        >
          <view class="flex-1 col">
            <text class="ellipsis item-name">{{ item.securityName }}</text>
            <text class="muted">
              {{ item.dateText }} · {{ item.sharesText }} 股 × {{ item.perShareText }}
            </text>
          </view>
          <view class="col item-right">
            <text class="num item-amount">¥{{ item.amountText }}</text>
            <text class="tag" :class="item.statusCls">{{ item.statusLabel }}</text>
          </view>
        </view>
      </template>

      <view v-else-if="loading" class="placeholder">加载中…</view>

      <view v-else class="placeholder">
        <text>还没有分红记录</text>
        <text class="placeholder-action" @tap="goCreate">记第一笔 ›</text>
      </view>
    </view>
  </view>
</template>

<script setup>
/**
 * 首页。
 *
 * 对应原生版的 pages/home/index.{js,wxml,wxss}。模板基本是逐行对照，语法映射：
 *   wx:if → v-if / wx:elif → v-else-if / wx:else → v-else
 *   wx:for → v-for（要配 :key）/ <block> → <template>
 *   bindtap → @tap / catchtap → @tap.stop
 * 逻辑从 setData 改成 ref —— 这是主要需要动脑的地方。
 */
import { ref } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import * as api from '../../services/api'
import * as auth from '../../services/auth'
import * as fmt from '../../utils/format'
import * as ui from '../../utils/ui'
import * as decorate from '../../utils/decorate'

function greetingOf(hour) {
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

const now = fmt.today()
const cachedUser = auth.getUser()

const loading = ref(true)
const error = ref('')
const year = ref(now.year)
const greeting = ref(greetingOf(new Date().getHours()))
const userName = ref((cachedUser && cachedUser.nickname) || '')
const summary = ref({ estimatedText: '0.00', receivedText: '0.00', pendingText: '0.00' })
const next = ref(null)
const currentMonth = ref(null)
const recent = ref([])

function apply(res) {
  year.value = res.year
  summary.value = decorate.summary(res.summary)
  next.value = res.next_dividend ? decorate.nextDividend(res.next_dividend) : null

  const cm = res.current_month || { month: 0, amount: 0 }
  currentMonth.value = {
    month: cm.month,
    monthLabel: cm.month + ' 月',
    amountText: fmt.money(cm.amount),
  }
  recent.value = (res.recent_dividends || []).map(decorate.dividend)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    apply(await api.dashboard.get({ year: year.value }))
  } catch (err) {
    error.value = err.message || '加载失败'
  } finally {
    loading.value = false
  }
}

// 用 onShow 而不是 onLoad：从"记一笔"返回后要立刻看到新数据
onShow(() => {
  load()
})

onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

// --- 导航 ---------------------------------------------------------------

function goCreate() {
  ui.navTo('/pages/dividend-create/index')
}

function goDetail(id) {
  if (id) ui.navTo('/pages/dividend-create/index?id=' + id)
}

function goHoldings() {
  ui.switchTab('/pages/holdings/index')
}

function goDividends() {
  ui.switchTab('/pages/dividends/index')
}

function goCalendar() {
  ui.navTo('/pages/calendar/index')
}

function goStatistics() {
  ui.switchTab('/pages/statistics/index')
}
</script>

<style scoped>
/* 首页 */

.error-card {
  background: var(--c-danger-soft);
  border-radius: var(--r-card);
  padding: 28rpx 32rpx;
  margin-bottom: var(--gap);
}

.error-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--c-danger);
}

.error-msg {
  font-size: 24rpx;
  color: var(--c-danger);
  margin-top: 8rpx;
  opacity: 0.85;
}

.error-retry {
  font-size: 24rpx;
  color: var(--c-danger);
  margin-top: 12rpx;
  text-decoration: underline;
}

/* --- 主卡片 -------------------------------------------------------------- */

.hero {
  background: linear-gradient(135deg, #0b7a5a 0%, #0a5f47 100%);
  border-radius: 24rpx;
  padding: 36rpx 36rpx 24rpx;
  margin-bottom: var(--gap);
  color: #fff;
  box-shadow: 0 12rpx 36rpx rgba(11, 122, 90, 0.22);
}

.hero-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 28rpx;
}

.hero-greet {
  font-size: 26rpx;
  opacity: 0.8;
}

.hero-year {
  font-size: 24rpx;
  opacity: 0.7;
  background: rgba(255, 255, 255, 0.16);
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
}

.hero-label {
  font-size: 26rpx;
  opacity: 0.78;
}

.hero-value {
  font-size: 76rpx;
  font-weight: 700;
  letter-spacing: -1.5rpx;
  line-height: 1.15;
  margin: 4rpx 0 8rpx;
}

.hero-split {
  display: flex;
  align-items: center;
  border-top: 1rpx solid rgba(255, 255, 255, 0.18);
  padding-top: 24rpx;
  margin-top: 20rpx;
}

.hero-split-item {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.hero-split-label {
  font-size: 24rpx;
  opacity: 0.7;
}

.hero-split-value {
  font-size: 34rpx;
  font-weight: 600;
  margin-top: 4rpx;
}

.hero-divider {
  width: 1rpx;
  height: 56rpx;
  background: rgba(255, 255, 255, 0.18);
  margin: 0 24rpx;
}

/* --- 下一笔 -------------------------------------------------------------- */

.next-card {
  padding: 28rpx 32rpx;
}

.next-label {
  font-size: 24rpx;
  color: var(--c-text-3);
}

.next-name {
  font-size: 32rpx;
  font-weight: 600;
  margin-top: 6rpx;
}

.next-code {
  font-size: 24rpx;
  color: var(--c-text-3);
  font-weight: 400;
}

.next-amount {
  font-size: 40rpx;
  font-weight: 700;
  color: var(--c-gold);
}

.next-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20rpx;
}

/* --- 本月 ---------------------------------------------------------------- */

.month-card {
  padding: 24rpx 32rpx;
}

.month-amount {
  font-size: 36rpx;
  font-weight: 600;
  margin-top: 4rpx;
}

.chevron {
  color: var(--c-text-3);
  font-size: 40rpx;
  line-height: 1;
}

/* --- 快捷入口 ------------------------------------------------------------ */

.quick {
  display: flex;
  background: var(--c-card);
  border-radius: var(--r-card);
  padding: 28rpx 0;
  margin-bottom: var(--gap);
}

.quick-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.quick-item:active {
  opacity: 0.6;
}

.quick-icon {
  width: 76rpx;
  height: 76rpx;
  border-radius: 24rpx;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-size: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12rpx;
}

.quick-label {
  font-size: 24rpx;
  color: var(--c-text-2);
}

/* --- 最近记录 ------------------------------------------------------------ */

.section-head {
  margin: 8rpx 0 16rpx;
  padding: 0 4rpx;
}

.section-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--c-text-2);
  margin: 0;
}

.section-more {
  font-size: 24rpx;
  color: var(--c-text-3);
}

.item-name {
  font-size: 30rpx;
  font-weight: 500;
}

.item-right {
  align-items: flex-end;
  margin-left: 16rpx;
}

.item-amount {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--c-primary);
  margin-bottom: 6rpx;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 72rpx 0;
  color: var(--c-text-3);
  font-size: 26rpx;
}

.placeholder-action {
  margin-top: 16rpx;
  color: var(--c-primary);
  font-size: 26rpx;
}
</style>
