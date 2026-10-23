/* Аутентификация: регистрация, вход, выход, /auth/me. Argon2id через Bun.password, сессии в БД (id = sha256 токена),
   cookie httpOnly + SameSite=Lax (+ Secure в production). Вход и регистрация ограничены rate-limit'ом в таблице rate_limits. */
import { zValidator } from '@hono/zod-validator';
import { eq, sql as dsql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { rateLimits, sessions, users, withContext, type Sql } from '@gr8r/db';
import { meUpdateBody, signinBody, signupBody } from '@gr8r/shared';
import { AppError } from './errors';
import { validationHook } from './crud';
import { requireSession, sha256, SESSION_COOKIE } from './middleware';
import { createWorkspace, listMyWorkspaces } from './workspaces-service';
import type { AppConfig, AppEnv } from './types';

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

async function startSession(c: Context<AppEnv>, userId: string, cfg: AppConfig): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + cfg.sessionTtlDays * 864e5);
  await withContext(c.get('sql'), { userId }, async db => {
    await db.insert(sessions).values({ id: sha256(token), userId, expiresAt, ip: c.get('ip'), userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null });
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  });
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: cfg.cookieSecure, path: '/', expires: expiresAt });
}

export const authRoutes = new Hono<AppEnv>()
  .post('/signup', zValidator('json', signupBody, validationHook), async c => {
    const sql = c.get('sql');
    const cfg = c.get('config');
    const body = c.req.valid('json');
    await hit(sql, cfg, `signup:ip:${c.get('ip')}`);
    const passwordHash = await Bun.password.hash(body.password, { algorithm: 'argon2id' });
    const user = await withContext(sql, {}, async db => {
      const [taken] = await db.select({ id: users.id }).from(users).where(eq(dsql`lower(${users.email})`, body.email)).limit(1);
      if (taken) throw new AppError(409, 'email_taken', 'An account with this email already exists');
      const [u] = await db.insert(users).values({ email: body.email, passwordHash, name: body.name }).returning({ id: users.id, email: users.email, name: users.name, locale: users.locale });
      return u!;
    });
    await startSession(c, user.id, cfg);
    if (body.workspaceName) await createWorkspace(sql, user, { name: body.workspaceName });
    return c.json({ user, workspaces: await listMyWorkspaces(sql, user.id) }, 201);
  })
  .post('/signin', zValidator('json', signinBody, validationHook), async c => {
    const sql = c.get('sql');
    const cfg = c.get('config');
    const { email, password } = c.req.valid('json');
    // Лимит и по IP, и по email: перебор пароля одной учётки с разных адресов тоже упирается в лимит
    await hit(sql, cfg, `signin:ip:${c.get('ip')}`);
    await hit(sql, cfg, `signin:email:${email}`);
    const found = await withContext(sql, {}, async db => (await db.select().from(users).where(eq(dsql`lower(${users.email})`, email)).limit(1))[0]);
    const ok = await Bun.password.verify(password, found?.passwordHash ?? (await getDummyHash()));
    if (!found || !ok) throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
    await clear(sql, `signin:email:${email}`);
    await startSession(c, found.id, cfg);
    const user = { id: found.id, email: found.email, name: found.name, locale: found.locale };
    return c.json({ user, workspaces: await listMyWorkspaces(sql, found.id) });
  })
  .post('/signout', requireSession, async c => {
    await withContext(c.get('sql'), { userId: c.get('user').id }, db => db.delete(sessions).where(eq(sessions.id, c.get('sessionId'))));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true as const });
  })
  .get('/me', requireSession, async c => {
    const user = c.get('user');
    return c.json({ user, workspaces: await listMyWorkspaces(c.get('sql'), user.id) });
  })
  // Личные настройки: пока только язык интерфейса
  .patch('/me', requireSession, zValidator('json', meUpdateBody, validationHook), async c => {
    const { locale } = c.req.valid('json');
    const me = c.get('user');
    const [user] = await withContext(c.get('sql'), { userId: me.id }, db =>
      db.update(users).set({ locale }).where(eq(users.id, me.id)).returning({ id: users.id, email: users.email, name: users.name, locale: users.locale }),
    );
    return c.json({ user: user! });
  });
