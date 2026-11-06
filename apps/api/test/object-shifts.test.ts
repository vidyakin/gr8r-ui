/* Табель прораба (задача 1271): пакетный ввод бригады с исключениями, сменный отчёт объёмов (один раз на бригаду),
   стоимость часа из почасовой ставки и из оклада / нормы часов, снимок при подтверждении, done_qty и факт труда
   в бюджете объекта, контроль бюджета block → 422, пределы часов, права прораба и admin/owner, правка подтверждённой
   с причиной и журналом, бейджи (выпуск, поиск, перевыпуск) и рабочие без входа, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { addMember, admin, Client } from './helpers';

let owner: Client;
let foreman: Client;
let foremanId = '';
let other: Client;
let insuranceRate = '30';

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const uid = () => crypto.randomUUID();

/** Объект с политикой контроля бюджета и (необязательно) прорабом */
async function object(number: string, extra: Record<string, unknown> = {}) {
  return (await mk(owner, '/objects', { number, name: `Объект ${number}`, budgetPolicy: 'warn', ...extra })) as any;
}

/** Основная смета объекта с позициями (по умолчанию сразу согласована) */
async function estimate(objectId: string, items: Record<string, unknown>[], approve = true) {
  const est = await mk(owner, `/objects/${objectId}/estimates`, { name: 'Смета объекта' });
  const put = await owner.put(`/estimates/${est.id}/items`, { sections: [], items: items.map(i => ({ id: uid(), unitCode: '796', qty: '1', price: '0', ...i })) });
  if (put.status >= 300) throw new Error(`items ${est.id}: ${put.status} ${JSON.stringify(put.body)}`);
  if (approve) await mk(owner, `/estimates/${est.id}/approve`);
  return put.body as any;
}

/** Рабочий без входа: участник воркспейса без user_id и без membership */
const worker = (name: string, personnelNumber: string, c: Client = owner) => mk(c, '/members/workers', { name, personnelNumber });

/** Смена: открыть, сохранить часы и объёмы, подтвердить */
async function shift(c: Client, objectId: string, workDate: string, hours: Record<string, unknown>[], volumes: Record<string, unknown>[] = []) {
  const created = await mk(c, `/objects/${objectId}/shifts`, { workDate });
  const saved = await c.put(`/shifts/${created.id}`, { hours, volumes });
  if (saved.status >= 300) throw new Error(`save shift ${created.id}: ${saved.status} ${JSON.stringify(saved.body)}`);
  return created.id as string;
}

/** Ожидаемая стоимость часа из оклада: оклад / (рабочие дни месяца × 8) × (1 + взносы/100), до копейки */
function salaryRate(salary: number, workDate: string): string {
  const [y, m] = workDate.split('-').map(Number);
  const days = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  let workingDays = 0;
  for (let d = 1; d <= days; d++) {
    const w = new Date(Date.UTC(y!, m! - 1, d)).getUTCDay();
    if (w >= 1 && w <= 5) workingDays++;
  }
  const norm = workingDays * 8;
  return (Math.round(((salary * (100 + Number(insuranceRate))) / (100 * norm)) * 100) / 100).toFixed(2);
}

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Object shifts WS' });
  foreman = await addMember(owner, 'member');
  foremanId = (await owner.get('/members')).body.items.find((m: any) => m.email === foreman.user!.email).id;
  other = new Client();
  await other.signup({ workspaceName: 'Other shifts WS' });
  insuranceRate = (await owner.get('/payroll/settings')).body.insuranceRate;
});

