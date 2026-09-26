<template>
  <view class="page">
    <view v-if="error" class="error-card" @tap="load">
      <view class="error-title">加载失败</view>
      <view class="error-msg">{{ error }}</view>
      <view class="error-retry">点击重试</view>
    </view>

    <!-- 月份切换 -->
    <view class="month-bar">
      <view class="month-nav" @tap="shift(-1)">‹</view>
      <view class="month-title" @tap="goToday">
        <text>{{ monthLabel }}</text>
        <text class="month-today">回到本月</text>
      </view>
      <view class="month-nav" @tap="shift(1)">›</view>
    </view>

    <!-- 日历 -->
    <view class="calendar">
      <view class="week-row">
        <view v-for="w in weekLabels" :key="w" class="week-cell">{{ w }}</view>
      </view>

      <view v-for="row in rows" :key="row.key" class="day-row">
        <view
          v-for="cell in row.cells"
          :key="cell.iso"
          class="day-cell"
          :class="{
            'day-cell--out': !cell.inMonth,
            'day-cell--today': cell.isToday,
            'day-cell--on': cell.isSelected,
          }"
          @tap="onDayTap(cell.iso)"
        >
          <text class="day-num">{{ cell.day }}</text>
          <text v-if="cell.hasDividend" class="day-amount">{{ cell.amountText }}</text>
          <text v-else class="day-dot-space"></text>
        </view>
      </view>
    </view>

    <view v-if="loading" class="muted center">加载中…</view>

    <!-- 选中日详情 -->
    <template v-if="selectedDate">
      <view class="row-between section-head">
        <text class="section-title">{{ selectedDateText }}</text>
        <text class="num section-total">
          {{ selectedItems.length ? '¥' + selectedTotalText : '' }}
        </text>
      </view>

      <view class="card card-tight">
        <template v-if="selectedItems.length">
          <view
            v-for="item in selectedItems"
            :key="item.id"
            class="list-item list-item--tap"
            @tap="goDividend(item.id)"
          >
            <view class="flex-1 col">
              <text class="item-name ellipsis">{{ item.securityName }}</text>
              <text class="muted">
                {{ item.sharesText }} 股 × {{ item.perShareText }} · {{ item.accountName }}
              </text>
            </view>
            <view class="col item-right">
              <text class="num item-amount">¥{{ item.amountText }}</text>
              <text class="tag" :class="item.statusCls">{{ item.statusLabel }}</text>
            </view>
          </view>
        </template>
        <view v-else class="muted center pad">这天没有分红记录</view>
      </view>
    </template>

    <view v-else class="hint-tap">点击日期查看当天的分红</view>
  </view>
</template>

<script setup>
/**
 * 分红日历。
 *
 * 比原版干净的地方：原版要手写 buildRows() 并在每次 setData 时重建行，
 * 这里 rows 直接是 computed —— 选中态、数据、月份任何一个变，行自动重算，
 * 不用再维护「改了 A 别忘了重建 B」这类同步逻辑。
 *
 * 竞态守卫保留：快速连点月份箭头时，先发的请求可能后回来。
 */
