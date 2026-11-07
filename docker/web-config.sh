#!/bin/sh
# Рантайм-конфиг веба без пересборки: /config.js читает apps/web/src/lib/analytics.ts.
# Запускается стандартным entrypoint nginx (/docker-entrypoint.d) при старте контейнера.
set -eu
id="${UMAMI_WEBSITE_ID:-}"
# ID сайта Umami — UUID; всё остальное отбрасываем, чтобы переменная не попала в JS как код
case "$id" in
  *[!0-9a-fA-F-]*) id="" ;;
esac
printf 'window.__GR8R_CONFIG__ = { umamiWebsiteId: "%s" };\n' "$id" > /usr/share/nginx/html/config.js
