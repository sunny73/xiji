"""持仓 CRUD。"""

from __future__ import annotations

from tests.conftest import random_uuid


def test_requires_auth(client):
    assert client.get("/api/v1/holdings").status_code == 401


def test_create_holding(client, headers, make_account, make_security):
    account = make_account(headers)
    security = make_security(headers)

    resp = client.post(
        "/api/v1/holdings",
        json={
            "account_id": account["id"],
            "security_id": security["id"],
            "shares": "10000",
            "cost_price": "4.12",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["shares"] == 10000.0
    assert body["cost_price"] == 4.12
    # cost_amount = 10000 × 4.12
    assert body["cost_amount"] == 41200.0
    # 嵌套标的和账户名，前端列表页不用再查一次
    assert body["security"]["code"] == "601988"
    assert body["account_name"] == "我的账户"


def test_cost_price_is_optional(client, headers, make_account, make_security):
    account = make_account(headers)
    security = make_security(headers)
    resp = client.post(
        "/api/v1/holdings",
        json={"account_id": account["id"], "security_id": security["id"], "shares": "100"},
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["cost_price"] is None
    assert resp.json()["cost_amount"] is None


def test_duplicate_security_in_same_account_conflicts(client, headers, make_holding):
    holding = make_holding(headers)
    resp = client.post(
        "/api/v1/holdings",
        json={
            "account_id": holding["account_id"],
            "security_id": holding["security_id"],
            "shares": "1",
        },
        headers=headers,
    )
    assert resp.status_code == 409
    assert "已存在" in resp.json()["detail"]


def test_same_security_in_two_accounts_is_allowed(client, headers, make_holding, make_account):
    first = make_holding(headers, code="601988")
    second_account = make_account(headers, name="第二个账户")
    resp = client.post(
        "/api/v1/holdings",
        json={
            "account_id": second_account["id"],
            "security_id": first["security_id"],
            "shares": "500",
        },
        headers=headers,
    )
    assert resp.status_code == 201


def test_shares_must_be_positive(client, headers, make_account, make_security):
    account = make_account(headers)
    security = make_security(headers)
    resp = client.post(
        "/api/v1/holdings",
        json={"account_id": account["id"], "security_id": security["id"], "shares": "0"},
        headers=headers,
    )
    assert resp.status_code == 422


def test_update_shares_and_cost(client, headers, make_holding):
    holding = make_holding(headers)
    resp = client.put(
        f"/api/v1/holdings/{holding['id']}",
        json={"shares": "20000", "cost_price": "3.50"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["shares"] == 20000.0
    assert resp.json()["cost_amount"] == 70000.0


def test_cannot_change_security_of_holding(client, headers, make_holding):
    holding = make_holding(headers)
    resp = client.put(
        f"/api/v1/holdings/{holding['id']}",
        json={"security_id": random_uuid()},
        headers=headers,
    )
    assert resp.status_code == 422


def test_list_filtered_by_account(client, headers, make_holding, make_account):
    first = make_holding(headers, code="601988")
    account2 = make_account(headers, name="第二个账户")
    second = client.post(
        "/api/v1/holdings",
        json={"account_id": account2["id"], "security_id": first["security_id"], "shares": "1"},
        headers=headers,
    ).json()

    all_items = client.get("/api/v1/holdings", headers=headers).json()
    assert len(all_items) == 2

    only_first = client.get(
        f"/api/v1/holdings?account_id={first['account_id']}", headers=headers
    ).json()
    assert [h["id"] for h in only_first] == [first["id"]]
    assert second["id"] not in [h["id"] for h in only_first]


def test_delete_holding(client, headers, make_holding):
    holding = make_holding(headers)
    assert client.delete(f"/api/v1/holdings/{holding['id']}", headers=headers).status_code == 204
    assert client.get(f"/api/v1/holdings/{holding['id']}", headers=headers).status_code == 404


def test_cannot_create_holding_in_other_users_account(
    client, headers, other_headers, make_account, make_security
):
    their_account = make_account(other_headers, name="别人的账户")
    security = make_security(headers)
    resp = client.post(
        "/api/v1/holdings",
        json={"account_id": their_account["id"], "security_id": security["id"], "shares": "1"},
        headers=headers,
    )
    assert resp.status_code == 404


def test_unknown_security_is_404(client, headers, make_account):
    account = make_account(headers)
    resp = client.post(
        "/api/v1/holdings",
        json={"account_id": account["id"], "security_id": random_uuid(), "shares": "1"},
        headers=headers,
    )
    assert resp.status_code == 404
