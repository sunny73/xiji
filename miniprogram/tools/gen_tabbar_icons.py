#!/usr/bin/env python3
"""生成 tabBar 图标（81x81 PNG，微信推荐尺寸）。

为什么自己画而不是找现成图标：
  图标库要么要装 npm 包（本机没有可用的前端工具链），要么有授权问题。
  这几个图标都是简单几何形状，用超采样画出来足够干净，而且**可复现**。

原理：每个图标定义一个 `inside(x, y) -> bool` 的图形函数，
每个像素做 4x4 超采样求覆盖率当作 alpha，天然得到抗锯齿边缘。
不依赖任何第三方库（只用标准库 zlib + struct 直接写 PNG）。

用法：
    python3 miniprogram/tools/gen_tabbar_icons.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

SIZE = 81
SS = 4  # 超采样倍数，4x4=16 次采样，边缘够平滑
OUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "tabbar"

NORMAL = (0x8A, 0x8F, 0x99)  # tabBar 未选中色，和 app.json 的 color 一致
ACTIVE = (0x0B, 0x7A, 0x5A)  # tabBar 选中色，和 app.json 的 selectedColor 一致


# --- 几何基元 ---------------------------------------------------------------


def rect(x0: float, y0: float, x1: float, y1: float):
    """轴对齐矩形。"""

    def f(x, y):
        return x0 <= x <= x1 and y0 <= y <= y1

    return f


def rounded_rect(x0: float, y0: float, x1: float, y1: float, r: float):
    """圆角矩形。r 会被夹到不超过短边一半，避免画出畸形。"""
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)

    def f(x, y):
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return False
        # 四个角用圆判定，其余部分用矩形判定
        cx = x0 + r if x < x0 + r else (x1 - r if x > x1 - r else x)
        cy = y0 + r if y < y0 + r else (y1 - r if y > y1 - r else y)
        if cx == x and cy == y:
            return True
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    return f


def disc(cx: float, cy: float, r: float):
    """实心圆。"""

    def f(x, y):
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    return f


def ring(cx: float, cy: float, r: float, w: float):
    """圆环（描边圆）。"""
    inner, outer = r - w / 2, r + w / 2

    def f(x, y):
        d2 = (x - cx) ** 2 + (y - cy) ** 2
        return inner * inner <= d2 <= outer * outer

    return f


def segment(x1: float, y1: float, x2: float, y2: float, w: float):
    """有粗细的线段（端点是圆头）。"""
    half = w / 2

    def f(x, y):
        dx, dy = x2 - x1, y2 - y1
        length2 = dx * dx + dy * dy
        if length2 == 0:
            return (x - x1) ** 2 + (y - y1) ** 2 <= half * half
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / length2))
        px, py = x1 + t * dx, y1 + t * dy
        return (x - px) ** 2 + (y - py) ** 2 <= half * half

    return f


def triangle(p1, p2, p3):
    """实心三角形，用重心坐标判内外。"""

    def sign(a, b, c):
        return (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1])

    def f(x, y):
        p = (x, y)
        d1, d2, d3 = sign(p, p1, p2), sign(p, p2, p3), sign(p, p3, p1)
        has_neg = d1 < 0 or d2 < 0 or d3 < 0
        has_pos = d1 > 0 or d2 > 0 or d3 > 0
        return not (has_neg and has_pos)

    return f


def subtract(base, *holes):
    """从 base 里挖掉若干图形。"""

    def f(x, y):
        if not base(x, y):
            return False
        return not any(h(x, y) for h in holes)

    return f


def union(*shapes):
    def f(x, y):
        return any(s(x, y) for s in shapes)

    return f


def intersect(a, b):
    def f(x, y):
        return a(x, y) and b(x, y)

    return f


# --- 五个图标 ---------------------------------------------------------------


def icon_home(x: float, y: float) -> bool:
    """房子：屋顶三角 + 屋身，挖掉一个门。"""
    roof = triangle((0.50, 0.07), (0.03, 0.47), (0.97, 0.47))
    body = rect(0.17, 0.45, 0.83, 0.95)
    door = rect(0.41, 0.65, 0.59, 0.95)
    return subtract(union(roof, body), door)(x, y)


def icon_holdings(x: float, y: float) -> bool:
    """公文包：拱形提手 + 箱体，中间开一道盖缝。"""
    # 内框的顶边必须比外框低一个描边宽度，否则会把上边一起挖穿，
    # 提手就变成两根孤零零的柱子。底边对齐（都到 0.42）让提手和箱体连成一体。
    handle = subtract(
        rounded_rect(0.34, 0.09, 0.66, 0.42, 0.08),
        rounded_rect(0.34 + 0.055, 0.09 + 0.065, 0.66 - 0.055, 0.42, 0.03),
    )
    body = rounded_rect(0.04, 0.30, 0.96, 0.93, 0.13)
    seam = intersect(rect(0.04, 0.50, 0.96, 0.565), rect(0.12, 0.0, 0.88, 1.0))
    return subtract(union(body, handle), seam)(x, y)


def icon_dividends(x: float, y: float) -> bool:
    """硬币 + 人民币符号 ¥。"""
    coin = ring(0.5, 0.5, 0.45, 0.085)
    yen = union(
        segment(0.30, 0.235, 0.50, 0.50, 0.075),  # 左撇
        segment(0.70, 0.235, 0.50, 0.50, 0.075),  # 右捺
        segment(0.50, 0.50, 0.50, 0.775, 0.075),  # 竖
        segment(0.295, 0.505, 0.705, 0.505, 0.065),  # 上横
        segment(0.295, 0.635, 0.705, 0.635, 0.065),  # 下横
    )
    return union(coin, yen)(x, y)


def icon_statistics(x: float, y: float) -> bool:
    """柱状图：三根高低不同的圆角柱。"""
    return union(
        rounded_rect(0.11, 0.56, 0.31, 0.93, 0.05),
        rounded_rect(0.40, 0.33, 0.60, 0.93, 0.05),
        rounded_rect(0.69, 0.09, 0.89, 0.93, 0.05),
    )(x, y)


def icon_profile(x: float, y: float) -> bool:
    """人像：头 + 肩。"""
    head = disc(0.5, 0.275, 0.185)
    shoulders = intersect(
        disc(0.5, 1.0, 0.42),
        rect(0.0, 0.0, 1.0, 0.90),
    )
    return union(head, shoulders)(x, y)


ICONS = {
    "home": icon_home,
    "holdings": icon_holdings,
    "dividends": icon_dividends,
    "statistics": icon_statistics,
    "profile": icon_profile,
}


# --- 渲染与写文件 -----------------------------------------------------------


def coverage(fn, px: int, py: int) -> float:
    """一个像素的覆盖率 0..1，4x4 超采样。"""
    hits = 0
    for sy in range(SS):
        for sx in range(SS):
            x = (px + (sx + 0.5) / SS) / SIZE
            y = (py + (sy + 0.5) / SS) / SIZE
            if fn(x, y):
                hits += 1
    return hits / (SS * SS)


def render(fn, color) -> list[bytes]:
    r, g, b = color
    rows = []
    for py in range(SIZE):
        row = bytearray()
        for px in range(SIZE):
            a = coverage(fn, px, py)
            row += bytes((r, g, b, int(round(a * 255))))
        rows.append(bytes(row))
    return rows


def write_png(path: Path, rows: list[bytes]) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + row for row in rows)  # 每行前面一个 filter byte
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, fn in ICONS.items():
        for suffix, color in (("", NORMAL), ("-active", ACTIVE)):
            rows = render(fn, color)
            path = OUT_DIR / f"{name}{suffix}.png"
            write_png(path, rows)
            print(f"  {path.relative_to(OUT_DIR.parent.parent.parent)}  {path.stat().st_size} bytes")
    print(f"\n共生成 {len(ICONS) * 2} 个图标 -> {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
