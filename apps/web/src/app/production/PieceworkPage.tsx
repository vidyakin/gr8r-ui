/* Сдельные наряды: журнал нарядов исполнителей, отчёт выработки за период и расценки операций.
   Один наряд — один исполнитель за день; мастер проверяет и проводит наряд, сумма идёт в себестоимость выпуска. */
import * as React from 'react';
import { CircleAlert, ClipboardList, Plus, Receipt } from 'lucide-react';
import { Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { useCanWrite } from '../meta/custom-fields';
import { STATUS_LABEL, STATUS_TONE } from '../docs/data';
import { useOperations, useOperationRates, usePieceworkApi, usePieceworkOrders, usePieceworkReport, type OperationRow } from './piecework-data';
import { t, useT } from '@/i18n';

const TABS = [
  { id: 'orders', name: 'piecework.tab.orders' },
  { id: 'output', name: 'piecework.tab.output' },
  { id: 'rates', name: 'piecework.tab.rates' },
] as const;

export function PieceworkPage() {
  const tt = useT();
  const [tab, setTab] = React.useState<(typeof TABS)[number]['id']>('orders');
  const canWrite = useCanWrite();

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('production.piecework.title')}</h1>
          <p>{tt('production.piecework.subtitle')}</p>
        </div>
      </div>
      <nav className="tabs doc-tabs" aria-label={tt('production.piecework.sectionsAria')}>
        {TABS.map(t0 => (
          <button key={t0.id} type="button" className={`tab${tab === t0.id ? ' on' : ''}`} aria-current={tab === t0.id ? 'page' : undefined} onClick={() => setTab(t0.id)}>
            {tt(`production.${t0.name}`)}
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
  const tt = useT();
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const list = usePieceworkOrders({ from: from || undefined, to: to || undefined });
  const rows = list.data?.items ?? [];

  return (
    <>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px' }}>
        <Field label={tt('production.common.from')}>{p => <Input {...p} type="date" value={from} onChange={e => setFrom(e.target.value)} />}</Field>
        <Field label={tt('production.common.to')}>{p => <Input {...p} type="date" value={to} onChange={e => setTo(e.target.value)} />}</Field>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('production.piecework.orders.loadFailed')} action={<Button size="sm" onClick={() => list.refetch()}>{tt('production.common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<ClipboardList size={20} />} title={tt('production.piecework.orders.empty')}>
          {tt('production.piecework.orders.emptyHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('production.piecework.orders.table')}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>{tt('production.piecework.orders.col.number')}</th>
                <th style={{ width: 112 }}>{tt('production.piecework.orders.col.date')}</th>
                <th>{tt('production.piecework.orders.col.executor')}</th>
                <th style={{ width: 90 }} className="r">
                  {tt('production.piecework.orders.col.lines')}
                </th>
                <th style={{ width: 110 }} className="r">
                  {tt('production.piecework.orders.col.amount')}
                </th>
                <th style={{ width: 112 }}>{tt('production.piecework.orders.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="mono">{r.number ?? <span className="faint">{tt('production.common.draft')}</span>}</td>
                  <td className="num muted">{r.date}</td>
                  <td className="trunc">{r.memberName}</td>
                  <td className="r num">{r.lineCount}</td>
                  <td className="r num">{r.amount ?? <span className="faint">—</span>}</td>
                  <td>
                    <Badge tone={STATUS_TONE[r.status]} dot>
                      {tEnum('docStatus', r.status, STATUS_LABEL[r.status])}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canWrite && <p className="faint" style={{ padding: '0 var(--gutter) 24px' }}>{tt('production.piecework.orders.readOnly')}</p>}
    </>
  );
}

/* ---------------- отчёт выработки ---------------- */

function OutputTab() {
  const tt = useT();
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const report = usePieceworkReport({ from: from || undefined, to: to || undefined });
  const rows = report.data?.items ?? [];

  return (
    <>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px' }}>
        <Field label={tt('production.common.from')}>{p => <Input {...p} type="date" value={from} onChange={e => setFrom(e.target.value)} />}</Field>
        <Field label={tt('production.common.to')}>{p => <Input {...p} type="date" value={to} onChange={e => setTo(e.target.value)} />}</Field>
      </div>
      {report.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<Receipt size={20} />} title={tt('production.piecework.output.empty')}>
          {tt('production.piecework.output.emptyHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('production.piecework.output.table')}>
            <thead>
              <tr>
                <th>{tt('production.piecework.output.col.executor')}</th>
                <th>{tt('production.piecework.output.col.operation')}</th>
                <th style={{ width: 100 }} className="r">
                  {tt('production.piecework.output.col.qty')}
                </th>
                <th style={{ width: 100 }} className="r">
                  {tt('production.piecework.output.col.hours')}
                </th>
                <th style={{ width: 120 }} className="r">
                  {tt('production.piecework.output.col.amount')}
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
  const tt = useT();
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
        <EmptyState icon={<Receipt size={20} />} title={tt('production.piecework.rates.empty')}>
          {tt('production.piecework.rates.emptyHint')}
        </EmptyState>
      ) : (
        items.map(op => (
          <section key={op.productId} className="panel" style={{ padding: 14 }}>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 550 }}>{op.name}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {tt('production.piecework.rates.norm')}: {op.normHours} {tt('production.piecework.rates.hoursPerUnit')}
                </div>
              </div>
              {canWrite && (
                <Button size="sm" variant="secondary" onClick={() => setDialog(op)}>
                  <Plus size={13} />
                  {tt('production.piecework.rates.add')}
                </Button>
              )}
            </div>
            {allRates.filter(r => r.productId === op.productId).length ? (
              <table className="dtbl" style={{ marginTop: 8 }} aria-label={tt('production.piecework.rates.tableFor', { name: op.name })}>
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>{tt('production.piecework.rates.col.validFrom')}</th>
                    <th style={{ width: 120 }} className="r">
                      {tt('production.piecework.rates.col.rate')}
                    </th>
                    <th>{tt('production.piecework.rates.col.unit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {allRates
                    .filter(r => r.productId === op.productId)
                    .map(r => (
                      <tr key={r.id}>
                        <td className="num muted">{r.validFrom}</td>
                        <td className="r num">{r.rate}</td>
                        <td className="muted">{r.unit === 'per_hour' ? tt('production.piecework.rates.perHour') : tt('production.piecework.rates.perUnit')}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <p className="faint" style={{ margin: '8px 0 0' }}>{tt('production.piecework.rates.noRates')}</p>
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
  const tt = useT();
  const [validFrom, setValidFrom] = React.useState(new Date().toISOString().slice(0, 10));
  const [rate, setRate] = React.useState('');
  const [unit, setUnit] = React.useState<'per_unit' | 'per_hour'>('per_unit');
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!validFrom) errs.validFrom = tt('production.piecework.rates.errValidFrom');
    if (!rate.trim() || Number(rate) < 0) errs.rate = tt('production.piecework.rates.errRate');
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    onSave({ productId: operation.productId, validFrom, rate: rate.trim(), unit });
    setBusy(false);
    toast(tt('production.piecework.rates.added', { name: operation.name }));
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={tt('production.piecework.rates.dialogTitle', { name: operation.name })}
        description={tt('production.piecework.rates.dialogDesc')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{tt('production.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {tt('production.piecework.rates.add')}
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
          <Field label={tt('production.piecework.rates.validFrom')} error={err.validFrom}>
            {p => <Input {...p} type="date" value={validFrom} onChange={e => (setValidFrom(e.target.value), setErr({}))} />}
          </Field>
          <Field label={tt('production.piecework.rates.rate')} error={err.rate} hint={tt('production.piecework.rates.rateHint')}>
            {p => <Input {...p} inputMode="decimal" value={rate} onChange={e => (setRate(e.target.value), setErr({}))} />}
          </Field>
          <Field label={tt('production.piecework.rates.unit')}>
            {p => (
              <Select
                id={p.id}
                value={unit}
                onValueChange={v => setUnit(v as 'per_unit' | 'per_hour')}
                options={[
                  { value: 'per_unit', label: tt('production.piecework.rates.perUnit') },
                  { value: 'per_hour', label: tt('production.piecework.rates.perHour') },
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

/** локальная обёртка tEnum без циклических импортов (catalog/enums.docStatus) */
function tEnum(group: string, value: string, fallback: string): string {
  // обходим через t: enums.<group>.<value>
  const key = `enums.${group}.${value}` as Parameters<typeof t>[0];
  const out = t(key);
  return out === key ? fallback : out;
}
