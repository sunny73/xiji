"""分红路由。"""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Body, Query, status

from app.core.deps import CurrentUser, DBSession
from app.schemas.dividend import DividendCreate, DividendPage, DividendRead, DividendUpdate
from app.services import dividend_service

router = APIRouter(prefix="/dividends", tags=["分红"])


@router.get("", response_model=DividendPage, summary="分红列表（分页）")
def list_dividends(
    user: CurrentUser,
    db: DBSession,
    account_id: uuid.UUID | None = Query(default=None),
    security_id: uuid.UUID | None = Query(
        default=None, description="只看某个标的（持仓详情页用）"
    ),
    year: int | None = Query(default=None, ge=1970, le=2999),
    month: int | None = Query(default=None, ge=1, le=12),
    status_filter: str | None = Query(
        default=None, alias="status", description="pending | received"
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> DividendPage:
    total, items = dividend_service.list_dividends(
        db,
        user.id,
        account_id=account_id,
        security_id=security_id,
        year=year,
        month=month,
        status_filter=status_filter,
        page=page,
        page_size=page_size,
    )
    return DividendPage(
        total=total,
        page=page,
        page_size=page_size,
        items=[dividend_service.to_read(d) for d in items],
    )


@router.post(
    "",
    response_model=DividendRead,
    status_code=status.HTTP_201_CREATED,
    summary="新增分红记录",
    description=(
        "`amount` 由后端按 `shares × per_share` 计算，四舍五入到分。"
        "请求体里传 `amount` 会直接 422（字段不存在且 extra=forbid）。"
    ),
)
def create_dividend(payload: DividendCreate, user: CurrentUser, db: DBSession) -> DividendRead:
    return dividend_service.to_read(dividend_service.create_dividend(db, user.id, payload))


@router.get("/{dividend_id}", response_model=DividendRead, summary="分红详情")
def get_dividend(dividend_id: uuid.UUID, user: CurrentUser, db: DBSession) -> DividendRead:
    return dividend_service.to_read(
        dividend_service.get_owned_dividend(db, user.id, dividend_id)
    )


@router.put("/{dividend_id}", response_model=DividendRead, summary="更新分红记录")
def update_dividend(
    dividend_id: uuid.UUID, payload: DividendUpdate, user: CurrentUser, db: DBSession
) -> DividendRead:
    return dividend_service.to_read(
        dividend_service.update_dividend(db, user.id, dividend_id, payload)
    )


@router.post(
    "/{dividend_id}/receive",
    response_model=DividendRead,
    summary="标记为已到账",
    description="首页「确认到账」用；可同时修正实际到账日期。",
)
def mark_received(
    dividend_id: uuid.UUID,
    user: CurrentUser,
    db: DBSession,
    payment_date: date | None = Body(default=None, embed=True),
) -> DividendRead:
    return dividend_service.to_read(
        dividend_service.mark_received(db, user.id, dividend_id, payment_date)
    )


@router.delete("/{dividend_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除分红记录")
def delete_dividend(dividend_id: uuid.UUID, user: CurrentUser, db: DBSession) -> None:
    dividend_service.delete_dividend(db, user.id, dividend_id)
