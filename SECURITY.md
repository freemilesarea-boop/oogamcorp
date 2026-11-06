# OOGAM 보안 설계 및 운영 수칙

## 인증
- **외부 공개 회원가입 없음.** 계정은 `employees.manage` 권한자가 초대 → 초대 링크(토큰은 SHA-256 해시만 DB 저장, 7일 만료, 1회용)로 활성화.
- 비밀번호: **Argon2id** (memory 19MiB, t=2) 해싱. 평문 저장/로그 금지. 정책: 10자 이상 영문+숫자.
- 서버 세션: 32바이트 무작위 토큰을 HttpOnly 쿠키로 전달, DB 에는 **해시만** 저장. 절대 만료(`SESSION_TTL_HOURS`) + 유휴 만료(`SESSION_IDLE_MINUTES`).
- 쿠키: `HttpOnly; SameSite=Lax; Secure(운영)`; 운영에서는 `__Host-` 접두사 쿠키 이름 사용.
- 로그인 시도 제한: 계정 단위 N회 실패 시 잠금(`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`) + IP 단위 레이트 리밋(API Throttler + Nginx `limit_req`). 존재하지 않는 계정도 동일 시간 소요(더미 해시 검증), 동일한 오류 메시지.
- 비밀번호 변경 시 다른 모든 세션 폐기. 계정 비활성화 시 즉시 접근 불가(매 요청 사용자 상태 확인) + 세션 폐기.
- **MFA (TOTP, RFC 6238)**: 등록(비밀번호 재확인 → QR/키 → 첫 코드 확인), 로그인 후 2단계 검증, 해제(비밀번호+코드), 복구 코드 10개(HMAC 해시 저장·1회용·재발급), 최고관리자의 타인 MFA 초기화(감사 로그).
  - TOTP 비밀키는 **AES-256-GCM**(`APP_ENCRYPTION_KEY`)으로 암호화 저장, ±1 단계 허용, **코드 재사용 방지**(마지막 사용 단계 기록, 동시 요청은 조건부 갱신으로 1회만 성공).
  - 세션별 검증 실패 `MFA_MAX_ATTEMPTS`(기본 5) 초과 시 세션 폐기.
  - **MFA 미완료 세션 차단**: 전역 가드가 `/auth/me`, `/auth/logout`, `/auth/mfa/verify` 외 모든 API 를 401 `MFA_REQUIRED` 로 차단. 공동 편집 WebSocket 연결도 동일 정책으로 거부.
  - **역할 기반 필수 정책**: `MFA_REQUIRED_ROLES`(운영 기본 `OWNER,EXECUTIVE`) 역할은 등록 전까지 등록 API 외 모든 API 403 `MFA_ENROLLMENT_REQUIRED`, 스스로 해제 불가.

## CSRF / 출처
- **세션 바인딩 동기화 토큰**: 로그인 시 생성되어 세션 행에 저장, 비-HttpOnly 쿠키(`oogam_csrf`, SameSite=Strict)로 전달 → 모든 상태 변경 요청은 `X-CSRF-Token` 헤더 일치 필요(상수 시간 비교).
- 상태 변경 요청의 `Origin` 이 호스트 또는 `WEB_ORIGINS` 와 다르면 차단.

## Content-Security-Policy
- **웹(공개+관리자)**: Next.js 미들웨어가 요청마다 nonce 를 생성 — `script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src` 는 자기 출처 + 공동 편집 WebSocket 출처만. HTTPS 요청에서만 `upgrade-insecure-requests`.
  - 스타일은 Tailwind/Radix/Tiptap 인라인 style 속성 때문에 `'unsafe-inline'` 허용(스크립트 실행 불가, 잔여 위험 낮음). 폰트는 `cdn.jsdelivr.net`(Pretendard) 허용 — 자체 호스팅 시 제거 가능.
- **API 응답**: `default-src 'none'; frame-ancestors 'none'` (Swagger 경로 제외, 운영은 Swagger 비활성 + Nginx 차단).
- **파일 다운로드**: `Content-Security-Policy: sandbox; default-src 'none'`, `nosniff`, `Cache-Control: private, no-store`.

