#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Docker Desktop 首次初始化（macOS）
#
# Docker.app 已经装好了（4.92.0，Apple 公证通过）。剩下的唯一一步需要管理员
# 权限：安装特权 helper（com.docker.vmnetd），用来做端口转发。
# 这一步必须由你本人输密码，脚本代替不了。
#
# 用法：
#   bash scripts/setup_docker.sh                                  # 初始化 + 验证
#   bash scripts/setup_docker.sh --up                             # 顺便构建并启动本项目
#   bash scripts/setup_docker.sh --proxy http://127.0.0.1:7892    # 配代理（国内必做）
#
# 你只需要输一次密码（仅特权组件那一步）。
# ---------------------------------------------------------------------------
set -euo pipefail

DOCKER_APP="/Applications/Docker.app"
INSTALL_BIN="$DOCKER_APP/Contents/MacOS/install"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTINGS_STORE="$HOME/Library/Group Containers/group.com.docker/settings-store.json"

WITH_UP=0
PROXY_URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --up)    WITH_UP=1 ;;
    --proxy) PROXY_URL="${2:-}"; shift ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
  shift
done

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# --- 0. 前置检查 -----------------------------------------------------------
[ -d "$DOCKER_APP" ] || die "没找到 $DOCKER_APP，请先安装 Docker Desktop"
[ -x "$INSTALL_BIN" ] || die "$INSTALL_BIN 不存在或不可执行"

VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" \
  "$DOCKER_APP/Contents/Info.plist" 2>/dev/null || echo "未知")
bold "Docker Desktop $VERSION  ($(uname -m), macOS $(sw_vers -productVersion))"

if [ "$(id -u)" -eq 0 ]; then
  die "不要用 sudo 跑整个脚本。脚本内部会在需要的那一步自己调用 sudo。"
fi

# 优先用 /usr/local/bin/docker；没有就用 App 内置的（后面几步都要用）
DOCKER_BIN="$(command -v docker || echo "$DOCKER_APP/Contents/Resources/bin/docker")"
echo "  使用 CLI: $DOCKER_BIN"

# --- 1. 特权安装（会提示输密码）--------------------------------------------
# 判据用官方安装器的标记文件，而不是 /Library/PrivilegedHelperTools/com.docker.vmnetd：
# 4.92 用的是新的 Docker VMM 后端，引擎整个跑在用户域（com.docker.backend +
# com.docker.virtualization），端口转发不再依赖常驻的 root 组件，那个文件会被清掉。
INSTALL_MARKER="/Library/Application Support/com.docker.docker/install-settings.json"

bold "步骤 1/4：接受服务协议 + 安装（需要管理员密码）"
if [ -f "$INSTALL_MARKER" ]; then
  ok "已安装过（$(python3 -c "import json;print('licenseTermsVersion='+str(json.load(open('$INSTALL_MARKER')).get('licenseTermsVersion')))" 2>/dev/null || echo '标记存在')），跳过"
else
  echo "  即将执行：sudo $INSTALL_BIN --accept-license --user=$(whoami)"
  echo "  --accept-license 会自动接受服务协议，省掉首次启动时的手动点击。"
  echo
  sudo "$INSTALL_BIN" --accept-license --user="$(whoami)"
  ok "安装完成"
fi

# --- 1.5 代理（Docker Hub 直连被墙时必做）----------------------------------
if [ -n "$PROXY_URL" ]; then
  bold "步骤 2/4：配置 Docker Desktop 代理 -> $PROXY_URL"
  [ -f "$SETTINGS_STORE" ] || die "找不到 $SETTINGS_STORE"
  cp "$SETTINGS_STORE" "$SETTINGS_STORE.bak"
  python3 - "$SETTINGS_STORE" "$PROXY_URL" <<'PY'
import json, sys
path, proxy = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data.update({
    "ProxyHTTPMode": "manual",
    "OverrideProxyHTTP": proxy,
    "OverrideProxyHTTPS": proxy,
    "OverrideProxyExclude": "localhost,127.0.0.1,*.local,*.internal",
})
with open(path, "w") as f:
    json.dump(data, f, indent=2)
PY
  ok "已写入（原文件备份为 $(basename "$SETTINGS_STORE").bak）"
  "$DOCKER_BIN" desktop restart >/dev/null 2>&1 || true
  ok "已重启 Docker Desktop 使配置生效"
else
  bold "步骤 2/4：代理"
  echo "  未指定 --proxy。如果拉镜像超时（国内很常见），改用："
  echo "    bash scripts/setup_docker.sh --proxy http://127.0.0.1:7892"
fi

# --- 2. 启动并等待 daemon --------------------------------------------------
bold "步骤 3/4：启动 Docker Desktop 并等待 daemon"

if "$DOCKER_BIN" info >/dev/null 2>&1; then
  ok "daemon 已在运行"
else
  open -a Docker
  echo "  已请求启动，最多等 120 秒（首次启动要初始化虚拟机，会慢一些）"
  ready=0
  for i in $(seq 1 120); do
    if "$DOCKER_BIN" info >/dev/null 2>&1; then
      ok "daemon 就绪（${i}s）"
      ready=1
      break
    fi
    # 每 10 秒给一次心跳，不然看起来像卡死
    [ $((i % 10)) -eq 0 ] && echo "    ...已等待 ${i}s"
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    echo
    die "120 秒内 daemon 没起来。请手动打开 Docker Desktop 看窗口里的提示
     （常见原因：需要点击「Accept」/「Skip sign in」，或虚拟机组件首次下载较慢）。
     排查信息：'$DOCKER_BIN' info"
  fi
fi

# --- 3. 验证 ---------------------------------------------------------------
bold "步骤 4/4：验证"
"$DOCKER_BIN" version --format '  Client: {{.Client.Version}}  Server: {{.Server.Version}}'
ok "docker 可用"
"$DOCKER_BIN" compose version
ok "docker compose 可用"

if ! command -v docker >/dev/null 2>&1; then
  echo
  echo "  提示：docker 还不在当前 PATH 里，新开一个终端即可。"
fi

# --- 可选：构建并启动本项目 -------------------------------------------------
if [ "$WITH_UP" -eq 1 ]; then
  bold "构建并启动分红管家（会真实执行 Dockerfile）"
  cd "$REPO_ROOT"

  if ! "$DOCKER_BIN" compose up -d --build; then
    die "构建失败。如果是拉镜像超时，先跑：
  bash scripts/setup_docker.sh --proxy http://127.0.0.1:7892"
  fi

  echo "  等待 api 容器健康..."
  for i in $(seq 1 60); do
    if curl -fsS --noproxy '*' http://localhost:8000/healthz >/dev/null 2>&1; then
      ok "API 已就绪（${i}s）"
      break
    fi
    sleep 1
  done

  echo "  执行数据库迁移..."
  "$DOCKER_BIN" compose exec -T api alembic upgrade head
  ok "迁移完成"

  echo "  跑端到端冒烟..."
  "$DOCKER_BIN" compose exec -T api python -c "
import sys, httpx
c = httpx.Client(base_url='http://127.0.0.1:8000', timeout=10, trust_env=False)
r = c.post('/api/v1/auth/dev-login', json={'openid': 'docker-smoke'})
assert r.status_code == 200, r.text
print('  登录 OK')
" && ok "容器内自检通过"

  echo
  echo "  Swagger:  http://localhost:8000/docs"
  echo "  查看日志: docker compose logs -f api"
  echo "  停止:     docker compose down"
fi

echo
bold "完成。"
