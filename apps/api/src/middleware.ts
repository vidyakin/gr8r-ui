/* Сквозные middleware: requestId + логирование, сессия, контекст арендатора, проверка роли. */
import { and, eq, gt } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { accessFromLicense, auditBlockedIp, drizzleOf, withSeparateNumbering, isUuid, memberSections, readMyLicense, memberships, members, sessions, setContext, users, workspaceSecurity, type Db, type Tx } from '@erp/db';
import { ROLES, TOKEN_PATH_SECTIONS, isTokenPostingRequest, isIpAllowed, moduleOfApiPath, tokenApiRoot, type ModuleId, type PositionSection, type Role } from '@erp/shared';
import { INTERNAL_HEADER, INTERNAL_SECRET, hitTokenRate } from './token-rate';
import { AppError, Rollback, dbUnavailable, forbidden, unauthorized } from './errors';
import type { AppEnv, ModuleAccessSets } from './types';

export const SESSION_COOKIE = 'erp_session';

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
    const path = c.req.path.replace(/^\/public\/supplier\/[^/]+/, '/public/supplier/[redacted]');
    console.log(JSON.stringify({ t: new Date().toISOString(), id: requestId, method: c.req.method, path, status: c.res.status, ms: Number(ms), user }));
  }
});

/** Токен сессии — только из httpOnly cookie (в теле ответов не отдаётся) */
const readToken = (c: Context<AppEnv>): string | null => getCookie(c, SESSION_COOKIE) ?? null;

/** Токен доступа агента — заголовок Authorization: Bearer erp_… (приоритет над cookie) */
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
  if (!raw.startsWith('erp_')) throw new AppError(401, 'token_invalid', 'The access token is invalid');
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
  // Повторное совпадение цепочки в том же запросе: сессия уже проверена, второе соединение из пула не берём
  if (c.get('user')) return next();
  const bearer = readBearer(c);
  if (bearer) {
    await resolveApiToken(c, bearer);
    // внутренние вызовы инструментов MCP уже учтены запросом /mcp
    if (c.req.header(INTERNAL_HEADER) !== INTERNAL_SECRET) hitTokenRate(c.get('apiToken')!.id);
  } else {
    const token = readToken(c);
    if (!token) throw unauthorized();
    const id = sha256(token);
    // Кэш сессий (session-cache.ts): без него каждый запрос открывал бы отдельную транзакцию ради поиска сессии
    const cache = c.get('sessionCache');
    let user = cache.get(id);
    if (!user) {
      const row = await c.get('sql').begin(async tx => {
        await setContext(tx as Tx, {});
        const db = drizzleOf(tx as Tx);
        const [r] = await db
          .select({ id: users.id, email: users.email, name: users.name, locale: users.locale, prefs: users.prefs, isOperator: users.isOperator, expiresAt: sessions.expiresAt })
          .from(sessions)
          .innerJoin(users, eq(users.id, sessions.userId))
          .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
          .limit(1);
        return r;
      });
      if (!row) throw unauthorized('Session is invalid or expired');
      const { expiresAt, ...u } = row;
      user = u;
      cache.set(id, user, expiresAt);
    }
    c.set('user', user);
    c.set('sessionId', id);
  }
  if (c.get('apiToken')) {
    const allowed =
      (c.req.method === 'GET' && c.req.path === '/auth/me') ||
      c.req.path === '/mcp' ||
      c.req.path.startsWith('/v1/') ||
      (moduleOfApiPath(c.req.path) !== null && !['/api-tokens', '/security'].includes(tokenApiRoot(c.req.path)));
    if (!allowed) throw new AppError(403, 'token_forbidden', 'The access token cannot use this endpoint');
  }
  await next();
});

