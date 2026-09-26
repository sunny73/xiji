"""Dashboard。

日期相关的逻辑（next_dividend / days_left / current_month）用**注入 today** 的
service 级测试来覆盖，避免"今天正好是 12 月 31 日"这类时间炸弹；
接口层则只验证结构、鉴权和数据隔离。
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from app.models.account import Account
from app.models.dividend import Dividend
from app.models.dividend_plan import DividendPlan
from app.models.holding import Holding
from app.models.security import Security
from app.models.user import User
from app.services import dashboard_service

FIXED_TODAY = date(2026, 6, 15)


# --- 直接建数据的辅助函数（dividend_plans 在 MVP 没有对外接口） --------------


def _user(db, openid: str) -> User:
    user = User(openid=openid)
    db.add(user)
    db.commit()
    return user


def _account(db, user: User, name: str = "我的账户") -> Account:
    account = Account(user_id=user.id, name=name, type="personal")
    db.add(account)
    db.commit()
    return account


def _security(db, code: str, name: str) -> Security:
    security = Security(code=code, name=name, market="CN", type="STOCK")
    db.add(security)
    db.commit()
    return security


def _holding(db, account: Account, security: Security, shares: str) -> Holding:
    holding = Holding(account_id=account.id, security_id=security.id, shares=Decimal(shares))
    db.add(holding)
    db.commit()
    return holding


def _plan(db, security: Security, payment_date: date | None, per_share: str) -> DividendPlan:
    plan = DividendPlan(
        security_id=security.id, payment_date=payment_date, per_share=Decimal(per_share), source="manual"
    )
    db.add(plan)
    db.commit()
    return plan


def _dividend(
    db,
    account: Account,
    security: Security,
    payment_date: date,
    shares: str,
    per_share: str,
    status: str = "received",
) -> Dividend:
    amount = (Decimal(shares) * Decimal(per_share)).quantize(Decimal("0.01"))
    dividend = Dividend(
        account_id=account.id,
        security_id=security.id,
        payment_date=payment_date,
        shares=Decimal(shares),
        per_share=Decimal(per_share),
        amount=amount,
        status=status,
    )
    db.add(dividend)
    db.commit()
    return dividend


# --- service 级：确定性日期 -------------------------------------------------


def test_summary_separates_estimated_from_received(db):
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    _holding(db, account, boc, "10000")

    # 预计：0.19 × 10000 = 1900
    _plan(db, boc, date(2026, 9, 20), "0.19")
    # 实际：已到账 700
    _dividend(db, account, boc, date(2026, 3, 10), "10000", "0.07", status="received")
    # 实际：待收 300
    _dividend(db, account, boc, date(2026, 10, 1), "10000", "0.03", status="pending")

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)

    assert float(result.summary.estimated) == 1900.0
    # 只有 received 计入，pending 不算
    assert float(result.summary.received) == 700.0
    assert float(result.summary.pending) == 1200.0


def test_pending_never_negative(db):
    """实际到账比预计多（补发/调整）时，pending 夹到 0 而不是负数。"""
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    _holding(db, account, boc, "10000")
    _plan(db, boc, date(2026, 9, 20), "0.01")  # 预计只有 100
    _dividend(db, account, boc, date(2026, 3, 10), "10000", "0.50", status="received")  # 实际 5000

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert float(result.summary.pending) == 0.0


def test_pending_includes_recorded_pending_when_it_exceeds_gap(db):
    """★ 回归：实际到账超过计划时，已记录的待收不能被算成 0。

    否则用户会看到"待收 ¥0.00"，而下面列表里明明躺着待收记录 —— 自相矛盾。
    """
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    _holding(db, account, boc, "10000")
    _plan(db, boc, date(2026, 9, 20), "0.10")  # 预计 1000
    _dividend(db, account, boc, date(2026, 1, 10), "10000", "0.15", status="received")  # 到账 1500
    _dividend(db, account, boc, date(2026, 10, 1), "10000", "0.20", status="pending")  # 待收 2000

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert float(result.summary.received) == 1500.0
    # 缺口是 1000-1500 = -500，但已记录待收是 2000，取较大者
    assert float(result.summary.pending) == 2000.0


def test_pending_falls_back_to_gap_when_nothing_recorded(db):
    """没有任何待收记录时，pending 就是「预计缺口」，和 PRD 的例子一致。"""
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    _holding(db, account, boc, "10000")
    _plan(db, boc, date(2026, 9, 20), "0.19")  # 预计 1900
    _dividend(db, account, boc, date(2026, 3, 10), "10000", "0.07", status="received")  # 到账 700

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert float(result.summary.estimated) == 1900.0
    assert float(result.summary.received) == 700.0
    assert float(result.summary.pending) == 1200.0  # 1900 - 700


def test_pending_ignores_other_years(db):
    """去年的待收不能算进今年的待收。"""
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    _dividend(db, account, boc, date(2025, 12, 1), "10000", "0.50", status="pending")

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert float(result.summary.pending) == 0.0


def test_estimated_follows_current_holdings(db):
    """预计收入跟着持仓走：减仓之后预计自动变小。"""
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    holding = _holding(db, account, boc, "10000")
    _plan(db, boc, date(2026, 9, 20), "0.19")

    before = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert float(before.summary.estimated) == 1900.0

    holding.shares = Decimal("5000")
    db.commit()

    after = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert float(after.summary.estimated) == 950.0


def test_estimated_sums_same_security_across_accounts(db):
    user = _user(db, "u1")
    a1 = _account(db, user, "我的账户")
    a2 = _account(db, user, "老婆账户")
    boc = _security(db, "601988", "中国银行")
    _holding(db, a1, boc, "10000")
    _holding(db, a2, boc, "5000")
    _plan(db, boc, date(2026, 9, 20), "0.19")

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert float(result.summary.estimated) == 2850.0  # 15000 × 0.19


def test_plans_without_payment_date_are_ignored(db):
    """只公布预案、还没定派息日的，不能算进预计收入。"""
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    _holding(db, account, boc, "10000")
    _plan(db, boc, None, "0.19")

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert float(result.summary.estimated) == 0.0


def test_next_dividend_and_days_left(db):
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    petro = _security(db, "601857", "中国石油")
    _holding(db, account, boc, "10000")
    _holding(db, account, petro, "2000")

    _plan(db, boc, FIXED_TODAY - timedelta(days=10), "0.19")  # 已过
    _plan(db, petro, FIXED_TODAY + timedelta(days=2), "0.16")  # 最近
    _plan(db, boc, FIXED_TODAY + timedelta(days=100), "0.20")

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)

    nxt = result.next_dividend
    assert nxt is not None
    assert nxt.security_code == "601857"
    assert nxt.payment_date == FIXED_TODAY + timedelta(days=2)
    assert nxt.days_left == 2
    assert float(nxt.amount) == 320.0  # 2000 × 0.16


def test_next_dividend_none_when_no_future_plan(db):
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    _holding(db, account, boc, "10000")
    _plan(db, boc, FIXED_TODAY - timedelta(days=1), "0.19")

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert result.next_dividend is None


def test_next_dividend_ignores_securities_user_does_not_hold(db):
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    petro = _security(db, "601857", "中国石油")
    _holding(db, account, boc, "10000")
    _plan(db, petro, FIXED_TODAY + timedelta(days=1), "0.16")  # 没持仓
    _plan(db, boc, FIXED_TODAY + timedelta(days=30), "0.19")

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert result.next_dividend.security_code == "601988"


def test_current_month_uses_today_month(db):
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    _dividend(db, account, boc, date(2026, 6, 3), "1000", "0.5", status="received")
    _dividend(db, account, boc, date(2026, 6, 20), "1000", "0.7", status="received")
    _dividend(db, account, boc, date(2026, 7, 1), "1000", "9.0", status="received")
    # 待收的不能计入本月已到账
    _dividend(db, account, boc, date(2026, 6, 25), "1000", "5.0", status="pending")

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert result.current_month.month == 6
    assert float(result.current_month.amount) == 1200.0


def test_recent_dividends_are_limited_and_sorted(db):
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    for day in range(1, 9):
        _dividend(db, account, boc, date(2026, 1, day), "100", "1", status="received")

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    assert len(result.recent_dividends) == 5
    assert result.recent_dividends[0].payment_date == date(2026, 1, 8)
    assert result.recent_dividends[-1].payment_date == date(2026, 1, 4)


def test_recent_dividends_carry_shares_and_per_share(db):
    """★ 回归：首页「最近记录」要渲染成"10000 股 × 0.19"。

    RecentDividend 曾经漏了这两个字段，模板读到 undefined -> 显示"0 股 × 0"。
    这种 bug 后端测试和前端单测都抓不到，只有真的看一眼渲染结果才会发现。
    """
    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    _dividend(db, account, boc, date(2026, 3, 10), "10000", "0.19", status="received")

    result = dashboard_service.get_dashboard(db, user.id, year=2026, today=FIXED_TODAY)
    item = result.recent_dividends[0]
    assert float(item.shares) == 10000.0
    assert float(item.per_share) == 0.19

    # 序列化之后也不能丢（schema 漏字段的话这里会 KeyError）
    payload = item.model_dump()
    assert "shares" in payload and "per_share" in payload


def test_calendar_items_carry_shares_and_per_share(db):
    """日历页同一行同样要显示股数和每股金额。"""
    from app.services import statistics_service

    user = _user(db, "u1")
    account = _account(db, user)
    boc = _security(db, "601988", "中国银行")
    _dividend(db, account, boc, date(2026, 6, 18), "20000", "0.18", status="received")

    days = statistics_service.calendar(db, user.id, year=2026, month=6)
    assert len(days) == 1
    item = days[0].items[0]
    assert float(item.shares) == 20000.0
    assert float(item.per_share) == 0.18


def test_other_users_data_is_not_mixed_in(db):
    mine = _user(db, "me")
    theirs = _user(db, "them")
    my_account = _account(db, mine)
    their_account = _account(db, theirs)
    boc = _security(db, "601988", "中国银行")

    _holding(db, my_account, boc, "10000")
    _holding(db, their_account, boc, "999999")
    _plan(db, boc, date(2026, 9, 20), "0.19")
    _dividend(db, their_account, boc, date(2026, 3, 1), "999999", "9.9", status="received")

    result = dashboard_service.get_dashboard(db, mine.id, year=2026, today=FIXED_TODAY)
    assert float(result.summary.estimated) == 1900.0
    assert float(result.summary.received) == 0.0
    assert result.recent_dividends == []


# --- 接口层：结构 / 鉴权 ----------------------------------------------------


def test_dashboard_requires_auth(client):
    assert client.get("/api/v1/dashboard").status_code == 401


def test_dashboard_endpoint_shape(client, headers, make_holding):
    holding = make_holding(headers, shares="10000")
    created = client.post(
        "/api/v1/dividends",
        json={
            "account_id": holding["account_id"],
            "security_id": holding["security_id"],
            "payment_date": f"{date.today().year}-01-15",
            "shares": "10000",
            "per_share": "0.07",
            "status": "received",
        },
        headers=headers,
    )
    assert created.status_code == 201

    resp = client.get("/api/v1/dashboard", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert set(body) == {"year", "summary", "next_dividend", "current_month", "recent_dividends"}
    assert set(body["summary"]) == {"estimated", "received", "pending"}
    assert body["summary"]["received"] == 700.0
    assert len(body["recent_dividends"]) == 1
    assert body["recent_dividends"][0]["security_name"] == "中国银行"


def test_dashboard_of_other_user_is_empty(client, headers, other_headers, make_dividend):
    make_dividend(other_headers, shares="10000", per_share="0.19", status="received")
    body = client.get("/api/v1/dashboard", headers=headers).json()
    assert body["summary"]["received"] == 0.0
    assert body["recent_dividends"] == []


def test_estimated_endpoint(client, headers, make_holding, db):
    holding = make_holding(headers, shares="10000")
    db.add(
        DividendPlan(
            security_id=holding["security_id"],
            payment_date=date(2026, 9, 20),
            per_share=Decimal("0.19"),
            source="manual",
        )
    )
    db.commit()

    resp = client.get("/api/v1/dashboard/estimated?year=2026", headers=headers)
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["security_code"] == "601988"
    assert rows[0]["amount"] == 1900.0
