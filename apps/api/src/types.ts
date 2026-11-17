import type { Db, Sql, Tx } from '@erp/db';
import type { AccessCache } from './access-cache';
import type { SessionCache } from './session-cache';
import type { ModuleAccess, ModuleId, ModuleState, PositionSection, Role } from '@erp/shared';

/** Модули арендатора на момент запроса: можно писать (active), можно читать (readable) и состояния со сроками */
export interface ModuleAccessSets {
  active: Set<ModuleId>;
  readable: Set<ModuleId>;
  states: Record<ModuleId, ModuleState>;
}
export type { ModuleAccess };

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  locale: string | null;
  /** Личные настройки (users.prefs): частичный объект, полный набор даёт resolveUserPrefs */
  prefs: Record<string, unknown>;
  /** Оператор установки (users.is_operator): доступ к /admin/tenants */
  isOperator: boolean;
}

export interface AppConfig {
  port: number;
  production: boolean;
  /** Флаг Secure у cookie сессии (по умолчанию включён в production; для http://localhost в Docker отключается COOKIE_SECURE=0) */
  cookieSecure: boolean;
  corsOrigins: string[];
  /** Доверять X-Forwarded-For (за nginx/балансировщиком) */
  trustProxy: boolean;
  /** Принимать вебхук ЮКассы только с официальных адресов (YOOKASSA_IP_CHECK=0 отключает — для песочниц и тестов) */
  yookassaIpCheck: boolean;
  sessionTtlDays: number;
  /** Общий вход публичного демо (DEMO_RESET_EMAIL): ему нельзя менять пароль и закрывать сессии — им пользуются все посетители */
  demoEmail?: string | null;
  /** Rate-limit входа/регистрации: попыток на окно */
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  /** Rate-limit публичного вебхука лидов: обращений с одного IP на окно */
  leadHookRateLimitMax: number;
  leadHookRateLimitWindowMs: number;
  /** Логировать запросы в stdout (в тестах выключено) */
  logRequests: boolean;
  /** Дедлайн транзакции арендатора, мс: дольше — откат и 503 (защита пула от зависших обработчиков) */
  txTimeoutMs: number;
  /** Размер пула соединений API (API_DB_POOL_MAX) */
  dbPoolMax: number;
  /** Сколько живёт запись кэша сессий, мс (SESSION_CACHE_TTL_SEC); 0 — кэш выключен */
  sessionCacheTtlMs: number;
  /** Сколько живёт запись кэша доступа, мс (ACCESS_CACHE_TTL_SEC); 0 — кэш выключен */
  accessCacheTtlMs: number;
}

/** Переменные контекста Hono. tenant-поля есть только после middleware tenant() */
export interface AppEnv {
  Variables: {
    sql: Sql;
    config: AppConfig;
    /** Пул нумерации документов (numbering.ts в @erp/db): номер — отдельной короткой транзакцией */
    numberingSql: Sql;
    /** Кэш доступа к воркспейсам: членство, лицензия, разделы (access-cache.ts) */
    accessCache: AccessCache;
    /** Кэш сессий процесса (session-cache.ts) */
    sessionCache: SessionCache;
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
    /** Модули арендатора (действующие и читаемые): заполняется лениво (`accessOf(c)`), один запрос на HTTP-запрос */
    access: ModuleAccessSets;
    /** Токен доступа агента (Authorization: Bearer): заполняет requireSession; null у обычной cookie-сессии */
    apiToken?: {
      id: string;
      workspaceId: string;
      memberId: string;
      readOnly: boolean;
      sections: PositionSection[] | null;
      canPost: boolean;
    };
  };
}
