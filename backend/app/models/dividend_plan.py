"""分红计划（预计分红）—— 标的级公开信息，不属于某个用户。

Dashboard 的「预计收入」= 用户持仓 shares × 该标的对应计划的 per_share。
用户改持仓，预计收入自动跟着变，不需要改这张表。
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Index, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class DividendPlan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "dividend_plans"

    security_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("securities.id", ondelete="CASCADE"), nullable=False
    )

    # A 股三个关键日期：股权登记日 / 除权除息日 / 派息日
    record_date: Mapped[date | None] = mapped_column(Date)
    ex_date: Mapped[date | None] = mapped_column(Date)
    payment_date: Mapped[date | None] = mapped_column(Date)

    per_share: Mapped[Decimal] = mapped_column(Numeric(20, 6), nullable=False)

    # 数据来源：manual / eastmoney / cninfo ... 便于日后排查脏数据
    source: Mapped[str | None] = mapped_column(String(50))

    security: Mapped[Security] = relationship(back_populates="plans")  # noqa: F821

    __table_args__ = (
        # 同一标的同一派息日只有一条计划。
        # 注意：PostgreSQL 下 payment_date 为 NULL 时不受此约束限制（NULL 互不相等），
        # 这对"只公布了预案、还没定派息日"的场景正好合适。
        UniqueConstraint("security_id", "payment_date", name="uq_dividend_plans_security_payment"),
        Index("ix_dividend_plans_payment_date", "payment_date"),
        Index("ix_dividend_plans_security_id", "security_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<DividendPlan {self.id} {self.payment_date} per_share={self.per_share}>"
