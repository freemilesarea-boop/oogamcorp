# OOGAM 구현 현황

기준일: 2026-11-06 (2차: 보안 강화·스테이징 검증 반영) · 판정 기준: **IMPLEMENTED**(API+UI+테스트로 검증) / **PARTIAL**(핵심 동작하나 일부 미구현) / **SCAFFOLDED**(구조만) / **NOT_STARTED** / **BLOCKED**(외부 승인·자원 필요)

## 검증 결과 요약
| 항목 | 결과 |
|---|---|
| TypeScript (shared / api / web, strict) | 통과 |
| ESLint (api / web) | 오류 0 (경고 2: next 기본 규칙 스타일 경고) |
| Shared 단위 테스트 (Vitest) | 8/8 통과 |
| Web 단위 테스트 (Vitest, 마크다운 렌더러) | 3/3 통과 |
| 보안 회귀 (`test/security.e2e-spec.ts`) | 21/21 — MFA·우회·초대 토큰 큐·세션/CSRF/권한·로그인 레이트 리밋 |
| 업로드 보안 (`test/files-security.e2e-spec.ts`) | 27/27 |
| API 테스트 (Jest: 통합 12개 스위트 + 단위 4개, 실제 PostgreSQL·Redis) | **246/246 통과** (1차 149 → 보안·업로드·MFA 회귀 추가) |
| E2E (Playwright, 실제 production 빌드 + API + PostgreSQL) | **24/24 통과** (MFA UI 흐름, 보안 헤더, CSP 위반 0건 추가) |
| Web production build (`next build`) | 성공 (45 라우트) |
| API build (`nest build`) | 성공 (main / collab / worker) |
| collab 서버 / worker 기동 | 기동 확인, worker 작업(유지보수·마감 알림) 실행 확인 |
| Docker Compose 설정 (`docker compose config`) | 개발·운영 모두 유효 |
| Docker 이미지 빌드 | 성공 (api 555MB, web 449MB) — 2차 검증 |
| Docker 스테이징 기동 (8개 서비스) | 성공, healthcheck·프록시 경유 통신·재시작 영속성 확인 — DEPLOYMENT.md §3-1 |
| 백업 → 복원 | 로컬 pg_dump 백업을 별도 DB 에 복원, 행 수 일치 확인 |
| 디자인·사용성 검수 | 실시 — 3개 뷰포트 스크린샷 61장(`docs/screenshots/`), 칸반 드래그·에디터 슬래시 블록·모바일 메뉴·키보드 실사용 확인, axe serious/critical 25→0 |

## Phase 1 — Repository & Infrastructure
| 기능 | 상태 | 비고 |
|---|---|---|
| pnpm 모노레포 (apps/web, apps/api, packages/shared) | IMPLEMENTED | |
| Prisma 스키마 + 마이그레이션 + 멱등 시드 | IMPLEMENTED | UUID PK, FK, 인덱스, unique, 소프트 삭제, 조직 격리 |
| 환경 기반 설정 / 개발·스테이징·운영 분리 | IMPLEMENTED | 운영에서 필수 env 누락 시 기동 거부 |
| 구조화 로깅 (pino, 요청 ID, 민감 헤더 redaction) | IMPLEMENTED | |
| 헬스 체크 (live / DB·Redis readiness) | IMPLEMENTED | |
| Dockerfile (api 공용 이미지 / web standalone) | IMPLEMENTED | 이미지 빌드 검증. 사설 CA 빌드 시크릿 지원 |
| docker-compose.yml / docker-compose.production.yml (+ staging 오버레이) | IMPLEMENTED | 스테이징 오버레이로 실제 기동·재시작 영속성 검증, DB/Redis 내부망 전용 확인 |
| Nginx reverse proxy (HTTPS-ready) | PARTIAL | HTTP 경유 라우팅·WebSocket(/collab) 검증. 443/인증서는 미검증(승인 필요) |
| 백업/복구 스크립트 | IMPLEMENTED | 로컬 스크립트로 복원 검증. Docker 버전 스크립트는 문법만 검증 |
| CI (GitHub Actions) | SCAFFOLDED | 워크플로 작성, 원격 실행 미확인 |
| 운영 배포 / DNS / 인증서 / 방화벽 | BLOCKED | 별도 승인 필요 (DEPLOYMENT.md) |

