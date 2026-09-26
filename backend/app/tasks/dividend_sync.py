"""分红同步（分红计划 → 实际分红）。

MVP 状态：**未实现**。

第一版所有分红都由用户手工录入，没有行情源，因此这里只留签名。

开始实现时要做的事：
1. 接一个数据源（巨潮/东财/交易所公告）拉取分红方案；
2. upsert 到 ``dividend_plans``（唯一键 ``security_id + payment_date``）；
3. 派息日之后，把「用户持仓 × 计划」生成一条 ``dividends(status='pending')``
   提醒用户确认，**不要自动写成 received** —— 真实到账金额可能被扣税。
"""

from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session


def sync_dividend_plans(db: Session, *, since: date | None = None) -> int:
    """拉取并写入分红计划，返回新增/更新的条数。"""
    raise NotImplementedError("MVP 阶段未实现：分红计划目前由人工维护")


def generate_pending_dividends(db: Session, *, as_of: date | None = None) -> int:
    """根据到期的分红计划和当前持仓，生成待确认的实际分红记录。"""
    raise NotImplementedError("MVP 阶段未实现：分红目前由用户手工录入")
