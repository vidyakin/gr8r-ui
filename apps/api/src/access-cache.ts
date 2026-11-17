/* Кэш доступа к воркспейсу в памяти процесса API: членство (роль, участник, статус), лицензия, видимые разделы участника.
 * Снимает с каждого запроса tenant() три–пять служебных запросов к базе.
 *
 * Проверка членства — граница арендаторов (RLS смотрит только на app.workspace_id, который tenant() ставит после неё),
 * поэтому сброс не зависит от того, кто и откуда правит доступ: триггеры миграции 0125 на memberships, members, лицензиях
 * и должностях шлют NOTIFY erp_access_changed (id воркспейса, '*' — все), каждый экземпляр API слушает канал (index.ts).
 * Свою же правку tenant() сбрасывает сразу, не дожидаясь уведомления: триггер ставит app.access_changed в транзакции.
 * Запись живёт ttlMs (30 с) — страховка на случай потерянного уведомления (обрыв LISTEN). Отказы не кэшируются.
 */
import type { LicenseRaw, PositionSection, Role } from '@erp/shared';

export const ACCESS_CHANGED_CHANNEL = 'erp_access_changed';

export interface CachedMembership {
  role: Role;
  memberId: string;
  status: string;
}

interface Timed<T> {
  value: T;
  until: number;
}

interface WorkspaceEntry {
  members: Map<string, Timed<CachedMembership>>;
  license?: Timed<LicenseRaw | null>;
  sections: Map<string, Timed<PositionSection[]>>;
}

export class AccessCache {
  private byWs = new Map<string, WorkspaceEntry>();

  constructor(
    private ttlMs: number,
    private maxWorkspaces = 5_000,
  ) {}

  get enabled() {
    return this.ttlMs > 0;
  }

  private fresh<T>(t: Timed<T> | undefined): t is Timed<T> {
    return !!t && t.until > Date.now();
  }

  private entry(ws: string): WorkspaceEntry {
    let e = this.byWs.get(ws);
    if (!e) {
      // Map хранит порядок вставки: при переполнении выкидываем самый старый воркспейс
      if (this.byWs.size >= this.maxWorkspaces) this.byWs.delete(this.byWs.keys().next().value!);
      e = { members: new Map(), sections: new Map() };
      this.byWs.set(ws, e);
    }
    return e;
  }

  private timed<T>(value: T): Timed<T> {
    return { value, until: Date.now() + this.ttlMs };
  }

  membership(ws: string, userId: string): CachedMembership | null {
    const t = this.byWs.get(ws)?.members.get(userId);
    return this.fresh(t) ? t.value : null;
  }

  setMembership(ws: string, userId: string, m: CachedMembership) {
    if (this.enabled) this.entry(ws).members.set(userId, this.timed(m));
  }

  /** undefined — нет в кэше; null — у воркспейса нет лицензии (действует тариф по умолчанию) */
  license(ws: string): LicenseRaw | null | undefined {
    const t = this.byWs.get(ws)?.license;
    return this.fresh(t) ? t.value : undefined;
  }

  setLicense(ws: string, l: LicenseRaw | null) {
    if (this.enabled) this.entry(ws).license = this.timed(l);
  }

  sections(ws: string, memberId: string, role: Role): PositionSection[] | null {
    const t = this.byWs.get(ws)?.sections.get(`${memberId}|${role}`);
    return this.fresh(t) ? t.value : null;
  }

  setSections(ws: string, memberId: string, role: Role, s: PositionSection[]) {
    if (this.enabled) this.entry(ws).sections.set(`${memberId}|${role}`, this.timed(s));
  }

  /** Сбрасывает всё о воркспейсе; '*' — обо всех (изменился общий тариф) */
  invalidate(ws: string) {
    if (ws === '*') this.byWs.clear();
    else this.byWs.delete(ws.toLowerCase());
  }

  get size() {
    return this.byWs.size;
  }
}
