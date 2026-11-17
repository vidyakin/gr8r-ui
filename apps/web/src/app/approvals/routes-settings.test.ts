/* Редактор маршрутов (задача 1199): сборка тела запроса из черновика, проверка заполненности, адреса объектов согласования. */
import { describe, expect, test } from 'bun:test';
import { blankRoute, fromRoute, routeBody, routeValid } from './RoutesSettings';
import { approvalObjectPath, type ApprovalRoute } from './data';

describe('черновик маршрута', () => {
  test('пустой маршрут не сохраняется: нужны название и согласующий в каждом этапе', () => {
    const d = blankRoute();
    expect(routeValid(d)).toBe(false);
    d.name = 'Заказ';
    expect(routeValid(d)).toBe(false);
    d.steps[0]!.participants.push({ key: 'p', kind: 'member', id: 'm1' });
    expect(routeValid(d)).toBe(true);
  });

  test('тело запроса: условия, срок, сотрудник и должность; пустое — null', () => {
    const d = blankRoute();
    Object.assign(d, { name: ' Заказ ', documentType: 'supplier_order', amountFrom: '100000,50', sortOrder: '3' });
    d.steps[0]!.name = 'Руководитель';
    d.steps[0]!.dueHours = '8';
    d.steps[0]!.participants.push({ key: 'a', kind: 'member', id: 'm1' }, { key: 'b', kind: 'position', id: 'p1' }, { key: 'c', kind: 'member', id: '' });
    expect(routeBody(d)).toEqual({
      name: 'Заказ',
      targetKind: 'document',
      documentType: 'supplier_order',
      organizationId: null,
      amountFrom: '100000.50',
      amountTo: null,
      required: true,
      sortOrder: 3,
      steps: [{ name: 'Руководитель', mode: 'sequential', dueHours: 8, participants: [{ memberId: 'm1' }, { positionId: 'p1' }] }],
    });
  });

  test('маршрут договора не несёт тип и сумму документа', () => {
    const d = blankRoute();
    Object.assign(d, { name: 'Договоры', targetKind: 'contract', documentType: 'invoice', amountFrom: '5' });
    const b = routeBody(d);
    expect(b.documentType).toBeNull();
    expect(b.amountFrom).toBeNull();
  });

  test('редактирование: маршрут с сервера превращается в черновик и обратно', () => {
    const r: ApprovalRoute = {
      id: 'r1',
      name: 'Маршрут',
      targetKind: 'document',
      documentType: null,
      organizationId: 'o1',
      amountFrom: '100000',
      amountTo: null,
      required: false,
      sortOrder: 2,
      archivedAt: null,
      steps: [{ id: 's1', name: 'Бухгалтерия', mode: 'parallel', dueHours: null, participants: [{ id: 'x', memberId: null, positionId: 'pos1' }] }],
    };
    const d = fromRoute(r);
    expect(d.steps[0]!.participants[0]).toMatchObject({ kind: 'position', id: 'pos1' });
    expect(routeBody(d)).toMatchObject({ organizationId: 'o1', amountFrom: '100000', required: false, steps: [{ mode: 'parallel', dueHours: null, participants: [{ positionId: 'pos1' }] }] });
  });
});

describe('адрес объекта согласования', () => {
  test('документ, заявка на расход и договор', () => {
    expect(approvalObjectPath({ targetKind: 'document', documentId: 'd1', contractId: null, documentType: 'supplier_order' })).toBe('/documents/d1');
    expect(approvalObjectPath({ targetKind: 'document', documentId: 'd2', contractId: null, documentType: 'payment_request' })).toBe('/money/requests/d2');
    expect(approvalObjectPath({ targetKind: 'contract', documentId: null, contractId: 'c1' })).toBe('/contracts?open=c1');
  });
});
