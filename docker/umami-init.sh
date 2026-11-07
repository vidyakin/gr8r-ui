#!/bin/sh
# Разовая задача: роль и база umami в общем Postgres. Идемпотентно, работает и на непустом томе
# (скрипты docker-entrypoint-initdb.d там не выполняются). Пароль роли приводится к UMAMI_DB_PASSWORD при каждом запуске.
set -eu
export PGPASSWORD="$POSTGRES_PASSWORD"
psql -h postgres -U postgres -d postgres -v ON_ERROR_STOP=1 -v pw="$UMAMI_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE umami LOGIN PASSWORD %L', :'pw') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'umami') \gexec
SELECT format('ALTER ROLE umami PASSWORD %L', :'pw') \gexec
SELECT 'CREATE DATABASE umami OWNER umami' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'umami') \gexec
SQL
