"""到账提醒。

MVP 状态：**未实现**。

实现时的路径（按代价从低到高）：
1. 订阅消息：派息日前 3 天推送「预计 9 月 20 日到账 ¥1,900」，
   需要小程序端 ``wx.requestSubscribeMessage`` + 服务端调
   ``cgi-bin/message/subscribe/send``，并保存用户的订阅授权次数；
2. 站内红点：最省事，首页 ``next_dividend`` 已经有 ``days_left``，前端判断即可。

无论走哪条路，都要注意：微信一次性订阅消息是**每次授权只能发一条**，
所以必须记录每个用户的剩余可发次数，否则会静默失败（errcode 43101）。
"""

from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session


def notify_upcoming_dividends(db: Session, *, as_of: date | None = None, days_ahead: int = 3) -> int:
    """给未来 N 天内有分红到账的用户发提醒，返回成功发送条数。"""
    raise NotImplementedError("MVP 阶段未实现")


def notify_received_reminder(db: Session, *, as_of: date | None = None) -> int:
    """派息日过后，提醒用户确认款项是否已到账。"""
    raise NotImplementedError("MVP 阶段未实现")
