/* Каталог на клиенте: единицы, дерево категорий, характеристики, товары и услуги.
   Всё живёт в кэше TanStack Query под ключом ['ws', id, 'catalog', …]; realtime помечает его устаревшим по событиям
   unit / product_category / attribute_def / product (см. data/realtime.ts). */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FieldOptions, FieldType, ProductKind, VatRate } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId, type MetaField } from '../meta/data';
import { useSession } from '../data/session';
import { uuidv7 } from '../lib/uuid';
import { fmtAmount } from '@/i18n';

export interface Unit {
  id: string;
  code: string;
  name: string;
  symbol: string;
  isBase: boolean;
}

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  /** id предков и самой категории через «/» */
  path: string;
  sortOrder: number;
  /** Товары прямо в категории */
  productCount: number;
}

export interface Attribute {
  id: string;
  categoryId: string;
  key: string;
  name: string;
  type: FieldType;
  required: boolean;
  unit: string;
  options: FieldOptions;
  sortOrder: number;
  /** Унаследована от предка */
  inherited: boolean;
  categoryName: string;
}

export interface Product {
  id: string;
  kind: ProductKind;
  sku: string;
  name: string;
  description: string;
  barcode: string;
  unitCode: string;
  vatRate: VatRate;
  price: string;
  purchasePrice: string;
  /** Срок поставки, дней (в расчёте потребностей) */
  leadDays: number;
  categoryId: string | null;
  /** Поставщик по умолчанию: заказы поставщикам по потребности создаются на него */
  defaultSupplierId: string | null;
  attrs: Record<string, unknown>;
  /** Товар-родитель: вариант товара (комбинация параметров с флажком «разрез склада») */
  parentProductId: string | null;
  /** Значения параметров, дающих вариант: { color: 'white' } */
  variantValues: Record<string, string>;
  isActive: boolean;
  /** Учёт по серийным номерам и гарантия, мес. */
  trackSerials: boolean;
  warrantyMonths: number | null;
  /** Повторить продажу через, дн. (пусто — нет) */
  repeatSaleDays: number | null;
  custom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ProductParams {
  categoryId?: string;
  q?: string;
  kind?: ProductKind;
  active?: boolean;
}

export const catalogKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'catalog', ...rest] as const;

/** Деньги: «1,234.50» / «1 234,50» по языку — строка из API → число для показа. Расчёты идут на сервере и в @gr8r/shared (BigInt), здесь только вывод */
export const money = fmtAmount;

/** Контрагенты: поставщик по умолчанию для товара */
export function useCompanies() {
  const ws = useWsId();
  return useQuery({ queryKey: catalogKey(ws, 'companies'), queryFn: async () => (await call<{ items: { id: string; name: string }[] }>(ws, 'GET', '/companies?limit=200')).items, staleTime: Infinity });
}

export function useUnits() {
  const ws = useWsId();
  return useQuery({ queryKey: catalogKey(ws, 'units'), queryFn: async () => (await call<{ items: Unit[] }>(ws, 'GET', '/units?limit=200')).items, staleTime: Infinity });
}

/** Обозначение единицы по коду ОКЕИ */
export const unitSymbol = (units: Unit[] | undefined, code: string) => units?.find(u => u.code === code)?.symbol ?? code;

export function useCategories() {
  const ws = useWsId();
  return useQuery({ queryKey: catalogKey(ws, 'categories'), queryFn: async () => (await call<{ items: Category[] }>(ws, 'GET', '/product-categories')).items, staleTime: Infinity });
}

export function useAttributes(categoryId: string | null | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: catalogKey(ws, 'attributes', categoryId),
    queryFn: async () => (await call<{ items: Attribute[] }>(ws, 'GET', `/product-categories/${categoryId}/attributes`)).items,
    enabled: !!categoryId,
    staleTime: Infinity,
  });
}

const PAGE = 200;

