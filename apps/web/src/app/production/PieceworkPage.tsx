/* Сдельные наряды: журнал нарядов исполнителей, отчёт выработки за период и расценки операций.
   Один наряд — один исполнитель за день; мастер проверяет и проводит наряд, сумма идёт в себестоимость выпуска. */
import * as React from 'react';
import { CircleAlert, ClipboardList, Plus, Receipt } from 'lucide-react';
import { Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { useCanWrite } from '../meta/custom-fields';
import { STATUS_LABEL, STATUS_TONE } from '../docs/data';
import { useOperations, useOperationRates, usePieceworkApi, usePieceworkOrders, usePieceworkReport, type OperationRow } from './piecework-data';

const TABS = [
  { id: 'orders', name: 'Piecework orders' },
  { id: 'output', name: 'Output' },
  { id: 'rates', name: 'Rates' },
] as const;

export function PieceworkPage() {
  const [tab, setTab] = React.useState<(typeof TABS)[number]['id']>('orders');
  const canWrite = useCanWrite();

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Piecework</h1>
          <p>
            A piecework order records the operations an executor has done during a day. The master checks and posts it — the amount becomes the actual cost of the work in the cost of the released goods.
          </p>
        </div>
      </div>
      <nav className="tabs doc-tabs" aria-label="Piecework sections">
        {TABS.map(t => (
          <button key={t.id} type="button" className={`tab${tab === t.id ? ' on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {t.name}
          </button>
        ))}
      </nav>
      {tab === 'orders' && <OrdersTab canWrite={canWrite} />}
      {tab === 'output' && <OutputTab />}
      {tab === 'rates' && <RatesTab canWrite={canWrite} />}
    </div>
  );
}

/* ---------------- журнал нарядов ---------------- */

function OrdersTab({ canWrite }: { canWrite: boolean }) {
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const list = usePieceworkOrders({ from: from || undefined, to: to || undefined });
  const rows = list.data?.items ?? [];

  return (
    <>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px' }}>
        <Field label="From">{p => <Input {...p} type="date" value={from} onChange={e => setFrom(e.target.value)} />}</Field>
        <Field label="To">{p => <Input {...p} type="date" value={to} onChange={e => setTo(e.target.value)} />}</Field>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load the piecework orders" action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<ClipboardList size={20} />} title="No piecework orders yet">
          An executor marks the work as done in their task, and the master checks the order of the day and posts it.
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label="Piecework orders">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Number</th>
                <th style={{ width: 112 }}>Date</th>
                <th>Executor</th>
                <th style={{ width: 90 }} className="r">
                  Operations
                </th>
                <th style={{ width: 110 }} className="r">
                  Amount
                </th>
                <th style={{ width: 112 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="mono">{r.number ?? <span className="faint">Draft</span>}</td>
                  <td className="num muted">{r.date}</td>
                  <td className="trunc">{r.memberName}</td>
                  <td className="r num">{r.lineCount}</td>
                  <td className="r num">{r.amount ?? <span className="faint">—</span>}</td>
                  <td>
                    <Badge tone={STATUS_TONE[r.status]} dot>
                      {STATUS_LABEL[r.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canWrite && <p className="faint" style={{ padding: '0 var(--gutter) 24px' }}>Only managers post the piecework orders.</p>}
    </>
  );
}

/* ---------------- отчёт выработки ---------------- */

function OutputTab() {
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const report = usePieceworkReport({ from: from || undefined, to: to || undefined });
  const rows = report.data?.items ?? [];

  return (
    <>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px' }}>
        <Field label="From">{p => <Input {...p} type="date" value={from} onChange={e => setFrom(e.target.value)} />}</Field>
        <Field label="To">{p => <Input {...p} type="date" value={to} onChange={e => setTo(e.target.value)} />}</Field>
      </div>
      {report.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<Receipt size={20} />} title="No output for this period">
          The report shows what each executor has done and how much it is worth.
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label="Output by executor">
            <thead>
              <tr>
                <th>Executor</th>
                <th>Operation</th>
                <th style={{ width: 100 }} className="r">
                  Qty
                </th>
                <th style={{ width: 100 }} className="r">
                  Hours
                </th>
                <th style={{ width: 120 }} className="r">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.memberId}:${r.operationId}:${i}`}>
                  <td className="trunc">{r.memberName}</td>
                  <td className="trunc">{r.operationName}</td>
                  <td className="r num">{r.qty}</td>
                  <td className="r num">{r.hours}</td>
                  <td className="r num">{r.amount ?? <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------- расценки операций ---------------- */

function RatesTab({ canWrite }: { canWrite: boolean }) {
  const operations = useOperations();
  const rates = useOperationRates();
  const api = usePieceworkApi();
  const [dialog, setDialog] = React.useState<OperationRow | null>(null);
  const items = operations.data?.items ?? [];
  const allRates = rates.data?.items ?? [];

  return (
    <div style={{ display: 'grid', gap: 12, padding: '0 var(--gutter) 24px' }}>
      {operations.isPending ? (
        <Skeleton w="100%" h={36} />
      ) : !items.length ? (
        <EmptyState icon={<Receipt size={20} />} title="No operations in the catalogue yet">
          An operation is a product of the “Operation” kind: it carries the norm of time and the rate of the work.
        </EmptyState>
      ) : (
        items.map(op => (
          <section key={op.productId} className="panel" style={{ padding: 14 }}>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 550 }}>{op.name}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  Norm: {op.normHours} h per unit
                </div>
              </div>
              {canWrite && (
                <Button size="sm" variant="secondary" onClick={() => setDialog(op)}>
                  <Plus size={13} />
                  Add rate
                </Button>
              )}
            </div>
            {allRates.filter(r => r.productId === op.productId).length ? (
              <table className="dtbl" style={{ marginTop: 8 }} aria-label={`Rates of ${op.name}`}>
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Valid from</th>
                    <th style={{ width: 120 }} className="r">
                      Rate
                    </th>
                    <th>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {allRates
                    .filter(r => r.productId === op.productId)
                    .map(r => (
                      <tr key={r.id}>
                        <td className="num muted">{r.validFrom}</td>
                        <td className="r num">{r.rate}</td>
                        <td className="muted">{r.unit === 'per_hour' ? 'per hour' : 'per unit'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <p className="faint" style={{ margin: '8px 0 0' }}>No rates yet: the piecework order takes the rate valid on its date.</p>
            )}
          </section>
        ))
      )}
      {dialog && <RateDialog operation={dialog} onClose={() => setDialog(null)} onSave={v => api.addRate.mutate(v)} />}
    </div>
  );
}

/** Новая расценка операции: действует с указанной даты */
function RateDialog({ operation, onClose, onSave }: { operation: OperationRow; onClose: () => void; onSave: (v: { productId: string; validFrom: string; rate: string; unit: 'per_unit' | 'per_hour' }) => void }) {
  const [validFrom, setValidFrom] = React.useState(new Date().toISOString().slice(0, 10));
  const [rate, setRate] = React.useState('');
  const [unit, setUnit] = React.useState<'per_unit' | 'per_hour'>('per_unit');
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!validFrom) errs.validFrom = 'Choose the date the rate starts from';
    if (!rate.trim() || Number(rate) < 0) errs.rate = 'Enter the rate';
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    onSave({ productId: operation.productId, validFrom, rate: rate.trim(), unit });
    setBusy(false);
    toast(`The rate of “${operation.name}” is added`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={`New rate — ${operation.name}`}
        description="The piecework order takes the rate that is valid on its date. A new rate does not change the orders already created."
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              Add rate
            </Button>
          </>
        }
      >
        <form
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Valid from" error={err.validFrom}>
            {p => <Input {...p} type="date" value={validFrom} onChange={e => (setValidFrom(e.target.value), setErr({}))} />}
          </Field>
          <Field label="Rate" error={err.rate} hint="Per unit of the product or per hour of work">
            {p => <Input {...p} inputMode="decimal" value={rate} onChange={e => (setRate(e.target.value), setErr({}))} />}
          </Field>
          <Field label="Unit">
            {p => (
              <Select
                id={p.id}
                value={unit}
                onValueChange={v => setUnit(v as 'per_unit' | 'per_hour')}
                options={[
                  { value: 'per_unit', label: 'Per unit' },
                  { value: 'per_hour', label: 'Per hour' },
                ]}
              />
            )}
          </Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
