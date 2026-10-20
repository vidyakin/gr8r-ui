/* Конструктор сущностей на клиенте: метаданные (сущности + поля) и записи пользовательских сущностей.
   Живут в кэше TanStack Query: ['ws', id, 'meta'] и ['ws', id, 'records', ключ, параметры]. Записи меняются оптимистично,
   realtime (см. data/realtime.ts) помечает кэш устаревшим по событиям entity / field / record. */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FieldOptions, FieldType } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { API_BASE, errorMessage, ok } from '../data/api';
import { useSession } from '../data/session';
import { uuidv7 } from '../lib/uuid';

export interface MetaField {
  id: string;
  entityId: string;
  key: string;
  name: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  filterable: boolean;
  options: FieldOptions;
  sortOrder: number;
  isSystem: boolean;
  archivedAt: string | null;
}

export interface MetaEntity {
  id: string;
  key: string;
  name: string;
  kind: 'system' | 'custom';
  icon: string;
  titleField: string;
  sortOrder: number;
  archivedAt: string | null;
  fields: MetaField[];
}

export interface DataRecord {
  id: string;
  entityId: string;
  data: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface RecordParams {
  q?: string;
  /** filter=ключ:оператор:значение */
  filters?: string[];
  sort?: string;
}

/** Запрос к API с заголовком воркспейса; ошибки разбирает ok() (ApiError с сообщением сервера) */
export function call<T>(ws: string, method: string, path: string, json?: unknown): Promise<T> {
  return ok<T>(
    fetch(`${API_BASE()}${path}`, {
      method,
      credentials: 'include',
      headers: { 'X-Workspace-Id': ws, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    }),
  );
}

export function useWsId(): string {
  const { active } = useSession();
  if (!active) throw new Error('Нет активного воркспейса');
  return active.id;
}

export const metaKey = (ws: string) => ['ws', ws, 'meta'] as const;
export const recordsKey = (ws: string, entity?: string, params?: RecordParams) => (entity ? (['ws', ws, 'records', entity, params ?? {}] as const) : (['ws', ws, 'records'] as const));

const byOrder = (a: MetaField, b: MetaField) => a.sortOrder - b.sortOrder;

/** Все сущности воркспейса (в том числе удалённые — для раздела настроек) вместе с полями */
export function useAllEntities() {
  const ws = useWsId();
  return useQuery({
    queryKey: metaKey(ws),
    queryFn: async () => (await call<{ items: MetaEntity[] }>(ws, 'GET', '/entities?archived=include')).items.map(e => ({ ...e, fields: [...e.fields].sort(byOrder) })),
    staleTime: Infinity,
  });
}

const NONE: MetaEntity[] = [];

/** Действующие сущности (без удалённых) */
export function useEntities(): MetaEntity[] {
  const { data } = useAllEntities();
  return React.useMemo(() => (data ?? NONE).filter(e => !e.archivedAt), [data]);
}

export const useCustomEntities = () => {
  const all = useEntities();
  return React.useMemo(() => all.filter(e => e.kind === 'custom'), [all]);
};

export const activeFields = (e: MetaEntity | undefined) => (e?.fields ?? []).filter(f => !f.archivedAt);

/** Действующие поля сущности (для системных — пользовательские поля задач, сделок…) */
export function useEntityFields(key: string): MetaField[] {
  const all = useEntities();
  return React.useMemo(() => activeFields(all.find(e => e.key === key)), [all, key]);
}

/* ---------------- записи ---------------- */

const PAGE = 200;

/** Все записи сущности, подходящие под фильтры (страницами по 200, не больше 2000) */
export function useRecords(entity: string, params: RecordParams = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: recordsKey(ws, entity, params),
    queryFn: async () => {
      const rows: DataRecord[] = [];
      for (let offset = 0; offset < 2000; ) {
        const sp = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
        if (params.q) sp.set('q', params.q);
        if (params.sort) sp.set('sort', params.sort);
        for (const f of params.filters ?? []) sp.append('filter', f);
        const page = await call<{ items: DataRecord[]; total: number }>(ws, 'GET', `/data/${entity}?${sp}`);
        rows.push(...page.items);
        offset += page.items.length;
        if (!page.items.length || offset >= page.total) break;
      }
      return rows;
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

/** Одна запись (для ссылок и карточки): из кэша списков или отдельным запросом */
export function useRecord(entity: string, id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: ['ws', ws, 'record', entity, id], queryFn: () => call<DataRecord>(ws, 'GET', `/data/${entity}/${id}`), enabled: !!id, staleTime: 30_000, retry: false });
}

/** Подпись ссылки: заголовок записи системной или пользовательской сущности */
const SYSTEM_PATH: Record<string, { path: string; title: string }> = {
  task: { path: 'tasks', title: 'title' },
  project: { path: 'projects', title: 'name' },
  deal: { path: 'deals', title: 'name' },
  company: { path: 'companies', title: 'name' },
  contact: { path: 'contacts', title: 'name' },
};

export interface RefItem {
  id: string;
  title: string;
}

/** Поиск записей для выбора в ref-поле */
export async function searchRefs(ws: string, entity: MetaEntity | undefined, entityKey: string, q: string): Promise<RefItem[]> {
  const sys = SYSTEM_PATH[entityKey];
  const sp = new URLSearchParams({ limit: '12' });
  if (q) sp.set('q', q);
  if (sys) {
    const page = await call<{ items: Record<string, unknown>[] }>(ws, 'GET', `/${sys.path}?${sp}`);
    return page.items.map(r => ({ id: r.id as string, title: String(r[sys.title] ?? '') }));
  }
  const page = await call<{ items: DataRecord[] }>(ws, 'GET', `/data/${entityKey}?${sp}`);
  const tf = entity?.titleField ?? 'name';
  return page.items.map(r => ({ id: r.id, title: String(r.data[tf] ?? '') }));
}

/** Заголовок записи по id (кэшируется) */
export function useRefTitle(entityKey: string, id: string | undefined): string | undefined {
  const ws = useWsId();
  const entities = useEntities();
  const q = useQuery({
    queryKey: ['ws', ws, 'ref-title', entityKey, id],
    enabled: !!id,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const sys = SYSTEM_PATH[entityKey];
      if (sys) return String((await call<Record<string, unknown>>(ws, 'GET', `/${sys.path}/${id}`))[sys.title] ?? '');
      const r = await call<DataRecord>(ws, 'GET', `/data/${entityKey}/${id}`);
      return String(r.data[entities.find(e => e.key === entityKey)?.titleField ?? 'name'] ?? '');
    },
  });
  return q.data;
}

/** Мутации записей с оптимистичным обновлением кэша списков */
export function useRecordMutations(entity: string) {
  const ws = useWsId();
  const qc = useQueryClient();
  const prefix = ['ws', ws, 'records', entity] as const;
  const settle = () => qc.invalidateQueries({ queryKey: prefix });
  const patchLists = (fn: (list: DataRecord[]) => DataRecord[]) => qc.setQueriesData<DataRecord[]>({ queryKey: prefix }, old => (old ? fn(old) : old));

  const create = useMutation({
    mutationFn: async (data: Record<string, unknown>) => call<DataRecord>(ws, 'POST', `/data/${entity}`, { id: uuidv7(), data }),
    onSuccess: row => patchLists(list => (list.some(r => r.id === row.id) ? list : [...list, row])),
    onSettled: settle,
  });
  const update = useMutation({
    mutationFn: async (v: { id: string; data: Record<string, unknown> }) => call<DataRecord>(ws, 'PATCH', `/data/${entity}/${v.id}`, { data: v.data }),
    onMutate: v => {
      const snap = qc.getQueriesData<DataRecord[]>({ queryKey: prefix });
      patchLists(list =>
        list.map(r => {
          if (r.id !== v.id) return r;
          const data = { ...r.data };
          for (const [k, x] of Object.entries(v.data)) if (x === null || x === '') delete data[k];
          else data[k] = x;
          return { ...r, data };
        }),
      );
      return snap;
    },
    onError: (e, _v, snap) => {
      for (const [key, data] of snap ?? []) qc.setQueryData(key, data);
      toast.error(errorMessage(e));
    },
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => call(ws, 'DELETE', `/data/${entity}/${id}`),
    onMutate: id => patchLists(list => list.filter(r => r.id !== id)),
    onError: e => toast.error(errorMessage(e)),
    onSettled: settle,
  });
  const restore = useMutation({ mutationFn: async (id: string) => call(ws, 'POST', `/data/${entity}/${id}/restore`), onSettled: settle });
  return { create, update, remove, restore };
}

/* ---------------- поиск для палитры команд ---------------- */

export interface RecordHit {
  entityKey: string;
  entityName: string;
  icon: string;
  id: string;
  title: string;
}

export const searchRecords = async (ws: string, q: string, limit = 5): Promise<RecordHit[]> =>
  (await call<{ items: RecordHit[] }>(ws, 'GET', `/data-search?q=${encodeURIComponent(q)}&limit=${limit}`)).items;
