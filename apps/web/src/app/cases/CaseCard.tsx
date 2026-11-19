/* Карточка обращения (docs/architecture/cases.md): шапка (номер, статус, приоритет, сроки SLA с обратным отсчётом), поля, лента писем и касаний,
   ответ письмом, «Создать заказ-наряд», связанные сделка и заказ-наряд. Новое обращение создаётся здесь же. */
import * as React from 'react';
import { Link } from 'react-router';
import { ClipboardList, Mail, Send } from 'lucide-react';
import { CASE_PRIORITIES, CASE_STATUSES, type CasePriority, type CaseStatus } from '@erp/shared';
import { Alert, Button, Checkbox, Choice, Dialog, DialogContent, Field, Input, Select, Textarea, toast } from '@/components/ui';
import { fmtDateTime } from '@/i18n/format';
import { useT } from '@/i18n';
import { EmailStatus } from '../email/EmailStatus';
import { useMailboxes } from '../email/data';
import { useCrm } from '../crm/store';
import { useWorkspace } from '../data/store';
import { useCustomRows } from '../meta/custom-fields';
import { useMembersWith } from '../positions/data';
import { CasePriorityBadge, CaseStatusBadge } from './badges';
import { useCase, useCasesApi, type CaseDetail } from './data';
import { SlaBadge } from './sla';

const NONE = '__none';

interface Draft {
  subject: string;
  description: string;
  status: CaseStatus;
  priority: CasePriority;
  ownerId: string;
  companyId: string;
  contactId: string;
}
const blank: Draft = { subject: '', description: '', status: 'new', priority: 'normal', ownerId: '', companyId: '', contactId: '' };
const fromCase = (c: CaseDetail): Draft => ({ subject: c.subject, description: c.description, status: c.status, priority: c.priority, ownerId: c.ownerId ?? '', companyId: c.companyId ?? '', contactId: c.contactId ?? '' });

