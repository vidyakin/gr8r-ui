/* Сводка о ходе объекта по расписанию (задача 1277): состав сводки (процент, просроченные вехи, объём за неделю),
   деньги (перерасход и прогноз прибыли) только owner/admin, «отправить сейчас» создаёт уведомления со ссылкой на объект,
   расписание (dueSchedules: нужный день и время, повтор в том же окне, выключено), задача воркера object.progress_report,
   печатный отчёт для заказчика без себестоимости, права на запись расписания и изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { buildObjectDigest, dueSchedules, runScheduledObjectReport, withContext } from '@gr8r/db';
import { Client, addMember, admin, drainJobs, sql, uniq } from './helpers';
import { runObjectReportsOnce } from '../../worker/src/object-reports';

let owner: Client;
let member: Client;
let adminMember: Client;
let other: Client;
let ws = '';
let ownerMemberId = '';
let memberId = '';
let workerId = '';

/** Понедельник 2026-10-05, 09:05 по Москве (UTC+3) — окно расписания «понедельник 09:00» */
const AT = new Date('2026-10-05T06:05:00Z');

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const uid = () => crypto.randomUUID();

/** Объект: ручной процент выполнения, ответственный — владелец */
async function object(number: string, extra: Record<string, unknown> = {}) {
  return await mk(owner, '/objects', {
    number: `RPT-${number}-${uniq()}`,
    name: `Объект ${number}`,
    managerId: ownerMemberId,
    progressMode: 'manual',
    progressManual: '40',
    budgetPolicy: 'none',
    ...extra,
  });
}

/** Согласованная основная смета; costPrice — внутренняя себестоимость, которой не должно быть в сводке участника */
async function estimate(objectId: string, items: Record<string, unknown>[]) {
  const est = await mk(owner, `/objects/${objectId}/estimates`, { name: 'Смета объекта' });
  const put = await owner.put(`/estimates/${est.id}/items`, {
    sections: [],
    items: items.map(i => ({ id: uid(), unitCode: '796', kind: 'work', qty: '1', price: '0', costPrice: '0', ...i })),
  });
  if (put.status >= 300) throw new Error(`items ${est.id}: ${put.status} ${JSON.stringify(put.body)}`);
  await mk(owner, `/estimates/${est.id}/approve`);
  return { id: est.id as string, items: put.body.items as any[] };
}

async function milestone(objectId: string, body: Record<string, unknown>) {
  return await mk(owner, `/objects/${objectId}/milestones`, body);
}

