/* Аутентификация: регистрация, вход, выход, /auth/me. Argon2id через Bun.password, сессии в БД (id = sha256 токена),
   cookie httpOnly + SameSite=Lax (+ Secure в production). Вход и регистрация ограничены rate-limit'ом в таблице rate_limits. */
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gt, ne, sql as dsql, type SQL } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { createFactory } from 'hono/factory';
import {
  clearLoginChallenge, disableTotp, enableTotp, rateLimits, recordLoginAttempt, redeemLoginFactor, sessions,
  setupTotp, users, withContext, type Db, type Sql,
} from '@erp/db';
import { loginFactorBody, meUpdateBody, passwordChangeBody, RECOVERY_CODE_RE, signinBody, signupBody, totpDisableBody, totpVerifyBody } from '@erp/shared';
import { AppError } from './errors';
import { validationHook } from './crud';
import { requireSession, sha256, SESSION_COOKIE } from './middleware';
import { notifySessionRevoke } from './session-cache';
import { createWorkspace, listMyWorkspaces, queryMyWorkspaces } from './workspaces-service';
import type { AppConfig, AppEnv } from './types';

/** Удаляет сессии пользователя по условию и сбрасывает их из кэша — в этом процессе сразу, в других через NOTIFY */
async function closeSessions(c: Context<AppEnv>, userId: string, cond: SQL): Promise<{ id: string }[]> {
  const rows = await withContext(c.get('sql'), { userId }, async db => {
    const deleted = await db.delete(sessions).where(and(eq(sessions.userId, userId), cond)).returning({ id: sessions.id });
    await notifySessionRevoke(db, { sessionIds: deleted.map(r => r.id) });
    return deleted;
  });
  c.get('sessionCache').revoke({ sessionIds: rows.map(r => r.id) });
  return rows;
}

/** Общий демо-вход (DEMO_RESET_EMAIL): пароль и чужие сессии не трогаем — иначе один посетитель запрёт или выкинет остальных.
    Свои воркспейсы и приглашения ему тоже нельзя: сброс пересоздаёт только демо, а вход открывает последний выбранный воркспейс */
export function assertNotDemo(c: Context<AppEnv>) {
  const demo = c.get('config').demoEmail;
  if (demo && c.get('user').email.toLowerCase() === demo) throw new AppError(403, 'demo_account_locked', 'The shared demo account cannot change login protection, close sessions, create workspaces or accept invites');
}

const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

/** Хеш-пустышка: при неизвестном email проверка пароля занимает столько же времени, сколько при известном */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= Bun.password.hash('dummy-password-for-timing', { algorithm: 'argon2id' }));

/** Учитывает попытку и бросает 429, если лимит окна исчерпан. Коммитится отдельной транзакцией (счётчик не откатывается) */
async function hit(sql: Sql, cfg: AppConfig, key: string): Promise<void> {
  const windowSec = Math.ceil(cfg.authRateLimitWindowMs / 1000);
  const hits = await withContext(sql, {}, async db => {
    const [r] = await db
      .insert(rateLimits)
      .values({ key, hits: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          hits: dsql`case when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) then 1 else ${rateLimits.hits} + 1 end`,
          windowStart: dsql`case when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) then now() else ${rateLimits.windowStart} end`,
        },
      })
      .returning({ hits: rateLimits.hits });
    return r!.hits;
  });
  if (hits > cfg.authRateLimitMax) throw new AppError(429, 'rate_limited', 'Too many attempts. Try again later.', { retryAfterSeconds: windowSec });
}

const clear = (sql: Sql, key: string) => withContext(sql, {}, db => db.delete(rateLimits).where(eq(rateLimits.key, key)));

type LoginMethod = typeof sessions.$inferInsert.loginMethod;
const CHALLENGE_TTL_MS = 5 * 60_000;

const loginIdentity = (c: Context<AppEnv>) => ({
  ip: c.get('ip'),
  userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null,
});

async function createSession(db: Db, c: Context<AppEnv>, userId: string, loginMethod: LoginMethod = 'password') {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + c.get('config').sessionTtlDays * 864e5);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt, loginMethod, ...loginIdentity(c) });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  return { token, expiresAt };
}

function issueSession(c: Context<AppEnv>, session: { token: string; expiresAt: Date }) {
  setCookie(c, SESSION_COOKIE, session.token, { httpOnly: true, sameSite: 'Lax', secure: c.get('config').cookieSecure, path: '/', expires: session.expiresAt });
}

