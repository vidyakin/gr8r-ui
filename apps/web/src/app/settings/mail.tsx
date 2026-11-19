/* Настройки → Почта и «Мой почтовый ящик» в профиле (задача 1092, docs/architecture/email.md): общий и личный ящики, пресеты
   Яндекс 360 / Mail.ru / Gmail, проверка подключения. Пароль приложения вводится один раз и больше не показывается. */
import * as React from 'react';
import { MAIL_PRESETS, type MailPreset } from '@erp/shared';
import { Alert, Badge, Button, Checkbox, Choice, ConfirmDialog, Dialog, DialogContent, Field, Input, Select, Textarea, toast } from '@/components/ui';
import { useT, type TKey } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { useEmailApi, useMailboxes, type MailSecurity, type Mailbox } from '../email/data';
import { SettingsHead, SRow } from './parts';

interface Draft {
  email: string;
  displayName: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: MailSecurity;
  smtpUser: string;
  password: string;
  imapHost: string;
  imapPort: string;
  imapSecure: MailSecurity;
  imapUser: string;
  signature: string;
  createLeadFromUnmatched: boolean;
}

const blank: Draft = { email: '', displayName: '', smtpHost: '', smtpPort: '465', smtpSecure: 'ssl', smtpUser: '', password: '', imapHost: '', imapPort: '993', imapSecure: 'ssl', imapUser: '', signature: '', createLeadFromUnmatched: false };
const fromMailbox = (m: Mailbox): Draft => ({
  email: m.email,
  displayName: m.displayName,
  smtpHost: m.smtpHost,
  smtpPort: String(m.smtpPort),
  smtpSecure: m.smtpSecure,
  smtpUser: m.smtpUser,
  password: '',
  imapHost: m.imapHost ?? '',
  imapPort: m.imapPort ? String(m.imapPort) : '993',
  imapSecure: m.imapSecure ?? 'ssl',
  imapUser: m.imapUser ?? '',
  signature: m.signature,
  createLeadFromUnmatched: m.createLeadFromUnmatched,
});

