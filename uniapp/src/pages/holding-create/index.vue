<template>
  <view class="page">
    <view class="card card-tight">
      <!-- 账户 -->
      <picker
        mode="selector"
        :range="accountNames"
        :value="accountIndex"
        :disabled="!accountNames.length"
        @change="accountIndex = Number($event.detail.value)"
      >
        <view class="form-item">
          <text class="form-label">账户</text>
          <view class="form-input form-picker">
            <text>{{ accountNames[accountIndex] || '暂无账户' }}</text>
            <text class="arrow">›</text>
          </view>
        </view>
      </picker>

      <!-- 标的代码 -->
      <view class="form-item">
        <text class="form-label">标的代码</text>
        <input
          class="form-input"
          type="text"
          placeholder="如 601988 / 510880"
          placeholder-class="form-placeholder"
          :value="code"
          @input="onCodeInput"
          @blur="lookup"
        />
      </view>

      <!-- 查询结果 -->
      <view v-if="looking" class="form-item hint-row">
        <text class="hint">查询中…</text>
      </view>
      <view v-else-if="security" class="form-item hint-row">
        <text class="hint hint--ok">✓ {{ security.name }}</text>
        <text class="hint-sub">{{ security.market }} · {{ security.type }}</text>
      </view>
      <view v-else-if="notFound" class="form-item hint-row">
        <text class="hint hint--new">新标的，请填写名称和类型</text>
      </view>

      <!-- 新标的才需要名称/市场/类型 -->
      <template v-if="notFound">
        <view class="form-item">
          <text class="form-label">标的名称</text>
          <input
            class="form-input"
            type="text"
            placeholder="如 中国银行"
            placeholder-class="form-placeholder"
            :value="name"
            @input="name = $event.detail.value"
          />
        </view>

        <picker
          mode="selector"
          :range="marketOptions"
          range-key="label"
          :value="marketIndex"
          @change="marketIndex = Number($event.detail.value)"
        >
          <view class="form-item">
            <text class="form-label">市场</text>
            <view class="form-input form-picker">
              <text>{{ marketOptions[marketIndex].label }}</text>
              <text class="arrow">›</text>
            </view>
          </view>
        </picker>

        <picker
          mode="selector"
          :range="typeOptions"
          range-key="label"
          :value="typeIndex"
          @change="typeIndex = Number($event.detail.value)"
        >
          <view class="form-item">
            <text class="form-label">类型</text>
            <view class="form-input form-picker">
              <text>{{ typeOptions[typeIndex].label }}</text>
              <text class="arrow">›</text>
            </view>
          </view>
        </picker>
      </template>

      <!-- 股数 / 成本 -->
      <view class="form-item">
        <text class="form-label">持有股数</text>
        <input
          class="form-input"
          type="digit"
          placeholder="10000"
          placeholder-class="form-placeholder"
          :value="shares"
          @input="shares = $event.detail.value"
        />
      </view>

      <view class="form-item">
        <text class="form-label">成本价</text>
        <input
          class="form-input"
          type="digit"
          placeholder="选填，如 4.12"
          placeholder-class="form-placeholder"
          :value="costPrice"
          @input="costPrice = $event.detail.value"
        />
      </view>
    </view>

    <view class="tip">
      成本价用于计算持仓成本，留空则只记股数。
      分红金额请到「分红」页按实际到账录入。
    </view>

    <view class="btn btn--primary" :class="{ 'btn--disabled': submitting }" @tap="save">
      {{ submitting ? '保存中…' : '保存' }}
    </view>
  </view>
</template>