const sessionUser = ({ id, email, name, locale, prefs, isOperator }: typeof users.$inferSelect) => ({ id, email, name, locale, prefs, isOperator });

const loginHandlers = createFactory<AppEnv>().createHandlers(zValidator('json', signinBody, validationHook), async c => {
  const sql = c.get('sql');
  const cfg = c.get('config');
  const { email, password } = c.req.valid('json');
  const emailKey = `signin:email:${email}`;
  await hit(sql, cfg, `signin:ip:${c.get('ip')}`);
  await hit(sql, cfg, emailKey);
  const found = await withContext(sql, {}, async db => (await db.select().from(users).where(eq(dsql`lower(${users.email})`, email)).limit(1))[0]);
  const verifyAgainst = found && !found.isService ? found.passwordHash : await getDummyHash();
  const verified = await Bun.password.verify(password, verifyAgainst);
  const result = await withContext(sql, { userId: found?.id }, async db => {
    const identity = { ...loginIdentity(c), userId: found?.id ?? null, email };
    // Serialize issuance with password changes and 2FA updates. The expensive password check ran outside the lock.
    const [user] = found && verified && !found.isService
      ? await db.select().from(users).where(eq(users.id, found.id)).for('update')
      : [];
    if (!user || user.isService || user.passwordHash !== verifyAgainst) {
      await recordLoginAttempt(db, { ...identity, method: 'password', status: 'failed_password' });
      return null;
    }
    await db.delete(rateLimits).where(eq(rateLimits.key, emailKey));
    if (user.totpEnabled) {
      const challengeToken = randomToken();
      await db.update(users).set({
        totpChallengeHash: sha256(challengeToken),
        totpChallengeExpiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      }).where(eq(users.id, user.id));
      return { kind: 'challenge', challengeToken } as const;
    }
    const session = await createSession(db, c, user.id);
    await recordLoginAttempt(db, { ...identity, method: 'password', status: 'ok' });
    const workspaces = await queryMyWorkspaces(db, user.id);
    return { kind: 'success', session, user: sessionUser(user), workspaces } as const;
  });
  if (!result) throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
  if (result.kind === 'challenge') return c.json({ requires2fa: true as const, challengeToken: result.challengeToken });
  issueSession(c, result.session);
  return c.json({ user: result.user, workspaces: result.workspaces });
});

