#!/usr/bin/env bash
# Preview 인증서 갱신 (cron). Nginx 가 /.well-known/acme-challenge 를 certbot-www 볼륨에서 제공하므로 무중단 갱신.
set -euo pipefail
DOMAIN="${1:?도메인}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v oogam-preview_certbot-www:/var/www/certbot certbot/certbot:v2.11.0 \
  renew --webroot -w /var/www/certbot -q
install -m 644 "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$REPO/.preview/tls/preview.crt"
install -m 644 "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$REPO/.preview/tls/preview.key"
docker exec oogam-preview-proxy-1 nginx -s reload
echo "$(date -Is) renewed-or-unchanged $DOMAIN"
