"""证券字典。"""

from __future__ import annotations

from tests.conftest import random_uuid


def test_requires_auth(client):
    assert client.get("/api/v1/securities").status_code == 401


def test_create_is_idempotent(client, headers):
    first = client.post(
        "/api/v1/securities",
        json={"code": "601988", "name": "中国银行", "market": "CN", "type": "STOCK"},
        headers=headers,
    )
    second = client.post(
        "/api/v1/securities",
        json={"code": "601988", "name": "中国银行", "market": "CN", "type": "STOCK"},
        headers=headers,
    )
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


def test_same_code_different_market_is_different_security(client, headers):
    cn = client.post(
        "/api/v1/securities", json={"code": "00700", "name": "腾讯", "market": "CN"}, headers=headers
    ).json()
    hk = client.post(
        "/api/v1/securities", json={"code": "00700", "name": "腾讯控股", "market": "HK"}, headers=headers
    ).json()
    assert cn["id"] != hk["id"]


def test_rename_on_recreate(client, headers):
    client.post("/api/v1/securities", json={"code": "601988", "name": "旧名字"}, headers=headers)
    again = client.post(
        "/api/v1/securities", json={"code": "601988", "name": "中国银行"}, headers=headers
    ).json()
    assert again["name"] == "中国银行"


def test_search_by_code_and_name(client, headers):
    client.post("/api/v1/securities", json={"code": "601988", "name": "中国银行"}, headers=headers)
    client.post("/api/v1/securities", json={"code": "601857", "name": "中国石油"}, headers=headers)
    client.post("/api/v1/securities", json={"code": "510880", "name": "红利ETF"}, headers=headers)

    assert len(client.get("/api/v1/securities", headers=headers).json()) == 3
    assert [s["code"] for s in client.get("/api/v1/securities?keyword=601", headers=headers).json()] == [
        "601857",
        "601988",
    ]
    assert [s["code"] for s in client.get("/api/v1/securities?keyword=石油", headers=headers).json()] == [
        "601857"
    ]


def test_limit_is_capped(client, headers):
    resp = client.get("/api/v1/securities?limit=999", headers=headers)
    assert resp.status_code == 422  # 超过上限直接拒绝，而不是悄悄截断


def test_unknown_security_is_404(client, headers):
    assert client.get(f"/api/v1/securities/{random_uuid()}", headers=headers).status_code == 404


def test_market_is_not_yet_validated(client, headers):
    """market/type 目前是自由字符串（数据库层 VARCHAR）。

    这是刻意的：将来接港股/美股/REIT 时不需要改 migration。
    如果哪天改成 Literal 强校验，这个测试会失败并提醒你同步更新。
    """
    resp = client.post(
        "/api/v1/securities", json={"code": "X", "name": "X", "market": "MARS"}, headers=headers
    )
    assert resp.status_code == 201
