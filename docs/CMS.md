# OOGAM 홈페이지 CMS — 구조 · 운영 · 배포

대표자가 관리자 화면(`/admin/cms`)에서 홈페이지 전체를 직접 편집·게시하는 방법과, Vercel + Supabase 배포 구성을 정리한다.

## 1. 구조

```
브라우저 ── oogam.co.kr (Vercel, 프로젝트 oogamcorp-web, 함수 리전 icn1)
              │
              ├─ 공개 페이지 (Next.js 서버 컴포넌트) ─┐
              ├─ /admin/cms (관리자 CMS 화면)          │ 같은 함수 안
              └─ /api/v1/* ─→ NestJS(인증·CMS·공개 사이트·알림만) ─┤
                                                      ▼
                                   Supabase PostgreSQL (기존 Prisma 스키마 그대로)
                                   Supabase Storage (공개 버킷: 업로드 이미지)
```

- 백엔드 코드는 기존 NestJS 모듈을 그대로 사용한다 (`apps/api/src/serverless/index.ts`). 인증·MFA·세션·CSRF·Origin 검사·권한·입력 검증·감사 로그가 사내 플랫폼과 동일하다.
- **사내 업무 시스템(재무·직원·결재·문서·프로젝트·캘린더 등)은 이 배포에 포함되지 않는다.** 라우트 자체가 없고(404), 미들웨어가 화면·API 경로를 한 번 더 차단한다.
- DB 스키마는 기존 Prisma 스키마와 같다(추가 전용 마이그레이션). 나중에 NestJS 전체 플랫폼을 별도 서버에 올려도 같은 DB 를 그대로 연결할 수 있다.
- Redis 는 사용하지 않는다. 이메일 발송 큐는 비활성이며(인앱 알림은 정상 저장), SMTP 도입 시 워커를 추가한다.

### 배포 모드 (`NEXT_PUBLIC_DATA_SOURCE`)

| 값 | 용도 | /admin | /api |
|---|---|---|---|
| `static` (Vercel 기본값) | 백엔드 없는 공개 사이트 — 번들된 샘플 데이터 | 전부 404 | 503 |
| `cms` | 홈페이지 + 홈페이지 CMS (이 문서) | 로그인·MFA·CMS·미리보기·내 계정·알림만 | auth·cms·public·notifications 만 |
| (미설정, Docker) | 사내 통합 플랫폼 전체 (별도 API 서버) | 전체 | API 서버로 프록시 |

`cms` 에서 문제가 생기면 Vercel 환경변수를 `static` 으로 되돌리고 재배포하면 즉시 이전 상태(정적 사이트)로 돌아간다.

## 2. 관리자에서 편집할 수 있는 항목

| 메뉴 | 내용 |
|---|---|
| 페이지·사이트 설정 › 홈 | Hero 헤드라인·서브 라인·버튼·배경 이미지, 섹션 표시/숨김·순서, 회사 소개 문구·링크·이미지, 각 섹션 라벨·제목·링크 문구·빈 상태 문구, 파트너십 CTA |
| 페이지·사이트 설정 › 회사 소개·사업 영역·문의·채용 | 상단 라벨·제목·리드, 본문(마크다운), 대표 이미지, 핵심 가치, 연락처 |
| 페이지·사이트 설정 › 브랜드/포트폴리오/뉴스 목록 | 목록 페이지 상단 문구·빈 상태 문구 |
| 페이지·사이트 설정 › 사이트 기본 설정 | 헤더·푸터 메뉴(표시 여부·순서), 헤더 버튼, 회사 정보·SNS, **사이트 기본 SEO·공유 이미지** |
| 페이지 공통 | SEO 제목·설명·공유(OG) 이미지 |
| 사업 영역 | 카드·상세 페이지: 제목·보조 제목·요약·본문·키워드·대표 이미지·버튼·SEO, 순서 |
| 브랜드·포트폴리오 | 로고·이미지·소개·웹사이트·카테고리·순서, 프로젝트(이미지·요약·본문·태그·주요 프로젝트) |
| 뉴스·채용 | 뉴스/인사이트/채용 공고(근무지·고용형태·마감일·지원 링크), 커버 이미지 |
| 문의 접수 | 문의 열람·처리 상태 (개인정보 권한 `cms.inquiries` 필요) |

임의 HTML·스크립트는 어디에도 저장·렌더링되지 않는다. 본문은 제한된 마크다운만 지원하며, 링크는 `/내부경로`·`https://`·`mailto:` 만 허용한다.

## 3. 작업 흐름

