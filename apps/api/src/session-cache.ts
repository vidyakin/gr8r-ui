/* Кэш сессий в памяти процесса API: sha256(токен) → пользователь. Снимает транзакцию поиска сессии с каждого запроса.
 *
 * Запись живёт ttlMs (по умолчанию 30 с) и не дольше самой сессии. Закрытие сессии и правка профиля сбрасывают запись
 * сразу в этом процессе и рассылают NOTIFY на канал SESSION_REVOKED_CHANNEL (в той же транзакции, что и удаление) — другие
 * экземпляры API сбрасывают у себя. Сессию, удалённую мимо API (вручную в базе), процесс увидит не позже чем через ttlMs.
 * Redis не нужен: запись — ~300 байт, а 10 тысяч активных сессий — около 3 МБ на процесс.
 */
import { sql as dsql } from 'drizzle-orm';
import type { Db } from '@erp/db';
import type { SessionUser } from './types';

export const SESSION_REVOKED_CHANNEL = 'erp_session_revoked';

/** Что сбросить: конкретные сессии (id — sha256 токена) или все сессии пользователя */
export type SessionRevoke = { sessionIds: string[] } | { userId: string; closeSockets?: true };

interface Entry {
  user: SessionUser;
  until: number;
}

export class SessionCache {
  private map = new Map<string, Entry>();

  constructor(
    private ttlMs: number,
    private maxSize = 10_000,
  ) {}

  get enabled() {
    return this.ttlMs > 0;
  }

  get(sessionId: string): SessionUser | null {
    const e = this.map.get(sessionId);
    if (!e) return null;
    if (e.until <= Date.now()) {
      this.map.delete(sessionId);
      return null;
    }
    return e.user;
  }

  set(sessionId: string, user: SessionUser, expiresAt: Date) {
    if (!this.enabled) return;
    const until = Math.min(Date.now() + this.ttlMs, expiresAt.getTime());
    this.map.delete(sessionId);
    // Map хранит порядок вставки: при переполнении выкидываем самую старую запись
    if (this.map.size >= this.maxSize) this.map.delete(this.map.keys().next().value!);
    this.map.set(sessionId, { user, until });
  }

  revoke(r: SessionRevoke) {
    if ('sessionIds' in r) {
      for (const id of r.sessionIds) this.map.delete(id);
      return;
    }
    for (const [id, e] of this.map) if (e.user.id === r.userId) this.map.delete(id);
  }

  /** Сообщение канала от другого экземпляра API */
  onNotify(payload: string): SessionRevoke | undefined {
    try {
      const r = JSON.parse(payload) as SessionRevoke;
      if ('sessionIds' in r && Array.isArray(r.sessionIds)) {
        const revoke = { sessionIds: r.sessionIds.map(String) };
        this.revoke(revoke);
        return revoke;
      }
      if ('userId' in r && typeof r.userId === 'string') {
        this.revoke(r);
        return r;
      }
    } catch (e) {
      console.error('[session-cache] bad notification payload', e);
    }
  }

  get size() {
    return this.map.size;
  }
}

/** NOTIFY другим экземплярам API — в транзакции, которая удаляет сессии или меняет профиль: уйдёт только после коммита */
export async function notifySessionRevoke(db: Db, r: SessionRevoke): Promise<void> {
  if ('sessionIds' in r && !r.sessionIds.length) return;
  await db.execute(dsql`select pg_notify(${SESSION_REVOKED_CHANNEL}, ${JSON.stringify(r)})`);
}
