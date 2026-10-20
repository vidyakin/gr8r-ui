/* Дерево подзадач — чистые функции обхода и изменения без мутаций.
   Идентификаторы подзадач уникальны внутри задачи, поэтому все операции принимают id, а не путь. */
import type { Subtask } from './types';

/** Подзадача по id на любой глубине */
export function findSub(list: Subtask[], id: string | null | undefined): Subtask | undefined {
  if (!id) return undefined;
  for (const s of list) {
    if (s.id === id) return s;
    const f = findSub(s.subtasks, id);
    if (f) return f;
  }
  return undefined;
}

/** Путь от корня до подзадачи включительно (пустой, если такой нет) */
export function subPath(list: Subtask[], id: string | null | undefined): Subtask[] {
  if (!id) return [];
  for (const s of list) {
    if (s.id === id) return [s];
    const rest = subPath(s.subtasks, id);
    if (rest.length) return [s, ...rest];
  }
  return [];
}

/** Соседи одного уровня (включая саму подзадачу): список родителя или корневой список задачи */
export function siblingsOf(list: Subtask[], id: string): Subtask[] {
  const path = subPath(list, id);
  return path.length > 1 ? path[path.length - 2].subtasks : list;
}

/** Все подзадачи поддерева в порядке обхода (корень списка включён) */
export function flattenSubs(list: Subtask[], depth = 0): { sub: Subtask; depth: number }[] {
  return list.flatMap(s => [{ sub: s, depth }, ...flattenSubs(s.subtasks, depth + 1)]);
}

/** Счётчик «готово / всего» по всему поддереву */
export function countSubs(list: Subtask[]) {
  let done = 0;
  let total = 0;
  for (const { sub } of flattenSubs(list)) {
    total++;
    if (sub.done) done++;
  }
  return { done, total };
}

/** id подзадачи и всех её потомков */
export function subtreeIds(s: Subtask): Set<string> {
  return new Set(flattenSubs([s]).map(x => x.sub.id));
}

/** Заменяет подзадачу результатом fn (вложенные изменения подхватывает fn сам) */
export function mapSub(list: Subtask[], id: string, fn: (s: Subtask) => Subtask): Subtask[] {
  return list.map(s => (s.id === id ? fn(s) : s.subtasks.length ? { ...s, subtasks: mapSub(s.subtasks, id, fn) } : s));
}

/** Удаляет ветку целиком */
export function removeSub(list: Subtask[], id: string): Subtask[] {
  return list.filter(s => s.id !== id).map(s => (s.subtasks.length ? { ...s, subtasks: removeSub(s.subtasks, id) } : s));
}

/** Добавляет дочернюю подзадачу к parent (null — в корень) */
export function addSub(list: Subtask[], parent: string | null, sub: Subtask): Subtask[] {
  return parent ? mapSub(list, parent, p => ({ ...p, subtasks: [...p.subtasks, sub] })) : [...list, sub];
}

/** Ставит done у всего поддерева */
export function setDoneDeep(s: Subtask, done: boolean): Subtask {
  return { ...s, done, subtasks: s.subtasks.map(c => setDoneDeep(c, done)) };
}

/** Переключает done: закрытие закрывает всё поддерево, открытие открывает саму подзадачу и всех её предков */
export function toggleSub(list: Subtask[], id: string): Subtask[] {
  const path = subPath(list, id);
  const s = path[path.length - 1];
  if (!s) return list;
  if (!s.done) return mapSub(list, id, x => setDoneDeep(x, true));
  const anc = new Set(path.map(x => x.id));
  const reopen = (l: Subtask[]): Subtask[] => l.map(x => (anc.has(x.id) ? { ...x, done: false, subtasks: reopen(x.subtasks) } : x));
  return reopen(list);
}

/** Раскрывает цепочку предков: нужно, когда в закрытую ветку добавили открытую подзадачу */
export function reopenAncestors(list: Subtask[], id: string): Subtask[] {
  const anc = new Set(subPath(list, id).map(x => x.id));
  const go = (l: Subtask[]): Subtask[] => l.map(x => (anc.has(x.id) ? { ...x, done: false, subtasks: go(x.subtasks) } : x));
  return go(list);
}
