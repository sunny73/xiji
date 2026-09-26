"""认证与用户。"""

from __future__ import annotations

from app.core.config import settings
from app.core.security import create_access_token
from tests.conftest import auth_headers


def test_dev_login_creates_user(client):
    resp = client.post("/api/v1/auth/dev-login", json={"openid": "u1", "nickname": "小明"})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["expires_in"] > 0
    assert body["user"]["nickname"] == "小明"
    assert "openid" not in body["user"]  # openid 是敏感字段，不出现在响应里


def test_dev_login_same_openid_returns_same_user(client):
    first = client.post("/api/v1/auth/dev-login", json={"openid": "same"}).json()
    second = client.post("/api/v1/auth/dev-login", json={"openid": "same"}).json()
    assert first["user"]["id"] == second["user"]["id"]


def test_dev_login_without_openid_creates_distinct_users(client):
    a = client.post("/api/v1/auth/dev-login", json={}).json()
    b = client.post("/api/v1/auth/dev-login", json={}).json()
    assert a["user"]["id"] != b["user"]["id"]


def test_wechat_login_uses_mock_and_is_idempotent(client):
    """WECHAT_MOCK=true 时，同一个 code 稳定映射到同一个用户。"""
    assert settings.WECHAT_MOCK is True
    first = client.post("/api/v1/auth/wechat-login", json={"code": "code-123"})
    second = client.post("/api/v1/auth/wechat-login", json={"code": "code-123"})
    assert first.status_code == 200, first.text
    assert first.json()["user"]["id"] == second.json()["user"]["id"]


def test_me_requires_token(client):
    assert client.get("/api/v1/auth/me").status_code == 401


def test_me_rejects_garbage_token(client):
    resp = client.get("/api/v1/auth/me", headers=auth_headers("not-a-jwt"))
    assert resp.status_code == 401


def test_me_rejects_token_of_deleted_user(client):
    """token 签名合法，但用户已经不存在了，也必须 401。"""
    import uuid

    token = create_access_token(uuid.uuid4())
    assert client.get("/api/v1/auth/me", headers=auth_headers(token)).status_code == 401


def test_me_returns_current_user(client, headers):
    resp = client.get("/api/v1/auth/me", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["id"]


def test_update_me(client, headers):
    resp = client.patch(
        "/api/v1/auth/me",
        json={"nickname": "新名字", "avatar_url": "https://example.com/a.png"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["nickname"] == "新名字"
    assert resp.json()["avatar_url"] == "https://example.com/a.png"


def test_update_me_rejects_openid_change(client, headers):
    """openid 不允许用户自己改，多传字段直接 422。"""
    resp = client.patch("/api/v1/auth/me", json={"openid": "hacked"}, headers=headers)
    assert resp.status_code == 422


def test_dev_login_can_be_closed(client, monkeypatch):
    """生产环境把开关关掉之后，这个接口应该"看起来不存在"。"""
    monkeypatch.setattr(settings, "ALLOW_DEV_LOGIN", False)
    resp = client.post("/api/v1/auth/dev-login", json={"openid": "u1"})
    assert resp.status_code == 404
