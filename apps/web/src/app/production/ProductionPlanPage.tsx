/* Карточка плана производства: периоды в колонках (ячейка — сколько выпустить к началу периода), вкладки
   «Needs» (материалы, полуфабрикаты, часы участков против мощности, трудозатраты) и «Plan vs fact»
   (запланировано / заказано / выпущено). Заполнение — по статистике выпуска и продаж, по заказам покупателей;
   полуфабрикаты — кнопкой; заказы по плану — из рабочего места «Orders by plan». */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleAlert, Layers, Send, Trash2, TriangleAlert, Wand2, X } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtDate, parse } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { useWarehouses } from '../docs/data';
import { useWorkCenters } from '../catalog/data';
import { useSnapshot } from './data';
import { useProductionPlan, useProductionPlanApi, useProductionPlanNeeds, type PlanDetail, type PlanLine } from './plans-data';

type Tab = 'needs' | 'fact';
const SOURCE_LABEL: Record<string, string> = { output: 'Output statistics', sales: 'Sales statistics', customer_orders: 'Customer orders' };

export function ProductionPlanPage() {
  const { id } = useParams();
  const q = useProductionPlan(id);
  if (q.isPending)
    return (
      <div className="page flush">
        <div className="ph">
          <Skeleton w={260} h={24} />
        </div>
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="page flush">
        <EmptyState icon={<CircleAlert size={20} />} error title="Production plan not found" action={<Link to="/production/plans" className="btn btn-secondary">Back to plans</Link>}>
          This plan does not exist or belongs to another workspace.
        </EmptyState>
      </div>
    );
  return <PlanView key={q.data.id} plan={q.data} />;
}

