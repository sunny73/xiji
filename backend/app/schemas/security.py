"""证券 schema。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.security import MARKETS, SECURITY_TYPES


class SecurityCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=30, description="601988 / 510880 / 00700 / AAPL")
    name: str = Field(min_length=1, max_length=100)
    market: str = Field(default="CN", description=f"取值：{', '.join(MARKETS)}")
    type: str = Field(default="STOCK", description=f"取值：{', '.join(SECURITY_TYPES)}")


class SecurityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    market: str
    type: str
    created_at: datetime


class SecurityBrief(BaseModel):
    """嵌入持仓/分红返回体时用的精简版。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    market: str
    type: str
