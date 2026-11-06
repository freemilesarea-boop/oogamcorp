# OOGAM 보안 설계 및 운영 수칙

## 인증
- **외부 공개 회원가입 없음.** 계정은 `employees.manage` 권한자가 초대 → 초대 링크(토큰은 SHA-256 해시만 DB 저장, 7일 만료, 1회용)로 활성화.
- 비밀번호: **Argon2id** (memory 19MiB, t=2) 해싱. 평문 저장/로그 금지. 정책: 10자 이상 영문+숫자.
- 서버 세션: 32바이트 무작위 토큰을 HttpOnly 쿠키로 전달, DB 에는 **해시만** 저장. 절대 만료(`SESSION_TTL_HOURS`) + 유휴 만료(`SESSION_IDLE_MINUTES`).
- 쿠키: `HttpOnly; SameSite=Lax; Secure(운영)`; 운영에서는 `__Host-` 접두사 쿠키 이름 사용.
- 로그인 시도 제한: 계정 단위 N회 실패 시 잠금(`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`) + IP 단위 레이트 리밋(API Throttler + Nginx `limit_req`). 존재하지 않는 계정도 동일 시간 소요(더미 해시 검증), 동일한 오류 메시지.
- 비밀번호 변경 시 다른 모든 세션 폐기. 계정 비활성화 시 즉시 접근 불가(매 요청 사용자 상태 확인) + 세션 폐기.
- MFA: 데이터 모델과 로그인 응답 구조 준비됨 (SCAFFOLDED).

## CSRF / 출처
- **세션 바인딩 동기화 토큰**: 로그인 시 생성되어 세션 행에 저장, 비-HttpOnly 쿠키(`oogam_csrf`, SameSite=Strict)로 전달 → 모든 상태 변경 요청은 `X-CSRF-Token` 헤더 일치 필요(상수 시간 비교).
- 상태 변경 요청의 `Origin` 이 호스트 또는 `WEB_ORIGINS` 와 다르면 차단.
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
- 로그: 쿠키·CSRF·Authorization 헤더 redaction. 비밀번호/토큰 로그 금지.
- 금액: DECIMAL(18,2) + 문자열 기반 계산(부동소수점 미사용).

## 감사 로그
로그인 성공/실패/잠금, 로그아웃, 비밀번호 변경, 세션 폐기, 초대/수락, 역할·권한 변경, 리소스 부여, 계정 비활성화, 민감 인사정보 열람/수정, 재무 승인/반려, CMS 게시, 문서·파일 삭제 등을 `audit_logs` 에 기록 (`/admin/settings/audit-logs`).

## 운영 수칙
- `.env` / 비밀값은 저장소에 커밋 금지(.gitignore). 운영 비밀값은 서버 환경변수 또는 시크릿 매니저로 주입.
- 운영 필수: `COOKIE_SECURE=true`, 강력한 `POSTGRES_PASSWORD`/`REDIS_PASSWORD`/`IP_HASH_SALT`, `SWAGGER_ENABLED=false`.
- PostgreSQL/Redis 는 내부 Docker 네트워크에만 연결(호스트 포트 미노출). 방화벽은 22(관리 IP 제한)/80/443 만 허용.
- 정기 백업(`infra/scripts/backup.sh`) + 오프사이트 복제 + 분기별 복구 리허설.
- 의존성 취약점 점검: `pnpm audit` 정기 실행.

## 알려진 제한 사항 (후속 조치 필요)
- MFA(TOTP) 미구현(구조만 존재).
- 공개 사이트 CSP 미적용(외부 폰트 CDN 사용 중). 운영 전 CSP 헤더 설계 필요.
- 레이트 리밋 저장소가 API 인스턴스 메모리 기반 → 다중 인스턴스 시 Redis 저장소로 교체 필요.
- 바이러스 검사(파일 업로드) 미적용 → ClamAV 등 연동 권장.
