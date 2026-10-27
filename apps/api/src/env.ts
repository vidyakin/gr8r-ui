/* Конфигурация API из окружения. Корневой .env подхватывает @gr8r/db (импортируется раньше). */
import '@gr8r/db';
import type { AppConfig } from './types';

const int = (v: string | undefined, def: number) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : def;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return {
    port: int(env.API_PORT, 3000),
    production: env.NODE_ENV === 'production',
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' || env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    sessionTtlDays: int(env.SESSION_TTL_DAYS, 30),
    authRateLimitMax: int(env.AUTH_RATE_LIMIT_MAX, 10),
    authRateLimitWindowMs: int(env.AUTH_RATE_LIMIT_WINDOW_MIN, 15) * 60_000,
    leadHookRateLimitMax: int(env.LEAD_HOOK_RATE_LIMIT_MAX, 30),
    leadHookRateLimitWindowMs: int(env.LEAD_HOOK_RATE_LIMIT_WINDOW_SEC, 60) * 1000,
    logRequests: env.NODE_ENV !== 'test',
    txTimeoutMs: int(env.API_TX_TIMEOUT_MS, 30_000),
  };
}

/** Опции пула API. Таймауты на стороне сервера — страховка, если процесс завис и сам транзакцию не закроет:
    Postgres оборвёт сессию и освободит соединение. Только для API: у воркера и миграций бывают длинные транзакции */
export function apiSqlOptions(config: Pick<AppConfig, 'txTimeoutMs'>) {
  const serverTimeout = config.txTimeoutMs * 2;
  return {
    max: 10,
    connect_timeout: 5,
    connection: { application_name: 'gr8r-api', statement_timeout: serverTimeout, idle_in_transaction_session_timeout: serverTimeout },
  };
}