function PlanView({ plan }: { plan: PlanDetail }) {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const api = useProductionPlanApi();
  const warehouses = useWarehouses();
  const centers = useWorkCenters();
  const snap = useSnapshot();
  const needs = useProductionPlanNeeds(plan.id);
  const [tab, setTab] = React.useState<Tab>('needs');
  const [fill, setFill] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const save = (patch: Record<string, unknown>) => api.update.mutate({ id: plan.id, body: patch });

  const items = snap.data?.items ?? [];
  const products = plan.lines.filter(l => !l.isSemi);
  const semis = plan.lines.filter(l => l.isSemi);
  const setLines = (lines: { id?: string; itemId: string; periodStart: string; qty: string; isSemi?: boolean }[]) =>
    save({ lines: lines.map(l => ({ ...(l.id ? { id: l.id } : {}), itemId: l.itemId, periodStart: l.periodStart, qty: l.qty, isSemi: l.isSemi ?? false })) });
  const setQty = (lineId: string, qty: string) => setLines(plan.lines.map(l => (l.id === lineId ? { id: l.id, itemId: l.itemId, periodStart: l.periodStart, qty, isSemi: l.isSemi } : { id: l.id, itemId: l.itemId, periodStart: l.periodStart, qty: l.qty, isSemi: l.isSemi })));
  /** Строки группируются по изделию: одна строка таблицы, колонки — периоды */
  const groups = React.useMemo(() => {
    const map = new Map<string, { key: string; itemId: string; itemName: string; isSemi: boolean; cells: PlanLine[]; total: number }>();
    for (const l of plan.lines) {
      const key = `${l.itemId}|${l.isSemi ? 'semi' : 'product'}`;
      const cur = map.get(key) ?? { key, itemId: l.itemId, itemName: l.itemName, isSemi: l.isSemi, cells: [], total: 0 };
      cur.cells.push(l);
      cur.total += Number(l.qty);
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => Number(a.isSemi) - Number(b.isSemi) || a.itemName.localeCompare(b.itemName));
  }, [plan.lines]);
  const addCell = (itemId: string, isSemi: boolean, periodStart: string) =>
    setLines([...plan.lines.map(l => ({ id: l.id, itemId: l.itemId, periodStart: l.periodStart, qty: l.qty, isSemi: l.isSemi })), { itemId, periodStart, qty: '1', isSemi }]);
  const removeGroup = (g: { key: string }) => setLines(plan.lines.filter(l => `${l.itemId}|${l.isSemi ? 'semi' : 'product'}` !== g.key).map(l => ({ id: l.id, itemId: l.itemId, periodStart: l.periodStart, qty: l.qty, isSemi: l.isSemi })));
  const addLine = (periodStart: string) => {
    const item = items.find(i => !products.some(l => l.itemId === i.id)) ?? items[0];
    if (!item) return toast.error('Add a product to the production catalogue first');
    addCell(item.id, false, periodStart);
  };

  return (
    <div className="page doc-page">
      <div className="doc-bar">
        <div className="doc-title">
          <nav className="muted" style={{ fontSize: 12.5 }} aria-label="Section">
            <Link to="/production/plans" className="crm-link">
              Production plans
            </Link>
          </nav>
          <h1>
            {plan.name}
            <Badge tone={plan.status === 'approved' ? 'green' : 'gray'} dot>
              {plan.status === 'approved' ? 'Approved' : 'Draft'}
            </Badge>
          </h1>
          <span className="faint" style={{ fontSize: 12 }}>
            {fmtDate(parse(plan.periodFrom))} — {fmtDate(parse(plan.periodTo))}
          </span>
        </div>
        <div className="doc-actions">
          {canWrite && (
            <Button onClick={() => setFill(true)}>
              <Wand2 size={14} />
              Fill
            </Button>
          )}
          {canWrite && (
            <Button onClick={() => void api.semi.mutateAsync(plan.id)}>
              <Layers size={14} />
              Plan semi-finished
            </Button>
          )}
          {canWrite && semis.length > 0 && (
            <Button onClick={() => void api.removeSemi.mutateAsync(plan.id)}>
              <X size={14} />
              Remove semi-finished
            </Button>
          )}
          {canWrite && plan.status !== 'approved' && (
            <Button variant="primary" onClick={() => save({ status: 'approved' })}>
              <Send size={14} />
              Approve
            </Button>
          )}
          {canWrite && plan.status === 'approved' && (
            <Button onClick={() => save({ status: 'draft' })}>Back to draft</Button>
          )}
          {canWrite && (
            <IconButton label="Archive plan" onClick={() => setConfirm(true)}>
              <Trash2 size={15} />
            </IconButton>
          )}
        </div>
      </div>

      <section className="doc-head panel" aria-label="Plan header">
        <Field label="Name">{p => <Input {...p} disabled={!canWrite} value={plan.name} onChange={e => save({ name: e.target.value })} />}</Field>
        <Field label="Step">
          {p => (
            <Select
              id={p.id}
              disabled={!canWrite}
              value={plan.step}
              onValueChange={v => save({ step: v })}
              options={[
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
              ]}
              aria-label="Step"
            />
          )}
        </Field>
        <Field label="From">{p => <Input {...p} type="date" disabled={!canWrite} value={plan.periodFrom} onChange={e => save({ periodFrom: e.target.value })} />}</Field>
        <Field label="To">{p => <Input {...p} type="date" disabled={!canWrite} value={plan.periodTo} onChange={e => save({ periodTo: e.target.value })} />}</Field>
        <Field label="Warehouse" hint="Finished goods warehouse">
          {p => (
            <Select
              id={p.id}
              disabled={!canWrite}
              value={plan.warehouseId}
              onValueChange={v => save({ warehouseId: v })}
              options={(warehouses.data ?? []).filter(w => w.kind !== 'transit').map(w => ({ value: w.id, label: w.name }))}
              aria-label="Warehouse"
            />
          )}
        </Field>
        <Field label="Work center" hint="Dispatcher work center (optional)">
          {p => (
            <Select
              id={p.id}
              disabled={!canWrite}
              value={plan.workCenterId ?? ''}
              onValueChange={v => save({ workCenterId: v })}
              options={(centers.data?.items ?? []).map(c => ({ value: c.id, label: c.name }))}
              placeholder="Any work center"
              aria-label="Work center"
            />
          )}
        </Field>
      </section>

      {plan.semiDirty && (
        <div className="panel" role="status" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', color: 'var(--warn, #b45309)' }}>
          <TriangleAlert size={16} />
          <span>The products changed after the semi-finished lines were planned. Plan semi-finished again.</span>
        </div>
      )}

      <section className="doc-lines panel" aria-label="Plan lines">
        <div className="table-wrap">
          <table className="dtbl" aria-label="Plan lines">
            <thead>
              <tr>
                <th style={{ width: 200 }}>Product</th>
                {plan.periods.map(p => (
                  <th key={p} className="r" style={{ width: 110 }}>
                    {fmtDate(parse(p))}
                  </th>
                ))}
                <th style={{ width: 120 }} className="r">
                  Total
                </th>
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.key} data-row={g.isSemi ? 'semi' : undefined}>
                  <td className="trunc">
                    {g.itemName}
                    {g.isSemi && <span className="faint"> · semi-finished</span>}
                  </td>
                  {plan.periods.map(p => {
                    const cell = g.cells.find(x => x.periodStart === p);
                    return (
                      <td key={p} className="r num">
                        {cell ? (
                          canWrite ? (
                            <Input aria-label={`${g.itemName} ${p}`} type="number" step="0.001" value={cell.qty} onChange={e => setQty(cell.id, e.target.value)} style={{ textAlign: 'right' }} />
                          ) : (
                            cell.qty
                          )
                        ) : canWrite ? (
                          <Button size="sm" onClick={() => addCell(g.itemId, g.isSemi, p)} aria-label={`Add ${g.itemName} to ${p}`}>
                            +
                          </Button>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="r num">{g.total.toFixed(3)}</td>
                  <td>{canWrite && <IconButton label={`Remove ${g.itemName}`} onClick={() => removeGroup(g)}><X size={14} /></IconButton>}</td>
                </tr>
              ))}
              {canWrite && (
                <tr>
                  <td className="faint">Add a product</td>
                  {plan.periods.map(p => (
                    <td key={p} className="r">
                      <Button size="sm" aria-label={`Add a line to ${p}`} onClick={() => addLine(p)}>
                        +
                      </Button>
                    </td>
                  ))}
                  <td />
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!products.length && (
          <p className="muted" style={{ padding: 12, margin: 0 }}>
            The plan is empty. Fill it by statistics, by customer orders or add a line by hand.
          </p>
        )}
      </section>

      <nav className="tabs doc-tabs" aria-label="Plan sections">
        <button type="button" className={`tab${tab === 'needs' ? ' on' : ''}`} aria-current={tab === 'needs' ? 'page' : undefined} onClick={() => setTab('needs')}>
          Needs
        </button>
        <button type="button" className={`tab${tab === 'fact' ? ' on' : ''}`} aria-current={tab === 'fact' ? 'page' : undefined} onClick={() => setTab('fact')}>
          Plan vs fact
        </button>
      </nav>

      {tab === 'needs' ? (
        <NeedsTabs plan={plan} needs={needs.data} pending={needs.isPending} />
      ) : (
        <section className="panel" aria-label="Plan vs fact">
          <div className="table-wrap">
            <table className="dtbl" aria-label="Plan vs fact">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Period</th>
                  <th className="r">Planned</th>
                  <th className="r">Ordered</th>
                  <th className="r">Produced</th>
                  <th>Start</th>
                </tr>
              </thead>
              <tbody>
                {plan.lines.map(l => (
                  <tr key={l.id}>
                    <td className="trunc">{l.itemName}</td>
                    <td className="num muted">{fmtDate(parse(l.periodStart))}</td>
                    <td className="r num">{l.qty}</td>
                    <td className="r num">{l.ordered}</td>
                    <td className="r num">{l.produced}</td>
                    <td className="num muted">{fmtDate(parse(l.startDate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <FillDialog open={fill} onClose={() => setFill(false)} onFill={(source, mode, periods) => api.fill.mutate({ id: plan.id, source, mode, periods })} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={o => !o && setConfirm(false)}
        title="Archive this plan?"
        description="The plan is hidden from the journal; production orders created from it stay."
        confirmLabel="Archive"
        cancelLabel="Keep"
        danger
        onConfirm={() => {
          setConfirm(false);
          navigate('/production/plans');
          void api.remove.mutateAsync(plan.id);
        }}
      />
    </div>
  );
}

/** Потребности плана: материалы, полуфабрикаты, часы участков против мощности, трудозатраты */
function NeedsTabs({ plan, needs, pending }: { plan: PlanDetail; needs: ReturnType<typeof useProductionPlanNeeds>['data']; pending: boolean }) {
  const [tab, setTab] = React.useState<'materials' | 'semis' | 'load' | 'labor'>('materials');
  if (pending)
    return (
      <section className="panel">
        <Skeleton w="100%" h={80} />
      </section>
    );
  return (
    <section className="panel" aria-label="Plan needs">
      <nav className="tabs doc-tabs" aria-label="Need sections">
        {(
          [
            ['materials', 'Materials'],
            ['semis', 'Semi-finished'],
            ['load', 'Work centers'],
            ['labor', 'Labor'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={`tab${tab === id ? ' on' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="table-wrap">
        {tab === 'materials' && (
          <table className="dtbl" aria-label="Materials">
            <thead>
              <tr>
                <th>Material</th>
                <th className="r">Needed</th>
              </tr>
            </thead>
            <tbody>
              {(needs?.materials ?? []).map(m => (
                <tr key={m.productId}>
                  <td className="trunc">{m.name}</td>
                  <td className="r num">{m.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'semis' && (
          <table className="dtbl" aria-label="Semi-finished">
            <thead>
              <tr>
                <th>Semi-finished</th>
                <th className="r">Consumed</th>
                <th className="r">Produced</th>
                <th className="r">Balance</th>
              </tr>
            </thead>
            <tbody>
              {(needs?.semis ?? []).map(s => (
                <tr key={s.itemId} data-row={s.status === 'deficit' ? 'deficit' : undefined}>
                  <td className="trunc">{s.name}</td>
                  <td className="r num">{s.consumed}</td>
                  <td className="r num">{s.produced}</td>
                  <td className="r num">
                    <Badge tone={s.status === 'deficit' ? 'amber' : 'green'} dot>
                      {s.balance}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'load' && (
          <table className="dtbl" aria-label="Work center load">
            <thead>
              <tr>
                <th>Period</th>
                <th>Work center</th>
                <th className="r">Hours</th>
                <th className="r">Capacity</th>
                <th className="r">Shortage</th>
              </tr>
            </thead>
            <tbody>
              {(needs?.load ?? []).map((l, i) => (
                <tr key={`${l.period}-${l.workCenterId}-${i}`} data-row={Number(l.shortage) > 0 ? 'deficit' : undefined}>
                  <td className="num muted">{fmtDate(parse(l.period))}</td>
                  <td className="trunc">{l.workCenterName}</td>
                  <td className="r num">{l.hours}</td>
                  <td className="r num muted">{l.capacity}</td>
                  <td className="r num">{Number(l.shortage) > 0 ? <Badge tone="amber" dot>{l.shortage}</Badge> : <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'labor' && (
          <table className="dtbl" aria-label="Labor">
            <thead>
              <tr>
                <th>Work center</th>
                <th className="r">Hours</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(needs?.labor ?? []).map((l, i) => (
                <tr key={`${l.workCenterId}-${i}`}>
                  <td className="trunc">{l.workCenterName}</td>
                  <td className="r num">{l.hours}</td>
                  <td className="r num">{l.amount ?? <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!needs && <p className="muted" style={{ padding: 12, margin: 0 }}>The plan has no lines yet.</p>}
      <p className="faint" style={{ padding: 12, margin: 0, fontSize: 12 }}>
        Materials of the approved plans also come into the needs screen as the “Plan” source. Periods: {plan.periods.length}.
      </p>
    </section>
  );
}

/** Диалог автозаполнения: источник данных и режим «заменить / добавить» */
function FillDialog({ open, onClose, onFill }: { open: boolean; onClose: () => void; onFill: (source: 'output' | 'sales' | 'customer_orders', mode: 'replace' | 'add', periods: number) => void }) {
  const [source, setSource] = React.useState<'output' | 'sales' | 'customer_orders'>('output');
  const [mode, setMode] = React.useState<'replace' | 'add'>('replace');
  const [periods, setPeriods] = React.useState('6');
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent title="Fill the plan">
        <Field label="Source">
          {p => (
            <Select
              id={p.id}
              value={source}
              onValueChange={v => setSource(v as typeof source)}
              options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))}
              aria-label="Source"
            />
          )}
        </Field>
        <Field label="Past periods" hint="How many periods the statistics are averaged over">
          {p => <Input {...p} type="number" min="1" max="60" value={periods} onChange={e => setPeriods(e.target.value)} />}
        </Field>
        <Field label="Mode" hint="Replace the product lines or add to them">
          {p => (
            <Select
              id={p.id}
              value={mode}
              onValueChange={v => setMode(v as typeof mode)}
              options={[
                { value: 'replace', label: 'Replace' },
                { value: 'add', label: 'Add' },
              ]}
              aria-label="Mode"
            />
          )}
        </Field>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            onClick={() => {
              onFill(source, mode, Math.max(1, Number(periods) || 6));
              onClose();
            }}
          >
            Fill
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}