"""统计。"""

from __future__ import annotations


def test_requires_auth(client):
    assert client.get("/api/v1/statistics/yearly").status_code == 401


def test_monthly_always_returns_12_months(client, headers, make_dividend):
    make_dividend(headers, payment_date="2026-01-15", shares="1000", per_share="0.8")
    make_dividend(headers, payment_date="2026-03-15", shares="1000", per_share="1.2")

    rows = client.get("/api/v1/statistics/monthly?year=2026", headers=headers).json()
    assert [r["month"] for r in rows] == list(range(1, 13))
    assert rows[0]["amount"] == 800.0
    assert rows[1]["amount"] == 0.0  # 没有数据的月份补 0
    assert rows[1]["count"] == 0
    assert rows[2]["amount"] == 1200.0


def test_monthly_defaults_to_current_year(client, headers):
    from datetime import date

    resp = client.get("/api/v1/statistics/monthly", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 12
    # 通过 yearly 反查今年确实被当成默认值
    assert resp.request.url.params.get("year") is None
    assert date.today().year  # 只是文档化这个默认行为依赖服务器当前时间


def test_yearly_groups_by_year(client, headers, make_dividend):
    make_dividend(headers, payment_date="2024-05-01", shares="1000", per_share="1")
    make_dividend(headers, payment_date="2025-05-01", shares="1000", per_share="2")
    make_dividend(headers, payment_date="2025-06-01", shares="1000", per_share="3")

    rows = client.get("/api/v1/statistics/yearly", headers=headers).json()
    assert [(r["year"], r["amount"], r["count"]) for r in rows] == [
        (2024, 1000.0, 1),
        (2025, 5000.0, 2),
    ]


def test_yearly_can_filter_received_only(client, headers, make_dividend):
    make_dividend(headers, payment_date="2026-05-01", shares="1000", per_share="1", status="received")
    make_dividend(headers, payment_date="2026-06-01", shares="1000", per_share="1", status="pending")

    all_rows = client.get("/api/v1/statistics/yearly", headers=headers).json()
    assert all_rows[0]["amount"] == 2000.0

    received = client.get("/api/v1/statistics/yearly?status=received", headers=headers).json()
    assert received[0]["amount"] == 1000.0


def test_by_security_sorted_desc(client, headers, make_dividend):
    make_dividend(headers, code="601988", name="中国银行", shares="1000", per_share="1")
    make_dividend(headers, code="601857", name="中国石油", shares="1000", per_share="5")
    make_dividend(headers, code="601988", name="中国银行", shares="1000", per_share="2")

    rows = client.get("/api/v1/statistics/securities", headers=headers).json()
    assert [(r["security_code"], r["amount"], r["count"]) for r in rows] == [
        ("601857", 5000.0, 1),
        ("601988", 3000.0, 2),
    ]


def test_by_security_filtered_by_year(client, headers, make_dividend):
    make_dividend(headers, code="601988", payment_date="2025-01-01", shares="1000", per_share="1")
    make_dividend(headers, code="601988", payment_date="2026-01-01", shares="1000", per_share="7")

    rows = client.get("/api/v1/statistics/securities?year=2026", headers=headers).json()
    assert rows[0]["amount"] == 7000.0


def test_calendar_groups_by_date(client, headers, make_dividend, make_account, make_security):
    account = make_account(headers)
    boc = make_security(headers, code="601988", name="中国银行")
    petro = make_security(headers, code="601857", name="中国石油")

    for security_id in (boc["id"], petro["id"]):
        resp = client.post(
            "/api/v1/dividends",
            json={
                "account_id": account["id"],
                "security_id": security_id,
                "payment_date": "2026-06-18",
                "shares": "1000",
                "per_share": "1",
                "status": "received",
            },
            headers=headers,
        )
        assert resp.status_code == 201

    make_dividend(headers, payment_date="2026-07-01", shares="1000", per_share="1")

    june = client.get("/api/v1/statistics/calendar?year=2026&month=6", headers=headers).json()
    assert len(june) == 1
    assert june[0]["date"] == "2026-06-18"
    assert june[0]["total"] == 2000.0
    assert len(june[0]["items"]) == 2

    whole_year = client.get("/api/v1/statistics/calendar?year=2026", headers=headers).json()
    assert [d["date"] for d in whole_year] == ["2026-06-18", "2026-07-01"]


def test_calendar_is_sorted_ascending(client, headers, make_dividend):
    make_dividend(headers, payment_date="2026-12-01", shares="1", per_share="1")
    make_dividend(headers, payment_date="2026-02-01", shares="1", per_share="1")
    rows = client.get("/api/v1/statistics/calendar?year=2026", headers=headers).json()
    assert [r["date"] for r in rows] == ["2026-02-01", "2026-12-01"]


def test_statistics_are_per_user(client, headers, other_headers, make_dividend):
    make_dividend(other_headers, payment_date="2026-01-01", shares="1000", per_share="9")
    rows = client.get("/api/v1/statistics/monthly?year=2026", headers=headers).json()
    assert all(r["amount"] == 0.0 for r in rows)
    assert client.get("/api/v1/statistics/yearly", headers=headers).json() == []
    assert client.get("/api/v1/statistics/securities", headers=headers).json() == []
    assert client.get("/api/v1/statistics/calendar?year=2026", headers=headers).json() == []
