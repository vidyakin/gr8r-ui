/* Задача 1217: публичная ссылка отслеживания доставки (/public/delivery/:token) и уведомления клиенту (email/SMTP + SMS/мессенджер адаптер + журнал). */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { deliveryNotifyRuntime, emailRuntime, type MailTransport, type OutMail } from '@erp/db';
import { DELIVERY_SMS_WEBHOOK_SECRET } from '@erp/shared';
import { addMember, admin, app, Client, drainJobs } from './helpers';

const KEY = 'd'.repeat(64);

let owner: Client;
let courier: Client;
let other: Client;
let ws: string;
let courierId: string;
let wh: string;
let customer: string;
let goods: string;
let svc: string;
let method: string;

let sentEmails: OutMail[] = [];
let webhookCalls: { url: string; body: any }[] = [];
const origFetch = deliveryNotifyRuntime.fetch;
const origAppBaseUrl = deliveryNotifyRuntime.appBaseUrl;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

const pubGet = async (path: string) => {
  const res = await app.request(path, { method: 'GET' });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
};

beforeAll(async () => {
  process.env.SECRETS_KEY = KEY;
  process.env.FLOW_HTTP_ALLOW_PRIVATE = '1';
  deliveryNotifyRuntime.appBaseUrl = () => 'https://erp.example.test';
  emailRuntime.transportFor = (): MailTransport => ({
    sendMail: async mail => {
      sentEmails.push(mail);
      return { messageId: mail.messageId };
    },
    verify: async () => {},
    close: () => {},
  });
  deliveryNotifyRuntime.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    webhookCalls.push({ url, body });
    return new Response(JSON.stringify({ id: `wh-${webhookCalls.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  owner = new Client();
  await owner.signup({ workspaceName: 'Трекинг WS' });
  ws = owner.workspaceId!;
  courier = await addMember(owner, 'member');
  other = new Client();
  await other.signup({ workspaceName: 'Чужой WS' });

  const members = (await owner.get('/members')).body.items as any[];
  courierId = members.find(m => m.email === courier.user!.email).id;
  const pos = (await owner.post('/positions', { name: 'Курьер', functions: ['courier'] })).body;
  await owner.put(`/positions/by-member/${courierId}`, { positionIds: [pos.id] });

  wh = (await owner.get('/warehouses')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Клиент»', actualAddress: 'Москва, Тверская, 10' })).id;
  await mk(owner, '/contacts', { name: 'Анна Смирнова', phone: '+79991112233', email: 'anna@client.test', companyId: customer });
  goods = (await mk(owner, '/products', { name: 'Товар', kind: 'goods', unitCode: '796', price: 1000, purchasePrice: 500, vatRate: 'none' })).id;
  svc = (await mk(owner, '/products', { name: 'Доставка', kind: 'service', unitCode: '876', price: 0, vatRate: 'none' })).id;
  method = (await mk(owner, '/delivery-methods', { name: 'Курьерская доставка', kind: 'own_courier', productId: svc, clientRate: { base: '300' }, costRate: { base: '150' } })).id;
});

afterAll(() => {
  emailRuntime.transportFor = undefined;
  deliveryNotifyRuntime.fetch = origFetch;
  deliveryNotifyRuntime.appBaseUrl = origAppBaseUrl;
  delete process.env.SECRETS_KEY;
  delete process.env.FLOW_HTTP_ALLOW_PRIVATE;
});

beforeEach(() => {
  sentEmails = [];
  webhookCalls = [];
});

describe('public tracking link and safe payload', () => {
  let order: any;
  let delivery: any;

  test('defaults contactEmail from primary contact; tracking is disabled initially', async () => {
    order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: wh, lines: [{ productId: goods, qty: 2, price: 1000 }] });
    const r = await owner.put(`/deliveries/by-document/${order.id}`, {
      methodId: method,
      deliveryDate: '2026-11-26',
      windowFrom: '10:00',
      windowTo: '13:00',
      price: '350',
      ourCost: '150',
      comment: 'Внутренний секретный комментарий',
    });
    expect(r.status).toBe(200);
    delivery = r.body;
    expect(delivery.contactEmail).toBe('anna@client.test');
    expect(delivery.trackingEnabled).toBe(false);
    expect(delivery.trackingToken).toBeNull();
    expect((await pubGet('/public/delivery/invalid-short')).status).toBe(404);
  });

  test('enabling tracking issues token, serves safe public DTO without leaking prices/notes/PII', async () => {
    const enabled = await owner.post(`/deliveries/${delivery.id}/tracking`, { enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.trackingEnabled).toBe(true);
    expect(enabled.body.trackingToken).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    const token = enabled.body.trackingToken as string;

    await drainJobs();

    const pub = await pubGet(`/public/delivery/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get('cache-control')).toBe('no-store');
    expect(pub.body).toMatchObject({
      workspaceName: 'Трекинг WS',
      documentType: 'customer_order',
      documentNumber: order.number,
      status: 'new',
      deliveryDate: '2026-11-26',
      windowFrom: '10:00',
      windowTo: '13:00',
      addressSummary: 'Москва, Тверская, 10',
      contactName: 'Анна Смирнова',
      methodName: 'Курьерская доставка',
    });
    expect(pub.body.timeline).toHaveLength(1);
    expect(pub.body.timeline[0].status).toBe('new');

    const raw = JSON.stringify(pub.body);
    expect(raw).not.toContain('350');
    expect(raw).not.toContain('150');
    expect(raw).not.toContain('Внутренний секретный комментарий');
    expect(raw).not.toContain('+79991112233');
    expect(raw).not.toContain('anna@client.test');

    // без настроенной почты и SMS-вебхука уведомления логируются адаптером
    const logs = (await owner.get(`/deliveries/${delivery.id}/notifications`)).body.items as any[];
    expect(logs.length).toBe(2);
    expect(logs.every(l => l.eventKind === 'tracking_enabled' && l.status === 'logged' && l.provider === 'log')).toBe(true);
    expect(logs[0].message).toContain(`https://erp.example.test/#/d/${token}`);
    expect(logs[0].message).toContain('2026-11-26, 10:00–13:00');
  });

  test('rotate invalidates old token; disable returns 404', async () => {
    const cur = (await owner.get(`/deliveries/${delivery.id}`)).body;
    const oldToken = cur.trackingToken;

    const rot = await owner.post(`/deliveries/${delivery.id}/tracking`, { rotate: true });
    expect(rot.status).toBe(200);
    expect(rot.body.trackingToken).not.toBe(oldToken);
    expect((await pubGet(`/public/delivery/${oldToken}`)).status).toBe(404);
    expect((await pubGet(`/public/delivery/${rot.body.trackingToken}`)).status).toBe(200);

    const dis = await owner.post(`/deliveries/${delivery.id}/tracking`, { enabled: false });
    expect(dis.status).toBe(200);
    expect(dis.body.trackingEnabled).toBe(false);
    expect((await pubGet(`/public/delivery/${rot.body.trackingToken}`)).status).toBe(404);

    // включить обратно для следующих проверок
    await owner.post(`/deliveries/${delivery.id}/tracking`, { enabled: true });
    await drainJobs();
  });

  test('permissions & tenant isolation on tracking and notifications', async () => {
    expect((await courier.post(`/deliveries/${delivery.id}/tracking`, { enabled: false })).status).toBe(403);
    expect((await courier.post(`/deliveries/${delivery.id}/notify`, {})).status).toBe(403);
    expect((await courier.get(`/deliveries/${delivery.id}/notifications`)).status).toBe(404);

    expect((await other.post(`/deliveries/${delivery.id}/tracking`, { enabled: false })).status).toBe(404);
    expect((await other.get(`/deliveries/${delivery.id}/notifications`)).status).toBe(404);
    expect((await other.post(`/deliveries/${delivery.id}/notify`, {})).status).toBe(404);
  });
});

