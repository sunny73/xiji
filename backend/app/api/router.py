"""API v1 路由汇总。main.py 只挂这一棵。"""

from fastapi import APIRouter

from app.api import accounts, auth, dashboard, dividends, holdings, securities, statistics

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(accounts.router)
api_router.include_router(securities.router)
api_router.include_router(holdings.router)
api_router.include_router(dividends.router)
api_router.include_router(dashboard.router)
api_router.include_router(statistics.router)
