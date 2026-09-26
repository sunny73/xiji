"""JWT 签发与校验。

第一版没有密码，只有微信登录。JWT 里只放 ``sub``（user id）和过期时间，
不放任何业务信息，避免 token 变成"陈旧数据的缓存"。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.core.config import settings

_ALGORITHM = settings.JWT_ALGORITHM


def create_access_token(user_id: uuid.UUID, expires_days: int | None = None) -> str:
    """签发 access token。"""
    now = datetime.now(UTC)
    expire = now + timedelta(days=expires_days if expires_days is not None else settings.JWT_EXPIRE_DAYS)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "typ": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> uuid.UUID | None:
    """校验 token 并返回 user_id；任何异常都返回 None，由调用方决定怎么报错。"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[_ALGORITHM])
        sub = payload.get("sub")
        if not sub:
            return None
        return uuid.UUID(str(sub))
    except (jwt.PyJWTError, ValueError, TypeError):
        return None
