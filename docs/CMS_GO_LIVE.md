# OOGAM 홈페이지 CMS 운영 전환 가이드

현재 oogam.co.kr 는 **정적 홈페이지(static)** 로 운영 중이다. 이 문서는 홈페이지를 멈추지 않고 CMS 관리자 기능을 켜는 순서와,
전환 전에 끝낸 점검 결과·복구 방안을 정리한다. 비밀값(비밀번호·키)은 이 문서·Git·채팅 어디에도 적지 않는다.

## 1. 점검 결과 (전환 전 상태)

### 1-1. Supabase `oogam-cms` (ref `vhxhjgartetiizfzhqxu`, 서울 ap-northeast-2, Pro 요금제)

| 항목 | 상태 |
|---|---|
| 데이터 위치 | 전용 스키마 `oogam` (58개 테이블). `public` 스키마에는 테이블 없음 |
| 데이터 API(PostgREST)·GraphQL | `oogam` 스키마 미노출 (외부에서 anon 키로 조회 시 `PGRST106 Invalid schema`), GraphQL 비활성 — 실제 요청으로 확인 |
| RLS | `oogam` 58/58 테이블 활성화. `oogam_app` 에게만 허용 정책, 그 외 역할은 정책 없음(권한이 잘못 부여돼도 행이 보이지 않음) |
| anon / authenticated | `oogam` 스키마·테이블 권한 0건 |
| 보안 점검(Security Advisor) | 경고 0건 |
| 백업 | Pro 요금제 일일 자동 백업(7일 보관). 필요 시 PITR(시점 복구) 애드온 별도 |

### 1-2. 앱 DB 계정 `oogam_app` (최소 권한) — `infra/supabase/oogam_app_least_privilege.sql`

- 슈퍼유저·RLS 우회·역할 생성·DB 생성 권한 없음, 다른 역할 상속 없음, `oogam` 외 스키마 사용 불가, 테이블 생성(DDL) 불가.
- 접근 가능한 테이블 **23개만** (CMS 배포가 실제로 쓰는 것):

| 권한 | 테이블 |
|---|---|
| 읽기 | organizations, roles, permissions, role_permissions, departments, resource_grants, workspaces |
| 읽기·추가 (수정·삭제 불가) | audit_logs(감사 로그), cms_revisions(변경 이력) |
| 읽기·수정 | invitations (1회용 설정 링크 소비) |
| 읽기·추가·수정 (삭제는 소프트 삭제) | users, memberships, sessions, workspace_members, website_pages, website_posts, brands, portfolio_items, business_areas, cms_media |
| 읽기·추가·수정·삭제 | contact_inquiries, notifications, mfa_recovery_codes |

- **재무·인사·결재·문서·프로젝트·파일 등 사내 업무 테이블 35개에는 어떤 권한도 없음** (DB 가 `permission denied` 로 거부 — 로컬 동일 구성에서 확인).
- 비밀번호는 아직 설정되지 않음 → 지금은 로그인 자체가 불가능 (대표자가 설정, 아래 2단계).

### 1-3. 관리자 초기 계정 `ceo@oogam.co.kr`

- 존재함 · 역할 OWNER(게시 권한 포함) · **비밀번호 없음(INVITED 상태)** · MFA 미등록.
- 이전 보고의 임시 비밀번호는 **DB 에서 무효화했고, 해당 임시 파일도 삭제**했다. 그 비밀번호로는 로그인할 수 없다.
- 비밀번호는 대표자가 Supabase SQL Editor 에서 직접 발급하는 **1회용 설정 링크**로 정한다 (`infra/supabase/admin_setup_link.sql`):
  토큰은 쿼리 안에서 무작위 생성되고 DB 에는 SHA-256 해시만 저장, **2시간 만료·1회 사용**, 발급 시 기존 비밀번호·세션 즉시 무효화.
  비밀번호는 대표자 브라우저에서만 입력되며 Claude·채팅·로그를 거치지 않는다.
- 첫 로그인 시 OTP(2단계 인증) 등록이 강제된다 (OWNER·EXECUTIVE 는 MFA 필수 — 운영 기본값).

