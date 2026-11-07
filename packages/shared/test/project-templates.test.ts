/* Шаблоны проектов: чистые правила «день N от старта», перенос подзадач, статусы. */
import { describe, expect, test } from 'bun:test';
import { dateFromDay, dayFromDate, milestonesToTemplate, subtasksFromTemplate, subtasksToTemplate, templateBaseDate, templateStatus } from '../src';

describe('дни от старта', () => {
  test('день 1 — дата старта, расстояние считается в днях', () => {
    expect(dayFromDate('2026-11-02', '2026-11-02')).toBe(1);
    expect(dayFromDate('2026-11-02', '2026-11-09')).toBe(8);
    expect(dayFromDate('2026-11-02', null)).toBeNull();
    expect(dateFromDay('2026-11-02', 8)).toBe('2026-11-09');
    expect(dateFromDay('2026-11-02', null)).toBeNull();
  });

  test('дата раньше старта сохраняется как день 1, переход через месяц и год', () => {
    expect(dayFromDate('2026-11-02', '2026-10-20')).toBe(1);
    expect(dateFromDay('2026-12-30', 5)).toBe('2027-01-03');
    expect(dateFromDay('2026-11-02', 0)).toBe('2026-11-02');
  });

  test('точка отсчёта: старт проекта, иначе самая ранняя дата задач, иначе сегодня', () => {
    expect(templateBaseDate('2026-11-05', ['2026-11-01'], '2026-11-08')).toBe('2026-11-05');
    expect(templateBaseDate(null, ['2026-11-10', null, '2026-11-03'], '2026-11-08')).toBe('2026-11-03');
    expect(templateBaseDate(null, [null], '2026-11-08')).toBe('2026-11-08');
  });

  test('вехи переводятся в дни', () => {
    expect(milestonesToTemplate([{ name: 'Бета', date: '2026-11-12' }], '2026-11-02')).toEqual([{ name: 'Бета', day: 11 }]);
  });
});

describe('подзадачи и статусы', () => {
  const positionOf = (m: string) => (m === 'm1' ? 'pos1' : null);

  test('туда и обратно: исполнитель по должности, сроки от нового старта, всё не выполнено, id новые', () => {
    const tpl = subtasksToTemplate(
      [{ title: 'Чек-лист', due: '2026-11-04', assignee: 'm1', planHours: 2, subtasks: [{ title: 'Пункт', assignee: 'm2', note: 'n' }] }],
      '2026-11-02',
      positionOf,
    );
    expect(tpl[0]).toMatchObject({ title: 'Чек-лист', dueDay: 3, positionId: 'pos1', planHours: 2 });
    expect(tpl[0]!.subtasks[0]).toMatchObject({ title: 'Пункт', dueDay: null, positionId: null, note: 'n' });

    let n = 0;
    const out = subtasksFromTemplate(tpl, '2027-01-10', p => (p === 'pos1' ? 'member-x' : null), () => `id${++n}`);
    expect(out[0]).toMatchObject({ id: 'id1', done: false, assignee: 'member-x', due: '2027-01-12' });
    expect(out[0]!.subtasks[0]).toMatchObject({ id: 'id2', done: false, assignee: null, due: null, note: 'n' });
  });

  test('статус: выполнено и неизвестный сбрасываются в todo', () => {
    const known = new Set(['todo', 'doing', 'done']);
    expect(templateStatus('doing', known)).toBe('doing');
    expect(templateStatus('done', known)).toBe('todo');
    expect(templateStatus('gone', known)).toBe('todo');
  });
});
