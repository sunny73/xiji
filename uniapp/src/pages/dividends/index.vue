<template>
  <view class="page">
    <view v-if="error" class="error-card" @tap="reload">
      <view class="error-title">加载失败</view>
      <view class="error-msg">{{ error }}</view>
      <view class="error-retry">点击重试</view>
    </view>

    <!-- 年度合计 -->
    <view class="summary">
      <view class="summary-item">
        <text class="summary-label">已到账</text>
        <text class="summary-value num c-primary">¥{{ receivedText }}</text>
      </view>
      <view class="summary-line"></view>
      <view class="summary-item">
        <text class="summary-label">待收</text>
        <text class="summary-value num c-gold">¥{{ pendingText }}</text>
      </view>
    </view>

    <!-- 筛选 -->
    <view class="filter-row">
      <view class="tabs">
        <view
          v-for="(item, index) in statusFilters"
          :key="item.value"
          class="tab"
          :class="{ 'tab--on': statusIndex === index }"
          @tap="onStatusChange(index)"
        >
          {{ item.label }}
        </view>
      </view>

      <picker mode="selector" :range="years" :value="yearIndex" @change="onYearChange">
        <view class="year-picker">{{ year }} 年 ›</view>
      </picker>
    </view>

    <!-- 列表 -->
    <view class="card card-tight">
      <template v-if="items.length">
        <view v-for="item in items" :key="item.id" class="list-item">
          <view class="flex-1 col" @tap="goDetail(item.id)">
            <view class="row">
              <text class="item-name ellipsis">{{ item.securityName }}</text>
              <text class="tag status-tag" :class="item.statusCls">{{ item.statusLabel }}</text>
            </view>
            <text class="muted">{{ item.dateText }} · {{ item.accountName }}</text>
            <text class="muted">{{ item.sharesText }} 股 × {{ item.perShareText }}</text>
          </view>
          <view class="col item-right">
            <text class="num item-amount">¥{{ item.amountText }}</text>
            <view v-if="!item.isReceived" class="mini-btn" @tap.stop="markReceived(item.id)">
              确认到账
            </view>
          </view>
        </view>
      </template>

      <view v-else-if="loading" class="placeholder">加载中…</view>

      <view v-else class="placeholder">
        <text>
          {{ year }} 年{{ statusIndex === 0 ? '' : statusFilters[statusIndex].label }}还没有记录
        </text>
        <text class="placeholder-action" @tap="goCreate">记一笔 ›</text>
      </view>
    </view>

    <view v-if="loadingMore" class="more">加载中…</view>
    <view v-else-if="items.length && !hasMore" class="more">共 {{ total }} 笔，已全部加载</view>
  </view>

  <view class="fab" @tap="goCreate">＋</view>
</template>

<script setup>
/**
 * 分红列表。
 *
 * ⚠️ 竞态守卫的粒度很关键（原版踩过坑）：
 *   只有 reload 递增守卫，分页**不**递增 —— 否则用户翻页会让在途的第 1 页失效，
 *   前 20 条被静默丢掉。而且 reload 必须同时复位 hasMore，
 *   不然列表已清空但 hasMore 还是 true，用户一滑就触发 loadMore。
 */
