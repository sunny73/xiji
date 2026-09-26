"""持仓路由。

所有接口都会经过 `JOIN accounts WHERE accounts.user_id = 当前用户`，
所以传别人的 holding_id / account_id 只会得到 404。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, status

from app.core.deps import CurrentUser, DBSession
from app.schemas.holding import HoldingCreate, HoldingRead, HoldingUpdate
from app.services import holding_service

router = APIRouter(prefix="/holdings", tags=["持仓"])


@router.get("", response_model=list[HoldingRead], summary="持仓列表")
def list_holdings(
    user: CurrentUser,
    db: DBSession,
    account_id: uuid.UUID | None = Query(default=None, description="只看某个账户"),
) -> list[HoldingRead]:
    items = holding_service.list_holdings(db, user.id, account_id=account_id)
    return [holding_service.to_read(h) for h in items]


@router.post("", response_model=HoldingRead, status_code=status.HTTP_201_CREATED, summary="新增持仓")
def create_holding(payload: HoldingCreate, user: CurrentUser, db: DBSession) -> HoldingRead:
    return holding_service.to_read(holding_service.create_holding(db, user.id, payload))


@router.get("/{holding_id}", response_model=HoldingRead, summary="持仓详情")
def get_holding(holding_id: uuid.UUID, user: CurrentUser, db: DBSession) -> HoldingRead:
    return holding_service.to_read(holding_service.get_owned_holding(db, user.id, holding_id))


@router.put(
    "/{holding_id}",
    response_model=HoldingRead,
    summary="更新持仓",
    description="只能改 `shares` / `cost_price`；换标的请删除后重建。",
)
def update_holding(
    holding_id: uuid.UUID, payload: HoldingUpdate, user: CurrentUser, db: DBSession
) -> HoldingRead:
    return holding_service.to_read(
        holding_service.update_holding(db, user.id, holding_id, payload)
    )


@router.delete("/{holding_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除持仓")
def delete_holding(holding_id: uuid.UUID, user: CurrentUser, db: DBSession) -> None:
    holding_service.delete_holding(db, user.id, holding_id)
