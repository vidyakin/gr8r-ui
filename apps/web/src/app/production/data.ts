/* Производство на клиенте: один снимок воркспейса (продукция со строками спецификаций, участки, материалы, настройки)
   и мутации с оптимистичным обновлением. Себестоимость считается здесь же чистой функцией computeBomCost из @gr8r/shared
   (той же, что на сервере), поэтому любая правка строки пересчитывает дерево и итоги мгновенно, не дожидаясь ответа сервера. */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BomCycleError, computeBomCost, resolveMaterialPrice, wouldCreateCycle, type BomItemInput, type CostNode, type MaterialPriceSource, type ProductKind, type SemiMode } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { uuidv7 } from '../lib/uuid';

export interface BomLine {
  id: string;
  itemId: string;
  kind: 'material' | 'semi' | 'work';
  sortOrder: number;
  productId: string | null;
  childItemId: string | null;
  /** Режим полуфабриката: stock — списать со склада, explode — развернуть до материалов */
  semiMode: SemiMode;
  qty: string;
  unitCode: string | null;
  scrapPct: string;
  operation: string;
  workCenterId: string | null;
  hours: string;
  rate: string | null;
  fixedCost: string | null;
  note: string;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  kind: 'product' | 'semi';
  unitCode: string;
  productId: string | null;
  batchQty: string;
  overheadPct: string;
  createdAt: string;
  updatedAt: string;
  lines: BomLine[];
}

export interface WorkCenter {
  id: string;
  code: string;
  name: string;
  hourlyRate: string;
  /** Склад-цех участка */
  warehouseId: string | null;
  note: string;
  archivedAt: string | null;
}

export interface Material {
  id: string;
  name: string;
  sku: string;
  kind: ProductKind;
  unitCode: string;
  price: string;
  purchasePrice: string;
  /** Средняя себестоимость склада (взвешенная по складам); null — товара нет на остатках */
  avgCost?: string | null;
  archived: boolean;
}

export interface Snapshot {
  settings: { materialPriceSource: MaterialPriceSource };
  items: Item[];
  workCenters: WorkCenter[];
  materials: Material[];
}

export const productionKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'production', ...rest] as const;

export function useSnapshot() {
  const ws = useWsId();
  return useQuery({ queryKey: productionKey(ws, 'snapshot'), queryFn: () => call<Snapshot>(ws, 'GET', '/production/snapshot'), staleTime: Infinity });
}

export const PRICE_SOURCE_LABEL: Record<MaterialPriceSource, string> = { purchase: 'purchase price', price: 'sale price', avg_cost: 'average warehouse cost' };

/** Строка потребности: сколько нужно, сколько доступно и сколько не хватает */
export interface NeedRow {
  kind: 'material' | 'semi';
  productId: string | null;
  itemId: string | null;
  name: string;
  unitCode: string | null;
  qty: string;
  available: string;
  deficit: string;
  /** Сколько нужно выпустить (полуфабрикат) */
  produce: string;
}

/** Развёртка спецификации на количество: потребность в материалах, работах и полуфабрикатах */
export interface Explosion {
  itemId: string;
  qty: string;
  batchQty: string;
  warehouseId: string | null;
  materials: NeedRow[];
  semis: NeedRow[];
  works: { operation: string; workCenterId: string | null; hours: string }[];
}

/** Потребность по развёртке: остатки считает сервер, поэтому запрос отдельный */
export function useExplosion(itemId: string | undefined, qty: string, warehouseId: string | null) {
  const ws = useWsId();
  return useQuery({
    queryKey: productionKey(ws, 'explode', itemId ?? '', qty, warehouseId ?? ''),
    queryFn: () => call<Explosion>(ws, 'GET', `/manufactured-items/${itemId}/explode?qty=${encodeURIComponent(qty)}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`),
    enabled: !!itemId,
    staleTime: 30_000,
  });
}

const toInput = (i: Item): BomItemInput => ({ ...i, lines: i.lines });

export interface Costing {
  /** Дерево себестоимости изделия; null — расчёт невозможен (циклы) */
  tree: CostNode | null;
  error: string | null;
}

