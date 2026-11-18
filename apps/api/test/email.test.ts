/* Почта, инкремент А (задача 1092): ящики (права, пароль не уходит в ответы, RLS), очередь исходящих писем (отправка, повтор при
   временной ошибке, окончательная ошибка, касание в истории), выбор ящика, PDF печатной формы, узел автоматизации.
   SMTP — фейковый транспорт (emailRuntime.transportFor) и stream-транспорт nodemailer: сети нет. */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import nodemailer from 'nodemailer';
import { emailRuntime, mailboxes, MemoryFileStore, setFileStore, withContext, type MailServer, type MailTransport, type OutMail } from '@erp/db';
import { pdfRuntime } from '../../worker/src/handlers';
import { defaultOptions, processEventsOnce, processJobsOnce } from '../../worker/src/worker';
import { addMember, admin, Client, ddl, sql } from './helpers';

const KEY = 'c'.repeat(64);
const opts = () => defaultOptions({ log: () => {}, concurrency: 10, ddl });
async function drain(max = 30) {
  const o = opts();
  for (let i = 0; i < max; i++) {
    const n = (await processEventsOnce(sql, o)) + (await processJobsOnce(sql, o));
    if (!n) return;
  }
}

const SMTP = { smtpHost: 'smtp.example.com', smtpPort: 465, smtpSecure: 'ssl', smtpUser: 'robot@example.com', password: 'sekret-pass-1' } as const;
const box = (over: Record<string, unknown> = {}) => ({ kind: 'shared', email: 'robot@example.com', displayName: 'Робот', ...SMTP, ...over });

let sent: { server: MailServer; mail: OutMail }[] = [];
let behaviour: (n: number) => Error | null = () => null;
let calls = 0;

beforeAll(() => {
  process.env.SECRETS_KEY = KEY;
  emailRuntime.transportFor = (server): MailTransport => ({
    sendMail: async mail => {
      calls++;
      const err = behaviour(calls);
      if (err) throw err;
      sent.push({ server, mail });
      return { messageId: mail.messageId };
    },
    verify: async () => {
      if (server.password === 'bad') throw Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 });
    },
    close: () => {},
  });
  emailRuntime.imapProbe = async () => {};
});
afterAll(() => {
  emailRuntime.transportFor = undefined;
  emailRuntime.imapProbe = undefined;
  delete process.env.SECRETS_KEY;
  setFileStore(null);
});
beforeEach(() => {
  sent = [];
  calls = 0;
  behaviour = () => null;
});

let owner: Client;
let ws: string;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Почта WS' });
  ws = owner.workspaceId!;
});

const mailboxIds = async () => ((await owner.get('/mailboxes')).body.items as any[]).map(m => m.id);

