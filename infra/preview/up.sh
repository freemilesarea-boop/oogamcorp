#!/usr/bin/env bash
# OOGAM Preview (대표 검수용) 기동 — 운영과 분리된 별도 Docker 프로젝트(oogam-preview)
#
#   PREVIEW_HOST=localhost PREVIEW_HTTPS_PORT=8443 ./infra/preview/up.sh
#
# 환경변수
#   PREVIEW_HOST         접속 호스트명 (기본 localhost, 서버 배포 시 예: preview.oogam.co.kr)
#   PREVIEW_HTTPS_PORT   HTTPS 포트 (기본 8443, 서버 배포 시 443)
#   PREVIEW_BIND         외부 바인딩 주소 (기본 127.0.0.1 — 서버에서 공개 시 0.0.0.0, 승인 후)
#   PREVIEW_OWNER_EMAIL  대표 로그인 이메일 (기본 ceo@preview.oogam.invalid)
#   PREVIEW_TLS_CERT / PREVIEW_TLS_KEY  정식 인증서 경로 (없으면 자체 서명 인증서 생성)
#   BUILD_ARGS           docker build 추가 인자 (사내 프록시/CA 등)
#
# 비밀값·인증서·접속정보는 모두 .preview/ (gitignore, 권한 700/600) 에만 생성된다.
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077

# 0) 사전 점검 (macOS 포함) — 부족한 도구는 설치 방법과 함께 중단
fail() { echo "[preview] 준비 필요: $*" >&2; exit 1; }
command -v docker >/dev/null || fail "Docker Desktop 을 설치하세요 (https://www.docker.com/products/docker-desktop/)"
docker info >/dev/null 2>&1 || fail "Docker Desktop 이 실행 중이 아닙니다. 앱을 실행한 뒤 다시 시도하세요"
command -v node >/dev/null || fail "Node.js 22 를 설치하세요 (macOS: brew install node@22)"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || fail "Node.js 20 이상이 필요합니다 (현재 $(node -v))"
command -v openssl >/dev/null || fail "openssl 이 없습니다 (macOS: brew install openssl@3)"
if openssl version | grep -qi libressl; then
  fail "macOS 기본 LibreSSL 대신 OpenSSL 3 이 필요합니다: brew install openssl@3 후
       export PATH=\"\$(brew --prefix openssl@3)/bin:\$PATH\" 를 실행하고 다시 시도하세요"
fi

HOST="${PREVIEW_HOST:-localhost}"
PORT="${PREVIEW_HTTPS_PORT:-8443}"
ORIGIN="https://${HOST}$([ "$PORT" = 443 ] || echo ":$PORT")"
OWNER_EMAIL="${PREVIEW_OWNER_EMAIL:-ceo@preview.oogam.invalid}"
DIR="$(pwd)/.preview"
export PREVIEW_DIR="$DIR"
COMPOSE=(docker compose -p oogam-preview -f docker-compose.production.yml -f docker-compose.preview.yml --env-file "$DIR/preview.env")
rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }

mkdir -p "$DIR/tls"
chmod 700 "$DIR"

# 1) 비밀값 (최초 1회 생성, 재실행 시 유지)
if [ ! -f "$DIR/preview.env" ]; then
  cat > "$DIR/preview.env" <<ENV
NODE_ENV=production
PUBLIC_SITE_URL=$ORIGIN
WEB_ORIGINS=$ORIGIN
NEXT_PUBLIC_COLLAB_URL=wss://${HOST}$([ "$PORT" = 443 ] || echo ":$PORT")/collab
COOKIE_SECURE=true
POSTGRES_USER=oogam_preview
POSTGRES_PASSWORD=$(rand 32)
POSTGRES_DB=oogam_preview
REDIS_PASSWORD=$(rand 32)
IP_HASH_SALT=$(rand 48)
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
MFA_REQUIRED_ROLES=OWNER,EXECUTIVE
MALWARE_SCAN_MODE=required
STORAGE_DRIVER=local
SWAGGER_ENABLED=false
SMTP_ENABLED=false
LOG_LEVEL=info
PREVIEW_HTTPS_PORT=$PORT
PREVIEW_BIND=${PREVIEW_BIND:-127.0.0.1}
ENV
  echo "[preview] 비밀값 생성: $DIR/preview.env"
fi
set -a; . "$DIR/preview.env"; set +a

# 2) 접근 인증 (Nginx Basic) — 대표 전용 계정 1개
if [ ! -f "$DIR/htpasswd" ]; then
  BASIC_USER="oogam-ceo"
  BASIC_PASS="$(rand 24)"
  printf '%s:%s\n' "$BASIC_USER" "$(openssl passwd -apr1 "$BASIC_PASS")" > "$DIR/htpasswd"
  printf 'PREVIEW_BASIC_USER=%s\nPREVIEW_BASIC_PASS=%s\n' "$BASIC_USER" "$BASIC_PASS" > "$DIR/basic.env"
