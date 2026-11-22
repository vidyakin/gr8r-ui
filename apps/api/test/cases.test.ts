/* Обращения клиентов (docs/architecture/cases.md): создание вручную, из формы сайта и из письма, статусы и SLA, заказ-наряд, права и RLS.
   IMAP подставной, SMTP не запускается (письма остаются в очереди), внешней сети нет. Сценарии автоматизаций идут через processEventsOnce
   (роль app_worker), как в проде; проход SLA — runCaseSlaOnce. */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { emailRuntime, MemoryFileStore, setFileStore, syncMailbox } from '@erp/db';
import { caseDueDates, DEFAULT_CASE_SLA } from '@erp/shared';
import { runCaseSlaOnce } from '../../worker/src/case-sla';
import { defaultOptions, processEventsOnce, processJobsOnce } from '../../worker/src/worker';
import { addMember, admin, Client, ddl, sql } from './helpers';

type Source = { uid: number; source: Uint8Array | null; size: number };
let sources: Source[] = [];
const keyBefore = process.env.SECRETS_KEY;
let seq = 0;
const mime = (o: { from?: string; subject?: string; reply?: string; refs?: string; body?: string } = {}) =>
  Buffer.from(
    [
      `From: Client <${o.from ?? 'client@example.com'}>`,
      'To: Support <support@example.com>',
      `Subject: ${o.subject ?? 'Help'}`,
      `Message-ID: <in-${++seq}@example.com>`,
      'Date: Thu, 19 Nov 2026 10:00:00 +0300',
      ...(o.reply ? [`In-Reply-To: ${o.reply}`] : []),
      ...(o.refs ? [`References: ${o.refs}`] : []),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      o.body ?? 'Please help',
    ].join('\r\n'),
  );
let uid = 0;
const push = (data = mime()) => sources.push({ uid: ++uid, source: data, size: data.length });

beforeAll(() => {
  process.env.SECRETS_KEY = 'e'.repeat(64);
  emailRuntime.imapFor = async () => ({
    uidValidity: '1',
    uidNext: Math.max(0, ...sources.map(s => s.uid)) + 1,
    fetchRange: async (from, to) => sources.filter(s => s.uid >= from && s.uid <= to),
    close: async () => {},
  });
});
afterAll(() => {
  emailRuntime.imapFor = undefined;
  if (keyBefore === undefined) delete process.env.SECRETS_KEY;
  else process.env.SECRETS_KEY = keyBefore;
  setFileStore(null);
});
beforeEach(async () => {
  // проход SLA глобальный: обращения прошлых тестов не должны попадать в счётчик
  await admin`delete from cases`;
  sources = [];
  uid = 0;
  setFileStore(new MemoryFileStore());
});

const opts = () => defaultOptions({ log: () => {}, concurrency: 10, ddl });
async function drain(max = 60) {
  const o = opts();
  for (let i = 0; i < max; i++) if (!((await processEventsOnce(sql, o)) + (await processJobsOnce(sql, o)))) return;
  throw new Error('worker did not settle');
}

async function fixture(withMailbox = false) {
  const owner = new Client();
  await owner.signup({ workspaceName: 'Обращения' });
  const me = (await owner.get('/members')).body.items.find((m: any) => m.email === owner.user!.email).id as string;
  let mailboxId = '';
  if (withMailbox) {
    const r = await owner.post('/mailboxes', {
      kind: 'shared', email: 'support@example.com', smtpHost: 'smtp.example.com', smtpPort: 465, smtpSecure: 'ssl', smtpUser: 'support@example.com',
      imapHost: 'imap.example.com', imapPort: 993, imapSecure: 'ssl', imapUser: 'support@example.com', password: 'app-password', createCasesFromMail: true,
    });
    expect(r.status).toBe(201);
    expect(r.body.createCasesFromMail).toBe(true);
    mailboxId = r.body.id;
  }
  const workspaceId = owner.workspaceId!;
  return { owner, me, workspaceId, mailboxId, sync: () => syncMailbox(sql, workspaceId, mailboxId) };
}
const casesOf = (ws: string) => admin`select * from cases where workspace_id = ${ws} order by created_at, id`;

