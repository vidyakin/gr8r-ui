/* Входящие письма (задача 1092, docs/architecture/email.md): доступные ящики, ручная проверка и привязка к CRM. */
import * as React from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { Alert, Badge, Button, Choice, Checkbox, Dialog, DialogContent, EmptyState, Field, Input, Select, toast } from '@/components/ui';
import { AttachmentsPanel } from '@/components/erp/attachments-panel';
import { useT } from '@/i18n';
import { fmtDateTime } from '@/i18n/format';
import { useSession } from '../data/session';
import { errorMessage } from '../data/api';
import { useEmailApi, useEmailLinkTargets, useIncomingEmails, useMailboxes, type IncomingEmail } from './data';

export const isEmailLinked = (m: IncomingEmail) => !!(m.leadId || m.contactId || m.companyId || m.dealId || m.documentId);

/** Отдельная строка позволяет проверить реальный рендер письма без сетевых запросов. */
export function IncomingEmailRow({ email, mailbox, canWrite, onOpen, onLink }: { email: IncomingEmail; mailbox?: string; canWrite: boolean; onOpen: () => void; onLink: () => void }) {
  const t = useT();
  return (
    <article className="srow" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <Button variant="ghost" onClick={onOpen} style={{ maxWidth: '100%', paddingLeft: 0, textAlign: 'left', justifyContent: 'flex-start' }}>
          <span className="trunc">{email.subject || t('email.incoming.noSubject')}</span>
        </Button>
        <div className="muted" style={{ overflowWrap: 'anywhere' }}>{email.fromName ? `${email.fromName} · ` : ''}{email.fromEmail}</div>
        <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{mailbox}{email.receivedAt ? ` · ${fmtDateTime(email.receivedAt)}` : ''}</div>
      </div>
      {isEmailLinked(email) ? <Badge>{t('email.incoming.linkedRecord')}</Badge> : <Badge>{t('email.incoming.unlinked')}</Badge>}
      {!isEmailLinked(email) && canWrite && <Button size="sm" onClick={onLink}>{t('email.incoming.link')}</Button>}
    </article>
  );
}

export function IncomingEmailContent({ email }: { email: IncomingEmail }) {
  const t = useT();
  return <>
    {email.lastError && <Alert><strong>{t('email.incoming.warning')}</strong><div>{email.lastError}</div></Alert>}
    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBlock: 20 }}>{email.bodyText}</div>
  </>;
}

