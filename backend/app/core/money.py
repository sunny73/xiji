"""金额计算。所有涉及钱的地方都必须走这里，避免各处自己 round 出不一致的结果。"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def to_decimal(value: object) -> Decimal:
    """把 float / str / int 统一转成 Decimal。

    直接用 Decimal(0.19) 会带出二进制浮点误差（0.19000000000000000222...），
    所以 float 必须先经过 str 中转。
    """
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    return Decimal(value)  # type: ignore[arg-type]


def calc_dividend_amount(shares: object, per_share: object) -> Decimal:
    """分红金额 = 股数 × 每股分红，四舍五入到分。

    这是**唯一**的金额来源；前端传来的 amount 一律忽略。
    """
    raw = to_decimal(shares) * to_decimal(per_share)
    return raw.quantize(CENT, rounding=ROUND_HALF_UP)


def money(value: object) -> Decimal:
    """把任意数值规整为两位小数的金额。"""
    return to_decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)
