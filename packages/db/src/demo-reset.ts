/* Публичный демо-воркспейс с ежедневным сбросом (docs/architecture/deploy.md, «Публичное демо»): один вход на всех,
   раз в сутки воркспейс удаляется целиком и создаётся заново из сида — чужие правки пропадают.
   Включается переменными воркера DEMO_RESET_EMAIL + DEMO_RESET_PASSWORD; проход идемпотентен (сравнение created_at с моментом сброса). */
import type { Sql } from './client';
import { withContext } from './context';
import { DomainError } from './errors';
import type { StepLog } from './meta';
import { createTenant, deleteTenant } from './tenants';

export interface DemoResetConfig {
  slug: string;
  name: string;
  email: string;
  password: string;
  /** Час сброса (0–23) по часовому поясу timeZone */
  hour: number;
  timeZone: string;
}

/** Настройки из окружения; без DEMO_RESET_EMAIL или DEMO_RESET_PASSWORD публичного демо нет */
export function demoResetConfigFromEnv(env: Record<string, string | undefined> = process.env): DemoResetConfig | null {
  const email = env.DEMO_RESET_EMAIL?.trim().toLowerCase();
  const password = env.DEMO_RESET_PASSWORD;
  if (!email || !password) return null;
  const hour = Number(env.DEMO_RESET_HOUR ?? 3);
  return {
    slug: env.DEMO_RESET_SLUG?.trim() || 'demo',
    name: env.DEMO_RESET_NAME?.trim() || 'FutureERP Studio',
    email,
    password,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 3,
    timeZone: env.DEMO_RESET_TZ?.trim() || 'Europe/Moscow',
  };
}

/** Смещение часового пояса (мс) в момент t: местное время минус UTC */
function tzOffset(t: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t))
      .map(x => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(t / 1000) * 1000;
}

/** Последний наступивший момент сброса: сегодня в hour:00 по поясу, если уже прошёл, иначе вчера */
export function lastDemoResetAt(now: Date, hour: number, timeZone: string): Date {
  const local = new Date(now.getTime() + tzOffset(now.getTime(), timeZone));
  let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour);
  if (target > local.getTime()) target -= 864e5;
  // местное hour:00 → UTC (смещение берём на сам момент, чтобы переход на летнее время не сдвигал час)
  const guess = target - tzOffset(target, timeZone);
  return new Date(target - tzOffset(guess, timeZone));
}

export type DemoResetResult = 'created' | 'reset' | null;

/** Пересоздаёт демо-воркспейс, если он создан раньше последнего момента сброса (или его нет). force — сбросить сейчас */
/** log — шаги для CLI оператора (`tenant demo-reset`); воркер вызывает без него */
export async function resetDemoOnce(sql: Sql, ddl: Sql, cfg: DemoResetConfig, now = new Date(), force = false, log?: StepLog): Promise<DemoResetResult> {
  log?.(`ищу демо-воркспейс «${cfg.slug}»`);
  const [ws] = await withContext(sql, {}, async (_db, tx) => tx`select id, created_at from workspaces where slug = ${cfg.slug}`, 'app_worker');
  const due = lastDemoResetAt(now, cfg.hour, cfg.timeZone);
  if (ws && !force && new Date(ws.created_at as string) >= due) return null;
  if (ws) {
    log?.(`удаляю старое демо ${ws.id as string}`);
    await deleteTenant(sql, ddl, ws.id as string, log);
  } else log?.('старого демо нет');
  try {
    log?.('создаю демо из сида (одна транзакция, на слабом сервере — минуты)');
    // Срок жизни с запасом: если сброс перестанет работать, демо само удалится через неделю (purgeTenantsOnce)
    await createTenant(sql, { name: cfg.name, slug: cfg.slug, owner: { email: cfg.email, name: 'Демо', password: cfg.password }, demo: true, ttlDays: 7 }, log);
  } catch (e) {
    // второй воркер успел пересоздать раньше — это не ошибка
    if (e instanceof DomainError && e.code === 'slug_taken') return null;
    throw e;
  }
  log?.('сбрасываю пароль общего входа');
  // Пользователь мог пережить удаление (создал себе ещё воркспейс) и сменить пароль — вход на всех должен работать всегда
  const hash = await Bun.password.hash(cfg.password, { algorithm: 'argon2id' });
  await withContext(sql, {}, async (_db, tx) => tx`update users set password_hash = ${hash} where lower(email) = ${cfg.email}`, 'app_worker');
  return ws ? 'reset' : 'created';
}
