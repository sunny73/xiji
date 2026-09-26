"""持仓 schema。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import CostPrice, DecimalOut, Shares
from app.schemas.security import SecurityBrief


class HoldingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: uuid.UUID
    security_id: uuid.UUID
    shares: Shares
    cost_price: CostPrice | None = None


class HoldingUpdate(BaseModel):
    """只允许改数量和成本价。

    account_id / security_id 不可改 —— 换标的等于换持仓，应该删了重建，
    否则很容易变成绕过权限校验的入口。
    """

    model_config = ConfigDict(extra="forbid")

    shares: Shares | None = None
    cost_price: CostPrice | None = None


class HoldingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    account_id: uuid.UUID
    security_id: uuid.UUID
    shares: DecimalOut
    cost_price: DecimalOut | None = None
    created_at: datetime
    updated_at: datetime

    account_name: str | None = Field(default=None, description="冗余字段，前端列表直接显示")
    security: SecurityBrief | None = None
    # 持仓市值/成本需要行情，第一版故意不算
    cost_amount: DecimalOut | None = Field(default=None, description="cost_price × shares")
