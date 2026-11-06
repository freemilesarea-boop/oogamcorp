# OOGAM 아키텍처

## 1. 개요
OOGAM 플랫폼은 **공식 기업 홈페이지(oogam.co.kr)** 와 **사내 전용 협업 워크스페이스(/admin)** 를 하나의 코드베이스로 운영하는 **모듈형 모놀리스**입니다. 단일 기업(OOGAM) 내부용이며 상용 SaaS(멀티테넌트 과금)가 아닙니다. 다만 모든 업무 데이터에 `organizationId` 를 두어 조직 간 데이터 격리 구조를 유지합니다.

```
                ┌────────────── Reverse Proxy (Nginx, 80/443) ───────────────┐
 Browser ──────►│  /            → web (Next.js 15, SSR/ISR 공개 사이트 + /admin SPA) │
                │  /api/*       → api (NestJS 11 REST /api/v1, Swagger)            │
                │  /collab      → collab (Hocuspocus WebSocket, Yjs)               │
                └───────────────────────────────────────────────────────────────┘
                         │ API_INTERNAL_URL           │                 │
                         ▼                            ▼                 ▼
                 ┌──────────────┐   BullMQ    ┌──────────────┐   ┌──────────────┐
                 │  api         │────────────►│  worker      │   │ collab       │
                 └──────┬───────┘   (Redis)   └──────┬───────┘   └──────┬───────┘
                        │                            │                  │
                 ┌──────▼────────────────────────────▼──────────────────▼──────┐
                 │ PostgreSQL 16 (Prisma)   Redis 7 (큐/레이트리밋)   S3 호환 저장소 │
                 └──────────────────────────────────────────────────────────────┘
```

| 프로세스 | 소스 | 역할 |
|---|---|---|
| web | `apps/web` | 공개 홈페이지(서버 컴포넌트, `/api/v1/public/*` 호출, 60초 ISR) + 관리자 워크스페이스(클라이언트 컴포넌트, TanStack Query) |
| api | `apps/api/src/main.ts` | REST API `/api/v1`, 인증·권한·비즈니스 로직, Swagger `/api/docs` |
| collab | `apps/api/src/collab.ts` | 문서 실시간 공동 편집 (Hocuspocus + Yjs), 세션 쿠키 인증, 페이지 권한 검사 |
| worker | `apps/api/src/worker.ts` | BullMQ 작업: 이메일 알림(SMTP 설정 시), 마감 알림, 세션/초대 정리 |

api / collab / worker 는 **같은 코드베이스·같은 이미지**를 사용하고 실행 명령만 다릅니다(모놀리스이지만 프로세스 분리 가능).

## 2. 저장소 구조
```
oogam/
├─ apps/
│  ├─ api/                 NestJS (REST + collab + worker)
│  │  ├─ prisma/           schema.prisma, migrations/, seed.ts
│  │  ├─ src/
│  │  │  ├─ common/        prisma, redis, auth(세션·CSRF·RBAC 가드), audit, activity, notify, queue, storage, dto, filters, utils
│  │  │  ├─ config/        환경 기반 설정 (configuration.ts, env-loader.ts)
│  │  │  ├─ modules/       기능 모듈 (아래 표)
│  │  │  ├─ main.ts / collab.ts / worker.ts
│  │  └─ test/             API 통합 테스트 (supertest + 실제 PostgreSQL)
│  └─ web/                 Next.js 15 App Router
│     └─ src/
│        ├─ app/(site)/    공개 홈페이지 라우트
│        ├─ app/admin/     로그인/초대 수락 + (workspace) 관리자 라우트
│        ├─ components/    ui(shadcn 패턴), admin(셸·공통 상태), site(공개 사이트)
│        ├─ features/      기능별 UI·훅 (projects, docs, databases, finance, cms …)
│        └─ lib/           api 클라이언트(CSRF 자동 첨부), auth 컨텍스트, 유틸
├─ packages/shared/        역할·권한 카탈로그, 금액(Decimal) 유틸, 상태 라벨, 슬러그
├─ infra/                  Dockerfile, nginx, 백업/복구 스크립트
├─ e2e/                    Playwright E2E
└─ docker-compose.yml / docker-compose.production.yml
```

## 3. API 모듈 계층
각 모듈은 `Controller → Service → (Repository) → Prisma` 로 분리하고 DTO(class-validator)로 입력을 검증합니다.

