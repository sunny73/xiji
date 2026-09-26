"""pytest 公共装置。

原则：
1. **绝不碰开发库**。所有测试跑在 ``<原库名>_test`` 上，启动时自动创建。
2. 每个测试开始前 TRUNCATE 所有业务表，测试之间完全独立，不依赖执行顺序。
3. 应用程序本身不需要任何"测试模式"开关——只是把 ``get_db`` 依赖替换掉。
"""

from __future__ import annotations

import uuid
from collections.abc import Generator

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.core.database import get_db
from app.main import app
from app.models import Base

# --- 测试库准备 -------------------------------------------------------------

_base_url = make_url(settings.DATABASE_URL)
TEST_DB_NAME = f"{_base_url.database}_test"
TEST_DATABASE_URL = _base_url.set(database=TEST_DB_NAME)


def _ensure_test_database() -> None:
    """连到原库执行 CREATE DATABASE（如果还不存在）。"""
    with psycopg.connect(
        host=_base_url.host,
        port=_base_url.port or 5432,
        user=_base_url.username,
        password=_base_url.password,
        dbname=_base_url.database,
        autocommit=True,
    ) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB_NAME,)
        ).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')


@pytest.fixture(scope="session")
def engine() -> Generator[Engine, None, None]:
    _ensure_test_database()
    eng = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


TestingSessionLocal = sessionmaker(autoflush=False, autocommit=False, expire_on_commit=False)


@pytest.fixture(autouse=True)
def _clean_tables(engine: Engine) -> Generator[None, None, None]:
    """每个测试前清空数据，保证互不影响。"""
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE users, accounts, securities, holdings, dividends, dividend_plans "
                "RESTART IDENTITY CASCADE"
            )
        )
    yield


@pytest.fixture
def db(engine: Engine) -> Generator[Session, None, None]:
    session = TestingSessionLocal(bind=engine)
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(engine: Engine) -> Generator[TestClient, None, None]:
    """把应用的 get_db 依赖指向测试库。"""

    def override_get_db() -> Generator[Session, None, None]:
        session = TestingSessionLocal(bind=engine)
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    # 刻意不用 `with TestClient(...)`：那样会触发 lifespan，
    # 而 lifespan 会去 ping 真实的 DATABASE_URL，让单元测试隐式依赖开发库。
    # 因此 /healthz 这类依赖注入的接口在测试里是能覆盖的，lifespan 自检则单独验证。
    test_client = TestClient(app)
    yield test_client
    test_client.close()
    app.dependency_overrides.clear()


# --- 便捷 fixture -----------------------------------------------------------


@pytest.fixture
def api(client: TestClient) -> TestClient:
    return client


def login(client: TestClient, openid: str | None = None) -> str:
    """开发登录，返回 JWT。"""
    resp = client.post("/api/v1/auth/dev-login", json={"openid": openid} if openid else {})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def token(client: TestClient) -> str:
    return login(client, "user_a")


@pytest.fixture
def other_token(client: TestClient) -> str:
    """第二个用户，用来验证数据隔离。"""
    return login(client, "user_b")


@pytest.fixture
def headers(token: str) -> dict[str, str]:
    return auth_headers(token)


@pytest.fixture
def other_headers(other_token: str) -> dict[str, str]:
    return auth_headers(other_token)


# --- 领域对象工厂 -----------------------------------------------------------


@pytest.fixture
def make_account(client: TestClient):
    def _make(headers: dict[str, str], name: str = "我的账户", **kwargs) -> dict:
        resp = client.post("/api/v1/accounts", json={"name": name, **kwargs}, headers=headers)
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _make


@pytest.fixture
def make_security(client: TestClient):
    def _make(
        headers: dict[str, str],
        code: str = "601988",
        name: str = "中国银行",
        market: str = "CN",
        type: str = "STOCK",
    ) -> dict:
        resp = client.post(
            "/api/v1/securities",
            json={"code": code, "name": name, "market": market, "type": type},
            headers=headers,
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _make


@pytest.fixture
def make_holding(client: TestClient, make_account, make_security):
    def _make(
        headers: dict[str, str],
        *,
        account_id: str | None = None,
        security_id: str | None = None,
        shares: str | float = "10000",
        cost_price: str | float | None = "4.12",
        code: str = "601988",
        name: str = "中国银行",
    ) -> dict:
        account = make_account(headers) if account_id is None else {"id": account_id}
        security = make_security(headers, code=code, name=name) if security_id is None else {"id": security_id}
        resp = client.post(
            "/api/v1/holdings",
            json={
                "account_id": account["id"],
                "security_id": security["id"],
                "shares": shares,
                "cost_price": cost_price,
            },
            headers=headers,
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _make


@pytest.fixture
def make_dividend(client: TestClient, make_account, make_security):
    def _make(
        headers: dict[str, str],
        *,
        account_id: str | None = None,
        security_id: str | None = None,
        payment_date: str = "2026-09-20",
        shares: str | float = "10000",
        per_share: str | float = "0.19",
        status: str = "pending",
        code: str = "601988",
        name: str = "中国银行",
        note: str | None = None,
    ) -> dict:
        account = make_account(headers) if account_id is None else {"id": account_id}
        security = make_security(headers, code=code, name=name) if security_id is None else {"id": security_id}
        body = {
            "account_id": account["id"],
            "security_id": security["id"],
            "payment_date": payment_date,
            "shares": shares,
            "per_share": per_share,
            "status": status,
        }
        if note is not None:
            body["note"] = note
        resp = client.post("/api/v1/dividends", json=body, headers=headers)
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _make


def random_uuid() -> str:
    return str(uuid.uuid4())
