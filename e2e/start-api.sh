#!/usr/bin/env bash
# E2E 전용 API 기동: 깨끗한 oogam_e2e DB 로 마이그레이션 + 시드 후 실행
set -euo pipefail
cd "$(dirname "$0")/../apps/api"
export NODE_ENV=development
export DATABASE_URL="${E2E_DATABASE_URL}"
export SEED_OWNER_EMAIL=owner@e2e.oogam
export SEED_OWNER_PASSWORD='E2eOwnerPassw0rd'
export SWAGGER_ENABLED=false
export LOG_LEVEL=warn
export STORAGE_LOCAL_DIR=./.e2e-storage
npx prisma migrate reset --force --skip-seed --skip-generate >/dev/null
npx tsx prisma/seed.ts >/dev/null
exec node dist/main.js