## 파일 업로드 보안
- 크기 제한(`MAX_UPLOAD_MB`, 초과 413), 빈 파일 거부.
- **매직 바이트로 실제 형식 판별**하여 선언 MIME/확장자와 불일치 시 거부(400). Office 문서는 내부 구조까지 확인.
- 실행 파일(MZ/ELF/Mach-O), 셸 스크립트, HTML/SVG/XML, jar/apk 및 위험 확장자(이중 확장자 포함) 차단(415). 파일명 정규화(NFC, 경로·제어·양방향 문자 제거, 200자).
- **악성코드 검사**: ClamAV(clamd INSTREAM). `MALWARE_SCAN_MODE` — `required`(운영 기본: 엔진 장애 시 업로드 거부, fail-closed) / `clamav`(장애 시 ERROR 상태로 보관하되 다운로드 차단 423, 재검사 API) / `off`(개발). EICAR 서명은 모든 모드에서 차단. 감염 파일은 저장하지 않고 `file.malware_detected` 감사 로그.
- 다운로드마다 대상 엔터티 접근 권한 재검사, GUEST 업로드 불가, 조직 간 격리(404).
- 세션이 없는 공개 POST(로그인, 문의 접수)는 Origin 검사 + 레이트 리밋 + 허니팟으로 보호.

## 인가 (서버 측 강제)
- 역할: OWNER / EXECUTIVE / MANAGER / EMPLOYEE / GUEST (서열 rank). **OWNER 와 EXECUTIVE 는 다른 권한 집합**:
  EXECUTIVE 는 권한 정책·시스템 설정 변경, 민감 인사정보(급여) 열람 불가.
- 유효 권한 = 역할 권한(`role_permissions`) ∪ 모듈 단위 명시 부여(`resource_grants`, resourceType=MODULE).
- 재무(`finance.*`)·민감 인사(`hr.sensitive.*`)·문의 개인정보(`cms.inquiries`)·감사 로그 등은 `sensitive` 로 분류, MANAGER/EMPLOYEE 기본 미부여.
- 리소스 단위 접근: 프로젝트(관리자·멤버·부서·부여), 문서(작성자/공개 범위 WORKSPACE·PRIVATE·RESTRICTED/부여, 상위 문서 제한 상속), 결재(요청자·결재선·`approvals.read_all`), 일정(비공개 일정), 파일(대상 엔터티 접근 가능 여부를 다운로드마다 재검사), 공동 편집 WebSocket 연결 시에도 동일 규칙.
- 프런트엔드 메뉴 숨김은 UX 일 뿐이며 모든 판단은 API 에서 수행. 접근 불가 리소스는 존재 여부 노출을 줄이기 위해 404 로 응답.
- 역할 변경 규칙: 자신보다 높은 서열 부여 불가, OWNER 부여는 OWNER 만, 마지막 OWNER 강등/비활성화 불가.

## 입력 검증 / 인젝션 / XSS
- 모든 DTO 는 class-validator, 정의되지 않은 필드 거부(`forbidNonWhitelisted`). 정렬 필드는 허용 목록만.
- SQL: Prisma 파라미터 바인딩만 사용(`$queryRaw` 태그드 템플릿), 문자열 연결 쿼리 금지.
- 문서 JSON 저장 시 `javascript:` 등 비허용 링크 프로토콜 제거, 렌더링은 ProseMirror 스키마 기반(임의 HTML 미실행). 공개 사이트 게시물은 HTML 을 그대로 주입하지 않고 안전한 렌더러로 출력.
- CSV 내보내기: 수식 주입(`= + - @`) 방지 접두 처리.
- 파일 업로드: 크기 제한, MIME/확장자 허용 목록, 무작위 저장 키(경로 조작 불가), 다운로드 시 `nosniff` + 이미지/PDF 외 `attachment`.

## 개인정보 / 민감정보
- 문의 접수: 개인정보 수집 동의 필수, IP 원문 대신 솔트 해시 저장, 열람은 `cms.inquiries` 권한자만, 열람 감사 로그.
- 로그: 쿠키·CSRF·Authorization 헤더 redaction, 요청 본문 미기록, **URL 의 민감 쿼리(token, password, code, secret, key 등) 값 마스킹**. 실측 점검(아래) 결과 비밀번호·세션·CSRF·초대 토큰·해시 노출 0건.
- **초대 토큰**: DB 에는 SHA-256 해시만, 이메일 발송 작업(Redis/BullMQ)에는 **토큰 원문이 아닌 AES-256-GCM 암호문**(초대 ID 를 AAD 로 바인딩)만 저장, 완료/실패 즉시 작업 삭제. 워커는 복호화 후 현재 해시와 일치할 때만 발송(재발송으로 교체된 토큰 미발송).
- 금액: DECIMAL(18,2) + 문자열 기반 계산(부동소수점 미사용).

