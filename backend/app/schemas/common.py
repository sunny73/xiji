"""Schema 公共类型。

金额/数量在数据库里是 NUMERIC（精确十进制）。小数在 JSON 里用 number 更好用，
但**只在序列化输出时**转 float：入库、运算全程仍是 Decimal，不会丢精度。
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from pydantic import Field, PlainSerializer

# 输出：Decimal -> JSON number
DecimalOut = Annotated[Decimal, PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]

# 输入：同时用 max_digits/decimal_places 卡住精度，
# 避免超出 NUMERIC(20, x) 之后才在数据库层炸出 500。
Shares = Annotated[Decimal, Field(gt=0, max_digits=20, decimal_places=4)]
CostPrice = Annotated[Decimal, Field(ge=0, max_digits=20, decimal_places=4)]
PerShare = Annotated[Decimal, Field(ge=0, max_digits=20, decimal_places=6)]
Money = Annotated[Decimal, Field(ge=0, max_digits=20, decimal_places=2)]
