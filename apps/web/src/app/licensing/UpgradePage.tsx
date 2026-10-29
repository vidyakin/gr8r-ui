/* «Нужно больше?» (задача 1208): все модули платформы с описанием, возможностями и состоянием у этого арендатора
   (подключён / пробный до … / только чтение до … / не подключён) и заявка на подключение. Заявки видит оператор установки. */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Sparkles } from 'lucide-react';
import { MODULES, type ModuleId, type ModuleRequestRow } from '@gr8r/shared';
import { Alert, Badge, Button, Checkbox, Dialog, DialogContent, Field, Input, Textarea, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDateTime, fmtDateTimeIntl } from '@/i18n/format';
import { errorMessage } from '../data/api';
import { useSession } from '../data/session';
import { call, useWsId } from '../meta/data';
import { useLicense } from './data';

/** Модули, которые можно подключить: не ядро и не пустые (docflow, пока у него нет разделов) */
export const OFFER_MODULES = MODULES.filter(m => m.id !== 'core' && (m.paths.length || m.sections.length || m.nodes.length || m.jobs.length));

const requestsKey = (ws: string) => ['ws', ws, 'license', 'requests'] as const;

function useMyRequests() {
  const ws = useWsId();
  return useQuery({ queryKey: requestsKey(ws), queryFn: () => call<{ items: ModuleRequestRow[] }>(ws, 'GET', '/license/requests') });
}

