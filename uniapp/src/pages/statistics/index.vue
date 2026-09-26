<template>
  <view class="page">
    <view v-if="error" class="error-card" @tap="load">
      <view class="error-title">加载失败</view>
      <view class="error-msg">{{ error }}</view>
      <view class="error-retry">点击重试</view>
    </view>

    <!-- 年份 + 总计 -->
    <view class="head">
      <picker mode="selector" :range="years" :value="yearIndex" @change="onYearChange">
        <view class="year-chip">{{ year }} 年 ›</view>
      </picker>
      <view class="head-total num">¥{{ totalText }}</view>
      <view class="head-sub">全年到账 · 共 {{ count }} 笔</view>
    </view>

    <!-- 月度柱状图 -->
    <view class="card">
      <view class="row-between">
        <text class="title">月度分布</text>
        <text class="link" @tap="goCalendar">日历视图 ›</text>
      </view>

      <view class="chart">
        <view
          v-for="(bar, index) in monthBars"
          :key="bar.month"
          class="bar-col"
          @tap="selectedMonthIndex = index"
        >
          <view class="bar-track">
            <view
              class="bar-fill"
              :class="{ 'bar-fill--on': selectedMonthIndex === index }"
              :style="{ height: bar.heightPercent + '%' }"
            ></view>
          </view>
          <text class="bar-label" :class="{ 'bar-label--on': selectedMonthIndex === index }">
            {{ bar.month }}
          </text>
        </view>
      </view>

      <view class="month-detail">
        <template v-if="selectedMonth">
          <text class="month-detail-label">{{ selectedMonth.monthLabel }}</text>
          <text class="month-detail-value num">¥{{ selectedMonth.amountText }}</text>
          <text class="muted">{{ selectedMonth.count }} 笔</text>
        </template>
        <text v-else class="muted">{{ year }} 年还没有分红记录</text>
      </view>
    </view>

    <!-- 按标的 -->
    <view class="row-between section-head">
      <text class="section-title">按标的</text>
      <text class="link" @tap="goDividends">全部记录 ›</text>
    </view>

    <view class="card card-tight">
      <template v-if="bySecurity.length">
        <view v-for="item in bySecurity" :key="item.securityId" class="list-item">
          <view class="flex-1 col">
            <text class="item-name ellipsis">{{ item.securityName }}</text>
            <text class="muted">{{ item.securityCode }} · {{ item.count }} 笔</text>
          </view>
          <text class="num item-amount">¥{{ item.amountText }}</text>
        </view>
      </template>
      <view v-else-if="loading" class="muted center pad">加载中…</view>
      <view v-else class="muted center pad">这一年还没有数据</view>
    </view>

    <!-- 历年对比 -->
    <template v-if="yearly.length > 1">
      <view class="section-head">
        <text class="section-title">历年对比</text>
      </view>

      <view class="card card-tight">
        <view
          v-for="item in yearly"
          :key="item.year"
          class="list-item"
          :class="{ 'list-item--active': item.isCurrent }"
        >
          <text class="flex-1 year-cell">{{ item.year }} 年</text>
          <text class="muted year-count">{{ item.count }} 笔</text>
          <text class="num year-amount">¥{{ item.amountText }}</text>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup>
/**
 * 统计分析。
 *
 * ⚠️ 三个统计接口都传 status='received'：
 *   页面标题写的是"全年到账"，把待收也算进来会让它比首页的"已到账"多出一截，
 *   数字对不上（原版踩过这个坑，见 h5/tests/render.js 里的跨页一致性检查）。
 */
