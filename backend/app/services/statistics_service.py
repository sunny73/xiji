"""统计。全部基于**实际分红记录**（dividends 表），不掺预计数据。

前端只负责画图，补零、排序、聚合都在这里做完，保证图表 X 轴永远是完整的 12 个月。
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.core.money import money
from app.models.account import Account
from app.models.dividend import Dividend
from app.models.security import Security
from app.schemas.dashboard import CalendarDay, MonthlyStat, RecentDividend, SecurityStat, YearlyStat


def _scoped(*extra):
    """统计查询的公共骨架：dividends JOIN accounts，并强制 user_id 过滤。"""
    return (
        select(*extra)
        .select_from(Dividend)
        .join(Account, Dividend.account_id == Account.id)
    )


def yearly(db: Session, user_id: uuid.UUID, *, status_filter: str | None = None) -> list[YearlyStat]:
    """按年汇总。"""
    year_col = func.extract("year", Dividend.payment_date).label("year")
    stmt = _scoped(
        year_col,
        func.sum(Dividend.amount).label("amount"),
        func.count(Dividend.id).label("count"),
    ).where(Account.user_id == user_id)

    if status_filter:
        stmt = stmt.where(Dividend.status == status_filter)

    stmt = stmt.group_by(year_col).order_by(year_col.asc())
    return [
        YearlyStat(year=int(r.year), amount=money(r.amount), count=int(r.count))
        for r in db.execute(stmt).all()
    ]


def monthly(
    db: Session, user_id: uuid.UUID, *, year: int, status_filter: str | None = None
) -> list[MonthlyStat]:
    """按年取 12 个月；没有数据的月份补 0，前端不用自己填洞。"""
    month_col = func.extract("month", Dividend.payment_date).label("month")
    stmt = _scoped(
        month_col,
        func.sum(Dividend.amount).label("amount"),
        func.count(Dividend.id).label("count"),
    ).where(Account.user_id == user_id, func.extract("year", Dividend.payment_date) == year)

    if status_filter:
        stmt = stmt.where(Dividend.status == status_filter)

    stmt = stmt.group_by(month_col)
    found = {int(r.month): (money(r.amount), int(r.count)) for r in db.execute(stmt).all()}

    return [
        MonthlyStat(month=m, amount=found.get(m, (money(0), 0))[0], count=found.get(m, (0, 0))[1])
        for m in range(1, 13)
    ]


def by_security(
    db: Session,
    user_id: uuid.UUID,
    *,
    year: int | None = None,
    status_filter: str | None = None,
) -> list[SecurityStat]:
    """按标的汇总，默认全历史。"""
    stmt = (
        select(
            Security.id,
            Security.code,
            Security.name,
            func.sum(Dividend.amount).label("amount"),
            func.count(Dividend.id).label("count"),
        )
        .select_from(Dividend)
        .join(Account, Dividend.account_id == Account.id)
        .join(Security, Security.id == Dividend.security_id)
        .where(Account.user_id == user_id)
    )

    if year is not None:
        stmt = stmt.where(func.extract("year", Dividend.payment_date) == year)
    if status_filter:
        stmt = stmt.where(Dividend.status == status_filter)

    stmt = stmt.group_by(Security.id, Security.code, Security.name).order_by(
        func.sum(Dividend.amount).desc()
    )
    return [
        SecurityStat(
            security_id=r.id,
            security_code=r.code,
            security_name=r.name,
            amount=money(r.amount),
            count=int(r.count),
        )
        for r in db.execute(stmt).all()
    ]


def calendar(
    db: Session, user_id: uuid.UUID, *, year: int, month: int | None = None
) -> list[CalendarDay]:
    """分红日历：按日期分组。month 为空则返回整年。"""
    stmt = (
        select(Dividend)
        .join(Account, Dividend.account_id == Account.id)
        .options(joinedload(Dividend.security))
        .where(Account.user_id == user_id, func.extract("year", Dividend.payment_date) == year)
    )
    if month is not None:
        stmt = stmt.where(func.extract("month", Dividend.payment_date) == month)
    stmt = stmt.order_by(Dividend.payment_date.asc())

    buckets: dict[date, list[RecentDividend]] = {}
    for d in db.scalars(stmt).unique().all():
        buckets.setdefault(d.payment_date, []).append(
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
        )

    return [
        CalendarDay(
            date=day,
            total=money(sum((item.amount for item in items), start=0)),
            items=items,
        )
        for day, items in sorted(buckets.items())
    ]
