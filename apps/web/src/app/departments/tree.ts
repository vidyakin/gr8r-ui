/* Подразделения на клиенте (docs/architecture/departments.md): тип строки справочника и обход дерева для показа с отступами.
   Без React и API — используется экраном и рендер-тестом. */

export interface DepartmentItem {
  id: string;
  name: string;
  parentId: string | null;
  headMemberId: string | null;
  sortOrder: number;
  memberIds: string[];
}

export interface DepartmentNode {
  d: DepartmentItem;
  depth: number;
}

/** Дерево в порядке показа: дети сразу под родителем, порядок братьев — как пришёл из API (sortOrder, название).
    Родителя нет в списке — узел в корне; испорченное дерево с циклом не зацикливает обход */
export function departmentTree(items: readonly DepartmentItem[]): DepartmentNode[] {
  const ids = new Set(items.map(d => d.id));
  const kids = new Map<string | null, DepartmentItem[]>();
  for (const d of items) {
    const p = d.parentId && ids.has(d.parentId) ? d.parentId : null;
    const list = kids.get(p);
    if (list) list.push(d);
    else kids.set(p, [d]);
  }
  const out: DepartmentNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const d of kids.get(parent) ?? []) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ d, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  // узлы цикла без корня — на верхний уровень, чтобы не пропали из списка
  for (const d of items) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push({ d, depth: 0 });
    walk(d.id, 1);
  }
  return out;
}

/** Подразделение и все его потомки: их нельзя выбрать родителем (получится цикл) */
export function selfAndDescendants(items: readonly DepartmentItem[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of items) {
      if (d.parentId && out.has(d.parentId) && !out.has(d.id)) {
        out.add(d.id);
        grew = true;
      }
    }
  }
  return out;
}
