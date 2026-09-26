"""账户路由。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, DBSession
from app.schemas.account import AccountCreate, AccountRead, AccountUpdate
from app.services import account_service

router = APIRouter(prefix="/accounts", tags=["账户"])


@router.get("", response_model=list[AccountRead], summary="账户列表")
def list_accounts(user: CurrentUser, db: DBSession) -> list[AccountRead]:
    return [AccountRead.model_validate(a) for a in account_service.list_accounts(db, user.id)]


@router.post("", response_model=AccountRead, status_code=status.HTTP_201_CREATED, summary="新建账户")
def create_account(payload: AccountCreate, user: CurrentUser, db: DBSession) -> AccountRead:
    account = account_service.create_account(db, user.id, payload)
    return AccountRead.model_validate(account)


@router.get("/{account_id}", response_model=AccountRead, summary="账户详情")
def get_account(account_id: uuid.UUID, user: CurrentUser, db: DBSession) -> AccountRead:
    return AccountRead.model_validate(account_service.get_account(db, user.id, account_id))


@router.put("/{account_id}", response_model=AccountRead, summary="更新账户")
def update_account(
    account_id: uuid.UUID, payload: AccountUpdate, user: CurrentUser, db: DBSession
) -> AccountRead:
    account = account_service.update_account(db, user.id, account_id, payload)
    return AccountRead.model_validate(account)


@router.delete(
    "/{account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除账户",
    description="⚠️ 会级联删除该账户下的全部持仓与分红记录。",
)
def delete_account(account_id: uuid.UUID, user: CurrentUser, db: DBSession) -> None:
    account_service.delete_account(db, user.id, account_id)
