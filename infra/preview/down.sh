#!/usr/bin/env bash
# OOGAM Preview 종료.
#   ./infra/preview/down.sh           컨테이너 중지·삭제 (데이터 볼륨 유지 → up.sh 로 재개)
#   ./infra/preview/down.sh --purge   컨테이너 + Preview 데이터 볼륨 + .preview 비밀값까지 완전 삭제
set -euo pipefail
cd "$(dirname "$0")/../.."
DIR="$(pwd)/.preview"
export PREVIEW_DIR="$DIR"
ENVF="$DIR/preview.env"; [ -f "$ENVF" ] || ENVF=/dev/null
COMPOSE=(docker compose -p oogam-preview -f docker-compose.production.yml -f docker-compose.preview.yml --env-file "$ENVF")
if [ "${1:-}" = "--purge" ]; then
  "${COMPOSE[@]}" down -v --remove-orphans
  rm -rf -- "$DIR"
  echo "[preview] 완전 삭제: 컨테이너·볼륨(DB, 업로드, Redis)·비밀값"
else
  "${COMPOSE[@]}" down --remove-orphans
  echo "[preview] 중지 (데이터 유지). 완전 삭제: $0 --purge"
fi
