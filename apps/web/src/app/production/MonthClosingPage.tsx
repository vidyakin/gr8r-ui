/* Закрытие месяца (этап 6 «УНФ: Производство»): выбор месяца или периода, предварительный анализ, запуск закрытия,
   результат распределения косвенных затрат по статьям, участкам и выпускам с предупреждениями, отмена закрытия.
   Закрывает admin и выше, отменяет только владелец. Суммы видят admin и owner — остальным сервер их не отдаёт. */
import * as React from 'react';
import { Link } from 'react-router';
import { CalendarCheck, CircleAlert, Lock, RotateCcw } from 'lucide-react';
import { monthLabel, monthRange } from '@gr8r/shared';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { useIsAdmin } from '../catalog/data';
import { errorMessage } from '../data/api';
import { useSession } from '../data/session';
import { usePeriodPreview, usePeriods, useClosePeriod, type Closing } from './closing-data';
import { fmtDateTime, useT } from '@/i18n';

/** Ключ месяца текущей даты: «2026-10» */
const currentMonth = () => new Date().toISOString().slice(0, 7);
const STATUS_TONE: Record<Closing['status'], 'green' | 'gray' | 'neutral' | 'amber'> = { done: 'green', running: 'amber', reopened: 'gray', failed: 'amber' };

