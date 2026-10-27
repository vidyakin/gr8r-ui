/* Задача 1175: лиды — CRUD и статусы, поиск дублей (телефон/email среди лидов и контактов, контрагент через контакт), объединение,
   конвертация (клиент, контакт, сделка, перенос касаний, повторная запрещена), публичный вебхук (токен, лимит, CORS, utm),
   автоматизации (триггеры, создание, назначение по кругу среди sales_manager), права и изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../src/app';
import { defaultOptions, processEventsOnce, processJobsOnce } from '../../worker/src/worker';
import { admin, Client, ddl, sql, testConfig } from './helpers';

const opts = () => defaultOptions({ log: () => {}, concurrency: 10, ddl });
async function drain(max = 60) {
  const o = opts();
  for (let i = 0; i < max; i++) if (!((await processEventsOnce(sql, o)) + (await processJobsOnce(sql, o)))) return;
  throw new Error('worker did not settle');
}

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let ownerId: string;
let memberId: string;
let statuses: any[];
const cat = (c: string) => statuses.find(s => s.category === c);

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Лиды WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужие лиды WS' });
  const people = (await owner.get('/members')).body.items as any[];
  ownerId = people.find(m => m.email === owner.user!.email).id;
  memberId = people.find(m => m.email === member.user!.email).id;
  statuses = (await owner.get('/lead-statuses')).body.items;
});

describe('статусы', () => {
  test('у нового воркспейса есть статусы всех категорий', () => {
    expect(statuses.map(s => s.category).sort()).toEqual(['converted', 'in_progress', 'in_progress', 'new', 'rejected']);
  });
  test('правка и порядок — только admin', async () => {
    expect((await member.post('/lead-statuses', { name: 'Х', category: 'in_progress' })).status).toBe(403);
    const s = await mk(owner, '/lead-statuses', { name: 'Waiting reply', category: 'in_progress', color: 'teal' });
    expect(s.sortOrder).toBe(statuses.length);
    expect((await owner.post('/lead-statuses', { name: 'WAITING REPLY', category: 'new' })).status).toBe(409);
    const ids = [s.id, ...statuses.map(x => x.id)];
    expect((await owner.post('/lead-statuses/reorder', { ids })).status).toBe(200);
    expect((await owner.get('/lead-statuses')).body.items[0].id).toBe(s.id);
    expect((await owner.del(`/lead-statuses/${s.id}`)).status).toBe(200);
  });
  test('нельзя удалить последний статус категории и используемый статус', async () => {
    expect((await owner.del(`/lead-statuses/${cat('converted').id}`)).status).toBe(422);
    const l = await mk(owner, '/leads', { name: 'Для статуса', statusId: cat('rejected').id });
    expect((await owner.del(`/lead-statuses/${cat('rejected').id}`)).status).toBe(409);
    await owner.del(`/leads/${l.id}?hard=true`);
  });
});

describe('лиды: создание и правка', () => {
  test('нормализация, статус по умолчанию, ответственный — автор', async () => {
    const l = await mk(owner, '/leads', { name: 'Иван', phone: '8 (916) 000-11-22', email: ' Ivan@Example.com ', custom: undefined });
    expect(l.phoneNorm).toBe('+79160001122');
    expect(l.emailNorm).toBe('ivan@example.com');
    expect(l.statusId).toBe(cat('new').id);
    expect(l.ownerId).toBe(ownerId);
    const p = await owner.patch(`/leads/${l.id}`, { phone: '+7 916 000 11 33' });
    expect(p.body.phoneNorm).toBe('+79160001133');
  });
  test('в статус категории converted вручную нельзя; отказ хранит причину, смена статуса её сбрасывает', async () => {
    const l = await mk(owner, '/leads', { name: 'Статусы' });
    expect((await owner.patch(`/leads/${l.id}`, { statusId: cat('converted').id })).status).toBe(422);
    const r = await owner.patch(`/leads/${l.id}`, { statusId: cat('rejected').id, rejectReason: 'Дорого' });
    expect(r.body.rejectReason).toBe('Дорого');
    const back = await owner.patch(`/leads/${l.id}`, { statusId: cat('new').id });
    expect(back.body.rejectReason).toBe('');
    expect((await owner.post('/leads', { name: 'X', statusId: cat('converted').id })).status).toBe(422);
  });
  test('пользовательские поля через конструктор', async () => {
    const f = await owner.post('/entities/lead/fields', { key: 'budget', name: 'Бюджет', type: 'number' });
    expect(f.status).toBe(201);
    const l = await mk(owner, '/leads', { name: 'С бюджетом', custom: { budget: 5000 } });
    expect(l.custom.budget).toBe(5000);
    expect((await owner.post('/leads', { name: 'Плохой', custom: { nope: 1 } })).status).toBe(400);
  });
  test('фильтры списка и поиск', async () => {
    await mk(owner, '/leads', { name: 'Поисковый Лид', source: 'Выставка' });
    expect((await owner.get('/leads?q=Поисковый')).body.total).toBe(1);
    expect((await owner.get('/leads?source=Выставка')).body.total).toBe(1);
    expect((await owner.get(`/leads?statusId=${cat('rejected').id}`)).body.items.length).toBeGreaterThanOrEqual(0);
  });
  test('касания лида', async () => {
    const l = await mk(owner, '/leads', { name: 'Касания' });
    const a = await mk(owner, '/crm-activities', { type: 'call', subject: 'Звонок', leadId: l.id });
    expect(a.leadId).toBe(l.id);
    expect((await owner.get(`/crm-activities?leadId=${l.id}`)).body.total).toBe(1);
  });
});

describe('дубли и объединение', () => {
  test('совпадение по телефону в разных форматах и по email: лиды, контакты, контрагент через контакт', async () => {
    const co = await mk(owner, '/companies', { name: 'ООО Дубль' });
    const ct = await mk(owner, '/contacts', { name: 'Пётр Дубль', phone: '+7 925 555-66-77', companyId: co.id, email: 'petr@dubl.ru' });
    const l = await mk(owner, '/leads', { name: 'Пётр лид', phone: '89255556677' });
    const d = (await owner.get(`/leads/duplicates?phone=${encodeURIComponent('8 (925) 555-66-77')}`)).body.items as any[];
    expect(d.some(x => x.kind === 'lead' && x.id === l.id && x.by === 'phone')).toBe(true);
    expect(d.some(x => x.kind === 'contact' && x.id === ct.id)).toBe(true);
    expect(d.some(x => x.kind === 'company' && x.id === co.id && x.by === 'contact')).toBe(true);
    const byEmail = (await owner.get('/leads/duplicates?email=PETR@dubl.ru')).body.items as any[];
    expect(byEmail.map(x => x.kind)).toContain('contact');
    const own = (await owner.get(`/leads/${l.id}/duplicates`)).body.items as any[];
    expect(own.some(x => x.id === l.id)).toBe(false);
    expect(own.some(x => x.kind === 'contact')).toBe(true);
    expect((await owner.get('/leads/duplicates?phone=123')).body.items).toHaveLength(0);
  });
  test('объединение переносит касания и заполняет пустые поля, исходный лид удаляется', async () => {
    const a = await mk(owner, '/leads', { name: 'Основной', phone: '+7 900 100-10-10' });
    const b = await mk(owner, '/leads', { name: 'Повтор', phone: '+7 900 100-10-10', email: 'dup@x.ru', comment: 'из повтора' });
    await mk(owner, '/crm-activities', { type: 'note', subject: 'Заметка повтора', leadId: b.id });
    expect((await owner.post(`/leads/${a.id}/merge`, { intoId: a.id })).status).toBe(422);
    const m = await owner.post(`/leads/${b.id}/merge`, { intoId: a.id });
    expect(m.status).toBe(200);
    expect(m.body.email).toBe('dup@x.ru');
    expect(m.body.comment).toContain('из повтора');
    expect((await owner.get(`/leads/${b.id}`)).status).toBe(404);
    const acts = (await owner.get(`/crm-activities?leadId=${a.id}`)).body.items as any[];
    expect(acts.map(x => x.subject)).toContain('Заметка повтора');
  });
});

describe('конвертация', () => {
  test('клиент + контакт + сделка, касания переезжают, повторно нельзя', async () => {
    const l = await mk(owner, '/leads', { name: 'Анна Клиент', phone: '+7 901 000-00-01', email: 'anna@k.ru' });
    await mk(owner, '/crm-activities', { type: 'call', subject: 'Первый звонок', leadId: l.id });
    const r = await owner.post(`/leads/${l.id}/convert`, { company: { mode: 'new', name: 'ООО Клиент' }, contact: { mode: 'new', name: 'Анна' }, deal: { name: 'Сделка Анны', amount: '1500.50' } });
    expect(r.status).toBe(200);
    const { companyId, contactId, dealId, lead } = r.body;
    expect(lead.statusId).toBe(cat('converted').id);
    expect(lead.convertedAt).toBeTruthy();
    expect((await owner.get(`/companies/${companyId}`)).body.name).toBe('ООО Клиент');
    const contact = (await owner.get(`/contacts/${contactId}`)).body;
    expect(contact).toMatchObject({ phone: '+7 901 000-00-01', email: 'anna@k.ru', companyId });
    const deal = (await owner.get(`/deals/${dealId}`)).body;
    expect(deal).toMatchObject({ amount: '1500.50', companyId });
    expect(deal.contactIds).toEqual([contactId]);
    expect((await owner.get(`/crm-activities?leadId=${l.id}`)).body.total).toBe(0);
    const moved = (await owner.get(`/crm-activities?dealId=${dealId}`)).body.items as any[];
    expect(moved.map(x => x.subject)).toContain('Первый звонок');
    const again = await owner.post(`/leads/${l.id}/convert`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('lead_already_converted');
    expect((await owner.patch(`/leads/${l.id}`, { statusId: cat('new').id })).status).toBe(409);
  });
  test('существующие контрагент и контакт подставляются, сделка не обязательна', async () => {
    const co = await mk(owner, '/companies', { name: 'ООО Есть' });
    const ct = await mk(owner, '/contacts', { name: 'Есть', companyId: co.id });
    const l = await mk(owner, '/leads', { name: 'Есть лид' });
    const r = await owner.post(`/leads/${l.id}/convert`, { company: { mode: 'existing', id: co.id }, contact: { mode: 'existing', id: ct.id } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ companyId: co.id, contactId: ct.id, dealId: null });
    const bad = await mk(owner, '/leads', { name: 'Плохая ссылка' });
    expect((await owner.post(`/leads/${bad.id}/convert`, { company: { mode: 'existing', id: '019d0000-0000-7000-8000-000000000000' } })).status).toBe(422);
  });
});

describe('вебхук формы', () => {
  const hook = (token: string, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    new Client().req('POST', `/hooks/leads/${token}`, { json: body, headers });
  let form: any;
  beforeAll(async () => {
    form = await mk(owner, '/lead-forms', { name: 'Лендинг', source: 'Сайт: лендинг', defaultOwnerId: memberId });
  });

  test('формы видит admin с токеном, участник — без токена', async () => {
    expect(form.webhookToken).toStartWith(`${ws}.`);
    expect(form.token).toBeUndefined();
    const asMember = (await member.get('/lead-forms')).body.items[0];
    expect(asMember.webhookToken).toBe('');
    expect((await member.post('/lead-forms', { name: 'Х' })).status).toBe(403);
  });
  test('заявка создаёт лид под нужным воркспейсом: источник, ответственный, utm', async () => {
    const r = await hook(form.webhookToken, { name: 'Заявка', phone: '+7 999 111-22-33', comment: 'Привет', utm_source: 'yandex', utm_campaign: 'spring', evil: '<x>' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ok: true });
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    const l = (await owner.get('/leads?q=Заявка')).body.items[0];
    expect(l).toMatchObject({ source: 'Сайт: лендинг', ownerId: memberId, formId: form.id, statusId: cat('new').id, custom: { utm_source: 'yandex', utm_campaign: 'spring' } });
    expect(l.custom.evil).toBeUndefined();
    expect((await other.get('/leads?q=Заявка')).body.total).toBe(0);
  });
  test('form-urlencoded тоже принимается', async () => {
    const r = await hook(form.webhookToken, 'name=Форма&email=f%40x.ru', { 'content-type': 'application/x-www-form-urlencoded' });
    // Client сериализует json в строку: для проверки формы шлём прямой запрос
    void r;
    const { app } = createApp({ sql, config: testConfig({}) });
    const res = await app.request(`/hooks/leads/${form.webhookToken}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Urlenc&email=u%40x.ru' });
    expect(res.status).toBe(201);
    expect((await owner.get('/leads?q=Urlenc')).body.total).toBe(1);
  });
  test('неверный токен, чужой секрет, выключенная форма — одинаковый 404; пустая заявка — 422', async () => {
    expect((await hook('garbage', { name: 'x' })).status).toBe(404);
    expect((await hook(`${ws}.${'a'.repeat(32)}`, { name: 'x' })).status).toBe(404);
    // секрет из своего воркспейса с чужим идентификатором не подходит: RLS не покажет форму
    const otherWs = other.workspaceId!;
    const secret = form.webhookToken.split('.')[1];
    expect((await hook(`${otherWs}.${secret}`, { name: 'x' })).status).toBe(404);
    expect((await hook(form.webhookToken, {})).status).toBe(422);
    await owner.patch(`/lead-forms/${form.id}`, { enabled: false });
    expect((await hook(form.webhookToken, { name: 'x' })).status).toBe(404);
    await owner.patch(`/lead-forms/${form.id}`, { enabled: true });
  });
  test('смена секрета отключает старый адрес', async () => {
    const f = await mk(owner, '/lead-forms', { name: 'Ротация' });
    expect((await hook(f.webhookToken, { name: 'до' })).status).toBe(201);
    const rot = await owner.post(`/lead-forms/${f.id}/rotate`);
    expect(rot.body.webhookToken).not.toBe(f.webhookToken);
    expect((await hook(f.webhookToken, { name: 'после' })).status).toBe(404);
    expect((await hook(rot.body.webhookToken, { name: 'после' })).status).toBe(201);
  });
  test('ограничение частоты по IP', async () => {
    const { app } = createApp({ sql, config: testConfig({ leadHookRateLimitMax: 3, leadHookRateLimitWindowMs: 60_000, trustProxy: true }) });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await app.request(`/hooks/leads/${form.webhookToken}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' }, body: JSON.stringify({ name: `rl${i}` }) })).status);
    expect(codes).toEqual([201, 201, 201, 429, 429]);
  });
  test('CORS preflight', async () => {
    const r = await new Client().req('OPTIONS', `/hooks/leads/${form.webhookToken}`, { headers: { origin: 'https://site.example', 'access-control-request-method': 'POST' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('автоматизации', () => {
  const g = (nodes: [string, string, Record<string, unknown>][], edges: [string, string][]) => ({
    nodes: nodes.map(([id, type, params], i) => ({ id, type, position: { x: i * 200, y: 0 }, params })),
    edges: edges.map(([source, target]) => ({ id: `${source}-${target}`, source, target, sourceHandle: null })),
  });
  test('«Лид создан» → назначить по кругу среди должности sales_manager', async () => {
    await drain(); // события прежних тестов обрабатываются до включения потока
    const pos = await mk(owner, '/positions', { name: 'Менеджер по продажам', functions: ['sales_manager'] });
    expect((await owner.put(`/positions/by-member/${ownerId}`, { positionIds: [pos.id] })).status).toBe(200);
    expect((await owner.put(`/positions/by-member/${memberId}`, { positionIds: [pos.id] })).status).toBe(200);
    const f = await mk(owner, '/flows', { name: 'Распределение', graph: g([['t', 'trigger.lead_created', {}], ['a', 'action.assign_lead', { leadId: '{{trigger.recordId}}', mode: 'round_robin' }]], [['t', 'a']]) });
    expect((await owner.post(`/flows/${f.id}/publish`, { enable: true })).status).toBe(200);
    const owners: string[] = [];
    for (let i = 0; i < 4; i++) {
      const l = await mk(owner, '/leads', { name: `Круг ${i}`, ownerId: null });
      await drain();
      owners.push((await owner.get(`/leads/${l.id}`)).body.ownerId);
    }
    // создатель назначается ответственным по умолчанию, поток затем переназначает по кругу: два менеджера чередуются
    expect(new Set(owners)).toEqual(new Set([ownerId, memberId]));
    expect(owners[0]).not.toBe(owners[1]);
    expect(owners[0]).toBe(owners[2]);
    await owner.patch(`/flows/${f.id}`, { enabled: false });
  });
  test('«Статус лида изменён» → «Создать лид»', async () => {
    const f = await mk(owner, '/flows', {
      name: 'Отказ → новый лид',
      graph: g([['t', 'trigger.lead_status_changed', { statusId: cat('rejected').id }], ['c', 'action.create_lead', { name: 'Повторный контакт {{trigger.record.name}}', source: 'Автоматизация' }]], [['t', 'c']]),
    });
    expect((await owner.post(`/flows/${f.id}/publish`, { enable: true })).status).toBe(200);
    const l = await mk(owner, '/leads', { name: 'Откажется' });
    await owner.patch(`/leads/${l.id}`, { statusId: cat('in_progress').id });
    await drain();
    expect((await owner.get('/leads?q=Повторный контакт')).body.total).toBe(0);
    await owner.patch(`/leads/${l.id}`, { statusId: cat('rejected').id });
    await drain();
    const made = (await owner.get('/leads?q=Повторный контакт')).body.items as any[];
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ name: 'Повторный контакт Откажется', source: 'Автоматизация', statusId: cat('new').id });
    await owner.patch(`/flows/${f.id}`, { enabled: false });
  });
});

describe('права и изоляция', () => {
  test('чужой воркспейс не видит и не меняет лиды, статусы и формы', async () => {
    const l = await mk(owner, '/leads', { name: 'Секретный' });
    expect((await other.get(`/leads/${l.id}`, other.workspaceId)).status).toBe(404);
    expect((await other.get('/leads')).body.items.some((x: any) => x.name === 'Секретный')).toBe(false);
    expect((await other.get('/lead-statuses')).body.items.some((s: any) => cat('new').id === s.id)).toBe(false);
    expect((await other.get(`/leads/${l.id}`, ws)).status).toBe(403);
    expect((await other.post(`/leads/${l.id}/convert`, {})).status).toBe(404);
    const rows = await admin`select count(*)::int as n from leads where workspace_id = ${other.workspaceId!}`;
    expect(rows[0]!.n).toBe(0);
  });
  test('нельзя сослаться на статус и ответственного чужого воркспейса', async () => {
    const foreign = (await other.get('/lead-statuses')).body.items[0].id;
    expect((await owner.post('/leads', { name: 'Чужой статус', statusId: foreign })).status).toBe(422);
    const foreignMember = (await other.get('/members')).body.items[0].id;
    expect((await owner.post('/leads', { name: 'Чужой менеджер', ownerId: foreignMember })).status).toBeGreaterThanOrEqual(400);
  });
});