function MailboxForm({ kind, mailbox, onClose }: { kind: 'shared' | 'personal'; mailbox: Mailbox | null; onClose: () => void }) {
  const t = useT();
  const api = useEmailApi();
  const [d, setD] = React.useState<Draft>(mailbox ? fromMailbox(mailbox) : blank);
  const [preset, setPreset] = React.useState('none');
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(x => ({ ...x, [k]: v }));
  const applyPreset = (id: string) => {
    setPreset(id);
    const p: MailPreset | undefined = MAIL_PRESETS.find(x => x.id === id);
    if (p) setD(x => ({ ...x, smtpHost: p.smtpHost, smtpPort: String(p.smtpPort), smtpSecure: p.smtpSecure, imapHost: p.imapHost, imapPort: String(p.imapPort), imapSecure: p.imapSecure }));
  };
  const secOptions = (['ssl', 'starttls', 'none'] as const).map(v => ({ value: v, label: t(`email.settings.${v}`) }));
  const valid = d.email.trim() && d.smtpHost.trim() && Number(d.smtpPort) > 0 && (mailbox || d.password);

  const save = async () => {
    setBusy(true);
    const imap = d.imapHost.trim()
      ? { imapHost: d.imapHost.trim(), imapPort: Number(d.imapPort) || 993, imapSecure: d.imapSecure, imapUser: d.imapUser.trim() || d.smtpUser.trim() || d.email.trim() }
      : { imapHost: null, imapPort: null, imapSecure: null, imapUser: null };
    const body = {
      email: d.email.trim(),
      displayName: d.displayName.trim(),
      smtpHost: d.smtpHost.trim(),
      smtpPort: Number(d.smtpPort),
      smtpSecure: d.smtpSecure,
      smtpUser: d.smtpUser.trim() || d.email.trim(),
      signature: d.signature,
      ...(kind === 'shared' ? { createLeadFromUnmatched: d.createLeadFromUnmatched } : {}),
      ...imap,
      ...(d.password ? { password: d.password } : {}),
    };
    const r = mailbox ? await api('PATCH', `/mailboxes/${mailbox.id}`, body) : await api('POST', '/mailboxes', { ...body, kind });
    setBusy(false);
    if (r) {
      toast(t('email.settings.saved'));
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={kind === 'shared' ? t('email.settings.sharedTitle') : t('email.settings.personalTitle')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t('email.settings.cancel')}</Button>
            <Button variant="primary" disabled={!valid || busy} onClick={() => void save()}>{t('email.settings.save')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={t('email.settings.preset')}>
            {p => <Select {...p} value={preset} onValueChange={applyPreset} options={[{ value: 'none', label: t('email.settings.presetNone') }, ...MAIL_PRESETS.map(x => ({ value: x.id, label: t(`email.settings.presets.${x.id as 'gmail'}`) }))]} />}
          </Field>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <Field label={t('email.settings.email')} className="grow">{p => <Input {...p} type="email" maxLength={254} value={d.email} onChange={e => set('email', e.target.value)} />}</Field>
            <Field label={t('email.settings.displayName')} className="grow">{p => <Input {...p} maxLength={200} value={d.displayName} onChange={e => set('displayName', e.target.value)} />}</Field>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('email.settings.smtpHost')} className="grow">{p => <Input {...p} maxLength={253} value={d.smtpHost} onChange={e => set('smtpHost', e.target.value)} />}</Field>
            <Field label={t('email.settings.smtpPort')}>{p => <Input {...p} inputMode="numeric" style={{ width: 90 }} value={d.smtpPort} onChange={e => set('smtpPort', e.target.value.replace(/\D/g, ''))} />}</Field>
            <Field label={t('email.settings.security')}>{p => <div style={{ width: 140 }}><Select {...p} value={d.smtpSecure} onValueChange={v => set('smtpSecure', v as MailSecurity)} options={secOptions} /></div>}</Field>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <Field label={t('email.settings.smtpUser')} className="grow">{p => <Input {...p} maxLength={254} placeholder={d.email} value={d.smtpUser} onChange={e => set('smtpUser', e.target.value)} />}</Field>
            <Field label={t('email.settings.password')} hint={mailbox ? t('email.settings.passwordHintKeep') : t('email.settings.passwordHintNew')} className="grow">
              {p => <Input {...p} type="password" autoComplete="new-password" maxLength={512} value={d.password} onChange={e => set('password', e.target.value)} />}
            </Field>
          </div>
          <Field label={t('email.settings.signature')}>{p => <Textarea {...p} rows={3} maxLength={5000} value={d.signature} onChange={e => set('signature', e.target.value)} />}</Field>
          {kind === 'shared' && <Choice><Checkbox checked={d.createLeadFromUnmatched} onChange={e => set('createLeadFromUnmatched', e.target.checked)} />{t('email.settings.createLeadFromUnmatched')}</Choice>}
          <h3 style={{ margin: '4px 0 0' }}>{t('email.settings.imapTitle')}</h3>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('email.settings.imapHost')} className="grow">{p => <Input {...p} maxLength={253} value={d.imapHost} onChange={e => set('imapHost', e.target.value)} />}</Field>
            <Field label={t('email.settings.imapPort')}>{p => <Input {...p} inputMode="numeric" style={{ width: 90 }} value={d.imapPort} onChange={e => set('imapPort', e.target.value.replace(/\D/g, ''))} />}</Field>
            <Field label={t('email.settings.security')}>{p => <div style={{ width: 140 }}><Select {...p} value={d.imapSecure} onValueChange={v => set('imapSecure', v as MailSecurity)} options={secOptions} /></div>}</Field>
            <Field label={t('email.settings.imapUser')} className="grow">{p => <Input {...p} maxLength={254} value={d.imapUser} onChange={e => set('imapUser', e.target.value)} />}</Field>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Карточка ящика: общий (правит admin+) или личный (владелец) */
export function MailboxCard({ kind }: { kind: 'shared' | 'personal' }) {
  const t = useT();
  const api = useEmailApi();
  const isAdmin = useIsAdmin();
  const list = useMailboxes();
  const mailbox = (list.data ?? []).find(m => m.kind === kind) ?? null;
  const canEdit = kind === 'personal' || isAdmin;
  const [editing, setEditing] = React.useState(false);
  const [del, setDel] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const check = async () => {
    if (!mailbox) return;
    setBusy(true);
    const r = await api<{ ok: boolean; error: string | null }>('POST', `/mailboxes/${mailbox.id}/check`);
    setBusy(false);
    if (r) (r.ok ? toast : toast.error)(r.ok ? t('email.settings.checkOk') : t('email.settings.checkFailed', { error: r.error ?? '' }));
  };

  return (
    <div className="sblock">
      <h2 style={{ margin: '0 0 8px' }}>{kind === 'shared' ? t('email.settings.sharedTitle') : t('email.settings.personalTitle')}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{kind === 'shared' ? t('email.settings.sharedLead') : t('email.settings.personalLead')}</p>
      {kind === 'shared' && !isAdmin && <Alert>{t('email.settings.onlyAdmins')}</Alert>}
      <div className="srow" style={{ display: 'block' }}>
        <SRow
          t={mailbox ? <>{mailbox.displayName ? `${mailbox.displayName} · ` : ''}{mailbox.email}</> : t('email.settings.notSet')}
          d={
            mailbox ? (
              <>
                <Badge>{t(`email.settings.state.${mailbox.status}` as TKey)}</Badge> <Badge>{mailbox.hasPassword ? t('email.settings.password_set') : t('email.settings.password_missing')}</Badge>
                {mailbox.lastError && <div className="faint" style={{ marginTop: 4 }}>{mailbox.lastError}</div>}
              </>
            ) : undefined
          }
        >
          {mailbox && canEdit && <Button size="sm" variant="ghost" disabled={busy || !mailbox.hasPassword} onClick={() => void check()}>{t('email.settings.check')}</Button>}
          {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{mailbox ? t('email.settings.edit') : t('email.settings.add')}</Button>}
          {mailbox && canEdit && <Button size="sm" variant="ghost" onClick={() => setDel(true)}>{t('email.settings.remove')}</Button>}
        </SRow>
      </div>
      {editing && <MailboxForm kind={kind} mailbox={mailbox} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('email.settings.remove')}
        description={t('email.settings.confirmDelete', { email: mailbox?.email ?? '' })}
        confirmLabel={t('email.settings.remove')}
        cancelLabel={t('email.settings.cancel')}
        danger
        onConfirm={async () => {
          if (mailbox && (await api('DELETE', `/mailboxes/${mailbox.id}`))) toast(t('email.settings.deleted'));
          setDel(false);
        }}
      />
    </div>
  );
}

export function MailSection({ title }: { title: string }) {
  const t = useT();
  return (
    <>
      <SettingsHead title={title} lead={t('email.settings.lead')} />
      <MailboxCard kind="shared" />
      <MailboxCard kind="personal" />
    </>
  );
}