## Phase 2 — Corporate Website
| 기능 | 상태 | 비고 |
|---|---|---|
| 디자인 시스템 (블랙·화이트 토큰, 타이포, 그리드, 다크모드) | IMPLEMENTED | |
| 공개 레이아웃 (스티키 헤더, 모바일 전체화면 메뉴, CMS 기반 푸터) | IMPLEMENTED | |
| 메인 9개 섹션 (Hero~Footer) | IMPLEMENTED | Hero 카피 CMS 관리 |
| /about /business /brands /brands/[slug] /portfolio /news /news/[slug] /careers /careers/[slug] /contact /privacy /terms | IMPLEMENTED | 게시 콘텐츠만 노출, 없으면 빈 상태 |
| 문의 접수 (동의, 허니팟, IP 해시, 레이트 리밋, 담당자 알림) | IMPLEMENTED | 10분 제한은 테스트 환경에서 완화되어 자동 테스트 미포함 |
| SEO (메타데이터, OG, sitemap.xml, robots.txt) | IMPLEMENTED | |
| 브랜드 후보 (듣다, Louver, 247Streams, 콘텐츠 제작·교육) | IMPLEMENTED | DRAFT 등록, 관계 메모 있는 브랜드는 게시 시 확인 절차 |
| 회사 소개·약관 실제 문안 | BLOCKED | 임시 문구 — 회사·법무 확정 필요 |

## Phase 3 — Admin Foundation
| 기능 | 상태 | 비고 |
|---|---|---|
| 로그인/로그아웃, Argon2id, 서버 세션, HttpOnly/Secure/SameSite 쿠키 | IMPLEMENTED | |
| CSRF (세션 바인딩 토큰) + Origin 검사 | IMPLEMENTED | |
| 로그인 시도 제한 (계정 잠금 + IP 제한) | IMPLEMENTED | Throttler 저장소 인메모리(단일 인스턴스) |
| 세션 만료(절대/유휴), 비밀번호 변경(타 세션 폐기), 세션 목록·폐기 | IMPLEMENTED | |
| 초대 기반 계정 생성 (공개 가입 없음) | IMPLEMENTED | SMTP 미설정 시 초대 링크 1회 표시 |
| RBAC (5개 역할, OWNER≠EXECUTIVE) + 권한 매트릭스 UI | IMPLEMENTED | 서열 규칙, 마지막 OWNER 보호 |
| 리소스별 접근 제어 (프로젝트/문서/DB/결재/일정/파일) | IMPLEMENTED | API·파일 다운로드·공동 편집 연결 모두 서버 검증 |
| 모듈 권한 명시 부여 (사용자/부서, 만료) | IMPLEMENTED | |
| MFA (TOTP: 등록·검증·해제·복구 코드·관리자 초기화) | IMPLEMENTED | 미완료 세션 API·공동 편집 차단, OWNER/EXECUTIVE 필수 정책(운영 기본) |
| CSP (웹 nonce + strict-dynamic, API default-src 'none', 다운로드 sandbox) | IMPLEMENTED | 주요 화면 위반 0건 E2E 검증 |
| 로그 민감정보 보호 | IMPLEMENTED | 실측 점검 후 URL 쿼리 마스킹 추가 |
| 관리자 레이아웃 (접이식 사이드바, 검색, 알림 센터, 프로필, Breadcrumb, 다크모드, 반응형, 단축키) | IMPLEMENTED | |
| 대시보드 | IMPLEMENTED | 재무 카드는 finance.read 보유 시만 |
| 직원 관리 (목록, 상세, 역할/부서 변경, 비활성화, 활동) | IMPLEMENTED | |

