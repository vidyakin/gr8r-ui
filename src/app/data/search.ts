/* Поиск по воркспейсу и недавние запросы — порт searchAll из pages/search.js и recentSearches из core/store.js */
import * as React from 'react';
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
const SEED = ['homepage', 'Sarah', 'wireframes'];
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
