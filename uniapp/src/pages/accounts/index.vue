<template>
  <view class="page">
    <view v-if="error" class="error-card" @tap="load">
      <view class="error-title">加载失败</view>
      <view class="error-msg">{{ error }}</view>
      <view class="error-retry">点击重试</view>
    </view>

    <view class="explain">
      一个账户对应一个券商或一类资金。持仓和分红都挂在账户下，
      分开记账后就能看到「哪个账户收到的分红最多」。
    </view>

    <!-- 列表 -->
    <view class="card card-tight">
      <template v-if="accounts.length">
        <view
          v-for="item in accounts"
          :key="item.id"
          class="list-item list-item--tap"
          @tap="onAccountTap(item)"
        >
          <view class="flex-1 col">
            <text class="account-name">{{ item.name }}</text>
            <text class="muted">{{ item.typeLabel }}</text>
          </view>
          <text class="chevron">›</text>
        </view>
      </template>

      <view v-else-if="loading" class="muted center pad">加载中…</view>

      <view v-else class="muted center pad">还没有账户，点下面的按钮创建一个</view>
    </view>

    <!-- 新建 / 编辑表单 -->
    <view v-if="showForm" class="card form-card">
      <view class="form-title">{{ formTitle }}</view>

      <view class="form-item">
        <text class="form-label">名称</text>
        <input
          class="form-input"
          type="text"
          placeholder="如 我的账户 / 老婆账户"
          placeholder-class="form-placeholder"
          :value="formName"
          @input="formName = $event.detail.value"
        />
      </view>

      <picker
        mode="selector"
        :range="typeOptions"
        range-key="label"
        :value="formTypeIndex"
        @change="formTypeIndex = Number($event.detail.value)"
      >
        <view class="form-item">
          <text class="form-label">类型</text>
          <view class="form-input form-picker">
            <text>{{ typeOptions[formTypeIndex].label }}</text>
            <text class="arrow">›</text>
          </view>
        </view>
      </picker>

      <view class="form-actions">
        <view class="btn btn--ghost flex-1" @tap="closeForm">取消</view>
        <view class="btn btn--primary flex-1" :class="{ 'btn--disabled': submitting }" @tap="submit">
          {{ submitting ? '保存中…' : '保存' }}
        </view>
      </view>

      <view v-if="editingId" class="btn btn--danger delete-btn" @tap="remove">删除账户</view>
    </view>

    <view v-else class="btn btn--primary add-btn" @tap="openCreate">＋ 新建账户</view>
  </view>
</template>

<script setup>
/**
 * 投资账户管理。
 *
 * 比原版简化了一处：原版用 wx.showActionSheet 弹「重命名 / 删除」，
 * 这里改成点一行直接进编辑表单，删除按钮放在表单里 ——
 * 少一层系统弹层，H5 和小程序的行为也更容易保持一致。
 */
import { ref } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import * as api from '../../services/api'
import * as ui from '../../utils/ui'
import * as decorate from '../../utils/decorate'
import { ACCOUNT_TYPES } from '../../utils/constants'

const loading = ref(true)
const error = ref('')
const accounts = ref([])

const showForm = ref(false)
const editingId = ref('')
const formTitle = ref('新建账户')
const formName = ref('')
const formTypeIndex = ref(0)
const submitting = ref(false)
const typeOptions = ACCOUNT_TYPES

onShow(() => {
  load()
})

onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const list = await api.accounts.list()
    accounts.value = (list || []).map(decorate.account)
  } catch (err) {
    error.value = err.message || '加载失败'
  } finally {
    loading.value = false
  }
}

// --- 表单 ---------------------------------------------------------------

function openCreate() {
  showForm.value = true
  editingId.value = ''
  formTitle.value = '新建账户'
  formName.value = ''
  formTypeIndex.value = 0
}

function openEdit(account) {
  let idx = 0
  ACCOUNT_TYPES.forEach((t, i) => {
    if (t.value === account.type) idx = i
  })
  showForm.value = true
  editingId.value = account.id
  formTitle.value = '编辑账户'
  formName.value = account.name
  formTypeIndex.value = idx
}

function closeForm() {
  showForm.value = false
  submitting.value = false
}

function onAccountTap(account) {
  openEdit(account)
}

async function submit() {
  if (submitting.value) return

  const name = String(formName.value || '').trim()
  if (!name) {
    ui.toast('请填写账户名称')
    return
  }
  if (name.length > 100) {
    ui.toast('名称太长了')
    return
  }

  const payload = { name, type: ACCOUNT_TYPES[formTypeIndex.value].value }
  const isEdit = !!editingId.value

  submitting.value = true
  try {
    if (isEdit) await api.accounts.update(editingId.value, payload)
    else await api.accounts.create(payload)

    submitting.value = false
    showForm.value = false
    ui.success(isEdit ? '已保存' : '已创建')
    await load()
  } catch (err) {
    submitting.value = false
    ui.error(err)
  }
}

async function remove() {
  const account = accounts.value.filter((a) => a.id === editingId.value)[0]
  if (!account) return

  const ok = await ui.confirm({
    title: '删除账户',
    content: '「' + account.name + '」下的持仓和分红记录会一并删除，且无法恢复。确定吗？',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return

  try {
    await api.accounts.remove(account.id)
    ui.success('已删除')
    closeForm()
    await load()
  } catch (err) {
    ui.error(err)
  }
}
</script>

<style scoped>
/* 投资账户 */

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

.explain {
  font-size: 24rpx;
  color: var(--c-text-3);
  line-height: 1.6;
  padding: 0 8rpx 24rpx;
}

.account-name {
  font-size: 32rpx;
  font-weight: 500;
  margin-bottom: 4rpx;
}

.chevron {
  color: var(--c-text-3);
  font-size: 36rpx;
}

.form-card {
  padding: 28rpx 0 24rpx;
}

.form-title {
  font-size: 30rpx;
  font-weight: 600;
  padding: 0 32rpx 16rpx;
}

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

.form-actions {
  display: flex;
  padding: 28rpx 32rpx 0;
}

.form-actions .btn {
  margin-right: 20rpx;
}

.form-actions .btn:last-child {
  margin-right: 0;
}

.add-btn {
  margin: 8rpx 4rpx 0;
}

.delete-btn {
  margin: 24rpx 32rpx 0;
}

.center {
  text-align: center;
}

.pad {
  padding: 48rpx 0;
}
</style>