describe('ящики: права и пароль', () => {
  let member: Client;
  let member2: Client;
  let shared: any;
  let personal: any;

  test('общий ящик создаёт admin+; в ответе пароля нет, есть hasPassword; секрет в хранилище, но не в списке /secrets', async () => {
    member = await addMember(owner, 'member');
    member2 = await addMember(owner, 'member');
    expect((await member.post('/mailboxes', box())).status).toBe(403);
    const r = await owner.post('/mailboxes', box());
    expect(r.status).toBe(201);
    shared = r.body;
    expect(JSON.stringify(r.body)).not.toContain('sekret-pass-1');
    expect(r.body.password).toBeUndefined();
    expect(r.body.hasPassword).toBe(true);
    expect(r.body.status).toBe('unchecked');
    const [row] = await admin`select ciphertext from workspace_secrets where workspace_id = ${ws} and key = ${`mailbox.${shared.id}.password`}`;
    expect(row!.ciphertext).not.toContain('sekret-pass-1');
    const secrets = await owner.get('/secrets');
    expect(secrets.body.items.some((s: any) => s.key.startsWith('mailbox.'))).toBe(false);
    expect((await owner.put(`/secrets/mailbox.${shared.id}.password`, { value: 'x' })).status).toBe(422);
    expect((await owner.del(`/secrets/mailbox.${shared.id}.password`)).status).toBe(422);
  });

  test('второй общий ящик — 409; личный ящик у каждого свой, один на участника', async () => {
    expect((await owner.post('/mailboxes', box({ email: 'other@example.com' }))).status).toBe(409);
    const p = await member.post('/mailboxes', box({ kind: 'personal', email: 'ivan@example.com', displayName: 'Иван' }));
    expect(p.status).toBe(201);
    personal = p.body;
    expect(p.body.memberId).not.toBeNull();
    expect((await member.post('/mailboxes', box({ kind: 'personal', email: 'ivan2@example.com' }))).status).toBe(409);
  });

  test('чужой личный ящик не виден и не правится (даже владельцу воркспейса)', async () => {
    const mine = (await member.get('/mailboxes')).body.items.map((m: any) => m.id);
    expect(mine).toContain(personal.id);
    expect(mine).toContain(shared.id);
    for (const c of [owner, member2]) {
      expect((await c.get('/mailboxes')).body.items.map((m: any) => m.id)).not.toContain(personal.id);
      expect((await c.get(`/mailboxes/${personal.id}`)).status).toBe(404);
      expect((await c.patch(`/mailboxes/${personal.id}`, { displayName: 'X' })).status).toBe(404);
      expect((await c.del(`/mailboxes/${personal.id}`)).status).toBe(404);
      expect((await c.post(`/mailboxes/${personal.id}/check`)).status).toBe(404);
    }
    expect((await member.patch(`/mailboxes/${shared.id}`, { displayName: 'X' })).status).toBe(403);
    expect((await member.patch(`/mailboxes/${personal.id}`, { displayName: 'Иван П.', signature: 'С уважением, Иван' })).body.displayName).toBe('Иван П.');
  });

  test('RLS: ящики и письма другого воркспейса не видны', async () => {
    const other = new Client();
    await other.signup({ workspaceName: 'Чужая почта' });
    expect((await other.get('/mailboxes')).body.items).toEqual([]);
    expect((await other.get(`/mailboxes/${shared.id}`)).status).toBe(404);
    expect((await other.post('/emails', { to: ['a@b.ru'], subject: 'x', body: 'y', mailboxId: shared.id })).status).toBe(404);
    // под app_user в контексте чужого воркспейса таблицы пусты: RLS, а не только фильтр в запросах
    const rows = await withContext(sql, { workspaceId: other.workspaceId! }, db => db.select().from(mailboxes));
    expect(rows.length).toBe(0);
    const mine = await withContext(sql, { workspaceId: ws }, db => db.select().from(mailboxes));
    expect(mine.length).toBeGreaterThan(0);
  });

  test('проверка подключения: статус ok / error записывается в ящик, пароль не раскрывается', async () => {
    const ok = await owner.post(`/mailboxes/${shared.id}/check`);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.mailbox.status).toBe('ok');
    expect(ok.body.mailbox.checkedAt).toBeTruthy();
    await owner.patch(`/mailboxes/${shared.id}`, { password: 'bad' });
    expect((await owner.get(`/mailboxes/${shared.id}`)).body.status).toBe('unchecked'); // смена пароля сбрасывает статус
    const bad = await owner.post(`/mailboxes/${shared.id}/check`);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.mailbox.status).toBe('error');
    expect(bad.body.error).toContain('Invalid login');
    await owner.patch(`/mailboxes/${shared.id}`, { password: 'sekret-pass-1' });
  });

  test('адрес сервера в частной сети отклоняется (SSRF)', async () => {
    const r = await member2.post('/mailboxes', box({ kind: 'personal', email: 'm2@example.com', smtpHost: '127.0.0.1' }));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('mail_host_forbidden');
    expect((await member2.post('/mailboxes', box({ kind: 'personal', email: 'm2@example.com', smtpHost: 'mail.localhost' }))).status).toBe(422);
  });

  test('удаление ящика удаляет и секрет', async () => {
    const r = await member2.post('/mailboxes', box({ kind: 'personal', email: 'm2@example.com' }));
    expect(r.status).toBe(201);
    expect((await member2.del(`/mailboxes/${r.body.id}`)).status).toBe(200);
    const left = await admin`select 1 from workspace_secrets where key = ${`mailbox.${r.body.id}.password`}`;
    expect(left.length).toBe(0);
  });
});

