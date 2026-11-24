/* Исходящие вебхуки в Settings → Integrations (задача 1392): CRUD, чекбоксы событий, секрет, журнал доставок. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, Plus, Webhook } from 'lucide-react';
import { WEBHOOK_EVENTS } from '@erp/shared';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, Input, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { SRow } from './parts';
import { WebhookDeliveriesLog } from './webhook-deliveries';

interface WebhookItem {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function WebhooksSettings() {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const queryKey = ['ws', ws, 'webhooks'] as const;
  const list = useQuery({ queryKey, staleTime: Infinity, queryFn: () => call<{ items: WebhookItem[] }>(ws, 'GET', '/webhooks') });

  const [editing, setEditing] = React.useState<WebhookItem | 'new' | null>(null);
  const [url, setUrl] = React.useState('');
  const [events, setEvents] = React.useState<string[]>(['document.posted']);
  const [enabled, setEnabled] = React.useState(true);
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const [openLog, setOpenLog] = React.useState<string | null>(null);
  const [del, setDel] = React.useState<WebhookItem | null>(null);

  const openNew = () => { setEditing('new'); setUrl(''); setEvents(['document.posted']); setEnabled(true); };
  const openEdit = (w: WebhookItem) => { setEditing(w); setUrl(w.url); setEvents(w.events); setEnabled(w.enabled); };
  const close = () => setEditing(null);

  const toggleEvent = (ev: string) => setEvents(prev => (prev.includes(ev) ? prev.filter(x => x !== ev) : [...prev, ev]));

  const run = async (method: string, path: string, body?: unknown) => {
    try {
      await call(ws, method, path, body);
      void qc.invalidateQueries({ queryKey });
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  };

  const save = async () => {
    const ok =
      editing === 'new'
        ? await run('POST', '/webhooks', { url: url.trim(), events, enabled })
        : editing
          ? await run('PATCH', `/webhooks/${editing.id}`, { url: url.trim(), events, enabled })
          : false;
    if (ok) { toast(t('secrets.webhooks.saved')); close(); }
  };

  const copySecret = async (secret: string) => {
    await navigator.clipboard.writeText(secret);
    toast(t('secrets.webhooks.copied'));
  };

  const items = list.data?.items ?? [];

  const form = (
    <div className="srow" style={{ display: 'block' }}>
      <div className="stack" style={{ gap: 10 }}>
        <Field label={t('secrets.webhooks.url')}>
          {p => <Input {...p} value={url} placeholder={t('secrets.webhooks.urlPlaceholder')} onChange={e => setUrl(e.target.value)} />}
        </Field>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{t('secrets.webhooks.events')}</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {WEBHOOK_EVENTS.map(ev => (
              <label key={ev} className="row" style={{ gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <Checkbox checked={events.includes(ev)} onChange={() => toggleEvent(ev)} />
                <code>{ev}</code>
              </label>
            ))}
          </div>
        </div>
        <label className="row" style={{ gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <Checkbox checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span>{t('secrets.webhooks.enabled')}</span>
        </label>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" disabled={!url.trim() || !events.length} onClick={() => void save()}>
            {editing === 'new' ? t('secrets.webhooks.create') : t('secrets.webhooks.save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={close}>{t('secrets.webhooks.cancel')}</Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="sblock">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>{t('secrets.webhooks.title')}</h2>
        <Button size="sm" variant="ghost" onClick={openNew}>
          <Plus size={13} />
          {t('secrets.webhooks.add')}
        </Button>
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 10, fontSize: 13 }}>{t('secrets.webhooks.lead')}</p>
      {list.isPending ? (
        <Skeleton w="100%" h={60} />
      ) : !items.length && editing !== 'new' ? (
        <EmptyState icon={<Webhook size={20} />} title={t('secrets.webhooks.empty')}>{t('secrets.webhooks.emptyHint')}</EmptyState>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {editing === 'new' && form}
          {items.map(w => (
            <div key={w.id} className="srow" style={{ display: 'block' }}>
              <SRow
                t={<><code>{w.url}</code> <Badge tone={w.enabled ? 'green' : 'neutral'}>{w.enabled ? t('secrets.webhooks.enabled') : t('secrets.webhooks.disabled')}</Badge></>}
                d={w.events.join(', ')}
              >
                <Button size="sm" variant="ghost" onClick={() => setOpenLog(openLog === w.id ? null : w.id)}>
                  {openLog === w.id ? t('secrets.webhooks.hideDeliveries') : t('secrets.webhooks.deliveries')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openEdit(w)}>{t('secrets.webhooks.edit')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setDel(w)}>{t('secrets.webhooks.delete')}</Button>
              </SRow>
              <div className="row" style={{ gap: 8, marginTop: 6, fontSize: 12, flexWrap: 'wrap' }}>
                <span className="muted">{t('secrets.webhooks.secret')}:</span>
                <code>{revealed[w.id] ? w.secret : '••••••••••••••••••••'}</code>
                <Button size="sm" variant="ghost" onClick={() => setRevealed(r => ({ ...r, [w.id]: !r[w.id] }))}>
                  {revealed[w.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                  {revealed[w.id] ? t('secrets.webhooks.hide') : t('secrets.webhooks.reveal')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void copySecret(w.secret)}>
                  <Copy size={12} />
                  {t('secrets.webhooks.copy')}
                </Button>
                <Button size="sm" variant="ghost" onClick={async () => { if (await run('PATCH', `/webhooks/${w.id}`, { rotateSecret: true })) toast(t('secrets.webhooks.saved')); }}>
                  {t('secrets.webhooks.rotateSecret')}
                </Button>
              </div>
              {editing !== 'new' && editing?.id === w.id && <div style={{ marginTop: 10 }}>{form}</div>}
              {openLog === w.id && <WebhookDeliveriesLog webhookId={w.id} />}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('secrets.webhooks.delete')}
        description={del ? t('secrets.webhooks.confirmDelete', { url: del.url }) : ''}
        confirmLabel={t('secrets.webhooks.delete')}
        cancelLabel={t('secrets.webhooks.cancel')}
        danger
        onConfirm={async () => {
          if (del && (await run('DELETE', `/webhooks/${del.id}`))) toast(t('secrets.webhooks.deleted'));
          setDel(null);
        }}
      />
    </div>
  );
}
