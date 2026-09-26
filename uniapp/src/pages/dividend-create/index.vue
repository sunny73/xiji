<template>
  <view class="page">
    <!-- 金额预览：填完股数和每股分红就能看到，但最终金额以后端为准 -->
    <view class="preview">
      <text class="preview-label">分红金额</text>
      <text class="preview-value num">{{ amountPreview ? '¥' + amountPreview : '—' }}</text>
      <text class="preview-hint">由「股数 × 每股分红」自动计算，保存时以后端为准</text>
    </view>

    <view class="card card-tight">
      <!-- 账户：编辑模式下只读 -->
      <template v-if="isEdit">
        <view class="form-item">
          <text class="form-label">账户</text>
          <text class="form-input form-readonly">{{ lockedAccountName }}</text>
        </view>
        <view class="form-item">
          <text class="form-label">标的</text>
          <text class="form-input form-readonly">{{ lockedSecurityName }}</text>
        </view>
      </template>

      <template v-else>
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

        <!-- 从持仓详情进来时标的已锁定，只读展示 -->
        <view v-if="presetLocked" class="form-item">
          <text class="form-label">标的</text>
          <text class="form-input form-readonly">
            {{ security ? security.name + ' ' + security.code : '加载中…' }}
          </text>
        </view>

        <template v-else>
          <view class="form-item">
            <text class="form-label">标的代码</text>
            <input
              class="form-input"
              type="text"
              placeholder="如 601988"
              placeholder-class="form-placeholder"
              :value="code"
              @input="onCodeInput"
              @blur="lookup"
            />
          </view>

          <view v-if="looking" class="form-item hint-row">
            <text class="hint">查询中…</text>
          </view>
          <view v-else-if="security" class="form-item hint-row">
            <text class="hint hint--ok">✓ {{ security.name }}</text>
          </view>
          <view v-else-if="notFound" class="form-item hint-row">
            <text class="hint hint--new">新标的，请填写名称和类型</text>
          </view>

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
        </template>
      </template>

      <!-- 派息日 -->
      <picker mode="date" :value="paymentDate" @change="paymentDate = $event.detail.value">
        <view class="form-item">
          <text class="form-label">派息日</text>
          <view class="form-input form-picker">
            <text>{{ paymentDate }}</text>
            <text class="arrow">›</text>
          </view>
        </view>
      </picker>

      <!-- 股数 -->
      <view class="form-item">
        <text class="form-label">分红股数</text>
        <input
          class="form-input"
          type="digit"
          placeholder="10000"
          placeholder-class="form-placeholder"
          :value="shares"
          @input="shares = $event.detail.value"
        />
      </view>

      <!-- 每股分红 -->
      <view class="form-item">
        <text class="form-label">每股分红</text>
        <input
          class="form-input"
          type="digit"
          placeholder="0.19"
          placeholder-class="form-placeholder"
          :value="perShare"
          @input="perShare = $event.detail.value"
        />
      </view>

      <!-- 状态 -->
      <picker
        mode="selector"
        :range="statusOptions"
        range-key="label"
        :value="statusIndex"
        @change="statusIndex = Number($event.detail.value)"
      >
        <view class="form-item">
          <text class="form-label">状态</text>
          <view class="form-input form-picker">
            <text>{{ statusOptions[statusIndex].label }}</text>
            <text class="arrow">›</text>
          </view>
        </view>
      </picker>

      <!-- 备注 -->
      <view class="form-item">
        <text class="form-label">备注</text>
        <input
          class="form-input"
          type="text"
          placeholder="选填"
          placeholder-class="form-placeholder"
          :value="note"
          @input="note = $event.detail.value"
        />
      </view>
    </view>

    <view class="tip">
      「待收」表示已公告但还没到账；到账后改成「已到账」。
      同一标的可以先记待收，钱到了再确认，这样首页的预计收入与实际收入能对上。
    </view>

    <view class="btn btn--primary" :class="{ 'btn--disabled': submitting }" @tap="save">
      {{ submitting ? '保存中…' : isEdit ? '保存修改' : '保存' }}
    </view>

    <view v-if="isEdit" class="btn btn--danger remove-btn" @tap="remove">删除这笔记录</view>
  </view>
