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
import { fmtDateTime } from '@/i18n';

/** Ключ месяца текущей даты: «2026-10» */
const currentMonth = () => new Date().toISOString().slice(0, 7);
const STATUS_TONE: Record<Closing['status'], 'green' | 'gray' | 'neutral' | 'amber'> = { done: 'green', running: 'amber', reopened: 'gray', failed: 'amber' };
const STATUS_LABEL: Record<Closing['status'], string> = { done: 'Closed', running: 'Running', reopened: 'Reopened', failed: 'Failed' };

export function MonthClosingPage() {
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

  const run = async (reopen: boolean, target: { month: string; through?: string }) => {
    const count = target.through && target.through > target.month ? monthRange(target.month, target.through).length : 1;
    try {
      await close.mutateAsync(target);
      toast(`${reopen ? 'Cancelling the closing of' : 'Closing'} ${count === 1 ? monthLabel(target.month) : `${count} months`}…`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Month closing</h1>
          <p>Indirect costs of the month (service receipts, write-offs to a work center and other costs) are allocated to the releases of the month, and the cost of everything that left the stock afterwards is recalculated.</p>
        </div>
      </div>

      <section className="panel" style={{ margin: '0 var(--gutter) 16px' }} aria-label="Closing parameters">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <Field label="Month">{p => <Input {...p} type="month" value={month} onChange={e => setMonth(e.target.value || currentMonth())} />}</Field>
          <Field label="Mode">
            {p => (
              <Select
                {...p}
                value={mode}
                onValueChange={v => setMode(v as 'month' | 'period')}
                options={[
                  { value: 'month', label: 'Single month' },
                  { value: 'period', label: 'For a period' },
                ]}
              />
            )}
          </Field>
          {mode === 'period' && (
            <Field label="Through" hint={months.length > 1 ? `${months.length} months, in order` : undefined}>
              {p => <Input {...p} type="month" value={through} min={month} onChange={e => setThrough(e.target.value)} />}
            </Field>
          )}
          <div className="row" style={{ gap: 8, marginLeft: 'auto' }}>
            <Button variant="primary" disabled={!isAdmin || close.isPending} onClick={() => void run(false, { month, through: mode === 'period' ? through : undefined })}>
              <CalendarCheck size={14} />
              Close {mode === 'period' && months.length > 1 ? `${months.length} months` : monthLabel(month)}
            </Button>
            <Button disabled={!isOwner || close.isPending || closing?.status !== 'done'} onClick={() => setConfirmReopen(closing!)}>
              <RotateCcw size={14} />
              Cancel closing
            </Button>
          </div>
        </div>
        {!isAdmin && <Alert tone="info" className="mt-3">Only admins can close a period. The owner can also cancel a closing.</Alert>}
        {lock && (
          <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>
            Documents up to {lock.closedThrough ?? 'no date'} can be edited{lock.closeMovesLock ? '; the date moves forward automatically when a month is closed' : ''}. The setting is in Settings → Production.
          </p>
        )}
      </section>

      {periods.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load the closings" action={<Button size="sm" onClick={() => periods.refetch()}>Retry</Button>}>
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

      <section className="panel" style={{ margin: '0 var(--gutter) 24px' }} aria-label="Closed months">
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>Closed months</h2>
        {!closings.length ? (
          <p className="faint" style={{ fontSize: 12 }}>No period has been closed yet.</p>
        ) : (
          <table className="dtbl" aria-label="Closed months">
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 150 }} className="r">
                  Indirect costs
                </th>
                <th style={{ width: 150 }} className="r">
                  Undistributed
                </th>
                <th style={{ width: 170 }}>Closed at</th>
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
                      {STATUS_LABEL[c.status]}
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
          title="Cancel the closing?"
          confirmLabel="Cancel closing"
          onOpenChange={open => !open && setConfirmReopen(null)}
          onConfirm={() => {
            const target = { month: confirmReopen.month };
            setConfirmReopen(null);
            void run(true, target);
          }}
          description={`The costs of ${confirmReopen.label} will return to their previous values: the allocations are dropped and the stock movements are recalculated back. Only the owner can cancel a closing.`}
        />
      )}
    </div>
  );
}

/* ---------------- предварительный анализ ---------------- */

function PreviewPanel({ month }: { month: string }) {
  const preview = usePeriodPreview(month);
  return (
    <section className="panel" style={{ flex: 1, minWidth: 0 }} aria-label="Preview">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>Before closing {monthLabel(month)}</h2>
        <span className="faint" style={{ fontSize: 12 }}>
          Total: {preview.data?.total ?? '—'}
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
                          {l.number ?? 'Draft'} · {l.date}
                        </Link>
                      </div>
                    ) : (
                      <div key={j} style={{ fontSize: 12 }}>
                        {l.name} — {l.qty}
                      </div>
                    ),
                  )}
                  {issue.links.length > 6 && <div className="faint" style={{ fontSize: 12 }}>…and {issue.links.length - 6} more</div>}
                </Alert>
              ))}
            </div>
          )}
          <table className="dtbl" aria-label="Indirect costs of the month">
            <thead>
              <tr>
                <th>Cost item</th>
                <th style={{ width: 150 }}>Work center</th>
                <th style={{ width: 150 }}>Allocation base</th>
                <th style={{ width: 110 }} className="r">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {preview.data.costs.map((c, i) => (
                <tr key={`${c.costItemId}-${i}`}>
                  <td className="trunc">{c.name}</td>
                  <td className="trunc muted">{c.workCenterName ?? '—'}</td>
                  <td className="muted">{c.method === 'none' ? 'Do not allocate' : c.method === 'output_qty' ? 'By output quantity' : c.method === 'direct_costs' ? 'By direct costs' : 'By work hours'}</td>
                  <td className="r num">{c.amount ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
              {!preview.data.costs.length && (
                <tr>
                  <td colSpan={4} className="faint">
                    No indirect costs this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {preview.data.targets.length > 0 && (
            <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
              {preview.data.targets.length} release position(s) will receive the indirect costs.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ---------------- результат закрытия ---------------- */

function ResultPanel({ closing }: { closing: Closing | null }) {
  if (!closing) return null;
  const t = closing.totals;
  return (
    <section className="panel" style={{ flex: 1, minWidth: 0 }} aria-label="Closing result">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>
          <Lock size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
          Result of {closing.label}
        </h2>
        <Badge tone={STATUS_TONE[closing.status]} dot>
          {STATUS_LABEL[closing.status]}
        </Badge>
      </div>
      {closing.error && <Alert tone="warn">{closing.error}</Alert>}
      {t.warnings?.map((w, i) => (
        <Alert key={i} tone="info" className="mb-2">
          {w}
        </Alert>
      ))}
      {!!t.byCostItem?.length && (
        <>
          <h3 style={{ fontSize: 12, margin: '8px 0 4px' }}>By cost item</h3>
          <table className="dtbl" aria-label="Allocation by cost item">
            <thead>
              <tr>
                <th>Cost item</th>
                <th style={{ width: 120 }}>Work center</th>
                <th style={{ width: 100 }} className="r">
                  Amount
                </th>
                <th style={{ width: 110 }} className="r">
                  Allocated
                </th>
              </tr>
            </thead>
            <tbody>
              {t.byCostItem.map((g, i) => (
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
      {!!t.byRelease?.length && (
        <>
          <h3 style={{ fontSize: 12, margin: '10px 0 4px' }}>By release</h3>
          <table className="dtbl" aria-label="Allocation by release">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ width: 90 }} className="r">
                  Qty
                </th>
                <th style={{ width: 100 }} className="r">
                  Direct
                </th>
                <th style={{ width: 100 }} className="r">
                  Allocated
                </th>
              </tr>
            </thead>
            <tbody>
              {t.byRelease.map((r, i) => (
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
        Undistributed: <b>{t.undistributed ?? '—'}</b> · stock movements recalculated: {t.adjustedMoves ?? 0}
      </p>
    </section>
  );
}