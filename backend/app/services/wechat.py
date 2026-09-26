"""微信登录：code → openid。

只有这一个函数会跟微信服务器通信，其余业务代码不关心 openid 是怎么来的，
测试里替换掉它就等于替换掉整个微信。
"""

from __future__ import annotations

import hashlib
import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

CODE2SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session"


class WeChatAuthError(Exception):
    """code2session 失败（code 无效 / 过期 / 微信侧错误）。"""


def _mock_openid(code: str) -> str:
    """开发模式：由 code 稳定推导出 openid。

    同一个 code 永远得到同一个 openid，方便反复 curl 调试同一个用户。
    """
    digest = hashlib.sha256(code.encode("utf-8")).hexdigest()
    return f"mock_{digest[:28]}"


def code_to_openid(code: str) -> str:
    """用 wx.login() 的 code 换 openid。"""
    if settings.WECHAT_MOCK:
        logger.warning("WECHAT_MOCK=true，未真正校验微信 code（仅限开发环境）")
        return _mock_openid(code)

    if not settings.WECHAT_APPID or not settings.WECHAT_SECRET:
        raise WeChatAuthError("服务端未配置 WECHAT_APPID / WECHAT_SECRET")

    params = {
        "appid": settings.WECHAT_APPID,
        "secret": settings.WECHAT_SECRET,
        "js_code": code,
        "grant_type": "authorization_code",
    }
    try:
        resp = httpx.get(CODE2SESSION_URL, params=params, timeout=5.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:  # 网络层问题
        logger.exception("调用微信 code2session 失败")
        raise WeChatAuthError("微信服务暂时不可用，请稍后重试") from exc

    # 微信的错误也用 HTTP 200 返回，必须看 body 里的 errcode
    if data.get("errcode"):
        logger.warning("code2session 返回错误: %s", data)
        raise WeChatAuthError(f"微信登录失败：{data.get('errmsg', 'unknown')}")

    openid = data.get("openid")
    if not openid:
        raise WeChatAuthError("微信未返回 openid")
    return openid
