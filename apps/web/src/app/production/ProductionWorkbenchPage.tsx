/* Рабочее место «Выпуск продукции»: заказы покупателей и заказы на производство с остатком к выпуску.
   Мастера отмечает строки, выбирает участок-изготовителя и жмёт «Выполнить» — на участок и дату создаётся
   (или дополняется) документ выпуска. Этап выпуска пока один — «Завершение производства». */
import * as React from 'react';
import { CircleAlert, Factory, ListChecks, PanelRightClose, PanelRightOpen, Play, RefreshCw, X } from 'lucide-react';
import { PRODUCTION_STAGES } from '@gr8r/shared';
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Input, Segmented, Select, Skeleton } from '@/components/ui';
import { useCanWrite } from '../meta/custom-fields';
import { STATE_LABEL, STATE_TONE } from './orders-data';
import { useWorkbench, useWorkbenchExecute, type WorkbenchMode, type WorkbenchOrder, type WorkbenchRow } from './workbench-data';

interface RowState {
  /** Отмечена ли строка к выпуску */
  checked: boolean;
  /** Количество (расширенный режим) */
  qty: string;
  /** Участок-изготовитель */
  workCenterId: string;
}

const key = (o: WorkbenchOrder, r: WorkbenchRow) => `${o.id}:${r.id}`;
const today = () => new Date().toISOString().slice(0, 10);

