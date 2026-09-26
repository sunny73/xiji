<template>
  <view class="page">
    <view v-if="error" class="error-card" @tap="load">
      <view class="error-title">加载失败</view>
      <view class="error-msg">{{ error }}</view>
      <view class="error-retry">点击重试</view>
    </view>

    <!-- 账户筛选 -->
    <scroll-view v-if="filters.length > 1" class="filter-bar" scroll-x>
      <view
        v-for="(item, index) in filters"
        :key="item.id"
        class="chip"
        :class="{ 'chip--on': filterIndex === index }"
        @tap="onFilterChange(index)"
      >
        {{ item.name }}
      </view>
    </scroll-view>

    <!-- 汇总 -->
    <view v-if="count > 0" class="summary">
      <text class="summary-count">{{ count }} 个标的</text>
      <text class="summary-cost">合计成本 ¥{{ totalCostText }}</text>
    </view>

    <view class="card card-tight">
      <template v-if="holdings.length">
        <view
          v-for="item in holdings"
          :key="item.id"
          class="list-item list-item--tap"
          @tap="goDetail(item.id)"
        >
          <view class="flex-1 col">
            <view class="row">
              <text class="item-name ellipsis">{{ item.securityName }}</text>
              <text class="tag tag--muted code-tag">{{ item.securityCode }}</text>
            </view>
            <text class="muted">{{ item.accountName }} · {{ item.sharesText }} 股</text>
          </view>
          <view class="col item-right">
            <text class="num item-cost">
              {{ item.costAmountText ? '¥' + item.costAmountText : '—' }}
            </text>
            <text class="muted">成本{{ item.costPriceText ? ' ¥' + item.costPriceText : '未填' }}</text>
          </view>
        </view>
      </template>

      <view v-else-if="loading" class="placeholder">加载中…</view>

      <view v-else class="placeholder">
        <text>{{ hasAccounts ? '还没有持仓' : '还没有账户' }}</text>
        <text class="placeholder-action" @tap="goCreate">
          {{ hasAccounts ? '添加第一笔持仓 ›' : '先去创建账户 ›' }}
        </text>
      </view>
    </view>
  </view>

  <view class="fab" @tap="goCreate">＋</view>
</template>

<script setup>
/**
 * 持仓列表。
 *
 * 原版用 setData，这里改成 ref。请求竞态守卫（utils/seq.js）保留 ——
 * 快速连点账户筛选时先发的请求可能后回来，会把列表刷成上一个账户的内容。
 */
import { ref } from 'vue'
import { onUnload, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import * as api from '../../services/api'
import * as fmt from '../../utils/format'
import * as ui from '../../utils/ui'
import * as decorate from '../../utils/decorate'
import { createGuard } from '../../utils/seq'

const guard = createGuard()

const loading = ref(true)
const error = ref('')
const filters = ref([{ id: '', name: '全部' }])
const filterIndex = ref(0)
const holdings = ref([])
const totalCostText = ref('0.00')
const count = ref(0)
const hasAccounts = ref(true)

onUnload(() => guard.invalidate())

onShow(() => {
  load()
})

onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

async function fetchHoldings(token) {
  const filter = filters.value[filterIndex.value] || { id: '' }
  try {
    const list = await api.holdings.list({ account_id: filter.id })
    if (!guard.isCurrent(token)) return

    const items = (list || []).map(decorate.holding)
    let totalCost = 0
    items.forEach((h) => {
      if (h.costAmount !== null) totalCost += h.costAmount
    })

    holdings.value = items
    count.value = items.length
    totalCostText.value = fmt.money(totalCost)
  } catch (err) {
    if (!guard.isCurrent(token)) return
    error.value = err.message || '加载失败'
  } finally {
    if (guard.isCurrent(token)) loading.value = false
  }
}

async function load() {
  const token = guard.next()
  loading.value = true
  error.value = ''

  try {
    const accounts = await api.accounts.list()
    if (!guard.isCurrent(token)) return

    filters.value = [{ id: '', name: '全部' }].concat(
      accounts.map((a) => ({ id: a.id, name: a.name }))
    )
    // 账户被删掉之后 filterIndex 可能越界，夹回 0
    if (filterIndex.value > filters.value.length - 1) filterIndex.value = 0
    hasAccounts.value = accounts.length > 0

    await fetchHoldings(token)
  } catch (err) {
    if (!guard.isCurrent(token)) return
    loading.value = false
    error.value = err.message || '加载失败'
  }
}

function onFilterChange(index) {
  if (index === filterIndex.value) return
  filterIndex.value = index
  loading.value = true
  fetchHoldings(guard.next())
}

function goDetail(id) {
  ui.navTo('/pages/holding-detail/index?id=' + id)
}

async function goCreate() {
  if (hasAccounts.value) {
    ui.navTo('/pages/holding-create/index')
    return
  }
  const ok = await ui.confirm({
    title: '还没有账户',
    content: '持仓必须属于某个账户，先去创建一个吧',
    confirmText: '去创建',
  })
  if (ok) ui.navTo('/pages/accounts/index')
}
</script>

<style scoped>
/* 持仓列表 */

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

/* --- 筛选 ---------------------------------------------------------------- */

.filter-bar {
  white-space: nowrap;
  margin-bottom: var(--gap);
}

.chip {
  display: inline-block;
  padding: 12rpx 28rpx;
  margin-right: 16rpx;
  border-radius: 999rpx;
  background: var(--c-card);
  color: var(--c-text-2);
  font-size: 26rpx;
}

.chip--on {
  background: var(--c-primary);
  color: #fff;
}

/* --- 汇总 ---------------------------------------------------------------- */

.summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 8rpx 20rpx;
}

.summary-count {
  font-size: 26rpx;
  color: var(--c-text-2);
}

.summary-cost {
  font-size: 26rpx;
  color: var(--c-text-3);
}

/* --- 列表 ---------------------------------------------------------------- */

.item-name {
  font-size: 30rpx;
  font-weight: 500;
  max-width: 380rpx;
}

.code-tag {
  margin-left: 12rpx;
  font-size: 20rpx;
}

.item-right {
  align-items: flex-end;
  margin-left: 16rpx;
}

.item-cost {
  font-size: 30rpx;
  font-weight: 600;
  margin-bottom: 4rpx;
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
</style>
