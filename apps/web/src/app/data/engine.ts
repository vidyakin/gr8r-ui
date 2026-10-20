/* Синхронизация локальной модели с API.
 *
 * Модель данных компонентов не менялась: `dispatch({ type, … })` по-прежнему считает новое состояние чистым reducer'ом.
 * Этот слой превращает результат в мутации API:
 *   1. before → reducer → after (оптимистично; reducer — единственное место, где описана семантика действий);
 *   2. diff before/after по коллекциям → «добавлено / изменено (какие поля) / удалено»;
 *   3. after записывается в кэш TanStack Query (`['ws', id, коллекция]`) — интерфейс обновляется сразу;
 *   4. diff превращается в запросы (создание с id от клиента, PATCH изменённых полей, архив/удаление) и уходит в очередь воркспейса;
 *   5. по окончании очереди изменённые коллекции перечитываются: ключи задач, активность, уведомления приходят от сервера.
 * Ошибка запроса: toast с сообщением сервера, оставшиеся запросы этого действия пропускаются, коллекции перечитываются
 * (оптимистичное состояние откатывается к серверному).
 *
 * Undo (`data/restore`): снимок — это `data`, захваченный компонентом до действия. Для него запоминается состояние ПОСЛЕ действия
 * (WeakMap), и откатывается только разница между ними: чужие изменения, пришедшие по WebSocket в промежутке, не затрагиваются.
 */
import type { QueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { apiFor, errorMessage, ok, type Api } from './api';
import { buildSpecs, COLL_ORDER, type CollName, type Spec, type Specs } from './specs';

type Entity = { id: string };
type Body = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Коллекция в данных → имя коллекции в кэше */
export type Domain<Data> = { [K in keyof Data]?: CollName };

/* ============================== diff ============================== */

interface CollDelta {
  name: CollName;
  added: { item: AnyRec; index: number }[];
  removed: AnyRec[];
  changed: { before: AnyRec; after: AnyRec; keys: string[] }[];
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function changedKeys(a: AnyRec, b: AnyRec): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[k], b[k])) out.push(k);
  return out;
}

function diffList(name: CollName, a: AnyRec[], b: AnyRec[]): CollDelta | null {
  if (a === b) return null;
  const am = new Map(a.map(x => [x.id, x]));
  const bm = new Map(b.map(x => [x.id, x]));
  const d: CollDelta = { name, added: [], removed: [], changed: [] };
  b.forEach((x, index) => {
    const y = am.get(x.id);
    if (!y) d.added.push({ item: x, index });
    else if (y !== x) {
      const keys = changedKeys(y, x);
      if (keys.length) d.changed.push({ before: y, after: x, keys });
    }
  });
  for (const y of a) if (!bm.has(y.id)) d.removed.push(y);
  return d.added.length || d.removed.length || d.changed.length ? d : null;
}

/* ============================== порядок проектов ============================== */

/** sortOrder проектов по новому projOrder: меняются только те, кому нужно (вставка в начало/конец не трогает остальных) */
export function reorderProjects<D extends { projects: AnyRec[]; projOrder: string[] }>(after: D): D {
  const byId = new Map(after.projects.map(p => [p.id as string, p]));
  const ids = after.projOrder.filter(id => byId.has(id));
  for (const p of after.projects) if (!ids.includes(p.id)) ids.push(p.id); // на случай рассинхрона
  const cur = ids.map(id => byId.get(id)!.sortOrder as number | undefined);
  const defined = cur.filter((v): v is number => v !== undefined);
  const increasing = defined.every((v, i) => i === 0 || v > defined[i - 1]!);
  let next: number[];
  if (increasing && defined.length === ids.length) return after;
  if (increasing && defined.length) {
    // новые проекты только с краёв: перед первым известным и после последнего
    const first = cur.findIndex(v => v !== undefined);
    const last = cur.length - 1 - [...cur].reverse().findIndex(v => v !== undefined);
    const hole = cur.slice(first, last + 1).some(v => v === undefined);
    if (!hole) next = cur.map((v, i) => (v !== undefined ? v : i < first ? cur[first]! - (first - i) : cur[last]! + (i - last)));
    else next = ids.map((_, i) => i);
  } else next = ids.map((_, i) => i);
  const order = new Map(ids.map((id, i) => [id, next[i]!]));
  return { ...after, projects: after.projects.map(p => (order.get(p.id) === p.sortOrder ? p : { ...p, sortOrder: order.get(p.id) })) };
}