function LinkEmailDialog({ email, onClose }: { email: IncomingEmail; onClose: () => void }) {
  const t = useT();
  const api = useEmailApi();
  const [kind, setKind] = React.useState<'contact' | 'lead'>('contact');
  const [search, setSearch] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [target, setTarget] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const targets = useEmailLinkTargets(kind, query);
  const link = async () => {
    setBusy(true);
    const r = await api('POST', `/emails/${email.id}/link`, kind === 'contact' ? { contactId: target } : { leadId: target });
    setBusy(false);
    if (r) { toast(t('email.incoming.linked')); onClose(); }
  };
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent title={t('email.incoming.link')} footer={<><Button variant="ghost" onClick={onClose}>{t('email.settings.cancel')}</Button><Button variant="primary" disabled={!target || busy} onClick={() => void link()}>{t('email.incoming.link')}</Button></>}>
        <div className="stack" style={{ gap: 12 }}>
          <Field label={t('email.incoming.record')}>{p => <Select {...p} value={kind} onValueChange={v => { setKind(v as 'contact' | 'lead'); setTarget(''); }} options={[{ value: 'contact', label: t('email.incoming.contact') }, { value: 'lead', label: t('email.incoming.leadRecord') }]} />}</Field>
          <Field label={t('email.incoming.search')}>{p => <Input {...p} value={search} onChange={e => { setSearch(e.target.value); setTarget(''); }} />}</Field>
          {targets.error && <Alert>{errorMessage(targets.error)}</Alert>}
          <Field label={t('email.incoming.choose')}>{p => <Select {...p} value={target} onValueChange={setTarget} options={(targets.data ?? []).map(x => ({ value: x.id, label: x.email ? `${x.name} · ${x.email}` : x.name }))} placeholder={t('email.incoming.choose')} />}</Field>
          {targets.isLoading && <p role="status" className="muted">{t('email.incoming.loading')}</p>}
          {!targets.isLoading && !targets.error && !targets.data?.length && <p className="muted">{t('email.incoming.noTargets')}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EmailPage() {
  const t = useT();
  const { active } = useSession();
  const canWrite = !!active && active.role !== 'guest';
  const api = useEmailApi();
  const boxes = useMailboxes();
  const [unlinked, setUnlinked] = React.useState(false);
  const [offset, setOffset] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [opened, setOpened] = React.useState<IncomingEmail | null>(null);
  const [linking, setLinking] = React.useState<IncomingEmail | null>(null);
  const list = useIncomingEmails(unlinked, offset);
  const incomingBoxes = (boxes.data ?? []).filter(x => x.imapHost);
  const sync = async () => {
    setBusy(true);
    let ok = true;
    for (const box of incomingBoxes) if (!(await api('POST', `/mailboxes/${box.id}/sync`))) ok = false;
    setBusy(false);
    if (ok) toast(t('email.incoming.syncQueued'));
  };
  const boxName = (id: string | null) => boxes.data?.find(x => x.id === id)?.email;
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="ph">
        <div><h1>{t('email.incoming.title')}</h1><p>{t('email.incoming.lead')}</p></div>
        <div className="acts">
          <Choice><Checkbox checked={unlinked} onChange={e => { setUnlinked(e.target.checked); setOffset(0); }} />{t('email.incoming.unlinked')}</Choice>
          {canWrite && <Button disabled={busy || !incomingBoxes.length} onClick={() => void sync()}><RefreshCw size={14} />{t('email.incoming.check')}</Button>}
        </div>
      </div>
      {boxes.error && <Alert>{errorMessage(boxes.error)}</Alert>}
      {!boxes.isLoading && !boxes.error && !incomingBoxes.length && <Alert>{t('email.incoming.noImap')}</Alert>}
      {list.isLoading ? <p role="status">{t('email.incoming.loading')}</p> : list.error ? <EmptyState error icon={<Mail />} title={t('email.incoming.loadFailed')} action={<Button onClick={() => void list.refetch()}>{t('email.incoming.retry')}</Button>}>{errorMessage(list.error)}</EmptyState> : (
        <div className="panel">
          {list.data?.length ? list.data.map(email => <IncomingEmailRow key={email.id} email={email} mailbox={boxName(email.mailboxId)} canWrite={canWrite} onOpen={() => setOpened(email)} onLink={() => setLinking(email)} />) : <EmptyState icon={<Mail />} title={t('email.incoming.empty')}>{t('email.incoming.emptyHint')}</EmptyState>}
        </div>
      )}
      {(offset > 0 || list.data?.length === 50) && <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}><Button disabled={offset === 0 || list.isFetching} onClick={() => setOffset(x => Math.max(0, x - 50))}>{t('email.incoming.previous')}</Button><Button disabled={list.data?.length !== 50 || list.isFetching} onClick={() => setOffset(x => x + 50)}>{t('email.incoming.next')}</Button></div>}
      {opened && <Dialog open onOpenChange={v => !v && setOpened(null)}><DialogContent title={opened.subject || t('email.incoming.noSubject')} size="lg" footer={<Button onClick={() => setOpened(null)}>{t('email.incoming.close')}</Button>}>
        <p style={{ overflowWrap: 'anywhere' }}>{opened.fromName ? `${opened.fromName} · ` : ''}{opened.fromEmail}</p>
        <p className="muted">{t('email.to', { to: opened.to.join(', ') })}{opened.receivedAt ? ` · ${fmtDateTime(opened.receivedAt)}` : ''}</p>
        <IncomingEmailContent email={opened} />
        {!!opened.attachmentIds.length && <AttachmentsPanel entityType="email" entityId={opened.id} readOnly />}
      </DialogContent></Dialog>}
      {linking && <LinkEmailDialog email={linking} onClose={() => setLinking(null)} />}
    </div>
  );
}