/** Функция расчёта себестоимости по снимку: подставляет цены по выбранному источнику и ставки участков */
export function makeCosting(snap: Snapshot) {
  const mats = new Map(snap.materials.map(m => [m.id, m]));
  const rates = new Map(snap.workCenters.map(w => [w.id, w.hourlyRate]));
  const inputs = snap.items.map(toInput);
  const pricing = {
    materialPrice: (id: string) => (mats.has(id) ? resolveMaterialPrice(snap.settings.materialPriceSource, mats.get(id)!, mats.get(id)!.avgCost) : null),
    workCenterRate: (id: string) => rates.get(id),
  };
  return (itemId: string): Costing => {
    try {
      return { tree: computeBomCost(inputs, itemId, pricing), error: null };
    } catch (e) {
      return { tree: null, error: e instanceof BomCycleError ? e.message : errorMessage(e) };
    }
  };
}

export function useCosting(snap: Snapshot | undefined) {
  return React.useMemo(() => (snap ? makeCosting(snap) : null), [snap]);
}

/** Рёбра «изделие → полуфабрикаты» для проверки циклов в форме (сервер проверяет сам) */
export function bomEdges(items: Item[]) {
  const edges = new Map<string, string[]>();
  for (const i of items) edges.set(i.id, i.lines.filter(l => l.kind === 'semi' && l.childItemId).map(l => l.childItemId!));
  return edges;
}
export const canInclude = (items: Item[], itemId: string, childId: string) => !wouldCreateCycle(bomEdges(items), itemId, childId);

