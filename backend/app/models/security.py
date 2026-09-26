"""证券（股票 / ETF / 基金 / 债券）。

证券是**全局字典**，不属于任何用户；用户只是通过 holding / dividend 引用它。
market 用 ISO 风格短码，为将来接港股美股留好位置。
"""

from __future__ import annotations

from sqlalchemy import Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

# 第一版只开放 CN，其余先定义好枚举值以便数据库层不用改
MARKETS = ("CN", "HK", "US")
SECURITY_TYPES = ("STOCK", "ETF", "FUND", "BOND", "REIT")


class Security(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "securities"

    code: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    market: Mapped[str] = mapped_column(String(20), nullable=False, default="CN")
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="STOCK")

    holdings: Mapped[list[Holding]] = relationship(back_populates="security")  # noqa: F821
    dividends: Mapped[list[Dividend]] = relationship(back_populates="security")  # noqa: F821
    plans: Mapped[list[DividendPlan]] = relationship(  # noqa: F821
        back_populates="security", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        UniqueConstraint("code", "market", name="uq_securities_code_market"),
        Index("ix_securities_name", "name"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Security {self.market}:{self.code} {self.name}>"
