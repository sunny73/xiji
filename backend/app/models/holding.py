"""持仓。"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Index, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class Holding(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "holdings"

    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    security_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("securities.id"), nullable=False)

    shares: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=False)
    cost_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))

    account: Mapped[Account] = relationship(back_populates="holdings")  # noqa: F821
    security: Mapped[Security] = relationship(back_populates="holdings")  # noqa: F821

    __table_args__ = (
        # 同一账户下同一标的一行，避免重复持有导致的重复统计。
        # 将来若要支持"分批建仓/多笔成本"，把这条约束换成 lot 表即可。
        UniqueConstraint("account_id", "security_id", name="uq_holdings_account_security"),
        Index("ix_holdings_account_id", "account_id"),
        Index("ix_holdings_security_id", "security_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Holding {self.id} shares={self.shares}>"
