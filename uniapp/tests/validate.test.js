/** utils/validate.js 的测试 */

import * as v from '../src/utils/validate.js'

export default function (t) {
  // --- parseAmount --------------------------------------------------------
  t.eq(v.parseAmount('100', {}), { ok: true, value: 100 }, 'parseAmount 整数')
  t.eq(v.parseAmount('100.25', {}), { ok: true, value: 100.25 }, 'parseAmount 小数')
  t.eq(v.parseAmount(' 100 ', {}), { ok: true, value: 100 }, 'parseAmount 去空格')
  t.eq(v.parseAmount(100, {}), { ok: true, value: 100 }, 'parseAmount 接受数字')

  t.eq(v.parseAmount('', { label: '股数' }), { ok: false, message: '请填写股数' }, 'parseAmount 必填')
  t.eq(
    v.parseAmount('', { optional: true }),
    { ok: true, value: null },
    'parseAmount 可空时返回 null'
  )

  t.ok(!v.parseAmount('abc', { label: '股数' }).ok, 'parseAmount 拒绝非数字')
  t.ok(!v.parseAmount('12abc').ok, 'parseAmount 拒绝混合字符')
  // Number() 会把这些当合法，我们必须拒绝
  t.ok(!v.parseAmount('1e3').ok, 'parseAmount 拒绝科学计数法')
  t.ok(!v.parseAmount('0x10').ok, 'parseAmount 拒绝十六进制')
  t.ok(!v.parseAmount('Infinity').ok, 'parseAmount 拒绝 Infinity')
  t.ok(!v.parseAmount('1.2.3').ok, 'parseAmount 拒绝多个小数点')
  t.ok(!v.parseAmount('-5').ok, 'parseAmount 拒绝负号')
  t.ok(!v.parseAmount('+5').ok, 'parseAmount 拒绝正号')

  t.eq(
    v.parseAmount('0', { label: '股数', min: 0.0001 }),
    { ok: false, message: '股数必须大于 0' },
    'parseAmount min 边界'
  )
  t.ok(v.parseAmount('0.0001', { min: 0.0001 }).ok, 'parseAmount 等于 min 通过')
  t.ok(!v.parseAmount('101', { max: 100 }).ok, 'parseAmount max')
  t.ok(v.parseAmount('100', { max: 100 }).ok, 'parseAmount 等于 max 通过')

  t.ok(v.parseAmount('0.19', { decimals: 4 }).ok, 'parseAmount 小数位达标')
  t.ok(!v.parseAmount('0.1234567', { decimals: 6, label: '每股分红' }).ok, 'parseAmount 小数位超限')

  t.eq(
    v.parseAmount('10000', { label: '股数', min: 0.0001, decimals: 4 }),
    { ok: true, value: 10000 },
    'parseAmount 组合约束'
  )

  // --- requiredText -------------------------------------------------------
  t.eq(v.requiredText('中国银行', '名称'), { ok: true, value: '中国银行' }, 'requiredText')
  t.eq(v.requiredText('  x  ', '名称'), { ok: true, value: 'x' }, 'requiredText 去空格')
  t.eq(
    v.requiredText('   ', '名称'),
    { ok: false, message: '请填写名称' },
    'requiredText 全空格视为空'
  )

  // --- securityCode -------------------------------------------------------
  t.eq(v.securityCode('601988'), { ok: true, value: '601988' }, 'securityCode 数字代码')
  t.eq(v.securityCode('aapl'), { ok: true, value: 'AAPL' }, 'securityCode 转大写')
  t.eq(v.securityCode('00700'), { ok: true, value: '00700' }, 'securityCode 保留前导零')
  t.eq(v.securityCode('600519.SH'), { ok: true, value: '600519.SH' }, 'securityCode 允许点')
  t.eq(v.securityCode('BRK-B'), { ok: true, value: 'BRK-B' }, 'securityCode 允许连字符')
  t.ok(!v.securityCode('').ok, 'securityCode 必填')
  t.ok(!v.securityCode('中国银行').ok, 'securityCode 拒绝中文')
  t.ok(!v.securityCode('a'.repeat(31)).ok, 'securityCode 超长（对齐 VARCHAR(30)）')
  t.ok(v.securityCode('a'.repeat(30)).ok, 'securityCode 30 字符正好')

  // --- dateString ---------------------------------------------------------
  t.eq(v.dateString('2026-09-20'), { ok: true, value: '2026-09-20' }, 'dateString 合法')
  t.ok(!v.dateString('2026-9-20').ok, 'dateString 要求补零')
  t.ok(!v.dateString('2026/09/20').ok, 'dateString 拒绝斜杠')
  t.ok(!v.dateString('').ok, 'dateString 必填')
  t.eq(
    v.dateString('2026-02-31', '派息日'),
    { ok: false, message: '日期不存在' },
    'dateString 拒绝不存在的日期'
  )
  t.ok(v.dateString('2024-02-29').ok, 'dateString 闰年 2/29 合法')
  t.ok(!v.dateString('2026-02-29').ok, 'dateString 平年 2/29 非法')
  t.ok(!v.dateString('2026-13-01').ok, 'dateString 拒绝 13 月')

  // --- firstError ---------------------------------------------------------
  t.eq(v.firstError([{ ok: true }, { ok: true }]), null, 'firstError 全通过返回 null')
  t.eq(
    v.firstError([{ ok: true }, { ok: false, message: '第二个错了' }, { ok: false, message: 'x' }]),
    '第二个错了',
    'firstError 返回第一个错误'
  )
}
