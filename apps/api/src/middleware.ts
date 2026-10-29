/* Сквозные middleware: requestId + логирование, сессия, контекст арендатора, проверка роли. */
import { and, eq, gt } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { drizzleOf, isUuid, readMyModules, memberships, members, sessions, setContext, users, type Tx } from '@gr8r/db';
import { ROLES, type ModuleId, type Role } from '@gr8r/shared';
import { AppError, Rollback, dbUnavailable, forbidden, unauthorized } from './errors';
import type { AppEnv } from './types';

export const SESSION_COOKIE = 'gr8r_session';

export const sha256 = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');

/** requestId + строка лога на запрос: метод, путь, статус, время */
export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = c.req.header('x-request-id')?.slice(0, 64) || crypto.randomUUID().slice(0, 8);
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);
  const t0 = performance.now();
  await next();
  if (c.get('config').logRequests) {
    const ms = (performance.now() - t0).toFixed(1);
    const user = c.get('user')?.id.slice(0, 8) ?? '-';
    console.log(JSON.stringify({ t: new Date().toISOString(), id: requestId, method: c.req.method, path: c.req.path, status: c.res.status, ms: Number(ms), user }));
  }
});

/** Токен сессии — только из httpOnly cookie (Authorization/Bearer не поддерживается: токен не отдаётся в теле ответов) */
const readToken = (c: Context<AppEnv>): string | null => getCookie(c, SESSION_COOKIE) ?? null;

/** Сессия → пользователь. Запрос идёт под app_user без арендатора (users/sessions не под RLS) */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = readToken(c);
  if (!token) throw unauthorized();
  const id = sha256(token);
  const sql = c.get('sql');
  const row = await sql.begin(async tx => {
    await setContext(tx as Tx, {});
    const db = drizzleOf(tx as Tx);
    const [r] = await db
      .select({ id: users.id, email: users.email, name: users.name, locale: users.locale, isOperator: users.isOperator })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return r;
  });
  if (!row) throw unauthorized('Session is invalid or expired');
  c.set('user', row);
  c.set('sessionId', id);
  await next();
});

/* Транзакция, которая перестаёт принимать запросы после закрытия. После дедлайна postgres.js откатывает транзакцию
   и возвращает соединение в пул, а зависший обработчик держит ссылку на tx: без этой обёртки его поздние запросы
   ушли бы в то же соединение — уже вне транзакции или в транзакцию чужого запроса */
function closableTx(tx: Tx, isOpen: () => boolean): Tx {
  const check = () => {
    if (!isOpen()) throw new Error('Request transaction is closed (deadline exceeded)');
  };
  return new Proxy(tx, {
    apply: (target, self, args) => (check(), Reflect.apply(target, self, args)),
    get(target, key) {
      const v = Reflect.get(target, key);
      return typeof v === 'function' ? (...args: unknown[]) => (check(), v.apply(target, args)) : v;
    },
  });
}

/**
 * Контекст арендатора. Открывает транзакцию, делает `SET LOCAL ROLE app_user` и `app.user_id`, проверяет членство
 * в воркспейсе (X-Workspace-Id или параметр :id пути) и только потом ставит `app.workspace_id`.
 * Все запросы обработчика идут в этой транзакции (c.var.db / c.var.tx); при ответе >= 400 она откатывается.
 * Дедлайн config.txTimeoutMs: если обработчик ждёт дольше (недоступная зависимость, очередь пула), транзакция
 * откатывается, соединение возвращается в пул, клиент получает 503 — пул не исчерпывается зависшими запросами.
 */
export const tenant = (source: 'header' | 'param' = 'header') =>
  createMiddleware<AppEnv>(async (c, next) => {
    const raw = source === 'param' ? c.req.param('id') : c.req.header('x-workspace-id');
    if (!raw) throw new AppError(400, 'workspace_required', 'X-Workspace-Id header is required');
    if (!isUuid(raw)) throw new AppError(400, 'workspace_invalid', 'Workspace id is not a valid UUID');
    const wsId = raw.toLowerCase();
    const user = c.get('user');
    try {
      await c.get('sql').begin(async raw => {
        let open = true;
        let timer: Timer | undefined;
        const deadline = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(dbUnavailable('Request timed out waiting for the database')), c.get('config').txTimeoutMs)));
        const work = inTx(closableTx(raw as Tx, () => open));
        try {
          await Promise.race([work, deadline]);
        } finally {
          open = false;
          clearTimeout(timer);
          work.catch(() => {}); // поздняя ошибка зависшего обработчика ответа уже не меняет
        }
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }

    async function inTx(t: Tx) {
      await setContext(t, { userId: user.id });
      const db = drizzleOf(t);
      // Членство видно по политике memberships (user_id = app.user_id); чужой воркспейс даст пустой результат
      const [ms] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.workspaceId, wsId), eq(memberships.userId, user.id))).limit(1);
      if (!ms) throw forbidden('You are not a member of this workspace');
      await t`select set_config('app.workspace_id', ${wsId}, true)`;
      const [me] = await db.select({ id: members.id, status: members.status }).from(members).where(and(eq(members.workspaceId, wsId), eq(members.userId, user.id))).limit(1);
      if (!me || me.status === 'deactivated') throw forbidden('Your membership in this workspace is deactivated');
      c.set('tx', t);
      c.set('db', db);
      c.set('workspaceId', wsId);
      c.set('memberId', me.id);
      c.set('role', ms.role);
      await next();
      // Ошибка обработчика не бросается через next() — Hono превращает её в ответ; откатываем сами
      if (c.error || c.res.status >= 400) throw new Rollback();
    }
  });

const rank = (r: Role) => ROLES.length - ROLES.indexOf(r);

/** Минимальная роль для маршрута: owner > admin > member > guest */
export const requireRole = (min: Role) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (rank(c.get('role')) < rank(min)) throw forbidden(`This action requires the ${min} role or higher`);
    await next();
  });

export const hasRole = (c: { get(k: 'role'): Role }, min: Role) => rank(c.get('role')) >= rank(min);

/** Включённые модули арендатора: читается один раз за запрос (функция app_workspace_license, контекст арендатора уже выставлен tenant()) */
export async function modulesOf(c: Context<AppEnv>): Promise<Set<ModuleId>> {
  let m = c.get('modules');
  if (!m) {
    m = await readMyModules(c.get('db'));
    c.set('modules', m);
  }
  return m;
}

/** Запрет по модулю: путь, чей модуль выключен у арендатора, отвечает 403 module_disabled (docs/architecture/licensing.md).
    Ставится после tenant(), поэтому работает в транзакции запроса — ответ откатывает её. Пути ядра запроса не делают */
export const requireModule = (module: ModuleId) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!(await modulesOf(c)).has(module)) throw new AppError(403, 'module_disabled', `Module "${module}" is not enabled for this workspace`, { module });
    await next();
  });