import { ref } from 'vue'
import { onLoad, onUnload, onShow, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import * as api from '../../services/api'
import * as fmt from '../../utils/format'
import * as ui from '../../utils/ui'
import * as decorate from '../../utils/decorate'
import { STATUS_FILTERS } from '../../utils/constants'
import { createGuard } from '../../utils/seq'

const PAGE_SIZE = 20

const guard = createGuard()
let token = null

const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')

const items = ref([])
const total = ref(0)
const page = ref(1)
const hasMore = ref(false)

const statusFilters = STATUS_FILTERS
const statusIndex = ref(0)

const years = ref([])
const yearIndex = ref(0)
const year = ref(0)

const receivedText = ref('0.00')
const pendingText = ref('0.00')

const now = fmt.today()
for (let i = 0; i < 6; i++) years.value.push(now.year - i)
year.value = now.year

onLoad(() => {
  reload()
})

onUnload(() => guard.invalidate())

// 从"记一笔"返回后要立刻刷新
onShow(() => {
  if (year.value) reload()
})

onPullDownRefresh(async () => {
  await reload()
  uni.stopPullDownRefresh()
})

onReachBottom(() => {
  if (hasMore.value && !loadingMore.value) loadMore()
})

async function fetchPage(pageNo, myToken) {
  const status = STATUS_FILTERS[statusIndex.value].value
  try {
    const res = await api.dividends.list({
      year: year.value,
      status,
      page: pageNo,
      page_size: PAGE_SIZE,
    })
    if (!guard.isCurrent(myToken)) return

    const fresh = (res.items || []).map(decorate.dividend)
    items.value = pageNo === 1 ? fresh : items.value.concat(fresh)
    total.value = res.total || 0
    page.value = pageNo
    hasMore.value = pageNo * PAGE_SIZE < (res.total || 0)
    error.value = ''
  } catch (err) {
    if (!guard.isCurrent(myToken)) return
    error.value = err.message || '加载失败'
  } finally {
    if (guard.isCurrent(myToken)) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

/** 顶部合计走 dashboard 接口，保证和首页数字一致（不受分页影响） */
async function fetchSummary(myToken) {
  try {
    const res = await api.dashboard.get({ year: year.value })
    if (!guard.isCurrent(myToken)) return
    receivedText.value = fmt.money(res.summary.received)
    pendingText.value = fmt.money(res.summary.pending)
  } catch (err) {
    /* 汇总失败不影响列表，静默 */
  }
}

async function reload() {
  // 只有"重新加载"才递增守卫
  token = guard.next()
  loading.value = true
  error.value = ''
  items.value = []
  page.value = 1
  // 必须和 items 一起复位
  hasMore.value = false
  loadingMore.value = false

  await Promise.all([fetchPage(1, token), fetchSummary(token)])
}

function loadMore() {
  if (!guard.isCurrent(token)) return
  loadingMore.value = true
  fetchPage(page.value + 1, token)
}

// --- 交互 ---------------------------------------------------------------

function onStatusChange(index) {
  if (index === statusIndex.value) return
  statusIndex.value = index
  reload()
}

function onYearChange(e) {
  const index = Number(e.detail.value)
  yearIndex.value = index
  year.value = years.value[index]
  reload()
}

function goCreate() {
  ui.navTo('/pages/dividend-create/index')
}

function goDetail(id) {
  ui.navTo('/pages/dividend-create/index?id=' + id)
}

async function markReceived(id) {
  try {
    await api.dividends.markReceived(id)
    ui.success('已确认到账')
    await reload()
  } catch (err) {
    ui.error(err)
  }
}
</script>

<style scoped>
/* 分红列表 */

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

/* --- 合计 ---------------------------------------------------------------- */

.summary {
  display: flex;
  align-items: center;
  background: var(--c-card);
  border-radius: var(--r-card);
  padding: 32rpx;
  margin-bottom: var(--gap);
}

.summary-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.summary-label {
  font-size: 24rpx;
  color: var(--c-text-3);
}

.summary-value {
  font-size: 40rpx;
  font-weight: 700;
  margin-top: 8rpx;
}

.summary-line {
  width: 1rpx;
  height: 64rpx;
  background: var(--c-line);
}

/* --- 筛选 ---------------------------------------------------------------- */

.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--gap);
}

.tabs {
  display: flex;
  background: var(--c-card);
  border-radius: 999rpx;
  padding: 6rpx;
}

.tab {
  padding: 12rpx 30rpx;
  border-radius: 999rpx;
  font-size: 26rpx;
  color: var(--c-text-2);
}

.tab--on {
  background: var(--c-primary);
  color: #fff;
}

.year-picker {
  font-size: 26rpx;
  color: var(--c-text-2);
  background: var(--c-card);
  padding: 14rpx 24rpx;
  border-radius: 999rpx;
}

/* --- 列表 ---------------------------------------------------------------- */

.item-name {
  font-size: 30rpx;
  font-weight: 500;
  max-width: 300rpx;
}

.status-tag {
  margin-left: 12rpx;
  font-size: 20rpx;
}

.item-right {
  align-items: flex-end;
  margin-left: 16rpx;
}

.item-amount {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--c-primary);
}

.mini-btn {
  margin-top: 12rpx;
  font-size: 22rpx;
  color: var(--c-primary);
  border: 1rpx solid var(--c-primary);
  border-radius: 999rpx;
  padding: 6rpx 18rpx;
}

.mini-btn:active {
  opacity: 0.6;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 96rpx 0;
  color: var(--c-text-3);
  font-size: 26rpx;
}

.placeholder-action {
  margin-top: 16rpx;
  color: var(--c-primary);
}

.more {
  text-align: center;
  padding: 28rpx 0;
  font-size: 24rpx;
  color: var(--c-text-3);
}
</style>
