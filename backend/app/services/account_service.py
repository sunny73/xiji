"""账户 CRUD。"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.account import Account
from app.schemas.account import AccountCreate, AccountUpdate
from app.services.user_service import get_owned_account


def list_accounts(db: Session, user_id: uuid.UUID) -> list[Account]:
    return list(
        db.scalars(
            select(Account).where(Account.user_id == user_id).order_by(Account.created_at.asc())
        ).all()
    )


def get_account(db: Session, user_id: uuid.UUID, account_id: uuid.UUID) -> Account:
    return get_owned_account(db, user_id, account_id)


def create_account(db: Session, user_id: uuid.UUID, payload: AccountCreate) -> Account:
    account = Account(user_id=user_id, name=payload.name, type=payload.type)
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def update_account(
    db: Session, user_id: uuid.UUID, account_id: uuid.UUID, payload: AccountUpdate
) -> Account:
    account = get_owned_account(db, user_id, account_id)
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return account


def delete_account(db: Session, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
    """删除账户会级联删掉它下面的持仓和分红记录（DB 层 ON DELETE CASCADE）。"""
    account = get_owned_account(db, user_id, account_id)
    db.delete(account)
    db.commit()