| 모듈 | 경로 | 비고 |
|---|---|---|
| auth | `/auth` | 로그인/로그아웃/세션/비밀번호 변경/초대 수락 |
| employees, teams, directory | `/employees`, `/departments`, `/directory` | 직원·부서·초대, 민감 인사정보 분리 |
| workspaces, documents, comments | `/workspaces`, `/documents`, `/comments` | 노션형 문서, 버전, 휴지통, 댓글·멘션 |
| databases | `/databases` | 사용자 정의 DB, 속성 스키마 검증, 뷰, CSV |
| projects | `/projects`, `/tasks` | 프로젝트·업무·마일스톤·사용자 정의 상태·의존관계 |
| calendar, search | `/calendar`, `/search` | 일정·참석자, 권한 인지 통합 검색 |
| approvals | `/approvals` | 전자결재(트랜잭션 + 낙관적 잠금) |
| finance | `/finance` | 예산(승인)·거래·집행(배분)·대시보드 |
| cms, public-site | `/cms`, `/public` | CMS(게시 워크플로) / 공개 사이트 전용 읽기 API |
| files, notifications, announcements | `/files`, `/notifications`, `/announcements` | 저장소 추상화(local/S3) |
| settings, audit-logs, dashboard, health | … | 역할·권한 매트릭스, 리소스 부여, 감사 로그 |
| access (EntityAccessService) | (내부) | 교차 모듈 엔터티 접근 판단의 단일 진실 원천 |

## 4. 요청 처리 파이프라인 (api)
1. `helmet`, `cookie-parser`, `trust proxy`, 구조화 로깅(pino, 요청 ID, 쿠키/CSRF 헤더 redaction)
2. **ThrottlerGuard** (전역, 로그인/문의 등은 더 엄격)
3. **AuthGuard** (전역): Origin 검사 → 세션 쿠키 해석(DB 세션, 유휴·절대 만료) → CSRF 동기화 토큰 검사 → `@RequirePermissions` 검사
4. ValidationPipe (whitelist + forbidNonWhitelisted + transform)
5. 서비스 계층에서 **리소스 단위 접근 검사**(프로젝트 멤버십, 문서 공개 범위·부여, 결재선 등) + `organizationId` 범위 제한
6. 감사 로그(AuditService) / 활동 이력(ActivityService) / 알림(NotifyService → BullMQ)
7. Prisma 예외 필터 (내부 SQL 노출 방지)

## 5. 프런트엔드 구조
- 공개 사이트: 서버 컴포넌트 + `publicFetch`(게시된 콘텐츠만, ISR 60초). API 장애 시 빈 상태를 렌더링하며 가짜 데이터로 대체하지 않습니다.
- 관리자: `middleware.ts` 가 세션 쿠키 없으면 로그인으로 리다이렉트(UX), 실제 권한은 API 가 강제. `AdminShell` 이 `/auth/me` 로 권한 목록을 받아 메뉴 표시를 조정합니다.
- 브라우저는 항상 동일 출처 `/api/v1` 로 호출(Next rewrites 또는 Nginx) → 쿠키가 1st-party, SameSite 정책 유지.

## 6. 실시간 공동 편집 설계
- 문서명 `page:<uuid>`, Hocuspocus `onAuthenticate` 에서 세션 쿠키 → 세션 해석 → 페이지 접근 수준 계산(EDIT 미만이면 읽기 전용, 접근 불가면 거부).
- 저장: Yjs 상태(`pages.yState`) + ProseMirror JSON(`pages.content`) + 검색용 평문 동시 갱신, 증분 업데이트 로그(`page_updates`), 주기적 스냅샷(`page_snapshots`, reason=COLLAB).
- 재연결/충돌: Yjs CRDT 가 병합하며, 클라이언트 프로바이더가 자동 재연결 후 상태 벡터 동기화. 서버 재시작 시 `yState` 로 복구, 손상 시 최신 스냅샷에서 복원.
- 협업 서버가 없을 때는 REST 자동 저장(낙관적 버전 검사, 409 충돌 감지)으로 동작합니다.

## 7. 확장 포인트
- MFA: `users.mfaEnabled/mfaSecretEnc`, `sessions.mfaVerified` 필드와 로그인 응답의 `mfaRequired` 로 TOTP 단계 추가 가능
- Formula/Rollup: `DbPropertyType.FORMULA/ROLLUP` enum 예약, 평가기 인터페이스로 확장
- Gantt/Timeline 고도화, 반복 일정(RRULE 저장됨), 전문 검색(pg_trgm/외부 엔진)
- 서비스 분리: 모듈 경계(서비스 주입 + EntityAccessService)를 유지하면 collab/worker 처럼 독립 배포 가능
