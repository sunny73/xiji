"""Dashboard / 统计 schema。字段名即小程序端直接渲染的结构。"""

from __future__ import annotations

import uuid
from datetime import date

from pydantic import BaseModel

from app.schemas.common import DecimalOut


class DashboardSummary(BaseModel):
    estimated: DecimalOut
    received: DecimalOut
    pending: DecimalOut


class NextDividend(BaseModel):
    security_id: uuid.UUID
    security_code: str
    security_name: str
    payment_date: date
    amount: DecimalOut
    days_left: int


class EstimatedDividend(BaseModel):
    """「预期收益」列表页的一行。"""

    security_id: uuid.UUID
    security_code: str
    security_name: str
    payment_date: date
    amount: DecimalOut


class CurrentMonth(BaseModel):
    month: int
    amount: DecimalOut


class RecentDividend(BaseModel):
    """首页「最近记录」和日历共用的一行。

    必须带上 shares / per_share：小程序那边会把它们渲染成
    "10000 股 × 0.19" —— 少了这两个字段就会显示成"0 股 × 0"。
    """

    id: uuid.UUID
    security_name: str
    security_code: str
    payment_date: date
    shares: DecimalOut
    per_share: DecimalOut
    amount: DecimalOut
    status: str


class DashboardRead(BaseModel):
    year: int
    summary: DashboardSummary
    next_dividend: NextDividend | None = None
    current_month: CurrentMonth
    recent_dividends: list[RecentDividend]


# --- 统计 ------------------------------------------------------------------


class YearlyStat(BaseModel):
    year: int
    amount: DecimalOut
    count: int


class MonthlyStat(BaseModel):
    month: int
    amount: DecimalOut
    count: int


class SecurityStat(BaseModel):
    security_id: uuid.UUID
    security_code: str
    security_name: str
    amount: DecimalOut
    count: int


class CalendarDay(BaseModel):
    """分红日历：某一天有哪些标的到账。"""

    date: date
    total: DecimalOut
    items: list[RecentDividend]