fi
chmod 644 "$DIR/htpasswd"   # nginx 컨테이너(비 root) 읽기용 — 해시만 포함
set -a; . "$DIR/basic.env"; set +a

# 3) TLS 인증서
if [ -n "${PREVIEW_TLS_CERT:-}" ]; then
  cp "$PREVIEW_TLS_CERT" "$DIR/tls/preview.crt"; cp "$PREVIEW_TLS_KEY" "$DIR/tls/preview.key"
elif [ ! -f "$DIR/tls/preview.crt" ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 30 \
    -subj "/CN=$HOST/O=OOGAM Preview (self-signed)" -addext "subjectAltName=DNS:$HOST,DNS:localhost,IP:127.0.0.1" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -keyout "$DIR/tls/preview.key" -out "$DIR/tls/preview.crt" 2>/dev/null
  echo "[preview] 자체 서명 인증서 생성 (30일): $DIR/tls/preview.crt"
fi
chmod 644 "$DIR/tls/preview.crt" "$DIR/tls/preview.key"

# 4) 이미지 빌드 (preview 태그, 검색 차단·가상 데이터 배지 포함)
if [ "${SKIP_BUILD:-0}" != 1 ]; then
  # shellcheck disable=SC2086
  docker build ${BUILD_ARGS:-} -f infra/docker/api.Dockerfile -t oogam-api:preview .
  # shellcheck disable=SC2086
  docker build ${BUILD_ARGS:-} --build-arg NEXT_PUBLIC_SITE_MODE=preview --build-arg "NEXT_PUBLIC_COLLAB_URL=$NEXT_PUBLIC_COLLAB_URL" \
    -f infra/docker/web.Dockerfile -t oogam-web:preview .
fi

# 5) 기동 (api 가 기동 시 마이그레이션 적용)
"${COMPOSE[@]}" up -d --no-build
echo "[preview] 서비스 기동 대기…"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T api node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then break; fi
  sleep 5
done

# 6) 시드: 조직·역할·대표 계정 (대표 비밀번호는 최초 1회 생성)
if [ ! -f "$DIR/owner.env" ]; then
  printf 'OWNER_EMAIL=%s\nOWNER_PASSWORD=%s\n' "$OWNER_EMAIL" "Oo$(rand 22)7" > "$DIR/owner.env"
fi
set -a; . "$DIR/owner.env"; set +a
"${COMPOSE[@]}" exec -T -e SEED_OWNER_EMAIL="$OWNER_EMAIL" -e SEED_OWNER_PASSWORD="$OWNER_PASSWORD" -e SEED_OWNER_NAME="대표" \
  api npx tsx prisma/seed.ts >/dev/null 2>&1
# 데모 생성용 가상 경영진 계정 (비밀번호는 매 실행 재발급)
"${COMPOSE[@]}" exec -T -e PREVIEW_SEED=1 api npx tsx prisma/seed-preview.ts 2>/dev/null > "$DIR/service-accounts.json"
chmod 600 "$DIR/service-accounts.json"

# 7) 데모 데이터 (API 경유)
NODE_EXTRA_CA_CERTS="$DIR/tls/preview.crt" node infra/preview/seed-demo.mjs "https://127.0.0.1:$PORT" "$DIR/service-accounts.json"

# 8) 접속 정보 (이 파일만 대표에게 안전한 경로로 전달)
cat > "$DIR/credentials.txt" <<CRED
OOGAM Preview 접속 정보 — 대외비. 채팅·메일 본문·Git 에 붙여넣지 마세요.

1) 접속 주소 : $ORIGIN
2) 1차 접근 인증 (브라우저 팝업)
   사용자 : $PREVIEW_BASIC_USER
   비밀번호: $PREVIEW_BASIC_PASS
3) 관리자 로그인 : $ORIGIN/admin/login
   이메일  : $OWNER_EMAIL
   비밀번호: $OWNER_PASSWORD
4) 최초 로그인 시 2단계 인증(MFA) 등록 화면이 열립니다.
   휴대폰 인증 앱(Google Authenticator, Microsoft Authenticator, 1Password 등)으로 QR 을 스캔하고,
   표시되는 복구 코드 10개를 안전한 곳에 보관하세요. 로그인 후 비밀번호 변경을 권장합니다.
5) 모든 데이터는 가상입니다. 자유롭게 수정·삭제해도 됩니다.
CRED
chmod 600 "$DIR/credentials.txt"
echo "[preview] 완료: $ORIGIN  (접속 정보: $DIR/credentials.txt)"
