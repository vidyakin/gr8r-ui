import { describe, expect, test } from 'bun:test';
import { overdueHours, pickRoute, renderApprovalSheet, routeMatches, type ApprovalSheetData, type RouteCondition } from '../src';

const route = (over: Partial<RouteCondition> = {}): RouteCondition => ({ targetKind: 'document', documentType: null, organizationId: null, amountFrom: null, amountTo: null, ...over });

describe('routeMatches / pickRoute', () => {
  test('type, organization and the inclusive amount range', () => {
    const t = { kind: 'document' as const, documentType: 'supplier_order', organizationId: 'o1', total: '100000.00' };
    expect(routeMatches(route(), t)).toBe(true);
    expect(routeMatches(route({ documentType: 'supplier_order' }), t)).toBe(true);
    expect(routeMatches(route({ documentType: 'invoice' }), t)).toBe(false);
    expect(routeMatches(route({ organizationId: 'o2' }), t)).toBe(false);
    expect(routeMatches(route({ amountFrom: '100000' }), t)).toBe(true);
    expect(routeMatches(route({ amountFrom: '100000.01' }), t)).toBe(false);
    expect(routeMatches(route({ amountTo: '99999.99' }), t)).toBe(false);
    expect(routeMatches(route({ amountTo: '100000' }), t)).toBe(true);
  });
  test('a contract ignores the amount; kinds do not mix', () => {
    expect(routeMatches(route({ targetKind: 'contract', amountFrom: '1' }), { kind: 'contract', organizationId: 'o1' })).toBe(true);
    expect(routeMatches(route({ targetKind: 'contract' }), { kind: 'document', total: '1' })).toBe(false);
  });
  test('the first matching route wins', () => {
    const list = [route({ amountFrom: '500' }), route({ amountFrom: '0' })];
    expect(pickRoute(list, { kind: 'document', total: '10' })).toBe(list[1]!);
    expect(pickRoute([], { kind: 'document', total: '10' })).toBeNull();
  });
});

describe('overdueHours', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  test('no due date or not yet due is zero; later it counts whole hours, at least one', () => {
    expect(overdueHours(null, now)).toBe(0);
    expect(overdueHours('2026-11-16T13:00:00Z', now)).toBe(0);
    expect(overdueHours('2026-11-16T11:50:00Z', now)).toBe(1);
    expect(overdueHours('2026-11-16T07:30:00Z', now)).toBe(4);
  });
});

describe('лист согласования', () => {
  const data: ApprovalSheetData = {
    objectLabel: 'Заказ <поставщику> ЗП-1',
    routeName: 'Заказ от 100 000',
    round: 2,
    state: 'rejected',
    authorName: 'Иванов',
    startedAt: '2026-11-16T09:05:00Z',
    finishedAt: '2026-11-16T10:00:00Z',
    cancelReason: null,
    steps: [
      { name: 'Руководитель', mode: 'sequential', tasks: [{ memberName: 'Петров', positionName: null, state: 'done', decision: 'approve', comment: 'ок', notes: [], decidedAt: '2026-11-16T09:30:00Z', dueAt: null }] },
      {
        name: 'Бухгалтерия',
        mode: 'parallel',
        tasks: [
          { memberName: 'Сидоров', positionName: 'Бухгалтер', state: 'done', decision: 'reject', comment: 'нет <бюджета>', notes: [{ text: 'вопрос', at: '2026-11-16T09:40:00Z' }], decidedAt: '2026-11-16T10:00:00Z', dueAt: null },
          { memberName: 'Орлов', positionName: 'Бухгалтер', state: 'skipped', decision: null, comment: '', notes: [], decidedAt: null, dueAt: null },
        ],
      },
    ],
  };
  test('renders steps, decisions, Moscow time and escapes values', () => {
    const h = renderApprovalSheet(data);
    expect(h).toContain('Лист согласования: Заказ &lt;поставщику&gt; ЗП-1');
    expect(h).toContain('круг 2');
    expect(h).toContain('отклонено');
    expect(h).toContain('Этап 2. Бухгалтерия');
    expect(h).toContain('Согласовал, 16.11.2026 12:30');
    expect(h).toContain('Отклонил, 16.11.2026 13:00');
    expect(h).toContain('нет &lt;бюджета&gt;');
    expect(h).toContain('Не требуется');
    expect(h).toContain('16.11.2026 12:40: вопрос');
  });
  test('is deterministic', () => {
    expect(renderApprovalSheet(data)).toBe(renderApprovalSheet(data));
  });
});
