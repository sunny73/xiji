"""FastAPI 应用入口。

本地启动：
    uvicorn app.main:app --reload
文档：
    http://127.0.0.1:8000/docs
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.router import api_router
from app.core.config import settings
from app.core.database import engine
from app.core.deps import DBSession

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动自检：生产环境带着开发开关启动，直接拒绝起服务
    if settings.is_prod:
        settings.assert_production_ready()
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("数据库连接正常")
    except Exception:  # noqa: BLE001 - 起服务阶段要给出明确日志而不是堆栈
        logger.exception("数据库连接失败，请检查 DATABASE_URL 与 PostgreSQL 是否已启动")
        raise
    yield
    engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description=(
        "个人投资分红现金流管理工具。\n\n"
        "**认证方式**：先用 `POST /api/v1/auth/wechat-login`（或本地用 `/auth/dev-login`）"
        "拿到 JWT，再点右上角 Authorize 填进去。\n\n"
        "**数据隔离**：所有业务接口都会校验资源是否属于当前用户，"
        "访问他人数据统一返回 404。"
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

if settings.CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/", tags=["系统"], summary="服务信息")
def root() -> dict:
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "env": settings.ENV,
        "docs": "/docs",
        "api": settings.API_V1_PREFIX,
    }


@app.get("/healthz", tags=["系统"], summary="健康检查")
def healthz(db: DBSession) -> dict:
    # 走依赖注入的 session，测试里可以被 override 到测试库
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