export function MonthClosingPage() {
  const tt = useT();
  const isAdmin = useIsAdmin();
  const { active } = useSession();
  const isOwner = active?.role === 'owner';
  const periods = usePeriods();
  const [month, setMonth] = React.useState(currentMonth());
  const [through, setThrough] = React.useState('');
  const [mode, setMode] = React.useState<'month' | 'period'>('month');
  const close = useClosePeriod();
  const [confirmReopen, setConfirmReopen] = React.useState<Closing | null>(null);

  const months = mode === 'period' && through > month ? monthRange(month, through) : [month];
  const closing = (periods.data?.items ?? []).find(c => c.month === month);
  const lock = periods.data;
  const closings = periods.data?.items ?? [];

  const statusLabel = (s: Closing['status']) => tt(`production.closing.status.${s}`);

  const run = async (reopen: boolean, target: { month: string; through?: string }) => {
    const count = target.through && target.through > target.month ? monthRange(target.month, target.through).length : 1;
    try {
      await close.mutateAsync(target);
      if (reopen) {
        toast(tt('production.closing.toast.reopening', { count, label: count === 1 ? monthLabel(target.month) : tt('production.closing.monthsCount', { count }) }));
      } else {
        toast(tt('production.closing.toast.closing', { count, label: count === 1 ? monthLabel(target.month) : tt('production.closing.monthsCount', { count }) }));
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('production.closing.title')}</h1>
          <p>{tt('production.closing.subtitle')}</p>
        </div>
      </div>

      <section className="panel" style={{ margin: '0 var(--gutter) 16px' }} aria-label={tt('production.closing.paramsAria')}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <Field label={tt('production.closing.month')}>{p => <Input {...p} type="month" value={month} onChange={e => setMonth(e.target.value || currentMonth())} />}</Field>
          <Field label={tt('production.closing.mode')}>
            {p => (
              <Select
                {...p}
                value={mode}
                onValueChange={v => setMode(v as 'month' | 'period')}
                options={[
                  { value: 'month', label: tt('production.closing.modeMonth') },
                  { value: 'period', label: tt('production.closing.modePeriod') },
                ]}
              />
            )}
          </Field>
          {mode === 'period' && (
            <Field label={tt('production.closing.through')} hint={months.length > 1 ? tt('production.closing.monthsHint', { count: months.length }) : undefined}>
              {p => <Input {...p} type="month" value={through} min={month} onChange={e => setThrough(e.target.value)} />}
            </Field>
          )}
          <div className="row" style={{ gap: 8, marginLeft: 'auto' }}>
            <Button variant="primary" disabled={!isAdmin || close.isPending} onClick={() => void run(false, { month, through: mode === 'period' ? through : undefined })}>
              <CalendarCheck size={14} />
              {tt('production.closing.runButton', { label: mode === 'period' && months.length > 1 ? tt('production.closing.monthsCount', { count: months.length }) : monthLabel(month) })}
            </Button>
            <Button disabled={!isOwner || close.isPending || closing?.status !== 'done'} onClick={() => setConfirmReopen(closing!)}>
              <RotateCcw size={14} />
              {tt('production.closing.reopenButton')}
            </Button>
          </div>
        </div>
        {!isAdmin && <Alert tone="info" className="mt-3">{tt('production.closing.adminOnly')}</Alert>}
        {lock && (
          <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>
            {tt('production.closing.lockHint', { date: lock.closedThrough ?? tt('production.closing.noDate'), moves: lock.closeMovesLock ? tt('production.closing.lockMovesOn') : '' })}
          </p>
        )}
      </section>

      {periods.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('production.closing.loadFailed')} action={<Button size="sm" onClick={() => periods.refetch()}>{tt('production.common.retry')}</Button>}>
          {(periods.error as Error).message}
        </EmptyState>
      ) : periods.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={120} />
        </div>
      ) : (
        <div className="row" style={{ gap: 16, padding: '0 var(--gutter) 24px', alignItems: 'flex-start' }}>
          <PreviewPanel month={month} />
          <ResultPanel closing={closing ?? null} />
        </div>
      )}

      <section className="panel" style={{ margin: '0 var(--gutter) 24px' }} aria-label={tt('production.closing.historyAria')}>
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>{tt('production.closing.historyTitle')}</h2>
        {!closings.length ? (
          <p className="faint" style={{ fontSize: 12 }}>{tt('production.closing.emptyHistory')}</p>
        ) : (
          <table className="dtbl" aria-label={tt('production.closing.historyTable')}>
            <thead>
              <tr>
                <th>{tt('production.closing.col.month')}</th>
                <th style={{ width: 120 }}>{tt('production.closing.col.status')}</th>
                <th style={{ width: 150 }} className="r">
                  {tt('production.closing.col.indirect')}
                </th>
                <th style={{ width: 150 }} className="r">
                  {tt('production.closing.col.undistributed')}
                </th>
                <th style={{ width: 170 }}>{tt('production.closing.col.closedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {closings.map(c => (
                <tr key={c.id}>
                  <td>
                    <button type="button" className="crm-link" onClick={() => setMonth(c.month)}>
                      {c.label}
                    </button>
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[c.status]} dot>
                      {statusLabel(c.status)}
                    </Badge>
                  </td>
                  <td className="r num">{c.totals.total ?? <span className="muted">—</span>}</td>
                  <td className="r num">{c.totals.undistributed ?? <span className="muted">—</span>}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {fmtDateTime(c.runAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {confirmReopen && (
        <ConfirmDialog
          open
          danger
          title={tt('production.closing.reopenTitle')}
          confirmLabel={tt('production.closing.reopenButton')}
          onOpenChange={open => !open && setConfirmReopen(null)}
          onConfirm={() => {
            const target = { month: confirmReopen.month };
            setConfirmReopen(null);
            void run(true, target);
          }}
          description={tt('production.closing.reopenDesc', { label: confirmReopen.label })}
        />
      )}
    </div>
  );
}

/* ---------------- предварительный анализ ---------------- */

function PreviewPanel({ month }: { month: string }) {
  const tt = useT();
  const preview = usePeriodPreview(month);
  return (
    <section className="panel" style={{ flex: 1, minWidth: 0 }} aria-label={tt('production.closing.previewAria')}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>{tt('production.closing.previewTitle', { label: monthLabel(month) })}</h2>
        <span className="faint" style={{ fontSize: 12 }}>
          {tt('production.closing.totalLabel')}: {preview.data?.total ?? '—'}
        </span>
      </div>
      {preview.isPending ? (
        <Skeleton w="100%" h={100} />
      ) : !preview.data ? null : (
        <>
          {preview.data.issues.length > 0 && (
            <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
              {preview.data.issues.map((issue, i) => (
                <Alert key={i} tone={issue.kind === 'no_release' ? 'info' : 'warn'}>
                  <div>{issue.message}</div>
                  {issue.links.slice(0, 6).map((l, j) =>
                    l.documentId ? (
                      <div key={j} style={{ fontSize: 12 }}>
                        <Link to={`/documents/${l.documentId}`} className="crm-link">
                          {l.number ?? tt('production.common.draft')} · {l.date}
                        </Link>
                      </div>
                    ) : (
                      <div key={j} style={{ fontSize: 12 }}>
                        {l.name} — {l.qty}
                      </div>
                    ),
                  )}
                  {issue.links.length > 6 && <div className="faint" style={{ fontSize: 12 }}>{tt('production.closing.moreCount', { count: issue.links.length - 6 })}</div>}
                </Alert>
              ))}
            </div>
          )}
          <table className="dtbl" aria-label={tt('production.closing.previewTable')}>
            <thead>
              <tr>
                <th>{tt('production.closing.col.costItem')}</th>
                <th style={{ width: 150 }}>{tt('production.closing.col.workCenter')}</th>
                <th style={{ width: 150 }}>{tt('production.closing.col.base')}</th>
                <th style={{ width: 110 }} className="r">
                  {tt('production.closing.col.amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {preview.data.costs.map((c, i) => (
                <tr key={`${c.costItemId}-${i}`}>
                  <td className="trunc">{c.name}</td>
                  <td className="trunc muted">{c.workCenterName ?? '—'}</td>
                  <td className="muted">{c.method === 'none' ? tt('production.closing.method.none') : c.method === 'output_qty' ? tt('production.closing.method.outputQty') : c.method === 'direct_costs' ? tt('production.closing.method.directCosts') : tt('production.closing.method.workHours')}</td>
                  <td className="r num">{c.amount ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
              {!preview.data.costs.length && (
                <tr>
                  <td colSpan={4} className="faint">
                    {tt('production.closing.noCosts')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {preview.data.targets.length > 0 && (
            <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
              {tt('production.closing.targetsHint', { count: preview.data.targets.length })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ---------------- результат закрытия ---------------- */

function ResultPanel({ closing }: { closing: Closing | null }) {
  const tt = useT();
  const statusLabel = (s: Closing['status']) => tt(`production.closing.status.${s}`);
  if (!closing) return null;
  const t0 = closing.totals;
  return (
    <section className="panel" style={{ flex: 1, minWidth: 0 }} aria-label={tt('production.closing.resultAria')}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>
          <Lock size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
          {tt('production.closing.resultTitle', { label: closing.label })}
        </h2>
        <Badge tone={STATUS_TONE[closing.status]} dot>
          {statusLabel(closing.status)}
        </Badge>
      </div>
      {closing.error && <Alert tone="warn">{closing.error}</Alert>}
      {t0.warnings?.map((w, i) => (
        <Alert key={i} tone="info" className="mb-2">
          {w}
        </Alert>
      ))}
      {!!t0.byCostItem?.length && (
        <>
          <h3 style={{ fontSize: 12, margin: '8px 0 4px' }}>{tt('production.closing.byCostItem')}</h3>
          <table className="dtbl" aria-label={tt('production.closing.byCostItemTable')}>
            <thead>
              <tr>
                <th>{tt('production.closing.col.costItem')}</th>
                <th style={{ width: 120 }}>{tt('production.closing.col.workCenter')}</th>
                <th style={{ width: 100 }} className="r">
                  {tt('production.closing.col.amount')}
                </th>
                <th style={{ width: 110 }} className="r">
                  {tt('production.closing.col.allocated')}
                </th>
              </tr>
            </thead>
            <tbody>
              {t0.byCostItem.map((g, i) => (
                <tr key={i}>
                  <td className="trunc">{g.costItemName}</td>
                  <td className="trunc muted">{g.workCenterName ?? '—'}</td>
                  <td className="r num">{g.amount ?? '—'}</td>
                  <td className="r num">{g.distributed ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {!!t0.byRelease?.length && (
        <>
          <h3 style={{ fontSize: 12, margin: '10px 0 4px' }}>{tt('production.closing.byRelease')}</h3>
          <table className="dtbl" aria-label={tt('production.closing.byReleaseTable')}>
            <thead>
              <tr>
                <th>{tt('production.closing.col.product')}</th>
                <th style={{ width: 90 }} className="r">
                  {tt('production.closing.col.qty')}
                </th>
                <th style={{ width: 100 }} className="r">
                  {tt('production.closing.col.direct')}
                </th>
                <th style={{ width: 100 }} className="r">
                  {tt('production.closing.col.allocated')}
                </th>
              </tr>
            </thead>
            <tbody>
              {t0.byRelease.map((r, i) => (
                <tr key={r.itemId + i}>
                  <td className="trunc">{r.name}</td>
                  <td className="r num">{r.qty}</td>
                  <td className="r num">{r.directCost ?? '—'}</td>
                  <td className="r num">{r.allocated ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
        {tt('production.closing.resultFootnote', { undistributed: t0.undistributed ?? '—', adjusted: t0.adjustedMoves ?? 0 })}
      </p>
    </section>
  );
}
