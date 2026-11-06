#!/usr/bin/env bash
# OOGAM PostgreSQL + 업로드 파일 백업 스크립트
# 사용: ./infra/scripts/backup.sh [백업 디렉터리]   (cron 예: 0 3 * * * /srv/oogam/infra/scripts/backup.sh)
# 환경: docker compose 운영 구성 기준. RETENTION_DAYS (기본 14)
set -euo pipefail
cd "$(dirname "$0")/../.."
BACKUP_DIR="${1:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE="docker compose -f docker-compose.production.yml --env-file ${ENV_FILE:-.env.production}"
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
umask 077

echo "[backup] PostgreSQL dump → $BACKUP_DIR/db-$TS.sql.gz"
$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=plain --no-owner --no-privileges' | gzip -9 > "$BACKUP_DIR/db-$TS.sql.gz"

if $COMPOSE ps api >/dev/null 2>&1; then
  echo "[backup] 로컬 업로드 파일(STORAGE_DRIVER=local 인 경우) → $BACKUP_DIR/uploads-$TS.tar.gz"
  $COMPOSE exec -T api sh -c 'tar -C /app/apps/api -czf - storage 2>/dev/null || true' > "$BACKUP_DIR/uploads-$TS.tar.gz"
fi

sha256sum "$BACKUP_DIR"/*-"$TS".* > "$BACKUP_DIR/SHA256SUMS-$TS"
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete
echo "[backup] 완료. S3 사용 시 버킷 버전관리/수명주기 정책으로 별도 보관하세요. 백업 파일은 반드시 외부(오프사이트)로 복제하세요."
