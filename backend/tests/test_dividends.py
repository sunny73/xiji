"""分红 CRUD。重点是「金额只能由后端算」这条规则。"""

from __future__ import annotations

from tests.conftest import random_uuid


def test_requires_auth(client):
    assert client.get("/api/v1/dividends").status_code == 401


def test_amount_is_computed_by_backend(client, headers, make_dividend):
    dividend = make_dividend(headers, shares="10000", per_share="0.19")
    assert dividend["amount"] == 1900.0


def test_amount_rounds_half_up_to_cent(client, headers, make_dividend):
    # 3 × 0.333333 = 0.999999 -> 1.00
    dividend = make_dividend(headers, shares="3", per_share="0.333333")
    assert dividend["amount"] == 1.0


def test_client_cannot_send_amount(client, headers, make_account, make_security):
    """请求体里带 amount 直接 422 —— 不是被忽略，而是明确拒绝。"""
    account = make_account(headers)
    security = make_security(headers)
    resp = client.post(
        "/api/v1/dividends",
        json={
            "account_id": account["id"],
            "security_id": security["id"],
            "payment_date": "2026-09-20",
            "shares": "10000",
            "per_share": "0.19",
            "amount": "999999",
            "status": "received",
        },
        headers=headers,
    )
    assert resp.status_code == 422
    assert "amount" in resp.text


def test_default_status_is_pending(client, headers, make_dividend):
    assert make_dividend(headers)["status"] == "pending"


def test_invalid_status_is_rejected(client, headers, make_account, make_security):
    account = make_account(headers)
    security = make_security(headers)
    resp = client.post(
        "/api/v1/dividends",
        json={
            "account_id": account["id"],
            "security_id": security["id"],
            "payment_date": "2026-09-20",
            "shares": "1",
            "per_share": "1",
            "status": "maybe",
        },
        headers=headers,
    )
    assert resp.status_code == 422


def test_update_recomputes_amount(client, headers, make_dividend):
    dividend = make_dividend(headers, shares="10000", per_share="0.19")
    assert dividend["amount"] == 1900.0

    resp = client.put(
        f"/api/v1/dividends/{dividend['id']}", json={"shares": "5000"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["amount"] == 950.0

    resp = client.put(
        f"/api/v1/dividends/{dividend['id']}", json={"per_share": "0.20"}, headers=headers
    )
    assert resp.json()["amount"] == 1000.0


def test_update_only_note_keeps_amount(client, headers, make_dividend):
    dividend = make_dividend(headers)
    resp = client.put(
        f"/api/v1/dividends/{dividend['id']}", json={"note": "已核对"}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["note"] == "已核对"
    assert resp.json()["amount"] == 1900.0


def test_cannot_change_account_or_security(client, headers, make_dividend):
    dividend = make_dividend(headers)
    for field in ("account_id", "security_id"):
        resp = client.put(
            f"/api/v1/dividends/{dividend['id']}", json={field: random_uuid()}, headers=headers
        )
        assert resp.status_code == 422, field


def test_mark_received(client, headers, make_dividend):
    dividend = make_dividend(headers, status="pending")
    resp = client.post(f"/api/v1/dividends/{dividend['id']}/receive", json={}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "received"

    resp = client.post(
        f"/api/v1/dividends/{dividend['id']}/receive",
        json={"payment_date": "2026-09-22"},
        headers=headers,
    )
    assert resp.json()["payment_date"] == "2026-09-22"


def test_list_pagination_and_filters(client, headers, make_dividend):
    for day in range(1, 6):
        make_dividend(
            headers,
            payment_date=f"2026-09-0{day}",
            status="received" if day % 2 else "pending",
        )
    make_dividend(headers, payment_date="2025-01-15", code="601857", name="中国石油")

    page1 = client.get("/api/v1/dividends?page=1&page_size=2", headers=headers).json()
    assert page1["total"] == 6
    assert page1["page"] == 1
    assert len(page1["items"]) == 2
    # 按派息日倒序
    assert page1["items"][0]["payment_date"] == "2026-09-05"

    page3 = client.get("/api/v1/dividends?page=3&page_size=2", headers=headers).json()
    assert len(page3["items"]) == 2

    by_year = client.get("/api/v1/dividends?year=2026", headers=headers).json()
    assert by_year["total"] == 5

    by_month = client.get("/api/v1/dividends?year=2026&month=9", headers=headers).json()
    assert by_month["total"] == 5

    received = client.get("/api/v1/dividends?status=received", headers=headers).json()
    assert received["total"] == 3
    assert all(item["status"] == "received" for item in received["items"])


def test_list_filtered_by_account(client, headers, make_dividend):
    dividend = make_dividend(headers)
    items = client.get(
        f"/api/v1/dividends?account_id={dividend['account_id']}", headers=headers
    ).json()["items"]
    assert [i["id"] for i in items] == [dividend["id"]]


def test_list_filtered_by_security(client, headers, make_dividend):
    """持仓详情页用这个筛选展示「该标的历史分红」。"""
    boc = make_dividend(headers, code="601988", name="中国银行")
    petro = make_dividend(headers, code="601857", name="中国石油")
    make_dividend(headers, code="601988", name="中国银行", payment_date="2026-10-20")

    items = client.get(
        f"/api/v1/dividends?security_id={boc['security_id']}", headers=headers
    ).json()["items"]
    assert len(items) == 2
    assert all(i["security_id"] == boc["security_id"] for i in items)
    assert petro["id"] not in [i["id"] for i in items]


def test_security_filter_does_not_leak_other_users(client, headers, other_headers, make_dividend):
    """按标的筛选也必须受 user_id 约束，不能因为 security 是公共字典就漏数据。"""
    theirs = make_dividend(other_headers, code="601988", name="中国银行")
    mine = client.get(
        f"/api/v1/dividends?security_id={theirs['security_id']}", headers=headers
    ).json()
    assert mine["total"] == 0
    assert mine["items"] == []


def test_delete_dividend(client, headers, make_dividend):
    dividend = make_dividend(headers)
    assert client.delete(f"/api/v1/dividends/{dividend['id']}", headers=headers).status_code == 204
    assert client.get(f"/api/v1/dividends/{dividend['id']}", headers=headers).status_code == 404


def test_cannot_touch_other_users_dividend(
    client, headers, other_headers, make_dividend
):
    theirs = make_dividend(other_headers)
    assert client.get(f"/api/v1/dividends/{theirs['id']}", headers=headers).status_code == 404
    assert (
        client.put(f"/api/v1/dividends/{theirs['id']}", json={"shares": "1"}, headers=headers).status_code
        == 404
    )
    assert client.delete(f"/api/v1/dividends/{theirs['id']}", headers=headers).status_code == 404
    assert (
        client.post(f"/api/v1/dividends/{theirs['id']}/receive", json={}, headers=headers).status_code
        == 404
    )


def test_cannot_create_dividend_in_other_users_account(
    client, headers, other_headers, make_account, make_security
):
    their_account = make_account(other_headers, name="别人的账户")
    security = make_security(headers)
    resp = client.post(
        "/api/v1/dividends",
        json={
            "account_id": their_account["id"],
            "security_id": security["id"],
            "payment_date": "2026-09-20",
            "shares": "1",
            "per_share": "1",
        },
        headers=headers,
    )
    assert resp.status_code == 404