/** Подтверждённая смена: часы рабочего и объём по позиции сметы */
async function shift(objectId: string, workDate: string, volume: { estimateItemId: string; qty: string }) {
  const created = await mk(owner, `/objects/${objectId}/shifts`, { workDate });
  const saved = await owner.put(`/shifts/${created.id}`, { hours: [{ memberId: workerId, hours: '7', estimateItemId: volume.estimateItemId }], volumes: [volume] });
  if (saved.status >= 300) throw new Error(`save shift: ${saved.status} ${JSON.stringify(saved.body)}`);
  const confirmed = await owner.post(`/shifts/${created.id}/confirm`, {});
  if (confirmed.status >= 300) throw new Error(`confirm shift: ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
  return created.id as string;
}

/** Расписание сводки через API (правит владелец) */
const saveSchedule = (objectId: string, body: Record<string, unknown>, c: Client = owner) => c.put(`/objects/${objectId}/report-schedule`, body);

const countNotifications = async (objectId: string) =>
  Number(((await admin.unsafe(`select count(*)::int n from notifications where workspace_id='${ws}' and object_id='${objectId}' and text like 'Сводка о ходе%'`))[0] as any).n);

const scheduleIdOf = async (objectId: string) =>
  ((await admin.unsafe(`select id from object_report_schedules where object_id='${objectId}'`))[0] as any)?.id as string | undefined;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Сводки объектов WS' });
  ws = owner.workspaceId!;
  // отраслевая опция стройки: без неё воркер сводки не рассылает
  await owner.patch(`/workspaces/${ws}`, { industryOptions: ['construction'] });
  member = await addMember(owner, 'member');
  adminMember = await addMember(owner, 'admin');
  other = new Client();
  await other.signup({ workspaceName: 'Чужой арендатор WS' });
  const people = (await owner.get('/members')).body.items as any[];
  ownerMemberId = people.find(m => m.userId === owner.user!.id).id;
  memberId = people.find(m => m.userId === member.user!.id).id;
  workerId = (await mk(owner, '/members/workers', { name: 'Сидоров Пётр', personnelNumber: 'Т-770' })).id;
  void adminMember;
});

describe('состав сводки', () => {
  test('процент, просроченные вехи, объём за неделю; деньги — только owner/admin', async () => {
    const obj = await object('DIGEST', { foremen: [memberId] });
    const est = await estimate(obj.id, [{ kind: 'work', name: 'Прокладка кабеля', unitCode: '006', qty: '100', price: '300', costPrice: '111.11' }]);
    const itemId = est.items[0].id;
    // вехи: одна выполнена, одна принята, одна просрочена (срок прошёл, не выполнена)
    const done = await milestone(obj.id, { name: 'Черновые работы', dueDate: '2026-09-10', amount: '1000' });
    await mk(owner, `/objects/${obj.id}/milestones/${done.id}/done`, { done: true });
    const accepted = await milestone(obj.id, { name: 'Щиты', dueDate: '2026-09-20', amount: '2000' });
    await mk(owner, `/objects/${obj.id}/milestones/${accepted.id}/done`, { done: true });
    await mk(owner, `/objects/${obj.id}/milestones/${accepted.id}/accept`, { accepted: true });
    await milestone(obj.id, { name: 'Освещение', dueDate: '2026-09-01', amount: '3000' });
    // две подтверждённые смены на прошлой неделе: 2 × 7 ч и 2 × 6 объёма
    await shift(obj.id, '2026-10-01', { estimateItemId: itemId, qty: '6' });
    await shift(obj.id, '2026-10-02', { estimateItemId: itemId, qty: '6' });

    const asMember = await withContext(sql, { workspaceId: ws }, db => buildObjectDigest(db, obj.id, 'member', { now: AT }));
    expect(asMember.progress.percent).toBe('40.0');
    expect(asMember.progress.mode).toBe('manual');
    expect(asMember.milestones.total).toBe(3);
    expect(asMember.milestones.done).toBe(2);
    expect(asMember.milestones.accepted).toBe(1);
    expect(asMember.milestones.overdue).toBe(1);
    expect(asMember.milestones.items.find(i => i.name === 'Освещение')!.overdue).toBe(true);
    expect(asMember.week.from).toBe('2026-09-29');
    expect(asMember.week.to).toBe('2026-10-05');
    expect(asMember.week.shifts).toBe(2);
    expect(asMember.week.hours).toBe('14.00');
    expect(asMember.week.volumes).toHaveLength(1);
    expect(asMember.week.volumes[0]).toMatchObject({ estimateItemId: itemId, qty: '12.000' });
    // деньги себестоимости: у участника-не-админа полей прибыли и перерасхода нет
    expect(asMember.profit).toBeNull();
    expect(asMember.budgetOverruns).toBeNull();

    const asOwner = await withContext(sql, { workspaceId: ws }, db => buildObjectDigest(db, obj.id, 'owner', { now: AT }));
    expect(asOwner.profit).not.toBeNull();
    expect(asOwner.profit!.profit).not.toBeNull();
    expect(Array.isArray(asOwner.budgetOverruns)).toBe(true);
    // состав сводки одинаковый: суммы актов — цена заказчику, её видят все
    expect(asOwner.acts).toEqual(asMember.acts);
  });
});

describe('отправка сводки', () => {
  test('«отправить сейчас» создаёт уведомления получателям со ссылкой на объект', async () => {
    const obj = await object('NOW', { foremen: [memberId] });
    const res = await member.post(`/objects/${obj.id}/report-now`, {});
    expect(res.status).toBe(200);
    // получатели по умолчанию — ответственный (владелец) и прораб (участник)
    expect(res.body.recipients).toBe(2);
    expect(res.body.notifications).toBe(2);
    expect(await countNotifications(obj.id)).toBe(2);
    const rows = (await admin.unsafe(`select recipient_id, object_id from notifications where workspace_id='${ws}' and object_id='${obj.id}'`)) as any[];
    expect(rows.map(r => r.recipient_id).sort()).toEqual([ownerMemberId, memberId].sort());
    expect(rows.every(r => r.object_id === obj.id)).toBe(true);
    // уведомление участника видно ему в списке и несёт ссылку на объект
    const mine = (await member.get('/notifications?limit=50')).body.items as any[];
    expect(mine.some(n => n.objectId === obj.id)).toBe(true);
  });

  test('без получателей — 422', async () => {
    // у объекта нет ни ответственного, ни прорабов — получателей по умолчанию нет
    const obj = await object('NORCP', { managerId: null });
    const res = await member.post(`/objects/${obj.id}/report-now`, {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('report_recipients_required');
  });
});

describe('расписание', () => {
  test('PUT правит только admin+ или ответственный: member (не ответственный) → 403', async () => {
    const obj = await object('PERM', { foremen: [memberId] });
    // читать расписание может любой участник
    expect((await member.get(`/objects/${obj.id}/report-schedule`)).status).toBe(200);
    const denied = await saveSchedule(obj.id, { enabled: true, weekday: 1, time: '09:00', recipientIds: [] }, member);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('forbidden');
    const ok = await saveSchedule(obj.id, { enabled: true, weekday: 1, time: '09:00', recipientIds: [] }, owner);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ objectId: obj.id, enabled: true, weekday: 1, time: '09:00' });
    // пустые получатели — ответственный и прорабы объекта
    expect((ok.body.recipientIds as string[]).sort()).toEqual([ownerMemberId, memberId].sort());
  });

  test('dueSchedules: нужный день и время, повтор в том же окне — нет, выключено — нет', async () => {
    const obj = await object('DUE', { foremen: [memberId] });
    await saveSchedule(obj.id, { enabled: true, weekday: 1, time: '09:00', recipientIds: [] });
    const due = (at: Date) => withContext(admin, {}, db => dueSchedules(db, at), 'app_worker');
    const mine = async (at: Date) => (await due(at)).filter(d => d.objectId === obj.id);

    expect(await mine(new Date('2026-10-04T06:05:00Z'))).toHaveLength(0); // воскресенье
    expect(await mine(new Date('2026-10-05T05:30:00Z'))).toHaveLength(0); // 08:30 — рано
    expect(await mine(AT)).toHaveLength(1);
    expect((await mine(AT))[0]).toMatchObject({ objectId: obj.id, workspaceId: ws });

    // отправка по расписанию отмечает last_sent_at — повтор в том же окне ничего не выбирает
    const scheduleId = (await scheduleIdOf(obj.id))!;
    const sent = await withContext(admin, { workspaceId: ws }, db => runScheduledObjectReport(db, scheduleId, AT), 'app_worker');
    expect(sent?.notifications).toBe(2);
    expect(await mine(AT)).toHaveLength(0);
    expect(await mine(new Date('2026-10-05T12:00:00Z'))).toHaveLength(0); // позже в тот же день
    expect(await mine(new Date('2026-10-12T06:05:00Z'))).toHaveLength(1); // следующий понедельник
    // повторная обработка той же минуты задачей воркера ничего не отправляет
    expect(await withContext(admin, { workspaceId: ws }, db => runScheduledObjectReport(db, scheduleId, AT), 'app_worker')).toBeNull();
    expect(await countNotifications(obj.id)).toBe(2);

    // выключенная сводка не выбирается
    await saveSchedule(obj.id, { enabled: false, weekday: 1, time: '09:00', recipientIds: [] });
    expect(await mine(new Date('2026-10-19T06:05:00Z'))).toHaveLength(0);
  });

  test('задача воркера object.progress_report: очередь, уведомления, повтор ничего не добавляет', async () => {
    const obj = await object('JOB', { foremen: [memberId] });
    await saveSchedule(obj.id, { enabled: true, weekday: 1, time: '09:00', recipientIds: [] });
    const at = new Date('2026-10-26T06:05:00Z'); // ещё один понедельник
    const scheduleId = (await scheduleIdOf(obj.id))!;
    const queued = async () =>
      Number(((await admin.unsafe(`select count(*)::int n from jobs where type='object.progress_report' and payload->>'scheduleId'='${scheduleId}'`))[0] as any).n);
    expect(await runObjectReportsOnce(admin, at)).toBeGreaterThanOrEqual(1);
    expect(await queued()).toBe(1);
    await drainJobs();
    expect(await countNotifications(obj.id)).toBe(2);
    // расписание отмечено: следующий проход воркера задачу по нему не ставит
    await runObjectReportsOnce(admin, at);
    expect(await queued()).toBe(1);
    // дубль задачи (повторная доставка очереди) обработчик гасит: уведомления не задваиваются
    await admin.unsafe(`insert into jobs (workspace_id, type, payload) values ('${ws}', 'object.progress_report', '{"scheduleId":"${scheduleId}"}'::jsonb)`);
    await drainJobs();
    expect(await countNotifications(obj.id)).toBe(2);
  });
});

describe('печатный отчёт для заказчика', () => {
  test('HTML без себестоимости: объект, заказчик, период, выполнение, вехи, объёмы, акты', async () => {
    const customer = await mk(owner, '/companies', { name: 'ООО «Заказчик отчёта»' });
    const obj = await object('PRINT', { customerId: customer.id });
    const est = await estimate(obj.id, [{ kind: 'work', name: 'Монтаж лотка', unitCode: '006', qty: '10', price: '500', costPrice: '111.11', doneQty: '4' }]);
    const m = await milestone(obj.id, { name: 'Этап 1', dueDate: '2026-09-15', amount: '1500' });
    await mk(owner, `/objects/${obj.id}/milestones/${m.id}/done`, { done: true });
    const html = await owner.get(`/objects/${obj.id}/progress-report?from=2026-09-01&to=2026-09-30`);
    expect(html.status).toBe(200);
    const text = typeof html.body === 'string' ? html.body : new TextDecoder().decode(html.bytes);
    expect(text).toContain('Отчёт о ходе работ');
    expect(text).toContain(obj.name);
    expect(text).toContain('ООО «Заказчик отчёта»');
    expect(text).toContain('01.09.2026');
    expect(text).toContain('40.0');
    expect(text).toContain('Монтаж лотка');
    expect(text).toContain('Этап 1');
    // выполнено 4 × 500 = 2 000 — цена заказчику (в форме суммы с неразрывным пробелом);
    // внутренней себестоимости (111,11) в форме нет
    expect(text).toContain('2\u00a0000,00');
    expect(text).not.toContain('111,11');
    expect(text).not.toContain('111.11');
    void est;
  });
});

describe('изоляция арендаторов', () => {
  test('чужое расписание и чужой отчёт — 404', async () => {
    const obj = await object('ISO');
    expect((await other.get(`/objects/${obj.id}/report-schedule`)).status).toBe(404);
    expect((await other.get(`/objects/${obj.id}/progress-report`)).status).toBe(404);
    expect((await other.post(`/objects/${obj.id}/report-now`, {})).status).toBe(404);
  });
});