describe('письма: очередь, повторы, касание', () => {
  let member: Client;
  let lead: any;
  let sharedId: string;
  let personalId: string;

  beforeAll(async () => {
    member = await addMember(owner, 'member');
    sharedId = (await mailboxIds())[0]!;
    const p = await member.post('/mailboxes', box({ kind: 'personal', email: 'anna@example.com', displayName: 'Анна', signature: 'Анна, отдел продаж' }));
    personalId = p.body.id;
    lead = (await owner.post('/leads', { name: 'Покупатель', email: 'buyer@client.ru' })).body;
  });

  test('письмо → queued, касание email в ленте лида, затем воркер → sent; Message-ID сохранён и ушёл в заголовок', async () => {
    const r = await owner.post('/emails', { to: ['buyer@client.ru'], cc: ['boss@client.ru'], subject: 'Коммерческое предложение', body: 'Здравствуйте!', leadId: lead.id });
    expect(r.status).toBe(202);
    expect(r.body.status).toBe('queued');
    expect(r.body.messageId).toMatch(/^<[^@]+@example\.com>$/);
    const acts = (await owner.get(`/crm-activities?leadId=${lead.id}`)).body.items;
    const act = acts.find((a: any) => a.emailMessageId === r.body.id);
    expect(act.type).toBe('email');
    expect(act.subject).toBe('Коммерческое предложение');

    await drain();
    expect(sent.length).toBe(1);
    expect(sent[0]!.mail.to).toEqual(['buyer@client.ru']);
    expect(sent[0]!.mail.cc).toEqual(['boss@client.ru']);
    expect(sent[0]!.mail.messageId).toBe(r.body.messageId);
    expect(sent[0]!.mail.from).toEqual({ name: 'Робот', address: 'robot@example.com' });
    expect(sent[0]!.server.password).toBe('sekret-pass-1'); // воркер читает пароль из хранилища
    const done = (await owner.get(`/emails/${r.body.id}`)).body;
    expect(done.status).toBe('sent');
    expect(done.sentAt).toBeTruthy();
    expect((await owner.get(`/emails?leadId=${lead.id}`)).body.items.length).toBeGreaterThanOrEqual(1);
    await drain();
    expect(sent.length).toBe(1); // повторный проход ничего не шлёт
  });

  test('реальный MIME через stream-транспорт nodemailer: Message-ID, вложение, Cc', async () => {
    const prev = emailRuntime.transportFor;
    const raw: string[] = [];
    emailRuntime.transportFor = () => {
      const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
      return {
        sendMail: async m => {
          const info: any = await t.sendMail({ from: m.from, to: m.to, cc: m.cc, subject: m.subject, text: m.text, messageId: m.messageId, attachments: m.attachments.map(a => ({ filename: a.filename, content: Buffer.from(a.content) })) });
          raw.push(info.message.toString());
          return {};
        },
        verify: async () => {},
        close: () => {},
      };
    };
    try {
      setFileStore(new MemoryFileStore());
      const f = new FormData();
      f.set('entityType', 'lead');
      f.set('entityId', lead.id);
      f.set('file', new File(['содержимое файла'], 'price.txt', { type: 'text/plain' }));
      const up = await owner.form('POST', '/attachments', f);
      expect(up.status).toBe(201);
      const r = await owner.post('/emails', { to: ['buyer@client.ru'], subject: 'С файлом', body: 'См. вложение', leadId: lead.id, attachmentIds: [up.body.id ?? up.body.attachment?.id] });
      expect(r.status).toBe(202);
      await drain();
      expect(raw.length).toBe(1);
      expect(raw[0]).toContain(`Message-ID: ${r.body.messageId}`);
      expect(raw[0]).toContain('filename=price.txt');
    } finally {
      emailRuntime.transportFor = prev;
    }
  });

  test('временная ошибка: письмо возвращается в queued, повтор отправляет; попытки считаются', async () => {
    behaviour = n => (n === 1 ? Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }) : null);
    const r = await owner.post('/emails', { to: ['a@client.ru'], subject: 'Повтор', body: 'x' });
    await drain();
    let m = (await owner.get(`/emails/${r.body.id}`)).body;
    expect(m.status).toBe('queued');
    expect(m.lastError).toContain('ETIMEDOUT');
    expect(m.attempts).toBe(1);
    // пауза повтора — в будущем; «проматываем» её
    await admin`update jobs set run_at = now() where workspace_id = ${ws} and type = 'email.send' and status = 'queued'`;
    await drain();
    m = (await owner.get(`/emails/${r.body.id}`)).body;
    expect(m.status).toBe('sent');
    expect(m.attempts).toBe(2);
    expect(m.lastError).toBeNull();
  });

  test('временная ошибка на всех 5 попытках → failed с причиной; «Повторить» ставит снова', async () => {
    behaviour = () => Object.assign(new Error('421 try later'), { responseCode: 421 });
    const r = await owner.post('/emails', { to: ['a@client.ru'], subject: 'Не дойдёт', body: 'x' });
    for (let i = 0; i < 5; i++) {
      await drain();
      await admin`update jobs set run_at = now() where workspace_id = ${ws} and type = 'email.send' and status = 'queued'`;
    }
    await drain();
    const m = (await owner.get(`/emails/${r.body.id}`)).body;
    expect(m.status).toBe('failed');
    expect(m.attempts).toBe(5);
    expect(m.lastError).toContain('421');
    behaviour = () => null;
    expect((await member.post(`/emails/${r.body.id}/retry`)).status).toBe(403); // чужое письмо
    expect((await owner.post(`/emails/${r.body.id}/retry`)).status).toBe(202);
    await drain();
    expect((await owner.get(`/emails/${r.body.id}`)).body.status).toBe('sent');
  });

  test('окончательная ошибка (550) → сразу failed без повторов, неверный пароль помечает ящик', async () => {
    behaviour = () => Object.assign(new Error('550 no such user'), { responseCode: 550 });
    const r = await owner.post('/emails', { to: ['nobody@client.ru'], subject: 'Нет адресата', body: 'x' });
    await drain();
    const m = (await owner.get(`/emails/${r.body.id}`)).body;
    expect(m.status).toBe('failed');
    expect(m.attempts).toBe(1);
    expect(calls).toBe(1);

    behaviour = () => Object.assign(new Error('535 auth failed'), { code: 'EAUTH', responseCode: 535 });
    await owner.post('/emails', { to: ['a@client.ru'], subject: 'Пароль', body: 'x' });
    await drain();
    expect((await owner.get(`/mailboxes/${sharedId}`)).body.status).toBe('error');
    await owner.post(`/mailboxes/${sharedId}/check`); // вернуть ok
  });

  test('выбор ящика: личный автора, иначе общий, явный mailboxId; чужой личный — 404; без ящиков — mailbox_required', async () => {
    const a = await member.post('/emails', { to: ['a@client.ru'], subject: 'Из личного', body: 'x' });
    expect(a.body.mailboxId).toBe(personalId);
    expect(a.body.fromEmail).toBe('anna@example.com');
    const b = await owner.post('/emails', { to: ['a@client.ru'], subject: 'Из общего', body: 'x' });
    expect(b.body.mailboxId).toBe(sharedId);
    const c = await member.post('/emails', { to: ['a@client.ru'], subject: 'Явно общий', body: 'x', mailboxId: sharedId });
    expect(c.body.mailboxId).toBe(sharedId);
    expect((await owner.post('/emails', { to: ['a@client.ru'], subject: 'Чужой', body: 'x', mailboxId: personalId })).status).toBe(404);

    const empty = new Client();
    await empty.signup({ workspaceName: 'Без ящиков' });
    const r = await empty.post('/emails', { to: ['a@client.ru'], subject: 'x', body: 'y' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('mailbox_required');
    await drain();
  });

  test('ящик без пароля, плохие адреса и лимит в сутки', async () => {
    const solo = new Client();
    await solo.signup({ workspaceName: 'Лимит WS' });
    const b = await solo.post('/mailboxes', { ...box(), password: undefined });
    expect(b.body.hasPassword).toBe(false);
    const nopass = await solo.post('/emails', { to: ['a@client.ru'], subject: 'x', body: 'y' });
    expect(nopass.body.error.code).toBe('mailbox_password_missing');
    await solo.patch(`/mailboxes/${b.body.id}`, { password: 'p' });
    expect((await solo.post('/emails', { to: ['не-адрес'], subject: 'x', body: 'y' })).status).toBe(400);
    process.env.EMAIL_DAILY_LIMIT = '1';
    try {
      expect((await solo.post('/emails', { to: ['a@client.ru'], subject: 'один', body: 'y' })).status).toBe(202);
      const second = await solo.post('/emails', { to: ['a@client.ru'], subject: 'два', body: 'y' });
      expect(second.status).toBe(422);
      expect(second.body.error.code).toBe('email_limit_reached');
    } finally {
      delete process.env.EMAIL_DAILY_LIMIT;
    }
  });

  test('документ + печатная форма: воркер прикладывает PDF', async () => {
    const company = (await owner.post('/companies', { name: 'ООО Покупатель', inn: '7707083893' })).body;
    const prod = (await owner.post('/products', { name: 'Услуга', kind: 'service', unitCode: '876', price: 1000 })).body.id;
    const doc = await owner.post('/documents', { type: 'act', counterpartyId: company.id, lines: [{ productId: prod, qty: 1, price: 1000 }] });
    expect(doc.status).toBe(201);
    const original = pdfRuntime.render;
    pdfRuntime.render = async () => Buffer.from([37, 80, 68, 70, 45]);
    try {
      const r = await owner.post('/emails', { to: ['buyer@client.ru'], subject: 'Счёт', body: 'Счёт во вложении', documentId: doc.body.id, printForm: 'act' });
      expect(r.status).toBe(202);
      expect(r.body.companyId).toBe(company.id); // контрагент документа — в историю компании
      await drain();
      const att = sent.at(-1)!.mail.attachments;
      expect(att.length).toBe(1);
      expect(att[0]!.filename.endsWith('-act.pdf')).toBe(true);
      expect(att[0]!.contentType).toBe('application/pdf');
      expect((await owner.get(`/emails?documentId=${doc.body.id}`)).body.items.length).toBe(1);
      expect((await owner.get(`/crm-activities?companyId=${company.id}`)).body.items.some((a: any) => a.type === 'email')).toBe(true);
    } finally {
      pdfRuntime.render = original;
    }
  });
});

