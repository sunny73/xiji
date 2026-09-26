"""账户 CRUD 与跨用户隔离。"""

from __future__ import annotations

from tests.conftest import random_uuid


def test_requires_auth(client):
    assert client.get("/api/v1/accounts").status_code == 401
    assert client.post("/api/v1/accounts", json={"name": "x"}).status_code == 401


def test_create_and_list(client, headers):
    created = client.post("/api/v1/accounts", json={"name": "我的账户"}, headers=headers)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "我的账户"
    assert body["type"] == "personal"

    listed = client.get("/api/v1/accounts", headers=headers).json()
    assert [a["id"] for a in listed] == [body["id"]]


def test_get_update_delete(client, headers):
    account_id = client.post(
        "/api/v1/accounts", json={"name": "老婆账户", "type": "spouse"}, headers=headers
    ).json()["id"]

    got = client.get(f"/api/v1/accounts/{account_id}", headers=headers)
    assert got.status_code == 200
    assert got.json()["type"] == "spouse"

    updated = client.put(
        f"/api/v1/accounts/{account_id}", json={"name": "改过的名字"}, headers=headers
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "改过的名字"
    assert updated.json()["type"] == "spouse"  # 没传的字段保持不变

    assert client.delete(f"/api/v1/accounts/{account_id}", headers=headers).status_code == 204
    assert client.get(f"/api/v1/accounts/{account_id}", headers=headers).status_code == 404


def test_name_is_required(client, headers):
    assert client.post("/api/v1/accounts", json={"name": ""}, headers=headers).status_code == 422


def test_cannot_see_other_users_account(client, headers, other_headers, make_account):
    mine = make_account(headers, name="我的账户")
    theirs = make_account(other_headers, name="别人的账户")

    listed = client.get("/api/v1/accounts", headers=other_headers).json()
    assert [a["id"] for a in listed] == [theirs["id"]]

    # 别人的账户 id 一律 404，不暴露"存在但无权"
    assert client.get(f"/api/v1/accounts/{mine['id']}", headers=other_headers).status_code == 404
    assert (
        client.put(f"/api/v1/accounts/{mine['id']}", json={"name": "x"}, headers=other_headers).status_code
        == 404
    )
    assert client.delete(f"/api/v1/accounts/{mine['id']}", headers=other_headers).status_code == 404


def test_unknown_account_is_404(client, headers):
    assert client.get(f"/api/v1/accounts/{random_uuid()}", headers=headers).status_code == 404


def test_deleting_account_cascades_to_holdings_and_dividends(
    client, headers, make_dividend, make_holding
):
    holding = make_holding(headers)
    dividend = make_dividend(headers, account_id=holding["account_id"], security_id=holding["security_id"])
    account_id = dividend["account_id"]

    assert client.delete(f"/api/v1/accounts/{account_id}", headers=headers).status_code == 204

    # 持仓和分红随账户一起消失
    assert client.get(f"/api/v1/holdings/{holding['id']}", headers=headers).status_code == 404
    assert client.get(f"/api/v1/dividends/{dividend['id']}", headers=headers).status_code == 404
