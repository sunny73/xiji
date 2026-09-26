"""应用配置。所有环境变量集中在这里，其他模块只 import settings。"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # --- 基础 -------------------------------------------------------------
    PROJECT_NAME: str = "分红管家 API"
    VERSION: str = "0.1.0"
    API_V1_PREFIX: str = "/api/v1"
    ENV: str = "dev"
    DEBUG: bool = True

    # --- 数据库 -----------------------------------------------------------
    DATABASE_URL: str = "postgresql+psycopg://dividend:dividend@localhost:5432/dividend"
    SQL_ECHO: bool = False

    # --- JWT --------------------------------------------------------------
    JWT_SECRET: str = "dev-only-secret-change-me-at-least-32-bytes"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_DAYS: int = 30

    # --- 微信 -------------------------------------------------------------
    WECHAT_APPID: str = ""
    WECHAT_SECRET: str = ""
    WECHAT_MOCK: bool = True
    ALLOW_DEV_LOGIN: bool = True

    # --- CORS -------------------------------------------------------------
    # NoDecode：告诉 pydantic-settings 不要尝试把 .env 里的值当 JSON 解析，
    # 交给下面的 field_validator 处理成逗号分隔的列表
    CORS_ORIGINS: Annotated[list[str], NoDecode] = []

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        """支持 .env 里写成逗号分隔的字符串。"""
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    @property
    def is_prod(self) -> bool:
        return self.ENV.lower() in {"prod", "production"}

    def assert_production_ready(self) -> None:
        """生产环境启动前的自检，防止把开发开关带上线。"""
        problems: list[str] = []
        if self.JWT_SECRET == "dev-only-secret-change-me-at-least-32-bytes":
            problems.append("JWT_SECRET 仍是默认值")
        if self.WECHAT_MOCK:
            problems.append("WECHAT_MOCK=true（不会真正校验微信 code）")
        if self.ALLOW_DEV_LOGIN:
            problems.append("ALLOW_DEV_LOGIN=true（任何人可伪造 openid 登录）")
        if not self.WECHAT_APPID or not self.WECHAT_SECRET:
            problems.append("WECHAT_APPID / WECHAT_SECRET 未配置")
        if problems:
            raise RuntimeError("生产环境配置不合法：\n  - " + "\n  - ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