1. **편집 → 초안 저장**: 공개 사이트에는 영향 없음.
2. **미리보기**: 편집 화면의 `미리보기` → 새 탭에서 초안이 반영된 실제 공개 페이지(하단 노란 표시줄). 매 요청마다 세션·권한을 다시 확인한다.
3. **게시**: 게시 권한(`cms.publish`, 대표·임원 역할)이 있어야 한다. 편집자(MANAGER 등)는 `검토 요청`까지만 가능하다. 게시 즉시 공개 사이트에 반영된다(재배포 불필요).
4. **변경 이력·복구**: 각 편집 화면의 `변경 이력` → 원하는 시점 `이 버전으로 복구`. 페이지는 초안으로 복구되며 다시 게시해야 반영된다. 게시 중인 항목은 게시 권한자만 수정·복구할 수 있다.
5. **게시 중단·보관**: 게시 권한자만 가능.

## 4. 이미지 업로드 보안

- JPG·PNG·WebP·GIF 만 허용 (파일 확장자가 아니라 **파일 내용(매직 바이트)** 으로 판별). SVG·HTML 등 스크립트를 담을 수 있는 형식은 거부.
- 4MB 이하 (브라우저에서 먼저 자동 축소). 서버에서 **WebP 로 재인코딩**(최대 2560px, EXIF·위치정보 등 메타데이터 제거) → 원본 바이트는 저장하지 않는다.
- 저장 경로는 무작위 UUID (사용자 파일명 미사용), 업로드·삭제는 감사 로그에 기록.
- 공개 버킷에는 재인코딩된 WebP 만 올라간다 (`allowed_mime_types = image/webp`, 5MB 제한).

## 5. Supabase · Vercel 설정 (CMS 모드 전환)

### 5-1. Supabase (OOGAM 전용 프로젝트, 리전 ap-northeast-2 서울)
1. 전용 스키마 `oogam` 생성 — Supabase 데이터 API(PostgREST)가 노출하는 `public` 스키마를 쓰지 않는다.
   (공개 anon 키로 사용자·세션 테이블에 접근할 수 있는 경로 자체를 없앰)
2. 마이그레이션 적용: `apps/api/prisma/migrations/*/migration.sql` 을 순서대로 `oogam` 스키마에 (Prisma `migrate deploy` 와 동일, `_prisma_migrations` 기록 포함).
3. 초기 데이터: 조직(`oogam`)·역할·권한·대표 계정 (`apps/api/prisma/seed.ts` 와 동일 내용).
4. 앱 전용 DB 역할 `oogam_app` (최소 권한: `oogam` 스키마 테이블 읽기·쓰기만, DDL·다른 스키마 접근 불가).
5. Storage 공개 버킷 `oogam-public` (WebP 만, 5MB).

### 5-2. Vercel 환경변수 (Production)

| 이름 | 값 | 비밀 |
|---|---|---|
| `NEXT_PUBLIC_DATA_SOURCE` | `cms` | |
| `NEXT_PUBLIC_SITE_MODE` | `preview`(검수 중, 검색 차단·샘플 표시) / 비우면 정식 공개 | |
| `DATABASE_URL` | `postgresql://oogam_app.<ref>:<비밀번호>@<pooler 호스트>:6543/postgres?pgbouncer=true&connection_limit=1&schema=oogam` | ● |
| `APP_ENCRYPTION_KEY` | 32바이트 base64 (MFA 비밀키 암호화) — **변경 시 기존 MFA 등록 무효** | ● |
| `IP_HASH_SALT` | 무작위 48자 (문의 IP 해시) | ● |
| `MEDIA_STORAGE` | `supabase` | |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 대시보드 › Project Settings › API Keys 의 **secret key** | ● |
| `SUPABASE_MEDIA_BUCKET` | `oogam-public` | |
| `PUBLIC_SITE_URL` / `WEB_ORIGINS` | `https://oogam.co.kr` (WEB_ORIGINS 는 `https://oogam.co.kr,https://www.oogam.co.kr`) | |
| `MFA_REQUIRED_ROLES` | `OWNER,EXECUTIVE` (기본값과 동일 — 대표는 첫 로그인 시 MFA 등록 필수) | |
| `SITE_ORG_SLUG` | `oogam` (기본값) | |

비밀값은 Git·채팅에 남기지 않는다. 바꾼 뒤에는 Vercel 에서 재배포해야 적용된다.

## 6. 테스트

```bash
# API 단위·통합 (로컬 PostgreSQL·Redis 필요)
TEST_DATABASE_URL=postgresql://…/oogam_test REDIS_URL=redis://… pnpm --filter @oogam/api test
# CMS 모드 브라우저 E2E (CMS 모드로 빌드·기동한 서버, 콘텐츠가 빈 DB)
CMS_E2E_URL=http://127.0.0.1:3930 CMS_E2E_OWNER_EMAIL=… CMS_E2E_OWNER_PASSWORD=… \
CMS_E2E_EDITOR_EMAIL=… CMS_E2E_EDITOR_PASSWORD=… pnpm exec playwright test -c playwright.cms.config.ts --trace off
```

E2E 범위: 비인증 차단(관리자·사내 시스템·쓰기 API), 사업 영역 생성·이미지 업로드·게시·공개 반영, 홈 초안·미리보기·게시·섹션 숨김·이전 버전 복구, 편집자 게시 불가(서버 403).