/** A blocked request commits its audit row before the caller sends the error. */
export async function workspaceAccessError(c: Context<AppEnv>, db: Db, workspaceId: string): Promise<AppError | null> {
  const { ipAllowlist, require2fa } = await workspaceSecurity(db, workspaceId);
  const { id: userId, email } = c.get('user');
  const ip = c.get('ip');
  if (!isIpAllowed(ip, ipAllowlist)) {
    await auditBlockedIp(db, workspaceId, c.get('sessionId'), {
      userId, email, ip, userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null,
    });
    return new AppError(403, 'ip_blocked', 'This IP address is not allowed in this workspace');
  }
  if (require2fa && !c.req.path.startsWith('/auth/')) {
    const [user] = await db.select({ enabled: users.totpEnabled }).from(users).where(eq(users.id, userId));
    if (!user?.enabled) return new AppError(403, 'totp_required', 'Set up two-factor authentication to access this workspace');
  }
  return null;
}

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
export const tenant = (source: 'header' | 'param' | 'token' = 'header') =>
  createMiddleware<AppEnv>(async (c, next) => {
    // Транзакция арендатора уже открыта этим запросом: вложенная ждала бы второе соединение, держа первое, —
    // при пачке параллельных запросов пул исчерпывается и всё стоит до дедлайна
    if (c.get('tx')) return next();
    const raw =
      source === 'param'
        ? c.req.param('id')
        : source === 'token'
          ? (c.req.header('x-workspace-id') || c.get('apiToken')?.workspaceId)
          : c.req.header('x-workspace-id');
    if (!raw) throw new AppError(400, 'workspace_required', 'X-Workspace-Id header is required');
    if (!isUuid(raw)) throw new AppError(400, 'workspace_invalid', 'Workspace id is not a valid UUID');
    const wsId = raw.toLowerCase();
    const user = c.get('user');
    let accessChanged = false;
    let blocked: AppError | null = null;
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
    if (blocked) throw blocked;
    if (accessChanged) c.get('accessCache').invalidate(wsId);

    async function inTx(t: Tx) {
      const apiToken = c.get('apiToken');
      if (apiToken && wsId !== apiToken.workspaceId) throw new AppError(403, 'token_forbidden', 'The token does not belong to this workspace');
      const db = drizzleOf(t);
      // Кэш доступа (access-cache.ts): членство из кэша — контекст одним запросом, без проверок в базе
      const cache = c.get('accessCache');
      let me = cache.membership(wsId, user.id);
      if (me) await setContext(t, { userId: user.id, workspaceId: wsId, apiTokenId: apiToken?.id });
      else {
        await setContext(t, { userId: user.id, apiTokenId: apiToken?.id });
        // Членство видно по политике memberships (user_id = app.user_id); чужой воркспейс даст пустой результат
        const [ms] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.workspaceId, wsId), eq(memberships.userId, user.id))).limit(1);
        if (!ms) throw forbidden('You are not a member of this workspace');
        await t`select set_config('app.workspace_id', ${wsId}, true)`;
        const [row] = await db.select({ id: members.id, status: members.status }).from(members).where(and(eq(members.workspaceId, wsId), eq(members.userId, user.id))).limit(1);
        if (!row) throw forbidden('Your membership in this workspace is deactivated');
        me = { role: ms.role, memberId: row.id, status: row.status };
        cache.setMembership(wsId, user.id, me);
      }
      if (me.status === 'deactivated') throw forbidden('Your membership in this workspace is deactivated');
      if (apiToken && me.memberId !== apiToken.memberId) throw new AppError(403, 'token_forbidden', 'The token member does not match this session');
      blocked = await workspaceAccessError(c, db, wsId);
      if (blocked) return;
      // Ограничения токена агента (docs/architecture/agent-tokens.md): только чтение и разделы
      if (apiToken) {
        if (apiToken.readOnly && !SAFE_METHODS.has(c.req.method)) throw new AppError(403, 'token_read_only', 'The access token is read-only');
        if (!apiToken.canPost && isTokenPostingRequest(c.req.method, c.req.path))
          throw new AppError(403, 'token_cannot_post', 'The access token is not allowed to post, pay or delete');
        const root = tokenApiRoot(c.req.path);
        const sections = TOKEN_PATH_SECTIONS.get(root);
        if (sections && apiToken.sections && !sections.some(s => apiToken.sections!.includes(s)))
          throw new AppError(403, 'token_section_forbidden', `The access token is not allowed to use "${root}"`, { sections });
      }
      c.set('tx', t);
      c.set('db', db);
      c.set('workspaceId', wsId);
      c.set('memberId', me.memberId);
      c.set('role', me.role);
      // номера документов в этом запросе — отдельной короткой транзакцией: проведения не стоят в очереди на счётчике (пропуски допустимы)
      await withSeparateNumbering(c.get('numberingSql'), () => next());
      // Ошибка обработчика не бросается через next() — Hono превращает её в ответ; откатываем сами
      if (c.error || c.res.status >= 400) throw new Rollback();
      // запись могла поменять доступ (триггеры миграции 0125 ставят метку): свой кэш сбросим сразу после коммита
      if (!SAFE_METHODS.has(c.req.method)) {
        const [f] = await t`select current_setting('app.access_changed', true) as f`;
        if (f?.f === 'on') accessChanged = true;
      }
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
    // лицензия — из кэша доступа, модули и сроки считаются на каждый запрос (окончание срока не ждёт сброса кэша)
    const ws = c.get('workspaceId');
    const cache = c.get('accessCache');
    let l = cache.license(ws);
    if (l === undefined) {
      l = await readMyLicense(c.get('db'));
      cache.setLicense(ws, l);
    }
    m = accessFromLicense(l);
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
      const cache = c.get('accessCache');
      const ws = c.get('workspaceId');
      let sections = cache.sections(ws, c.get('memberId'), role);
      if (!sections) {
        sections = await memberSections(c.get('db'), c.get('memberId'), role);
        cache.setSections(ws, c.get('memberId'), role, sections);
      }
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