### 1-4. 운영 설정 보안 검증 (NODE_ENV=production, 최소 권한 DB 계정 + RLS, 로컬 동일 구성) — 35/35 통과

설정 링크(무효 토큰 거부·약한 비밀번호 거부·재사용 불가), 임시 비밀번호 무효, 세션 쿠키 `__Host-`·HttpOnly·Secure·SameSite=Lax,
CSRF 쿠키 Secure·SameSite=Strict, MFA 미등록 시 CMS·게시 차단(403), MFA 등록 시 비밀번호 재확인·틀린 OTP 거부, 재로그인 시 MFA 확인 전 차단(401),
로그아웃 세션 폐기, CSRF 누락·위조 403, 세션 위조 401, 게시, 공개 문의 접수 → 인앱 알림, 편집자 게시·게시중단·문의 열람 403.
그 밖에 CMS API 44/44, 브라우저 E2E 4/4, 기존 API 테스트 246/246 통과 (`docs/CMS.md` 6장).

### 1-5. Supabase Storage

| 항목 | 상태 |
|---|---|
| 버킷 | `oogam-public` 1개 — **공개 읽기**(홈페이지 이미지), 5MB 제한, `image/webp` 만 허용. 비공개 버킷 없음(필요한 비공개 파일 없음) |
| 업로드·수정·삭제 | anon·로그인 사용자 정책 없음 → **익명 업로드 거부(RLS) 실제 요청으로 확인**, 목록 조회 불가. 서버(관리자 인증·CMS 쓰기 권한 확인 후)만 secret key 로 업로드 |
| 업로드 파일 | 서버에서 형식 검사(JPG·PNG·WebP·GIF) 후 WebP 로 재인코딩·메타데이터 제거, 무작위 파일명 |

### 1-6. 사이트·관리자 접근 상태

| | 현재(static) | 전환 후(cms) |
|---|---|---|
| 공개 페이지 | 200 (샘플 스냅샷) | 200 (DB 콘텐츠 — 현재와 동일 내용으로 미리 입력됨) |
| /admin/login · /admin/accept-invite | 404 | 200 |
| /admin/cms · /admin/settings(내 계정) | 404 | 로그인 필요 |
| 재무·직원·결재·문서·권한 설정 등 | 404 | **404 유지** (배포에 기능 자체가 없음) |
| /api/v1 | 503 | auth·cms·public·notifications 만, 나머지 404 |

## 2. Vercel 환경변수 (프로젝트 `oogamcorp-web`)

| 이름 | 값 / 출처 | 비밀 | 환경 |
|---|---|---|---|
| `DATABASE_URL` | Supabase Transaction pooler 주소 (사용자 `oogam_app.vhxhjgartetiizfzhqxu`, 끝에 `?pgbouncer=true&connection_limit=1&schema=oogam`) | ● Sensitive | Production, Preview |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` — MFA 비밀키 암호화. **두 환경에 같은 값**, 바꾸면 MFA 재등록 필요 | ● | Production, Preview |
| `IP_HASH_SALT` | `openssl rand -hex 24` — 문의자 IP 해시 | ● | Production, Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key (`sb_secret_…`) — 이미지 업로드 전용 | ● | Production, Preview |
| `SUPABASE_URL` | `https://vhxhjgartetiizfzhqxu.supabase.co` | | Production, Preview |
| `MEDIA_STORAGE` | `supabase` | | Production, Preview |
| `SUPABASE_MEDIA_BUCKET` | `oogam-public` | | Production, Preview |
| `PUBLIC_SITE_URL` | `https://oogam.co.kr` | | Production, Preview |
| `WEB_ORIGINS` | `https://oogam.co.kr,https://www.oogam.co.kr` | | Production, Preview |
| `NEXT_PUBLIC_DATA_SOURCE` | `cms` — **먼저 Preview 에만**, 검증 후 Production 추가 | | Preview → Production |