describe('создание вручную, номера, SLA', () => {
  test('номер ОБ-год-00001 сквозной, сроки по приоритету, ответственный назначается, гость не создаёт', async () => {
    const { owner, me } = await fixture();
    const a = await owner.post('/cases', { subject: 'Не работает принтер', priority: 'urgent' });
    expect(a.status).toBe(201);
    const year = new Date().getUTCFullYear();
    expect(a.body.number).toBe(`ОБ-${year}-00001`);
    expect(a.body.status).toBe('new');
    expect(a.body.channel).toBe('manual');
    expect(a.body.ownerId).toBe(me);
    const due = caseDueDates(new Date(a.body.createdAt), 'urgent', DEFAULT_CASE_SLA);
    expect(new Date(a.body.firstResponseDueAt).getTime()).toBe(due.firstResponseDueAt.getTime());
    expect(new Date(a.body.resolveDueAt).getTime()).toBe(due.resolveDueAt.getTime());
    expect(new Date(a.body.resolveDueAt).getTime() - new Date(a.body.createdAt).getTime()).toBe(8 * 3_600_000);
    const b = await owner.post('/cases', { subject: 'Второй вопрос' });
    expect(b.body.number).toBe(`ОБ-${year}-00002`);
    const guest = await addMember(owner, 'guest');
    expect((await guest.post('/cases', { subject: 'X' })).status).toBe(403);
    expect((await guest.get('/cases')).status).toBe(200);
    expect((await guest.patch(`/cases/${a.body.id}`, { subject: 'Y' })).status).toBe(403);
  });

  test('смена приоритета пересчитывает сроки от создания; закрытое обращение не правится', async () => {
    const { owner } = await fixture();
    const c = (await owner.post('/cases', { subject: 'Приоритет', priority: 'low' })).body;
    const r = await owner.patch(`/cases/${c.id}`, { priority: 'high' });
    expect(r.status).toBe(200);
    expect(new Date(r.body.firstResponseDueAt).getTime() - new Date(c.createdAt).getTime()).toBe(4 * 3_600_000);
    expect(new Date(r.body.resolveDueAt).getTime() - new Date(c.createdAt).getTime()).toBe(24 * 3_600_000);
    const closed = await owner.patch(`/cases/${c.id}`, { status: 'closed' });
    expect(closed.body.closedAt).toBeTruthy();
    expect(closed.body.resolvedAt).toBeTruthy();
    const edit = await owner.patch(`/cases/${c.id}`, { subject: 'Новая тема' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('case_closed');
    expect((await owner.patch(`/cases/${c.id}`, { status: 'in_progress' })).status).toBe(409);
    // комментарий (заметка) допустим, звонок — нет
    expect((await owner.post('/crm-activities', { type: 'note', subject: 'Комментарий', caseId: c.id })).status).toBe(201);
    expect((await owner.post('/crm-activities', { type: 'call', subject: 'Звонок', caseId: c.id })).status).toBe(409);
  });

  test('правила SLA настраиваются (admin) и применяются к новым обращениям', async () => {
    const { owner } = await fixture();
    const rules = (await owner.get('/case-sla-rules')).body;
    expect(rules.normal).toEqual({ firstResponseHours: 8, resolveHours: 72 });
    const put = await owner.put('/case-sla-rules', { ...rules, normal: { firstResponseHours: 2, resolveHours: 10 } });
    expect(put.status).toBe(200);
    const c = (await owner.post('/cases', { subject: 'По новому правилу' })).body;
    expect(new Date(c.firstResponseDueAt).getTime() - new Date(c.createdAt).getTime()).toBe(2 * 3_600_000);
    const member = await addMember(owner, 'member');
    expect((await member.put('/case-sla-rules', rules)).status).toBe(403);
  });
});

describe('ответ, статусы, переоткрытие', () => {
  test('ответ письмом: номер в теме, первый ответ ставит срок и переводит в in_progress; касание-ответ тоже считается', async () => {
    const f = await fixture(true);
    const c = (await f.owner.post('/cases', { subject: 'Сломался принтер', mailboxId: f.mailboxId })).body;
    const r = await f.owner.post(`/cases/${c.id}/reply`, { to: ['client@example.com'], body: 'Уже разбираемся' });
    expect(r.status).toBe(202);
    expect(r.body.subject).toBe(`Re: Сломался принтер [${c.number}]`);
    expect(r.body.caseId).toBe(c.id);
    const after = (await f.owner.get(`/cases/${c.id}`)).body;
    expect(after.status).toBe('in_progress');
    expect(after.firstRespondedAt).toBeTruthy();
    expect(after.emails).toHaveLength(1);
    expect(after.activities.some((a: any) => a.type === 'email')).toBe(true);
    const first = after.firstRespondedAt;
    await f.owner.post(`/cases/${c.id}/reply`, { to: ['client@example.com'], body: 'Ещё одно письмо' });
    expect((await f.owner.get(`/cases/${c.id}`)).body.firstRespondedAt).toBe(first);

    const c2 = (await f.owner.post('/cases', { subject: 'По телефону' })).body;
    expect((await f.owner.post('/crm-activities', { type: 'call', subject: 'Перезвонили', caseId: c2.id })).status).toBe(201);
    expect((await f.owner.get(`/cases/${c2.id}`)).body.firstRespondedAt).toBeNull();
    expect((await f.owner.post('/crm-activities', { type: 'call', subject: 'Ответили клиенту', caseId: c2.id, response: true })).status).toBe(201);
    const got = (await f.owner.get(`/cases/${c2.id}`)).body;
    expect(got.firstRespondedAt).toBeTruthy();
    expect(got.status).toBe('in_progress');
  });

  test('ответ клиента: waiting → in_progress, решённое в течение 7 дней открывается, позже и закрытое — новое обращение', async () => {
    const f = await fixture(true);
    const subject = (n: string, s = 'Вопрос') => mime({ subject: `Re: ${s} [${n}]`, body: 'Ответ клиента' });
    push(mime({ subject: 'Вопрос' }));
    expect(await f.sync()).toBe(1);
    const [c0] = await casesOf(f.workspaceId);
    expect(c0!.channel).toBe('email');
    expect(c0!.status).toBe('new');
    // waiting → in_progress по номеру в теме
    await f.owner.patch(`/cases/${c0!.id}`, { status: 'waiting' });
    push(subject(c0!.number));
    expect(await f.sync()).toBe(1);
    expect(await casesOf(f.workspaceId)).toHaveLength(1);
    expect((await f.owner.get(`/cases/${c0!.id}`)).body.status).toBe('in_progress');
    // решённое открывается в пределах 7 дней
    const solved = await f.owner.patch(`/cases/${c0!.id}`, { status: 'resolved' });
    expect(solved.body.resolvedAt).toBeTruthy();
    push(subject(c0!.number));
    await f.sync();
    const reopened = (await f.owner.get(`/cases/${c0!.id}`)).body;
    expect(reopened.status).toBe('in_progress');
    expect(reopened.resolvedAt).toBeNull();
    expect(await casesOf(f.workspaceId)).toHaveLength(1);
    // решено 8 дней назад: ответ создаёт новое обращение, старое не меняется
    await f.owner.patch(`/cases/${c0!.id}`, { status: 'resolved' });
    await admin`update cases set resolved_at = now() - interval '8 days' where id = ${c0!.id}`;
    push(subject(c0!.number));
    await f.sync();
    let all = await casesOf(f.workspaceId);
    expect(all).toHaveLength(2);
    expect(all[0]!.status).toBe('resolved');
    expect(all[1]!.status).toBe('new');
    expect(all[1]!.number).not.toBe(c0!.number);
    // закрытое — тоже новое
    await f.owner.patch(`/cases/${c0!.id}`, { status: 'closed' });
    push(subject(c0!.number));
    await f.sync();
    all = await casesOf(f.workspaceId);
    expect(all).toHaveLength(3);
    expect(all[0]!.status).toBe('closed');
  });
});

describe('приём из почты', () => {
  test('новое письмо создаёт обращение с клиентом, повторная синхронизация не дублирует; ответ по заголовкам привязывается', async () => {
    const f = await fixture(true);
    const company = (await f.owner.post('/companies', { name: 'ООО Клиент' })).body;
    const contact = (await f.owner.post('/contacts', { name: 'Иван', email: 'CLIENT@example.com', companyId: company.id })).body;
    push(mime({ subject: 'Не работает принтер', body: 'Принтер не печатает' }));
    expect(await f.sync()).toBe(1);
    expect(await f.sync()).toBe(0);
    let all = await casesOf(f.workspaceId);
    expect(all).toHaveLength(1);
    const c = all[0]!;
    expect(c).toMatchObject({ channel: 'email', subject: 'Не работает принтер', contact_id: contact.id, company_id: company.id, mailbox_id: f.mailboxId, owner_id: f.me });
    expect(c.description).toContain('Принтер не печатает');
    const mails = await admin`select * from email_messages where workspace_id = ${f.workspaceId} and case_id = ${c.id}`;
    expect(mails).toHaveLength(1);
    const acts = await admin`select * from crm_activities where workspace_id = ${f.workspaceId} and case_id = ${c.id}`;
    expect(acts).toHaveLength(1);

    // ответ сотрудника, затем ответ клиента по In-Reply-To (тема без номера)
    const reply = (await f.owner.post(`/cases/${c.id}/reply`, { to: ['client@example.com'], body: 'Уже смотрим' })).body;
    await admin`update email_messages set status = 'sent' where id = ${reply.id}`;
    await f.owner.patch(`/cases/${c.id}`, { status: 'waiting' });
    push(mime({ subject: 'Спасибо', reply: reply.messageId, refs: reply.messageId }));
    expect(await f.sync()).toBe(1);
    all = await casesOf(f.workspaceId);
    expect(all).toHaveLength(1);
    const detail = (await f.owner.get(`/cases/${c.id}`)).body;
    expect(detail.status).toBe('in_progress');
    expect(detail.emails).toHaveLength(3);
    // тот же ящик без флажка обращений письма не превращает
    await f.owner.patch(`/mailboxes/${f.mailboxId}`, { createCasesFromMail: false });
    push(mime({ subject: 'Просто письмо', from: 'other@example.com' }));
    expect(await f.sync()).toBe(1);
    expect(await casesOf(f.workspaceId)).toHaveLength(1);
  });

  test('ответственный по умолчанию ящика важнее круга; письма с собственного адреса обращений не создают', async () => {
    const f = await fixture(true);
    const agent = await addMember(f.owner, 'member');
    const agentId = (await f.owner.get('/members')).body.items.find((m: any) => m.email === agent.user!.email).id;
    expect((await f.owner.patch(`/mailboxes/${f.mailboxId}`, { caseOwnerId: agentId })).status).toBe(200);
    push(mime({ subject: 'Вопрос' }));
    push(mime({ subject: 'Эхо', from: 'support@example.com' }));
    expect(await f.sync()).toBe(2);
    const all = await casesOf(f.workspaceId);
    expect(all).toHaveLength(1);
    expect(all[0]!.owner_id).toBe(agentId);
  });

  test('по кругу среди должности с функцией support_agent', async () => {
    const f = await fixture();
    const a = await addMember(f.owner, 'member');
    const members = (await f.owner.get('/members')).body.items;
    const aId = members.find((m: any) => m.email === a.user!.email).id;
    const pos = await f.owner.post('/positions', { name: 'Поддержка', functions: ['support_agent'], sections: [] });
    expect(pos.status).toBe(201);
    expect((await f.owner.put(`/positions/by-member/${aId}`, { positionIds: [pos.body.id] })).status).toBe(200);
    const owners = [];
    for (let i = 0; i < 3; i++) owners.push((await f.owner.post('/cases', { subject: `Обращение ${i}` })).body.ownerId);
    expect(new Set(owners)).toEqual(new Set([aId]));
  });
});

describe('форма сайта', () => {
  test('вебхук создаёт обращение: известный клиент по адресу, неизвестный — лид; чужой и выключенный токен — 404', async () => {
    const f = await fixture();
    const contact = (await f.owner.post('/contacts', { name: 'Известный', email: 'known@example.com' })).body;
    const form = (await f.owner.post('/case-forms', { name: 'Сайт', defaultOwnerId: f.me })).body;
    expect(form.webhookToken).toContain(f.workspaceId);
    const hook = (b: Record<string, unknown>, token = form.webhookToken) => new Client().post(`/hooks/cases/${token}`, b, null);
    const ok = await hook({ name: 'Известный', email: 'known@example.com', subject: 'Нет доступа', message: 'Не могу войти', priority: 'high' });
    expect(ok.status).toBe(201);
    const unknown = await hook({ name: 'Новый', email: 'new@example.com', phone: '+7 900 111-22-33', message: 'Вопрос по счёту' });
    expect(unknown.status).toBe(201);
    const [a, b] = await casesOf(f.workspaceId);
    expect(a).toMatchObject({ channel: 'web_form', subject: 'Нет доступа', priority: 'high', contact_id: contact.id, owner_id: f.me, form_id: form.id });
    expect(a!.lead_id).toBeNull();
    expect(b!.subject).toBe('Вопрос по счёту');
    expect(b!.lead_id).toBeTruthy();
    expect((await admin`select * from leads where workspace_id = ${f.workspaceId}`)).toHaveLength(1);
    // отклонённые запросы
    expect((await hook({ name: 'X' })).status).toBe(422);
    expect((await hook({ message: 'x', name: 'X' }, `${f.workspaceId}.${'a'.repeat(32)}`)).status).toBe(404);
    expect((await hook({ message: 'x', name: 'X' }, 'garbage')).status).toBe(404);
    await f.owner.patch(`/case-forms/${form.id}`, { enabled: false });
    expect((await hook({ message: 'x', name: 'X' })).status).toBe(404);
    // обычный участник токена не видит
    const member = await addMember(f.owner, 'member');
    expect((await member.get('/case-forms')).body.items[0].webhookToken).toBe('');
    // смена секрета отключает старый адрес
    await f.owner.patch(`/case-forms/${form.id}`, { enabled: true });
    const rotated = (await f.owner.post(`/case-forms/${form.id}/rotate`)).body;
    expect(rotated.webhookToken).not.toBe(form.webhookToken);
    expect((await hook({ message: 'x', name: 'X' })).status).toBe(404);
    expect((await hook({ message: 'x', name: 'X' }, rotated.webhookToken)).status).toBe(201);
    // поле-ловушка: заполнена — успех без обращения
    await f.owner.patch(`/case-forms/${form.id}`, { honeypotField: 'fax' });
    const before = (await casesOf(f.workspaceId)).length;
    expect((await hook({ message: 'спам', name: 'Бот', fax: '1' }, rotated.webhookToken)).status).toBe(201);
    expect((await hook({ fax: '1' }, rotated.webhookToken)).status).toBe(201);
    expect(await casesOf(f.workspaceId)).toHaveLength(before);
  });
});

describe('SLA и автоматизации', () => {
  test('просрочка фиксируется один раз на срок: событие, отметка, уведомление; счётчики и фильтр', async () => {
    const f = await fixture();
    const c = (await f.owner.post('/cases', { subject: 'Срочное', priority: 'normal' })).body;
    const created = new Date(c.createdAt).getTime();
    expect(await runCaseSlaOnce(sql, new Date(created + 7 * 3_600_000))).toBe(0);
    expect((await f.owner.get('/cases?overdue=true')).body.items).toHaveLength(0);
    // через 9 часов срок первого ответа нарушен
    expect(await runCaseSlaOnce(sql, new Date(created + 9 * 3_600_000))).toBe(1);
    expect(await runCaseSlaOnce(sql, new Date(created + 10 * 3_600_000))).toBe(0);
    let events = await admin`select * from events where workspace_id = ${f.workspaceId} and type = 'case.sla_breached' and record_id = ${c.id}`;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.kind).toBe('first_response');
    const [row] = await admin`select * from cases where id = ${c.id}`;
    expect(row!.first_response_breached_at).toBeTruthy();
    expect(row!.resolve_breached_at).toBeNull();
    const notes = await admin`select * from notifications where workspace_id = ${f.workspaceId} and recipient_id = ${f.me} and text like '%First response%'`;
    expect(notes).toHaveLength(1);
    // срок решения — отдельное событие, один раз
    expect(await runCaseSlaOnce(sql, new Date(created + 80 * 3_600_000))).toBe(1);
    expect(await runCaseSlaOnce(sql, new Date(created + 90 * 3_600_000))).toBe(0);
    events = await admin`select * from events where workspace_id = ${f.workspaceId} and type = 'case.sla_breached' and record_id = ${c.id} order by id`;
    expect(events.map((e: any) => e.payload.kind)).toEqual(['first_response', 'resolve']);
    // ответ закрывает срок первого ответа: новое обращение с ответом не нарушается
    const d = (await f.owner.post('/cases', { subject: 'С ответом' })).body;
    await f.owner.post('/crm-activities', { type: 'call', subject: 'Позвонили', caseId: d.id, response: true });
    expect(await runCaseSlaOnce(sql, new Date(new Date(d.createdAt).getTime() + 9 * 3_600_000))).toBe(0);
    // решённое обращение не нарушается; счётчики
    const e = (await f.owner.post('/cases', { subject: 'Решённое' })).body;
    await f.owner.patch(`/cases/${e.id}`, { status: 'resolved' });
    expect(await runCaseSlaOnce(sql, new Date(new Date(e.createdAt).getTime() + 9 * 3_600_000))).toBe(0);
    await admin`update cases set first_response_due_at = now() - interval '1 hour' where id = ${c.id}`;
    const summary = (await f.owner.get('/cases/summary')).body;
    expect((await f.owner.get('/cases?overdue=true')).body.items.map((x: any) => x.id)).toEqual([c.id]);
    expect(summary.open).toBe(2);
    expect(summary.new).toBe(1);
    expect(summary.overdue).toBe(1);
  });

  test('смена приоритета после нарушения: новый срок в будущем разрешает объявить нарушение снова', async () => {
    const f = await fixture();
    const c = (await f.owner.post('/cases', { subject: 'Пересчёт', priority: 'urgent' })).body;
    const created = new Date(c.createdAt).getTime();
    expect(await runCaseSlaOnce(sql, new Date(created + 2 * 3_600_000))).toBe(1);
    // low: первый ответ через 24 часа — срок в будущем, отметка сбрасывается
    await f.owner.patch(`/cases/${c.id}`, { priority: 'low' });
    const [row] = await admin`select * from cases where id = ${c.id}`;
    expect(row!.first_response_breached_at).toBeNull();
    expect(await runCaseSlaOnce(sql, new Date(created + 25 * 3_600_000))).toBe(1);
  });

  test('автоматизации: триггеры «создано», «статус изменён», «срок нарушен» и «Изменить поле» для сущности case — под app_worker', async () => {
    const f = await fixture();
    const make = async (name: string, trigger: [string, Record<string, unknown>], action: Record<string, unknown>) => {
      const g = {
        nodes: [
          { id: 't', type: trigger[0], position: { x: 0, y: 0 }, params: trigger[1] },
          { id: 'u', type: 'action.update_field', position: { x: 220, y: 0 }, params: { entity: 'case', recordId: '{{trigger.recordId}}', ...action } },
        ],
        edges: [{ id: 'e', source: 't', target: 'u', sourceHandle: null }],
      };
      const created = await f.owner.post('/flows', { name, graph: g });
      expect(created.status).toBe(201);
      const pub = await f.owner.post(`/flows/${created.body.id}/publish`, { enable: true });
      expect(pub.status).toBe(200);
      return created.body.id as string;
    };
    await make('created', ['trigger.case_created', {}], { field: 'priority', value: 'high' });
    const waitingFlow = await make('status', ['trigger.case_status_changed', { status: 'waiting' }], { field: 'description', value: 'ждём клиента' });
    const slaFlow = await make('sla', ['trigger.case_sla_breached', { kind: 'first_response' }], { field: 'subject', value: 'ПРОСРОЧЕНО {{trigger.record.subject}}' });
    const c = (await f.owner.post('/cases', { subject: 'Автоматика', priority: 'low' })).body;
    await drain();
    expect((await f.owner.get(`/cases/${c.id}`)).body.priority).toBe('high');
    await f.owner.patch(`/cases/${c.id}`, { status: 'in_progress' });
    await drain();
    expect((await f.owner.get(`/cases/${c.id}`)).body.description).toBe('');
    await f.owner.patch(`/cases/${c.id}`, { status: 'waiting' });
    await drain();
    expect((await f.owner.get(`/cases/${c.id}`)).body.description).toBe('ждём клиента');
    const runs = (await f.owner.get(`/flow-runs?flowId=${waitingFlow}&limit=50`)).body.items;
    expect(runs.filter((r: any) => r.status === 'succeeded')).toHaveLength(1);
    // срок нарушен (первый ответ) — запускает сценарий один раз
    const created = new Date((await f.owner.get(`/cases/${c.id}`)).body.createdAt).getTime();
    await runCaseSlaOnce(sql, new Date(created + 30 * 3_600_000));
    await drain();
    expect((await f.owner.get(`/cases/${c.id}`)).body.subject).toBe('ПРОСРОЧЕНО Автоматика');
    const slaRuns = (await f.owner.get(`/flow-runs?flowId=${slaFlow}&limit=50`)).body.items;
    expect(slaRuns.filter((r: any) => r.status === 'succeeded')).toHaveLength(1);
  });
});

describe('заказ-наряд, права и изоляция', () => {
  test('заказ-наряд из обращения: контрагент и описание, связь в обе стороны, повторно нельзя', async () => {
    const f = await fixture();
    const company = (await f.owner.post('/companies', { name: 'ООО Заказчик' })).body;
    const noCompany = (await f.owner.post('/cases', { subject: 'Без клиента' })).body;
    expect((await f.owner.post(`/cases/${noCompany.id}/work-order`)).body.error.code).toBe('case_company_required');
    const c = (await f.owner.post('/cases', { subject: 'Выезд на объект', description: 'Течёт кран', companyId: company.id })).body;
    const r = await f.owner.post(`/cases/${c.id}/work-order`);
    expect(r.status).toBe(201);
    const documentId = r.body.documentId as string;
    const [doc] = await admin`select * from documents where id = ${documentId}`;
    expect(doc).toMatchObject({ type: 'work_order', counterparty_id: company.id, case_id: c.id });
    expect(doc!.comment).toContain(c.number);
    expect(doc!.comment).toContain('Течёт кран');
    expect((await f.owner.get(`/cases/${c.id}`)).body.workOrderId).toBe(documentId);
    const again = await f.owner.post(`/cases/${c.id}/work-order`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('case_work_order_exists');
  });

  test('RLS: чужой воркспейс не видит обращения; в списке фильтры и поиск работают', async () => {
    const a = await fixture();
    const b = await fixture();
    const secret = (await a.owner.post('/cases', { subject: 'Секретное обращение' })).body;
    await a.owner.post('/cases', { subject: 'Другое', priority: 'high' });
    expect((await b.owner.get(`/cases/${secret.id}`)).status).toBe(404);
    expect((await b.owner.get('/cases')).body.items).toHaveLength(0);
    expect((await b.owner.patch(`/cases/${secret.id}`, { subject: 'взлом' })).status).toBe(404);
    expect((await a.owner.get('/cases?q=Секретное')).body.items).toHaveLength(1);
    expect((await a.owner.get('/cases?priority=high')).body.items).toHaveLength(1);
    expect((await a.owner.get('/cases?status=new&open=true')).body.total).toBe(2);
    expect((await a.owner.get(`/cases?ownerId=${a.me}`)).body.total).toBe(2);
    expect((await a.owner.get('/cases?channel=email')).body.total).toBe(0);
  });

  test('обращения клиента видны по контрагенту и контакту; раздел crm закрывает пути для скрытого раздела', async () => {
    const f = await fixture();
    const company = (await f.owner.post('/companies', { name: 'Клиент' })).body;
    const contact = (await f.owner.post('/contacts', { name: 'Контакт', companyId: company.id })).body;
    await f.owner.post('/cases', { subject: 'От контакта', contactId: contact.id });
    // компания подставляется из контакта
    expect((await f.owner.get(`/cases?companyId=${company.id}`)).body.total).toBe(1);
    expect((await f.owner.get(`/cases?contactId=${contact.id}`)).body.total).toBe(1);
  });
});
