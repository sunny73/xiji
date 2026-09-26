<script setup>
/**
 * 应用入口。
 *
 * 启动时做一次静默登录：失败**不阻塞**进入首页 —— 首页自己有加载态和重试，
 * 如果在这里 await 登录，网络差的时候用户会卡在空白启动页。
 *
 * 这里对应原生版的 app.js。区别是 onLaunch 来自 @dcloudio/uni-app，
 * 而不是全局的 App({ onLaunch })。
 */
import { onLaunch, onError } from '@dcloudio/uni-app'
import { ensureLogin } from './services/auth'

onLaunch(() => {
  ensureLogin().catch((err) => {
    // 登录失败不弹窗：用户可能只是还没配好后端地址，首页会给出更具体的提示
    console.warn('[app] 静默登录失败：', err && err.message)
  })
})

onError((err) => {
  console.error('[app] 未捕获错误：', err)
})
</script>

<style>
/**
 * 全局样式 + 设计变量。
 *
 * 和原生版的 app.wxss 一一对应，两处差异：
 *   1. `page` 选择器 → `:root, page`：小程序里有 page 节点，H5 里没有；
 *      变量挂在 :root 上两边都能继承到。
 *   2. 根节点的背景/字体额外挂到 body 上，H5 才生效。
 * rpx 单位 uni-app 原生支持，不用改。
 */

:root,
page {
  --c-primary: #0b7a5a;
  --c-primary-soft: #e6f4ef;
  --c-gold: #c8963e;
  --c-danger: #d9534f;
  --c-danger-soft: #fdeceb;

  --c-text: #1a1d24;
  --c-text-2: #5a6270;
  --c-text-3: #9aa1ac;

  --c-bg: #f4f5f7;
  --c-card: #ffffff;
  --c-line: #eceef1;

  --r-card: 20rpx;
  --gap: 24rpx;
}

page,
body {
  background: var(--c-bg);
  color: var(--c-text);
  font-size: 28rpx;
  line-height: 1.5;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;
}

/* --- 布局 ---------------------------------------------------------------- */

.page {
  padding: var(--gap);
  /* 给底部 tabBar / FAB 留出空间 */
  padding-bottom: 180rpx;
}

.card {
  background: var(--c-card);
  border-radius: var(--r-card);
  padding: 32rpx;
  margin-bottom: var(--gap);
}

.card-tight {
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
}

.row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.col {
  display: flex;
  flex-direction: column;
}

.flex-1 {
  flex: 1;
  min-width: 0;
}

/* --- 文字 ---------------------------------------------------------------- */

.title {
  font-size: 32rpx;
  font-weight: 600;
}

.section-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--c-text-2);
  margin: 8rpx 0 16rpx;
}

.muted {
  color: var(--c-text-3);
  font-size: 24rpx;
}

.muted-2 {
  color: var(--c-text-2);
  font-size: 26rpx;
}

.num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}

.big-num {
  font-size: 64rpx;
  font-weight: 700;
  letter-spacing: -1rpx;
  line-height: 1.15;
}

.ellipsis {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* --- 颜色语义 ------------------------------------------------------------ */
/* 分红场景下：收到的钱=正向绿，待收=金色，删除/亏损=红 */

.c-primary {
  color: var(--c-primary);
}
.c-gold {
  color: var(--c-gold);
}
.c-danger {
  color: var(--c-danger);
}
.c-2 {
  color: var(--c-text-2);
}
.c-3 {
  color: var(--c-text-3);
}

/* --- 列表行 -------------------------------------------------------------- */

.list-item {
  display: flex;
  align-items: center;
  padding: 28rpx 32rpx;
  border-bottom: 1rpx solid var(--c-line);
}

.list-item:last-child {
  border-bottom: none;
}

.list-item--tap:active {
  background: #fafbfc;
}

/* --- 标签 ---------------------------------------------------------------- */

.tag {
  display: inline-block;
  font-size: 22rpx;
  line-height: 1;
  padding: 8rpx 14rpx;
  border-radius: 999rpx;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  white-space: nowrap;
}

.tag--pending {
  background: #fdf4e3;
  color: var(--c-gold);
}

.tag--received {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.tag--muted {
  background: #f1f2f4;
  color: var(--c-text-3);
}

/* --- 按钮 ---------------------------------------------------------------- */

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  border-radius: 44rpx;
  font-size: 30rpx;
  font-weight: 500;
}

.btn--primary {
  background: var(--c-primary);
  color: #fff;
}

.btn--ghost {
  background: #fff;
  color: var(--c-text-2);
  border: 1rpx solid var(--c-line);
}

.btn--danger {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.btn:active {
  opacity: 0.85;
}

.btn--disabled {
  opacity: 0.5;
}

/* 悬浮新增按钮 */
.fab {
  position: fixed;
  right: 40rpx;
  bottom: 140rpx;
  width: 112rpx;
  height: 112rpx;
  border-radius: 56rpx;
  background: var(--c-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 60rpx;
  font-weight: 300;
  box-shadow: 0 12rpx 32rpx rgba(11, 122, 90, 0.35);
  z-index: 20;
}

.fab:active {
  transform: scale(0.94);
}

/* --- 表单 ---------------------------------------------------------------- */

.form-item {
  display: flex;
  align-items: center;
  min-height: 104rpx;
  padding: 0 32rpx;
  border-bottom: 1rpx solid var(--c-line);
}

.form-item:last-child {
  border-bottom: none;
}

.form-label {
  width: 180rpx;
  color: var(--c-text-2);
  font-size: 28rpx;
  flex-shrink: 0;
}

.form-input {
  flex: 1;
  font-size: 30rpx;
  text-align: right;
}

.form-input--left {
  text-align: left;
}

.form-placeholder {
  color: var(--c-text-3);
}

/* --- 分割 ---------------------------------------------------------------- */

.divider {
  height: 1rpx;
  background: var(--c-line);
  margin: 0 32rpx;
}

.safe-bottom {
  height: env(safe-area-inset-bottom);
}

/* 输入框占位符颜色（小程序用 placeholder-class，H5 走原生伪元素） */
::placeholder {
  color: var(--c-text-3);
}
</style>
