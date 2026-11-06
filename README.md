# OOGAM Platform

**OOGAM 공식 기업 홈페이지(oogam.co.kr) + 사내 전용 협업 워크스페이스**를 하나로 통합한 모듈형 모놀리스 코드베이스입니다.

- 공개 홈페이지: `/`, `/about`, `/business`, `/brands`, `/portfolio`, `/news`, `/careers`, `/contact`, `/privacy`, `/terms`
- 사내 워크스페이스: `/admin` (대시보드, 내 업무, 프로젝트, 문서, 데이터베이스, 캘린더, 전자결재, 재무, 직원, 부서, 공지, 파일, 홈페이지 CMS, 설정)
- REST API: `/api/v1` (Swagger: `/api/docs`, 개발 환경)

| 영역 | 기술 |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript strict, Tailwind CSS 4, shadcn/ui 패턴(Radix), Lucide, TanStack Query 5, React Hook Form, Zod |
| Backend | NestJS 11, REST + OpenAPI, Prisma 6, PostgreSQL 16, Redis 7, BullMQ |
| Collaboration | Tiptap 2, Yjs, Hocuspocus 2 |
| Infra | Docker Compose(개발/운영), Nginx reverse proxy(HTTPS-ready), S3 호환 스토리지, pino 구조화 로그, 헬스체크, 백업 스크립트 |
| Test | Jest + Supertest(API 통합, 실제 PostgreSQL), Vitest(공유 유틸), Playwright(E2E) |

문서: [ARCHITECTURE](./ARCHITECTURE.md) · [DATABASE](./DATABASE.md) · [API](./API.md) · [SECURITY](./SECURITY.md) · [DEPLOYMENT](./DEPLOYMENT.md) · [ROADMAP](./DEVELOPMENT_ROADMAP.md) · [IMPLEMENTATION_STATUS](./IMPLEMENTATION_STATUS.md)

## 로컬 실행

### 요구 사항
Node.js 22+, pnpm 10+, PostgreSQL 16, Redis 7 (또는 Docker로 `docker compose up -d`)

### 1) 설치 및 환경 설정
```bash
pnpm install
cp .env.example .env
```
`.env` 에서 `DATABASE_URL`, `REDIS_URL`, `SEED_OWNER_PASSWORD` 등을 로컬 환경에 맞게 수정합니다.
Docker 로 DB/Redis 를 띄우는 경우 `.env` 의 비밀번호를 compose 기본값과 맞추세요.
```bash
docker compose up -d            # PostgreSQL + Redis (S3 테스트: docker compose --profile s3 up -d)
```

### 2) DB 마이그레이션 + 시드
```bash
pnpm build:shared
pnpm db:deploy                  # 또는 개발 중 스키마 변경 시 pnpm db:migrate
pnpm db:seed                    # 조직·역할·권한·최고관리자·CMS 초기 콘텐츠 (멱등)
```
`SEED_OWNER_PASSWORD` 를 비워두면 임시 비밀번호가 생성되어 콘솔에 1회 출력됩니다.

### 3) 개발 서버
```bash
pnpm dev                        # API(:4000) + Web(:3000)
pnpm dev:collab                 # (선택) 실시간 공동 편집 서버 :4001
pnpm dev:worker                 # (선택) 알림/정리 워커
```
- 홈페이지: http://localhost:3000
- 워크스페이스: http://localhost:3000/admin (시드한 최고관리자 계정으로 로그인)
- Swagger: http://localhost:4000/api/docs

### 4) 빌드 / 프로덕션 실행
```bash
pnpm build
pnpm --filter @oogam/api start        # dist/main.js
pnpm --filter @oogam/web start
```

## 테스트
```bash
pnpm typecheck                         # 전 패키지 TypeScript 검사
pnpm lint                              # ESLint
pnpm --filter @oogam/shared test       # 공유 유틸 단위 테스트 (Vitest)
pnpm --filter @oogam/api test          # API 통합 테스트 (oogam_test DB 필요, 실행 시 초기화됨)
pnpm build && pnpm test:e2e            # Playwright E2E (oogam_e2e DB 를 초기화하고 API/Web 을 직접 기동)
```
API 통합 테스트는 `TEST_DATABASE_URL`(기본 `.../oogam_test`) 을 **매 스위트마다 TRUNCATE** 합니다. 운영/개발 DB 를 지정하지 마세요.

## 디렉터리
```
apps/api        NestJS API + collab(Hocuspocus) + worker(BullMQ), Prisma
apps/web        Next.js 공개 사이트 + 관리자 워크스페이스
packages/shared 역할/권한 카탈로그, 금액 유틸, 라벨
infra           Dockerfile, nginx, 백업/복구 스크립트
e2e             Playwright 시나리오
```

## 주의
- 외부 공개 회원가입은 없습니다. 직원 계정은 관리자 초대(`/admin/employees`)로만 생성됩니다.
- 재무 모듈은 **내부 관리용**이며 법정 회계·세무 시스템을 대체하지 않습니다.
- 브랜드 후보(듣다, Louver, 247Streams, 콘텐츠 제작·교육)는 법인 관계 확인 전까지 DRAFT 로만 등록되어 있습니다.
- 운영 DNS 변경, 인증서 발급, 실제 이메일 발송, 운영 배포는 별도 승인 후 진행합니다.