## 감사 로그
로그인 성공/실패/잠금, 로그아웃, 비밀번호 변경, 세션 폐기, 초대/수락, 역할·권한 변경, 리소스 부여, 계정 비활성화, 민감 인사정보 열람/수정, 재무 승인/반려, CMS 게시, 문서·파일 삭제 등을 `audit_logs` 에 기록 (`/admin/settings/audit-logs`).

## 운영 수칙
- `.env` / 비밀값은 저장소에 커밋 금지(.gitignore). 운영 비밀값은 서버 환경변수 또는 시크릿 매니저로 주입.
- 운영 필수: `COOKIE_SECURE=true`, 강력한 `POSTGRES_PASSWORD`/`REDIS_PASSWORD`/`IP_HASH_SALT`, `SWAGGER_ENABLED=false`.
- PostgreSQL/Redis 는 내부 Docker 네트워크에만 연결(호스트 포트 미노출). 방화벽은 22(관리 IP 제한)/80/443 만 허용.
- 정기 백업(`infra/scripts/backup.sh`) + 오프사이트 복제 + 분기별 복구 리허설.
- 의존성 취약점 점검: `pnpm audit` 정기 실행.

## 검증 기록 (2026-11-06)
| 항목 | 방법 | 결과 |
|---|---|---|
| TOTP 알고리즘 | RFC 6238 부록 B 테스트 벡터 | 일치 |
| MFA 흐름·우회 | `test/security.e2e-spec.ts` (등록, 검증 전 API 6종 차단, 재사용 거부, 실패 한도 세션 폐기, 복구 코드 1회성, 타 세션 CSRF 재사용 거부, 필수 역할 강제, collab 연결 거부/허용 대조, 관리자 초기화 권한) + Playwright `e2e/mfa.spec.ts`(UI 등록→재로그인→차단→검증) | 통과 |
| 초대 토큰 큐 | 실제 Redis 의 모든 BullMQ 키를 덤프해 토큰 원문 검색 + 워커 복호화 발송 + 다른 초대 ID 로 이식한 암호문 거부 | 원문 0건 |
| 회귀(비밀번호·세션·CSRF·권한) | 해시 미노출, 위조/만료/유휴 세션, PUT/PATCH/DELETE CSRF, 메서드 오버라이드, 역할별 민감 모듈 차단, 권한 상승, ID 인젝션 | 통과 |
| 업로드 | `test/files-security.e2e-spec.ts`(27건, 가짜 clamd 포함) + **Docker 스테이징에서 실제 ClamAV**: 정상 파일 CLEAN, 압축 ZIP 내 EICAR 를 clamd 가 탐지(`engine: clamav`) | 통과 |
| 로그 | 운영 빌드를 `LOG_LEVEL=trace` 로 실행, 로그인 실패/성공·초대·비밀번호 변경·MFA 등록·쿼리스트링 비밀번호 요청 후 로그 전수 검색 | 수정 전 쿼리스트링 비밀번호 1건 노출 → 마스킹 적용 후 0건 |
| CSP | E2E: nonce 가 헤더와 HTML 에서 일치, 주요 화면 CSP 위반 콘솔 오류 0건 | 통과 |

## 알려진 제한 사항 / 잔여 위험
- 레이트 리밋 저장소가 API 인스턴스 메모리 기반 → 다중 인스턴스 시 Redis 저장소로 교체 필요.
- ZIP 등 압축 파일 내부는 형식 검사를 하지 않음(악성코드는 ClamAV 가 압축 해제 검사).
- 스타일 CSP `'unsafe-inline'`, 외부 폰트 CDN 의존.
- 이미 열린 공동 편집 연결은 세션 폐기 후에도 즉시 끊기지 않음(재연결 시 차단).
- MFA 는 TOTP 만 지원(WebAuthn/패스키 미지원). 신뢰 기기 기억 기능 없음.
- 외부 침투 테스트 미실시.
