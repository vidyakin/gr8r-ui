/* Карточка лида (задача 1175): поля, поиск дублей (при вводе и по сохранённому лиду) с кнопкой «Объединить», лента касаний,
   переход к конвертации. Новый лид создаётся здесь же. Пользовательские поля — из конструктора (сущность lead). */
import * as React from 'react';
import { Link } from 'react-router';
import { Archive, ArrowRightLeft, Building2, Handshake, User } from 'lucide-react';
import { Alert, Button, ConfirmDialog, Dialog, DialogContent, Field, Input, Select, Textarea, toast } from '@/components/ui';
import { fmtDateTime } from '@/i18n/format';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { useCustomRows } from '../meta/custom-fields';
import { useMembersWith } from '../positions/data';
import { StatusBadge } from './StatusBadge';
import { useDuplicatesFor, useLead, useLeadActivities, useLeadDuplicates, useLeadsApi, useLeadStatuses, type DuplicateMatch, type Lead } from './data';

interface Draft {
  name: string;
  companyName: string;
  phone: string;
  email: string;
  source: string;
  comment: string;
  ownerId: string;
  statusId: string;
  rejectReason: string;
}

const fromLead = (l: Lead): Draft => ({ name: l.name, companyName: l.companyName, phone: l.phone, email: l.email, source: l.source, comment: l.comment, ownerId: l.ownerId ?? '', statusId: l.statusId, rejectReason: l.rejectReason });
const blank: Draft = { name: '', companyName: '', phone: '', email: '', source: '', comment: '', ownerId: '', statusId: '', rejectReason: '' };
const NO_OWNER = '__none';

