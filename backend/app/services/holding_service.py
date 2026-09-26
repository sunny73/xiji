"""持仓 CRUD。

注意每个查询都从 ``holdings JOIN accounts`` 出发并带 ``accounts.user_id = :me``，
绝不出现 ``WHERE holdings.id = :id`` 这种裸查——那就是越权漏洞。
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.money import money
from app.models.account import Account
from app.models.holding import Holding
from app.schemas.holding import HoldingCreate, HoldingRead, HoldingUpdate
from app.schemas.security import SecurityBrief
from app.services.security_service import get_security
from app.services.user_service import get_owned_account


def _base_stmt():
    return select(Holding).join(Account, Holding.account_id == Account.id)


def to_read(holding: Holding) -> HoldingRead:
    """ORM → 返回体。ORM 上加的属性（account_name / cost_amount）在这里补。"""
    cost_amount = None
    if holding.cost_price is not None:
        cost_amount = money(holding.cost_price * holding.shares)

    return HoldingRead(
        id=holding.id,
        account_id=holding.account_id,
        security_id=holding.security_id,
        shares=holding.shares,
        cost_price=holding.cost_price,
        created_at=holding.created_at,
        updated_at=holding.updated_at,
        account_name=holding.account.name if holding.account else None,
        security=SecurityBrief.model_validate(holding.security) if holding.security else None,
        cost_amount=cost_amount,
    )


def get_owned_holding(db: Session, user_id: uuid.UUID, holding_id: uuid.UUID) -> Holding:
    holding = db.scalar(
        _base_stmt()
        .options(joinedload(Holding.account), joinedload(Holding.security))
        .where(Holding.id == holding_id, Account.user_id == user_id)
    )
    if holding is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="持仓不存在")
    return holding


def list_holdings(
    db: Session, user_id: uuid.UUID, *, account_id: uuid.UUID | None = None
) -> list[Holding]:
    stmt = (
        _base_stmt()
        .options(joinedload(Holding.account), joinedload(Holding.security))
        .where(Account.user_id == user_id)
    )
    if account_id is not None:
        # 先确认这个 account 属于当前用户，否则传别人的 account_id 会返回空列表，
        # 虽然不泄露数据，但语义上应该直接 404
        get_owned_account(db, user_id, account_id)
        stmt = stmt.where(Holding.account_id == account_id)

    stmt = stmt.order_by(Holding.created_at.desc())
    return list(db.scalars(stmt).unique().all())


def create_holding(db: Session, user_id: uuid.UUID, payload: HoldingCreate) -> Holding:
    get_owned_account(db, user_id, payload.account_id)  # 越权第一道闸
    security = get_security(db, payload.security_id)

    duplicate = db.scalar(
        select(Holding).where(
            Holding.account_id == payload.account_id,
            Holding.security_id == payload.security_id,
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该账户下已存在此标的的持仓，请直接修改股数",
        )

    holding = Holding(
        account_id=payload.account_id,
        security_id=payload.security_id,
        shares=payload.shares,
        cost_price=payload.cost_price,
    )
    db.add(holding)
    db.commit()
    db.refresh(holding)
    # refresh 之后关系属性还是懒加载的，这里显式取一次，序列化时才不会额外查库
    holding.account = get_owned_account(db, user_id, payload.account_id)
    holding.security = security
    return holding


def update_holding(
    db: Session, user_id: uuid.UUID, holding_id: uuid.UUID, payload: HoldingUpdate
) -> Holding:
    holding = get_owned_holding(db, user_id, holding_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(holding, field, value)
    db.commit()
    db.refresh(holding)
    return holding


def delete_holding(db: Session, user_id: uuid.UUID, holding_id: uuid.UUID) -> None:
    holding = get_owned_holding(db, user_id, holding_id)
    db.delete(holding)
    db.commit()
