/* Входящая почта: IMAP полностью подставной, MIME настоящий; никаких внешних подключений. */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { emailRuntime, MemoryFileStore, parseInboundEmail, setFileStore, syncMailbox, withContext } from '@erp/db';
import { addMember, admin, Client, sql } from './helpers';
import { startRunsForEvent } from '../../worker/src/flows/triggers';

type Source = { uid: number; source: Uint8Array | null; size: number };
let sources: Source[] = [];
let validity = '100';
let ranges: [number, number][] = [];
const keyBefore = process.env.SECRETS_KEY;
const mime = (o: { id?: string; from?: string; subject?: string; reply?: string; refs?: string; body?: string; attachment?: boolean } = {}) => Buffer.from([
  `From: Sender <${o.from ?? 'sender@example.com'}>`, 'To: Robot <robot@example.com>', 'Cc: Copy <copy@example.com>',
  `Subject: ${o.subject ?? 'Reply'}`, `Message-ID: ${o.id ?? '<incoming@example.com>'}`, 'Date: Thu, 19 Nov 2026 10:00:00 +0300',
  ...(o.reply ? [`In-Reply-To: ${o.reply}`] : []), ...(o.refs ? [`References: ${o.refs}`] : []),
  'MIME-Version: 1.0',
  ...(o.attachment ? [
    'Content-Type: multipart/mixed; boundary="test-boundary"', '', '--test-boundary', 'Content-Type: text/html; charset=utf-8', '',
    '<p>Hello <b>world</b></p><script>alert(1)</script><img src="x" onerror="alert(1)">',
    '--test-boundary', 'Content-Type: text/plain; name="answer.txt"', 'Content-Disposition: attachment; filename="answer.txt"', 'Content-Transfer-Encoding: base64', '', 'aGVsbG8=', '--test-boundary--',
  ] : ['Content-Type: text/plain; charset=utf-8', '', o.body ?? 'Incoming message']),
].join('\r\n'));
const source = (uid: number, data = mime()): Source => ({ uid, source: data, size: data.length });

beforeAll(() => {
  process.env.SECRETS_KEY = 'e'.repeat(64);
  emailRuntime.imapFor = async () => ({
    uidValidity: validity,
    uidNext: Math.max(0, ...sources.map(s => s.uid)) + 1,
    fetchRange: async (from, to) => { ranges.push([from, to]); return sources.filter(s => s.uid >= from && s.uid <= to); },
    close: async () => {},
  });
});
afterAll(() => {
  emailRuntime.imapFor = undefined;
  if (keyBefore === undefined) delete process.env.SECRETS_KEY;
  else process.env.SECRETS_KEY = keyBefore;
  setFileStore(null);
});
beforeEach(() => { sources = []; validity = '100'; ranges = []; setFileStore(new MemoryFileStore()); });

async function fixture(over: Record<string, unknown> = {}) {
  const owner = new Client();
  await owner.signup({ workspaceName: 'Входящие письма' });
  const response = await owner.post('/mailboxes', {
    kind: 'shared', email: 'robot@example.com', smtpHost: 'smtp.example.com', smtpPort: 465, smtpSecure: 'ssl', smtpUser: 'robot@example.com',
    imapHost: 'imap.example.com', imapPort: 993, imapSecure: 'ssl', imapUser: 'robot@example.com', password: 'test-app-password', ...over,
  });
  expect(response.status).toBe(201);
  const workspaceId = owner.workspaceId!;
  const mailboxId = response.body.id as string;
  return { owner, workspaceId, mailboxId, sync: () => syncMailbox(sql, workspaceId, mailboxId) };
}
const incoming = (ws: string) => admin`select * from email_messages where workspace_id = ${ws} and direction = 'in' order by created_at, id`;

describe('разбор входящего письма', () => {
  test('MIME: адреса, заголовки, очищенный HTML и бинарное вложение', async () => {
    const parsed = await parseInboundEmail(mime({ attachment: true, reply: '<sent@example.com>', refs: '<older@example.com> <sent@example.com>' }));
    expect(parsed.fromEmail).toBe('sender@example.com');
    expect(parsed.fromName).toBe('Sender');
    expect(parsed.to).toEqual(['robot@example.com']);
    expect(parsed.cc).toEqual(['copy@example.com']);
    expect(parsed.messageId).toBe('<incoming@example.com>');
    expect(parsed.inReplyTo).toBe('<sent@example.com>');
    expect(parsed.references).toContain('<older@example.com>');
    expect(parsed.bodyHtml).toContain('world');
    expect(parsed.bodyHtml).not.toContain('<script');
    expect(parsed.bodyHtml).not.toContain('onerror');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]!.name).toBe('answer.txt');
    expect(Buffer.from(parsed.attachments[0]!.data).toString()).toBe('hello');
  });
});

