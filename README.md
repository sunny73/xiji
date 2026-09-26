# 分红管家

个人投资分红现金流管理工具。回答一个问题：**我的股票/ETF 今年给我发了多少钱，接下来还会有多少。**

技术栈：微信小程序 + FastAPI + PostgreSQL（SQLAlchemy 2.x / Alembic / Pydantic v2）。

> 当前进度：**代码部分全部完成并跑通**（后端 + 小程序 + H5 预览 + 部署配置）。
> 上架还差账号、域名、备案这些只能你本人做的事，操作手册见 **[docs/PUBLISH.md](docs/PUBLISH.md)**。
>
> ⚠️ 动手部署之前先看那份文档的**第一节**：小程序服务类目对「金融信息」有资质门槛，
> 个人主体可能选不了对应类目。这是本项目上架最大的未知数，值得先确认。
>
> 设计取舍见 [docs/DESIGN.md](docs/DESIGN.md)，前端说明见 [docs/MINIPROGRAM.md](docs/MINIPROGRAM.md)。

---

## 已实现的功能

| 模块 | 状态 | 说明 |
|---|---|---|
| 微信登录 | ✅ | `code2Session` 换 openid → 签发自己的 JWT；首次登录自动注册 |
| 多投资账户 | ✅ | 一个用户 N 个账户（我的/老婆的/退休的） |
| 证券字典 | ✅ | 全局共享，`code + market` 唯一，幂等创建 |
| 持仓 CRUD | ✅ | 股数、成本价、成本金额 |
| 分红 CRUD | ✅ | **金额由后端计算**，支持待收/已到账 |
| 分红计划 | ✅ | 表结构 + 首页「预计收入」计算（暂无对外写接口，由后台维护） |
| 首页 Dashboard | ✅ | 预计/已到账/待收 + 最近一笔到账 + 本月 + 最近记录 |
| 统计 | ✅ | 年度 / 月度(12月补齐) / 按标的 / 分红日历 |
| 数据隔离 | ✅ | 全部走 `JOIN accounts`，越权一律 404，有自动化测试守护 |
| 后端测试 | ✅ | 117 个 pytest 用例 + 端到端冒烟脚本 |
| Docker | ✅ | `docker-compose.yml` + 非 root 镜像，已实际构建运行验证 |
| 小程序前端（原生） | 🧊 冻结 | 10 个页面；277 单测 + 43 项契约测试。保留作参考，不再维护 |
| H5 预览（原生版） | 🧊 冻结 | 浏览器里跑原生小程序代码；102 单测 + 11 页渲染 + 24 项交互自检 |
| **uni-app 前端** | ✅ **当前主线** | 一套代码发小程序 + H5；251 单测 + 15 项静态检查 + 11 页无头渲染 |
| 部署配置 | ✅ | 生产 compose + Nginx 配置，已在生产模式下验证启动 |
| 发布到微信 | ⬜ | 需要你的账号/域名/备案，操作手册见 [docs/PUBLISH.md](docs/PUBLISH.md) |

> ⚠️ **本机环境有坑**：这台 Mac 的 Homebrew 不可用（Command Line Tools 太旧），
> 且系统级 HTTP 代理会劫持 localhost 请求。见 [docs/SETUP-MACOS.md](docs/SETUP-MACOS.md)。

---

## 快速开始

### 前置条件

只需要 **Python 3.11+** 和 **PostgreSQL 16**。

本机没装 PostgreSQL 也没关系 —— 仓库自带一个免安装的管理脚本（不需要 brew、不需要 Docker、不需要 sudo）：

```bash
bash backend/scripts/dev_pg.sh setup    # 首次：下载 + 初始化 + 建库，约 300MB
```

它会自动完成下载、`initdb`、启动服务、创建 `dividend` 库，并把数据全部放在 `.local/` 里
（删掉 `.local/` 就等于彻底卸载）。

> 已经有 PostgreSQL 的话跳过这步，直接用你自己的连接串即可。
> **不想装 PostgreSQL？** 直接跳到下面的「用 Docker 启动」，一条命令全搞定。

### 启动后端

```bash
cd backend

# 1. 装依赖（使用工作区内的缓存目录，避免污染全局）
UV_CACHE_DIR="$PWD/../.uv-cache" uv sync --extra dev

# 2. 配置环境变量
cp .env.example .env        # 按需修改 DATABASE_URL

# 3. 建表
.venv/bin/alembic upgrade head

# 4. 起服务
.venv/bin/uvicorn app.main:app --reload
```

