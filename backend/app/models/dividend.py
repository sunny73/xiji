"""实际分红记录（用户手工录入 / 将来由同步任务写入）。

与 dividend_plans（预计）**严格分表**：用户可能中途减仓、公司可能调整方案、
到手金额还可能被扣税，所以「预计」和「实际」任何情况下都不能是同一行数据。
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

DIVIDEND_STATUSES = ("pending", "received")


class Dividend(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "dividends"

    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    security_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("securities.id"), nullable=False)

    payment_date: Mapped[date] = mapped_column(Date, nullable=False)

    # 记录「按多少股算的」，而不是只存金额：
    # 这样才能回过头核对，也才能和 dividend_plans 对比出差异
    shares: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=False)
    per_share: Mapped[Decimal] = mapped_column(Numeric(20, 6), nullable=False)
    # 由后端 shares * per_share 计算，绝不采信前端传值
    amount: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    note: Mapped[str | None] = mapped_column(Text)

    account: Mapped[Account] = relationship(back_populates="dividends")  # noqa: F821
    security: Mapped[Security] = relationship(back_populates="dividends")  # noqa: F821

    __table_args__ = (
        CheckConstraint("shares >= 0", name="ck_dividends_shares_non_negative"),
        CheckConstraint("per_share >= 0", name="ck_dividends_per_share_non_negative"),
        CheckConstraint("amount >= 0", name="ck_dividends_amount_non_negative"),
        CheckConstraint(
            "status IN ('pending', 'received')", name="ck_dividends_status_valid"
        ),
        # 首页 / 统计 / 日历全都是"按账户 + 时间范围"查
        Index("ix_dividends_account_payment_date", "account_id", "payment_date"),
        Index("ix_dividends_security_id", "security_id"),
        Index("ix_dividends_payment_date", "payment_date"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Dividend {self.id} {self.payment_date} amount={self.amount}>"