import { ref, computed } from 'vue'
import { onLoad, onUnload, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import * as api from '../../services/api'
import * as fmt from '../../utils/format'
import * as ui from '../../utils/ui'
import * as decorate from '../../utils/decorate'
import { createGuard } from '../../utils/seq'

const guard = createGuard()
const now = fmt.today()

const years = ref([])
for (let i = 0; i < 6; i++) years.value.push(now.year - i)

const loading = ref(true)
const error = ref('')
const yearIndex = ref(0)
const year = ref(now.year)

const totalText = ref('0.00')
const count = ref(0)
const monthBars = ref([])
const selectedMonthIndex = ref(-1)
const bySecurity = ref([])
const yearly = ref([])

const selectedMonth = computed(() => monthBars.value[selectedMonthIndex.value] || null)

onLoad(() => {
  load()
})

onUnload(() => guard.invalidate())

onShow(() => {
  load()
})

onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

async function load() {
  const token = guard.next()
  const targetYear = year.value
  loading.value = true
  error.value = ''

  try {
    const [monthly, bySec, yr] = await Promise.all([
      api.statistics.monthly({ year: targetYear, status: 'received' }),
      api.statistics.bySecurity({ year: targetYear, status: 'received' }),
      api.statistics.yearly({ status: 'received' }),
    ])
    if (!guard.isCurrent(token)) return

    const bars = decorate.monthlyBars(monthly || [])

    // 默认选中金额最高的那个月，用户一眼就知道看图该看哪
    let bestIndex = -1
    let bestAmount = 0
    bars.forEach((b, i) => {
      if (b.amount > bestAmount) {
        bestAmount = b.amount
        bestIndex = i
      }
    })

    const yearRow = (yr || []).filter((r) => r.year === targetYear)[0]

    monthBars.value = bars
    selectedMonthIndex.value = bestIndex
    bySecurity.value = (bySec || []).map(decorate.securityStat)
    yearly.value = (yr || []).map((r) => ({
      year: r.year,
      amountText: fmt.money(r.amount),
      count: r.count,
      isCurrent: r.year === targetYear,
    }))
    totalText.value = yearRow ? fmt.money(yearRow.amount) : '0.00'
    count.value = yearRow ? yearRow.count : 0
  } catch (err) {
    if (!guard.isCurrent(token)) return
    error.value = err.message || '加载失败'
  } finally {
    if (guard.isCurrent(token)) loading.value = false
  }
}

function onYearChange(e) {
  const index = Number(e.detail.value)
  yearIndex.value = index
  year.value = years.value[index]
  load()
}

function goCalendar() {
  ui.navTo('/pages/calendar/index')
}

function goDividends() {
  ui.switchTab('/pages/dividends/index')
}
</script>

<style scoped>
/* 统计分析 */

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

/* --- 头部 ---------------------------------------------------------------- */

.head {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12rpx 0 36rpx;
}

.year-chip {
  font-size: 26rpx;
  color: var(--c-text-2);
  background: var(--c-card);
  padding: 10rpx 26rpx;
  border-radius: 999rpx;
}

.head-total {
  font-size: 72rpx;
  font-weight: 700;
  letter-spacing: -1.5rpx;
  line-height: 1.2;
  margin-top: 20rpx;
  color: var(--c-primary);
}

.head-sub {
  font-size: 24rpx;
  color: var(--c-text-3);
  margin-top: 6rpx;
}

.link {
  font-size: 24rpx;
  color: var(--c-primary);
}

/* --- 柱状图 -------------------------------------------------------------- */
/* 纯 CSS 手绘，不引图表库：12 根柱子用图表库要多打包 200KB 不划算 */

.chart {
  display: flex;
  align-items: flex-end;
  height: 280rpx;
  margin-top: 28rpx;
}

.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  justify-content: flex-end;
}

.bar-track {
  width: 28rpx;
  height: 232rpx;
  display: flex;
  align-items: flex-end;
  background: #f4f5f7;
  border-radius: 14rpx;
  overflow: hidden;
}

.bar-fill {
  width: 100%;
  background: #a9d6c7;
  border-radius: 14rpx;
  transition: height 0.2s ease;
}

.bar-fill--on {
  background: var(--c-primary);
}

.bar-label {
  font-size: 20rpx;
  color: var(--c-text-3);
  margin-top: 10rpx;
}

.bar-label--on {
  color: var(--c-primary);
  font-weight: 600;
}

.month-detail {
  display: flex;
  align-items: baseline;
  justify-content: center;
  padding-top: 24rpx;
  margin-top: 8rpx;
  border-top: 1rpx solid var(--c-line);
}

.month-detail-label {
  font-size: 26rpx;
  color: var(--c-text-2);
  margin-right: 16rpx;
}

.month-detail-value {
  font-size: 36rpx;
  font-weight: 700;
  color: var(--c-primary);
  margin-right: 16rpx;
}

/* --- 列表 ---------------------------------------------------------------- */

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

.item-name {
  font-size: 30rpx;
  font-weight: 500;
}

.item-amount {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--c-primary);
  margin-left: 16rpx;
}

.year-cell {
  font-size: 30rpx;
}

.year-count {
  margin-right: 20rpx;
}

.year-amount {
  font-size: 30rpx;
  font-weight: 600;
}

.list-item--active {
  background: var(--c-primary-soft);
}

.center {
  text-align: center;
}

.pad {
  padding: 48rpx 0;
}
</style>