function Duplicates({ items, current, onMerge }: { items: DuplicateMatch[]; current: string | null; onMerge: (m: DuplicateMatch) => void }) {
  const t = useT();
  const shown = items.filter(m => m.id !== current);
  if (!shown.length) return null;
  const link = (m: DuplicateMatch) => (m.kind === 'company' ? `/crm/companies/${m.id}` : m.kind === 'contact' ? (m.companyId ? `/crm/companies/${m.companyId}` : '/crm/contacts') : null);
  return (
    <Alert tone="warn" className="mb-3">
      <div style={{ fontWeight: 500 }}>{t('leads.dup.title')}</div>
      <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>{t('leads.dup.hint')}</div>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {shown.map(m => (
          <li key={`${m.kind}-${m.id}`} style={{ fontSize: 13 }}>
            {t(`leads.dup.kind.${m.kind}`)}:{' '}
            {link(m) ? <Link to={link(m)!}>{m.name}</Link> : <b>{m.name}</b>} ·{' '}
            <span className="muted">{t(m.by === 'phone' ? 'leads.dup.byPhone' : m.by === 'email' ? 'leads.dup.byEmail' : m.by === 'contact' ? 'leads.dup.byContact' : 'leads.dup.byName')}</span>
            {m.kind === 'lead' && current && (
              <>
                {' '}
                <button className="link" onClick={() => onMerge(m)}>{t('leads.dup.merge')}</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function Feed({ leadId }: { leadId: string }) {
  const t = useT();
  const { data: ws } = useWorkspace();
  const api = useLeadsApi();
  const acts = useLeadActivities(leadId);
  const [type, setType] = React.useState<'note' | 'call' | 'email' | 'meeting'>('note');
  const [text, setText] = React.useState('');
  const add = async () => {
    const subject = text.trim();
    if (!subject) return;
    const r = await api('POST', '/crm-activities', { type, subject: subject.slice(0, 200), body: subject.length > 200 ? subject : null, leadId });
    if (r) setText('');
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>{t('leads.feed.title')}</h3>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <Select size="sm" value={type} onValueChange={v => setType(v as typeof type)} aria-label={t('leads.feed.title')} options={(['note', 'call', 'email', 'meeting'] as const).map(x => ({ value: x, label: t(`leads.feed.type.${x}`) }))} />
        <Textarea rows={2} value={text} placeholder={t('leads.feed.placeholder')} onChange={e => setText(e.target.value)} style={{ flex: 1 }} />
        <Button size="sm" disabled={!text.trim()} onClick={() => void add()}>{t('leads.feed.add')}</Button>
      </div>
      {(acts.data ?? []).length === 0 ? (
        <p className="faint" style={{ fontSize: 13 }}>{t('leads.feed.empty')}</p>
      ) : (
        <ul className="stack" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
          {(acts.data ?? []).map(a => (
            <li key={a.id} style={{ fontSize: 13 }}>
              <span className="faint">{fmtDateTime(a.createdAt)} · {a.system ? t('leads.feed.system') : ws.members.find(m => m.id === a.authorId)?.name ?? ''} · {t(`leads.feed.type.${a.type}`)}</span>
              <div>{a.subject}</div>
              {a.body && a.body !== a.subject && <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LeadCard({ leadId, onClose, onConvert }: { leadId: string | null; onClose: () => void; onConvert: (id: string) => void }) {
  const t = useT();
  const { data: ws } = useWorkspace();
  const api = useLeadsApi();
  const statuses = useLeadStatuses();
  const lead = useLead(leadId);
  const [draft, setDraft] = React.useState<Draft>(blank);
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  const [mergeWith, setMergeWith] = React.useState<DuplicateMatch | null>(null);
  const [archive, setArchive] = React.useState(false);
  const [err, setErr] = React.useState('');

  // форма заполняется один раз при загрузке лида; дальше правки идут из неё, а не из кэша (чтобы realtime не затирал ввод)
  React.useEffect(() => {
    if (leadId && lead.data && loadedFor !== lead.data.id) {
      setDraft(fromLead(lead.data));
      setLoadedFor(lead.data.id);
    }
  }, [leadId, lead.data, loadedFor]);
  React.useEffect(() => {
    if (!leadId && !draft.statusId && statuses.data) setDraft(d => ({ ...d, statusId: statuses.data!.find(s => s.category === 'new')?.id ?? '' }));
  }, [leadId, draft.statusId, statuses.data]);

  const dupNew = useDuplicatesFor(leadId ? { phone: '', email: '', companyName: '' } : { phone: draft.phone, email: draft.email, companyName: draft.companyName });
  const dupSaved = useLeadDuplicates(leadId);
  const members = ws.members.filter(m => m.status === 'active');
  const owners = useMembersWith(members, 'sales_manager', [draft.ownerId]);
  const statusById = new Map((statuses.data ?? []).map(s => [s.id, s]));
  const current = lead.data;
  const converted = !!current?.convertedAt;
  const status = statusById.get(draft.statusId);
  const customRows = useCustomRows('lead', current?.custom, patch => void api('PATCH', `/leads/${leadId}`, { custom: patch }));
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));

  const save = async () => {
    if (!draft.name.trim()) return setErr(t('leads.card.nameRequired'));
    setErr('');
    const body = {
      name: draft.name.trim(),
      companyName: draft.companyName,
      phone: draft.phone,
      email: draft.email,
      source: draft.source,
      comment: draft.comment,
      ownerId: draft.ownerId || null,
      statusId: draft.statusId || undefined,
      rejectReason: status?.category === 'rejected' ? draft.rejectReason : undefined,
    };
    const r = leadId ? await api<Lead>('PATCH', `/leads/${leadId}`, body) : await api<Lead>('POST', '/leads', body);
    if (r) onClose();
  };

  const merge = async () => {
    if (!mergeWith || !leadId) return;
    // кнопка у дубля: дубль вливается в открытый лид
    const r = await api('POST', `/leads/${mergeWith.id}/merge`, { intoId: leadId });
    setMergeWith(null);
    if (r) {
      toast.success(t('leads.dup.merged'));
      setLoadedFor(null);
    }
  };

  const doArchive = async () => {
    if (leadId && (await api('DELETE', `/leads/${leadId}`))) onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title={leadId ? current?.name ?? '…' : t('leads.card.newTitle')}
        description={current ? (converted ? t('leads.card.converted', { date: fmtDateTime(current.convertedAt!) }) : t('leads.card.created', { date: fmtDateTime(current.createdAt) })) : undefined}
        footer={
          <>
            {leadId && !converted && (
              <Button variant="ghost" onClick={() => onConvert(leadId)}>
                <ArrowRightLeft size={14} />
                {t('leads.convert.button')}
              </Button>
            )}
            {leadId && (
              <Button variant="ghost" onClick={() => setArchive(true)}>
                <Archive size={14} />
                {t('leads.card.delete')}
              </Button>
            )}
            <Button variant="primary" onClick={() => void save()}>
              {leadId ? t('leads.card.save') : t('leads.card.create')}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          {/* у сконвертированного лида дубли уже разобраны мастером — вместо них блок «Созданные записи» */}
          {!converted && <Duplicates items={leadId ? dupSaved.data ?? [] : dupNew.data ?? []} current={leadId} onMerge={setMergeWith} />}
          {converted && current && (
            <Alert tone="info">
              <div style={{ fontWeight: 500 }}>{t('leads.card.convertedTo')}</div>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                {current.companyId && <Link to={`/crm/companies/${current.companyId}`}><Building2 size={13} /> {t('leads.card.openCompany')}</Link>}
                {current.contactId && <Link to="/crm/contacts"><User size={13} /> {t('leads.card.openContact')}</Link>}
                {current.dealId && <Link to="/crm/deals"><Handshake size={13} /> {t('leads.card.openDeal')}</Link>}
              </div>
            </Alert>
          )}
          <div className="grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Field label={t('leads.card.name')} error={err}>{p => <Input {...p} maxLength={200} value={draft.name} onChange={e => set({ name: e.target.value })} />}</Field>
            <Field label={t('leads.card.companyName')}>{p => <Input {...p} maxLength={200} value={draft.companyName} onChange={e => set({ companyName: e.target.value })} />}</Field>
            <Field label={t('leads.card.phone')}>{p => <Input {...p} maxLength={50} value={draft.phone} onChange={e => set({ phone: e.target.value })} />}</Field>
            <Field label={t('leads.card.email')}>{p => <Input {...p} maxLength={254} value={draft.email} onChange={e => set({ email: e.target.value })} />}</Field>
            <Field label={t('leads.card.source')}>{p => <Input {...p} maxLength={200} value={draft.source} onChange={e => set({ source: e.target.value })} />}</Field>
            <Field label={t('leads.card.owner')}>
              {p => (
                <Select
                  {...p}
                  value={draft.ownerId || NO_OWNER}
                  onValueChange={v => set({ ownerId: v === NO_OWNER ? '' : v })}
                  options={[{ value: NO_OWNER, label: t('leads.noOwner') }, ...owners.map(m => ({ value: m.id, label: m.name }))]}
                />
              )}
            </Field>
            <Field label={t('leads.card.status')}>
              {p =>
                converted ? (
                  <StatusBadge status={status} />
                ) : (
                  <Select {...p} value={draft.statusId} onValueChange={v => set({ statusId: v })} options={(statuses.data ?? []).filter(s => s.category !== 'converted').map(s => ({ value: s.id, label: s.name }))} />
                )
              }
            </Field>
            {status?.category === 'rejected' && !converted && <Field label={t('leads.card.rejectReason')}>{p => <Input {...p} maxLength={500} value={draft.rejectReason} onChange={e => set({ rejectReason: e.target.value })} />}</Field>}
          </div>
          <Field label={t('leads.card.comment')}>{p => <Textarea {...p} rows={3} maxLength={5000} value={draft.comment} onChange={e => set({ comment: e.target.value })} />}</Field>
          {leadId && customRows.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              {customRows.map(r => (
                <div key={r.field.id} className="row" style={{ gap: 8 }}>
                  <span className="muted" style={{ width: 160, fontSize: 13 }}>{r.label}</span>
                  <div style={{ flex: 1 }}>{r.node}</div>
                </div>
              ))}
            </div>
          )}
          {current && Object.keys(current.custom).some(k => k.startsWith('utm_')) && (
            <div className="faint" style={{ fontSize: 12 }}>
              {t('leads.card.utm')}: {Object.entries(current.custom).filter(([k]) => k.startsWith('utm_')).map(([k, v]) => `${k}=${String(v)}`).join(', ')}
            </div>
          )}
          {leadId && <Feed leadId={leadId} />}
        </div>
        <ConfirmDialog open={!!mergeWith} onOpenChange={o => !o && setMergeWith(null)} title={t('leads.dup.mergeConfirmTitle')} description={t('leads.dup.mergeConfirm', { name: mergeWith?.name ?? '' })} confirmLabel={t('leads.dup.merge')} onConfirm={() => void merge()} />
        <ConfirmDialog open={archive} onOpenChange={setArchive} title={t('leads.card.delete')} description={t('leads.card.deleteConfirm')} confirmLabel={t('leads.card.delete')} danger onConfirm={() => void doArchive()} />
      </DialogContent>
    </Dialog>
  );
}
