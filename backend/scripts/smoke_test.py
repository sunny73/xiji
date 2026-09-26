"""端到端冒烟脚本：打真实 HTTP 服务 + 真实 PostgreSQL。

跑法（服务已启动）：
    .venv/bin/python scripts/smoke_test.py
    .venv/bin/python scripts/smoke_test.py --base-url http://127.0.0.1:8000

它做的事跟小程序上线后要走的路完全一样：
登录取 token → 建账户 → 建标的 → 建持仓 → 记分红 → 看首页 → 看统计，
最后校验「金额由后端算」和「用户之间互相看不到数据」两条硬规则。

这不是 pytest 的替代品（pytest 覆盖的是边界和异常路径），
而是「服务真的能起来、真的连得上库」的守门人。
"""

from __future__ import annotations

import argparse
import sys
import uuid
from datetime import date, timedelta

import httpx

PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"


class Smoke:
    def __init__(self, base_url: str) -> None:
        self.base = base_url.rstrip("/")
        # trust_env=False 很关键：本机若开了系统级 HTTP 代理（Clash/Surge 之类），
        # httpx 默认会读系统代理，把 127.0.0.1 的请求也发给代理，结果拿到 502。
        # 既然 base_url 是显式指定的，就不该让代理插手。
        self.client = httpx.Client(base_url=self.base, timeout=10.0, trust_env=False)
        self.failures: list[str] = []

    def check(self, label: str, condition: bool, detail: str = "") -> None:
        if condition:
            print(f"  {PASS} {label}")
        else:
            print(f"  {FAIL} {label} {detail}")
            self.failures.append(label)

    def run(self) -> int:
        print(f"\n对 {self.base} 做冒烟测试\n")

        # --- 系统 --------------------------------------------------------
        r = self.client.get("/healthz")
        self.check("GET /healthz 返回 ok", r.status_code == 200 and r.json() == {"status": "ok"}, r.text)
        r = self.client.get("/docs")
        self.check("GET /docs Swagger 可访问", r.status_code == 200)
        r = self.client.get("/openapi.json")
        path_count = len(r.json().get("paths", {})) if r.status_code == 200 else 0
        self.check(f"OpenAPI 导出 {path_count} 个路径", path_count >= 15)

        # --- 登录 --------------------------------------------------------
        suffix = uuid.uuid4().hex[:8]
        r = self.client.post("/api/v1/auth/dev-login", json={"openid": f"smoke_a_{suffix}", "nickname": "冒烟用户A"})
        self.check("A 用户登录拿到 token", r.status_code == 200 and "access_token" in r.json(), r.text)
        if r.status_code != 200:
            return self.report()
        token_a = r.json()["access_token"]
        ha = {"Authorization": f"Bearer {token_a}"}

        r = self.client.post("/api/v1/auth/dev-login", json={"openid": f"smoke_b_{suffix}"})
        token_b = r.json()["access_token"]
        hb = {"Authorization": f"Bearer {token_b}"}

        self.check("无 token 访问业务接口返回 401", self.client.get("/api/v1/accounts").status_code == 401)

        # --- 账户 / 标的 / 持仓 -------------------------------------------
        r = self.client.post("/api/v1/accounts", json={"name": "我的账户"}, headers=ha)
        self.check("创建账户", r.status_code == 201, r.text)
        account_id = r.json()["id"]

        r = self.client.post(
            "/api/v1/securities",
            json={"code": "601988", "name": "中国银行", "market": "CN", "type": "STOCK"},
            headers=ha,
        )
        self.check("创建标的（幂等）", r.status_code == 201, r.text)
        security_id = r.json()["id"]

        r = self.client.post(
            "/api/v1/holdings",
            json={"account_id": account_id, "security_id": security_id, "shares": "10000", "cost_price": "4.12"},
            headers=ha,
        )
        self.check("创建持仓 10000 股", r.status_code == 201, r.text)
        self.check("持仓 cost_amount = 41200", r.json().get("cost_amount") == 41200.0, str(r.json()))

        # --- 分红：金额必须由后端算 ---------------------------------------
        r = self.client.post(
            "/api/v1/dividends",
            json={
                "account_id": account_id,
                "security_id": security_id,
                "payment_date": str(date.today() - timedelta(days=30)),
                "shares": "10000",
                "per_share": "0.19",
                "status": "received",
            },
            headers=ha,
        )
        self.check("创建分红记录", r.status_code == 201, r.text)
        dividend = r.json()
        self.check("后端算出 amount = 1900.00", dividend.get("amount") == 1900.0, str(dividend))
        self.check("分红记录了 shares 和 per_share（可回溯）", dividend.get("shares") == 10000.0 and dividend.get("per_share") == 0.19)

        r = self.client.post(
            "/api/v1/dividends",
            json={
                "account_id": account_id,
                "security_id": security_id,
                "payment_date": str(date.today()),
                "shares": "10000",
                "per_share": "0.19",
                "amount": "99999999",
            },
            headers=ha,
        )
        self.check("前端传 amount 被拒绝（422）", r.status_code == 422, f"实际 {r.status_code}")

        # --- Dashboard ---------------------------------------------------
        r = self.client.get("/api/v1/dashboard", headers=ha)
        self.check("GET /dashboard", r.status_code == 200, r.text)
        dash = r.json()
        self.check("summary.received = 1900", dash["summary"]["received"] == 1900.0, str(dash["summary"]))
        self.check("summary 含 estimated/received/pending", set(dash["summary"]) == {"estimated", "received", "pending"})
        self.check("recent_dividends 有数据", len(dash["recent_dividends"]) >= 1)
        self.check("year 字段存在", "year" in dash)

        # --- 统计 --------------------------------------------------------
        r = self.client.get(f"/api/v1/statistics/monthly?year={date.today().year}", headers=ha)
        self.check("GET /statistics/monthly 返回 12 个月", r.status_code == 200 and len(r.json()) == 12, r.text)

        r = self.client.get("/api/v1/statistics/yearly", headers=ha)
        self.check("GET /statistics/yearly", r.status_code == 200 and len(r.json()) >= 1, r.text)

        r = self.client.get("/api/v1/statistics/securities", headers=ha)
        self.check("GET /statistics/securities", r.status_code == 200 and len(r.json()) == 1, r.text)

        r = self.client.get(f"/api/v1/statistics/calendar?year={date.today().year}", headers=ha)
        self.check("GET /statistics/calendar", r.status_code == 200 and len(r.json()) >= 1, r.text)

        # --- 数据隔离 -----------------------------------------------------
        r = self.client.get(f"/api/v1/dividends/{dividend['id']}", headers=hb)
        self.check("B 用户读 A 的分红 → 404", r.status_code == 404, f"实际 {r.status_code}")
        r = self.client.get(f"/api/v1/accounts/{account_id}", headers=hb)
        self.check("B 用户读 A 的账户 → 404", r.status_code == 404, f"实际 {r.status_code}")
        r = self.client.get("/api/v1/dashboard", headers=hb)
        self.check("B 用户的首页是空的", r.json()["summary"]["received"] == 0.0, str(r.json()["summary"]))
        r = self.client.get("/api/v1/accounts", headers=hb)
        self.check("B 用户看不到 A 的账户列表", r.json() == [], r.text)

        # --- 清理 --------------------------------------------------------
        r = self.client.delete(f"/api/v1/accounts/{account_id}", headers=ha)
        self.check("删除账户触发级联", r.status_code == 204, r.text)
        r = self.client.get(f"/api/v1/dividends/{dividend['id']}", headers=ha)
        self.check("账户删除后分红记录一并消失", r.status_code == 404)

        return self.report()

    def report(self) -> int:
        print()
        if self.failures:
            print(f"\033[31m{len(self.failures)} 项失败：\033[0m " + "; ".join(self.failures))
            return 1
        print("\033[32m全部通过\033[0m")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="分红管家后端冒烟测试")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    try:
        return Smoke(args.base_url).run()
    except httpx.ConnectError:
        print(f"\033[31m连不上 {args.base_url}，请先启动服务：uvicorn app.main:app\033[0m")
        return 2


if __name__ == "__main__":
    sys.exit(main())
