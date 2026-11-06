#!/usr/bin/env bash
# OOGAM DB 복구 스크립트. 사용: ./infra/scripts/restore.sh backups/db-YYYYMMDD-HHMMSS.sql.gz
# 주의: 대상 DB 의 기존 데이터를 덮어씁니다. 운영 복구 전 반드시 현재 상태를 백업하세요.
set -euo pipefail
cd "$(dirname "$0")/../.."
FILE="${1:?백업 파일 경로를 지정하세요}"
COMPOSE="docker compose -f docker-compose.production.yml --env-file ${ENV_FILE:-.env.production}"
read -r -p "정말 '$FILE' 로 데이터베이스를 복구할까요? (yes 입력) " ok
[ "$ok" = "yes" ] || { echo "취소"; exit 1; }
$COMPOSE stop api collab worker web
$COMPOSE exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
gunzip -c "$FILE" | $COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q'
$COMPOSE up -d api collab worker web
echo "[restore] 완료"
