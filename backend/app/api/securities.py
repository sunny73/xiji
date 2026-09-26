"""证券字典路由。

新增持仓时需要先有 security。小程序端可以：
1. 直接 POST /securities（幂等，同 code+market 返回已存在的），或
2. GET /securities?keyword=中国银行 搜索。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, status

from app.core.deps import CurrentUser, DBSession
from app.schemas.security import SecurityCreate, SecurityRead
from app.services import security_service

router = APIRouter(prefix="/securities", tags=["证券"])


@router.get("", response_model=list[SecurityRead], summary="搜索/列出证券")
def list_securities(
    user: CurrentUser,
    db: DBSession,
    keyword: str | None = Query(default=None, description="代码或名称模糊匹配"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[SecurityRead]:
    items = security_service.list_securities(db, keyword=keyword, limit=limit)
    return [SecurityRead.model_validate(s) for s in items]


@router.post(
    "",
    response_model=SecurityRead,
    status_code=status.HTTP_201_CREATED,
    summary="新增证券（幂等）",
    description="同一 `code + market` 重复提交不会报错，返回已存在的那条。",
)
def create_security(payload: SecurityCreate, user: CurrentUser, db: DBSession) -> SecurityRead:
    return SecurityRead.model_validate(security_service.create_security(db, payload))


@router.get("/{security_id}", response_model=SecurityRead, summary="证券详情")
def get_security(security_id: uuid.UUID, user: CurrentUser, db: DBSession) -> SecurityRead:
    return SecurityRead.model_validate(security_service.get_security(db, security_id))