/** Мутации производства: правка снимка в кэше сразу (onMutate), сервер подтверждает, при ошибке — откат и тост */
export function useProductionMutations() {
  const ws = useWsId();
  const qc = useQueryClient();
  const key = productionKey(ws, 'snapshot');
  const edit = (fn: (s: Snapshot) => Snapshot) => qc.setQueryData<Snapshot>(key, old => (old ? fn(old) : old));
  const settle = () => qc.invalidateQueries({ queryKey: productionKey(ws) });
  const rollback = (e: unknown, snap?: Snapshot) => {
    if (snap) qc.setQueryData(key, snap);
    toast.error(errorMessage(e));
  };
  const withItem = (id: string, fn: (i: Item) => Item) => edit(s => ({ ...s, items: s.items.map(i => (i.id === id ? fn(i) : i)) }));

  const updateItem = useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown> }) => call(ws, 'PATCH', `/manufactured-items/${v.id}`, v.patch),
    onMutate: v => {
      const snap = qc.getQueryData<Snapshot>(key);
      withItem(v.id, i => ({ ...i, ...(v.patch as Partial<Item>), ...(v.patch.batchQty !== undefined ? { batchQty: String(v.patch.batchQty) } : {}), ...(v.patch.overheadPct !== undefined ? { overheadPct: String(v.patch.overheadPct) } : {}) }));
      return snap;
    },
    onError: (e, _v, snap) => rollback(e, snap),
    onSettled: settle,
  });

  const updateLine = useMutation({
    mutationFn: (v: { id: string; itemId: string; patch: Record<string, unknown> }) => call(ws, 'PATCH', `/bom-lines/${v.id}`, v.patch),
    onMutate: v => {
      const snap = qc.getQueryData<Snapshot>(key);
      withItem(v.itemId, i => ({ ...i, lines: i.lines.map(l => (l.id === v.id ? ({ ...l, ...Object.fromEntries(Object.entries(v.patch).map(([k, x]) => [k, x === null || typeof x === 'string' ? x : String(x)])) } as BomLine) : l)) }));
      return snap;
    },
    onError: (e, _v, snap) => rollback(e, snap),
    onSettled: settle,
  });

  const removeLine = useMutation({
    mutationFn: (v: { id: string; itemId: string }) => call(ws, 'DELETE', `/bom-lines/${v.id}`),
    onMutate: v => {
      const snap = qc.getQueryData<Snapshot>(key);
      withItem(v.itemId, i => ({ ...i, lines: i.lines.filter(l => l.id !== v.id) }));
      return snap;
    },
    onError: (e, _v, snap) => rollback(e, snap),
    onSettled: settle,
  });

  const reorder = useMutation({
    mutationFn: (v: { itemId: string; ids: string[] }) => call(ws, 'POST', `/manufactured-items/${v.itemId}/lines/reorder`, { ids: v.ids }),
    onMutate: v => {
      const snap = qc.getQueryData<Snapshot>(key);
      withItem(v.itemId, i => ({ ...i, lines: v.ids.map((id, n) => ({ ...i.lines.find(l => l.id === id)!, sortOrder: n })) }));
      return snap;
    },
    onError: (e, _v, snap) => rollback(e, snap),
    onSettled: settle,
  });

  /** Новая строка. `material` / `child` — данные выбранного товара или продукции: строка и её единица видны сразу */
  const addLine = useMutation({
    mutationFn: (v: { itemId: string; body: Record<string, unknown>; id: string; material?: Material }) => call<BomLine>(ws, 'POST', `/manufactured-items/${v.itemId}/lines`, { ...v.body, id: v.id }),
    onMutate: v => {
      const snap = qc.getQueryData<Snapshot>(key);
      const b = v.body as Record<string, string | number | null | undefined>;
      edit(s => {
        const items = s.items.map(i => {
          if (i.id !== v.itemId) return i;
          const child = s.items.find(x => x.id === b.childItemId);
          const mat = v.material;
          const line: BomLine = {
            id: v.id,
            itemId: v.itemId,
            kind: b.kind as BomLine['kind'],
            sortOrder: i.lines.length,
            productId: (b.productId as string) ?? null,
            childItemId: (b.childItemId as string) ?? null,
            semiMode: (b.semiMode as SemiMode) ?? 'stock',
            qty: String(b.qty ?? '1'),
            unitCode: mat?.unitCode ?? child?.unitCode ?? null,
            scrapPct: String(b.scrapPct ?? '0'),
            operation: String(b.operation ?? ''),
            workCenterId: (b.workCenterId as string) ?? null,
            hours: String(b.hours ?? '0'),
            rate: b.rate == null ? null : String(b.rate),
            fixedCost: b.fixedCost == null ? null : String(b.fixedCost),
            note: '',
          };
          return { ...i, lines: [...i.lines, line] };
        });
        const mat = v.material;
        return { ...s, items, materials: mat && !s.materials.some(m => m.id === mat.id) ? [...s.materials, mat] : s.materials };
      });
      return snap;
    },
    onError: (e, _v, snap) => rollback(e, snap),
    onSettled: settle,
  });

  const createItem = useMutation({
    mutationFn: (body: Record<string, unknown>) => call<Item>(ws, 'POST', '/manufactured-items', { id: uuidv7(), ...body }),
    onSettled: settle,
  });
  const removeItem = useMutation({
    mutationFn: (id: string) => call(ws, 'DELETE', `/manufactured-items/${id}`),
    onSettled: settle,
  });
  return { updateItem, updateLine, removeLine, reorder, addLine, createItem, removeItem };
}

export type ProductionMutations = ReturnType<typeof useProductionMutations>;

/** Вызов API производства с обновлением снимка (участки, настройки) */
export function useProductionApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        await qc.invalidateQueries({ queryKey: productionKey(ws) });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}

/** Поиск продукции для палитры команд */
export const searchItems = async (ws: string, q: string, limit = 5) => (await call<{ items: Item[] }>(ws, 'GET', `/manufactured-items?q=${encodeURIComponent(q)}&limit=${limit}`)).items;

/** Название продукции из уже загруженного снимка (для крошек в топбаре): запрос не отправляется, только подписка на кэш */
export function useCachedItemName(id: string | undefined): string | undefined {
  const ws = useWsId();
  const q = useQuery<Snapshot>({ queryKey: productionKey(ws, 'snapshot'), queryFn: () => call<Snapshot>(ws, 'GET', '/production/snapshot'), enabled: false, staleTime: Infinity });
  return id ? q.data?.items.find(i => i.id === id)?.name : undefined;
}
