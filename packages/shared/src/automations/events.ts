/* События журнала `events` в терминах автоматизаций: к какой сущности относится событие, что произошло и какие поля изменились. */
import { BUILTIN_FIELDS } from './entities';

export interface FlowEvent {
  id: string;
  workspaceId: string;
  /** 'task.updated', 'record.created', 'document.posted' … */
  type: string;
  /** 'task', 'deal', 'record' (запись пользовательской сущности), 'document' … */
  entity: string;
  recordId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
}

/** Метка происхождения события: его породил flow. По ней движок не даёт flow запустить сам себя (цепочка) */
export interface EventVia {
  runId: string;
  flowId: string;
  /** Идентификаторы всех flow в цепочке, включая породивший событие */
  chain: string[];
}

/** Максимальная длина цепочки flow → событие → flow → …: дальше события игнорируются */
export const MAX_FLOW_CHAIN = 4;

export const eventVia = (ev: Pick<FlowEvent, 'payload'>): EventVia | null => {
  const v = ev.payload.via as Partial<EventVia> | undefined;
  return v && typeof v === 'object' && Array.isArray(v.chain) ? { runId: String(v.runId ?? ''), flowId: String(v.flowId ?? ''), chain: v.chain.map(String) } : null;
};

/** Ключ сущности: у записей пользовательских сущностей событие общее (`record.*`), ключ лежит в payload.entityKey */
export const eventEntity = (ev: Pick<FlowEvent, 'entity' | 'payload'>): string => (ev.entity === 'record' ? String(ev.payload.entityKey ?? '') : ev.entity);

const DOC_UPDATES: Record<string, string> = { posted: 'posted', unposted: 'draft', cancelled: 'cancelled', restored: 'draft' };

/** created | updated | deleted | archived | restored … Проведение и отмена документа — это изменение документа */
export function eventAction(ev: Pick<FlowEvent, 'type' | 'entity'>): string {
  const a = ev.type.slice(ev.type.indexOf('.') + 1);
  if (ev.entity === 'document' && a in DOC_UPDATES) return 'updated';
  return a;
}

export interface FieldChange {
  from?: unknown;
  to?: unknown;
}

const isFromTo = (v: unknown): v is FieldChange => !!v && typeof v === 'object' && !Array.isArray(v) && ('to' in v || 'from' in v) && Object.keys(v).every(k => k === 'from' || k === 'to');

/** Изменения полей из payload события в единой форме `{поле: {from?, to?}}`. Значения пользовательских полей
    (`custom`) разворачиваются в отдельные ключи; встроенные колонки имеют приоритет при совпадении имён. */
export function eventChanges(ev: Pick<FlowEvent, 'type' | 'entity' | 'payload'>): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  const raw = ev.payload.changes;
  if (Array.isArray(raw)) for (const k of raw) out[String(k)] = {}; // document.updated: перечень ключей без значений
  else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const ch: FieldChange = isFromTo(v) ? v : { to: v }; // record.updated: патч «ключ → новое значение»
      if (k === 'custom' && isFromTo(v)) continue;
      out[k] = ch;
    }
    const custom = (raw as Record<string, unknown>).custom;
    if (isFromTo(custom)) {
      const from = (custom.from ?? {}) as Record<string, unknown>;
      const to = (custom.to ?? {}) as Record<string, unknown>;
      for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
        if (JSON.stringify(from[k]) !== JSON.stringify(to[k]) && !(k in out)) out[k] = { from: from[k], to: to[k] };
      }
    }
  }
  if (ev.entity === 'document') {
    const a = ev.type.slice(ev.type.indexOf('.') + 1);
    if (a in DOC_UPDATES) out.status = { to: DOC_UPDATES[a] };
  }
  return out;
}

/** Ключи встроенных колонок сущности (для подсказок интерфейса) */
export const builtinKeys = (entity: string) => (BUILTIN_FIELDS[entity] ?? []).map(f => f.key);