describe('синхронизация и сопоставление', () => {
  test('In-Reply-To важнее адреса; References также переносит привязки отправленного письма', async () => {
    const f = await fixture();
    const contact = (await f.owner.post('/contacts', { name: 'Совпадение адреса', email: 'sender@example.com' })).body;
    const lead = (await f.owner.post('/leads', { name: 'Лид переписки', email: 'another@example.com' })).body;
    const sent = await f.owner.post('/emails', { mailboxId: f.mailboxId, to: ['sender@example.com'], subject: 'Start', body: 'Hello', leadId: lead.id });
    expect(sent.status).toBe(202);
    await admin`update email_messages set status = 'sent' where id = ${sent.body.id}`;
    sources = [source(1, mime({ id: '<reply@example.com>', reply: sent.body.messageId })), source(2, mime({ id: '<ref@example.com>', refs: `<unknown@example.com> ${sent.body.messageId}` }))];
    expect(await f.sync()).toBe(2);
    const rows = await incoming(f.workspaceId);
    expect(rows.map(r => r.lead_id)).toEqual([lead.id, lead.id]);
    expect(rows.every(r => r.contact_id === null)).toBe(true);
    expect(contact.id).toBeTruthy();
    const acts = await admin`select * from crm_activities where workspace_id = ${f.workspaceId} and email_message_id = any(${rows.map(r => r.id)}::uuid[])`;
    expect(acts).toHaveLength(2);
    expect(acts.every(r => r.type === 'email' && r.lead_id === lead.id)).toBe(true);
  });

  test('адрес отправителя сопоставляется без учёта регистра: контакт → контрагент, затем лид', async () => {
    const f = await fixture();
    const me = (await f.owner.get('/members')).body.items.find((m: any) => m.email === f.owner.user!.email).id;
    const company = (await f.owner.post('/companies', { name: 'Клиент' })).body;
    const contact = (await f.owner.post('/contacts', { name: 'Контакт', email: 'SENDER@example.com', companyId: company.id, ownerId: me })).body;
    const lead = (await f.owner.post('/leads', { name: 'Лид', email: 'lead@example.com' })).body;
    sources = [source(1), source(2, mime({ id: '<lead-in@example.com>', from: 'LEAD@example.com' }))];
    expect(await f.sync()).toBe(2);
    const rows = await incoming(f.workspaceId);
    expect(rows[0]).toMatchObject({ contact_id: contact.id, company_id: company.id, lead_id: null });
    expect(rows[1]).toMatchObject({ lead_id: lead.id, contact_id: null });
    const notes = await admin`select * from notifications where workspace_id = ${f.workspaceId} and recipient_id = ${me}`;
    expect(notes.length).toBeGreaterThan(0);
    const events = await admin`select * from events where workspace_id = ${f.workspaceId} and type = 'email.received'`;
    expect(events).toHaveLength(2);
  });

  test('курсор UIDVALIDITY/UID: повторный запуск не создаёт дублей, новый UID принимается, смена validity читает INBOX заново', async () => {
    const f = await fixture();
    sources = [source(4)];
    expect(await f.sync()).toBe(1);
    expect(await f.sync()).toBe(0);
    sources.push(source(8, mime({ id: '<second@example.com>' })));
    expect(await f.sync()).toBe(1);
    let [box] = await admin`select * from mailboxes where id = ${f.mailboxId}`;
    expect(box!.imap_uid_validity).toBe('100');
    expect(Number(box!.imap_last_uid)).toBe(8);
    validity = '101';
    sources = [source(2, mime({ id: '<new-epoch@example.com>' }))];
    expect(await f.sync()).toBe(1);
    [box] = await admin`select * from mailboxes where id = ${f.mailboxId}`;
    expect(box!.imap_uid_validity).toBe('101');
    expect(Number(box!.imap_last_uid)).toBe(2);
    expect((await incoming(f.workspaceId))).toHaveLength(3);
    expect(ranges.at(-1)![0]).toBe(1);
  });

  test('лид по умолчанию не создаётся; включённый флажок общего ящика создаёт его один раз', async () => {
    const f = await fixture();
    expect((await f.owner.get(`/mailboxes/${f.mailboxId}`)).body.createLeadFromUnmatched).toBe(false);
    sources = [source(1)];
    await f.sync();
    expect((await incoming(f.workspaceId))[0]!.lead_id).toBeNull();
    expect((await f.owner.get('/leads')).body.items).toHaveLength(0);
    expect((await f.owner.patch(`/mailboxes/${f.mailboxId}`, { createLeadFromUnmatched: true })).status).toBe(200);
    sources.push(source(2, mime({ id: '<auto-lead@example.com>', from: 'new@example.com' })));
    expect(await f.sync()).toBe(1);
    expect(await f.sync()).toBe(0);
    const rows = await incoming(f.workspaceId);
    const leads = (await f.owner.get('/leads')).body.items;
    expect(leads).toHaveLength(1);
    expect(leads[0].email).toBe('new@example.com');
    expect(rows[1]!.lead_id).toBe(leads[0].id);
  });

  test('флажок личного ящика не создаёт лиды', async () => {
    const f = await fixture({ kind: 'personal', createLeadFromUnmatched: true });
    sources = [source(1)];
    await f.sync();
    expect((await f.owner.get('/leads')).body.items).toHaveLength(0);
  });

  test('вложения хранятся как email: содержимое доступно владельцу, чужой личный ящик и другой воркспейс скрыты', async () => {
    const f = await fixture({ kind: 'personal' });
    sources = [source(1, mime({ attachment: true }))];
    expect(await f.sync()).toBe(1);
    const [message] = await incoming(f.workspaceId);
    const list = await f.owner.get(`/attachments?entityType=email&entityId=${message!.id}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const id = list.body.items[0].id;
    expect((await f.owner.get(`/attachments/${id}/content`)).body).toBe('hello');
    const member = await addMember(f.owner);
    expect((await member.get(`/attachments/${id}`)).status).toBe(404);
    expect((await member.get(`/attachments?entityType=email&entityId=${message!.id}`)).body.items).toHaveLength(0);
    const other = new Client();
    await other.signup();
    expect((await other.get(`/attachments/${id}/content`)).status).toBe(404);
  });
});


test('триггер входящего письма получает связанный контакт, ящик и отправителя; событие не запускается повторно', async () => {
  const f = await fixture();
  const me = (await f.owner.get('/members')).body.items.find((m: any) => m.email === f.owner.user!.email).id;
  const contact = (await f.owner.post('/contacts', { name: 'Связанный контакт', email: 'sender@example.com' })).body;
  const graph = {
    nodes: [
      { id: 'trigger', type: 'trigger.email_received', position: { x: 0, y: 0 }, params: { mailboxId: f.mailboxId } },
      { id: 'notify', type: 'action.notify', position: { x: 220, y: 0 }, params: { recipientId: me, text: '{{trigger.email.subject}}', snippet: '{{trigger.record.name}}' } },
    ],
    edges: [{ id: 'trigger-notify', source: 'trigger', target: 'notify', sourceHandle: 'out' }],
  };
  const created = await f.owner.post('/flows', { name: 'Входящее письмо', graph });
  expect(created.status).toBe(201);
  const flowId = created.body.id;
  expect((await f.owner.post(`/flows/${flowId}/publish`, { enable: true })).status).toBe(200);
  sources = [source(1)];
  await f.sync();
  const [event] = await admin`select * from events where workspace_id = ${f.workspaceId} and type = 'email.received'`;
  const row = {
    id: event!.id, workspaceId: event!.workspace_id, entity: event!.entity, type: event!.type, recordId: event!.record_id,
    actorId: event!.actor_id, payload: event!.payload,
  };
  expect(await withContext(sql, { workspaceId: f.workspaceId, system: true }, db => startRunsForEvent(db, row as never), 'app_worker')).toBe(1);
  expect(await withContext(sql, { workspaceId: f.workspaceId, system: true }, db => startRunsForEvent(db, row as never), 'app_worker')).toBe(0);
  const [run] = await admin`select trigger from flow_runs where flow_id = ${flowId}`;
  expect(run!.trigger).toMatchObject({ entity: 'contact', recordId: contact.id, record: { name: 'Связанный контакт' }, email: { mailboxId: f.mailboxId, fromEmail: 'sender@example.com' } });
});

test('смена UIDVALIDITY не повторяет письмо с известным Message-ID', async () => {
  const f = await fixture();
  sources = [source(1)];
  expect(await f.sync()).toBe(1);
  validity = '200';
  sources = [source(3), source(5, mime({ id: '<new-after-reset@example.com>' }))];
  expect(await f.sync()).toBe(1);
  expect(await f.sync()).toBe(0);
  expect(await incoming(f.workspaceId)).toHaveLength(2);
  const [box] = await admin`select imap_uid_validity, imap_last_uid from mailboxes where id = ${f.mailboxId}`;
  expect(box!.imap_uid_validity).toBe('200');
  expect(Number(box!.imap_last_uid)).toBe(5);
});

test('ответ на отправленное без привязок ищет контакт по адресу', async () => {
  const f = await fixture();
  const contact = (await f.owner.post('/contacts', { name: 'Контакт', email: 'sender@example.com' })).body;
  const sent = await f.owner.post('/emails', { to: ['sender@example.com'], subject: 'No links', body: 'Hello' });
  expect(sent.status).toBe(202);
  await admin`update email_messages set status = 'sent' where id = ${sent.body.id}`;
  sources = [source(1, mime({ reply: sent.body.messageId }))];
  expect(await f.sync()).toBe(1);
  expect((await incoming(f.workspaceId))[0]!.contact_id).toBe(contact.id);
});

test('конкурентные синхронизации создают одно письмо и одно касание', async () => {
  const f = await fixture();
  await f.owner.post('/contacts', { name: 'Контакт', email: 'sender@example.com' });
  sources = [source(1)];
  const results = await Promise.all([f.sync(), f.sync()]);
  expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);
  const rows = await incoming(f.workspaceId);
  expect(rows).toHaveLength(1);
  const acts = await admin`select id from crm_activities where workspace_id = ${f.workspaceId} and email_message_id = ${rows[0]!.id}`;
  expect(acts).toHaveLength(1);
  const events = await admin`select id from events where workspace_id = ${f.workspaceId} and type = 'email.received'`;
  expect(events).toHaveLength(1);
});
