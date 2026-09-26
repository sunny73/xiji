<template>
  <view class="page">
    <view v-if="error" class="error-card" @tap="load">
      <view class="error-title">加载失败</view>
      <view class="error-msg">{{ error }}</view>
      <view class="error-retry">点击重试</view>
    </view>

    <template v-if="holding">
      <!-- 标的头部 -->
      <view class="head">
        <view class="head-name">{{ holding.securityName }}</view>
        <view class="head-meta">
          <text class="tag tag--muted">{{ holding.securityCode }}</text>
          <text class="tag tag--muted">{{ holding.marketLabel }}</text>
          <text class="tag tag--muted">{{ holding.typeLabel }}</text>
        </view>
        <view class="head-account">{{ holding.accountName }}</view>
      </view>

      <!-- 持仓数据 -->
      <view class="card">
        <template v-if="!editing">
          <view class="stat-row">
            <view class="stat">
              <text class="stat-label">持有股数</text>
              <text class="stat-value num">{{ holding.sharesText }}</text>
            </view>
            <view class="stat">
              <text class="stat-label">成本价</text>
              <text class="stat-value num">{{ holding.costPriceText || '—' }}</text>
            </view>
          </view>
          <view class="cost-line">
            <text class="muted">持仓成本</text>
            <text class="num cost-value">
              {{ holding.costAmountText ? '¥' + holding.costAmountText : '—' }}
            </text>
          </view>
          <view class="btn btn--ghost edit-btn" @tap="editing = true">修改持仓</view>
        </template>

        <template v-else>
          <view class="form-item">
            <text class="form-label">持有股数</text>
            <input
              class="form-input"
              type="digit"
              :value="editShares"
              @input="editShares = $event.detail.value"
            />
          </view>
          <view class="form-item">
            <text class="form-label">成本价</text>
            <input
              class="form-input"
              type="digit"
              placeholder="留空表示不记录"
              placeholder-class="form-placeholder"
              :value="editCostPrice"
              @input="editCostPrice = $event.detail.value"
            />
          </view>
          <view class="edit-actions">
            <view class="btn btn--ghost flex-1" @tap="cancelEdit">取消</view>
            <view
              class="btn btn--primary flex-1"
              :class="{ 'btn--disabled': submitting }"
              @tap="save"
            >
              {{ submitting ? '保存中…' : '保存' }}
            </view>
          </view>
        </template>
      </view>

      <!-- 该标的的分红 -->
      <view class="card">
        <view class="row-between">
          <text class="title">分红记录</text>
          <text class="num total">
            {{ dividendTotalText === '0.00' ? '' : '已到账 ¥' + dividendTotalText }}
          </text>
        </view>
        <text class="muted">共 {{ dividendCount }} 笔</text>

        <template v-if="dividends.length">
          <view class="divider dividend-divider"></view>
          <view
            v-for="item in dividends"
            :key="item.id"
            class="dividend-row"
            @tap="goDividend(item.id)"
          >
            <view class="flex-1 col">
              <text class="dividend-date">{{ item.dateText }}</text>
              <text class="muted">{{ item.sharesText }} 股 × {{ item.perShareText }}</text>
            </view>
            <view class="col dividend-right">
              <text class="num dividend-amount">¥{{ item.amountText }}</text>
              <text class="tag" :class="item.statusCls">{{ item.statusLabel }}</text>
            </view>
          </view>
        </template>

        <view v-else-if="loadingDividends" class="muted pad">加载中…</view>
        <view v-else class="muted pad">这个标的还没有分红记录</view>
      </view>

      <!-- 操作 -->
      <view class="btn btn--primary" @tap="addDividend">记一笔该标的分红</view>
      <view class="btn btn--danger remove-btn" @tap="remove">删除持仓</view>
    </template>

    <view v-else-if="loading" class="placeholder">加载中…</view>
  </view>
</template>

<script setup>
/**
 * 持仓详情。
 *
 * 缺 ?id 时不能一直转圈 —— 正常入口都会带 id，但扫码/分享等场景可能没有，
 * 原版在这里会永远停在"加载中…"。
 */
import { ref } from 'vue'
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import * as api from '../../services/api'
import * as fmt from '../../utils/format'
import * as ui from '../../utils/ui'
import * as v from '../../utils/validate'
import * as decorate from '../../utils/decorate'

const id = ref('')
const loading = ref(true)
const error = ref('')
const holding = ref(null)

const editing = ref(false)
const editShares = ref('')
const editCostPrice = ref('')
const submitting = ref(false)

const dividends = ref([])
const dividendTotalText = ref('0.00')
const dividendCount = ref(0)
const loadingDividends = ref(true)

onLoad((query) => {
  id.value = (query && query.id) || ''
  if (!id.value) {
    loading.value = false
    error.value = '缺少持仓参数，请从持仓列表进入'
  }
})

