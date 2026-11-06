# OOGAM 배포 가이드 (신규 독립 서버)

> ⚠️ 운영 도메인 DNS 변경, 인증서 발급, 방화벽 변경, 실제 배포 실행은 **별도 승인 후** 진행합니다. 이 문서는 절차만 정의합니다.

## 1. 환경 구분
| 환경 | 용도 | 설정 |
|---|---|---|
| development | 로컬 개발 | `.env` (NODE_ENV=development), `docker compose up -d` 로 DB/Redis 만 기동 |
| staging | 운영 전 검증 (예: staging.oogam.co.kr) | `.env.staging`, `docker-compose.production.yml` 동일 구성, 별도 DB |
| production | oogam.co.kr | `.env.production`, `docker-compose.production.yml` |

`NODE_ENV=staging|production` 이면 필수 환경변수 누락 시 API 가 기동을 거부합니다.

## 2. 서버 준비 (권장 사양: 4 vCPU / 8GB RAM / 100GB SSD, Ubuntu 24.04 LTS)
1. 관리자 계정 + SSH 키 인증, 비밀번호 로그인 비활성화
2. 방화벽: 22(관리 IP 제한), 80, 443 만 허용 (`ufw allow 80,443/tcp`)
3. Docker Engine + Compose 플러그인 설치
4. 시간대 `Asia/Seoul`, 자동 보안 업데이트(unattended-upgrades)

## 3. 최초 배포
```bash
git clone <repo> /srv/oogam && cd /srv/oogam
cp .env.example .env.production
# 필수 값 수정: NODE_ENV=production, POSTGRES_PASSWORD, REDIS_PASSWORD, IP_HASH_SALT(openssl rand -hex 32),
# WEB_ORIGINS=https://oogam.co.kr, PUBLIC_SITE_URL=https://oogam.co.kr, NEXT_PUBLIC_COLLAB_URL=wss://oogam.co.kr/collab,
# COOKIE_SECURE=true, SWAGGER_ENABLED=false, STORAGE_DRIVER=s3 + S3_* (또는 local), SEED_OWNER_EMAIL/PASSWORD
docker compose -f docker-compose.production.yml --env-file .env.production build
docker compose -f docker-compose.production.yml --env-file .env.production up -d postgres redis
docker compose -f docker-compose.production.yml --env-file .env.production up -d api   # 기동 시 prisma migrate deploy 자동 실행
docker compose -f docker-compose.production.yml --env-file .env.production run --rm api npx tsx prisma/seed.ts   # 최초 1회
docker compose -f docker-compose.production.yml --env-file .env.production up -d
```
시드 후 `.env.production` 의 `SEED_OWNER_PASSWORD` 는 삭제하고, 최고관리자로 로그인해 비밀번호를 즉시 변경하세요.

## 4. HTTPS (승인 후)
1. DNS: `oogam.co.kr`, `www.oogam.co.kr` A 레코드 → 서버 IP
2. 인증서 발급 (예: certbot webroot): `/.well-known/acme-challenge/` 는 이미 프록시에 설정됨
   ```bash
   docker run --rm -v oogam_certbot-www:/var/www/certbot -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot \
     certonly --webroot -w /var/www/certbot -d oogam.co.kr -d www.oogam.co.kr --email admin@oogam.co.kr --agree-tos
   ```
3. `TLS_CERT_DIR=/etc/letsencrypt/live/oogam.co.kr` 설정, `infra/nginx/conf.d/oogam.conf` 의 443 블록 주석 해제 및 80 블록의 `return 301` 활성화
4. `docker compose ... up -d proxy` 재시작, 갱신 cron 등록

## 5. 업데이트 배포
```bash
git pull
docker compose -f docker-compose.production.yml --env-file .env.production build
./infra/scripts/backup.sh            # 배포 전 백업
docker compose -f docker-compose.production.yml --env-file .env.production up -d   # api 기동 시 마이그레이션 적용
docker compose -f docker-compose.production.yml --env-file .env.production ps
curl -fsS https://oogam.co.kr/api/v1/health
```
롤백: 이전 이미지 태그로 재기동. 마이그레이션은 전진 전용이므로 파괴적 변경은 2단계(확장 → 정리)로 배포합니다.

## 6. 헬스 체크 / 모니터링
- `GET /api/v1/health/live` — 프로세스 생존 (Docker HEALTHCHECK)
- `GET /api/v1/health` — DB/Redis 연결 (장애 시 503)
- 로그: 모든 서비스 JSON 구조화 로그(`docker compose logs -f api`), Nginx 접근 로그 JSON + 요청 ID 전파
- 권장: 외부 업타임 모니터링, 디스크 사용량 알림, 로그 수집(Loki/CloudWatch 등)

## 7. 백업 / 복구
- `infra/scripts/backup.sh` — pg_dump(gzip) + 로컬 업로드 tar + SHA256, 보관 기간 `RETENTION_DAYS`(기본 14일). cron: `0 3 * * *`
- `infra/scripts/restore.sh <파일>` — 확인 프롬프트 후 DB 재생성·복원
- 백업 파일은 반드시 서버 외부(오프사이트, 다른 리전 버킷)로 복제. 분기별 복구 리허설 권장.
- 개발 환경 검증 기록: `local-backup.sh` 로 백업 → 별도 DB 복원 → 테이블 행 수 일치 확인 완료.

## 8. 운영 전 체크리스트
- [ ] 모든 비밀값 교체, `.env.production` 권한 600
- [ ] `COOKIE_SECURE=true`, HTTPS 적용, HSTS 확인
- [ ] `SWAGGER_ENABLED=false`
- [ ] PostgreSQL/Redis 외부 미노출 확인 (`ss -tlnp`)
- [ ] 최고관리자 비밀번호 변경, 초기 시드 비밀번호 제거
- [ ] 개인정보처리방침/이용약관 법무 검토 후 CMS 게시
- [ ] 브랜드(듣다, Louver, 247Streams 등) 법인 관계 확인 후 게시 여부 결정
- [ ] SMTP 설정 및 테스트(승인 후), 발신 도메인 SPF/DKIM
- [ ] 백업 cron + 오프사이트 복제 + 복구 리허설
- [ ] 스테이징에서 E2E 테스트 통과