/** Порядок проектов в сайдбаре из их sortOrder */
export const projOrderOf = (projects: { id: string; sortOrder: number }[]) => [...projects].sort((a, b) => a.sortOrder - b.sortOrder).map(p => p.id);

/* ============================== запросы ============================== */

const RES: Record<CollName, (api: Api) => AnyRec> = {
  members: a => a.members,
  teams: a => a.teams,
  statuses: a => a.statuses,
  projects: a => a.projects,
  tasks: a => a.tasks,
  comments: a => a.comments,
  timeLogs: a => a['time-logs'],
  files: a => a.files,
  savedViews: a => a['saved-views'],
  events: a => a['calendar-events'],
  notifs: a => a.notifications,
  activity: a => a.activity,
  companies: a => a.companies,
  contacts: a => a.contacts,
  deals: a => a.deals,
  crmActivities: a => a['crm-activities'],
};

export interface Op {
  /** 'workspace' — настройки самого воркспейса */
  coll: CollName | 'workspace';
  /** 0 — создание/возврат, 1 — изменение, 2 — архив, 3 — удаление */
  phase: 0 | 1 | 2 | 3;
  run: () => Promise<unknown>;
}

const bodyOf = (map: AnyRec | undefined, l: AnyRec): Body => {
  const out: Body = {};
  for (const k of Object.keys(map ?? {})) Object.assign(out, map![k](l[k], l));
  return out;
};

/** Один «Undo»/действие: если запрос упал, остальные запросы того же действия пропускаются */
interface Batch {
  failed: boolean;
}

export class Engine {
  readonly specs: Specs;
  readonly statusIds = new Map<string, string>();
  /** Мягко удалённые в этой сессии записи: «вернуть» такую запись — POST /restore, а не создание */
  private tombstones = new Map<string, Set<string>>();
  /** Записи, скрытые вместе с мягко удалённым родителем (остались на сервере) */
  private hidden = new Map<string, Set<string>>();
  private dirty = new Set<CollName>();
  private pending = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private api: Api;

  constructor(
    readonly qc: QueryClient,
    readonly ws: string,
  ) {
    this.specs = buildSpecs(ws, this.statusIds);
    this.api = apiFor(ws);
  }

  key = (name: CollName) => ['ws', this.ws, name] as const;
  read = <L extends Entity = AnyRec & Entity>(name: CollName) => this.qc.getQueryData<L[]>(this.key(name));
  private write = (name: CollName, list: AnyRec[]) => this.qc.setQueryData(this.key(name), list);

  /** Все страницы коллекции → локальные сущности */
  async fetch(name: CollName): Promise<AnyRec[]> {
    const spec = this.specs[name] as unknown as Spec;
    const res = RES[name](this.api);
    const rows: unknown[] = [];
    for (let offset = 0; ; ) {
      const page = await ok<{ items: unknown[]; total: number }>(res.$get({ query: { limit: '200', offset: String(offset), ...spec.query } }));
      rows.push(...page.items);
      offset += page.items.length;
      if (spec.firstPageOnly || !page.items.length || offset >= page.total) break;
    }
    return rows.map(r => spec.from(r as never));
  }

  /* ---------- применение действия ---------- */

  /** Обычное действие: after уже посчитан reducer'ом */
  commit<D extends AnyRec>(domain: Domain<D>, before: D, after: D, extra?: Op[], localOnly: CollName[] = []) {
    const deltas: CollDelta[] = [];
    for (const k of Object.keys(domain) as (keyof D & string)[]) {
      const name = domain[k]!;
      const d = diffList(name, before[k] as AnyRec[], after[k] as AnyRec[]);
      if (!d) continue;
      deltas.push(d);
      this.cancel(name);
      this.write(name, after[k] as AnyRec[]);
    }
    this.enqueue(this.buildOps(deltas.filter(d => !localOnly.includes(d.name)), 'new').concat(extra ?? []), deltas.map(d => d.name));
  }

