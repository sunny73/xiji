#!/usr/bin/env python3
"""生成演示数据，用来直观地看小程序的效果。

    cd backend
    .venv/bin/python scripts/seed_demo.py            # 追加/更新演示数据
    .venv/bin/python scripts/seed_demo.py --reset    # 先清掉这个用户的全部数据再生成

演示用户固定用 openid ``dev-local-user`` —— 和 ``miniprogram/utils/config.js``
里的 ``devOpenid`` 一致，所以小程序一启动就是这个用户，不需要额外操作。

数据是**按今天相对生成**的（不写死日期），所以任何时候跑都能看到：
本月已到账、下一笔预计、跨月的柱状图、日历上的标记。
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

# 让 `python scripts/seed_demo.py` 也能 import 到 app 包
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.money import calc_dividend_amount  # noqa: E402
from app.models import Account, Dividend, DividendPlan, Holding, Security, User  # noqa: E402

DEMO_OPENID = "dev-local-user"
DEMO_NICKNAME = "演示用户"

# (code, name, type)
SECURITIES = [
    ("601988", "中国银行", "STOCK"),
    ("601857", "中国石油", "STOCK"),
    ("600036", "招商银行", "STOCK"),
    ("601088", "中国神华", "STOCK"),
    ("510880", "红利ETF", "ETF"),
]

# (账户名, 账户类型, [(code, 股数, 成本价)])
HOLDINGS = [
    (
        "我的账户",
        "personal",
        [("601988", "20000", "3.85"), ("601857", "8000", "6.20"), ("510880", "30000", "2.85")],
    ),
    (
        "老婆账户",
        "spouse",
        [("600036", "1200", "33.50"), ("601088", "2000", "28.40")],
    ),
]

# 分红计划（预计）：(code, 相对今天的天数, 每股)
# 负数 = 过去（贡献"预计"总额），正数 = 未来（喂给"下一笔"卡片）
PLANS = [
    ("601988", -190, "0.18"),
    ("600036", -95, "1.97"),
    ("510880", -58, "0.08"),
    ("601857", 12, "0.16"),
    ("601088", 30, "0.85"),
    ("601988", 45, "0.19"),
]

# 实际分红记录：(账户名, code, 相对今天的天数, 股数, 每股, 状态)
DIVIDENDS = [
    ("我的账户", "601988", -190, "20000", "0.18", "received"),
    ("我的账户", "601857", -320, "8000", "0.15", "received"),
    ("我的账户", "510880", -250, "30000", "0.06", "received"),
    ("老婆账户", "600036", -95, "1200", "1.97", "received"),
    ("我的账户", "510880", -58, "30000", "0.08", "received"),
    ("老婆账户", "601088", -140, "2000", "0.72", "received"),
    ("我的账户", "601988", -18, "20000", "0.19", "received"),
    ("我的账户", "601988", 3, "20000", "0.19", "pending"),
    ("老婆账户", "601088", 9, "2000", "0.85", "pending"),
    ("我的账户", "510880", 21, "30000", "0.09", "pending"),
    ("我的账户", "601857", 34, "8000", "0.16", "pending"),
]


def days_ago(n: int, today: date) -> date:
    return today + timedelta(days=n)


def clear_user_data(db: Session, user: User) -> None:
    """删掉这个用户的全部账户（持仓和分红靠外键级联一起走）。"""
    accounts = db.scalars(select(Account).where(Account.user_id == user.id)).all()
    for account in accounts:
        db.delete(account)
    db.commit()


def get_or_create_security(db: Session, code: str, name: str, type_: str) -> Security:
    security = db.scalar(select(Security).where(Security.code == code, Security.market == "CN"))
    if security is None:
        security = Security(code=code, name=name, market="CN", type=type_)
        db.add(security)
        db.commit()
    return security


def describe_target() -> str:
    """把当前要写入的数据库打印出来。

    这台机器上常见"两个 PostgreSQL"并存：原生那个在 5432，Docker 那个在 55432。
    如果灌错了库，小程序里就是一片空白 —— 所以先明确告诉用户写到哪了。
    """
    url = settings.DATABASE_URL
    # 别把密码打到终端/日志里
    if "@" in url:
        head, tail = url.rsplit("@", 1)
        if ":" in head.split("//")[-1]:
            scheme_user, _ = head.rsplit(":", 1)
            url = scheme_user + ":***@" + tail
    return url


def main() -> int:
    parser = argparse.ArgumentParser(description="生成分红管家演示数据")
    parser.add_argument("--reset", action="store_true", help="先清空该演示用户的数据")
    args = parser.parse_args()

    print(f"写入目标库：{describe_target()}")
    print()

    today = date.today()
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.openid == DEMO_OPENID))
        if user is None:
            user = User(openid=DEMO_OPENID, nickname=DEMO_NICKNAME)
            db.add(user)
            db.commit()
            print(f"创建演示用户 openid={DEMO_OPENID}")
        else:
            user.nickname = DEMO_NICKNAME
            db.commit()
            print(f"复用已有演示用户 openid={DEMO_OPENID}")

        if args.reset:
            clear_user_data(db, user)
            print("已清空该用户原有数据")

        # --- 证券（全局字典，不删）------------------------------------------
        securities = {}
        for code, name, type_ in SECURITIES:
            securities[code] = get_or_create_security(db, code, name, type_)
        print(f"标的 {len(securities)} 个")

        # --- 账户与持仓 -----------------------------------------------------
        accounts = {}
        holding_count = 0
        for account_name, account_type, holdings in HOLDINGS:
            account = db.scalar(
                select(Account).where(Account.user_id == user.id, Account.name == account_name)
            )
            if account is None:
                account = Account(user_id=user.id, name=account_name, type=account_type)
                db.add(account)
                db.commit()
            accounts[account_name] = account

            for code, shares, cost in holdings:
                existing = db.scalar(
                    select(Holding).where(
                        Holding.account_id == account.id,
                        Holding.security_id == securities[code].id,
                    )
                )
                if existing is None:
                    db.add(
                        Holding(
                            account_id=account.id,
                            security_id=securities[code].id,
                            shares=Decimal(shares),
                            cost_price=Decimal(cost),
                        )
                    )
                    holding_count += 1
            db.commit()
        print(f"账户 {len(accounts)} 个，新增持仓 {holding_count} 条")

        # --- 分红计划（预计）------------------------------------------------
        plan_count = 0
        for code, offset, per_share in PLANS:
            payment_date = days_ago(offset, today)
            existing = db.scalar(
                select(DividendPlan).where(
                    DividendPlan.security_id == securities[code].id,
                    DividendPlan.payment_date == payment_date,
                )
            )
            if existing is None:
                db.add(
                    DividendPlan(
                        security_id=securities[code].id,
                        payment_date=payment_date,
                        ex_date=payment_date - timedelta(days=5),
                        record_date=payment_date - timedelta(days=7),
                        per_share=Decimal(per_share),
                        source="manual",
                    )
                )
                plan_count += 1
        db.commit()
        print(f"分红计划（预计）新增 {plan_count} 条")

        # --- 实际分红记录 ---------------------------------------------------
        dividend_count = 0
        for account_name, code, offset, shares, per_share, status in DIVIDENDS:
            account = accounts[account_name]
            payment_date = days_ago(offset, today)
            existing = db.scalar(
                select(Dividend).where(
                    Dividend.account_id == account.id,
                    Dividend.security_id == securities[code].id,
                    Dividend.payment_date == payment_date,
                )
            )
            if existing is not None:
                continue
            db.add(
                Dividend(
                    account_id=account.id,
                    security_id=securities[code].id,
                    payment_date=payment_date,
                    shares=Decimal(shares),
                    per_share=Decimal(per_share),
                    # 和后端一样：金额由 shares × per_share 算出来
                    amount=calc_dividend_amount(shares, per_share),
                    status=status,
                    note="演示数据",
                )
            )
            dividend_count += 1
        db.commit()
        print(f"分红记录新增 {dividend_count} 条")

        # --- 汇总一下，方便肉眼核对 -----------------------------------------
        all_dividends = db.scalars(
            select(Dividend)
            .join(Account, Dividend.account_id == Account.id)
            .where(Account.user_id == user.id)
        ).all()
        received = sum((d.amount for d in all_dividends if d.status == "received"), Decimal(0))
        pending = sum((d.amount for d in all_dividends if d.status == "pending"), Decimal(0))

        print()
        print("=" * 46)
        print(f"  账户数        {len(accounts)}")
        print(f"  分红记录      {len(all_dividends)} 笔")
        print(f"  已到账合计    ¥{received:,.2f}")
        print(f"  待收合计      ¥{pending:,.2f}")
        print("=" * 46)
        print()
        print("现在打开小程序，登录身份就是「演示用户」")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