onShow(() => {
  if (id.value) load()
})

onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

async function loadDividends(h) {
  loadingDividends.value = true
  try {
    const res = await api.dividends.list({ security_id: h.securityId, page_size: 50 })
    const items = (res.items || []).map(decorate.dividend)

    let total = 0
    items.forEach((d) => {
      if (d.isReceived) total += d.amount
    })

    dividends.value = items
    dividendCount.value = res.total || items.length
    dividendTotalText.value = fmt.money(total)
  } catch (err) {
    /* 分红列表失败不影响主信息 */
  } finally {
    loadingDividends.value = false
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const raw = await api.holdings.detail(id.value)
    const h = decorate.holding(raw)

    holding.value = h
    editShares.value = String(h.shares)
    editCostPrice.value = h.costPrice === null ? '' : String(h.costPrice)

    uni.setNavigationBarTitle({ title: h.securityName || '持仓详情' })
    await loadDividends(h)
  } catch (err) {
    error.value = err.message || '加载失败'
  } finally {
    loading.value = false
  }
}

// --- 编辑 ---------------------------------------------------------------

function cancelEdit() {
  const h = holding.value
  editShares.value = String(h.shares)
  editCostPrice.value = h.costPrice === null ? '' : String(h.costPrice)
  editing.value = false
}

async function save() {
  if (submitting.value) return

  const sharesCheck = v.parseAmount(editShares.value, { label: '股数', min: 0.0001, decimals: 4 })
  const costCheck = v.parseAmount(editCostPrice.value, {
    label: '成本价',
    optional: true,
    min: 0,
    decimals: 4,
  })

  const message = v.firstError([sharesCheck, costCheck])
  if (message) {
    ui.toast(message)
    return
  }

  submitting.value = true
  try {
    const raw = await api.holdings.update(id.value, {
      shares: sharesCheck.value,
      cost_price: costCheck.value,
    })
    const h = decorate.holding(raw)
    holding.value = h
    editShares.value = String(h.shares)
    editCostPrice.value = h.costPrice === null ? '' : String(h.costPrice)
    editing.value = false
    ui.success('已保存')
  } catch (err) {
    ui.error(err)
  } finally {
    submitting.value = false
  }
}

async function remove() {
  const h = holding.value
  if (!h) return

  const ok = await ui.confirmDelete(h.securityName)
  if (!ok) return

  try {
    await api.holdings.remove(id.value)
    ui.success('已删除')
    setTimeout(() => ui.back(), 600)
  } catch (err) {
    ui.error(err)
  }
}

// --- 跳转 ---------------------------------------------------------------

function addDividend() {
  const h = holding.value
  if (!h) return
  ui.navTo(
    '/pages/dividend-create/index?account_id=' +
      h.accountId +
      '&security_id=' +
      h.securityId +
      '&security_name=' +
      encodeURIComponent(h.securityName)
  )
}

function goDividend(dividendId) {
  ui.navTo('/pages/dividend-create/index?id=' + dividendId)
}
</script>

<style scoped>
/* 持仓详情 */

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

.head {
  padding: 8rpx 8rpx 28rpx;
}

.head-name {
  font-size: 44rpx;
  font-weight: 700;
  line-height: 1.25;
}

.head-meta {
  margin-top: 14rpx;
}

.head-meta .tag {
  margin-right: 12rpx;
}

.head-account {
  margin-top: 14rpx;
  font-size: 26rpx;
  color: var(--c-text-3);
}

.stat-row {
  display: flex;
}

.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 24rpx;
  color: var(--c-text-3);
}

.stat-value {
  font-size: 40rpx;
  font-weight: 600;
  margin-top: 6rpx;
}

.cost-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 28rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid var(--c-line);
}

.cost-value {
  font-size: 32rpx;
  font-weight: 600;
}

.edit-btn {
  margin-top: 28rpx;
}

.edit-actions {
  display: flex;
  margin-top: 28rpx;
}

.edit-actions .btn {
  margin-right: 20rpx;
}

.edit-actions .btn:last-child {
  margin-right: 0;
}

.total {
  color: var(--c-primary);
  font-size: 28rpx;
  font-weight: 600;
}

.dividend-divider {
  margin: 20rpx 0 0;
}

.dividend-row {
  display: flex;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 1rpx solid var(--c-line);
}

.dividend-row:last-child {
  border-bottom: none;
}

.dividend-date {
  font-size: 28rpx;
  font-weight: 500;
}

.dividend-right {
  align-items: flex-end;
  margin-left: 16rpx;
}

.dividend-amount {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--c-primary);
  margin-bottom: 6rpx;
}

.pad {
  padding: 24rpx 0;
}

.remove-btn {
  margin-top: 24rpx;
}

.placeholder {
  text-align: center;
  padding: 120rpx 0;
  color: var(--c-text-3);
  font-size: 26rpx;
}
</style>
