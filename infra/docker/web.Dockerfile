# syntax=docker/dockerfile:1.7
# OOGAM Web (Next.js standalone)
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
# 웹은 CMS 모드(Vercel)에서만 @oogam/api/serverless 를 런타임에 로드한다 — 설치 그래프 해석용 매니페스트만 필요
COPY apps/api/package.json apps/api/
# 사내 프록시/사설 CA 환경 빌드 시에만 선택적으로 CA 주입 (이미지에 남지 않음): --secret id=ca,src=<ca.pem>
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile --filter @oogam/web... --filter @oogam/shared
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG NEXT_PUBLIC_COLLAB_URL
# preview: 검색 차단·가상 데이터 배지 (빌드 시점 값)
ARG NEXT_PUBLIC_SITE_MODE=production
ENV NEXT_PUBLIC_SITE_MODE=$NEXT_PUBLIC_SITE_MODE
# rewrites 는 빌드 시점에 평가된다 (운영에서는 Nginx 가 /api 를 직접 api 로 라우팅)
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NEXT_PUBLIC_COLLAB_URL=$NEXT_PUBLIC_COLLAB_URL
RUN pnpm --filter @oogam/shared build && pnpm --filter @oogam/web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN useradd --system --uid 1001 oogam
COPY --from=build --chown=oogam /app/apps/web/.next/standalone ./
COPY --from=build --chown=oogam /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=oogam /app/apps/web/public ./apps/web/public
USER oogam
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
