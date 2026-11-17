/* Подразделения (оргструктура, docs/architecture/departments.md): чистое правило «руководитель подразделения сотрудника».
   Основа будущего правила согласования «согласует руководитель подразделения инициатора». Без БД — работает и в браузере. */

/** Подразделение для расчёта руководителя: дерево по parentId и руководитель-участник */
export interface DepartmentDef {
  id: string;
  parentId: string | null;
  headMemberId: string | null;
}

/** Привязка участника к подразделению (у участника не больше одного подразделения) */
export interface DepartmentMembership {
  memberId: string;
  departmentId: string;
}

/** Руководитель подразделения сотрудника. Если сотрудник сам руководитель своего подразделения или руководителя нет —
    идём вверх к родителю; нет никого — null. Защита от цикла в дереве (множество просмотренных). */
export function departmentHeadOf(memberId: string, departments: readonly DepartmentDef[], memberships: readonly DepartmentMembership[]): string | null {
  const byId = new Map(departments.map(d => [d.id, d]));
  const link = memberships.find(m => m.memberId === memberId);
  if (!link) return null;
  let cur = byId.get(link.departmentId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    // руководитель есть и это не сам сотрудник — он и согласует
    if (cur.headMemberId && cur.headMemberId !== memberId) return cur.headMemberId;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}