export function ProductionWorkbenchPage() {
  const canWrite = useCanWrite();
  const [mode, setMode] = React.useState<WorkbenchMode>('simple');
  const [date, setDate] = React.useState(today());
  const [q, setQ] = React.useState('');
  const [state, setState] = React.useState('');
  const [to, setTo] = React.useState('');
  const [defaultCenter, setDefaultCenter] = React.useState('');
  const [panelOpen, setPanelOpen] = React.useState(true);
  const [rows, setRows] = React.useState<Record<string, RowState>>({});

  const list = useWorkbench({ q: q || undefined, state: state || undefined, to: to || undefined });
  const execute = useWorkbenchExecute();
  const orders = list.data?.orders ?? [];
  const centers = list.data?.workCenters ?? [];

  // состояние строк по умолчанию: остаток и участок заказа (или участок по умолчанию из панели)
  const stateOf = (o: WorkbenchOrder, r: WorkbenchRow): RowState => {
    const k = key(o, r);
    const saved = rows[k];
    if (saved) return saved;
    return { checked: false, qty: r.remaining, workCenterId: o.workCenterId ?? defaultCenter };
  };
  const patch = (o: WorkbenchOrder, r: WorkbenchRow, p: Partial<RowState>) => setRows(prev => ({ ...prev, [key(o, r)]: { ...stateOf(o, r), ...p } }));

  // строка изменилась, если её состояние отличается от исходного
  const changed = React.useMemo(
    () => orders.some(o => o.rows.some(r => { const s = stateOf(o, r); return s.checked || s.qty !== r.remaining || s.workCenterId !== (o.workCenterId ?? defaultCenter); })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, rows, defaultCenter],
  );

  const fill = () => {
    const next: Record<string, RowState> = {};
    for (const o of orders) for (const r of o.rows) next[key(o, r)] = { checked: true, qty: r.remaining, workCenterId: o.workCenterId ?? defaultCenter };
    setRows(next);
  };
  const clear = () => setRows({});

  const run = () => {
    const payload = orders.flatMap(o =>
      o.rows.flatMap(r => {
        const s = stateOf(o, r);
        if (!s.checked) return [];
        return [{ orderId: o.id, source: r.source, lineId: r.id, qty: mode === 'extended' ? s.qty : undefined, workCenterId: s.workCenterId || undefined }];
      }),
    );
    if (!payload.length) return;
    execute.mutate(
      { date, mode, rows: payload },
      { onSuccess: () => setRows({}) },
    );
  };

  const marked = orders.reduce((n, o) => n + o.rows.filter(r => stateOf(o, r).checked).length, 0);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Production release</h1>
          <p>Orders waiting to be produced. Pick the lines, choose the work center and release them into one production document per work center and date.</p>
        </div>
        <div className="acts">
          <Segmented
            aria-label="Mode"
            value={mode}
            onValueChange={v => setMode(v as WorkbenchMode)}
            items={[
              { value: 'simple', label: 'Whole remainder' },
              { value: 'extended', label: 'By quantity' },
            ]}
          />
          <Input aria-label="Document date" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 150 }} />
          <Button onClick={() => void list.refetch()} title="Refresh">
            <RefreshCw size={14} />
          </Button>
          <IconButton label={panelOpen ? 'Hide the panel' : 'Show the panel'} onClick={() => setPanelOpen(v => !v)}>
            {panelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </IconButton>
          {canWrite && (
            <Button variant="primary" disabled={!marked || execute.isPending} onClick={() => run()}>
              <Play size={14} />
              Release{marked ? ` (${marked})` : ''}
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: '0 var(--gutter) 24px', minHeight: 0, flex: 1 }}>
        <section className="panel" style={{ flex: 1, minWidth: 0, padding: 0 }}>
          {list.isError ? (
            <EmptyState icon={<CircleAlert size={20} />} error title="Could not load the workbench" action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>}>
              {(list.error as Error).message}
            </EmptyState>
          ) : list.isPending ? (
            <div style={{ padding: 16 }}>
              <Skeleton w="100%" h={36} />
            </div>
          ) : !orders.length ? (
            <EmptyState icon={<Factory size={20} />} title="Nothing to release">
              The workbench shows customer orders and production orders whose products are made to order. Nothing is waiting right now.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="dtbl" aria-label="Orders to release">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <span className="faint">#</span>
                    </th>
                    <th>Product</th>
                    <th style={{ width: 96 }} className="r">
                      Ordered
                    </th>
                    <th style={{ width: 96 }} className="r">
                      Produced
                    </th>
                    <th style={{ width: 96 }} className="r">
                      Remaining
                    </th>
                    <th style={{ width: 160 }}>Stage</th>
                    <th style={{ width: 190 }}>Work center</th>
                    {mode === 'extended' && (
                      <th style={{ width: 110 }} className="r">
                        Qty
                      </th>
                    )}
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <OrderGroup
                      key={o.id}
                      order={o}
                      stateOf={stateOf}
                      patch={patch}
                      mode={mode}
                      centers={centers}
                      canWrite={canWrite}
                      onPatchAll={(p, rowsOfOrder) => setRows(prev => ({ ...prev, ...Object.fromEntries(rowsOfOrder.map(r => [key(o, r), { ...stateOf(o, r), ...p }])) }))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {panelOpen && (
          <aside className="panel" style={{ width: 280, flex: '0 0 280px' }}>
            <div className="panel-h">
              <h2>Filters and settings</h2>
              {changed && <Badge tone="accent">Changed</Badge>}
            </div>
            <div style={{ padding: 12, display: 'grid', gap: 12 }}>
              <Field label="Search" hint="Order number or comment">
                {p => <Input {...p} value={q} placeholder="Number or comment" onChange={e => setQ(e.target.value)} />}
              </Field>
              <Field label="Order state">
                {p => (
                  <Select
                    id={p.id}
                    aria-label="Order state"
                    value={state}
                    onValueChange={v => setState(v)}
                    options={[{ value: '', label: 'Any state' }, ...Object.entries(STATE_LABEL).map(([value, label]) => ({ value, label }))]}
                  />
                )}
              </Field>
              <Field label="Planned until" hint="Planned end of the production order or the due date of the customer order">
                {p => <Input {...p} type="date" value={to} onChange={e => setTo(e.target.value)} />}
              </Field>
              <Field label="Default work center" hint="Used for the lines without a work center of their own">
                {p => (
                  <Select
                    id={p.id}
                    aria-label="Default work center"
                    value={defaultCenter}
                    onValueChange={v => setDefaultCenter(v)}
                    options={[{ value: '', label: 'Not chosen' }, ...centers.map(c => ({ value: c.id, label: c.name }))]}
                  />
                )}
              </Field>
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" onClick={fill}>
                  <ListChecks size={13} />
                  Fill
                </Button>
                <Button size="sm" variant="ghost" onClick={clear} disabled={!Object.keys(rows).length}>
                  <X size={13} />
                  Clear
                </Button>
              </div>
              <p className="faint" style={{ fontSize: 12, margin: 0 }}>
                “Whole remainder” releases everything that is left, “By quantity” lets you release part of it. The stage is “{PRODUCTION_STAGES[0].label}” — the only one so far.
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/** Заказ рабочего места: заголовок заказа и его строки */
function OrderGroup({
  order,
  stateOf,
  patch,
  mode,
  centers,
  canWrite,
  onPatchAll,
}: {
  order: WorkbenchOrder;
  stateOf: (o: WorkbenchOrder, r: WorkbenchRow) => RowState;
  patch: (o: WorkbenchOrder, r: WorkbenchRow, p: Partial<RowState>) => void;
  mode: WorkbenchMode;
  centers: { id: string; name: string }[];
  canWrite: boolean;
  onPatchAll: (p: Partial<RowState>, rows: WorkbenchRow[]) => void;
}) {
  const all = order.rows.every(r => stateOf(order, r).checked);
  const center = stateOf(order, order.rows[0]).workCenterId;
  return (
    <>
      <tr>
        <td colSpan={mode === 'extended' ? 9 : 8} style={{ background: 'var(--surface-2, rgba(127,127,127,0.06))', padding: '6px 10px' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <strong style={{ fontWeight: 550 }}>{order.number ?? 'Draft'}</strong>
            <span className="faint">{order.type === 'customer_order' ? 'Customer order' : 'Production order'}</span>
            {order.state && <Badge tone={STATE_TONE[order.state] ?? 'gray'}>{STATE_LABEL[order.state] ?? order.state}</Badge>}
            {order.counterparty && <span className="muted">{order.counterparty.name}</span>}
            {order.workCenterName && <span className="faint">· {order.workCenterName}</span>}
            {order.dueDate && <span className="faint">· {order.dueDate}</span>}
            {canWrite && (
              <div className="row" style={{ gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
                <Select
                  aria-label="Work center for the order"
                  size="sm"
                  value={center}
                  onValueChange={v => onPatchAll({ workCenterId: v }, order.rows)}
                  options={[{ value: '', label: 'No work center' }, ...centers.map(c => ({ value: c.id, label: c.name }))]}
                  className="w-auto"
                />
                <Button size="sm" variant="ghost" onClick={() => onPatchAll({ checked: !all }, order.rows)}>
                  {all ? 'Uncheck all' : 'Check all'}
                </Button>
              </div>
            )}
          </div>
        </td>
      </tr>
      {order.rows.map(r => {
        const s = stateOf(order, r);
        return (
          <tr key={r.id}>
            <td>
              {canWrite ? <Checkbox aria-label={`Release ${r.productName}`} checked={s.checked} onChange={e => patch(order, r, { checked: e.target.checked })} /> : <span className="faint">{r.stage === 'final' ? '✓' : ''}</span>}
            </td>
            <td>
              <span className="trunc">{r.productName}</span>
            </td>
            <td className="r num">{r.qty}</td>
            <td className="r num muted">{r.produced}</td>
            <td className="r num">{r.remaining}</td>
            <td>
              <Badge tone="accent">{PRODUCTION_STAGES[0].label}</Badge>
            </td>
            <td>
              {canWrite ? (
                <Select
                  aria-label="Work center"
                  size="sm"
                  value={s.workCenterId}
                  onValueChange={v => patch(order, r, { workCenterId: v })}
                  options={[{ value: '', label: 'No work center' }, ...centers.map(c => ({ value: c.id, label: c.name }))]}
                />
              ) : (
                <span className="faint">—</span>
              )}
            </td>
            {mode === 'extended' && (
              <td className="r">
                {canWrite ? <Input aria-label="Quantity" inputMode="decimal" value={s.qty} onChange={e => patch(order, r, { qty: e.target.value })} /> : <span className="num">{s.qty}</span>}
              </td>
            )}
            <td />
          </tr>
        );
      })}
    </>
  );
}