  /** Undo: откатывается разница baseline → snapshot, поверх текущего состояния кэша */
  commitRestore<D extends AnyRec>(domain: Domain<D>, baseline: D, snapshot: D, extra?: Op[]) {
    const deltas: CollDelta[] = [];
    for (const k of Object.keys(domain) as (keyof D & string)[]) {
      const name = domain[k]!;
      const d = diffList(name, baseline[k] as AnyRec[], snapshot[k] as AnyRec[]);
      if (!d) continue;
      deltas.push(d);
      this.cancel(name);
      let list: AnyRec[] = [...(this.read(name) ?? [])];
      const gone = new Set(d.removed.map(x => x.id));
      list = list.filter(x => !gone.has(x.id));
      for (const c of d.changed) {
        const i = list.findIndex(x => x.id === c.before.id);
        if (i >= 0) list[i] = { ...list[i], ...Object.fromEntries(c.keys.map(key => [key, c.after[key]])) };
      }
      for (const a of d.added) if (!list.some(x => x.id === a.item.id)) list.splice(Math.min(a.index, list.length), 0, a.item);
      this.write(name, list);
    }
    this.enqueue(this.buildOps(deltas, 'restore').concat(extra ?? []), deltas.map(d => d.name));
  }

  private cancel(name: CollName) {
    void this.qc.cancelQueries({ queryKey: this.key(name) });
  }

  private tomb(name: string) {
    let s = this.tombstones.get(name);
    if (!s) this.tombstones.set(name, (s = new Set()));
    return s;
  }

  /** Операции из diff'а */
  private buildOps(deltas: CollDelta[], mode: 'new' | 'restore'): Op[] {
    const ops: Op[] = [];
    // Удалённые родители: при жёстком удалении дети уходят каскадом БД, при мягком (архив) остаются на сервере и скрываются
    // на клиенте — в обоих случаях отдельный DELETE не нужен
    const gone = new Map<string, { ids: Set<string>; soft: boolean }>();
    for (const d of deltas) {
      const remove = (this.specs[d.name] as unknown as Spec).remove;
      if (remove !== 'none') gone.set(d.name, { ids: new Set(d.removed.map(x => x.id)), soft: remove === 'soft' });
    }

    for (const d of deltas) {
      const spec = this.specs[d.name] as unknown as Spec;
      const res = RES[d.name](this.api);
      const idOf = (l: AnyRec) => (spec.apiId ? spec.apiId(l as never) : (l.id as string));

      for (const { item } of d.added) {
        if (this.hidden.get(d.name)?.delete(item.id)) continue; // запись осталась на сервере (скрыта вместе с родителем) — вернуть нечего
        if (this.tomb(d.name).has(item.id)) {
          this.tomb(d.name).delete(item.id);
          ops.push({ coll: d.name, phase: 0, run: () => ok(res[':id'].restore.$post({ param: { id: item.id } })) });
        } else if (spec.canCreate?.(item as never) !== false) {
          if (spec.runCreate) ops.push({ coll: d.name, phase: 0, run: () => spec.runCreate!(item as never, mode, this.api) });
          else {
            const json: Body = { id: item.id, ...bodyOf(spec.fields, item), ...bodyOf(spec.createFields, item) };
            if (mode === 'restore' && d.name === 'tasks') json.key = item.key; // Undo возвращает задачу под прежним номером
            ops.push({ coll: d.name, phase: 0, run: () => ok(res.$post({ json })) });
          }
        }
      }

      for (const c of d.changed) {
        const json: Body = {};
        const fields = spec.fields as AnyRec;
        for (const k of c.keys) if (fields[k]) Object.assign(json, fields[k](c.after[k], c.after));
        if (Object.keys(json).length) ops.push({ coll: d.name, phase: 1, run: () => ok(res[':id'].$patch({ param: { id: idOf(c.after) }, json })) });
        if (spec.extraPatch) ops.push({ coll: d.name, phase: 1, run: () => spec.extraPatch!(c.before as never, c.after as never, c.keys, this.api) });
        if (spec.archive && !!c.before.archived !== !!c.after.archived) {
          if (c.after.archived) ops.push({ coll: d.name, phase: 2, run: () => ok(res[':id'].$delete({ param: { id: c.after.id } })) });
          else ops.push({ coll: d.name, phase: 0, run: () => ok(res[':id'].restore.$post({ param: { id: c.after.id } })) });
        }
      }

      for (const l of d.removed) {
        if (spec.remove === 'none') continue;
        const parent = spec.cascadeFrom?.(l as never).find(([coll, id]) => id && gone.get(coll)?.ids.has(id));
        if (parent) {
          if (gone.get(parent[0])!.soft) (this.hidden.get(d.name) ?? this.hidden.set(d.name, new Set()).get(d.name)!).add(l.id);
          continue;
        }
        const hard = spec.remove === 'hard';
        if (!hard) this.tomb(d.name).add(l.id);
        ops.push({ coll: d.name, phase: 3, run: () => ok(res[':id'].$delete({ param: { id: idOf(l) }, ...(hard ? { query: { hard: 'true' } } : {}) })) });
      }
    }
    return ops;
  }

