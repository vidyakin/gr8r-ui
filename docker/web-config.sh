#!/bin/sh
# Рантайм-конфиг веба без пересборки: /app/config.js (window.__ERP_CONFIG__) читают apps/web/src/lib/analytics.ts и форма входа.
# Запускается стандартным entrypoint nginx (/docker-entrypoint.d) при старте контейнера.
set -eu
id="${UMAMI_WEBSITE_ID:-}"
# ID сайта Umami — UUID; всё остальное отбрасываем, чтобы переменная не попала в JS как код
case "$id" in
  *[!0-9a-fA-F-]*) id="" ;;
esac
# Публичное демо: общий вход показывается на форме входа (он и так раздаётся всем). Только безопасные символы — иначе не показываем
demo_email="${DEMO_RESET_EMAIL:-}"
demo_pw="${DEMO_RESET_PASSWORD:-}"
case "$demo_email" in
  *[!A-Za-z0-9@._+-]*) demo_email="" ;;
esac
case "$demo_pw" in
  *[!A-Za-z0-9@._+=:,!#%*?~-]*) demo_pw="" ;;
esac
[ -n "$demo_email" ] && [ -n "$demo_pw" ] || { demo_email=""; demo_pw=""; }
printf 'window.__ERP_CONFIG__ = { umamiWebsiteId: "%s", demoEmail: "%s", demoPassword: "%s" };\n' "$id" "$demo_email" "$demo_pw" > /usr/share/nginx/html/app/config.js
