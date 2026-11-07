/* Сквозные middleware: requestId + логирование, сессия, контекст арендатора, проверка роли. */
import { and, eq, gt } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { drizzleOf, isUuid, memberSections, readMyAccess, memberships, members, sessions, setContext, users, type Tx } from '@gr8r/db';
import { ROLES, TOKEN_PATH_SECTIONS, moduleOfApiPath, tokenApiRoot, type ModuleId, type PositionSection, type Role } from '@gr8r/shared';
import { AppError, Rollback, dbUnavailable, forbidden, unauthorized } from './errors';
import type { AppEnv, ModuleAccessSets } from './types';

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

/** Токен сессии — только из httpOnly cookie (в теле ответов не отдаётся) */
const readToken = (c: Context<AppEnv>): string | null => getCookie(c, SESSION_COOKIE) ?? null;

/** Токен доступа агента — заголовок Authorization: Bearer gr8r_… (приоритет над cookie) */
const readBearer = (c: Context<AppEnv>): string | null => {
  const h = c.req.header('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim() || null;
};

interface ApiTokenRow {
  id: string;
  workspace_id: string;
  member_id: string;
  user_id: string;
  read_only: boolean;
  sections: string[] | null;
  can_post: boolean;
}

/** Токен агента → пользователь участника + apiToken в контекст. Поиск идёт без арендатора через SECURITY DEFINER-функцию */
async function resolveApiToken(c: Context<AppEnv>, raw: string): Promise<void> {
  if (!raw.startsWith('gr8r_')) throw new AppError(401, 'token_invalid', 'The access token is invalid');
  const hash = sha256(raw);
  const sql = c.get('sql');
  const row = await sql.begin(async tx => {
    await setContext(tx as Tx, {});
    const [t] = (await tx`select * from app_api_token_lookup(${hash})`) as unknown as [ApiTokenRow?];
    if (!t) return null;
    const db = drizzleOf(tx as Tx);
    const [u] = await db
      .select({ id: users.id, email: users.email, name: users.name, locale: users.locale, prefs: users.prefs, isOperator: users.isOperator })
      .from(users)
      .where(eq(users.id, t.user_id))
      .limit(1);
    if (!u) return null;
    return { t, u };
  });
  if (!row) throw new AppError(401, 'token_invalid', 'The access token is invalid or expired');
  c.set('user', row.u);
  c.set('sessionId', '');
  c.set('apiToken', {
    id: row.t.id,
    workspaceId: row.t.workspace_id,
    memberId: row.t.member_id,
    readOnly: row.t.read_only,
    sections: (row.t.sections as PositionSection[] | null) ?? null,
    canPost: row.t.can_post,
  });
}

/** Сессия → пользователь. Запрос идёт под app_user без арендатора (users/sessions не под RLS).
    Authorization: Bearer имеет приоритет над cookie; токен агента пускается только на пути TENANT_PATHS, GET /auth/me и /mcp */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const bearer = readBearer(c);
  if (bearer) {
    await resolveApiToken(c, bearer);
  } else {
    const token = readToken(c);
    if (!token) throw unauthorized();
    const id = sha256(token);
    const sql = c.get('sql');
    const row = await sql.begin(async tx => {
      await setContext(tx as Tx, {});
      const db = drizzleOf(tx as Tx);
      const [r] = await db
        .select({ id: users.id, email: users.email, name: users.name, locale: users.locale, prefs: users.prefs, isOperator: users.isOperator })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
        .limit(1);
      return r;
    });
    if (!row) throw unauthorized('Session is invalid or expired');
    c.set('user', row);
    c.set('sessionId', id);
  }
  if (c.get('apiToken')) {
    const allowed = (c.req.method === 'GET' && c.req.path === '/auth/me') || c.req.path === '/mcp' || (moduleOfApiPath(c.req.path) !== null && tokenApiRoot(c.req.path) !== '/api-tokens');
    if (!allowed) throw new AppError(403, 'token_forbidden', 'The access token cannot use this endpoint');
  }
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
      const apiToken = c.get('apiToken');
      if (apiToken && wsId !== apiToken.workspaceId) throw new AppError(403, 'token_forbidden', 'The token does not belong to this workspace');
      await setContext(t, { userId: user.id, apiTokenId: apiToken?.id });
      const db = drizzleOf(t);
      // Членство видно по политике memberships (user_id = app.user_id); чужой воркспейс даст пустой результат
      const [ms] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.workspaceId, wsId), eq(memberships.userId, user.id))).limit(1);
      if (!ms) throw forbidden('You are not a member of this workspace');
      await t`select set_config('app.workspace_id', ${wsId}, true)`;
      const [me] = await db.select({ id: members.id, status: members.status }).from(members).where(and(eq(members.workspaceId, wsId), eq(members.userId, user.id))).limit(1);
      if (!me || me.status === 'deactivated') throw forbidden('Your membership in this workspace is deactivated');
      if (apiToken && me.id !== apiToken.memberId) throw new AppError(403, 'token_forbidden', 'The token member does not match this session');
      // Ограничения токена агента (docs/architecture/agent-tokens.md): только чтение и разделы
      if (apiToken) {
        if (apiToken.readOnly && !SAFE_METHODS.has(c.req.method)) throw new AppError(403, 'token_read_only', 'The access token is read-only');
        const root = tokenApiRoot(c.req.path);
        const sections = TOKEN_PATH_SECTIONS.get(root);
        if (sections && apiToken.sections && !sections.some(s => apiToken.sections!.includes(s)))
          throw new AppError(403, 'token_section_forbidden', `The access token is not allowed to use "${root}"`, { sections });
      }
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

/** Модули арендатора: читаются один раз за запрос (функция app_workspace_license, контекст арендатора уже выставлен tenant()) */
export async function accessOf(c: Context<AppEnv>): Promise<ModuleAccessSets> {
  let m = c.get('access');
  if (!m) {
    m = await readMyAccess(c.get('db'));
    c.set('access', m);
  }
  return m;
}

/** Модули, в которых арендатор может писать */
export const modulesOf = async (c: Context<AppEnv>): Promise<Set<ModuleId>> => (await accessOf(c)).active;

/** Запрет по разделу должности (docs/architecture/positions.md): путь раздела, скрытого должностями участника, отвечает
    403 section_forbidden на чтение и запись. admin и owner — без ограничений, как в меню */
export const requireSection = (section: PositionSection) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const role = c.get('role');
    if (role !== 'owner' && role !== 'admin') {
      const sections = await memberSections(c.get('db'), c.get('memberId'), role);
      if (!sections.includes(section)) throw new AppError(403, 'section_forbidden', `Section "${section}" is hidden by your positions`, { section });
    }
    await next();
  });

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Запрет по модулю: путь, чей модуль выключен у арендатора, отвечает 403 module_disabled; модуль после окончания срока (режим
    «только чтение», 14 дней) пускает только чтение — запись отвечает 403 module_expired (docs/architecture/licensing.md).
    Ставится после tenant(), поэтому работает в транзакции запроса — ответ откатывает её. Пути ядра запроса не делают */
export const requireModule = (module: ModuleId) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const a = await accessOf(c);
    if (!a.readable.has(module)) throw new AppError(403, 'module_disabled', `Module "${module}" is not enabled for this workspace`, { module });
    if (!a.active.has(module) && !SAFE_METHODS.has(c.req.method))
      throw new AppError(403, 'module_expired', `The "${module}" module has expired and is read-only`, { module, readonlyUntil: a.states[module].readonlyUntil });
    await next();
  });
