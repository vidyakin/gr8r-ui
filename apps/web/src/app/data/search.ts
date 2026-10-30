/* Поиск по воркспейсу и недавние запросы — порт searchAll из pages/search.js и recentSearches из core/store.js */
import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { searchRecords, type RecordHit } from '../meta/data';
import { searchProducts, type Product } from '../catalog/data';
import { searchItems, type Item } from '../production/data';
import { searchDocuments, type DocListItem } from '../docs/data';
import { useSession } from './session';
import { allTasks, canSee, project, task, visibleProjects } from './selectors';
import type { Comment, Member, Project, ProjectFile, Task, WorkspaceData } from './types';

export interface SearchResults {
  tasks: Task[];
  projects: Project[];
  people: Member[];
  files: ProjectFile[];
  comments: Comment[];
}

export type SearchCat = 'all' | keyof SearchResults;

export function searchAll(d: WorkspaceData, query: string): SearchResults {
  const q = query.trim().toLowerCase();
  if (!q) return { tasks: [], projects: [], people: [], files: [], comments: [] };
  const has = (s?: string) => (s || '').toLowerCase().includes(q);
  return {
    tasks: allTasks(d)
      .filter(t => has(t.title) || has(t.key) || has(t.desc.replace(/<[^>]+>/g, '')))
      .slice(0, 30),
    projects: visibleProjects(d).filter(p => has(p.name) || has(p.desc)),
    people: d.members.filter(m => has(m.name) || has(m.email) || has(m.title)),
    files: d.files.filter(f => has(f.name) && canSee(d, project(d, f.project))),
    comments: d.comments.filter(c => has(c.text) && task(d, c.task) && canSee(d, project(d, task(d, c.task)!.project))),
  };
}

/* ---------- недавние запросы: живут в localStorage, как и остальные настройки интерфейса ---------- */

const KEY = 'gr8r-ui.recent-searches';
const SEED: string[] = []; // стартовых подсказок нет: показываем только то, что пользователь искал сам
let cache: string[] | null = null;
const subs = new Set<() => void>();

function load(): string[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as string[]) : SEED;
  } catch {
    cache = SEED;
  }
  return cache;
}

/** Запомнить запрос: новые — сверху, не больше 5 */
export function addRecentSearch(q: string) {
  const cur = load();
  if (!q || cur.includes(q)) return;
  cache = [q, ...cur].slice(0, 5);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* хранилище недоступно — держим в памяти */
  }
  subs.forEach(f => f());
}

export function useRecentSearches() {
  return React.useSyncExternalStore(
    cb => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    load,
  );
}

/* ---------- записи своих сущностей (конструктор): ищет сервер, результат приходит отдельно от локального поиска ---------- */

/** Совпадения в записях пользовательских сущностей; запрос уходит после паузы в наборе */
export function useRecordHits(query: string): RecordHit[] {
  const ws = useSession().active?.id;
  const q = query.trim();
  const [debounced, setDebounced] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 180);
    return () => clearTimeout(t);
  }, [q]);
  const r = useQuery({ queryKey: ['ws', ws, 'record-hits', debounced], queryFn: () => searchRecords(ws!, debounced, 5), enabled: !!ws && debounced.length > 0, staleTime: 10_000, placeholderData: keepPreviousData });
  return q && r.data ? r.data : [];
}

/* ---------- товары каталога и продукция производства: ищет сервер, как и записи конструктора ---------- */

export interface CatalogHits {
  products: Product[];
  items: Item[];
}

const NO_HITS: CatalogHits = { products: [], items: [] };

/** Совпадения в каталоге (товары и услуги) и в производстве (изделия и полуфабрикаты); запрос уходит после паузы в наборе */
export function useCatalogHits(query: string): CatalogHits {
  const ws = useSession().active?.id;
  const q = query.trim();
  const [debounced, setDebounced] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 180);
    return () => clearTimeout(t);
  }, [q]);
  const r = useQuery({
    queryKey: ['ws', ws, 'catalog', 'palette', debounced],
    queryFn: async (): Promise<CatalogHits> => {
      const [products, items] = await Promise.all([searchProducts(ws!, debounced, undefined, 5), searchItems(ws!, debounced, 5)]);
      return { products, items };
    },
    enabled: !!ws && debounced.length > 0,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
  return q && r.data ? r.data : NO_HITS;
}

/* ---------- документы продаж и закупок: поиск по номеру, контрагенту и комментарию (на сервере) ---------- */

const NO_DOCS: DocListItem[] = [];

export function useDocumentHits(query: string): DocListItem[] {
  const ws = useSession().active?.id;
  const q = query.trim();
  const [debounced, setDebounced] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 180);
    return () => clearTimeout(t);
  }, [q]);
  const r = useQuery({ queryKey: ['ws', ws, 'docs', 'palette', debounced], queryFn: () => searchDocuments(ws!, debounced, 6), enabled: !!ws && debounced.length > 0, staleTime: 10_000, placeholderData: keepPreviousData });
  return q && r.data ? r.data : NO_DOCS;
}
