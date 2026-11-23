/* Подразделения: экран настроек рендерится с данными — дерево с отступами, руководитель и число сотрудников в строке,
   кнопки правки только у admin/owner, пустое состояние. Плюс обход дерева (departmentTree, selfAndDescendants). */
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadLocale, setLocale } from '@/i18n';
import { DepartmentsView } from './DepartmentsView';
import { departmentTree, selfAndDescendants, type DepartmentItem } from './tree';

const dep = (id: string, name: string, parentId: string | null, headMemberId: string | null, memberIds: string[], sortOrder = 0): DepartmentItem => ({ id, name, parentId, headMemberId, memberIds, sortOrder });
// порядок как из API (sortOrder, название): дочерние пришли раньше родителя — дерево всё равно строится
const items: DepartmentItem[] = [
  dep('sales', 'Продажи', 'root', 'm1', ['m1', 'm2', 'm3'], 1),
  dep('prod', 'Производство', 'root', null, ['m4'], 2),
  dep('team', 'Отдел А', 'sales', null, [], 3),
  dep('root', 'Руководство', null, 'owner', ['owner'], 4),
];
const members = [
  { id: 'owner', name: 'Анна Владелец' },
  { id: 'm1', name: 'Борис Продажин' },
  { id: 'm2', name: 'Вера' },
  { id: 'm3', name: 'Глеб' },
  { id: 'm4', name: 'Дина' },
];
const noop = async () => true;
const render = (props: Partial<Parameters<typeof DepartmentsView>[0]> = {}) =>
  renderToStaticMarkup(<DepartmentsView title="Подразделения" departments={items} members={members} isAdmin onSave={noop} onDelete={noop} onSetMember={noop} {...props} />);

beforeAll(async () => {
  await loadLocale('ru');
  setLocale('ru');
});

describe('departmentTree', () => {
  test('дети сразу под родителем с глубиной', () => {
    expect(departmentTree(items).map(n => `${n.depth}:${n.d.id}`)).toEqual(['0:root', '1:sales', '2:team', '1:prod']);
  });
  test('родитель не найден или цикл — узлы не теряются', () => {
    const broken = [dep('a', 'A', 'b', null, []), dep('b', 'B', 'a', null, []), dep('c', 'C', 'gone', null, [])];
    expect(departmentTree(broken).map(n => n.d.id).sort()).toEqual(['a', 'b', 'c']);
  });
  test('selfAndDescendants: нельзя выбрать родителем себя и потомков', () => {
    expect([...selfAndDescendants(items, 'sales')].sort()).toEqual(['sales', 'team']);
  });
});

describe('DepartmentsView', () => {
  test('оргсхема: верхний уровень горизонтально, вложенные вертикально, руководитель и число сотрудников', () => {
    const html = render();
    expect(html).toContain('oc-roots');
    expect(html).toContain('oc-h-row');
    expect(html).toContain('oc-vlist');
    expect(html).toContain('Раскрыть все');
    expect(html).toContain('Руководство');
    expect(html).toContain('Продажи');
    expect(html).toContain('Отдел А');
    expect(html).toContain('Производство');
    expect(html).toContain('Анна Владелец');
    expect(html).toContain('Борис Продажин');
    expect(html).toContain('Без руководителя');
    expect(html).toContain('3 сотрудника');
    expect(html).toContain('1 сотрудник');
    expect(html).toContain('Добавить подразделение');
    expect(html.match(/aria-label="Изменить"/g)?.length).toBe(4);
    expect(html.match(/aria-label="Добавить дочерний отдел"/g)?.length).toBe(4);
  });

  test('обычный участник видит оргсхему без кнопок правки', () => {
    const html = render({ isAdmin: false });
    expect(html).toContain('Продажи');
    expect(html).toContain('только администраторы и владелец');
    expect(html).not.toContain('Добавить подразделение');
    expect(html).not.toContain('aria-label="Изменить"');
  });

  test('пустой справочник — подсказка', () => {
    expect(render({ departments: [] })).toContain('Подразделений пока нет');
  });
});
