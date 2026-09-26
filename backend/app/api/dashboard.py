"""Dashboard 路由。"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query

from app.core.deps import CurrentUser, DBSession
from app.schemas.dashboard import DashboardRead, EstimatedDividend
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["首页"])


@router.get(
    "",
    response_model=DashboardRead,
    summary="首页聚合数据",
    description=(
        "一次请求拿齐首页要的全部内容。\n\n"
        "* `estimated`：本年度预计分红 = Σ(当前持仓股数 × 对应分红计划的每股金额)\n"
        "* `received`：本年度已到账（status=received）\n"
        "* `pending`：本年度**尚未到账**的金额，取以下两者的较大值：\n"
        "  1. 预计缺口 `estimated - received`\n"
        "  2. 已明确记录的待收（status=pending）\n\n"
        "  只算缺口的话，实际到账超过计划时会显示 0，与列表里的待收记录自相矛盾；\n"
        "  只算已记录待收的话，「计划里已公布但还没记账」的部分又会消失。\n"
        "* `next_dividend`：最近一笔未到派息日的预计分红\n"
        "* `current_month`：今天所在月份的已到账金额（年份跟随 year 参数）\n"
        "* `recent_dividends`：最近 5 条分红记录（含待收）"
    ),
)
def get_dashboard(
    user: CurrentUser,
    db: DBSession,
    year: int | None = Query(default=None, ge=1970, le=2999, description="默认今年"),
) -> DashboardRead:
    return dashboard_service.get_dashboard(db, user.id, year=year, today=date.today())


@router.get("/estimated", response_model=list[EstimatedDividend], summary="按标的拆分的预计分红")
def get_estimated(
    user: CurrentUser,
    db: DBSession,
    year: int | None = Query(default=None, ge=1970, le=2999),
) -> list[EstimatedDividend]:
    target_year = year or date.today().year
    return dashboard_service.estimated_by_security(db, user.id, target_year)