export function useProducts(params: ProductParams = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: catalogKey(ws, 'products', params),
    queryFn: async () => {
      const rows: Product[] = [];
      for (let offset = 0; offset < 2000; ) {
        const sp = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort: 'name' });
        if (params.categoryId) sp.set('categoryId', params.categoryId);
        if (params.q) sp.set('q', params.q);
        if (params.kind) sp.set('kind', params.kind);
        if (params.active !== undefined) sp.set('active', String(params.active));
        const page = await call<{ items: Product[]; total: number }>(ws, 'GET', `/products?${sp}`);
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

export function useProduct(id: string | undefined) {
  const ws = useWsId();  return useQuery({ queryKey: catalogKey(ws, 'product', id), queryFn: () => call<Product>(ws, 'GET', `/products/${id}`), enabled: !!id, staleTime: 30_000, retry: false });
}

/** Варианты товара: комбинации значений параметров с флажком «разрез склада» */
export function useVariants(productId: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: catalogKey(ws, 'variants', productId), queryFn: async () => (await call<{ items: Product[] }>(ws, 'GET', `/products/${productId}/variants`)).items, enabled: !!productId, staleTime: 30_000 });
}

/** Генератор «создать все комбинации»: по select-параметрам с флажком «разрез склада» */
export function useGenerateVariants() {
  const ws = useWsId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => call<{ created: number; total: number }>(ws, 'POST', `/products/${productId}/variants/generate`),
    onSettled: () => qc.invalidateQueries({ queryKey: catalogKey(ws) }),
  });
}

/** Поиск товаров для выбора в формах (материал в спецификации, товар изделия) */
export const searchProducts = async (ws: string, q: string, kind?: ProductKind, limit = 12) => {
  const sp = new URLSearchParams({ limit: String(limit), sort: 'name', active: 'true' });
  if (q) sp.set('q', q);
  if (kind) sp.set('kind', kind);
  return (await call<{ items: Product[] }>(ws, 'GET', `/products?${sp}`)).items;
};

/** Роль admin и выше: единицы, категории, характеристики и участки меняют они */
export function useIsAdmin() {
  const { active } = useSession();
  return active?.role === 'owner' || active?.role === 'admin';
}

/** Вызов API с обновлением кэша каталога и тостом об ошибке; возвращает null при ошибке */
export function useCatalogApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        await qc.invalidateQueries({ queryKey: catalogKey(ws) });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}

/** Мутации товаров с оптимистичным обновлением списков */
export function useProductMutations() {
  const ws = useWsId();
  const qc = useQueryClient();
  const prefix = catalogKey(ws, 'products');
  const settle = () => qc.invalidateQueries({ queryKey: catalogKey(ws) });
  const patchLists = (fn: (list: Product[]) => Product[]) => qc.setQueriesData<Product[]>({ queryKey: prefix }, old => (old ? fn(old) : old));

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => call<Product>(ws, 'POST', '/products', { id: uuidv7(), ...body }),
    onSuccess: row => patchLists(list => (list.some(r => r.id === row.id) ? list : [...list, row])),
    onSettled: settle,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown> }) => call<Product>(ws, 'PATCH', `/products/${v.id}`, v.patch),
    onMutate: v => {
      const snap = qc.getQueriesData<Product[]>({ queryKey: prefix });
      const single = qc.getQueryData<Product>(catalogKey(ws, 'product', v.id));
      const apply = (p: Product): Product => {
        const next: Product = { ...p, ...(v.patch as Partial<Product>) };
        if (v.patch.attrs) {
          const attrs = { ...p.attrs };
          for (const [k, x] of Object.entries(v.patch.attrs as Record<string, unknown>)) if (x === null || x === '') delete attrs[k];
          else attrs[k] = x;
          next.attrs = attrs;
        }
        if (v.patch.custom) {
          const custom = { ...p.custom };
          for (const [k, x] of Object.entries(v.patch.custom as Record<string, unknown>)) if (x === null || x === '') delete custom[k];
          else custom[k] = x;
          next.custom = custom;
        }
        return next;
      };
      patchLists(list => list.map(p => (p.id === v.id ? apply(p) : p)));
      if (single) qc.setQueryData(catalogKey(ws, 'product', v.id), apply(single));
      return { snap, single };
    },
    onError: (e, v, ctx) => {
      for (const [key, data] of ctx?.snap ?? []) qc.setQueryData(key, data);
      if (ctx?.single) qc.setQueryData(catalogKey(ws, 'product', v.id), ctx.single);
      toast.error(errorMessage(e));
    },
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => call(ws, 'DELETE', `/products/${id}`),
    onMutate: id => patchLists(list => list.filter(r => r.id !== id)),
    onError: e => toast.error(errorMessage(e)),
    onSettled: settle,
  });
  const restore = useMutation({ mutationFn: (id: string) => call(ws, 'POST', `/products/${id}/restore`), onSettled: settle });
  return { create, update, remove, restore };
}

