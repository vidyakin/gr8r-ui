# Один Dockerfile на все сервисы монорепозитория (цели: api, worker, migrate, web).
# Сборка: docker build --target api -t gr8r-api .   (docker compose собирает сам)

FROM oven/bun:1 AS base
WORKDIR /app
# Сначала только манифесты — слой с зависимостями кэшируется, пока они не менялись
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
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
FROM base AS worker
ENV NODE_ENV=production
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
