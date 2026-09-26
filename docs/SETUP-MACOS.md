# macOS 环境搭建（这台机器专属的注意事项）

这台机器的环境有几处和"标准流程"不一样，踩过的坑记在这里，避免下次重新踩。

## 环境现状

| 项 | 情况 | 影响 |
|---|---|---|
| macOS | 15.3.1 (Sequoia), Intel x86_64 | — |
| Command Line Tools | **12.0（2020 年）**，Homebrew 要求 ≥12.4 | ❌ `brew install` 全部不可用 |
| 系统代理 | **Clash Verge，127.0.0.1:7892** | ⚠️ 见下方「坑 1」 |
| Docker Desktop | 4.92.0（原 4.24.0 太旧，已替换） | ✅ 走代理可用 |

---

## 一、PostgreSQL：两种方式选一种

### 方式 A：原生便携版（推荐日常开发）

Homebrew 用不了，所以仓库自带一个免安装脚本：

```bash
bash backend/scripts/dev_pg.sh setup    # 首次：下载 + initdb + 建库
bash backend/scripts/dev_pg.sh start | stop | status | psql | reset
```

* 数据目录：`.local/pgdata/`，套接字：`.local/pgrun/`，日志：`.local/pg.log`
* 监听 `127.0.0.1:5432`
* **删掉 `.local/` 就等于彻底卸载**，不留任何系统级残留
* 用的是 EDB 官方预编译二进制，不需要编译器、不需要 sudo

连接串（`backend/.env` 里已经是这个）：

```
DATABASE_URL=postgresql+psycopg://dividend@127.0.0.1:5432/dividend
```

### 方式 B：Docker

```bash
docker compose up -d db
```

占用宿主 **55432**（不是 5432 —— 见「坑 3」）。

两种方式可以共存，互不干扰。

---

## 二、Docker Desktop

### 为什么原来的 4.24.0 不能用

`/Applications/Docker.app` 是 2023 年 8 月的 4.24.0，而系统已经升到 macOS 15。
4.24 早于 Sequoia（Docker Desktop 从 4.34 才正式支持 macOS 15），
而且它的特权 helper 从来没装上过，所以 `docker` 命令也一直不在 PATH 里。

### 安装步骤（已完成，供重装参考）

```bash
# 1) 下载 Intel 版（Apple Silicon 把 amd64 换成 arm64）
curl -L -o Docker.dmg https://desktop.docker.com/mac/main/amd64/Docker.dmg

# 2) 校验并挂载
hdiutil verify Docker.dmg
hdiutil attach Docker.dmg -nobrowse -readonly -mountpoint ./mnt
codesign --verify --deep --strict ./mnt/Docker.app     # 应输出 valid
spctl -a -vvv -t exec ./mnt/Docker.app                 # 应为 accepted / Notarized

# 3) 替换 App（用 ditto，不要用 cp -R，ditto 才保留签名和 ACL）
mv /Applications/Docker.app ~/Docker-4.24.0.app.bak
ditto ./mnt/Docker.app /Applications/Docker.app
hdiutil detach ./mnt
```

### 一键初始化

```bash
bash scripts/setup_docker.sh                                  # 初始化 + 验证
bash scripts/setup_docker.sh --up                             # 顺便构建并启动本项目
bash scripts/setup_docker.sh --proxy http://127.0.0.1:7892    # 配代理并重启（国内必做）
```

脚本流程：接受服务协议并安装（`sudo`，提示输一次密码）→ 配代理（可选）→ 启动 → 等 daemon → 验证版本。
脚本是幂等的，重复跑不会再次要密码。

> Docker Desktop 自带官方无人值守安装 CLI：
> `/Applications/Docker.app/Contents/MacOS/install --accept-license --user=$USER`
> `--accept-license` 省掉了首次启动时手点服务协议那一步，
> 装完后 `/Library/Application Support/com.docker.docker/install-settings.json`
> 里的 `licenseTermsVersion` 就是"已接受协议"的标记。