## Phase 4 — Collaboration
| 기능 | 상태 | 비고 |
|---|---|---|
| 문서 CRUD, 계층, 이동/정렬, 자동 저장(버전 충돌 409), 검색, 템플릿, 복제, 휴지통, 권한, 버전 기록·복원 | IMPLEMENTED | |
| 블록 에디터 (Paragraph, H1~3, 목록, 체크리스트, 인용, 구분선, 코드, 표, 이미지, 파일, 링크, Toggle, Callout, 슬래시 메뉴) | IMPLEMENTED | 브라우저 수동 사용성 검수 미실시 |
| 문서 트리 드래그 정렬 | PARTIAL | 컨텍스트 메뉴 이동(위/아래/맨 위) 방식, 드래그 앤 드롭 아님 |
| 문서 본문 내 @멘션 | NOT_STARTED | 댓글 멘션은 구현됨 |
| 댓글 (스레드, 멘션 알림, 해결) | IMPLEMENTED | 문서·업무·프로젝트·DB 행 대상 |
| 프로젝트 (설명, 부서, 관리자, 멤버, 기간, 상태, 우선순위, 진행률 자동계산, 마일스톤, 관련 문서, 예산 연결, 활동 로그) | IMPLEMENTED | |
| 업무 (복수 담당자, 하위 업무, 상태, 우선순위, 마감, 댓글, 첨부, 체크리스트, 관련 문서, 의존관계, 변경 이력) | IMPLEMENTED | |
| 프로젝트별 사용자 정의 상태 | IMPLEMENTED | |
| 프로젝트 뷰: List / Kanban / Calendar / Timeline | IMPLEMENTED | |
| Gantt | NOT_STARTED | 후속 단계 (화면에 표시) |
| 파일 (로컬/S3 드라이버, 매직바이트 판별, 위험 형식 차단, 다운로드 권한 재검사) | PARTIAL | S3 실제 버킷 연동 미검증 |
| 악성코드 검사 (ClamAV, fail-closed 정책) | IMPLEMENTED | 스테이징에서 실제 clamd 탐지 확인. 서명 자동 갱신은 이 환경 네트워크 차단으로 미검증 |
| 인앱 알림 (배정, 멘션, 결재, 공지, 마감) | IMPLEMENTED | |
| 이메일 알림 | BLOCKED | 코드 구현(nodemailer), SMTP 설정·승인 필요 |

## Phase 5 — Advanced Workspace
| 기능 | 상태 | 비고 |
|---|---|---|
| 사용자 정의 DB (11개 속성 타입, 셀 스키마 검증, 타입 변환) | IMPLEMENTED | |
| 뷰: Table / Board / Calendar / List / Gallery, 필터·정렬·그룹·저장 뷰·개인 설정 | IMPLEMENTED | Board 그룹은 SELECT 속성만 |
| Timeline 뷰 | NOT_STARTED | |
| CSV 가져오기/내보내기 (수식 주입 방지) | IMPLEMENTED | |
| Formula / Rollup | SCAFFOLDED | enum·평가기 인터페이스만, 생성 시 400 |
| FILE 셀 표시 | PARTIAL | 파일명 대신 개수 표시 |
| 대용량 DB 필터 성능 | PARTIAL | 필터/정렬이 서버 메모리 처리 — 수천 행 규모 적합 |
| 실시간 공동 편집 (Yjs + Hocuspocus, 쿠키 인증, Origin 검사, 읽기 전용, 저장·스냅샷·업데이트 로그) | IMPLEMENTED | WebSocket 클라이언트로 동기화·저장 확인. 열린 연결에서 세션 폐기 재검사는 미구현 |
| 문서 이력 (스냅샷, 복원) | IMPLEMENTED | |
| 캘린더 (일정, 참석자, 응답, 비공개, 업무 마감 표시) | IMPLEMENTED | |
| 반복 일정 | SCAFFOLDED | RRULE 저장만, 전개 미구현 |
| 통합 검색 (권한 인지) | IMPLEMENTED | ILIKE 기반, pg_trgm 미도입 |

## Phase 6 — Business Operations
| 기능 | 상태 | 비고 |
|---|---|---|
| 예산 (연간/분기, 부서/프로젝트/사업 구분, 항목, 승인 금액 ↔ 집행 분리, 잔여) | IMPLEMENTED | |
| 매출·지출 거래 (부가세, 증빙, 배분, 승인/반려, 직무 분리, CSV) | IMPLEMENTED | 내부 관리용 표시 |
| 재무 대시보드 (총매출·지출, 집행률, 사업별, 월별, 프로젝트별, 미승인) | IMPLEMENTED | |
| 전자결재 (유형, 결재선, 승인/반려/보완/재상신/취소, 이력, 첨부, 알림, 연결) | IMPLEMENTED | |
| 결재 동시성 (트랜잭션 + 낙관적 잠금, 중복 승인 방지) | IMPLEMENTED | 동시 승인 테스트로 검증 |
| 부서 (계층, 관리자, 배정) | IMPLEMENTED | |
| 민감 인사정보 (급여) 별도 권한 | IMPLEMENTED | EXECUTIVE 기본 비공개 |
| 공지 (전사/부서/프로젝트, 읽음 상태) | IMPLEMENTED | |
| 감사 로그 조회 | IMPLEMENTED | |

