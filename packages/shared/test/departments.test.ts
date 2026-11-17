/* Подразделения: чистое правило «руководитель подразделения сотрудника» (departmentHeadOf) на дереве из 3 уровней.
   Руководитель есть и не сам сотрудник — он; сотрудник сам руководитель или руководителя нет — вверх к родителю; нет никого — null. */
import { describe, expect, test } from 'bun:test';
import { departmentHeadOf, type DepartmentDef, type DepartmentMembership } from '../src/departments';

/* Дерево из 3 уровней:
   d1 «Руководство» (руководитель owner)
     └ d2 «Продажи» (руководитель salesHead)
         ├ d3 «Отдел А» (руководитель teamLead)
         └ d4 «Отдел Б» (руководителя нет) */
const departments: DepartmentDef[] = [
  { id: 'd1', parentId: null, headMemberId: 'owner' },
  { id: 'd2', parentId: 'd1', headMemberId: 'salesHead' },
  { id: 'd3', parentId: 'd2', headMemberId: 'teamLead' },
  { id: 'd4', parentId: 'd2', headMemberId: null },
];
const memberships: DepartmentMembership[] = [
  { memberId: 'emp', departmentId: 'd3' },
  { memberId: 'teamLead', departmentId: 'd3' },
  { memberId: 'salesHead', departmentId: 'd2' },
  { memberId: 'owner', departmentId: 'd1' },
  { memberId: 'empNoHead', departmentId: 'd4' },
];

describe('departmentHeadOf: дерево из 3 уровней', () => {
  test('обычный сотрудник — руководитель своего подразделения', () => {
    expect(departmentHeadOf('emp', departments, memberships)).toBe('teamLead');
  });

  test('руководитель отдела — сам себе не руководитель, идём вверх к руководителю продаж', () => {
    expect(departmentHeadOf('teamLead', departments, memberships)).toBe('salesHead');
  });

  test('руководитель продаж — вверх к владельцу', () => {
    expect(departmentHeadOf('salesHead', departments, memberships)).toBe('owner');
  });

  test('владелец — руководитель верхнего уровня, выше никого нет: null', () => {
    expect(departmentHeadOf('owner', departments, memberships)).toBeNull();
  });

  test('в подразделении нет руководителя — идём вверх к родителю', () => {
    expect(departmentHeadOf('empNoHead', departments, memberships)).toBe('salesHead');
  });

  test('сотрудник без подразделения — null', () => {
    expect(departmentHeadOf('lonely', departments, memberships)).toBeNull();
  });

  test('пустой справочник — null', () => {
    expect(departmentHeadOf('emp', [], [])).toBeNull();
  });

  test('пропуск нескольких уровней без руководителя подряд', () => {
    // d3 и d2 без руководителя, руководитель только на верхнем уровне
    const defs: DepartmentDef[] = [
      { id: 'd1', parentId: null, headMemberId: 'owner' },
      { id: 'd2', parentId: 'd1', headMemberId: null },
      { id: 'd3', parentId: 'd2', headMemberId: null },
    ];
    expect(departmentHeadOf('emp', defs, [{ memberId: 'emp', departmentId: 'd3' }])).toBe('owner');
  });

  test('руководитель не обязан состоять в этом же подразделении', () => {
    // руководитель отдела А — участник из другого подразделения, ссылка всё равно работает
    const defs: DepartmentDef[] = [
      { id: 'd1', parentId: null, headMemberId: null },
      { id: 'd3', parentId: 'd1', headMemberId: 'externalHead' },
    ];
    const links: DepartmentMembership[] = [
      { memberId: 'emp', departmentId: 'd3' },
      { memberId: 'externalHead', departmentId: 'd1' },
    ];
    expect(departmentHeadOf('emp', defs, links)).toBe('externalHead');
  });

  test('защита от цикла: не зависает и возвращает null, если все руководители — сам сотрудник', () => {
    // испорченное дерево с циклом d1 → d2 → d1; сотрудник — руководитель обоих
    const defs: DepartmentDef[] = [
      { id: 'd1', parentId: 'd2', headMemberId: 'emp' },
      { id: 'd2', parentId: 'd1', headMemberId: 'emp' },
    ];
    expect(departmentHeadOf('emp', defs, [{ memberId: 'emp', departmentId: 'd1' }])).toBeNull();
  });
});