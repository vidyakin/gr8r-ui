/* Контроль качества партии (задача 1186): статус входного контроля и анализы партии в диалоге. */
import * as React from 'react';
import { FlaskConical, Trash2 } from 'lucide-react';
import { BATCH_STATUSES, type BatchStatus } from '@gr8r/shared';
import { Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, Field, IconButton, Input, Skeleton, toast, type Tone } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDate, parse } from '../lib/dates';
import { useBatchAnalyses, useBatchQualityApi, useCanEditBatches } from './data';

const STATUS_TONE: Record<BatchStatus, Tone> = { ok: 'green', quarantine: 'amber', rejected: 'red' };

/** Бейдж статуса партии */
export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const t = useT();
  return <Badge tone={STATUS_TONE[status]} dot>{t(`batches.status.${status}`)}</Badge>;
}

/** Диалог «Анализы партии»: смена статуса (member+), список, добавление и удаление анализов */
export function BatchQualityDialog({ batch, onClose }: { batch: { batchId: string; number: string; productName: string; status: BatchStatus }; onClose: () => void }) {
  const t = useT();
  const api = useBatchQualityApi();
  const canEdit = useCanEditBatches();
  const list = useBatchAnalyses(batch.batchId);
  const [status, setStatus] = React.useState<BatchStatus>(batch.status);
  const [indicator, setIndicator] = React.useState('');
  const [result, setResult] = React.useState('');
  const [norm, setNorm] = React.useState('');
  const [passed, setPassed] = React.useState<'' | 'yes' | 'no'>('');
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setStatus(batch.status), [batch.status]);

  const changeStatus = async (next: BatchStatus) => {
    const prev = status;
    setStatus(next);
    if (await api('PATCH', `/stock/batches/${batch.batchId}/status`, { status: next })) toast(t('batches.quality.statusChanged'));
    else setStatus(prev);
  };
  const add = async () => {
    if (!indicator.trim()) return setErr(t('batches.quality.enterIndicator'));
    setErr('');
    setBusy(true);
    const r = await api('POST', `/stock/batches/${batch.batchId}/analyses`, {
      indicator: indicator.trim(), result: result.trim(), norm: norm.trim(), passed: passed === '' ? null : passed === 'yes', analyzedAt: date,
    });
    setBusy(false);
    if (!r) return;
    toast(t('batches.quality.added'));
    setIndicator('');
    setResult('');
    setNorm('');
    setPassed('');
  };
  const rows = list.data?.items ?? [];
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title={t('batches.quality.title')}
        description={`${t('batches.quality.lead')} ${batch.number} — ${batch.productName}`}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('batches.quality.close')}</Button>
            </DialogClose>
          </>
        }
      >
        <Field label={t('batches.quality.statusLabel')}>
          {p => (
            <select className="select" id={p.id} value={status} disabled={!canEdit} onChange={e => void changeStatus(e.target.value as BatchStatus)}>
              {BATCH_STATUSES.map(s => (
                <option key={s} value={s}>
                  {t(`batches.status.${s}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {list.isPending ? (
          <Skeleton w="100%" h={36} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<FlaskConical size={20} />} size="sm" title={t('batches.quality.empty')} />
        ) : (
          <table className="dt" aria-label={t('batches.quality.title')}>
            <thead>
              <tr>
                <th>{t('batches.quality.indicator')}</th>
                <th>{t('batches.quality.result')}</th>
                <th>{t('batches.quality.norm')}</th>
                <th>{t('batches.quality.passed')}</th>
                <th>{t('batches.quality.date')}</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id}>
                  <td>{a.indicator}</td>
                  <td>{a.result || <span className="faint">—</span>}</td>
                  <td className="muted">{a.norm || <span className="faint">—</span>}</td>
                  <td>{a.passed === null ? <span className="faint">{t('batches.quality.unknown')}</span> : <Badge tone={a.passed ? 'green' : 'red'}>{a.passed ? t('batches.quality.yes') : t('batches.quality.no')}</Badge>}</td>
                  <td className="num muted">{fmtDate(parse(a.analyzedAt))}</td>
                  {canEdit && (
                    <td>
                      <IconButton
                        label={t('batches.quality.delete')}
                        onClick={async () => {
                          if (await api('DELETE', `/stock/batches/${batch.batchId}/analyses/${a.id}`)) toast(t('batches.quality.removed'));
                        }}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <form
            className="contents"
            noValidate
            onSubmit={e => {
              e.preventDefault();
              void add();
            }}
          >
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <Field label={t('batches.quality.indicator')} className="grow" error={err}>
                {p => <Input {...p} value={indicator} onChange={e => (setIndicator(e.target.value), setErr(''))} />}
              </Field>
              <Field label={t('batches.quality.result')} className="grow">
                {p => <Input {...p} value={result} onChange={e => setResult(e.target.value)} />}
              </Field>
              <Field label={t('batches.quality.norm')} className="grow">
                {p => <Input {...p} value={norm} onChange={e => setNorm(e.target.value)} />}
              </Field>
            </div>
            <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
              <Field label={t('batches.quality.passed')} className="grow">
                {p => (
                  <select className="select" id={p.id} value={passed} onChange={e => setPassed(e.target.value as '' | 'yes' | 'no')}>
                    <option value="">{t('batches.quality.unknown')}</option>
                    <option value="yes">{t('batches.quality.yes')}</option>
                    <option value="no">{t('batches.quality.no')}</option>
                  </select>
                )}
              </Field>
              <Field label={t('batches.quality.date')} className="grow">
                {p => <Input {...p} type="date" value={date} onChange={e => setDate(e.target.value)} />}
              </Field>
              <Button variant="primary" type="submit" disabled={busy}>
                {t('batches.quality.add')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