打开 **<http://127.0.0.1:8000/docs>** 就是可交互的 Swagger 文档。

### 用 Docker 启动

```bash
docker compose up -d --build             # 开发模式：挂源码 + 热重载
docker compose exec api alembic upgrade head
open http://localhost:8000/docs
```

* **生产部署**用 `docker compose -f docker-compose.yml up -d --build`（跳过 dev override），
  变量从根目录 `.env` 读（模板见 [.env.example](.env.example)），完整步骤见
  **[docs/PUBLISH.md](docs/PUBLISH.md)**
* API 和数据库默认**只监听 127.0.0.1**，公网流量走 Nginx 反代。
  真机联调需要手机直连时：`API_HOST_PORT=0.0.0.0:8000 docker compose up -d`

* 数据库映射到宿主 **55432**（不是 5432），避免和本机原生 PostgreSQL 撞端口
* 首次拉镜像如果超时，是 Docker Hub 被墙，先配代理：
  `bash scripts/setup_docker.sh --proxy http://127.0.0.1:7892`
* macOS 上的完整环境说明（含三个已验证的坑）见 **[docs/SETUP-MACOS.md](docs/SETUP-MACOS.md)**

### 跑起微信小程序

1. 装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. **先扫码登录**（这个版本没有游客模式）
3. **导入项目**，目录选 `miniprogram/`，AppID 那栏点「**测试号**」
   （仓库里的 `touristappid` 占位符已废弃，直接用会报「不存在此 AppID」）
4. 详情 → 本地设置 → 勾选 **「不校验合法域名」**（否则 `http://127.0.0.1:8000` 会被拦）

**想看到有数据的效果**，先灌一份演示数据（2 个账户 / 5 个标的 / 11 笔分红 / 6 条分红计划）：

```bash
cd backend
# 后端跑在 Docker 里时，库映射在宿主 55432
DATABASE_URL=postgresql+psycopg://dividend:dividend@127.0.0.1:55432/dividend \
  .venv/bin/python scripts/seed_demo.py --reset
# 后端是本地跑的话（原生 PostgreSQL 在 5432），直接用 .env 里的配置
.venv/bin/python scripts/seed_demo.py --reset
```

开发环境用的是固定 openid 免微信登录，**导入即可用**，不需要 AppID 和 AppSecret。
真机预览要把 `utils/config.js` 的 `baseUrl` 改成电脑的局域网 IP。

完整说明（页面清单、分层约定、常见坑）见 **[docs/MINIPROGRAM.md](docs/MINIPROGRAM.md)**。

### 用 uni-app 版（推荐，一套代码发小程序 + H5）

```bash
cd uniapp
npm install                              # 走 npmmirror 镜像
npm run dev:h5                           # → http://127.0.0.1:5173
npm run build:mp-weixin                  # → dist/build/mp-weixin，用开发者工具导入
```

`miniprogram/`（原生版）和 `h5/`（原生版的预览运行时）已**冻结**，只作参考保留。
详见 [uniapp/README.md](uniapp/README.md)。

### 或者：在浏览器里看（原生版的 H5 预览，已冻结）

不想装开发者工具的话，有个 H5 预览，**跑的仍然是真实的小程序代码**
（同一份 WXML/WXSS/页面 JS，只是把 `wx.*` 换成了浏览器实现）：

```bash
cd h5
node build.js      # 打包
node server.js     # → http://127.0.0.1:3000
```

它是**预览**，不是能上线的 H5 —— picker、下拉刷新等原生组件是模拟的，
最终验收仍要在开发者工具里做。详见 **[h5/README.md](h5/README.md)**。

---

## 5 分钟上手：走一遍完整流程

在 Swagger（`/docs`）里点右上角 **Authorize**，或者直接用 curl：