### Docker Desktop 4.92 的一个认知纠正

**它不需要常驻的系统级特权组件。** 实测：

```
$ ls /Library/PrivilegedHelperTools/          # 只有 Clash 的，没有 docker
$ ls /Library/LaunchDaemons/ | grep docker    # 空
$ launchctl list | grep docker                # com.docker.helper（用户域，已退出）

$ ps aux | grep docker
yingliu  com.docker.backend services
yingliu  com.docker.virtualization --kernel   # 新的 Docker VMM
```

4.92 用的是新的 **docker-vmm** 后端，引擎整个跑在用户域，
端口转发由用户态的 `com.docker.backend` 完成，不再依赖 root 的 `com.docker.vmnetd`。

所以：**判断"是否已安装"要看
`/Library/Application Support/com.docker.docker/install-settings.json`，
不要看 vmnetd 文件存不存在**（它会被清理掉，拿它做判断会导致脚本每次都要你输密码）。

---

## 三、微信开发者工具

小程序**只能**在微信开发者工具或真机里跑，没有浏览器方案。

### 安装

```bash
# 官方跳转接口会返回当前最新版的直链（type=darwin 是 Intel macOS）
URL=$(curl -s -o /dev/null -w '%{redirect_url}' \
  "https://servicewechat.com/wxa-dev-logic/download_redirect?type=darwin&from=mpwiki")
curl -L -o wechat-devtools.dmg "$URL"        # 约 293MB
hdiutil verify wechat-devtools.dmg
hdiutil attach wechat-devtools.dmg -nobrowse -readonly -mountpoint ./mnt
ditto ./mnt/wechatwebdevtools.app /Applications/wechatwebdevtools.app
hdiutil detach ./mnt
```

`type` 的取值：`darwin` = macOS Intel，`win32` = Windows。（没有 `darwin-arm64`，
Apple Silicon 也用 `darwin`，包内是 universal 的。）

### 两个第一次必踩的坑

**1. 必须扫码登录。** 这个版本已经没有「游客模式」了——启动后停在二维码页，
用微信扫一下即可。扫码前什么项目都打不开。

**2. 服务端口默认是关的，CLI 用不了。** 报错长这样：

```
[error] 工具的服务端口已关闭。要使用命令行调用工具，
        请手动打开工具 -> 设置 -> 安全设置，将服务端口开启。
```

不想点菜单的话，可以直接改配置（先退出 IDE，否则它退出时会把内存里的状态覆盖回去）：

```bash
P="$HOME/Library/Application Support/微信开发者工具"
F=$(find "$P" -name 'localstorage_*.json' -exec grep -l enableServicePort {} \; | head -1)
# 1) 退出 IDE
osascript -e 'quit app "wechatwebdevtools"'
# 2) 把 security.enableServicePort 改成 true
python3 - "$F" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d.setdefault("security", {})["enableServicePort"] = True
json.dump(d, open(p, "w"), ensure_ascii=False)
PY
# 3) 重新启动，端口会自动分配
open -a /Applications/wechatwebdevtools.app
```

启动后 IDE 会生成 `<profile>/Default/.cli`，之后 CLI 就能用了：

```bash
CLI=/Applications/wechatwebdevtools.app/Contents/MacOS/cli
"$CLI" islogin                                              # {"login":true}
"$CLI" open --project /path/to/miniprogram                  # 打开项目
"$CLI" preview --project /path/to/miniprogram --qr-output /tmp/qr.png
```

**3. `touristappid`（无 AppID 模式）已废弃。** `project.config.json` 里写
`"appid": "touristappid"` 时，CLI 会报：

```
code: 10, message: 'Error: 不存在此 AppID 请检查后重新输入'
```

也没有 CLI 参数能创建「测试号」。**必须**在图形界面里：导入项目 → AppID 那栏点
「测试号」→ 自动生成一个真实 AppID（DevTools 会把它写回 `project.config.json`）。

