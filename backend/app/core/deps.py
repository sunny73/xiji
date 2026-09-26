"""共享依赖：当前登录用户。"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False, description="Authorization: Bearer <JWT>")

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="未登录或登录已过期",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """解析 JWT → user_id → 数据库里的 User。

    token 里只有 user id，**不放任何业务数据**，所以用户改不了自己的身份，
    也不存在"token 里的持仓是旧的"这种问题。
    """
    if credentials is None or not credentials.credentials:
        raise _UNAUTHORIZED

    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise _UNAUTHORIZED

    user = db.get(User, user_id)
    if user is None:
        # token 合法但用户已被删除
        raise _UNAUTHORIZED
    return user


# 用 Annotated 写依赖，路由签名更干净：user: CurrentUser / db: DBSession
CurrentUser = Annotated[User, Depends(get_current_user)]
DBSession = Annotated[Session, Depends(get_db)]
