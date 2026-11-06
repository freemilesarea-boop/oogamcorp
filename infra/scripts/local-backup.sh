#!/usr/bin/env bash
# 로컬(비 Docker) 개발 DB 백업: DATABASE_URL 기준 pg_dump
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env ] && set -a && . ./.env && set +a
mkdir -p backups
OUT="backups/local-db-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump "${DATABASE_URL%%\?*}" --no-owner --no-privileges | gzip -9 > "$OUT"
echo "[backup] $OUT"
