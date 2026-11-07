# OOGAM Preview (대표 검수용) 운영 가이드

> 정식 서비스가 아닙니다. 대표의 디자인·기능 검수를 위한 독립 환경이며 **모든 데이터는 가상**입니다.

## 1. 구성

| 항목 | 내용 |
|---|---|
| 코드 | 기존 OOGAM 코드베이스 그대로 (Preview 빌드 플래그 `NEXT_PUBLIC_SITE_MODE=preview` 만 추가) |
| 실행 | `docker-compose.production.yml` + `docker-compose.preview.yml`, **Docker 프로젝트 `oogam-preview`** |
| 분리 | 운영·스테이징과 다른 프로젝트 이름 → 네트워크·DB·Redis·업로드 볼륨이 모두 별도. 운영 DB/서버에 접속하지 않음 |
| 서비스 | proxy(Nginx) · web · api · collab · worker · postgres · redis · clamav |
| 접근 통제 | ① Nginx Basic 인증(대표 전용 1계정, 모든 경로) ② 애플리케이션 로그인 ③ **MFA 필수(대표·경영진)** |
| HTTPS | 443(TLS 1.2/1.3). 로컬은 자체 서명 인증서(30일), 서버 배포 시 정식 인증서 경로 지정 |
| 검색 차단 | 모든 응답 `X-Robots-Tag: noindex, nofollow, noarchive`, `robots.txt` 전체 차단, 모든 페이지 `<meta name="robots" content="noindex">` |
| 표시 | 모든 화면 하단 "PREVIEW · 디자인 검수용 · 모든 데이터는 가상입니다" |
| 비밀값 | `.preview/` 에만 생성 (gitignore, 권한 700/600). 코드·Git 에 저장하지 않음 |

## 2. 실행 / 종료

```bash
./infra/preview/up.sh                       # 빌드 → 기동 → 마이그레이션 → 데모 데이터 → 접속정보 생성
./infra/preview/down.sh                     # 중지 (데이터 유지)
./infra/preview/down.sh --purge             # 컨테이너·볼륨·비밀값까지 완전 삭제
```
서버에 배포할 때 (승인 후):
```bash
PREVIEW_HOST=preview.oogam.co.kr PREVIEW_HTTPS_PORT=443 PREVIEW_HTTP_PORT=80 PREVIEW_BIND=0.0.0.0 \
PREVIEW_TLS_CERT=/etc/letsencrypt/live/preview.oogam.co.kr/fullchain.pem \
PREVIEW_TLS_KEY=/etc/letsencrypt/live/preview.oogam.co.kr/privkey.pem \
./infra/preview/up.sh
```

## 3. 접속 정보 전달
- `up.sh` 가 `.preview/credentials.txt`(권한 600)를 만듭니다. 접속 주소, 1차 접근 인증, 대표 관리자 계정이 들어 있습니다.
- 이 파일은 **채팅·메일 본문·Git 에 붙여넣지 말고** 사내 비밀번호 관리자(1Password 등)나 대면 전달로 공유하세요.
- 대표 계정은 최초 로그인 시 **본인 휴대폰 인증 앱으로 MFA 를 등록**합니다. 따라서 MFA 비밀키는 누구에게도 전달되지 않습니다.
- 데모 데이터 생성용 가상 경영진 계정(정샘플·한샘플)의 정보는 `.preview/service-accounts.json` 에만 있으며 검증 자동화에만 사용합니다.

## 4. 데모 데이터 (전부 가상)
| 영역 | 내용 |
|---|---|
| 조직 | 부서 5개(경영지원·콘텐츠·테크·브랜드전략·디자인), 가상 직원 9명(경영진 2, 매니저 2, 직원 4, 게스트 1) + 대표 |
| 홈페이지 | 가상 브랜드 6, 포트폴리오 4, 뉴스 3·인사이트 1·채용 2, 고정 페이지 샘플 문구, 문의 접수 2건 |
| 프로젝트 | 3개(진행·기획·보류), 업무 11건(할 일·진행·검토·완료), 마일스톤, **대표 담당 업무** 포함 |
| 문서 | 회의록(모든 블록 유형), 브랜드 가이드(하위 문서 포함), 온보딩 |
| 데이터베이스 | 콘텐츠 캘린더 — 속성 6종, 행 6, 보기 4종(표·보드·캘린더·갤러리) |
| 캘린더 | 일정 5건 (대표 참석 일정 포함) |
| 재무 | 사업 구분 4, 예산 2(승인 1·심사 중 1), 매출 5·지출 6 (승인 9, **승인 대기 2**) |
| 전자결재 | 5건 — **대표 결재 대기 2건**, 승인 1, 반려 1, 임시저장 1 |
| 공지 | 전사 2(고정 1), 부서 1 |

