"""数据库会话与 Base。

设计说明
--------
* 使用**同步** SQLAlchemy + psycopg3。这套 CRUD 的 QPS 很低，同步实现更简单、
  更好调试，FastAPI 会把同步 endpoint 丢进线程池，不会阻塞事件循环。
* 所有主键在 Python 侧用 uuid4 生成（default=uuid.uuid4），不依赖数据库扩展，
  这样 upsert / 分库 / 数据迁移都更省心。
* 时间戳统一用 ``TIMESTAMP WITH TIME ZONE``，避免跨时区算分红日期时出现
  "差一天" 的经典 bug。
"""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    echo=settings.SQL_ECHO,
    pool_pre_ping=True,  # 连接被数据库单方面掐断后自动重连
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


def get_db() -> Generator[Session, None, None]:
    """FastAPI 依赖：每个请求一个 Session，请求结束必定关闭。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
