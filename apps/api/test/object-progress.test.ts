/* Процент выполнения объекта и вехи (задача 1272): каждый способ расчёта (закрытые задачи, средний прогресс,
   веса задач, объёмы согласованной сметы, вручную) и null без базы; вехи — CRUD, одно из amount/pct, приёмка только
   после выполнения, процент от стоимости договора, аванс вне выполнения; done_qty не больше qty; изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { addMember, Client, uniq } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let objectId: string;
let projectId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const uid = () => crypto.randomUUID();

/** Объект с проектом задач */
async function object(number = `PRG-${uniq()}`) {
  const o = await mk(owner, '/objects', { number, name: `Объект ${number}` });
  return o as { id: string; projectId: string };
}

/** Задача объекта: статус и вес (вес не нужен — 1) */
async function task(o: { id: string; projectId: string }, status: string, weight?: string) {
  return mk(owner, '/tasks', { projectId: o.projectId, title: `Задача ${uniq()}`, status, objectId: o.id, ...(weight ? { weight } : {}) });
}

/** Смета объекта с позициями; approve — сразу согласовать */
async function estimate(target: string, items: Record<string, unknown>[], approve = true) {
  const est = await mk(owner, `/objects/${target}/estimates`, { name: 'Смета объекта' });
  const put = await owner.put(`/estimates/${est.id}/items`, { sections: [], items: items.map(i => ({ id: uid(), unitCode: '796', qty: '1', price: '0', ...i })) });
  if (put.status >= 300) throw new Error(`items ${est.id}: ${put.status} ${JSON.stringify(put.body)}`);
  if (approve) await mk(owner, `/estimates/${est.id}/approve`);
  return est.id as string;
}

const progress = (id: string, c: Client = owner) => c.get(`/objects/${id}/progress`);
const milestones = (id: string, c: Client = owner) => c.get(`/objects/${id}/milestones`);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Object progress WS' });
  member = await addMember(owner, 'member');
  other = new Client();
  await other.signup({ workspaceName: 'Other object progress WS' });
  const o = await object('PRG-1');
  objectId = o.id;
  projectId = o.projectId;
});

describe('процент выполнения: способы расчёта', () => {
  test('по умолчанию — по закрытым задачам; ноль задач — базы нет', async () => {
    const p = await progress(objectId);
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ mode: 'tasks_closed', percent: null, progressManual: null });
    expect(p.body.base.tasks).toMatchObject({ total: 0, closed: 0 });
  });

  test('tasks_closed — доля задач в статусе done', async () => {
    await task({ id: objectId, projectId }, 'done');
    await task({ id: objectId, projectId }, 'todo');
    const p = await progress(objectId);
    expect(p.body.percent).toBe('50.0');
    expect(p.body.base.tasks).toMatchObject({ total: 2, closed: 1 });
  });

  test('tasks_avg — средний прогресс задач (завершённая 100, иначе 0)', async () => {
    await owner.patch(`/objects/${objectId}`, { progressMode: 'tasks_avg' });
    const p = await progress(objectId);
    expect(p.body).toMatchObject({ mode: 'tasks_avg', percent: '50.0' });
  });

  test('task_weights — веса задач; без веса = 1', async () => {
    const o = await object();
    await task(o, 'done', '3');
    await task(o, 'todo', '1');
    await owner.patch(`/objects/${o.id}`, { progressMode: 'task_weights' });
    const p = await progress(o.id);
    // 3 / (3 + 1) = 75%
    expect(p.body.percent).toBe('75.0');
    expect(p.body.base.tasks).toMatchObject({ weightTotal: '4.00', weightClosed: '3.00' });
  });

  test('вес задачи сохраняется и меняется через PATCH задачи', async () => {
    const o = await object();
    const t = await task(o, 'todo', '2');
    expect(t.weight).toBe('2.00');
    const patched = await owner.patch(`/tasks/${t.id}`, { weight: '2.5' });
    expect(patched.status).toBe(200);
    expect(patched.body.weight).toBe('2.50');
    const cleared = await owner.patch(`/tasks/${t.id}`, { weight: null });
    expect(cleared.body.weight).toBeNull();
  });

  test('estimate_volume — выполненный объём позиций согласованной сметы; done_qty не больше qty', async () => {
    const o = await object();
    const est = await estimate(o.id, [
      { kind: 'work', name: 'Прокладка кабеля', qty: '100', price: '250' },
      { kind: 'work', name: 'Монтаж щита', qty: '2', price: '12000' },
    ]);
    await owner.patch(`/objects/${o.id}`, { progressMode: 'estimate_volume' });
    expect((await progress(o.id)).body.percent).toBe('0.0');

    const detail = await owner.get(`/estimates/${est}`);
    const [cable, panel] = detail.body.items;
    const save = await owner.patch(`/estimates/${est}/done-qty`, {
      items: [
        { id: cable.id, doneQty: '100' },
        { id: panel.id, doneQty: '1' },
      ],
    });
    expect(save.status).toBe(200);
    // (100 × 250 + 1 × 12000) / (100 × 250 + 2 × 12000) = 37000 / 49000 = 75.5%
    const p = await progress(o.id);
    expect(p.body.percent).toBe('75.5');
    expect(p.body.base.estimate).toMatchObject({ lines: 2, revenue: '49000.00', doneRevenue: '37000.00' });

    const over = await owner.patch(`/estimates/${est}/done-qty`, { items: [{ id: cable.id, doneQty: '101' }] });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('done_qty_exceeds');
  });

  test('estimate_volume без согласованной сметы — базы нет', async () => {
    const o = await object();
    await estimate(o.id, [{ kind: 'work', name: 'Работа', qty: '1', price: '100' }], false);
    await owner.patch(`/objects/${o.id}`, { progressMode: 'estimate_volume' });
    const p = await progress(o.id);
    expect(p.body.percent).toBeNull();
    expect(p.body.base.estimate).toBeNull();
    expect(p.body.contractValue).toBeNull();
  });

  test('manual — ручной процент, не задан — null', async () => {
    const o = await object();
    const res = await owner.patch(`/objects/${o.id}`, { progressMode: 'manual', progressManual: '42.5' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ progressMode: 'manual', progressManual: '42.50' });
    const p = await progress(o.id);
    expect(p.body).toMatchObject({ mode: 'manual', percent: '42.5', progressManual: '42.50' });
    const manual = await object();
    await owner.patch(`/objects/${manual.id}`, { progressMode: 'manual' });
    expect((await progress(manual.id)).body.percent).toBeNull();
  });

  test('процент видят все участники, в том числе member', async () => {
    const p = await progress(objectId, member);
    expect(p.status).toBe(200);
    expect(p.body.percent).not.toBeUndefined();
  });
});

