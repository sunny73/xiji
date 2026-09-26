# 分红管家 · 技术设计说明

> 这份文档回答「为什么这么设计」，而不是「怎么用」。怎么用见 [README.md](../README.md)。

## 一、一张图看清数据模型

```
                        ┌──────────────┐
                        │    users     │  微信 openid 唯一
                        │──────────────│
                        │ id (uuid) PK │
                        │ openid       │
                        │ nickname     │
                        └──────┬───────┘
                               │ 1 : N   （ON DELETE CASCADE）
                        ┌──────▼───────┐
                        │   accounts   │  「我的账户 / 老婆账户 / 退休账户」
                        │──────────────│
                        │ id (uuid) PK │
                        │ user_id  FK  │◄──── 权限边界在这一层
                        │ name, type   │
                        └──┬────────┬──┘
             1 : N         │        │        1 : N
        ┌──────────────────▼──┐  ┌──▼────────────────────┐
        │     holdings        │  │      dividends        │
        │─────────────────────│  │───────────────────────│
        │ account_id  FK      │  │ account_id  FK        │
        │ security_id FK      │  │ security_id FK        │
        │ shares              │  │ payment_date          │
        │ cost_price          │  │ shares, per_share     │
        │ UNIQUE(account,sec) │  │ amount  ← 后端算       │
        └─────────┬───────────┘  │ status: pending/      │
                  │              │         received      │
                  │              └───────────┬───────────┘
                  │                          │
                  │      ┌───────────────────┘
                  │      │
              ┌───▼──────▼────┐                ┌────────────────────────┐
              │  securities   │  1 : N         │    dividend_plans      │
              │───────────────│◄───────────────│────────────────────────│
              │ code, market  │                │ security_id  FK        │
              │ UNIQUE(code,  │                │ record_date            │
              │        market)│                │ ex_date                │
              │ name, type    │                │ payment_date           │
              └───────────────┘                │ per_share              │
                 全局字典                       │ UNIQUE(security,       │
                 （不属于任何用户）              │        payment_date)   │
                                                └────────────────────────┘
                                                  标的级公开信息
                                                  （也不属于任何用户）
```

## 二、三个关键设计决策

### 1. 为什么「预计」和「实际」必须是两张表

`dividend_plans` 是**标的级**的公开信息（"中国银行每股派 0.19 元"），
`dividends` 是**用户级**的实际记录（"我 10 月 17 日到账 1900 元"）。
它们的生命周期、来源、更新频率完全不一样：

| | dividend_plans | dividends |
|---|---|---|
| 归属 | 标的（全局） | 账户（用户私有） |
| 来源 | 公告 / 人工维护 | 用户录入 / 将来同步 |
| 会不会变 | 公司可能改方案 | 用户减仓、扣税都会让实际≠预计 |
| 谁写 | 后台任务 | 用户本人 |

合并成一张表的后果是：用户减仓后，历史「已到账」记录会被"预计值"覆盖掉，
而且再也分不清「这笔钱到底到没到」。所以两张表不是洁癖，是数据完整性要求。

**Dashboard 的 estimated 完全由 plan × 当前持仓实时算出**，不落库。
好处是用户改了持仓，预计收入立刻跟着变，不需要任何补偿逻辑。

### 2. 为什么 holdings 上有 `UNIQUE(account_id, security_id)`

第一版一笔持仓 = 一个账户下一个标的一行。这样：
* 统计不会因为重复录入而翻倍；
* 用户"加仓"就是改 `shares`，心智负担最低。

代价是记不了「分批建仓 / 每笔不同成本」。真要做的时候，
加一张 `holding_lots` 表、把这条唯一约束降级为普通索引即可，
`dividends` 表完全不用动。

### 3. 权限为什么靠 `JOIN accounts`，而且失败返回 404

所有查询都必须长这样：

```sql
SELECT * FROM dividends d
JOIN accounts a ON d.account_id = a.id
WHERE d.id = :dividend_id
  AND a.user_id = :current_user_id;   -- ← 这一行是安全边界
```

绝不能写 `WHERE d.id = :id` 然后"查出来再在 Python 里比对 user_id"——
那种写法只要有一处忘了比对就是越权漏洞，而 JOIN 式写法是**默认安全**的。

取不到时返回 **404 而不是 403**：403 等于告诉攻击者"这个 id 真实存在，
只是不属于你"，把别人的 id 变成了可枚举的信息。统一 404 什么都不泄露。

`tests/test_permissions.py` 会从 OpenAPI schema 自动发现所有 `/api` 路由，
**新加了接口但忘了鉴权，测试会直接失败**，不依赖人工 review。

## 三、金额计算

```python
amount = (Decimal(shares) * Decimal(per_share)).quantize(Decimal("0.01"), ROUND_HALF_UP)
```

三条硬规则：

