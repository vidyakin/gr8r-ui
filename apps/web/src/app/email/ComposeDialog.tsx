/* Окно «Новое письмо» (задача 1092, docs/architecture/email.md): кому, копия, тема, текст с подписью ящика, вложения записи, выбор ящика
   «от кого». Из карточек лида, контакта, контрагента, сделки и из документа (с PDF печатной формы). Письмо ставится в очередь,
   отправляет воркер; статус виден в ленте касаний. */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { splitAddresses } from '@erp/shared';
import { Alert, Button, Checkbox, Choice, Dialog, DialogContent, Field, Input, Select, Textarea, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { call, useWsId } from '../meta/data';
import { emailKey, useEmailApi, useMailboxes, type EmailLinks, type EmailMessage } from './data';

export interface ComposeDocument {
  id: string;
  /** Печатные формы документа: value — код формы, label — подпись */
  forms: { value: string; label: string }[];
}

export interface ComposeProps {
  onClose: () => void;
  links: EmailLinks;
  defaultTo?: string;
  defaultSubject?: string;
  document?: ComposeDocument;
}

const sigBlock = (sig: string) => (sig.trim() ? `\n\n-- \n${sig}` : '');

/** Объект, чьи файлы можно приложить: документ, иначе самая «узкая» привязка */
function attachmentTarget(links: EmailLinks, doc?: ComposeDocument): { type: string; id: string } | null {
  if (doc) return { type: 'document', id: doc.id };
  if (links.dealId) return { type: 'deal', id: links.dealId };
  if (links.leadId) return { type: 'lead', id: links.leadId };
  if (links.contactId) return { type: 'contact', id: links.contactId };
  if (links.companyId) return { type: 'company', id: links.companyId };
  return null;
}

export function ComposeDialog({ onClose, links, defaultTo = '', defaultSubject = '', document: doc }: ComposeProps) {
  const t = useT();
  const ws = useWsId();
  const api = useEmailApi();
  const boxes = useMailboxes();
  const list = boxes.data ?? [];
  const personal = list.find(m => m.kind === 'personal');
  const [mailboxId, setMailboxId] = React.useState<string>('');
  const current = list.find(m => m.id === mailboxId) ?? personal ?? list[0];
  const [to, setTo] = React.useState(defaultTo);
  const [cc, setCc] = React.useState('');
  const [subject, setSubject] = React.useState(defaultSubject);
  const [body, setBody] = React.useState('');
  const [form, setForm] = React.useState<string>(doc?.forms[0]?.value ?? 'none');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const lastSig = React.useRef<string | null>(null);

  // подпись ящика дописывается в конец текста и заменяется при смене ящика (если её не стерли)
  React.useEffect(() => {
    if (!current) return;
    const next = sigBlock(current.signature);
    setBody(b => {
      const prev = lastSig.current;
      lastSig.current = next;
      if (prev === null) return b + next;
      return prev && b.endsWith(prev) ? b.slice(0, b.length - prev.length) + next : b;
    });
  }, [current?.id, current?.signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const target = attachmentTarget(links, doc);
  const files = useQuery({
    queryKey: emailKey(ws, 'files', target?.type, target?.id),
    enabled: !!target,
    queryFn: async () => (await call<{ items: { id: string; name: string }[] }>(ws, 'GET', `/attachments?entityType=${target!.type}&entityId=${target!.id}`)).items,
  });

  const recipients = splitAddresses(to);
  const send = async () => {
    if (!recipients.length) return toast.error(t('email.compose.recipientRequired'));
    if (!subject.trim()) return toast.error(t('email.compose.subjectRequired'));
    setBusy(true);
    const r = await api<EmailMessage>('POST', '/emails', {
      mailboxId: current?.id ?? null,
      to: recipients,
      cc: splitAddresses(cc),
      subject: subject.trim(),
      body,
      attachmentIds: picked,
      ...links,
      ...(doc ? { documentId: doc.id, printForm: form === 'none' ? null : form } : {}),
    });
    setBusy(false);
    if (r) {
      toast(t('email.compose.queued'));
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('email.compose.title')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t('email.settings.cancel')}</Button>
            <Button variant="primary" disabled={busy || !current} onClick={() => void send()}>{t('email.compose.send')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          {boxes.isSuccess && !list.length && <Alert tone="warn">{t('email.compose.noMailbox')}</Alert>}
          {list.length > 0 && (
            <Field label={t('email.compose.from')}>
              {p => (
                <Select
                  {...p}
                  value={current?.id ?? ''}
                  onValueChange={setMailboxId}
                  options={list.map(m => ({ value: m.id, label: `${m.displayName ? `${m.displayName} <${m.email}>` : m.email} · ${m.kind === 'shared' ? t('email.compose.shared') : t('email.compose.personal')}` }))}
                />
              )}
            </Field>
          )}
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <Field label={t('email.compose.to')} hint={t('email.compose.toHint')} className="grow">{p => <Input {...p} value={to} onChange={e => setTo(e.target.value)} />}</Field>
            <Field label={t('email.compose.cc')} className="grow">{p => <Input {...p} value={cc} onChange={e => setCc(e.target.value)} />}</Field>
          </div>
          <Field label={t('email.compose.subject')}>{p => <Input {...p} maxLength={500} value={subject} onChange={e => setSubject(e.target.value)} />}</Field>
          <Field label={t('email.compose.body')}>{p => <Textarea {...p} rows={9} value={body} onChange={e => setBody(e.target.value)} />}</Field>
          {doc && doc.forms.length > 0 && (
            <Field label={t('email.compose.printForm')}>
              {p => <Select {...p} value={form} onValueChange={setForm} options={[...doc.forms, { value: 'none', label: t('email.compose.printFormNone') }]} />}
            </Field>
          )}
          {target && (
            <div className="stack" style={{ gap: 4 }}>
              <div className="label">{t('email.compose.attachments')}</div>
              {(files.data ?? []).length === 0 ? (
                <span className="faint" style={{ fontSize: 13 }}>{t('email.compose.noAttachments')}</span>
              ) : (
                (files.data ?? []).map(f => (
                  <Choice key={f.id}>
                    <Checkbox checked={picked.includes(f.id)} onChange={e => setPicked(p => (e.target.checked ? [...p, f.id] : p.filter(x => x !== f.id)))} aria-label={f.name} />
                    <span>{f.name}</span>
                  </Choice>
                ))
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