describe('бригада и объёмы смены', () => {
  test('пакетный ввод: 3 работника по 8 ч с исключением 4 ч, объём вводится один раз на бригаду', async () => {
    const obj = await object('SH-1', { foremen: [] });
    const items = await estimate(obj.id, [{ kind: 'work', name: 'Прокладка кабеля', qty: '10', costPrice: '100' }]);
    const itemId = items.items[0].id;
    const workers = [await worker('Смирнов Пётр', 'Т-101'), await worker('Кузнецов Иван', 'Т-102'), await worker('Морозов Алексей', 'Т-103')];

    const id = await shift(owner, obj.id, '2026-10-15', [
      { memberId: workers[0]!.id, hours: '8', estimateItemId: itemId },
      { memberId: workers[1]!.id, hours: '8', estimateItemId: itemId },
      { memberId: workers[2]!.id, hours: '4', estimateItemId: itemId },
    ], [{ estimateItemId: itemId, qty: '4' }]);
    const view = (await owner.get(`/shifts/${id}`)).body;
    expect(view.totalHours).toBe('20.00');
    expect(view.hours).toHaveLength(3);
    expect(view.volumes).toEqual([expect.objectContaining({ estimateItemId: itemId, qty: '4.000' })]);

    // объём один раз на бригаду: 4 м кабеля, а не 12 (не умножается на число работников)
    const confirmed = await owner.post(`/shifts/${id}/confirm`, {});
    expect(confirmed.status).toBe(200);
    const est = (await owner.get(`/estimates/${items.id}`)).body;
    expect(est.items[0].doneQty).toBe('4.000');
    expect((await owner.get(`/objects/${obj.id}/shifts?from=2026-10-01&to=2026-10-31`)).body.items[0].status).toBe('confirmed');
  });

  test('повторный скан того же работника не дублирует строку: часы складываются', async () => {
    const obj = await object('SH-2');
    const items = await estimate(obj.id, [{ kind: 'work', name: 'Монтаж лотка', qty: '5' }]);
    const w = await worker('Повторный Скан', 'Т-201');
    const created = await mk(owner, `/objects/${obj.id}/shifts`, { workDate: '2026-10-16' });
    await owner.put(`/shifts/${created.id}`, {
      hours: [
        { memberId: w.id, hours: '4', estimateItemId: items.items[0].id },
        { memberId: w.id, hours: '4', estimateItemId: items.items[0].id },
      ],
    });
    const view = (await owner.get(`/shifts/${created.id}`)).body;
    expect(view.hours).toHaveLength(1);
    expect(view.hours[0].hours).toBe('8.00');
  });

  test('часы больше 24 за смену — 422 shift_hours_exceed', async () => {
    const obj = await object('SH-3');
    const items = await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '1' }]);
    const w = await worker('Сверхурочный', 'Т-301');
    const created = await mk(owner, `/objects/${obj.id}/shifts`, { workDate: '2026-10-17' });
    const bad = await owner.put(`/shifts/${created.id}`, {
      hours: [
        { memberId: w.id, hours: '20', estimateItemId: items.items[0].id },
        { memberId: w.id, hours: '20', estimateItemId: items.items[0].id },
      ],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('shift_hours_exceed');
    // одна строка больше 24 часов не проходит схему
    const tooMuch = await owner.put(`/shifts/${created.id}`, { hours: [{ memberId: w.id, hours: '25' }] });
    expect(tooMuch.status).toBe(400);
  });
});

describe('стоимость часа и снимок', () => {
  test('почасовая ставка и оклад / норма часов плюс взносы; работник без ставки — cost null, в труд не входит', async () => {
    const obj = await object('SH-4');
    const items = await estimate(obj.id, [
      { kind: 'work', name: 'Работа', qty: '100', costPrice: '0' },
      { kind: 'work', name: 'Вторая работа', qty: '100', costPrice: '0' },
    ]);
    const hourly = await worker('Почасовой', 'Т-401');
    const salaried = await worker('Окладник', 'Т-402');
    const none = await worker('Без ставки', 'Т-403');
    await owner.put(`/payroll/employees/${hourly.id}`, { hourlyRate: '500' });
    const kinds = (await owner.get('/payroll/kinds')).body.items as any[];
    const salaryKind = kinds.find(k => k.baseType === 'salary');
    await mk(owner, '/payroll/accruals', { memberId: salaried.id, kindId: salaryKind.id, validFrom: '2026-09-01', amount: '44000' });

    const id = await shift(owner, obj.id, '2026-10-15', [
      { memberId: hourly.id, hours: '8', estimateItemId: items.items[0].id },
      { memberId: salaried.id, hours: '8', estimateItemId: items.items[0].id },
      { memberId: none.id, hours: '8', estimateItemId: items.items[1].id },
    ]);
    const confirmed = await owner.post(`/shifts/${id}/confirm`, {});
    expect(confirmed.status).toBe(200);
    const view = (await owner.get(`/shifts/${id}`)).body;
    const rate = salaryRate(44000, '2026-10-15');
    expect(view.hours.map((h: any) => [h.costRate, h.costAmount])).toEqual([
      ['650.00', '5200.00'],
      [rate, (Number(rate) * 8).toFixed(2)],
      [null, null],
    ]);
    // сумма смены не считается, пока у строки нет стоимости: пробел, не ноль
    expect(view.totalAmount).toBeNull();
    expect(view.noRate).toBe(1);

    // снимок: новая ставка прошлые затраты не меняет
    await owner.put(`/payroll/employees/${hourly.id}`, { hourlyRate: '1000' });
    expect((await owner.get(`/shifts/${id}`)).body.hours[0].costRate).toBe('650.00');

    // труд в бюджете объекта — сумма подтверждённых смен, строка без ставки не входит
    const budget = (await owner.get(`/objects/${obj.id}/budget`)).body;
    const labor = (5200 + Number(rate) * 8).toFixed(2);
    expect(budget.categories.labor.fact).toBe(labor);
  });

  test('отмена подтверждения откатывает объёмы и снимает снимок стоимости', async () => {
    const obj = await object('SH-5');
    const items = await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '10' }]);
    const w = await worker('Откат', 'Т-501');
    await owner.put(`/payroll/employees/${w.id}`, { hourlyRate: '100' });
    const id = await shift(owner, obj.id, '2026-10-20', [{ memberId: w.id, hours: '5', estimateItemId: items.items[0].id }], [{ estimateItemId: items.items[0].id, qty: '3' }]);
    await owner.post(`/shifts/${id}/confirm`, {});
    expect((await owner.get(`/estimates/${items.id}`)).body.items[0].doneQty).toBe('3.000');
    expect((await owner.get(`/objects/${obj.id}/budget`)).body.categories.labor.fact).toBe('650.00');

    // причина обязательна
    const noReason = await owner.post(`/shifts/${id}/unconfirm`, {});
    expect(noReason.status).toBe(400);
    const undone = await owner.post(`/shifts/${id}/unconfirm`, { reason: 'Прораб ошибся датой' });
    expect(undone.status).toBe(200);
    expect(undone.body.status).toBe('draft');
    expect(undone.body.hours[0].costAmount).toBeNull();
    expect((await owner.get(`/estimates/${items.id}`)).body.items[0].doneQty).toBe('0.000');
    expect((await owner.get(`/objects/${obj.id}/budget`)).body.categories.labor.fact).toBe('0.00');
    // повторная отмена — 409
    expect((await owner.post(`/shifts/${id}/unconfirm`, { reason: 'Ещё раз' })).body.error.code).toBe('shift_not_confirmed');
  });
});