import { ref, computed } from 'vue'
import { onLoad, onUnload, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import * as api from '../../services/api'
import * as fmt from '../../utils/format'
import * as ui from '../../utils/ui'
import * as cal from '../../utils/calendar'
import * as decorate from '../../utils/decorate'
import { createGuard } from '../../utils/seq'

const guard = createGuard()
const start = fmt.today()

const year = ref(start.year)
const month = ref(start.month)
const loading = ref(true)
const error = ref('')

const dayMap = ref({})
const selectedDate = ref('')

const weekLabels = cal.WEEK_LABELS

const monthLabel = computed(() => year.value + ' 年 ' + month.value + ' 月')

/** 选中日的信息直接从 dayMap 派生，不用另存一份状态 */
const selectedDay = computed(() => dayMap.value[selectedDate.value] || null)
const selectedItems = computed(() => (selectedDay.value ? selectedDay.value.items : []))
const selectedTotalText = computed(() => (selectedDay.value ? selectedDay.value.totalText : '0.00'))
const selectedDateText = computed(() =>
  selectedDate.value ? fmt.dateCN(selectedDate.value, { withYear: true }) : ''
)

/** 月历网格：选中态和"这天有没有分红"都在这里算 */
const rows = computed(() => {
  const cells = cal.monthMatrix(year.value, month.value).map((c) => {
    const hit = dayMap.value[c.iso]
    return Object.assign({}, c, {
      hasDividend: !!hit,
      amountText: hit ? hit.totalShortText : '',
      isSelected: c.iso === selectedDate.value,
    })
  })
  // wx:key 只认 item 上的属性，所以每行挂一个显式 key
  return cal.monthRows(cells).map((cellsInRow, i) => ({ key: 'week-' + i, cells: cellsInRow }))
})

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
  loading.value = true
  error.value = ''

  try {
    const list = await api.statistics.calendar({ year: year.value, month: month.value })
    if (!guard.isCurrent(token)) return

    const map = {}
    ;(list || []).forEach((d) => {
      map[d.date] = {
        total: fmt.toNumber(d.total),
        totalText: fmt.money(d.total),
        totalShortText: fmt.moneyCompact(d.total),
        items: (d.items || []).map(decorate.dividend),
      }
    })
    dayMap.value = map
  } catch (err) {
    if (!guard.isCurrent(token)) return
    error.value = err.message || '加载失败'
  } finally {
    if (guard.isCurrent(token)) loading.value = false
  }
}

// --- 月份切换 -----------------------------------------------------------

function shift(delta) {
  const next = cal.shiftMonth(year.value, month.value, delta)
  year.value = next.year
  month.value = next.month
  selectedDate.value = ''
  load()
}

function goToday() {
  year.value = start.year
  month.value = start.month
  selectedDate.value = ''
  load()
}

// --- 选日期 -------------------------------------------------------------

function onDayTap(iso) {
  selectedDate.value = selectedDate.value === iso ? '' : iso
}

function goDividend(id) {
  ui.navTo('/pages/dividend-create/index?id=' + id)
}
</script>

<style scoped>
/* 分红日历 */

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

/* --- 月份切换 ------------------------------------------------------------ */

.month-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--gap);
}

.month-nav {
  width: 80rpx;
  height: 80rpx;
  border-radius: 40rpx;
  background: var(--c-card);
  color: var(--c-text-2);
  font-size: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.month-nav:active {
  opacity: 0.6;
}

.month-title {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 34rpx;
  font-weight: 600;
}

.month-today {
  font-size: 22rpx;
  color: var(--c-primary);
  font-weight: 400;
  margin-top: 4rpx;
}

/* --- 日历 ---------------------------------------------------------------- */

.calendar {
  background: var(--c-card);
  border-radius: var(--r-card);
  padding: 20rpx 12rpx 24rpx;
  margin-bottom: var(--gap);
}

.week-row,
.day-row {
  display: flex;
}

.week-cell {
  flex: 1;
  text-align: center;
  font-size: 22rpx;
  color: var(--c-text-3);
  padding: 12rpx 0;
}

.day-cell {
  flex: 1;
  height: 96rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin: 3rpx;
  border-radius: 16rpx;
}

.day-cell--out .day-num,
.day-cell--out .day-amount {
  color: #c8ccd2;
}

.day-cell--today {
  background: var(--c-primary-soft);
}

.day-cell--on {
  background: var(--c-primary);
}

.day-cell--on .day-num,
.day-cell--on .day-amount {
  color: #fff;
}

.day-num {
  font-size: 28rpx;
  font-weight: 500;
  line-height: 1.2;
}

.day-amount {
  font-size: 18rpx;
  color: var(--c-primary);
  margin-top: 2rpx;
  line-height: 1.2;
}

.day-dot-space {
  height: 22rpx;
}

/* --- 详情 ---------------------------------------------------------------- */

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

.section-total {
  color: var(--c-primary);
  font-weight: 600;
  font-size: 28rpx;
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
  font-size: 30rpx;
  font-weight: 600;
  color: var(--c-primary);
  margin-bottom: 6rpx;
}

.center {
  text-align: center;
}

.pad {
  padding: 40rpx 0;
}

.hint-tap {
  text-align: center;
  font-size: 24rpx;
  color: var(--c-text-3);
  padding: 20rpx 0;
}
</style>
