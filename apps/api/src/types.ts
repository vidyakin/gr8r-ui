import type { Db, Sql, Tx } from '@gr8r/db';
import type { Role } from '@gr8r/shared';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  locale: string | null;
}

export interface AppConfig {
  port: number;
  production: boolean;
  /** Флаг Secure у cookie сессии (по умолчанию включён в production; для http://localhost в Docker отключается COOKIE_SECURE=0) */
  cookieSecure: boolean;
  corsOrigins: string[];
  /** Доверять X-Forwarded-For (за nginx/балансировщиком) */
  trustProxy: boolean;
  sessionTtlDays: number;
  /** Rate-limit входа/регистрации: попыток на окно */
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  /** Логировать запросы в stdout (в тестах выключено) */
  logRequests: boolean;
  /** Дедлайн транзакции арендатора, мс: дольше — откат и 503 (защита пула от зависших обработчиков) */
  txTimeoutMs: number;
}

/** Переменные контекста Hono. tenant-поля есть только после middleware tenant() */
export interface AppEnv {
  Variables: {
    sql: Sql;
    config: AppConfig;
    requestId: string;
    ip: string;
    user: SessionUser;
    sessionId: string;
    /** Транзакция арендатора: SET LOCAL ROLE app_user + app.workspace_id/app.user_id */
    tx: Tx;
    db: Db;
    workspaceId: string;
    memberId: string;
    role: Role;
  };
}
