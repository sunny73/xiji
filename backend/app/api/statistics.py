"""统计路由。"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query

from app.core.deps import CurrentUser, DBSession
from app.schemas.dashboard import CalendarDay, MonthlyStat, SecurityStat, YearlyStat
from app.services import statistics_service

router = APIRouter(prefix="/statistics", tags=["统计"])


@router.get("/yearly", response_model=list[YearlyStat], summary="年度统计")
def yearly(
    user: CurrentUser,
    db: DBSession,
    status_filter: str | None = Query(default=None, alias="status", description="pending | received"),
) -> list[YearlyStat]:
    return statistics_service.yearly(db, user.id, status_filter=status_filter)


@router.get("/monthly", response_model=list[MonthlyStat], summary="月度统计（12 个月，缺月补 0）")
def monthly(
    user: CurrentUser,
    db: DBSession,
    year: int | None = Query(default=None, ge=1970, le=2999),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[MonthlyStat]:
    target_year = year or date.today().year
    return statistics_service.monthly(db, user.id, year=target_year, status_filter=status_filter)


@router.get("/securities", response_model=list[SecurityStat], summary="按标的统计")
def by_security(
    user: CurrentUser,
    db: DBSession,
    year: int | None = Query(default=None, ge=1970, le=2999, description="不传则统计全历史"),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[SecurityStat]:
    return statistics_service.by_security(
        db, user.id, year=year, status_filter=status_filter
    )


@router.get("/calendar", response_model=list[CalendarDay], summary="分红日历")
def calendar(
    user: CurrentUser,
    db: DBSession,
    year: int | None = Query(default=None, ge=1970, le=2999),
    month: int | None = Query(default=None, ge=1, le=12, description="不传则返回整年"),
) -> list[CalendarDay]:
    target_year = year or date.today().year
    return statistics_service.calendar(db, user.id, year=target_year, month=month)