1. **只由后端算。** `DividendCreate` 里根本没有 `amount` 字段，且 `extra="forbid"`,
   前端传 `amount` 会拿到 422（明确拒绝），而不是被静默忽略——静默忽略会让前端
   以为自己的值生效了，日后对账时是灾难。
2. **全程 Decimal。** 不用 float。`Decimal(0.19)` 会带出二进制误差，
   所以 `app/core/money.py` 里的 `to_decimal()` 对 float 强制走 `str()` 中转。
3. **记录可回溯。** 表里同时存 `shares`、`per_share`、`amount`。
   只存金额的话，用户日后看到"1900 元"根本想不起来是按多少股算的。

改 `shares` 或 `per_share` 时 `amount` 会自动重算（见 `dividend_service.update_dividend`），
保证同一行内的数据永远自洽。

## 四、时间与时区

* 所有时间戳列用 `TIMESTAMP WITH TIME ZONE`（不是裸 `TIMESTAMP`）。
* 所有"日期"语义的列（派息日、登记日）用 `DATE`，不带时间。
* 年份区间查询一律用 **左闭右开** `[1/1, 次年1/1)`，
  避免 `BETWEEN` 在含时间部分时漏掉 12-31 当天数据。
* 服务端统一按部署机器时区取 `date.today()`。分红是"日"粒度的业务，
  不需要也不应该引入用户级时区。

## 五、API 设计约定

| 约定 | 说明 |
|---|---|
| 版本前缀 | 全部挂在 `/api/v1` 下 |
| 认证 | `Authorization: Bearer <JWT>`，token 里只有 `sub`(user id) |
| 金额/数量 | JSON 里是 number（如 `1900.0`），库内是 NUMERIC |
| 时间 | ISO 8601；日期就是 `"2026-09-20"` |
| 列表 | 可能增长的（分红）一律分页；小而固定的（账户、持仓）直接返回数组 |
| 状态码 | 401 未登录 / 404 不存在或无权 / 409 冲突 / 422 参数不合法 |
| 幂等 | `POST /securities` 幂等（同 code+market 返回已有记录） |

### 路由总览

```
POST   /api/v1/auth/wechat-login        code → openid → JWT
POST   /api/v1/auth/dev-login           【仅开发】免微信登录
GET    /api/v1/auth/me
PATCH  /api/v1/auth/me

GET    POST                            /api/v1/accounts
GET    PUT     DELETE                  /api/v1/accounts/{id}

GET    POST                            /api/v1/securities      (?keyword=)
GET                                    /api/v1/securities/{id}

GET    POST                            /api/v1/holdings        (?account_id=)
GET    PUT     DELETE                  /api/v1/holdings/{id}

GET    POST                            /api/v1/dividends       (?account_id&year&month&status&page)
GET    PUT     DELETE                  /api/v1/dividends/{id}
POST                                   /api/v1/dividends/{id}/receive

GET    /api/v1/dashboard               (?year=)
GET    /api/v1/dashboard/estimated     (?year=)

GET    /api/v1/statistics/yearly       (?status=)
GET    /api/v1/statistics/monthly      (?year=&status=)   固定返回 12 个月
GET    /api/v1/statistics/securities   (?year=&status=)
GET    /api/v1/statistics/calendar     (?year=&month=)
```

完整、可交互的文档在服务启动后的 `/docs`。

## 六、这一版刻意没做的事

按 PRD 的要求，以下全部**不做**，且代码里**不留半成品**：

| 不做 | 为什么 |
|---|---|
| OCR 识别券商对账单 | 用户量没起来之前，识别准确率带来的客诉成本 > 手工录入成本 |
| LLM 分析 | 没有数据量支撑，做出来是玩具 |
| 行情 / 自动分红同步 | 需要数据源采购 + 定时任务，MVP 阶段手工录入足够验证需求 |
| 港股 / 美股 | 数据库已用 `market` 字段预留，但不做，避免汇率/税费复杂度 |
| 会员 / 微信支付 | 先验证留存，再谈变现 |
| 复杂估值 / 复利计算 | 第一版核心指标是"分红现金流"，不是总资产 |

`app/tasks/` 下留了 `dividend_sync.py` 和 `notification.py` 的**函数签名 + docstring**，
但没有实现（调用会 `NotImplementedError`）。这样将来接手的人知道入口在哪、
要传什么参数，而不是面对一个空目录。

**Redis 也没加。** 当前没有任何东西需要它——没有缓存、没有队列、没有定时任务。
加一个空转的 Redis 容器只会增加运维面。

## 七、下一步（按优先级）

1. **微信小程序前端**（Phase 6）：首页 / 持仓 / 分红 / 统计 / 我的
2. **部署**（Phase 7）：域名 + HTTPS + 微信后台配置 request 合法域名
3. 分红日历页用到 `GET /statistics/calendar`，接口已经就绪
4. 之后才是数据源接入、OCR、提醒