function Feed({ c }: { c: CaseDetail }) {
  const t = useT();
  const { data: ws } = useWorkspace();
  const api = useCasesApi();
  const [type, setType] = React.useState<'note' | 'call' | 'email' | 'meeting'>('note');
  const [text, setText] = React.useState('');
  const [response, setResponse] = React.useState(false);
  const closed = c.status === 'closed';
  const emails = new Map(c.emails.map(e => [e.id, e]));
  const add = async () => {
    const subject = text.trim();
    if (!subject) return;
    const r = await api('POST', '/crm-activities', { type, subject: subject.slice(0, 200), body: subject.length > 200 ? subject : null, caseId: c.id, ...(response && (type === 'call' || type === 'email') ? { response: true } : {}) });
    if (r) {
      setText('');
      setResponse(false);
    }
  };
  const types = closed ? (['note'] as const) : (['note', 'call', 'email', 'meeting'] as const);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>{t('cases.feed.title')}</h3>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div style={{ width: 140, flexShrink: 0 }}>
          <Select size="sm" value={closed ? 'note' : type} onValueChange={v => setType(v as typeof type)} aria-label={t('cases.feed.title')} options={types.map(x => ({ value: x, label: t(`cases.feed.type.${x}`) }))} />
        </div>
        <Textarea rows={2} value={text} placeholder={t('cases.feed.placeholder')} onChange={e => setText(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <Button size="sm" disabled={!text.trim()} onClick={() => void add()}>{t('cases.feed.add')}</Button>
      </div>
      {!closed && (type === 'call' || type === 'email') && <Choice><Checkbox checked={response} onChange={e => setResponse(e.target.checked)} />{t('cases.feed.isResponse')}</Choice>}
      {c.activities.length === 0 ? (
        <p className="faint" style={{ fontSize: 13 }}>{t('cases.feed.empty')}</p>
      ) : (
        <ul className="stack" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
          {c.activities.map(a => {
            const mail = a.emailMessageId ? emails.get(a.emailMessageId) : undefined;
            return (
              <li key={a.id} style={{ fontSize: 13 }}>
                <span className="faint">
                  {fmtDateTime(a.createdAt)} · {a.system ? t('cases.feed.system') : ws.members.find(m => m.id === a.authorId)?.name ?? (mail?.direction === 'in' ? mail.fromEmail : '')} · {mail ? t(mail.direction === 'in' ? 'cases.feed.emailIn' : 'cases.feed.emailOut') : t(`cases.feed.type.${a.type === 'task' ? 'note' : a.type}`)}
                </span>
                <div>{a.subject}</div>
                {mail && <EmailStatus email={mail} />}
                {a.body && a.body !== a.subject && <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Reply({ c, defaultTo }: { c: CaseDetail; defaultTo: string }) {
  const t = useT();
  const api = useCasesApi();
  const boxes = useMailboxes();
  const [open, setOpen] = React.useState(false);
  const [to, setTo] = React.useState(defaultTo);
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setTo(defaultTo), [defaultTo]);
  if (c.status === 'closed') return null;
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Mail size={13} />
        {t('cases.reply.open')}
      </Button>
    );
  const noBox = boxes.data && boxes.data.length === 0;
  const send = async () => {
    const addrs = to.split(/[,;\s]+/).filter(Boolean);
    if (!addrs.length) return void toast.error(t('cases.reply.toRequired'));
    setBusy(true);
    const r = await api('POST', `/cases/${c.id}/reply`, { to: addrs, body });
    setBusy(false);
    if (r) {
      toast.success(t('cases.reply.sent'));
      setBody('');
      setOpen(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>{t('cases.reply.title')}</h3>
      {noBox && <Alert tone="warn">{t('cases.reply.noMailbox')}</Alert>}
      <Field label={t('cases.reply.to')}>{p => <Input {...p} value={to} onChange={e => setTo(e.target.value)} />}</Field>
      <Field label={t('cases.reply.body')}>{p => <Textarea {...p} rows={5} value={body} onChange={e => setBody(e.target.value)} />}</Field>
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" variant="primary" disabled={busy || !!noBox} onClick={() => void send()}>
          <Send size={13} />
          {t('cases.reply.send')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('cases.settings.cancel')}</Button>
      </div>
    </div>
  );
}

export function CaseCard({ caseId, onClose, defaults }: { caseId: string | null; onClose: () => void; defaults?: { companyId?: string; contactId?: string } }) {
  const t = useT();
  const { data: ws } = useWorkspace();
  const { data: crm } = useCrm();
  const api = useCasesApi();
  const one = useCase(caseId);
  const c = one.data;
  const [draft, setDraft] = React.useState<Draft>({ ...blank, companyId: defaults?.companyId ?? '', contactId: defaults?.contactId ?? '' });
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  const [err, setErr] = React.useState('');
  // форма заполняется один раз при загрузке; дальше правки идут из неё, а не из кэша (realtime не затирает ввод)
  React.useEffect(() => {
    if (caseId && c && loadedFor !== c.id) {
      setDraft(fromCase(c));
      setLoadedFor(c.id);
    }
  }, [caseId, c, loadedFor]);
  const members = ws.members.filter(m => m.status === 'active');
  const owners = useMembersWith(members, 'support_agent', [draft.ownerId]);
  const closed = c?.status === 'closed';
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const contacts = crm.contacts.filter(x => !draft.companyId || x.company === draft.companyId);
  const customRows = useCustomRows('case', c?.custom, patch => void api('PATCH', `/cases/${caseId}`, { custom: patch }));

  const save = async () => {
    if (!draft.subject.trim()) return setErr(t('cases.card.subjectRequired'));
    setErr('');
    const body = { subject: draft.subject.trim(), description: draft.description, priority: draft.priority, ownerId: draft.ownerId || null, companyId: draft.companyId || null, contactId: draft.contactId || null };
    const r = caseId ? await api('PATCH', `/cases/${caseId}`, { ...body, status: draft.status }) : await api('POST', '/cases', body);
    if (r) onClose();
  };
  const workOrder = async () => {
    if (!caseId) return;
    // сначала сохранить правки клиента: заказ-наряд берёт контрагента из обращения
    if (draft.companyId !== (c?.companyId ?? '') && !(await api('PATCH', `/cases/${caseId}`, { companyId: draft.companyId || null }))) return;
    const r = await api<{ documentId: string }>('POST', `/cases/${caseId}/work-order`);
    if (r) toast.success(t('cases.card.workOrderCreated'));
  };

  const lastIn = c?.emails.find(e => e.direction === 'in');
  const contactEmail = crm.contacts.find(x => x.id === draft.contactId)?.email ?? '';
  const replyTo = lastIn?.fromEmail ?? contactEmail;
  const dealId = c?.dealId;
  const deal = dealId ? crm.deals.find(d => d.id === dealId) : undefined;

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title={c ? `${c.number} · ${c.subject}` : t('cases.card.newTitle')}
        description={c ? t('cases.card.created', { date: fmtDateTime(c.createdAt) }) : undefined}
        footer={
          <Button variant="primary" disabled={!!closed} onClick={() => void save()}>
            {caseId ? t('cases.card.save') : t('cases.card.create')}
          </Button>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          {c && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <CaseStatusBadge status={c.status} />
              <CasePriorityBadge priority={c.priority} />
              <SlaBadge c={c} />
            </div>
          )}
          {closed && <Alert tone="info">{t('cases.card.closedNote')}</Alert>}
          {c && (
            <div className="grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, fontSize: 13 }}>
              <span className="muted">{t('cases.card.firstResponseDue')}</span>
              <span className="num">{c.firstResponseDueAt ? fmtDateTime(c.firstResponseDueAt) : '—'}</span>
              <span className="muted">{t('cases.card.firstResponded')}</span>
              <span className="num">{c.firstRespondedAt ? fmtDateTime(c.firstRespondedAt) : t('cases.card.notYet')}</span>
              <span className="muted">{t('cases.card.resolveDue')}</span>
              <span className="num">{c.resolveDueAt ? fmtDateTime(c.resolveDueAt) : '—'}</span>
              <span className="muted">{t('cases.card.resolvedAt')}</span>
              <span className="num">{c.resolvedAt ? fmtDateTime(c.resolvedAt) : t('cases.card.notYet')}</span>
              <span className="muted">{t('cases.card.channel')}</span>
              <span>{t(`cases.channel.${c.channel}`)}</span>
            </div>
          )}
          <Field label={t('cases.card.subject')} error={err}>{p => <Input {...p} maxLength={200} disabled={!!closed} value={draft.subject} onChange={e => set({ subject: e.target.value })} />}</Field>
          <Field label={t('cases.card.description')}>{p => <Textarea {...p} rows={4} maxLength={20000} disabled={!!closed} value={draft.description} onChange={e => set({ description: e.target.value })} />}</Field>
          <div className="grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {caseId && <Field label={t('cases.card.status')}>{p => <Select {...p} disabled={!!closed} value={draft.status} onValueChange={v => set({ status: v as CaseStatus })} options={CASE_STATUSES.map(s => ({ value: s, label: t(`cases.status.${s}`) }))} />}</Field>}
            <Field label={t('cases.card.priority')}>{p => <Select {...p} disabled={!!closed} value={draft.priority} onValueChange={v => set({ priority: v as CasePriority })} options={CASE_PRIORITIES.map(s => ({ value: s, label: t(`cases.priority.${s}`) }))} />}</Field>
            <Field label={t('cases.card.owner')}>
              {p => <Select {...p} disabled={!!closed} value={draft.ownerId || NONE} onValueChange={v => set({ ownerId: v === NONE ? '' : v })} options={[{ value: NONE, label: t('cases.noOwner') }, ...owners.map(m => ({ value: m.id, label: m.name }))]} />}
            </Field>
            <Field label={t('cases.card.company')}>
              {p => <Select {...p} disabled={!!closed} value={draft.companyId || NONE} onValueChange={v => set({ companyId: v === NONE ? '' : v, contactId: '' })} options={[{ value: NONE, label: t('cases.card.noClient') }, ...crm.companies.map(x => ({ value: x.id, label: x.name }))]} />}
            </Field>
            <Field label={t('cases.card.contact')}>
              {p => <Select {...p} disabled={!!closed} value={draft.contactId || NONE} onValueChange={v => set({ contactId: v === NONE ? '' : v })} options={[{ value: NONE, label: t('cases.card.noClient') }, ...contacts.map(x => ({ value: x.id, label: x.name }))]} />}
            </Field>
          </div>
          {c && customRows.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              {customRows.map(r => (
                <div key={r.field.id} className="row" style={{ gap: 8 }}>
                  <span className="muted" style={{ width: 160, fontSize: 13 }}>{r.label}</span>
                  <div style={{ flex: 1 }}>{r.node}</div>
                </div>
              ))}
            </div>
          )}
          {c && (
            <div className="stack" style={{ gap: 6 }}>
              <h3 style={{ margin: 0 }}>{t('cases.card.related')}</h3>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
                {c.workOrderId ? (
                  <Link to={`/documents/${c.workOrderId}`}><ClipboardList size={13} /> {t('cases.card.workOrderOpen')}</Link>
                ) : (
                  !closed && (
                    <Button size="sm" variant="ghost" disabled={!draft.companyId} title={draft.companyId ? undefined : t('cases.card.workOrderCompanyHint')} onClick={() => void workOrder()}>
                      <ClipboardList size={13} />
                      {t('cases.card.workOrderCreate')}
                    </Button>
                  )
                )}
                {deal && <span>{t('cases.card.deal')}: <b>{deal.name}</b></span>}
                {c.companyId && <Link to={`/crm/companies/${c.companyId}`}>{t('cases.card.openCompany')}</Link>}
                {c.leadId && <Link to="/crm/leads">{t('cases.card.openLead')}</Link>}
              </div>
            </div>
          )}
          {c && <Reply c={c} defaultTo={replyTo} />}
          {c && <Feed c={c} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