describe('бюджет и права', () => {
  test('block: подтверждение смены сверх бюджета труда — 422 budget_exceeded, смена не подтверждена', async () => {
    const obj = await object('SH-6', { budgetPolicy: 'block' });
    const items = await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '1', costPrice: '100' }]);
    const w = await worker('Дорогой', 'Т-601');
    await owner.put(`/payroll/employees/${w.id}`, { hourlyRate: '500' });
    const id = await shift(owner, obj.id, '2026-10-21', [{ memberId: w.id, hours: '8', estimateItemId: items.items[0].id }]);
    const bad = await owner.post(`/shifts/${id}/confirm`, {});
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('budget_exceeded');
    expect((await owner.get(`/shifts/${id}`)).body.status).toBe('draft');
  });

  test('прораб ведёт только свои объекты; без назначения — 403, свои объекты видны в списке', async () => {
    const mine = await object('SH-7', { foremen: [foremanId] });
    const foreign = await object('SH-8', { foremen: [] });
    await estimate(mine.id, [{ kind: 'work', name: 'Работа', qty: '10' }]);
    expect((await foreman.post(`/objects/${foreign.id}/shifts`, { workDate: '2026-10-22' })).status).toBe(403);
    const created = await foreman.post(`/objects/${mine.id}/shifts`, { workDate: '2026-10-22' });
    expect(created.status).toBe(201);
    expect(created.body.foremanId).toBe(foremanId);
    // прораб не может открыть смену от чужого имени
    expect((await foreman.post(`/objects/${mine.id}/shifts`, { workDate: '2026-10-23', foremanId: owner.user!.id })).status).toBe(403);
    const objects = (await foreman.get('/shifts/objects')).body.items as any[];
    expect(objects.some(o => o.id === mine.id)).toBe(true);
    expect(objects.some(o => o.id === foreign.id)).toBe(false);
    // для admin/owner — все объекты
    expect(((await owner.get('/shifts/objects')).body.items as any[]).some(o => o.id === foreign.id)).toBe(true);
  });

  test('прораб не видит ставок и сумм; правка подтверждённой — только admin с причиной и журналом', async () => {
    const obj = await object('SH-9', { foremen: [foremanId] });
    const items = await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '10' }]);
    const w = await worker('Работник', 'Т-901');
    await owner.put(`/payroll/employees/${w.id}`, { hourlyRate: '400' });
    const id = await shift(foreman, obj.id, '2026-10-26', [{ memberId: w.id, hours: '8', estimateItemId: items.items[0].id }]);
    const confirmed = await foreman.post(`/shifts/${id}/confirm`, {});
    expect(confirmed.status).toBe(200);
    const view = (await foreman.get(`/shifts/${id}`)).body;
    expect(view.canSeeCost).toBe(false);
    expect(view.totalAmount).toBeNull();
    expect(view.hours[0].costRate).toBeNull();
    // сумма при этом посчитана и видна owner
    expect((await owner.get(`/shifts/${id}`)).body.totalAmount).toBe('4160.00');

    // прораб не правит подтверждённую
    const foremanEdit = await foreman.put(`/shifts/${id}`, { hours: [{ memberId: w.id, hours: '6', estimateItemId: items.items[0].id }], reason: 'Уточнение' });
    expect(foremanEdit.status).toBe(403);
    // админ — только с причиной
    expect((await owner.put(`/shifts/${id}`, { note: 'Правка' })).body.error.code).toBe('shift_reason_required');
    const edited = await owner.put(`/shifts/${id}`, { hours: [{ memberId: w.id, hours: '6', estimateItemId: items.items[0].id }], reason: 'Уточнение часов' });
    expect(edited.status).toBe(200);
    expect(edited.body.totalHours).toBe('6.00');
    expect(edited.body.totalAmount).toBe('3120.00');
    const log = edited.body.log.find((l: any) => l.action === 'updated');
    expect(log.reason).toBe('Уточнение часов');
    expect(log.before.hours[0].hours).toBe('8.00');
    expect(log.after.hours[0].hours).toBe('6.00');
    expect(log.authorId).toBeTruthy();
  });

  test('табель за период: работник × дни по подтверждённым сменам', async () => {
    const obj = await object('SH-10', { foremen: [foremanId] });
    await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '100' }]);
    const a = await worker('Табель А', 'Т-1001');
    const b = await worker('Табель Б', 'Т-1002');
    const first = await shift(owner, obj.id, '2026-10-05', [{ memberId: a.id, hours: '8' }, { memberId: b.id, hours: '6' }]);
    const second = await shift(owner, obj.id, '2026-10-06', [{ memberId: a.id, hours: '4' }]);
    await owner.post(`/shifts/${first}/confirm`, {});
    await owner.post(`/shifts/${second}/confirm`, {});
    const sheet = (await owner.get(`/objects/${obj.id}/timesheet?from=2026-10-05&to=2026-10-06`)).body;
    expect(sheet.days).toEqual(['2026-10-05', '2026-10-06']);
    const rowA = sheet.rows.find((r: any) => r.memberId === a.id);
    expect(rowA.hours).toEqual(['8.00', '4.00']);
    expect(rowA.total).toBe('12.00');
    expect(sheet.totalByDay).toEqual(['14.00', '4.00']);
    expect(sheet.total).toBe('18.00');
  });
});

