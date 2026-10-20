#!/usr/bin/env bash
# Локальный Postgres только для тестов (bun test) — без Docker.
# Создаёт отдельный кластер в .pgtest/ на порту 5450, не трогая твой основной Postgres.
#
#   ./scripts/pgtest.sh start | stop | reset | status
set -euo pipefail

PGBIN="${PGBIN:-/Library/PostgreSQL/18/bin}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/.pgtest"
DATA="$DIR/data"
PORT="${PGTEST_PORT:-5450}"
LOG="$DIR/pg.log"

case "${1:-start}" in
  start)
    if [ ! -d "$DATA" ]; then
      mkdir -p "$DIR"
      "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
    fi
    "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1" -l "$LOG" start
    "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT"
    ;;
  stop)
    "$PGBIN/pg_ctl" -D "$DATA" stop || true
    ;;
  reset)
    "$PGBIN/pg_ctl" -D "$DATA" stop >/dev/null 2>&1 || true
    rm -rf "$DATA"
    exec "$0" start
    ;;
  status)
    "$PGBIN/pg_ctl" -D "$DATA" status || true
    "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" || true
    ;;
  *)
    echo "usage: $0 {start|stop|reset|status}" >&2
    exit 2
    ;;
esac
