"""分红（实际到账）CRUD。"""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.core.money import calc_dividend_amount
from app.models.account import Account
from app.models.dividend import DIVIDEND_STATUSES, Dividend
from app.schemas.dividend import DividendCreate, DividendRead, DividendUpdate
from app.schemas.security import SecurityBrief
from app.services.security_service import get_security
from app.services.user_service import get_owned_account


def _base_stmt():
    return select(Dividend).join(Account, Dividend.account_id == Account.id)


def to_read(dividend: Dividend) -> DividendRead:
    return DividendRead(
        id=dividend.id,
        account_id=dividend.account_id,
        security_id=dividend.security_id,
        payment_date=dividend.payment_date,
        shares=dividend.shares,
        per_share=dividend.per_share,
        amount=dividend.amount,
        status=dividend.status,
        note=dividend.note,
        created_at=dividend.created_at,
        updated_at=dividend.updated_at,
        account_name=dividend.account.name if dividend.account else None,
        security=SecurityBrief.model_validate(dividend.security) if dividend.security else None,
    )


def _validate_status(value: str) -> str:
    if value not in DIVIDEND_STATUSES:
        # 用裸 422 而不是 status.HTTP_422_UNPROCESSABLE_ENTITY：
        # 后者在新版 Starlette 里已改名，写常量会在不同版本间来回报警告
        raise HTTPException(
            status_code=422,
            detail=f"status 只能是 {', '.join(DIVIDEND_STATUSES)}",
        )
    return value


def get_owned_dividend(db: Session, user_id: uuid.UUID, dividend_id: uuid.UUID) -> Dividend:
    dividend = db.scalar(
        _base_stmt()
        .options(joinedload(Dividend.account), joinedload(Dividend.security))
        .where(Dividend.id == dividend_id, Account.user_id == user_id)
    )
    if dividend is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="分红记录不存在")
    return dividend


def list_dividends(
    db: Session,
    user_id: uuid.UUID,
    *,
    account_id: uuid.UUID | None = None,
    security_id: uuid.UUID | None = None,
    year: int | None = None,
    month: int | None = None,
    status_filter: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[int, list[Dividend]]:
    """返回 (总数, 当前页数据)。"""
    conditions = [Account.user_id == user_id]

    if account_id is not None:
        get_owned_account(db, user_id, account_id)
        conditions.append(Dividend.account_id == account_id)

    # 按标的筛选用在「持仓详情 → 这个标的历史分红」。
    # security 是全局字典不需要鉴权，但结果仍然被 user_id 限制在自己的账户范围内。
    if security_id is not None:
        conditions.append(Dividend.security_id == security_id)

    if year is not None:
        conditions.append(func.extract("year", Dividend.payment_date) == year)
    if month is not None:
        conditions.append(func.extract("month", Dividend.payment_date) == month)
    if status_filter is not None:
        conditions.append(Dividend.status == _validate_status(status_filter))

    total = db.scalar(
        select(func.count())
        .select_from(Dividend)
        .join(Account, Dividend.account_id == Account.id)
        .where(*conditions)
    )

    stmt = (
        _base_stmt()
        .options(joinedload(Dividend.account), joinedload(Dividend.security))
        .where(*conditions)
        .order_by(Dividend.payment_date.desc(), Dividend.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return int(total or 0), list(db.scalars(stmt).unique().all())


def create_dividend(db: Session, user_id: uuid.UUID, payload: DividendCreate) -> Dividend:
    get_owned_account(db, user_id, payload.account_id)
    security = get_security(db, payload.security_id)
    _validate_status(payload.status)

    dividend = Dividend(
        account_id=payload.account_id,
        security_id=payload.security_id,
        payment_date=payload.payment_date,
        shares=payload.shares,
        per_share=payload.per_share,
        # 金额永远由后端算，payload 里根本没有 amount 字段
        amount=calc_dividend_amount(payload.shares, payload.per_share),
        status=payload.status,
        note=payload.note,
    )
    db.add(dividend)
    db.commit()
    db.refresh(dividend)
    dividend.account = get_owned_account(db, user_id, payload.account_id)
    dividend.security = security
    return dividend


def update_dividend(
    db: Session, user_id: uuid.UUID, dividend_id: uuid.UUID, payload: DividendUpdate
) -> Dividend:
    dividend = get_owned_dividend(db, user_id, dividend_id)
    data = payload.model_dump(exclude_unset=True)

    if "status" in data and data["status"] is not None:
        _validate_status(data["status"])

    for field, value in data.items():
        setattr(dividend, field, value)

    # 改了任一项参与计算的值，amount 必须重算（保证行内永远自洽）
    if {"shares", "per_share"} & data.keys():
        dividend.amount = calc_dividend_amount(dividend.shares, dividend.per_share)

    db.commit()
    db.refresh(dividend)
    return dividend


def delete_dividend(db: Session, user_id: uuid.UUID, dividend_id: uuid.UUID) -> None:
    dividend = get_owned_dividend(db, user_id, dividend_id)
    db.delete(dividend)
    db.commit()


def mark_received(
    db: Session, user_id: uuid.UUID, dividend_id: uuid.UUID, payment_date: date | None = None
) -> Dividend:
    """首页「确认到账」按钮。"""
    dividend = get_owned_dividend(db, user_id, dividend_id)
    dividend.status = "received"
    if payment_date is not None:
        dividend.payment_date = payment_date
    db.commit()
    db.refresh(dividend)
    return dividend