<script setup>
/**
 * 添加持仓。
 *
 * ⚠️ 复用已查到的标的前**必须**比对 code（utils/security.js）：
 *   查完 601988 得到"中国银行"，把代码改成 601857 再保存，
 *   如果直接复用缓存就会把持仓记到 601988 上 —— 用户几乎不可能发现。
 * 另外：改了代码要立刻作废缓存 + 作废在途查询，否则旧响应会把它"复活"。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import * as api from '../../services/api'
import * as ui from '../../utils/ui'
import * as v from '../../utils/validate'
import * as sec from '../../utils/security'
import { MARKETS, SECURITY_TYPES } from '../../utils/constants'

let lastLookup = null

const accounts = ref([])
const accountNames = ref([])
const accountIndex = ref(0)
let presetAccountId = ''

const code = ref('')
const name = ref('')
const marketIndex = ref(0)
const typeIndex = ref(0)
const marketOptions = MARKETS
const typeOptions = SECURITY_TYPES

// 查询到的已有标的；为空表示"这是个新标的，需要填名称"
const security = ref(null)
const looking = ref(false)
const notFound = ref(false)

const shares = ref('')
const costPrice = ref('')
const submitting = ref(false)

onLoad((query) => {
  presetAccountId = (query && query.account_id) || ''
  loadAccounts()
})

async function loadAccounts() {
  try {
    const list = await api.accounts.list()
    accounts.value = list

    let index = 0
    if (presetAccountId) {
      list.forEach((a, i) => {
        if (a.id === presetAccountId) index = i
      })
    }
    accountNames.value = list.map((a) => a.name)
    accountIndex.value = index

    if (!list.length) {
      const ok = await ui.confirm({
        title: '还没有账户',
        content: '持仓必须属于某个账户，先去创建一个吧',
        confirmText: '去创建',
      })
      if (ok) uni.redirectTo({ url: '/pages/accounts/index' })
      else ui.back()
    }
  } catch (err) {
    ui.error(err)
  }
}

// --- 输入 ---------------------------------------------------------------

function onCodeInput(e) {
  // 一旦用户改了代码，之前查到的 security 立刻作废；
  // lastLookup 置空 = 同时作废在途的查询请求
  lastLookup = null
  code.value = e.detail.value
  security.value = null
  notFound.value = false
  looking.value = false
}

/** 失焦时去后端查一下这个代码是否已存在 */
async function lookup() {
  const checked = v.securityCode(code.value)
  if (!checked.ok) {
    lastLookup = null
    security.value = null
    notFound.value = false
    looking.value = false
    return null
  }

  const target = checked.value
  lastLookup = target
  looking.value = true

  try {
    const list = await api.securities.list({ keyword: target, limit: 20 })
    if (lastLookup !== target) return null

    const hit = (list || []).filter((s) => String(s.code).toUpperCase() === target)[0]
    if (hit) {
      security.value = hit
      name.value = hit.name
      notFound.value = false
    } else {
      security.value = null
      notFound.value = true
    }
    looking.value = false
    return hit || null
  } catch (err) {
    if (lastLookup !== target) return null
    // 查不到（网络抖了 / 401 重试失败）时按"新标的"处理：
    // 否则名称输入框不渲染，用户每次保存都被提示"请填写标的名称"却没地方可填
    looking.value = false
    security.value = null
    notFound.value = true
    return null
  }
}

// --- 保存 ---------------------------------------------------------------

async function save() {
  if (submitting.value) return

  if (!accounts.value.length) {
    ui.toast('请先创建账户')
    return
  }

  const codeCheck = v.securityCode(code.value)
  const sharesCheck = v.parseAmount(shares.value, { label: '股数', min: 0.0001, decimals: 4 })
  const costCheck = v.parseAmount(costPrice.value, {
    label: '成本价',
    optional: true,
    min: 0,
    decimals: 4,
  })

  // 只有当缓存的 security 确实对应当前代码时才算"已存在"
  const reuse = sec.canReuseSecurity(security.value, codeCheck.ok ? codeCheck.value : '')
  const nameCheck = reuse ? { ok: true } : v.requiredText(name.value, '标的名称')

  const message = v.firstError([codeCheck, nameCheck, sharesCheck, costCheck])
  if (message) {
    ui.toast(message)
    return
  }

  submitting.value = true
  try {
    const target = await ensureSecurity(codeCheck.value, nameCheck.value)
    await api.holdings.create({
      account_id: accounts.value[accountIndex.value].id,
      security_id: target.id,
      shares: sharesCheck.value,
      cost_price: costCheck.value,
    })
    ui.success('已添加')
    setTimeout(() => ui.back(), 700)
  } catch (err) {
    ui.error(err)
  } finally {
    submitting.value = false
  }
}

/**
 * 拿到可用的 security：能复用就复用，否则先建（POST /securities 是幂等的）。
 * 复用前必须确认缓存里的 code 和当前输入一致。
 */
function ensureSecurity(targetCode, targetName) {
  const resolved = sec.resolveSecurity(security.value, targetCode)
  if (resolved.security) return Promise.resolve(resolved.security)

  return api.securities.create({
    code: targetCode,
    name: targetName,
    market: MARKETS[marketIndex.value].value,
    type: SECURITY_TYPES[typeIndex.value].value,
  })
}
</script>

<style scoped>
/* 新增持仓 */

.form-picker {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: var(--c-text);
}

.arrow {
  margin-left: 12rpx;
  color: var(--c-text-3);
  font-size: 32rpx;
}

.hint-row {
  justify-content: flex-start;
  min-height: 72rpx;
}

.hint {
  font-size: 26rpx;
  color: var(--c-text-3);
}

.hint--ok {
  color: var(--c-primary);
}

.hint--new {
  color: var(--c-gold);
}

.hint-sub {
  margin-left: 16rpx;
  font-size: 22rpx;
  color: var(--c-text-3);
}

.tip {
  font-size: 24rpx;
  color: var(--c-text-3);
  line-height: 1.6;
  padding: 0 12rpx 32rpx;
}

.btn {
  margin: 0 4rpx;
}
</style>
