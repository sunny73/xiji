"""投资账户。一个用户可以有多个账户，所有业务数据都挂在账户下面。"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class Account(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "accounts"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # personal / spouse / long_term / retirement ... 目前只存不判断，留给后续筛选
    type: Mapped[str] = mapped_column(String(30), nullable=False, default="personal")

    user: Mapped[User] = relationship(back_populates="accounts")  # noqa: F821
    holdings: Mapped[list[Holding]] = relationship(  # noqa: F821
        back_populates="account", cascade="all, delete-orphan", passive_deletes=True
    )
    dividends: Mapped[list[Dividend]] = relationship(  # noqa: F821
        back_populates="account", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        # 权限隔离的核心索引：所有查询都带 user_id 过滤
        Index("ix_accounts_user_id", "user_id"),
        Index("ix_accounts_user_id_name", "user_id", "name"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Account {self.id} name={self.name}>"