export const authRoutes = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  })
  .post('/signup', zValidator('json', signupBody, validationHook), async c => {
    const sql = c.get('sql');
    const cfg = c.get('config');
    const body = c.req.valid('json');
    await hit(sql, cfg, `signup:ip:${c.get('ip')}`);
    const passwordHash = await Bun.password.hash(body.password, { algorithm: 'argon2id' });
    const user = await withContext(sql, {}, async db => {
      const [taken] = await db.select({ id: users.id }).from(users).where(eq(dsql`lower(${users.email})`, body.email)).limit(1);
      if (taken) throw new AppError(409, 'email_taken', 'An account with this email already exists');
      const [u] = await db.insert(users).values({ email: body.email, passwordHash, name: body.name }).returning({ id: users.id, email: users.email, name: users.name, locale: users.locale, prefs: users.prefs, isOperator: users.isOperator });
      return u!;
    });
    issueSession(c, await withContext(sql, { userId: user.id }, db => createSession(db, c, user.id)));
    if (body.workspaceName) await createWorkspace(sql, user, { name: body.workspaceName });
    return c.json({ user, workspaces: await listMyWorkspaces(sql, user.id) }, 201);
  })
  .post('/signin', ...loginHandlers)
  .post('/login', ...loginHandlers)
  .post('/login/2fa', zValidator('json', loginFactorBody, validationHook), async c => {
    const sql = c.get('sql');
    const cfg = c.get('config');
    const { challengeToken, code } = c.req.valid('json');
    await hit(sql, cfg, `login-2fa:ip:${c.get('ip')}`);
    const challengeHash = sha256(challengeToken);
    const activeChallenge = () => and(eq(users.totpEnabled, true), eq(users.totpChallengeHash, challengeHash), gt(users.totpChallengeExpiresAt, new Date()));
    const [found] = await withContext(sql, {}, db => db.select({ id: users.id }).from(users).where(activeChallenge()));
    if (!found) throw new AppError(401, 'invalid_login_challenge', 'The sign-in challenge has expired. Sign in again.');
    await hit(sql, cfg, `login-2fa:user:${found.id}`);
    const result = await withContext(sql, { userId: found.id }, async db => {
      const [user] = await db.select().from(users).where(and(eq(users.id, found.id), activeChallenge())).for('update');
      if (!user || !user.totpChallengeExpiresAt || user.totpChallengeExpiresAt.getTime() <= Date.now()) return { kind: 'expired' } as const;
      const identity = { ...loginIdentity(c), userId: user.id, email: user.email };
      const method = await redeemLoginFactor(db, user, code);
      if (!method) {
        await recordLoginAttempt(db, { ...identity, method: RECOVERY_CODE_RE.test(code) ? 'recovery' : 'totp', status: 'failed_totp' });
        return { kind: 'invalid' } as const;
      }
      await db.update(users).set(clearLoginChallenge).where(eq(users.id, user.id));
      const session = await createSession(db, c, user.id, method);
      await recordLoginAttempt(db, { ...identity, method, status: 'ok' });
      const workspaces = await queryMyWorkspaces(db, user.id);
      return { kind: 'success', user: sessionUser(user), session, workspaces } as const;
    });
    if (result.kind === 'expired') throw new AppError(401, 'invalid_login_challenge', 'The sign-in challenge has expired. Sign in again.');
    if (result.kind === 'invalid') throw new AppError(401, 'invalid_totp', 'The authentication or recovery code is incorrect or has expired');
    issueSession(c, result.session);
    return c.json({ user: result.user, workspaces: result.workspaces });
  })
  .get('/2fa/status', requireSession, async c => {
    const { id } = c.get('user');
    const [state] = await withContext(c.get('sql'), { userId: id }, db => db.select({
      enabled: users.totpEnabled,
      recoveryCodesRemaining: dsql<number>`cardinality(${users.recoveryCodesHashes})`,
    }).from(users).where(eq(users.id, id)));
    return c.json({ ...state!, canSetup: c.get('user').email.toLowerCase() !== c.get('config').demoEmail });
  })
  .post('/2fa/setup', requireSession, async c => {
    assertNotDemo(c);
    const { id, email } = c.get('user');
    await hit(c.get('sql'), c.get('config'), `totp-setup:user:${id}`);
    return c.json(await withContext(c.get('sql'), { userId: id }, db => setupTotp(db, id, email)));
  })
  .post('/2fa/verify', requireSession, zValidator('json', totpVerifyBody, validationHook), async c => {
    assertNotDemo(c);
    const { id } = c.get('user');
    const { code } = c.req.valid('json');
    await hit(c.get('sql'), c.get('config'), `totp-verify:user:${id}`);
    const { codes, revoke } = await withContext(c.get('sql'), { userId: id }, async db => {
      const codes = await enableTotp(db, id, code);
      const rows = await db.delete(sessions).where(and(eq(sessions.userId, id), ne(sessions.id, c.get('sessionId')))).returning({ id: sessions.id });
      const revoke = { sessionIds: rows.map(row => row.id) };
      await notifySessionRevoke(db, revoke);
      return { codes, revoke };
    });
    c.get('sessionCache').revoke(revoke);
    return c.json({ enabled: true as const, recoveryCodes: codes });
  })
  .post('/2fa/disable', requireSession, zValidator('json', totpDisableBody, validationHook), async c => {
    assertNotDemo(c);
    const { id } = c.get('user');
    const body = c.req.valid('json');
    await hit(c.get('sql'), c.get('config'), `totp-disable:user:${id}`);
    await withContext(c.get('sql'), { userId: id }, async db => {
      await disableTotp(db, id, body);
      await notifySessionRevoke(db, { userId: id, closeSockets: true });
    });
    c.get('sessionCache').revoke({ userId: id });
    return c.json({ enabled: false as const });
  })
  .post('/signout', requireSession, async c => {
    const revoke = { sessionIds: [c.get('sessionId')] };
    await withContext(c.get('sql'), { userId: c.get('user').id }, async db => {
      await db.delete(sessions).where(eq(sessions.id, c.get('sessionId')));
      await notifySessionRevoke(db, revoke);
    });
    c.get('sessionCache').revoke(revoke);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true as const });
  })
  .get('/me', requireSession, async c => {
    const user = c.get('user');
    return c.json({ user, workspaces: await listMyWorkspaces(c.get('sql'), user.id) });
  })
  // Личные настройки: язык интерфейса (locale) и/или часть prefs (часовой пояс, формат даты, предпочтения, уведомления); prefs сливаются по ключам
  .patch('/me', requireSession, zValidator('json', meUpdateBody, validationHook), async c => {
    const { locale, prefs } = c.req.valid('json');
    const me = c.get('user');
    const set: Record<string, unknown> = {};
    if (locale !== undefined) set.locale = locale;
    if (prefs && Object.keys(prefs).length) set.prefs = dsql`${users.prefs} || ${JSON.stringify(prefs)}::jsonb`;
    const cols = { id: users.id, email: users.email, name: users.name, locale: users.locale, prefs: users.prefs, isOperator: users.isOperator };
    // Пользователь лежит в кэше сессий вместе с locale и prefs: после правки сбрасываем его сессии везде
    const revoke = { userId: me.id };
    const [user] = await withContext(c.get('sql'), { userId: me.id }, async db => {
      if (!Object.keys(set).length) return db.select(cols).from(users).where(eq(users.id, me.id));
      const rows = await db.update(users).set(set).where(eq(users.id, me.id)).returning(cols);
      await notifySessionRevoke(db, revoke);
      return rows;
    });
    if (Object.keys(set).length) c.get('sessionCache').revoke(revoke);
    return c.json({ user: user! });
  })
  // Смена пароля: нужен текущий; все остальные сессии закрываются (вход, украденный вместе со старым паролем, перестаёт работать)
  .post('/password', requireSession, zValidator('json', passwordChangeBody, validationHook), async c => {
    assertNotDemo(c);
    const sql = c.get('sql');
    const me = c.get('user');
    const { current, next } = c.req.valid('json');
    await hit(sql, c.get('config'), `password:user:${me.id}`);
    const found = await withContext(sql, {}, async db => (await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, me.id)).limit(1))[0]);
    if (!found || !(await Bun.password.verify(current, found.hash))) throw new AppError(400, 'wrong_password', 'The current password is incorrect');
    const passwordHash = await Bun.password.hash(next, { algorithm: 'argon2id' });
    const closed = await withContext(sql, { userId: me.id }, async db => {
      await db.update(users).set({ passwordHash, ...clearLoginChallenge }).where(eq(users.id, me.id));
      const rows = await db.delete(sessions).where(and(eq(sessions.userId, me.id), ne(sessions.id, c.get('sessionId')))).returning({ id: sessions.id });
      await notifySessionRevoke(db, { sessionIds: rows.map(r => r.id) });
      return rows;
    });
    c.get('sessionCache').revoke({ sessionIds: closed.map(r => r.id) });
    await clear(sql, `password:user:${me.id}`);
    return c.json({ ok: true as const, closedSessions: closed.length });
  })
  // Мои сессии (токен в БД не хранится: id — его sha256, наружу отдаётся как есть, войти по нему нельзя)
  .get('/sessions', requireSession, async c => {
    const me = c.get('user');
    const rows = await withContext(c.get('sql'), { userId: me.id }, db =>
      db.select({ id: sessions.id, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt, ip: sessions.ip, userAgent: sessions.userAgent }).from(sessions).where(and(eq(sessions.userId, me.id), dsql`${sessions.expiresAt} > now()`)).orderBy(desc(sessions.createdAt)),
    );
    return c.json({ items: rows.map(r => ({ ...r, current: r.id === c.get('sessionId') })) });
  })
  // «Выйти на остальных»: все мои сессии, кроме текущей
  .delete('/sessions', requireSession, async c => {
    assertNotDemo(c);
    const me = c.get('user');
    const rows = await closeSessions(c, me.id, ne(sessions.id, c.get('sessionId')));
    return c.json({ closed: rows.length });
  })
  .delete('/sessions/:id', requireSession, async c => {
    assertNotDemo(c);
    const me = c.get('user');
    const id = c.req.param('id');
    if (id === c.get('sessionId')) throw new AppError(400, 'current_session', 'Use sign out to end the current session');
    const rows = await closeSessions(c, me.id, eq(sessions.id, id));
    if (!rows.length) throw new AppError(404, 'not_found', 'Session not found');
    return c.json({ ok: true as const });
  });