```bash
API=http://127.0.0.1:8000/api/v1

# 1) 登录（开发环境免微信，直接指定 openid）
TOKEN=$(curl -s -X POST $API/auth/dev-login \
  -H 'Content-Type: application/json' \
  -d '{"openid":"demo","nickname":"我"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
AUTH="Authorization: Bearer $TOKEN"

# 2) 建账户
ACC=$(curl -s -X POST $API/accounts -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"我的账户"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# 3) 建标的
SEC=$(curl -s -X POST $API/securities -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"code":"601988","name":"中国银行","market":"CN","type":"STOCK"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# 4) 建持仓：10000 股，成本 4.12
curl -s -X POST $API/holdings -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"account_id\":\"$ACC\",\"security_id\":\"$SEC\",\"shares\":\"10000\",\"cost_price\":\"4.12\"}"

# 5) 记一笔已到账分红：10000 股 × 每股 0.19 → 后端算出 1900.00
curl -s -X POST $API/dividends -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"account_id\":\"$ACC\",\"security_id\":\"$SEC\",\"payment_date\":\"2026-09-20\",\"shares\":\"10000\",\"per_share\":\"0.19\",\"status\":\"received\"}"

# 6) 首页
curl -s $API/dashboard -H "$AUTH" | python3 -m json.tool
```

首页返回：

```json
{
  "year": 2026,
  "summary": { "estimated": 0.0, "received": 1900.0, "pending": 0.0 },
  "next_dividend": null,
  "current_month": { "month": 9, "amount": 1900.0 },
  "recent_dividends": [
    { "security_name": "中国银行", "payment_date": "2026-09-20", "amount": 1900.0, "status": "received" }
  ]
}
```

`estimated` 是 0，因为还没有维护分红计划（`dividend_plans`，那个暂时由后台直接写库）。
一旦某标的有计划，`estimated` 会立刻按「当前持仓 × 每股金额」算出来 —— 见
[tests/test_dashboard.py](backend/tests/test_dashboard.py) 里的 `test_estimated_follows_current_holdings`。

---

## 项目结构

```
xiji/
├── backend/                       FastAPI 后端
│   ├── app/
│   │   ├── main.py                应用入口、CORS、健康检查
│   │   ├── core/
│   │   │   ├── config.py          所有环境变量集中在这里
│   │   │   ├── database.py        Engine / Session / Base
│   │   │   ├── security.py        JWT 签发与校验
│   │   │   ├── deps.py            CurrentUser / DBSession 依赖
│   │   │   └── money.py           ★ 金额计算唯一入口（Decimal）
│   │   ├── models/                7 张表的 SQLAlchemy 模型
│   │   ├── schemas/               Pydantic v2 请求/响应模型
│   │   ├── api/                   路由层（只做参数解析 + 序列化）
│   │   ├── services/              业务逻辑 + ★ 权限边界
│   │   └── tasks/                 后台任务签名（MVP 未实现）
│   ├── migrations/                Alembic 迁移（已生成 initial schema）
│   ├── tests/                     117 个 pytest 用例
│   ├── scripts/
│   │   ├── dev_pg.sh              本地 PostgreSQL 一键管理
│   │   └── smoke_test.py          端到端冒烟（打真实 HTTP + 真实库）
│   ├── Dockerfile
│   └── pyproject.toml
├── miniprogram/                   【冻结】原生微信小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── pages/                     10 个页面（首页/持仓/分红/统计/我的 + 5 个子页）
│   ├── services/                  http ← auth ← api（单向依赖）
│   ├── utils/                     config / format / validate / decorate / calendar / security / seq
│   ├── assets/tabbar/             tabBar 图标（脚本生成）
│   ├── tools/gen_tabbar_icons.py  图标生成器（纯标准库）
│   └── tests/                     277 单元测试 + 43 项契约测试
├── uniapp/                        ★ 当前前端主线：Vue3 + Vite，发小程序 + H5
│   ├── src/pages/                 10 个页面（Vue SFC）
│   ├── src/utils/ services/       从原生版直接复用（逻辑未改）
│   ├── scripts/serve.js           H5 产物预览（静态 + /api 代理）
│   └── tests/                     251 单测 + 15 项静态检查 + 11 页无头渲染
├── h5/                            【冻结】原生版的 H5 预览运行时
│   ├── build.js                   打包器（含 WXML 语法校验 + bundle 语法自检）
│   ├── server.js                  静态服务 + /api 反向代理
│   ├── runtime/                   WXML 渲染器、wx 替身、路由
│   └── tests/                     102 单测 + 逐页无头渲染 + 浏览器交互自检
├── deploy/nginx.conf              生产 Nginx 配置（HTTPS + 限流）
├── .env.example                   生产部署变量模板
├── docs/
│   ├── DESIGN.md                  设计说明：ER、取舍、API 约定
│   ├── PUBLISH.md                 ★ 发布到微信的完整路径 + 类目资质风险
│   ├── MINIPROGRAM.md             前端说明：怎么跑、分层约定、测试
│   └── SETUP-MACOS.md             本机环境：PostgreSQL / Docker / 三个坑
├── scripts/setup_docker.sh        Docker Desktop 一键初始化
├── docker-compose.yml
└── .gitignore
```