</template>

<script setup>
/**
 * 记一笔 / 编辑分红。
 *
 * 两处比原版干净：
 *   1. amountPreview 改成 computed —— 原版要在 shares/perShare 的 input 回调里手动重算，
 *      还得给 setData 传回调并处理 this 绑定，纯属绕远路
 *   2. 请求体里**没有 amount** —— 后端 schema 是 extra="forbid"，传了直接 422
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import * as api from '../../services/api'
import * as fmt from '../../utils/format'
import * as ui from '../../utils/ui'
import * as v from '../../utils/validate'
import * as sec from '../../utils/security'
import * as decorate from '../../utils/decorate'
import { MARKETS, SECURITY_TYPES, DIVIDEND_STATUS } from '../../utils/constants'

const STATUS_OPTIONS = [
  { value: 'pending', label: DIVIDEND_STATUS.pending.label },
  { value: 'received', label: DIVIDEND_STATUS.received.label },
]

let lastLookup = null

const id = ref('')
const isEdit = ref(false)
const presetLocked = ref(false)

const accounts = ref([])
const accountNames = ref([])
const accountIndex = ref(0)

const code = ref('')
const name = ref('')
const marketIndex = ref(0)
const typeIndex = ref(0)
const marketOptions = MARKETS
const typeOptions = SECURITY_TYPES
const security = ref(null)
const looking = ref(false)
const notFound = ref(false)

const startDay = fmt.today()
const paymentDate = ref(
  fmt.dateISO(startDay.year + '-' + startDay.month + '-' + startDay.day)
)
const shares = ref('')
const perShare = ref('')
const statusIndex = ref(0)
const note = ref('')
const submitting = ref(false)

const lockedAccountName = ref('')
const lockedSecurityName = ref('')

/** ⚠️ 只是给用户看的实时预览，提交时不会带上这个字段 */
const amountPreview = computed(() => {
  const s = String(shares.value || '').trim()
  const p = String(perShare.value || '').trim()
  if (!s || !p) return ''
  return fmt.money(fmt.calcDividendAmount(s, p))
})

onLoad((query) => {
  const q = query || {}
  presetLocked.value = !!q.security_id

  if (q.id) {
    isEdit.value = true
    id.value = q.id
    loadForEdit(q.id)
  } else {
    loadAccounts(q.account_id, q.security_id)
  }
})

// --- 初始化 -------------------------------------------------------------

async function loadAccounts(presetAccountId, presetSecurityId) {
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
        content: '分红记录必须属于某个账户，先去创建一个吧',
        confirmText: '去创建',
      })
      if (ok) uni.redirectTo({ url: '/pages/accounts/index' })
      else ui.back()
      return
    }

    // 从持仓详情跳过来时带了 security_id，直接锁定标的
    if (presetSecurityId) {
      const s = await api.securities.detail(presetSecurityId)
      security.value = s
      code.value = s.code
      name.value = s.name
      notFound.value = false
    }
  } catch (err) {
    ui.error(err)
  }
}

async function loadForEdit(dividendId) {
  ui.loading('加载中')
  try {
    const raw = await api.dividends.detail(dividendId)
    const d = decorate.dividend(raw)

    const idx = STATUS_OPTIONS.map((s) => s.value).indexOf(d.status)

    id.value = d.id
    code.value = d.securityCode
    name.value = d.securityName
    security.value = { id: d.securityId, code: d.securityCode, name: d.securityName }
    paymentDate.value = d.paymentDate
    shares.value = String(d.shares)
    perShare.value = String(d.perShare)
    note.value = d.note
    statusIndex.value = idx < 0 ? 0 : idx
    lockedAccountName.value = d.accountName
    lockedSecurityName.value = d.securityName

    uni.setNavigationBarTitle({ title: '编辑分红' })
  } catch (err) {
    ui.error(err)
  } finally {
    ui.hideLoading()
  }
}

// --- 输入 ---------------------------------------------------------------

function onCodeInput(e) {
  // 改代码就作废缓存的 security，并作废在途查询
  lastLookup = null
  code.value = e.detail.value
  security.value = null
  notFound.value = false
  looking.value = false
}

