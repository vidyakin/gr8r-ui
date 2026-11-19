/* Входящая почта: маршруты постановки/привязки и идемпотентное расписание, без соединений с IMAP. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { emailRuntime, type MailServer } from '@erp/db';
import { scheduleEmailSyncs } from '../../worker/src/email-sync';
import { addMember, admin, Client, sql } from './helpers';

const mailboxInput = (kind: 'shared' | 'personal' = 'shared') => ({
  kind, email: 'inbox@example.com', smtpHost: 'smtp.example.com', smtpPort: 465,
  smtpSecure: 'ssl', smtpUser: 'inbox@example.com', password: 'test-password',
  imapHost: 'imap.example.com', imapPort: 993, imapSecure: 'ssl', imapUser: 'inbox@example.com',
});

let owner: Client;
let member: Client;
let guest: Client;
let sharedId: string;
let personalId: string;
const previousKey = process.env.SECRETS_KEY;
beforeAll(async () => {
  process.env.SECRETS_KEY = 'e'.repeat(64);
  owner = new Client();
  await owner.signup({ workspaceName: 'Входящая почта API' });
  member = await addMember(owner, 'member');
  guest = await addMember(owner, 'guest');
  const shared = await owner.post('/mailboxes', mailboxInput());
  const personal = await member.post('/mailboxes', mailboxInput('personal'));
  expect(shared.status).toBe(201);
  expect(personal.status).toBe(201);
  sharedId = shared.body.id;
  personalId = personal.body.id;
});
afterAll(() => {
  if (previousKey === undefined) delete process.env.SECRETS_KEY;
  else process.env.SECRETS_KEY = previousKey;
});

async function syncJobs(id: string) {
  return admin`select id, status from jobs where workspace_id = ${owner.workspaceId} and type = 'email.sync' and payload->>'mailboxId' = ${id}`;
}

describe('email.sync API и расписание', () => {
  test('проверка IMAP передаёт логин и пароль, закрывает сессию; ошибка входа маскирует секрет', async () => {
    const previous = { smtp: emailRuntime.transportFor, imap: emailRuntime.imapFor, probe: emailRuntime.imapProbe };
    const received: MailServer[] = [];
    let closed = 0;
    try {
      emailRuntime.imapProbe = undefined;
      emailRuntime.transportFor = () => ({ sendMail: async () => ({}), verify: async () => {}, close: () => {} });
      emailRuntime.imapFor = async server => {
        received.push(server);
        return { uidValidity: '1', uidNext: 1, fetchRange: async () => [], close: async () => { closed++; } };
      };
      const ok = await owner.post(`/mailboxes/${sharedId}/check`);
      expect(ok.status).toBe(200);
      expect(ok.body.ok).toBe(true);
      expect(received[0]!.user).toBe('inbox@example.com');
      expect(received[0]!.password).toBe('test-password');
      expect(closed).toBe(1);
      emailRuntime.imapFor = async () => { throw new Error('Login failed test-password'); };
      const bad = await owner.post(`/mailboxes/${sharedId}/check`);
      expect(bad.status).toBe(200);
      expect(bad.body.ok).toBe(false);
      expect(bad.body.mailbox.status).toBe('error');
      expect(JSON.stringify(bad.body)).not.toContain('test-password');
    } finally {
      emailRuntime.transportFor = previous.smtp;
      emailRuntime.imapFor = previous.imap;
      emailRuntime.imapProbe = previous.probe;
    }
  });
  test('ручная проверка общего ящика доступна member, гостю запрещена, повтор не дублирует задачу', async () => {
    expect((await guest.post(`/mailboxes/${sharedId}/sync`)).status).toBe(403);
    expect((await member.post(`/mailboxes/${sharedId}/sync`)).status).toBe(202);
    expect((await owner.post(`/mailboxes/${sharedId}/sync`)).status).toBe(202);
    expect(await syncJobs(sharedId)).toHaveLength(1);
  });

  test('личный ящик проверяет только владелец, чужой воркспейс не получает доступ', async () => {
    expect((await owner.post(`/mailboxes/${personalId}/sync`)).status).toBe(404);
    expect((await member.post(`/mailboxes/${personalId}/sync`)).status).toBe(202);
    const other = new Client();
    await other.signup({ workspaceName: 'Чужая входящая почта' });
    expect((await other.post(`/mailboxes/${sharedId}/sync`)).status).toBe(404);
    expect(await syncJobs(personalId)).toHaveLength(1);
  });

  test('расписание пропускает занятый ящик и три минуты после завершения; конкурентные проходы ставят одну задачу', async () => {
    await scheduleEmailSyncs(sql);
    expect(await syncJobs(sharedId)).toHaveLength(1);
    await admin`update jobs set status = 'done' where workspace_id = ${owner.workspaceId} and type = 'email.sync'`;
    await scheduleEmailSyncs(sql);
    expect(await syncJobs(sharedId)).toHaveLength(1);
    await admin`update jobs set created_at = now() - interval '4 minutes' where workspace_id = ${owner.workspaceId} and type = 'email.sync'`;
    await Promise.all([scheduleEmailSyncs(sql), scheduleEmailSyncs(sql)]);
    expect(await syncJobs(sharedId)).toHaveLength(2);
    expect(await syncJobs(personalId)).toHaveLength(2);
  });
});

describe('привязка входящего письма', () => {
  let emailId: string;
  let leadId: string;
  beforeAll(async () => {
    leadId = (await owner.post('/leads', { name: 'Входящий клиент', email: 'sender@example.com' })).body.id;
    const [mail] = await admin`insert into email_messages (workspace_id, mailbox_id, direction, status, from_email, subject, body_text)
      values (${owner.workspaceId}, ${sharedId}, 'in', 'received', 'sender@example.com', 'Новый запрос', 'Текст') returning id`;
    emailId = mail!.id;
  });

  test('строго одна цель, роль member+, после привязки письмо видно в истории и исчезает из непривязанных', async () => {
    expect((await owner.post(`/emails/${emailId}/link`, {})).status).toBe(400);
    expect((await owner.post(`/emails/${emailId}/link`, { leadId, contactId: leadId })).status).toBe(400);
    expect((await guest.post(`/emails/${emailId}/link`, { leadId })).status).toBe(403);
    const before = await member.get('/emails?direction=in&unlinked=true');
    expect(before.body.items.some((m: { id: string }) => m.id === emailId)).toBe(true);
    const linked = await member.post(`/emails/${emailId}/link`, { leadId });
    expect(linked.status).toBe(200);
    expect(linked.body.leadId).toBe(leadId);
    const after = await member.get('/emails?direction=in&unlinked=true');
    expect(after.body.items.some((m: { id: string }) => m.id === emailId)).toBe(false);
    const activities = await owner.get(`/crm-activities?leadId=${leadId}`);
    expect(activities.body.items.some((a: { emailMessageId: string }) => a.emailMessageId === emailId)).toBe(true);
  });

  test('чужая цель и личное письмо недоступны при привязке', async () => {
    const other = new Client();
    await other.signup({ workspaceName: 'Чужая цель письма' });
    const alien = await other.post('/leads', { name: 'Чужой лид' });
    expect((await owner.post(`/emails/${emailId}/link`, { leadId: alien.body.id })).status).toBe(404);
    const [privateMail] = await admin`insert into email_messages (workspace_id, mailbox_id, direction, status, from_email)
      values (${owner.workspaceId}, ${personalId}, 'in', 'received', 'sender@example.com') returning id`;
    expect((await owner.post(`/emails/${privateMail!.id}/link`, { leadId })).status).toBe(404);
    expect((await other.post(`/emails/${emailId}/link`, { leadId: alien.body.id })).status).toBe(404);
  });
});
