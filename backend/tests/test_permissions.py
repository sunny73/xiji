"""系统性权限测试。

这一份文件的目的不是"再测一遍 CRUD"，而是：
1. 用路由表自动发现新接口，**新增接口忘记加鉴权会直接测试失败**；
2. 把「用户只能访问自己的数据」这条规则，对所有资源类型做一遍。
"""

from __future__ import annotations

import pytest

from app.main import app

# 明确允许匿名访问的路径，用于文档化；实际的匿名检查在 test_public_paths_are_still_public
PUBLIC_PATHS = ("/", "/healthz", "/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect")


def _discovered_protected_routes() -> list[tuple[str, str]]:
    """从 OpenAPI schema 里挖出所有 /api 下的接口。

    刻意不用 ``app.routes`` 反射：FastAPI 内部结构（_IncludedRouter 等）会随版本变，
    而 OpenAPI schema 是稳定的对外契约，改版也不会让这个测试悄悄失效。
    """
    found: set[tuple[str, str]] = set()
    for path, operations in app.openapi()["paths"].items():
        if not path.startswith("/api/"):
            continue
        # 登录接口本身不需要 token
        if path.startswith("/api/v1/auth/"):
            continue
        for method in operations:
            found.add((method.upper(), path))
    return sorted(found)


DISCOVERED = _discovered_protected_routes()


def test_there_are_routes_to_check():
    """防止路由发现逻辑本身写挂了导致"零个测试"假绿。"""
    assert len(DISCOVERED) >= 15


@pytest.mark.parametrize(("method", "path"), DISCOVERED, ids=[f"{m} {p}" for m, p in DISCOVERED])
def test_every_api_route_requires_authentication(client, method: str, path: str):
    """不带 token 调用任何业务接口，都必须是 401。"""
    concrete = path.replace("{account_id}", "00000000-0000-0000-0000-000000000001")
    concrete = concrete.replace("{holding_id}", "00000000-0000-0000-0000-000000000002")
    concrete = concrete.replace("{dividend_id}", "00000000-0000-0000-0000-000000000003")
    concrete = concrete.replace("{security_id}", "00000000-0000-0000-0000-000000000004")

    resp = client.request(method, concrete, json={})
    assert resp.status_code == 401, f"{method} {path} 未鉴权就能访问：{resp.status_code} {resp.text}"


def test_public_paths_are_still_public(client):
    assert client.get("/").status_code == 200
    assert client.get("/openapi.json").status_code == 200
    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}


@pytest.mark.parametrize(
    ("method", "template", "fixture_name"),
    [
        ("GET", "/api/v1/accounts/{id}", "account"),
        ("PUT", "/api/v1/accounts/{id}", "account"),
        ("DELETE", "/api/v1/accounts/{id}", "account"),
        ("GET", "/api/v1/holdings/{id}", "holding"),
        ("PUT", "/api/v1/holdings/{id}", "holding"),
        ("DELETE", "/api/v1/holdings/{id}", "holding"),
        ("GET", "/api/v1/dividends/{id}", "dividend"),
        ("PUT", "/api/v1/dividends/{id}", "dividend"),
        ("DELETE", "/api/v1/dividends/{id}", "dividend"),
        ("POST", "/api/v1/dividends/{id}/receive", "dividend"),
    ],
)
def test_other_user_gets_404_on_every_resource(
    client, headers, fixture_name, method, template, request
):
    """用户 A 建的资源，用户 B 无论用什么方法访问都必须 404。"""
    resource = request.getfixturevalue(f"other_{fixture_name}")
    resp = client.request(method, template.format(id=resource["id"]), json={}, headers=headers)
    assert resp.status_code == 404, f"{method} {template} → {resp.status_code}"


@pytest.fixture
def other_account(other_headers, make_account):
    return make_account(other_headers, name="B 的账户")


@pytest.fixture
def other_holding(other_headers, make_holding):
    return make_holding(other_headers)


@pytest.fixture
def other_dividend(other_headers, make_dividend):
    return make_dividend(other_headers)