async function lookup() {
  const checked = v.securityCode(code.value)
  if (!checked.ok) {
    lastLookup = null
    security.value = null
    notFound.value = false
    looking.value = false
    return
  }

  const target = checked.value
  lastLookup = target
  looking.value = true

  try {
    const list = await api.securities.list({ keyword: target, limit: 20 })
    if (lastLookup !== target) return

    const hit = (list || []).filter((s) => String(s.code).toUpperCase() === target)[0]
    if (hit) {
      security.value = hit
      name.value = hit.name
      notFound.value = false
    } else {
      security.value = null
      notFound.value = true
    }
  } catch (err) {
    if (lastLookup !== target) return
    security.value = null
    notFound.value = true
  } finally {
    if (lastLookup === target) looking.value = false
  }
}

// --- 保存 ---------------------------------------------------------------

async function save() {
  if (submitting.value) return

  if (!isEdit.value && !accounts.value.length) {
    ui.toast('请先创建账户')
    return
  }

  const dateCheck = v.dateString(paymentDate.value, '派息日')
  const sharesCheck = v.parseAmount(shares.value, { label: '股数', min: 0.0001, decimals: 4 })
  const perShareCheck = v.parseAmount(perShare.value, { label: '每股分红', min: 0, decimals: 6 })
  const codeCheck = isEdit.value ? { ok: true } : v.securityCode(code.value)

  const reuse =
    isEdit.value || sec.canReuseSecurity(security.value, codeCheck.ok ? codeCheck.value : '')
  const nameCheck = reuse ? { ok: true } : v.requiredText(name.value, '标的名称')

  const message = v.firstError([codeCheck, nameCheck, dateCheck, sharesCheck, perShareCheck])
  if (message) {
    ui.toast(message)
    return
  }

  // ⚠️ 没有 amount：后端会按 shares × per_share 自己算，传了反而 422
  const payload = {
    payment_date: dateCheck.value,
    shares: sharesCheck.value,
    per_share: perShareCheck.value,
    status: STATUS_OPTIONS[statusIndex.value].value,
    note: note.value ? note.value : null,
  }

  submitting.value = true
  try {
    if (isEdit.value) {
      await api.dividends.update(id.value, payload)
    } else {
      const target = await ensureSecurity(codeCheck.value, nameCheck.value)
      await api.dividends.create(
        Object.assign({}, payload, {
          account_id: accounts.value[accountIndex.value].id,
          security_id: target.id,
        })
      )
    }
    ui.success(isEdit.value ? '已保存' : '已记录')
    setTimeout(() => ui.back(), 700)
  } catch (err) {
    ui.error(err)
  } finally {
    submitting.value = false
  }
}

/** 标的不存在时先创建（POST /securities 是幂等的） */
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

async function remove() {
  const ok = await ui.confirmDelete(lockedSecurityName.value)
  if (!ok) return

  try {
    await api.dividends.remove(id.value)
    ui.success('已删除')
    setTimeout(() => ui.back(), 600)
  } catch (err) {
    ui.error(err)
  }
}
</script>

<style scoped>
/* 记一笔分红 */

.preview {
  background: linear-gradient(135deg, #0b7a5a 0%, #0a5f47 100%);
  border-radius: 24rpx;
  padding: 36rpx;
  margin-bottom: var(--gap);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.preview-label {
  font-size: 26rpx;
  opacity: 0.78;
}

.preview-value {
  font-size: 68rpx;
  font-weight: 700;
  letter-spacing: -1rpx;
  line-height: 1.2;
  margin: 8rpx 0;
}

.preview-hint {
  font-size: 22rpx;
  opacity: 0.65;
  text-align: center;
}

.form-picker {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: var(--c-text);
}

.form-readonly {
  color: var(--c-text-3);
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

.tip {
  font-size: 24rpx;
  color: var(--c-text-3);
  line-height: 1.6;
  padding: 0 12rpx 32rpx;
}

.btn {
  margin: 0 4rpx;
}

.remove-btn {
  margin-top: 24rpx;
}
</style>
