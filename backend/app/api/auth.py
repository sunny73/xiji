"""认证路由：微信登录 → 换我们自己的 JWT。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.core.deps import CurrentUser, DBSession
from app.core.security import create_access_token
from app.schemas.auth import DevLoginRequest, TokenResponse, WechatLoginRequest
from app.schemas.user import UserRead, UserUpdate
from app.services import user_service
from app.services.wechat import WeChatAuthError, code_to_openid

router = APIRouter(prefix="/auth", tags=["认证"])


def _issue_token(user) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id),
        expires_in=settings.JWT_EXPIRE_DAYS * 24 * 3600,
        user=UserRead.model_validate(user),
    )


@router.post(
    "/wechat-login",
    response_model=TokenResponse,
    summary="微信小程序登录",
    description=(
        "小程序端调用 `wx.login()` 拿到 code，POST 到这里。"
        "服务端用 code 调微信 `auth.code2Session` 换 openid，"
        "openid 首次出现则自动注册，最后返回本服务的 JWT。"
    ),
)
def wechat_login(payload: WechatLoginRequest, db: DBSession) -> TokenResponse:
    try:
        openid = code_to_openid(payload.code)
    except WeChatAuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    user = user_service.get_or_create_user_by_openid(db, openid)
    return _issue_token(user)


@router.post(
    "/dev-login",
    response_model=TokenResponse,
    summary="【仅开发】免微信登录",
    description=(
        "本地调试用。需要 `ALLOW_DEV_LOGIN=true`，生产环境为 false 时该接口返回 404。"
        "不传 openid 会随机生成，方便造多个互相隔离的用户来验证权限。"
    ),
)
def dev_login(payload: DevLoginRequest, db: DBSession) -> TokenResponse:
    if not settings.ALLOW_DEV_LOGIN:
        # 故意返回 404 而不是 403：生产环境里这个接口应该"看起来不存在"
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    openid = payload.openid or f"dev_{uuid.uuid4().hex[:24]}"
    user = user_service.get_or_create_user_by_openid(db, openid)
    if payload.nickname is not None or payload.avatar_url is not None:
        user = user_service.update_user(
            db, user, nickname=payload.nickname, avatar_url=payload.avatar_url
        )
    return _issue_token(user)


@router.get("/me", response_model=UserRead, summary="当前用户")
def read_me(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)


@router.patch("/me", response_model=UserRead, summary="更新昵称/头像")
def update_me(payload: UserUpdate, user: CurrentUser, db: DBSession) -> UserRead:
    data = payload.model_dump(exclude_unset=True)
    updated = user_service.update_user(
        db, user, nickname=data.get("nickname"), avatar_url=data.get("avatar_url")
    )
    return UserRead.model_validate(updated)