`[샘플]`·`가상`·`*.invalid` 이메일로 표시되며 실제 고객·직원 정보는 없습니다.

## 5. 운영 비용
| 실행 위치 | 비용 | 비고 |
|---|---|---|
| 현재 구성(개발용 클라우드 세션 컨테이너) | 추가 비용 없음 | 외부 접속 불가, 세션 종료 시 사라짐 — 검증용 |
| 대표 PC (Docker Desktop) | 없음 | `https://localhost:8443`, 가장 안전, PC 켜져 있을 때만 |
| 소형 클라우드 서버 + `preview.oogam.co.kr` | 월 수만 원대(서버 사양·업체에 따라 다름, **승인 필요**) | 4GB RAM 이상 권장(ClamAV 약 1.2GB 사용), DNS A 레코드·인증서 발급 필요 |

## 6. 종료 · 정리
1. `./infra/preview/down.sh --purge` — 컨테이너, Preview DB·Redis·업로드 볼륨, `.preview/` 비밀값 삭제
2. (서버 사용 시) 서버 삭제 → 과금 중지, DNS `preview` 레코드 삭제
3. Docker 이미지 정리(선택): `docker image rm oogam-web:preview oogam-api:preview`

## 7. 검증 결과 (2026-11-07, 개발용 클라우드 세션 컨테이너 내 Docker)
| 항목 | 결과 |
|---|---|
| 컨테이너 | 8개 기동(proxy·web·api·collab·worker·postgres·redis·clamav), 헬스체크 healthy |
| 분리 | Docker 프로젝트 `oogam-preview` 전용 네트워크·볼륨, PostgreSQL 은 internal 네트워크만, 포트는 127.0.0.1 바인딩 |
| HTTPS | TLS 1.3, 고정 인증서로 검증 `Verify return code: 0`, TLS 1.1 거부 (자체 서명 — 정식 인증서는 서버 배포 시) |
| 접근 인증 | 인증 없이 `/`, `/admin`, `/api`, `/collab`, 정적 파일 모두 401 (robots.txt 만 의도적 공개 — "전체 차단" 내용뿐) |
| 관리자 인증 | 대표 계정: MFA 등록 전 모든 관리자 API 403 `MFA_ENROLLMENT_REQUIRED` → 등록 화면으로 이동. 잘못된 비밀번호 거부 |
| E2E (Playwright, `playwright.preview.config.ts`) | **19/19 통과** — 홈 메뉴, 대시보드, 프로젝트 생성·수정, 칸반 드래그(새로고침 후 유지), 문서 작성·실시간 저장, DB 생성·수정·잘못된 값 거부, 일정, 재무 조회, 전자결재, 직원·부서, CMS 수정→게시→공개 반영, 미완성 표시, 보안 5종, 모바일 2종 |
| 화면 | 데스크톱 1440px·모바일(Pixel 7) 가로 스크롤 없음, 모바일 메뉴·관리자 드로어 동작 |
| 검색 차단 | robots.txt `Disallow: /`, 모든 응답 `X-Robots-Tag: noindex…`, 모든 페이지 meta robots noindex |
| 로그·민감정보 | 8개 컨테이너 로그 1.9MB 에서 생성된 비밀값(대표·접근·서비스 계정 비밀번호, MFA 비밀키, DB/Redis 비밀번호, 암호화 키) 0건, 쿠키·Authorization 헤더 0건. Git 추적 파일에도 0건 |
| 검증 후 정리 | E2E 가 만든 검수 데이터를 없애기 위해 `down.sh --purge` 후 재생성 (비밀값 전부 재발급) |

### 발견·수정
- 시드가 운영 수준 요청 제한(초대 수락 5회/분, API 20회/초)에 걸림 → 제한은 유지하고 시드가 429 시 대기·재시도
- Nginx 요청 제한 초과 응답이 503 → **429** 로 수정 (운영 설정에도 적용)
- 보안 헤더(nosniff, Referrer-Policy) 중복 → 업스트림 값 숨김 (운영 설정에도 적용)

### 알려진 제한
- 로컬 HTTP(8088) → HTTPS 전환 시 포트가 443 으로 고정 (서버 배포 시에는 정상)
- 세션 앱 미리보기용 내부 포트(8081)는 서버 내부 전용이며 Basic 인증 없이 앱 로그인·MFA 만 적용, 실시간 공동 편집 대신 자동 저장으로 동작
