"""首页 Dashboard。

「预计」和「实际」的数据来源完全不同，这里显式分开算，绝不混成一条 SQL：

* estimated  ← dividend_plans（标的级公开计划）× 用户当前持仓
* received   ← dividends 表里 status='received' 的记录
* pending    ← estimated - received（本年度还没到手的部分）
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.money import calc_dividend_amount, money
from app.models.account import Account
from app.models.dividend import Dividend
from app.models.dividend_plan import DividendPlan
from app.models.holding import Holding
from app.models.security import Security
from app.schemas.dashboard import (
    CurrentMonth,
    DashboardRead,
    DashboardSummary,
    NextDividend,
    RecentDividend,
)

RECENT_LIMIT = 5


def year_range(year: int) -> tuple[date, date]:
    """返回 [start, end) 左闭右开区间，避免用 <= 时漏掉 12-31 23:59:59 之类问题。"""
    return date(year, 1, 1), date(year + 1, 1, 1)


def _estimated_for_year(db: Session, user_id: uuid.UUID, year: int) -> Decimal:
    """本年度预计分红 = Σ(持仓股数 × 计划每股分红)。"""
    start, end = year_range(year)
    stmt: Select = (
        select(func.coalesce(func.sum(Holding.shares * DividendPlan.per_share), 0))
        .select_from(Holding)
        .join(Account, Holding.account_id == Account.id)
        .join(DividendPlan, DividendPlan.security_id == Holding.security_id)
        .where(
            Account.user_id == user_id,
            DividendPlan.payment_date >= start,
            DividendPlan.payment_date < end,
        )
    )
    return money(db.scalar(stmt) or 0)


def _received_for_year(db: Session, user_id: uuid.UUID, year: int) -> Decimal:
    """本年度已到账分红。"""
    start, end = year_range(year)
    stmt = (
        select(func.coalesce(func.sum(Dividend.amount), 0))
        .select_from(Dividend)
        .join(Account, Dividend.account_id == Account.id)
        .where(
            Account.user_id == user_id,
            Dividend.status == "received",
            Dividend.payment_date >= start,
            Dividend.payment_date < end,
        )
    )
    return money(db.scalar(stmt) or 0)


def _next_dividend(db: Session, user_id: uuid.UUID, today: date) -> NextDividend | None:
    """用户持仓中最近一笔还没到派息日的分红计划。"""
    stmt = (
        select(
            DividendPlan.security_id,
            DividendPlan.payment_date,
            func.sum(Holding.shares * DividendPlan.per_share).label("amount"),
        )
        .select_from(DividendPlan)
        .join(Holding, Holding.security_id == DividendPlan.security_id)
        .join(Account, Account.id == Holding.account_id)
        .where(Account.user_id == user_id, DividendPlan.payment_date >= today)
        .group_by(DividendPlan.security_id, DividendPlan.payment_date)
        .order_by(DividendPlan.payment_date.asc())
        .limit(1)
    )
    row = db.execute(stmt).first()
    if row is None:
        return None

    security = db.get(Security, row.security_id)
    if security is None:  # 理论上不会发生（有外键），防御性返回
        return None

    return NextDividend(
        security_id=row.security_id,
        security_code=security.code,
        security_name=security.name,
        payment_date=row.payment_date,
        amount=money(row.amount or 0),
        days_left=(row.payment_date - today).days,
    )


def _received_in_month(db: Session, user_id: uuid.UUID, year: int, month: int) -> Decimal:
    stmt = (
        select(func.coalesce(func.sum(Dividend.amount), 0))
        .select_from(Dividend)
        .join(Account, Dividend.account_id == Account.id)
        .where(
            Account.user_id == user_id,
            Dividend.status == "received",
            func.extract("year", Dividend.payment_date) == year,
            func.extract("month", Dividend.payment_date) == month,
        )
    )
    return money(db.scalar(stmt) or 0)


def _pending_actual_for_year(db: Session, user_id: uuid.UUID, year: int) -> Decimal:
    """本年度**已记录但还没到账**的合计（dividends.status = 'pending'）。"""
    start, end = year_range(year)
    stmt = (
        select(func.coalesce(func.sum(Dividend.amount), 0))
        .select_from(Dividend)
        .join(Account, Dividend.account_id == Account.id)
        .where(
            Account.user_id == user_id,
            Dividend.status == "pending",
            Dividend.payment_date >= start,
            Dividend.payment_date < end,
        )
    )
    return money(db.scalar(stmt) or 0)


def _recent_dividends(db: Session, user_id: uuid.UUID) -> list[RecentDividend]:
    stmt = (
        select(Dividend)
        .join(Account, Dividend.account_id == Account.id)
        .where(Account.user_id == user_id)
        .order_by(Dividend.payment_date.desc(), Dividend.created_at.desc())
        .limit(RECENT_LIMIT)
    )
    rows = db.scalars(stmt).unique().all()
    return [
        RecentDividend(
            id=d.id,
            security_name=d.security.name if d.security else "",
            security_code=d.security.code if d.security else "",
            payment_date=d.payment_date,
            shares=d.shares,
            per_share=d.per_share,
            amount=money(d.amount),
            status=d.status,
        )
        for d in rows
    ]


def get_dashboard(
    db: Session, user_id: uuid.UUID, *, year: int | None = None, today: date | None = None
) -> DashboardRead:
    today = today or date.today()
    year = year or today.year

    estimated = _estimated_for_year(db, user_id, year)
    received = _received_for_year(db, user_id, year)
    pending_actual = _pending_actual_for_year(db, user_id, year)

    # 「待收」= 本年度还没到账的金额，取下面两者的较大值：
    #   1) 预计缺口 estimated - received（计划里有、但还没到账的部分）
    #   2) 已明确记录的待收 pending_actual
    #
    # 为什么不能只写 estimated - received：
    #   当实际到账超过计划（补发、调整、或计划数据缺失）时它会变成负数，
    #   用户会看到"待收 ¥0.00"，而列表里明明躺着好几笔待收记录 —— 自相矛盾。
    # 只写 pending_actual 也不行：那样"计划里已公布、用户还没记账"的部分就消失了，
    # 而产品最想告诉用户的恰恰是"接下来还有多少"。
    pending = max(estimated - received, pending_actual)
    if pending < Decimal("0"):
        pending = Decimal("0")

    # 「本月」= 今天所在月份，年份跟随查询参数，方便翻历史年份时看同期
    month_amount = _received_in_month(db, user_id, year, today.month)

    return DashboardRead(
        year=year,
        summary=DashboardSummary(estimated=estimated, received=received, pending=money(pending)),
        next_dividend=_next_dividend(db, user_id, today),
        current_month=CurrentMonth(month=today.month, amount=month_amount),
        recent_dividends=_recent_dividends(db, user_id),
    )


def estimated_by_security(db: Session, user_id: uuid.UUID, year: int) -> list[dict]:
    """按标的拆分的预计收入，用于「预期收益」列表页。"""
    start, end = year_range(year)
    stmt = (
        select(
            Security.id,
            Security.code,
            Security.name,
            DividendPlan.payment_date,
            func.sum(Holding.shares * DividendPlan.per_share).label("amount"),
        )
        .select_from(DividendPlan)
        .join(Holding, Holding.security_id == DividendPlan.security_id)
        .join(Account, Account.id == Holding.account_id)
        .join(Security, Security.id == DividendPlan.security_id)
        .where(
            Account.user_id == user_id,
            DividendPlan.payment_date >= start,
            DividendPlan.payment_date < end,
        )
        .group_by(Security.id, Security.code, Security.name, DividendPlan.payment_date)
        .order_by(DividendPlan.payment_date.asc())
    )
    return [
        {
            "security_id": r.id,
            "security_code": r.code,
            "security_name": r.name,
            "payment_date": r.payment_date,
            "amount": money(r.amount or 0),
        }
        for r in db.execute(stmt).all()
    ]


__all__ = ["calc_dividend_amount", "estimated_by_security", "get_dashboard", "year_range"]
