"""登录 / 用户。

所有按 user_id 取数据的入口都必须经过 ``get_owned_account``，
这是整个产品的权限边界，任何地方都不要绕过它直接查 holdings / dividends。
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.user import User


def get_user(db: Session, user_id: uuid.UUID) -> User | None:
    return db.get(User, user_id)


def get_or_create_user_by_openid(db: Session, openid: str) -> User:
    """openid 存在就登录，不存在就注册。"""
    user = db.scalar(select(User).where(User.openid == openid))
    if user is not None:
        return user

    user = User(openid=openid)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user: User, *, nickname: str | None, avatar_url: str | None) -> User:
    if nickname is not None:
        user.nickname = nickname
    if avatar_url is not None:
        user.avatar_url = avatar_url
    db.commit()
    db.refresh(user)
    return user


# --- 权限边界 --------------------------------------------------------------


def get_owned_account(db: Session, user_id: uuid.UUID, account_id: uuid.UUID) -> Account:
    """取「属于当前用户的」账户，取不到一律 404。

    这里刻意用 404 而不是 403：403 会告诉攻击者"这个 id 存在，只是不属于你"，
    等于把别人的 account_id 变成了可探测的信息。
    """
    account = db.scalar(
        select(Account).where(Account.id == account_id, Account.user_id == user_id)
    )
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="账户不存在")
    return account


def owned_account_ids(db: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    """当前用户的全部 account_id，用于给其他查询做 IN 过滤。"""
    return list(db.scalars(select(Account.id).where(Account.user_id == user_id)).all())