describe('бейджи и рабочие без входа', () => {
  test('выпуск, поиск по коду и перевыпуск с отзывом старого кода', async () => {
    const w = await worker('Бейдж Работник', 'Т-1101');
    const badge = await mk(owner, `/members/${w.id}/badge`, { personnelNumber: 'Т-1101' });
    expect(badge.badgeCode).toMatch(/^W[A-Z2-9]{8}$/);
    const found = await owner.get(`/members/badge/${badge.badgeCode.toLowerCase()}`);
    expect(found.status).toBe(200);
    expect(found.body.memberId).toBe(w.id);
    // перевыпуск: старый код отозван
    const reissued = await mk(owner, `/members/${w.id}/badge`, {});
    expect(reissued.badgeCode).not.toBe(badge.badgeCode);
    const old = await owner.get(`/members/badge/${badge.badgeCode}`);
    expect(old.status).toBe(404);
    expect(old.body.error.code).toBe('badge_not_found');
    // печать бейджей: страница с именем и табельным номером
    const print = await owner.get('/members/badges/print');
    expect(print.status).toBe(200);
    expect(print.body).toContain('Бейдж Работник');
    expect(print.body).toContain('Т-1101');
    // неизвестный код записи не создаёт
    expect((await owner.get('/members/badge/WNOPE')).status).toBe(404);
  });

  test('рабочий без входа: без user_id и без membership, создаёт только admin', async () => {
    const created = await worker('Без Входа', 'Т-1201');
    expect(created.userId).toBeNull();
    const [row] = await admin`select user_id from members where id = ${created.id}`;
    expect(row!.user_id).toBeNull();
    const [m] = await admin`select count(*)::int as n from memberships where workspace_id = ${owner.workspaceId} and user_id is null`;
    expect(m!.n).toBe(0);
    // прораб (member) не создаёт участников
    expect((await foreman.post('/members/workers', { name: 'Нельзя' })).status).toBe(403);
  });
});

describe('изоляция арендаторов', () => {
  test('чужая смена и чужие смены объекта — 404', async () => {
    const obj = await object('SH-13');
    await estimate(obj.id, [{ kind: 'work', name: 'Работа', qty: '1' }]);
    const id = await shift(owner, obj.id, '2026-10-27', []);
    expect((await other.get(`/shifts/${id}`)).status).toBe(404);
    expect((await other.get(`/objects/${obj.id}/shifts`)).status).toBe(404);
    expect((await other.post(`/shifts/${id}/confirm`, {})).status).toBe(404);
  });
});