describe('вехи объекта', () => {
  let target = '';

  beforeAll(async () => {
    target = (await object()).id;
    // стоимость договора: 100 000 без НДС
    await estimate(target, [{ kind: 'work', name: 'Работы', qty: '1', price: '100000' }]);
  });

  test('создание вехи: сумма или процент, но не оба', async () => {
    const both = await owner.post(`/objects/${target}/milestones`, { name: 'Оба', amount: '1000', pct: '10' });
    expect(both.status).toBe(400);
    const neither = await owner.post(`/objects/${target}/milestones`, { name: 'Ничего' });
    expect(neither.status).toBe(400);
    // сервис тоже проверяет: веха без суммы и процента не сохранится
    const created = await owner.post(`/objects/${target}/milestones`, { name: 'Аванс', kind: 'advance', pct: '30' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Аванс', kind: 'advance', pct: '30.00', value: '30000.00', invoiced: null, paid: null });
  });

  test('CRUD: список, правка, удаление', async () => {
    const created = await mk(owner, `/objects/${target}/milestones`, { name: 'Этап 1', amount: '5000', note: 'черновик' });
    const patched = await owner.patch(`/objects/${target}/milestones/${created.id}`, { name: 'Этап 1 (уточнён)', amount: '6000' });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: 'Этап 1 (уточнён)', amount: '6000.00', value: '6000.00' });
    const list = await milestones(target);
    expect(list.status).toBe(200);
    expect(list.body.items.map((m: any) => m.id)).toContain(created.id);
    expect(list.body.contractValue).toBe('100000.00');
    expect((await owner.del(`/objects/${target}/milestones/${created.id}`)).status).toBe(200);
    expect((await milestones(target)).body.items.map((m: any) => m.id)).not.toContain(created.id);
  });

  test('member создаёт и отмечает вехи, удаление тоже member', async () => {
    const created = await member.post(`/objects/${target}/milestones`, { name: 'Веха member', amount: '100' });
    expect(created.status).toBe(201);
    expect((await member.post(`/objects/${target}/milestones/${created.body.id}/done`, {})).status).toBe(200);
    expect((await member.del(`/objects/${target}/milestones/${created.body.id}`)).status).toBe(200);
  });

  test('принято только после выполнено — 422 milestone_not_done', async () => {
    const created = await mk(owner, `/objects/${target}/milestones`, { name: 'Приёмка', amount: '1000' });
    const accept = await owner.post(`/objects/${target}/milestones/${created.id}/accept`, {});
    expect(accept.status).toBe(422);
    expect(accept.body.error.code).toBe('milestone_not_done');
    const done = await owner.post(`/objects/${target}/milestones/${created.id}/done`, {});
    expect(done.body.doneAt).toBeTruthy();
    const accepted = await owner.post(`/objects/${target}/milestones/${created.id}/accept`, {});
    expect(accepted.status).toBe(200);
    expect(accepted.body.acceptedAt).toBeTruthy();
    // снятие выполнения снимает и приёмку
    const undone = await owner.post(`/objects/${target}/milestones/${created.id}/done`, { done: false });
    expect(undone.body.doneAt).toBeNull();
    expect(undone.body.acceptedAt).toBeNull();
  });

  test('сводка: выполнено и принято по этапам, аванс отдельно и вне выполнения', async () => {
    const o = await object();
    await estimate(o.id, [{ kind: 'work', name: 'Работы', qty: '1', price: '100000' }]);
    const advance = await mk(owner, `/objects/${o.id}/milestones`, { name: 'Аванс 30%', kind: 'advance', pct: '30' });
    const traces = await mk(owner, `/objects/${o.id}/milestones`, { name: 'Кабельные трассы', pct: '40' });
    await mk(owner, `/objects/${o.id}/milestones`, { name: 'Пусконаладка', pct: '30' });
    await owner.post(`/objects/${o.id}/milestones/${advance.id}/done`, {});
    await owner.post(`/objects/${o.id}/milestones/${traces.id}/done`, {});
    await owner.post(`/objects/${o.id}/milestones/${traces.id}/accept`, {});

    const list = await milestones(o.id);
    expect(list.body.summary).toMatchObject({
      contractValue: '100000.00',
      stages: { total: '70000.00', done: '40000.00', accepted: '40000.00', invoiced: null, paid: null },
      advance: { total: '30000.00', done: '30000.00', accepted: '0.00', invoiced: null, paid: null },
    });
    // выполнено по этапам не включает аванс: 40 000 из 70 000
    const tracesView = list.body.items.find((m: any) => m.name === 'Кабельные трассы');
    expect(tracesView.value).toBe('40000.00');
  });

  test('веха-процент без согласованной сметы: сумма не считается', async () => {
    const o = await object();
    const m = await mk(owner, `/objects/${o.id}/milestones`, { name: 'Этап', pct: '50' });
    expect(m.value).toBeNull();
    const list = await milestones(o.id);
    expect(list.body.summary.stages.total).toBeNull();
    expect(list.body.contractValue).toBeNull();
  });
});