## Phase 7 — Quality & Documentation
| 기능 | 상태 | 비고 |
|---|---|---|
| 자동화 테스트 (단위·통합·E2E) | IMPLEMENTED | 위 요약 참조 |
| 보안 검토 | PARTIAL | SECURITY.md 에 설계·제한 사항 정리, 외부 침투 테스트 미실시 |
| 문서 (README, ARCHITECTURE, DATABASE, API, SECURITY, DEPLOYMENT, ROADMAP) | IMPLEMENTED | |

## Preview (대표 검수용) 환경
| 기능 | 상태 | 비고 |
|---|---|---|
| Preview 빌드 모드(검색 차단·가상 데이터 배지) | IMPLEMENTED | `NEXT_PUBLIC_SITE_MODE=preview` |
| Preview 인프라(Basic 인증·HTTPS·noindex, 별도 Docker 프로젝트) | IMPLEMENTED | `docker-compose.preview.yml`, `infra/preview/` |
| 가상 데모 데이터 자동 생성(API 경유) | IMPLEMENTED | `infra/preview/seed-demo.mjs` |
| Preview E2E | IMPLEMENTED | 19/19 통과 (docs/PREVIEW.md) |
| 외부 공개 URL(서버·DNS·정식 인증서) | BLOCKED | 서버 생성·DNS·비용 승인 필요 |

## 2차 작업에서 해결된 이슈
- 초대 토큰 원문이 Redis 작업 데이터에 저장되던 문제 → AES-256-GCM 암호문만 저장 (테스트로 원문 0건 확인)
- CSP 미적용 → 웹/API/다운로드 모두 적용
- **(중대) `.gitignore`/`.dockerignore` 의 `storage/` 패턴이 `apps/api/src/common/storage/` 소스를 제외** → 1차 푸시본은 새 클론에서 빌드 불가였음. 패턴 수정 후 커밋
- `nest build` 증분 캐시로 `dist` 가 비어 버리는 문제 → 빌드 설정에서 incremental 비활성
- URL 쿼리의 토큰/비밀번호가 API 로그에 기록되던 문제 → 마스킹
- 공개 사이트 데이터 캐시(stale-while-revalidate)로 게시 취소된 콘텐츠가 재시작 후에도 노출되던 문제 → CMS 조회 캐시 제거(no-store)
- 관리자 테마 스크립트가 CSP 에 차단되던 문제 → nonce 전달
- HTTP 스테이징에서 `upgrade-insecure-requests` 가 리소스를 깨뜨리던 문제 → HTTPS 요청에서만 적용
- 키보드 포커스 비가시(다크 영역), 모바일 드로어 포커스 누출, 탭 가로 넘침, 명도 대비 등 UI·접근성 문제

## 알려진 이슈 / 후속 조치
1. 레이트 리밋 인메모리 저장소 (다중 인스턴스 시 Redis 저장소 필요)
2. 스타일 CSP `'unsafe-inline'`, 외부 폰트 CDN(jsdelivr) 의존 — 자체 호스팅 권장
3. ClamAV 서명 자동 갱신 미검증 (운영 서버에서 freshclam 성공 확인 필요)
4. 칸반은 마우스 드래그만 지원 (키보드 사용자는 업무 패널에서 상태 변경)
5. 이미 열린 공동 편집 연결은 세션 폐기 후 즉시 끊기지 않음
6. 문서 트리/검색이 요청마다 조직 전체 페이지 권한을 계산 (대규모 시 최적화 필요)
7. CMS 페이지 SEO 필드는 초안 없이 즉시 반영
8. 파일 삭제 시 객체 삭제 실패는 로그만 남김 (정리 배치 없음)
9. 결재 번호 연도는 서버 로컬 시간 기준