describe('status changes, time window updates, SMTP and SMS webhook adapters', () => {
  test('status transitions & window update trigger notifications and update public timeline', async () => {
    // настраиваем общий почтовый ящик и SMS webhook
    const boxRes = await owner.post('/mailboxes', {
      kind: 'shared',
      email: 'notify@shop.test',
      displayName: 'Магазин',
      smtpHost: 'smtp.shop.test',
      smtpPort: 465,
      smtpSecure: 'ssl',
      smtpUser: 'notify@shop.test',
      password: 'secret-smtp-password',
    });
    expect(boxRes.status).toBe(201);
    const secRes = await owner.put(`/secrets/${DELIVERY_SMS_WEBHOOK_SECRET}`, { value: 'https://sms.provider.test/send' });
    expect(secRes.status).toBe(200);

    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: wh, lines: [{ productId: goods, qty: 1, price: 1000 }] });
    const created = await owner.put(`/deliveries/by-document/${order.id}`, {
      methodId: method,
      deliveryDate: '2026-11-27',
      windowFrom: '09:00',
      windowTo: '12:00',
      trackingEnabled: true,
    });
    expect(created.status).toBe(200);
    const d = created.body;
    await drainJobs();
    expect(sentEmails).toHaveLength(1);
    expect(webhookCalls).toHaveLength(1);
    expect(sentEmails[0]!.to).toEqual(['anna@client.test']);
    expect(sentEmails[0]!.text).toContain(`https://erp.example.test/#/d/${d.trackingToken}`);
    expect(webhookCalls[0]!.body).toMatchObject({ channel: 'sms', recipient: '+79991112233', eventKind: 'tracking_enabled' });

    // обновление окна доставки
    await owner.put(`/deliveries/by-document/${order.id}`, { windowFrom: '14:00', windowTo: '17:00' });
    await drainJobs();
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails[1]!.text).toContain('2026-11-27, 14:00–17:00');
    expect(webhookCalls).toHaveLength(2);
    expect(webhookCalls[1]!.body.eventKind).toBe('window_updated');

    // назначение курьера -> status_assigned
    await owner.post(`/deliveries/${d.id}/assign`, { courierMemberId: courierId });
    await drainJobs();
    expect(sentEmails).toHaveLength(3);
    expect(webhookCalls).toHaveLength(3);
    expect(webhookCalls[2]!.body.eventKind).toBe('status_assigned');

    // курьер переводит в пути и доставлена
    await courier.post(`/deliveries/${d.id}/status`, { status: 'in_transit' });
    await courier.post(`/deliveries/${d.id}/status`, { status: 'delivered' });
    await drainJobs();
    expect(sentEmails).toHaveLength(5);
    expect(webhookCalls).toHaveLength(5);
    expect(webhookCalls[3]!.body.eventKind).toBe('status_in_transit');
    expect(webhookCalls[4]!.body.eventKind).toBe('status_delivered');

    const logs = (await owner.get(`/deliveries/${d.id}/notifications`)).body.items as any[];
    expect(logs).toHaveLength(10);
    expect(logs.every(l => l.status === 'sent')).toBe(true);
    expect(logs.filter(l => l.channel === 'email').every(l => l.provider === 'smtp' && !!l.externalId)).toBe(true);
    expect(logs.filter(l => l.channel === 'sms').every(l => l.provider === 'webhook' && !!l.externalId)).toBe(true);

    // проверка публичной страницы после завершения: timeline содержит все этапы
    const pub = await pubGet(`/public/delivery/${d.trackingToken}`);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('delivered');
    expect(pub.body.timeline.map((x: any) => x.status)).toEqual(['new', 'assigned', 'in_transit', 'delivered']);
    expect(pub.body.courierLabel).toBeTruthy();

    // RLS: delivery_notifications не видна без workspace контекста
    const dbCount = await admin`select count(*)::int as n from delivery_notifications where workspace_id = ${ws} and delivery_id = ${d.id}`;
    expect(dbCount[0]!.n).toBe(10);
  });

  test('manual notification returns 422 when explicit channel has no contact', async () => {
    const order = await mk(owner, '/documents', { type: 'customer_order', warehouseId: wh, lines: [{ productId: goods, qty: 1, price: 1000 }] });
    const d = (await owner.put(`/deliveries/by-document/${order.id}`, { methodId: method, contactEmail: '', contactPhone: '' })).body;
    const res = await owner.post(`/deliveries/${d.id}/notify`, { channel: 'email' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('delivery_notify_no_recipient');
  });
});
