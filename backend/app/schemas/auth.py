"""认证相关 schema。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserRead


class WechatLoginRequest(BaseModel):
    """小程序 wx.login() 拿到的临时 code。"""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=128, description="wx.login() 返回的 code")


class DevLoginRequest(BaseModel):
    """仅开发环境可用：直接指定 openid，跳过 code2session。"""

    model_config = ConfigDict(extra="forbid")

    openid: str | None = Field(default=None, max_length=64, description="留空则随机生成，方便造新用户")
    nickname: str | None = Field(default=None, max_length=100)
    avatar_url: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="有效期（秒）")
    user: UserRead