설정하지 않는 것(기본값이 안전): `NEXT_PUBLIC_SITE_MODE`(비우면 Vercel 에서 검색 차단·PREVIEW 표시 유지), `MFA_REQUIRED_ROLES`(기본 OWNER,EXECUTIVE), `COOKIE_SECURE`(기본 true), `SITE_ORG_SLUG`(기본 oogam).
`NEXT_PUBLIC_*` 는 빌드 시점 값이므로 바꾼 뒤 재배포해야 적용된다. 그 외 변수 추가만으로는 정적 홈페이지에 영향이 없다.

## 3. 안전한 전환 순서 (홈페이지 무중단)

1. 비밀값 준비·Vercel 변수 입력 (`NEXT_PUBLIC_DATA_SOURCE` 는 **Preview 에만**) — 운영 사이트 영향 없음
2. 검증용 브랜치 `cms-staging` → Vercel **Preview 배포**(별도 주소, Vercel 로그인 보호)에서 CMS 모드 실제 구동
3. Preview 에서 관리자 설정 링크 → 비밀번호 설정 → MFA 등록 → CMS·이미지 업로드 확인 (운영 DB 와 같은 DB)
4. 이상 없으면 Production 에 `NEXT_PUBLIC_DATA_SOURCE=cms` 추가 → Redeploy (배포 완료 순간 전환, 그 전까지 정적 사이트 유지)
5. Claude 가 oogam.co.kr 공개 페이지·차단 상태·API 를 외부에서 재검증

## 4. 복구 방안

| 상황 | 방법 | 소요 |
|---|---|---|
| 전환 후 문제 | Vercel › Deployments › 직전 정적 Production 배포 › ⋯ › **Instant Rollback** | 수 초 (재빌드 없음) |
| 정적 모드 고정 | Production `NEXT_PUBLIC_DATA_SOURCE` 삭제(또는 `static`) → Redeploy | 2~3분 |
| 잘못 게시·수정한 콘텐츠 | CMS 각 화면 › 변경 이력 › 이전 버전 복구 → 재게시 / 게시 중단 | 즉시 |
| DB 손상·대량 삭제 | Supabase › Database › Backups 에서 일일 백업 복원 (최근 7일) | 수 분~ |
| 관리자 비밀번호·OTP 분실 | SQL Editor 에서 설정 링크 재발급(기존 비밀번호·세션 무효화). OTP 분실 시 복구 코드 사용 | 수 분 |
| 이미지 | 저장된 파일은 덮어쓰지 않음(무작위 키·업서트 금지). 라이브러리에서 숨겨도 파일은 유지 | — |

## 5. 대표자가 직접 할 일 (화면별)

### 1단계 — Supabase: 앱 DB 계정 비밀번호 설정
1. https://supabase.com/dashboard → 프로젝트 **oogam-cms** 선택
2. 왼쪽 메뉴 **SQL Editor** → **New query**
3. 비밀번호 관리자(1Password 등)에서 **영문 대소문자·숫자만 32자 이상** 비밀번호 생성 (특수문자는 연결 주소에서 오류가 날 수 있어 제외)
4. 입력 후 **Run**: `alter role oogam_app with password '생성한비밀번호';`
5. "Success" 확인 → 쿼리 내용을 지우고 탭 닫기 (저장하지 않음)

### 2단계 — Supabase: DB 연결 주소 만들기
1. 화면 상단 **Connect** 버튼 → **Connection String** 탭
2. Type **URI**, Method **Transaction pooler** 선택 → 주소 복사 (포트 **6543**)
3. 메모장에서 수정: 사용자명 `postgres.vhxhjgartetiizfzhqxu` → `oogam_app.vhxhjgartetiizfzhqxu`, `[YOUR-PASSWORD]` → 1단계 비밀번호
4. 끝에 `?pgbouncer=true&connection_limit=1&schema=oogam` 추가 → 이것이 `DATABASE_URL` (Vercel 입력 후 메모장 내용 삭제)

### 3단계 — Supabase: 이미지 업로드용 secret key
1. 왼쪽 아래 **Project Settings** → **API Keys**
2. **Secret keys** 영역 → **Create new secret key** (이름 예: `vercel-cms`) → 생성된 `sb_secret_…` 값 복사 → `SUPABASE_SERVICE_ROLE_KEY`
   (publishable key 가 아니라 **secret** key 여야 함. 유출 시 같은 화면에서 삭제 후 재발급)