describe('автоматизация: узел «Отправить письмо»', () => {
  test('лид создан → письмо с подстановками, подпись ящика, привязка к лиду', async () => {
    const c = new Client();
    await c.signup({ workspaceName: 'Авто-почта WS' });
    const b = await c.post('/mailboxes', box({ signature: 'Команда Робот' }));
    expect(b.status).toBe(201);
    const g = {
      nodes: [
        { id: 't', type: 'trigger.lead_created', position: { x: 0, y: 0 }, params: {} },
        { id: 'e', type: 'action.email_send', position: { x: 200, y: 0 }, params: { mailbox: 'shared', to: '{{trigger.record.email}}', subject: 'Спасибо, {{trigger.record.name}}', text: 'Мы получили вашу заявку.', link: true } },
      ],
      edges: [{ id: 't-e', source: 't', target: 'e', sourceHandle: null }],
    };
    const flow = await c.post('/flows', { name: 'Автоответ', graph: g });
    expect(flow.status).toBe(201);
    expect((await c.post(`/flows/${flow.body.id}/publish`, { enable: true })).status).toBe(200);
    const lead = (await c.post('/leads', { name: 'Пётр', email: 'petr@client.ru' })).body;
    await drain();
    const mails = (await c.get(`/emails?leadId=${lead.id}`)).body.items;
    expect(mails.length).toBe(1);
    expect(mails[0].subject).toBe('Спасибо, Пётр');
    expect(mails[0].status).toBe('sent');
    expect(sent.at(-1)!.mail.to).toEqual(['petr@client.ru']);
    expect(sent.at(-1)!.mail.text).toContain('Мы получили вашу заявку.');
    expect(sent.at(-1)!.mail.text).toContain('Команда Робот');
    expect(sent.at(-1)!.mail.subject).toBe('Спасибо, Пётр');
    // касание в ленте лида
    expect((await c.get(`/crm-activities?leadId=${lead.id}`)).body.items.some((a: any) => a.type === 'email')).toBe(true);
    await admin`update flows set enabled = false where workspace_id = ${c.workspaceId}`;
  });

  test('нет ящика — шаг узла падает с понятной ошибкой, запуск помечается ошибкой', async () => {
    const c = new Client();
    await c.signup({ workspaceName: 'Авто без ящика' });
    const g = {
      nodes: [
        { id: 't', type: 'trigger.lead_created', position: { x: 0, y: 0 }, params: {} },
        { id: 'e', type: 'action.email_send', position: { x: 200, y: 0 }, params: { mailbox: 'owner', to: '{{trigger.record.email}}', subject: 'Тема', text: 'Текст', link: true } },
      ],
      edges: [{ id: 't-e', source: 't', target: 'e', sourceHandle: null }],
    };
    const flow = await c.post('/flows', { name: 'Без ящика', graph: g });
    await c.post(`/flows/${flow.body.id}/publish`, { enable: true });
    await c.post('/leads', { name: 'Анна', email: 'anna@client.ru' });
    await drain();
    const runs = (await c.get(`/flow-runs?flowId=${flow.body.id}`)).body.items;
    expect(runs[0].status).toBe('failed');
    expect(JSON.stringify(runs[0])).toContain('mailbox');
    expect(sent.length).toBe(0);
    await admin`update flows set enabled = false where workspace_id = ${c.workspaceId}`;
  });
});