/* ---------------- нормы времени работ ---------------- */

/** Норма времени работы: норма на единицу и участок по умолчанию (таблица operations) */
export interface WorkNorm {
  productId: string;
  name: string;
  sku: string;
  unitCode: string;
  archived: boolean;
  /** Норма времени на единицу работы, ч */
  normHours: string;
  /** Участок по умолчанию */
  workCenterId: string | null;
}

export function useWorkNorms() {
  const ws = useWsId();
  return useQuery({ queryKey: catalogKey(ws, 'work-norms'), queryFn: () => call<{ items: WorkNorm[] }>(ws, 'GET', '/services/work-norms'), staleTime: Infinity });
}

/** Норма времени работы и участок по умолчанию */
export function useSaveWorkNorm() {
  const ws = useWsId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { productId: string; normHours: string; workCenterId?: string | null }) => call(ws, 'PUT', `/services/work-norms/${v.productId}`, { normHours: v.normHours, workCenterId: v.workCenterId ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKey(ws, 'work-norms') }),
    onError: e => toast.error(errorMessage(e)),
  });
}

/** Участки: список для выбора участка по умолчанию у работы */
export function useWorkCenters() {
  const ws = useWsId();
  return useQuery({ queryKey: catalogKey(ws, 'work-centers'), queryFn: () => call<{ items: { id: string; name: string }[] }>(ws, 'GET', '/work-centers?limit=200'), staleTime: Infinity });
}

/* ---------------- дерево категорий ---------------- */

export interface CategoryNode extends Category {
  children: CategoryNode[];
  depth: number;
  /** Товары в категории и во всех подкатегориях */
  total: number;
}

export function buildCategoryTree(list: Category[]): CategoryNode[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of list) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  const make = (c: Category, depth: number): CategoryNode => {
    const children = (byParent.get(c.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(k => make(k, depth + 1));
    return { ...c, children, depth, total: c.productCount + children.reduce((s, k) => s + k.total, 0) };
  };
  return (byParent.get(null) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(c => make(c, 0));
}

/** Дерево плоским списком в порядке обхода (для select и таблицы) */
export const flattenTree = (nodes: CategoryNode[]): CategoryNode[] => nodes.flatMap(n => [n, ...flattenTree(n.children)]);

/** Название категории с цепочкой предков: «Мебель / Столы» */
export function categoryPath(list: Category[] | undefined, id: string | null | undefined): string {
  if (!list || !id) return '';
  const by = new Map(list.map(c => [c.id, c]));
  const c = by.get(id);
  return c ? c.path.split('/').map(x => by.get(x)?.name ?? '').filter(Boolean).join(' / ') : '';
}

/** Характеристика категории как поле конструктора: те же FieldInput / FieldValue / validateRecord */
export const attributeAsField = (a: Attribute): MetaField => ({
  id: a.id,
  entityId: a.categoryId,
  key: a.key,
  name: a.unit ? `${a.name}, ${a.unit}` : a.name,
  type: a.type,
  required: a.required,
  unique: false,
  filterable: false,
  options: a.options,
  sortOrder: a.sortOrder,
  isSystem: false,
  archivedAt: null,
});
