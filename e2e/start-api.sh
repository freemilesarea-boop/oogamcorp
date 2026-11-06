#!/usr/bin/env bash
# E2E 전용 API 기동: oogam_e2e DB 에 마이그레이션 적용 → 테이블 비우기 → 시드 → 실행
# 안전장치: DB 이름이 _e2e 로 끝나지 않으면 중단한다.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"
export NODE_ENV=development
export DATABASE_URL="${E2E_DATABASE_URL}"
DB_NAME="$(echo "${DATABASE_URL%%\?*}" | sed 's#.*/##')"
case "$DB_NAME" in *_e2e) ;; *) echo "E2E DB 이름이 _e2e 로 끝나야 합니다: $DB_NAME" >&2; exit 1 ;; esac
export SEED_OWNER_EMAIL=owner@e2e.oogam
export SEED_OWNER_PASSWORD='E2eOwnerPassw0rd'
export SWAGGER_ENABLED=false
export LOG_LEVEL=warn
export STORAGE_LOCAL_DIR=./.e2e-storage
npx prisma migrate deploy >/dev/null
node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const t = await p.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname=${"public"} AND tablename <> ${"_prisma_migrations"}`;
  await p.$executeRawUnsafe("TRUNCATE " + t.map((x) => `"${x.tablename}"`).join(", ") + " RESTART IDENTITY CASCADE");
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });'
npx tsx prisma/seed.ts >/dev/null
exec node dist/main.js