function RequestDialog({ open, modules, onClose }: { open: boolean; modules: ModuleId[]; onClose: () => void }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const user = useSession().user;
  const [selected, setSelected] = React.useState<ModuleId[]>(modules);
  const [contact, setContact] = React.useState('');
  const [comment, setComment] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setSelected(modules);
      setComment('');
      setContact(c => c || user?.email || '');
    }
  }, [open, modules, user?.email]);
  const send = useMutation({
    mutationFn: () => call(ws, 'POST', '/license/requests', { modules: selected, contact, comment: comment || null }),
    onSuccess: () => {
      toast(t('licensing.upgrade.sent'));
      void qc.invalidateQueries({ queryKey: requestsKey(ws) });
      onClose();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('licensing.upgrade.dialogTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t('licensing.upgrade.cancel')}</Button>
            <Button disabled={send.isPending || !selected.length || contact.trim().length < 3} onClick={() => send.mutate()}>{t('licensing.upgrade.send')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={t('licensing.upgrade.modules')}>
            {() => (
              <div className="stack" style={{ gap: 6 }}>
                {OFFER_MODULES.map(m => (
                  <label key={m.id} className="row" style={{ gap: 8 }}>
                    <Checkbox checked={selected.includes(m.id)} onChange={e => setSelected(s => (e.target.checked ? [...s, m.id] : s.filter(x => x !== m.id)))} />
                    {t(`licensing.modules.${m.id}.name` as const)}
                  </label>
                ))}
              </div>
            )}
          </Field>
          <Field label={t('licensing.upgrade.contact')} hint={t('licensing.upgrade.contactHint')}>{p => <Input {...p} maxLength={200} value={contact} onChange={e => setContact(e.target.value)} />}</Field>
          <Field label={t('licensing.upgrade.comment')}>{p => <Textarea {...p} rows={3} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UpgradePage() {
  const t = useT();
  const view = useLicense().data;
  const role = useSession().active?.role;
  const canRequest = role === 'owner' || role === 'admin';
  const requests = useMyRequests();
  const [picked, setPicked] = React.useState<ModuleId[]>([]);
  const [open, setOpen] = React.useState(false);
  const date = (iso: string) => fmtDateTimeIntl(iso, { dateStyle: 'medium' });
  const name = (id: ModuleId) => t(`licensing.modules.${id}.name` as const);

  const status = (id: ModuleId): { label: string; tone: 'green' | 'accent' | 'amber' | 'gray'; connected: boolean } => {
    const s = view?.states[id];
    if (!s || s.state === 'off') return { label: t('licensing.upgrade.status.off'), tone: 'gray', connected: false };
    if (s.state === 'readonly') return { label: t('licensing.upgrade.status.readonly', { date: date(s.readonlyUntil!) }), tone: 'amber', connected: false };
    if (s.expiresAt) return { label: t(view?.isTrial ? 'licensing.upgrade.status.trial' : 'licensing.upgrade.status.activeUntil', { date: date(s.expiresAt) }), tone: view?.isTrial ? 'accent' : 'green', connected: true };
    return { label: t('licensing.upgrade.status.active'), tone: 'green', connected: true };
  };

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <div className="ph">
        <div>
          <h1 className="row" style={{ gap: 10 }}>
            <Sparkles size={20} />
            {t('licensing.upgrade.title')}
          </h1>
          <p>{t('licensing.upgrade.lead')}</p>
        </div>
        <div className="acts">
          {picked.length > 0 && <span className="muted">{t('licensing.upgrade.selected', { n: picked.length })}</span>}
          <Button disabled={!canRequest} onClick={() => setOpen(true)}>
            {t('licensing.upgrade.requestButton')}
          </Button>
        </div>
      </div>
      {!canRequest && <Alert tone="info">{t('licensing.upgrade.onlyAdmins')}</Alert>}
      <div className="stack" style={{ gap: 12, marginTop: 12 }}>
        {OFFER_MODULES.map(m => {
          const st = status(m.id);
          const missing = m.requires.filter(r => r !== 'core');
          return (
            <div key={m.id} className="panel" style={{ padding: 16 }}>
              <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {!st.connected && canRequest && (
                  <Checkbox aria-label={name(m.id)} checked={picked.includes(m.id)} onChange={e => setPicked(p => (e.target.checked ? [...p, m.id] : p.filter(x => x !== m.id)))} />
                )}
                <h3 style={{ margin: 0 }}>{name(m.id)}</h3>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
              <p className="muted" style={{ margin: '6px 0' }}>{t(`licensing.modules.${m.id}.description` as const)}</p>
              <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>{t('licensing.upgrade.features')}</div>
              <ul className="stack" style={{ gap: 2, listStyle: 'none', padding: 0, margin: 0 }}>
                {(['a', 'b', 'c'] as const).map(k => (
                  <li key={k} className="row" style={{ gap: 6 }}>
                    <Check size={14} />
                    {t(`licensing.features.${m.id as Exclude<ModuleId, 'core'>}.${k}` as 'licensing.features.crm.a')}
                  </li>
                ))}
              </ul>
              {!st.connected && missing.length > 0 && <div className="faint" style={{ marginTop: 6 }}>{t('licensing.upgrade.status.requires', { modules: missing.map(name).join(', ') })}</div>}
            </div>
          );
        })}
      </div>
      <h2 style={{ marginTop: 24 }}>{t('licensing.upgrade.myRequests')}</h2>
      {requests.data && !requests.data.items.length && <div className="muted">{t('licensing.upgrade.noRequests')}</div>}
      <div className="stack" style={{ gap: 6 }}>
        {requests.data?.items.map(r => (
          <div key={r.id} className="mini" style={{ cursor: 'default', gap: 12, minHeight: 44 }}>
            <span className="grow">{r.modules.map(m => name(m as ModuleId)).join(', ')}</span>
            <span className="faint">{fmtDateTime(r.createdAt)}</span>
            <Badge tone={r.status === 'done' ? 'green' : r.status === 'rejected' ? 'red' : r.status === 'in_progress' ? 'accent' : 'neutral'}>{t(`licensing.upgrade.statuses.${r.status}` as const)}</Badge>
          </div>
        ))}
      </div>
      <RequestDialog open={open} modules={picked} onClose={() => setOpen(false)} />
    </div>
  );
}