describe('изоляция арендаторов', () => {
  test('чужой объект: progress и вехи — 404, чужие вехи не видны', async () => {
    expect((await progress(objectId, other)).status).toBe(404);
    expect((await milestones(objectId, other)).status).toBe(404);
    const foreign = await mk(owner, `/objects/${objectId}/milestones`, { name: 'Чужая веха', amount: '1' });
    expect((await other.patch(`/objects/${objectId}/milestones/${foreign.id}`, { name: 'Подмена' })).status).toBe(404);
    expect((await other.del(`/objects/${objectId}/milestones/${foreign.id}`)).status).toBe(404);
    expect((await other.post(`/objects/${objectId}/milestones/${foreign.id}/done`, {})).status).toBe(404);
    const own = await object('OTHER-1');
    expect((await other.get(`/objects/${own.id}/milestones`)).status).toBe(404);
  });

  test('ссылка на веху другого объекта — 404', async () => {
    const a = await object();
    const b = await object();
    const m = await mk(owner, `/objects/${a.id}/milestones`, { name: 'Веха A', amount: '1' });
    expect((await owner.patch(`/objects/${b.id}/milestones/${m.id}`, { name: 'Перенос' })).status).toBe(404);
    expect((await owner.del(`/objects/${b.id}/milestones/${m.id}`)).status).toBe(404);
  });
});

describe('задачи объекта: веса и прогресс', () => {
  test('вес задачи в форме хранится в numeric(10,2) и влияет на процент', async () => {
    const o = await object();
    await task(o, 'done', '9');
    await task(o, 'todo', '1');
    await owner.patch(`/objects/${o.id}`, { progressMode: 'task_weights' });
    expect((await progress(o.id)).body.percent).toBe('90.0');
    // нулевой вес база данных не принимает
    const bad = await owner.post('/tasks', { projectId: o.projectId, title: 'Плохой вес', status: 'todo', objectId: o.id, weight: '0' });
    expect(bad.status).toBe(422);
  });
});