### 4단계 — Mac 터미널: 암호화 키 2개 생성
1. `openssl rand -base64 32` → 출력값 = `APP_ENCRYPTION_KEY`
2. `openssl rand -hex 24` → 출력값 = `IP_HASH_SALT`

### 5단계 — Vercel: 환경변수 입력 (운영 사이트 영향 없음)
1. https://vercel.com → 프로젝트 **oogamcorp-web** → **Settings** → **Environment Variables**
2. 2장 표의 변수를 하나씩 **Add**: Key / Value 입력, 비밀(●) 4개는 **Sensitive** 켜기, Environments 는 **Production·Preview** 체크
3. `NEXT_PUBLIC_DATA_SOURCE` = `cms` 는 **Preview 만** 체크하고 저장 (Production 은 아직 체크하지 않음)
4. 저장 후 "Redeploy" 안내가 떠도 **누르지 않음** (지금은 운영 재배포 불필요)

### 6단계 — GitHub: 검증용 Preview 배포 만들기
1. https://github.com/freemilesarea-boop/oogamcorp → 브랜치 선택 메뉴 → **View all branches** → **New branch**
2. 이름 `cms-staging`, Source `claude/modest-thompson-bgzlmf` → **Create branch**
3. Vercel › **Deployments** 에 Environment **Preview** 배포가 생기고 **Ready** 가 되면 해당 배포를 열어 주소(…vercel.app) 확인
   (Preview 주소는 Vercel 에 로그인한 팀원만 열 수 있음)

### 7단계 — Supabase: 관리자 설정 링크 발급
1. SQL Editor → **New query** → GitHub 의 `infra/supabase/admin_setup_link.sql` 내용을 그대로 붙여넣기 → **Run**
2. 결과의 `setup_link` 에서 `https://oogam.co.kr` 부분을 **6단계 Preview 주소**로 바꿔 브라우저에서 열기 (2시간 이내, 1회용)
3. 쿼리 탭은 저장하지 않고 닫기

### 8단계 — Preview 주소에서 관리자 활성화·검증
1. 설정 화면에서 이름·새 비밀번호(16자 이상 권장, 영문+숫자 포함) 입력 → 로그인 화면으로 이동
2. `ceo@oogam.co.kr` + 새 비밀번호 로그인 → **2단계 인증 등록**: 휴대폰 OTP 앱(Google Authenticator 등)으로 QR 스캔 → 6자리 입력
3. **복구 코드 10개**를 비밀번호 관리자에 보관 (OTP 분실 시 필요, 다시 표시되지 않음)
4. 홈페이지 CMS › 사업 영역 · 페이지가 보이는지 확인, 아무 항목의 이미지 **업로드 1회**(이미지 저장 확인) → 그 이미지는 저장하지 않고 취소해도 됨
5. 콘텐츠를 실제로 게시하지는 않는다 (같은 DB 이므로 전환 후 그대로 공개됨)
6. 확인 결과를 Claude 에게 알림

### 9단계 — Vercel: 운영 전환 (Claude 확인 후)
1. Settings › Environment Variables › `NEXT_PUBLIC_DATA_SOURCE` 편집 → **Production** 체크 추가 → Save
2. **Deployments** → 맨 위 Production 배포 › ⋯ › **Redeploy** → Ready 될 때까지 대기 (그동안 기존 정적 사이트가 계속 서비스)
3. https://oogam.co.kr/admin/login 에서 로그인 → MFA 확인 → Claude 에게 전환 완료 알림 (외부 재검증)

### 10단계 — 정리
1. GitHub `cms-staging` 브랜치 삭제 (Branches › 휴지통 아이콘)
2. Supabase SQL Editor 에 저장된 쿼리가 있으면 삭제 (특히 설정 링크·비밀번호 쿼리)
3. 문제 발생 시: Vercel › Deployments › 직전 Production 배포 › ⋯ › **Instant Rollback**