  /* ---------- очередь ---------- */

  private enqueue(ops: Op[], touched: CollName[]) {
    const order = (o: Op) => (o.coll === 'workspace' ? -1 : COLL_ORDER.indexOf(o.coll));
    ops.sort((a, b) => a.phase - b.phase || (a.phase === 3 ? order(b) - order(a) : order(a) - order(b)));
    if (!ops.length) return;
    // Ключи задач, лента и уведомления вычисляет сервер — их нужно перечитать после записи
    for (const n of [...touched, 'activity', 'notifs'] as CollName[]) this.dirty.add(n);
    const batch: Batch = { failed: false };
    for (const op of ops) {
      this.pending++;
      this.chain = this.chain
        .then(async () => {
          if (batch.failed) return;
          try {
            await op.run();
          } catch (e) {
            batch.failed = true;
            toast.error(errorMessage(e));
            if (op.coll !== 'workspace') this.dirty.add(op.coll);
            for (const n of touched) this.dirty.add(n);
            void this.qc.invalidateQueries({ queryKey: ['session'] });
          }
        })
        .finally(() => {
          if (--this.pending === 0) this.scheduleFlush(0);
        });
    }
  }

  /** Отметить коллекции устаревшими (событие realtime); перечитываются, когда нет своих запросов в полёте */
  refresh(names: CollName[]) {
    for (const n of names) this.dirty.add(n);
    this.scheduleFlush();
  }

  private scheduleFlush(delay = 120) {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.pending > 0) return; // после очереди flush запустится сам
      const names = [...this.dirty];
      this.dirty.clear();
      for (const n of names) void this.qc.invalidateQueries({ queryKey: this.key(n) });
    }, delay);
  }

  /** Дождаться конца записи и перечитывания после неё (для тестов и отладки) */
  async settled() {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    await sleep(30);
    do {
      await this.chain;
      await sleep(60);
    } while (this.pending > 0 || this.flushTimer || this.qc.isFetching() > 0);
  }

  dispose() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }
}

const engines = new Map<string, Engine>();

/** Один движок на воркспейс и клиент запросов: общая очередь для задач и CRM сохраняет порядок записи */
export function engineFor(qc: QueryClient, ws: string): Engine {
  const k = ws;
  let e = engines.get(k);
  if (!e || e.qc !== qc) engines.set(k, (e = new Engine(qc, ws)));
  return e;
}

/* ============================== realtime → коллекции ============================== */

const ALL: CollName[] = COLL_ORDER;

/** Какие коллекции затрагивает событие журнала (entity из recordEvent) */
export function collectionsFor(entity: string): CollName[] {
  switch (entity) {
    case 'task':
      return ['tasks', 'projects', 'activity', 'notifs'];
    case 'project':
      return ['projects', 'tasks', 'files', 'savedViews', 'events', 'activity'];
    case 'status':
      return ['statuses', 'tasks'];
    case 'comment':
      return ['comments', 'activity', 'notifs'];
    case 'time_log':
      return ['timeLogs', 'tasks'];
    case 'notification':
      return ['notifs'];
    case 'member':
    case 'invite':
      return ['members'];
    case 'team':
      return ['teams', 'members', 'projects'];
    case 'saved_view':
      return ['savedViews'];
    case 'calendar_event':
      return ['events'];
    case 'file':
      return ['files', 'activity'];
    case 'company':
      return ['companies'];
    case 'contact':
      return ['contacts'];
    case 'deal':
      return ['deals', 'crmActivities'];
    case 'crm_activity':
      return ['crmActivities'];
    case 'workspace':
      return [];
    default:
      return ALL;
  }
}
