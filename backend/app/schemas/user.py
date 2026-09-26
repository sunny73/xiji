"""用户 schema。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nickname: str | None = None
    avatar_url: str | None = None
    created_at: datetime


class UserUpdate(BaseModel):
    """注意：openid 不允许用户自己改。"""

    model_config = ConfigDict(extra="forbid")

    nickname: str | None = Field(default=None, max_length=100)
    avatar_url: str | None = None
