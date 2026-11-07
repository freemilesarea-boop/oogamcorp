#!/usr/bin/env bash
# OOGAM Preview — 새 Ubuntu 서버(22.04/24.04) 한 번에 설정
#
#   sudo ./infra/preview/server-setup.sh preview.oogam.co.kr admin@oogam.co.kr
#
# 수행: Docker·Node 설치 → 방화벽(22/80/443) → DNS 확인 → Let's Encrypt 인증서 발급
#       → Preview 기동(HTTPS·Basic 인증·MFA·검색 차단) → 인증서 자동 갱신 등록
# 전제: 이 저장소가 서버에 내려받아져 있고, DNS A 레코드(도메인 → 이 서버 공인 IP)가 등록되어 있음
set -euo pipefail

DOMAIN="${1:?사용법: sudo $0 <도메인> <인증서 알림 이메일>}"
EMAIL="${2:?사용법: sudo $0 <도메인> <인증서 알림 이메일>}"
[ "$(id -u)" = 0 ] || { echo "sudo 로 실행하세요."; exit 1; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
say() { echo; echo "[setup] $*"; }

say "1/6 필수 패키지"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg openssl dnsutils ufw >/dev/null
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "docker $(docker --version | cut -d' ' -f3 | tr -d ,) / node $(node -v)"

say "2/6 방화벽: SSH(22)·HTTP(80)·HTTPS(443) 만 허용"
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
# Docker 가 게시하는 포트는 80/443 뿐 (DB·Redis 는 내부망, 8081 은 127.0.0.1 전용)

say "3/6 DNS 확인: $DOMAIN → 이 서버"
MYIP="$(curl -fsS https://api.ipify.org)"
for i in $(seq 1 60); do
  DNSIP="$(dig +short A "$DOMAIN" @1.1.1.1 | tail -1)"
  [ "$DNSIP" = "$MYIP" ] && break
  [ "$i" = 1 ] && echo "DNS 가 아직 이 서버($MYIP)를 가리키지 않습니다 (현재: ${DNSIP:-없음}). 최대 10분 대기…"
  sleep 10
done
[ "$DNSIP" = "$MYIP" ] || { echo "DNS A 레코드를 $DOMAIN → $MYIP 로 등록한 뒤 다시 실행하세요."; exit 1; }
echo "확인: $DOMAIN → $MYIP"

say "4/6 HTTPS 인증서 발급 (Let's Encrypt)"
docker compose -p oogam-preview down >/dev/null 2>&1 || true   # 80 포트 비우기 (재실행 대비)
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot:v2.11.0 \
    certonly --standalone -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email -n
fi

say "5/6 Preview 기동 (최초 빌드 10~20분)"
PREVIEW_HOST="$DOMAIN" PREVIEW_HTTPS_PORT=443 PREVIEW_HTTP_PORT=80 PREVIEW_BIND=0.0.0.0 \
PREVIEW_TLS_CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem" \
PREVIEW_TLS_KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem" \
  ./infra/preview/up.sh

say "6/6 인증서 자동 갱신 (매일 03:17 확인, 만료 30일 전 갱신)"
cat > /etc/cron.d/oogam-preview-cert <<CRON
17 3 * * * root $REPO/infra/preview/renew-cert.sh $DOMAIN >> /var/log/oogam-preview-cert.log 2>&1
CRON
chmod 644 /etc/cron.d/oogam-preview-cert

echo
echo "[setup] 완료: https://$DOMAIN"
echo "[setup] 접속 정보: $REPO/.preview/credentials.txt (cat 으로 확인 후 안전한 곳에 보관)"
