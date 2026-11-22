/* Конфигурация API из окружения. Корневой .env подхватывает @erp/db (импортируется раньше). */
import '@erp/db';
import type { AppConfig } from './types';

const int = (v: string | undefined, def: number) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : def;
};

const DEFAULT_LANDING_AI_ORIGINS = [
  'https://future-erp.ai-solutions-studio.ru',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
];

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return {
    port: int(env.API_PORT, 3000),
    production: env.NODE_ENV === 'production',
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' || env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    yookassaIpCheck: !(env.YOOKASSA_IP_CHECK === '0' || env.YOOKASSA_IP_CHECK === 'false'),
    sessionTtlDays: int(env.SESSION_TTL_DAYS, 30),
    demoEmail: env.DEMO_RESET_EMAIL?.trim().toLowerCase() || null,
    authRateLimitMax: int(env.AUTH_RATE_LIMIT_MAX, 10),
    authRateLimitWindowMs: int(env.AUTH_RATE_LIMIT_WINDOW_MIN, 15) * 60_000,
    leadHookRateLimitMax: int(env.LEAD_HOOK_RATE_LIMIT_MAX, 30),
    leadHookRateLimitWindowMs: int(env.LEAD_HOOK_RATE_LIMIT_WINDOW_SEC, 60) * 1000,
    logRequests: env.NODE_ENV !== 'test',
    txTimeoutMs: int(env.API_TX_TIMEOUT_MS, 30_000),
    dbPoolMax: Math.max(1, int(env.API_DB_POOL_MAX, 10)),
    sessionCacheTtlMs: Math.max(0, int(env.SESSION_CACHE_TTL_SEC, 30)) * 1000,
    accessCacheTtlMs: Math.max(0, int(env.ACCESS_CACHE_TTL_SEC, 30)) * 1000,
    landingAi: {
      baseUrl: env.LANDING_AI_BASE_URL?.trim() || '',
      model: env.LANDING_AI_MODEL?.trim() || '',
      apiKey: env.LANDING_AI_API_KEY?.trim() || '',
      workspaceId: env.LANDING_AI_WORKSPACE_ID?.trim() || '',
      origins: (() => {
        const list = (env.LANDING_AI_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
        return list.length ? list : DEFAULT_LANDING_AI_ORIGINS;
      })(),
      rateIp10m: int(env.LANDING_AI_RATE_IP_10M, 15),
      rateIpDay: int(env.LANDING_AI_RATE_IP_DAY, 40),
      rateGlobalDay: int(env.LANDING_AI_RATE_GLOBAL_DAY, 500),
      maxTokens: int(env.LANDING_AI_MAX_TOKENS, 450),
      timeoutMs: int(env.LANDING_AI_TIMEOUT_MS, 25_000),
    },
  };
}

/** Опции пула API. Таймауты на стороне сервера — страховка, если процесс завис и сам транзакцию не закроет:
    Postgres оборвёт сессию и освободит соединение. Только для API: у воркера и миграций бывают длинные транзакции */
export function apiSqlOptions(config: Pick<AppConfig, 'txTimeoutMs'> & Partial<Pick<AppConfig, 'dbPoolMax'>>) {
  const serverTimeout = config.txTimeoutMs * 2;
  return {
    max: config.dbPoolMax ?? 10,
    connect_timeout: 5,
    connection: { application_name: 'erp-api', statement_timeout: serverTimeout, idle_in_transaction_session_timeout: serverTimeout },
  };
}

/** Пул нумерации документов: две коротких транзакции на счётчике (numbering.ts в @erp/db), простаивающие соединения закрываются */
export function numberingSqlOptions(config: Pick<AppConfig, 'txTimeoutMs'>) {
  const o = apiSqlOptions(config);
  return { ...o, max: 2, idle_timeout: 60, connection: { ...o.connection, application_name: 'erp-api-numbering' } };
}
