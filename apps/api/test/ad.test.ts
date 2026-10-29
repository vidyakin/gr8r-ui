/* Задача 1177: источники привлечения и рекламные кампании — справочник (права, дубли), кампания задаёт источник,
   кэш названия у лида, вебхук по utm_campaign, перенос источника при конвертации, источник сделки от контрагента,
   расходы и отчёт по каналам (CPL, ROMI), изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../src/app';
import { Client, sql, testConfig } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const today = new Date().toISOString().slice(0, 10);
// период отчёта вчера–завтра: created_at сравнивается с датой в часовом поясе сессии БД, а today — дата UTC
const dayOff = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const period = `from=${dayOff(-1)}&to=${dayOff(1)}`;

let direct: any;
let site: any;
let camp: any;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Реклама WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужая реклама WS' });
});

describe('справочник и кампании', () => {
  test('источники правит admin, название уникально без регистра', async () => {
    expect((await member.post('/lead-sources', { name: 'Х' })).status).toBe(403);
    direct = await mk(owner, '/lead-sources', { name: 'Яндекс.Директ', color: 'amber' });
    site = await mk(owner, '/lead-sources', { name: 'Сайт' });
    expect(site.sortOrder).toBe(1);
    // уникальность — индекс lower(name); тестовый кластер с локалью C, поэтому латиница
    await mk(owner, '/lead-sources', { name: 'Website' });
    expect((await owner.post('/lead-sources', { name: 'WEBSITE' })).status).toBe(409);
  });
  test('кампания: код utm уникален, период проверяется', async () => {
    camp = await mk(owner, '/ad-campaigns', { name: 'Кухни', sourceId: direct.id, utmCampaign: 'Kitchens', budget: 50000 });
    expect((await owner.post('/ad-campaigns', { name: 'Дубль', sourceId: site.id, utmCampaign: 'kitchens' })).status).toBe(409);
    expect((await owner.post('/ad-campaigns', { name: 'Период', sourceId: site.id, startDate: '2026-05-10', endDate: '2026-05-01' })).status).toBe(422);
    expect((await member.post('/ad-campaigns', { name: 'М', sourceId: site.id })).status).toBe(403);
  });
});

describe('атрибуция', () => {
  test('кампания задаёт источник лида, чужой источник — 422, текст ищет или создаёт источник', async () => {
    const l = await mk(member, '/leads', { name: 'По кампании', campaignId: camp.id });
    expect(l).toMatchObject({ sourceId: direct.id, campaignId: camp.id, source: 'Яндекс.Директ' });
    const bad = await member.post('/leads', { name: 'Плохо', campaignId: camp.id, sourceId: site.id });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('campaign_source_mismatch');
    const t = await mk(member, '/leads', { name: 'Текстом', source: 'САЙТ' });
    expect(t).toMatchObject({ sourceId: site.id, source: 'Сайт' });
    const n = await mk(member, '/leads', { name: 'Новый канал', source: 'Радио' });
    expect(n.source).toBe('Радио');
    expect((await owner.get('/lead-sources')).body.items.map((s: any) => s.name)).toContain('Радио');
    // смена источника сбрасывает кампанию другого источника
    const p = await member.patch(`/leads/${l.id}`, { sourceId: site.id });
    expect(p.body).toMatchObject({ sourceId: site.id, campaignId: null, source: 'Сайт' });
  });
  test('переименование источника обновляет кэш названия у лидов', async () => {
    const l = await mk(member, '/leads', { name: 'Кэш', sourceId: site.id });
    await owner.patch(`/lead-sources/${site.id}`, { name: 'Сайт компании' });
    expect((await owner.get(`/leads/${l.id}`)).body.source).toBe('Сайт компании');
  });
  test('вебхук: кампания по utm_campaign, иначе источник формы', async () => {
    const form = await mk(owner, '/lead-forms', { name: 'Лендинг', sourceId: site.id });
    expect(form.source).toBe('Сайт компании');
    const { app } = createApp({ sql, config: testConfig({}) });
    const send = (body: Record<string, unknown>) => app.request(`/hooks/leads/${form.webhookToken}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await send({ name: 'Utm-лид', utm_campaign: 'KITCHENS' })).status).toBe(201);
    expect((await send({ name: 'Без utm' })).status).toBe(201);
    expect((await owner.get('/leads?q=Utm-лид')).body.items[0]).toMatchObject({ campaignId: camp.id, sourceId: direct.id });
    expect((await owner.get('/leads?q=Без utm')).body.items[0]).toMatchObject({ campaignId: null, sourceId: site.id });
  });
  test('конвертация переносит источник в новых клиента и сделку; сделка без источника берёт его у клиента', async () => {
    const l = await mk(member, '/leads', { name: 'Конверсия', companyName: 'ООО «Кампания»', campaignId: camp.id });
    const r = await mk(member, `/leads/${l.id}/convert`, { company: { mode: 'new', name: 'ООО «Кампания»' }, contact: { mode: 'none' }, deal: { name: 'Сделка с рекламы', amount: '1000' } });
    expect((await owner.get(`/companies/${r.companyId}`)).body).toMatchObject({ sourceId: direct.id, campaignId: camp.id });
    expect((await owner.get(`/deals/${r.dealId}`)).body).toMatchObject({ sourceId: direct.id, campaignId: camp.id });
    const d = await mk(member, '/deals', { name: 'Повторная', companyId: r.companyId });
    expect(d).toMatchObject({ sourceId: direct.id, campaignId: camp.id });
    const own = await mk(member, '/deals', { name: 'Своя', companyId: r.companyId, sourceId: site.id });
    expect(own).toMatchObject({ sourceId: site.id, campaignId: null });
  });
});

describe('расходы и отчёт по каналам', () => {
  test('расход вносит admin; кампания показывает потраченное', async () => {
    expect((await member.post('/ad-expenses', { campaignId: camp.id, date: today, amount: 100 })).status).toBe(403);
    await mk(owner, '/ad-expenses', { campaignId: camp.id, date: today, amount: '15000' });
    await mk(owner, '/ad-expenses', { campaignId: camp.id, date: today, amount: '5000.50' });
    await mk(owner, '/ad-expenses', { campaignId: camp.id, date: '2020-01-01', amount: '999' });
    const c = (await owner.get('/ad-campaigns')).body.items.find((x: any) => x.id === camp.id);
    expect(c.spent).toBe('20999.50');
  });
  test('отчёт: лиды, клиенты, выручка выигранных сделок, CPL и ROMI', async () => {
    await mk(member, '/leads', { name: 'Без источника' });
    await mk(member, '/deals', { name: 'Выиграна', stage: 'won', amount: '60001.50', campaignId: camp.id, currency: 'RUB' });
    const r = await owner.get(`/ad-report?${period}&groupBy=campaign`);
    expect(r.status).toBe(200);
    const row = r.body.rows.find((x: any) => x.key === camp.id);
    // лиды кампании за сегодня: «По кампании» (источник потом сменён — уже не кампании), Utm-лид, Конверсия
    expect(row).toMatchObject({ name: 'Кухни', sourceName: 'Яндекс.Директ', leads: 2, converted: 1, newClients: 1, wonDeals: 1, revenue: '60001.50', expense: '20000.50', conversion: '50.0', cpl: '10000.25', cac: '20000.50', romi: '200.0' });
    expect(r.body.currencies).toEqual(['RUB']);
    const bySrc = (await member.get(`/ad-report?${period}`)).body;
    expect(bySrc.rows.find((x: any) => x.key === direct.id).expense).toBe('20000.50');
    expect(bySrc.total.expense).toBe('20000.50');
    expect(bySrc.rows.at(-1)).toMatchObject({ key: null, leads: 1 });
  });
});

describe('изоляция', () => {
  test('чужой воркспейс не видит источники и не может сослаться на кампанию', async () => {
    expect((await other.get('/lead-sources')).body.total).toBe(0);
    expect((await other.post('/leads', { name: 'Чужая кампания', campaignId: camp.id })).status).toBe(422);
    expect((await other.post('/ad-expenses', { campaignId: camp.id, date: today, amount: 1 })).status).toBeGreaterThanOrEqual(400);
    const rep = (await other.get(`/ad-report?from=${today}&to=${today}`)).body;
    expect(rep.total.expense).toBe('0.00');
  });
});
