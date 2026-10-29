# Один Dockerfile на все сервисы монорепозитория (цели: api, worker, migrate, web).
# Сборка: docker build --target api -t gr8r-api .   (docker compose собирает сам)

FROM oven/bun:1 AS base
WORKDIR /app
# Сначала только манифесты — слой с зависимостями кэшируется, пока они не менялись
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/landing/package.json apps/landing/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN bun install --frozen-lockfile
COPY . .

# ---- API (HTTP + WebSocket) ----
FROM base AS api
ENV NODE_ENV=production
EXPOSE 3000
USER bun
CMD ["bun", "apps/api/src/index.ts"]

# ---- Воркер (jobs + outbox) ----
# Chromium для PDF печатных форм (задача document.pdf); шрифты нужны для кириллицы в PDF.
# Отдельный слой до кода: правка исходников не переустанавливает пакеты
FROM oven/bun:1 AS worker-os
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

FROM worker-os AS worker
WORKDIR /app
COPY --from=base /app /app
ENV NODE_ENV=production
ENV CHROMIUM_PATH=/usr/bin/chromium
USER bun
CMD ["bun", "apps/worker/src/index.ts"]

# ---- Разовая задача: миграции (+ сид по SEED=1) ----
FROM base AS migrate
ENV NODE_ENV=production
USER bun
CMD ["sh", "-c", "bun run db:migrate && if [ \"$SEED\" = \"1\" ]; then bun run db:seed; fi"]

# ---- Фронтенд: сборка на Bun, раздача nginx с проксированием /api → api ----
FROM base AS web-build
RUN bun run --cwd apps/web build

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