---

## 开发命令

```bash
# --- 后端 ---
cd backend

.venv/bin/python -m pytest              # 跑测试（自动创建 dividend_test 库）
.venv/bin/python -m pytest -v           # 看每个用例
.venv/bin/python -m pytest tests/test_permissions.py -v   # 只看权限测试
.venv/bin/ruff check app tests          # lint
.venv/bin/ruff check --fix app tests    # 自动修

.venv/bin/alembic revision --autogenerate -m "描述"   # 改完模型后生成迁移
.venv/bin/alembic upgrade head
.venv/bin/alembic downgrade -1

.venv/bin/python scripts/smoke_test.py  # 服务启动后跑端到端冒烟
bash scripts/dev_pg.sh status | stop | psql

# --- 小程序 ---
cd miniprogram

node tests/run.js                       # 277 个单元测试（零依赖，不需要后端）
node tests/integration.js               # 43 项前后端契约测试（需要后端在跑）
python3 tools/gen_tabbar_icons.py       # 重新生成 tabBar 图标

# --- uni-app（主线）---
cd uniapp
npm run dev:h5                          # 开发服务器（vite 代理 /api）
npm run build:h5                        # → dist/build/h5
npm run build:mp-weixin                 # → dist/build/mp-weixin
node scripts/serve.js                   # 预览 H5 产物 → :5174
node tests/run.mjs                      # 251 个单元测试
node tests/structure.mjs                # 15 项静态检查
node tests/render.mjs                   # 11 页无头渲染 + 跨页一致性

# --- H5 预览（原生版，已冻结）---
cd h5
node build.js                           # 打包（改了 miniprogram/ 就要重跑）
node server.js                          # http://127.0.0.1:3000
node tests/run.js                       # 102 个运行时单测
node tests/render.js                    # 逐页无头渲染 + 跨页数字一致性

# --- Docker ---
docker compose up -d --build             # 开发：自动叠加 override（挂源码 + 热重载）
docker compose exec api alembic upgrade head
docker compose logs -f api
docker compose down                      # 停容器，保留数据卷

# 生产部署（显式 -f，跳过 override）
cp .env.example .env && vim .env
docker compose -f docker-compose.yml up -d --build
```

**后端测试不会碰你的开发库。** `conftest.py` 会自动创建并使用 `<原库名>_test`，
每个用例前 TRUNCATE，用例之间完全独立。

**前端单元测试不需要后端**，`node tests/run.js` 直接跑。
它甚至能静态抓到「WXML 里绑了一个 JS 中不存在的方法」这类错误——
小程序渲染没法在 Node 里跑，但这类低级错误不该等到手点按钮才发现。

---

## 数据库表

7 张表：`users`、`accounts`、`securities`、`holdings`、`dividends`、`dividend_plans`、
以及 Alembic 自己的 `alembic_version`。

详细 ER 关系和设计理由见 **[docs/DESIGN.md](docs/DESIGN.md)**。三条最关键的：

1. **`dividend_plans`（预计）与 `dividends`（实际）严格分表** —— 用户减仓、公司改方案、
   扣税都会让实际 ≠ 预计，混成一张表就再也分不清"这笔钱到没到"。
2. **金额只由后端计算** —— `shares × per_share`，`ROUND_HALF_UP` 到分；
   请求体里传 `amount` 直接 422。
3. **权限靠 `JOIN accounts`** —— 越权返回 404 而不是 403，不泄露 id 是否存在。

---

## 上线前必做

后端启动时会自检生产配置，带开发开关启动会**直接拒绝服务**。上线前确认：

```bash
ENV=prod
JWT_SECRET=<python -c "import secrets;print(secrets.token_urlsafe(48))">
WECHAT_APPID=<小程序 AppID>
WECHAT_SECRET=<小程序 AppSecret>
WECHAT_MOCK=false       # 必须关闭，否则任何人可伪造登录
ALLOW_DEV_LOGIN=false   # 必须关闭
```

另外在微信公众平台把后端域名加进 **request 合法域名**（必须 HTTPS）。
