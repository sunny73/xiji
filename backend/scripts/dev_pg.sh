#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 本地开发用 PostgreSQL 管理脚本
#
# 为什么不用 brew / docker：
#   * 这台机器的 Homebrew 要求 Command Line Tools 26.3，版本不满足，装不了；
#   * Docker Desktop 也没装。
# 所以改用 EDB 官方免安装二进制包（纯预编译，不需要编译器和 sudo），
# 数据目录和套接字全部放在仓库内的 .local/ 下，删掉整个目录就等于卸载。
#
# 用法：
#   bash scripts/dev_pg.sh setup     # 首次：下载 + initdb + 建库（约 300MB）
#   bash scripts/dev_pg.sh start
#   bash scripts/dev_pg.sh stop
#   bash scripts/dev_pg.sh status
#   bash scripts/dev_pg.sh psql      # 直接进 psql
#   bash scripts/dev_pg.sh reset     # 删库重来（危险）
# ---------------------------------------------------------------------------
set -euo pipefail

PG_VERSION="16.9-1"
PG_URL="https://get.enterprisedb.com/postgresql/postgresql-${PG_VERSION}-osx-binaries.zip"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_DIR="$REPO_ROOT/.local"
PG_HOME="$LOCAL_DIR/pgsql"
PG_DATA="$LOCAL_DIR/pgdata"
PG_RUN="$LOCAL_DIR/pgrun"
PG_LOG="$LOCAL_DIR/pg.log"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-dividend}"
PG_DB="${PG_DB:-dividend}"
PG_BIN="$PG_HOME/bin"

export PGDATA="$PG_DATA"

setup() {
  mkdir -p "$LOCAL_DIR"
  if [ ! -d "$PG_HOME" ]; then
    echo "==> 下载 PostgreSQL $PG_VERSION（约 300MB）"
    curl -L --progress-bar -o "$LOCAL_DIR/pg.zip" "$PG_URL"
    echo "==> 解压"
    (cd "$LOCAL_DIR" && unzip -q -o pg.zip)
    rm -f "$LOCAL_DIR/pg.zip"
  fi

  if [ ! -f "$PG_DATA/PG_VERSION" ]; then
    echo "==> initdb"
    # --auth=trust 只适合本地开发：任何本机进程都能连，绝不要用在生产
    "$PG_BIN/initdb" -D "$PG_DATA" -U "$PG_USER" --auth=trust --encoding=UTF8 --locale=C
  fi

  mkdir -p "$PG_RUN"
  start
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PG_PORT" -U "$PG_USER" "$PG_DB" 2>/dev/null \
    && echo "==> 已创建数据库 $PG_DB" || echo "==> 数据库 $PG_DB 已存在"
  echo
  echo "DATABASE_URL=postgresql+psycopg://$PG_USER@127.0.0.1:$PG_PORT/$PG_DB"
}

start() {
  if "$PG_BIN/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1; then
    echo "==> PostgreSQL 已在运行（端口 ${PG_PORT}）"
    return
  fi
  mkdir -p "$PG_RUN"
  echo "==> 启动 PostgreSQL"
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$PG_LOG" \
    -o "-p $PG_PORT -k $PG_RUN -c listen_addresses=127.0.0.1" -w start
}

stop() {
  echo "==> 停止 PostgreSQL"
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast -w stop
}

status() {
  "$PG_BIN/pg_ctl" -D "$PG_DATA" status || true
  if "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1; then
    echo "==> 可以连接：postgresql://$PG_USER@127.0.0.1:$PG_PORT/$PG_DB"
    echo "==> 日志：$PG_LOG"
  else
    echo "==> 连不上（端口 ${PG_PORT}）"
  fi
}

psql_() {
  exec "$PG_BIN/psql" -h 127.0.0.1 -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB"
}

reset() {
  read -r -p "这会删除 $PG_DATA 里的全部数据，确定？[y/N] " ans
  [ "$ans" = "y" ] || exit 1
  stop || true
  rm -rf "$PG_DATA" "$PG_RUN"
  setup
}

case "${1:-}" in
  setup) setup ;;
  start) start ;;
  stop) stop ;;
  status) status ;;
  psql) psql_ ;;
  reset) reset ;;
  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
