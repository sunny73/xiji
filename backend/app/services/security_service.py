"""证券字典。

证券是全局共享的公开信息，不做用户隔离；但**读接口必须登录**，
否则等于开放了一个免费的数据查询口子。
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.security import Security
from app.schemas.security import SecurityCreate


def list_securities(db: Session, *, keyword: str | None = None, limit: int = 50) -> list[Security]:
    stmt = select(Security)
    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(or_(Security.code.ilike(like), Security.name.ilike(like)))
    stmt = stmt.order_by(Security.market.asc(), Security.code.asc()).limit(min(limit, 200))
    return list(db.scalars(stmt).all())


def get_security(db: Session, security_id: uuid.UUID) -> Security:
    security = db.get(Security, security_id)
    if security is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="标的不存在")
    return security


def get_security_by_code(db: Session, code: str, market: str = "CN") -> Security | None:
    return db.scalar(select(Security).where(Security.code == code, Security.market == market))


def create_security(db: Session, payload: SecurityCreate) -> Security:
    """幂等：同 code + market 已存在就返回已有的那条。

    这样小程序端可以无脑"输入代码 → 保存持仓"，不用先查后建。
    """
    existing = get_security_by_code(db, payload.code, payload.market)
    if existing is not None:
        # 名称可能从"中国银行"变成"中国银行(退市)"之类，以最新提交为准
        if payload.name and existing.name != payload.name:
            existing.name = payload.name
            db.commit()
            db.refresh(existing)
        return existing

    security = Security(
        code=payload.code, name=payload.name, market=payload.market, type=payload.type
    )
    db.add(security)
    db.commit()
    db.refresh(security)
    return security
