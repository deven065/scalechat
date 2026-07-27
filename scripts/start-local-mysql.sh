#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

DBHOST="${DBHOST:-localhost}"
DBPORT="${DBPORT:-3306}"
DBUSER="${DBUSER:-root}"
DBNAME="${DBNAME:-scalechat}"

if { [ "$DBHOST" != "127.0.0.1" ] && [ "$DBHOST" != "localhost" ]; } || [ "$DBPORT" != "3310" ]; then
  echo "Skipping local MySQL startup for ${DBHOST}:${DBPORT}"
  exit 0
fi

MYSQLD="$(command -v mysqld || true)"
if [ -z "$MYSQLD" ] && [ -x "/usr/libexec/mysqld" ]; then
  MYSQLD="/usr/libexec/mysqld"
fi

if [ -z "$MYSQLD" ]; then
  echo "mysqld was not found. Install MySQL server or point .env at a running DB." >&2
  exit 1
fi

MYSQLADMIN="$(command -v mysqladmin || true)"
MYSQL="$(command -v mysql || true)"

if [ -z "$MYSQLADMIN" ] || [ -z "$MYSQL" ]; then
  echo "mysql and mysqladmin clients are required to start/check the local DB." >&2
  exit 1
fi

DATA_DIR="${LOCAL_MYSQL_DATA_DIR:-$ROOT_DIR/.local/mysql3310-1785190455/data}"
RUN_DIR="${LOCAL_MYSQL_RUN_DIR:-$ROOT_DIR/.local/mysql3310-1785190455/run}"
LOG_DIR="${LOCAL_MYSQL_LOG_DIR:-$ROOT_DIR/.local/mysql3310-1785190455/logs}"
IMPORT_SQL="${LOCAL_MYSQL_IMPORT_SQL:-$ROOT_DIR/.local/import.mysql8.sql}"

if [ ! -d "$DATA_DIR" ] || [ ! -f "$DATA_DIR/mysql.ibd" ]; then
  echo "Local MySQL data directory is missing or incomplete: $DATA_DIR" >&2
  echo "Create/import the database, or set LOCAL_MYSQL_DATA_DIR to the right data directory." >&2
  exit 1
fi

mkdir -p "$RUN_DIR" "$LOG_DIR"

MYSQL_AUTH=(--protocol=TCP -h "$DBHOST" -P "$DBPORT" -u "$DBUSER")
if [ -n "${DBPASS:-}" ]; then
  MYSQL_AUTH+=("-p${DBPASS}")
fi

if "$MYSQLADMIN" "${MYSQL_AUTH[@]}" ping >/dev/null 2>&1; then
  echo "Local MySQL already running on ${DBHOST}:${DBPORT}"
else
  for file in "$RUN_DIR/mysql.pid" "$RUN_DIR/mysql.sock" "$RUN_DIR/mysql.sock.lock"; do
    if [ -e "$file" ]; then
      unlink "$file"
    fi
  done

  setsid "$MYSQLD" \
    --mysqlx=0 \
    --datadir="$DATA_DIR" \
    --socket="$RUN_DIR/mysql.sock" \
    --port="$DBPORT" \
    --bind-address="$DBHOST" \
    --pid-file="$RUN_DIR/mysql.pid" \
    --log-error="$LOG_DIR/mysql.log" \
    >/dev/null 2>&1 &

  for _ in $(seq 1 30); do
    if "$MYSQLADMIN" "${MYSQL_AUTH[@]}" ping >/dev/null 2>&1; then
      echo "Local MySQL started on ${DBHOST}:${DBPORT}"
      break
    fi
    sleep 1
  done

  if ! "$MYSQLADMIN" "${MYSQL_AUTH[@]}" ping >/dev/null 2>&1; then
    echo "Local MySQL did not become ready. Check $LOG_DIR/mysql.log" >&2
    exit 1
  fi
fi

TABLE_COUNT="$("$MYSQL" "${MYSQL_AUTH[@]}" "$DBNAME" -N -B -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();" 2>/dev/null || echo 0)"

if [ "$TABLE_COUNT" = "0" ] && [ -f "$IMPORT_SQL" ]; then
  echo "Importing local schema into $DBNAME"
  "$MYSQL" "${MYSQL_AUTH[@]}" "$DBNAME" < "$IMPORT_SQL"
fi

ensure_column() {
  local table="$1"
  local column="$2"
  local definition="$3"
  local exists

  exists="$("$MYSQL" "${MYSQL_AUTH[@]}" "$DBNAME" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}' AND column_name = '${column}';")"

  if [ "$exists" = "0" ]; then
    echo "Adding missing column ${table}.${column}"
    "$MYSQL" "${MYSQL_AUTH[@]}" "$DBNAME" -e \
      "ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition};"
  fi
}

ensure_column "admin" "tokenVersion" "INT NOT NULL DEFAULT 0"
ensure_column "user" "tokenVersion" "INT NOT NULL DEFAULT 0"
