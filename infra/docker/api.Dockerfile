# syntax=docker/dockerfile:1.7
# OOGAM API / Collaboration / Worker 공용 이미지 (명령으로 프로세스 선택)
# Prisma 엔진에 OpenSSL(libssl3) 이 필요 → 이를 포함한 bookworm 이미지를 사용 (apt 네트워크 의존 제거)
FROM node:22-bookworm AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# 사내 프록시/사설 CA 환경 빌드 시에만 선택적으로 CA 주입 (이미지에 남지 않음): --secret id=ca,src=<ca.pem>
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile --filter @oogam/api... --filter @oogam/shared
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @oogam/shared build && pnpm --filter @oogam/api build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
RUN useradd --system --uid 1001 oogam && mkdir -p /app/apps/api/storage && chown -R oogam /app/apps/api/storage
USER oogam
WORKDIR /app/apps/api
EXPOSE 4000 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
