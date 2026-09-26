"""ORM 模型。

这里集中导入所有模型，有两个作用：
1. Alembic 的 ``env.py`` 只要 import 本模块就能拿到完整 metadata（autogenerate 才准）；
2. ``Base.metadata.create_all()`` 在测试里能建出全部表。
"""

from app.core.database import Base
from app.models.account import Account
from app.models.dividend import Dividend
from app.models.dividend_plan import DividendPlan
from app.models.holding import Holding
from app.models.security import Security
from app.models.user import User

__all__ = [
    "Account",
    "Base",
    "Dividend",
    "DividendPlan",
    "Holding",
    "Security",
    "User",
]
