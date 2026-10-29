/* Settings → Оператор → Заявки на модули (задача 1208): заявки арендаторов из «Нужно больше?», статус обработки и заметка.
   Только для оператора установки, API проверяет флаг сам. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { REQUEST_STATUSES, type ModuleId, type OperatorModuleRequest, type RequestStatus } from '@gr8r/shared';
import { Alert, Badge, Button, EmptyState, Input, Select, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDateTime } from '@/i18n/format';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { SettingsHead } from './parts';

const requestsKey = (status: string) => ['admin', 'requests', status] as const;

function RequestCard({ r, onSaved }: { r: OperatorModuleRequest; onSaved: () => void }) {
  const t = useT();
  const ws = useWsId();
  const [status, setStatus] = React.useState<RequestStatus>(r.status);
  const [note, setNote] = React.useState(r.note ?? '');
  const [busy, setBusy] = React.useState(false);
  const dirty = status !== r.status || note !== (r.note ?? '');
  const save = async () => {
    setBusy(true);
    try {
      await call(ws, 'PUT', `/admin/requests/${r.id}`, { status, note: note || null });
      toast(t('licensing.requests.saved'));
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>{r.workspaceName}</b>
        <span className="muted">{r.workspaceSlug}</span>
        <span className="faint">{fmtDateTime(r.createdAt)}</span>
        <Badge tone={r.hookSentAt ? 'green' : 'gray'}>{r.hookSentAt ? t('licensing.requests.hookSent') : t('licensing.requests.hookPending')}</Badge>
      </div>
      <div style={{ margin: '6px 0' }}>{r.modules.map(m => t(`licensing.modules.${m as ModuleId}.name` as const)).join(', ')}</div>
      <div className="muted">
        {t('licensing.requests.contact')}: {r.contact}
        {r.requestedBy ? ` · ${r.requestedBy}` : ''}
      </div>
      {r.comment && <div className="muted">{t('licensing.requests.comment')}: {r.comment}</div>}
      <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select value={status} onValueChange={v => setStatus(v as RequestStatus)} options={REQUEST_STATUSES.map(s => ({ value: s, label: t(`licensing.upgrade.statuses.${s}` as const) }))} />
        <Input style={{ minWidth: 220, flex: 1 }} maxLength={2000} placeholder={t('licensing.requests.notePlaceholder')} aria-label={t('licensing.requests.note')} value={note} onChange={e => setNote(e.target.value)} />
        <Button size="sm" disabled={!dirty || busy} onClick={save}>{t('licensing.requests.save')}</Button>
      </div>
      {r.handledAt && <div className="faint" style={{ marginTop: 4 }}>{t('licensing.requests.handled', { date: fmtDateTime(r.handledAt), who: r.handledByEmail ?? '' })}</div>}
    </div>
  );
}

export function RequestsSection({ title }: { title: string }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState('');
  const key = requestsKey(filter);
  const list = useQuery({ queryKey: key, queryFn: () => call<{ items: OperatorModuleRequest[] }>(ws, 'GET', `/admin/requests${filter ? `?status=${filter}` : ''}`) });
  const items = list.data?.items ?? [];
  return (
    <>
      <SettingsHead title={title} lead={t('licensing.requests.lead')} />
      <div className="sblock">
        <Select value={filter} onValueChange={setFilter} options={[{ value: '', label: t('licensing.requests.all') }, ...REQUEST_STATUSES.map(s => ({ value: s, label: t(`licensing.upgrade.statuses.${s}` as const) }))]} />
      </div>
      <div className="sblock">
        {list.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : list.isError ? (
          <Alert tone="danger">{errorMessage(list.error)}</Alert>
        ) : !items.length ? (
          <EmptyState icon={<Inbox size={20} />} title={t('licensing.requests.empty')} />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {items.map(r => (
              <RequestCard key={`${r.id}:${r.status}:${r.note ?? ''}`} r={r} onSaved={() => void qc.invalidateQueries({ queryKey: ['admin', 'requests'] })} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