---

## 四、三个坑

### 坑 1：系统代理会劫持 `127.0.0.1` 的请求 ⚠️

Clash Verge 设置了 macOS 系统级 HTTP 代理。Python 的 `httpx` / `requests`
默认 `trust_env=True`，会读取系统代理，**把发往 localhost 的请求也丢给 Clash**，
结果是 **502 空响应**——服务明明起着，却像是挂了。

```python
# 错的：会 502
httpx.Client(base_url="http://127.0.0.1:8000")

# 对的
httpx.Client(base_url="http://127.0.0.1:8000", trust_env=False)
```

`backend/scripts/smoke_test.py` 里已经这么处理了。curl 用 `--noproxy '*'` 同理。

**排查口诀**：服务起来了但返回 502 空响应 → 先查系统代理。

### 坑 2：`brew install` 全废

CLT 12.0 太旧，Homebrew 拒绝工作。升级 CLT 需要
`xcode-select --install`（弹 GUI）或从 Apple 开发者网站下载，无法脚本化。

所以：**能不用 brew 就不用**。PostgreSQL 用便携版脚本，Docker 用官方 DMG。

### 坑 3：5432 端口冲突

本机已经有原生 PostgreSQL 占着 5432，所以 `docker-compose.yml` 里
db 服务的宿主端口**特意映射到 55432**：

```yaml
ports:
  - "${POSTGRES_HOST_PORT:-55432}:5432"
```

容器之间走 compose 内网（`db:5432`），不受这个映射影响。
如果你的机器 5432 是空的，`POSTGRES_HOST_PORT=5432 docker compose up -d` 即可。

### 坑 4（补充）：Docker Hub 直连被墙

诊断结论：

```
auth.docker.io 直连 IPv4  → 超时（000）
auth.docker.io 直连 IPv6  → 超时
auth.docker.io 走 Clash   → 200，0.9s
```

Docker Desktop 内置的 Hub 代理（`hubproxy.docker.internal`）走宿主网络，
但**不会自动使用系统代理**，所以拉镜像会一直超时。

解决：把代理显式写进 Docker Desktop 的用户设置
（`~/Library/Group Containers/group.com.docker/settings-store.json`），
或者直接跑 `bash scripts/setup_docker.sh --proxy http://127.0.0.1:7892`。

改完必须**重启 Docker Desktop**（`docker desktop restart`）才生效，验证方式：

```bash
docker pull python:3.12-slim     # 能拉下来就说明通了
docker info | grep -i proxy      # 注意：这里永远显示 http.docker.internal:3128，
                                 # 那是 Docker 自己的代理垫片，不代表你的设置没生效
```

> 备选方案是配国内 registry mirror（`~/.docker/daemon.json` 里加
> `registry-mirrors`）。但第三方镜像站能看到你所有的镜像拉取，
> 有代理可用时优先用代理。

---

## 五、日常命令

```bash
# Docker
docker desktop start | stop | restart | status
docker compose up -d --build
docker compose exec api alembic upgrade head
docker compose logs -f api
docker compose down            # 停容器，保留数据卷
docker compose down -v         # 连数据卷一起删

# 原生 PostgreSQL
bash backend/scripts/dev_pg.sh status

# 后端
cd backend
.venv/bin/uvicorn app.main:app --reload
.venv/bin/python -m pytest
.venv/bin/python scripts/smoke_test.py
```

## 六、可以回收的空间

| 路径 | 大小 | 说明 |
|---|---|---|
| `.local/Docker.dmg` | 615 MB | 安装包，装完即可删 |
| `.local/Docker-4.24.0.app.bak` | 1.8 GB | 旧版 Docker，确认新版没问题后可删 |
| `.local/pgsql/` | ~300 MB | 便携版 PostgreSQL（用 Docker 的话可删） |

```bash
rm -rf .local/Docker.dmg .local/Docker-4.24.0.app.bak
```
