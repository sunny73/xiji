"""分红 schema。

关键点：**Create 结构里没有 amount 字段**，且 ``extra="forbid"``。
前端若擅自传 amount，会直接 422，而不是被悄悄忽略——
金额只能由后端根据 shares × per_share 计算。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import DecimalOut, PerShare, Shares
from app.schemas.security import SecurityBrief

DIVIDEND_STATUS_HELP = "pending（待收）| received（已到账）"


class DividendCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: uuid.UUID
    security_id: uuid.UUID
    payment_date: date
    shares: Shares
    per_share: PerShare
    status: str = Field(default="pending", description=DIVIDEND_STATUS_HELP)
    note: str | None = None


class DividendUpdate(BaseModel):
    """account_id / security_id 不可改；改了等于换一笔记录。"""

    model_config = ConfigDict(extra="forbid")

    payment_date: date | None = None
    shares: Shares | None = None
    per_share: PerShare | None = None
    status: str | None = Field(default=None, description=DIVIDEND_STATUS_HELP)
    note: str | None = None


class DividendRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    account_id: uuid.UUID
    security_id: uuid.UUID
    payment_date: date
    shares: DecimalOut
    per_share: DecimalOut
    amount: DecimalOut
    status: str
    note: str | None = None
    created_at: datetime
    updated_at: datetime

    account_name: str | None = None
    security: SecurityBrief | None = None


class DividendPage(BaseModel):
    """分页返回；小程序列表要下拉加载，所以从一开始就分页。"""

    total: int
    page: int
    page_size: int
    items: list[DividendRead]
