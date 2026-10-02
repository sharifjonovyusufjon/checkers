#!/bin/bash
# Checkers: lms.yusufjon.uz (o'yin), bot.yusufjon.uz (admin)
# ys.conf va harry.uz vhostlariga tegilmaydi.
set -euo pipefail
export NVM_DIR=/root/.nvm
# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null

ROOT=/home/checkers
YS=/etc/nginx/conf.d/ys.conf
BOT=/etc/nginx/conf.d/bot.yusufjon.uz.conf
LMS=/etc/nginx/conf.d/lms.yusufjon.uz.conf
PORT=7791

if [ -f "$YS" ]; then
  hash_ys=$(md5sum "$YS" | awk '{print $1}')
else
  hash_ys=""
fi

cd "$ROOT"
npm install --omit=dev
chmod 600 .env

write_site() {
  local name="$1"
  local file="$2"
  local cert="/etc/letsencrypt/live/${name}/fullchain.pem"
  local key="/etc/letsencrypt/live/${name}/privkey.pem"
  if [ -f "$cert" ]; then
    cat > "$file" <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name ${name};
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${name};
    ssl_certificate ${cert};
    ssl_certificate_key ${key};
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 8M;
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
}
NGX
  else
    cat > "$file" <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name ${name};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
NGX
  fi
}

write_site bot.yusufjon.uz "$BOT"
write_site lms.yusufjon.uz "$LMS"
nginx -t
systemctl reload nginx

if [ ! -f /etc/letsencrypt/live/bot.yusufjon.uz/fullchain.pem ]; then
  certbot --nginx -d bot.yusufjon.uz --non-interactive --agree-tos -m yusufjon6727@gmail.com --redirect || true
fi
if [ ! -f /etc/letsencrypt/live/lms.yusufjon.uz/fullchain.pem ]; then
  certbot --nginx -d lms.yusufjon.uz --non-interactive --agree-tos -m yusufjon6727@gmail.com --redirect || true
fi

if [ -n "$hash_ys" ]; then
  after=$(md5sum "$YS" | awk '{print $1}')
  if [ "$after" != "$hash_ys" ]; then
    echo "ERROR: ys.conf changed"
    exit 1
  fi
fi

if pm2 describe checkers >/dev/null 2>&1; then
  pm2 restart checkers --update-env
else
  pm2 start index.js --name checkers --time
fi
pm2 save
sleep 2
curl -fsS "http://127.0.0.1:${PORT}/health"
echo
echo DONE
