/* Экран расчёта потребностей (обработка УНФ «Расчёт потребностей в запасах»): три шага —
   Recommendations → Planning → Orders. Открывается из Purchases, Stock и Production; справа настройки расчёта:
   способ пополнения, методика, шаг и число периодов, начало горизонта, учёт по складам или по компании.
   Вкладка «Production orders» — сводная потребность этапа 3 по материалам заказов на производство. */
import * as React from 'react';
import { CircleAlert, Factory, PackageSearch, RotateCw, Send, Truck } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton, toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { useCanWrite } from '../meta/custom-fields';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NEEDS_METHOD_LABELS, STOCK_REPLENISHMENT_LABELS, type NeedsMethod, type StockReplenishment } from '@gr8r/shared';
import { useWarehouses } from '../docs/data';
import { useWorkCenters } from '../catalog/data';
import { fmtDate, parse } from '../lib/dates';
import { needsKey, useProductionNeeds, type NeedsRow as ProductionNeedsRow, type SupplierOrdersResult } from './orders-data';
import { calcKey, useNeedsCalculation, useNeedsDraftsApi, type NeedsCalcParams, type NeedsCalcRow } from './plans-data';

type Step = 'recommendations' | 'planning' | 'orders';
const STEPS: { id: Step; name: string }[] = [
  { id: 'recommendations', name: 'Recommendations' },
  { id: 'planning', name: 'Planning' },
  { id: 'orders', name: 'Orders' },
];
const SOURCE_LABEL: Record<string, string> = { customer_order: 'Customer order', supplier_order: 'Supplier order', production_order: 'Production order', plan: 'Plan' };

/** Правки строки на шаге Planning: способ пополнения, дата поступления и источник (участок или склад-источник) */
interface LineEdit {
  replenishment?: StockReplenishment;
  date?: string;
  workCenterId?: string;
  sourceWarehouseId?: string;
}

/** Самая ранняя дата поступления строки: сегодня + срок (у перемещения срока нет) — сервер ставит так же */
const earliestDate = (r: NeedsCalcRow, mode: StockReplenishment): string => new Date(Date.now() + (mode === 'transfer' ? 0 : r.leadDays) * 864e5).toISOString().slice(0, 10);

const DEFAULT_PARAMS: NeedsCalcParams = {
  replenishment: 'all',
  method: 'orders',
  step: 'week',
  periods: 8,
  byWarehouse: true,
  source: 'all',
  safetyDays: 0,
  historyPeriods: 6,
};

export function ProductionNeedsPage() {
  const ws = useWsId();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const warehouses = useWarehouses();
  const workCenters = useWorkCenters();
  const drafts = useNeedsDraftsApi();
  const [tab, setTab] = React.useState<'stock' | 'production'>('stock');
  const [step, setStep] = React.useState<Step>('recommendations');
  const [params, setParams] = React.useState<NeedsCalcParams>(DEFAULT_PARAMS);
  const [from, setFrom] = React.useState('');
  const [sel, setSel] = React.useState<Record<string, boolean>>({});
  const [qty, setQty] = React.useState<Record<string, string>>({});
  /** Поставщик строки, выбранный на шаге Planning (по умолчанию — поставщик товара) */
  const [supplier, setSupplier] = React.useState<Record<string, string>>({});
  const [edits, setEdits] = React.useState<Record<string, LineEdit>>({});
  const [singleDate, setSingleDate] = React.useState(false);
  const [perCustomerOrder, setPerCustomerOrder] = React.useState(false);
  const [created, setCreated] = React.useState<{ id: string; type: string; number: string | null; date: string }[]>([]);
  const calc = useNeedsCalculation(params, tab === 'stock');
  const rows = calc.data?.rows ?? [];
  const withOrder = rows.filter(r => Number(r.recommendation) > 0);
  const keyOf = (r: NeedsCalcRow) => `${r.productId}:${r.warehouseId ?? 'all'}`;
  const selected = withOrder.filter(r => sel[keyOf(r)]);

  const set = (patch: Partial<NeedsCalcParams>) => setParams(p => ({ ...p, ...patch }));
  const qtyOf = (r: NeedsCalcRow) => qty[keyOf(r)] ?? r.recommendation;
  const supplierOf = (r: NeedsCalcRow) => supplier[keyOf(r)] ?? r.supplierId;
  const editOf = (r: NeedsCalcRow): LineEdit => edits[keyOf(r)] ?? {};
  const modeOf = (r: NeedsCalcRow): StockReplenishment => editOf(r).replenishment ?? r.replenishment;
  /** Дата строки: правка или дата дефицита, но не раньше «сегодня + срок» */
  const dateOf = (r: NeedsCalcRow): string => {
    const want = editOf(r).date ?? r.dueDate ?? '';
    const min = earliestDate(r, modeOf(r));
    return want && want > min ? want : min;
  };
  const edit = (r: NeedsCalcRow, patch: LineEdit) => setEdits(s => ({ ...s, [keyOf(r)]: { ...s[keyOf(r)], ...patch } }));

  const fillByDeficit = () => {
    const next: Record<string, string> = {};
    for (const r of withOrder) next[keyOf(r)] = r.recommendation;
    setQty(next);
  };

  const create = async () => {
    if (!selected.length) return;
    const byMode = new Map<StockReplenishment, { productId: string; warehouseId: string | null; sourceWarehouseId: string | null; workCenterId: string | null; qty: string; date: string | null; customerOrderId: string | null; price: string | null; supplierId: string | null }[]>();
    for (const r of selected) {
      const q = qtyOf(r);
      if (Number(q) <= 0) continue;
      const mode = modeOf(r);
      const e = editOf(r);
      byMode.set(mode, [
        ...(byMode.get(mode) ?? []),
        {
          productId: r.productId,
          warehouseId: r.warehouseId,
          sourceWarehouseId: mode === 'transfer' ? (e.sourceWarehouseId ?? r.sourceWarehouseId) : null,
          workCenterId: mode === 'production' ? (e.workCenterId ?? null) : null,
          qty: q,
          date: dateOf(r),
          customerOrderId: r.customerOrderId,
          price: null,
          supplierId: mode === 'purchase' ? supplierOf(r) : null,
        },
      ]);
    }
    let all: { id: string; type: string; number: string | null; date: string }[] = [];
    for (const [replenishment, lines] of byMode) {
      const res = await drafts.create.mutateAsync({ replenishment, lines, singleDate, perCustomerOrder, comment: 'Stock needs' });
      if (res) all = [...all, ...res.orders.map(o => ({ id: o.id, type: o.type, number: o.number, date: o.date }))];
    }
    setCreated(all);
    setStep('orders');
    setSel({});
    setQty({});
    setSupplier({});
    setEdits({});
  };

  const postAll = async () => {
    const res = await drafts.post.mutateAsync(created.map(o => o.id));
    if (res) {
      toast(`Posted: ${res.posted.length}${res.failed.length ? ` · failed: ${res.failed.length}` : ''}`);
      setCreated([]);
      void qc.invalidateQueries({ queryKey: calcKey(ws) });
    }
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Stock needs</h1>
          <p>
            What the stock levels ask for: open customer orders, supplier and production orders and approved plans. Three steps: recommendations, planning, orders.
          </p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button onClick={() => void calc.refetch()}>
              <RotateCw size={14} />
              Recalculate
            </Button>
          )}
          {step === 'planning' && canWrite && (
            <Button variant="primary" disabled={!selected.length} onClick={() => void create()}>
              <Send size={14} />
              Create orders
            </Button>
          )}
        </div>
      </div>

      <nav className="tabs doc-tabs" aria-label="Needs sections">
        <button type="button" className={`tab${tab === 'stock' ? ' on' : ''}`} aria-current={tab === 'stock' ? 'page' : undefined} onClick={() => setTab('stock')}>
          Stock needs
        </button>
        <button type="button" className={`tab${tab === 'production' ? ' on' : ''}`} aria-current={tab === 'production' ? 'page' : undefined} onClick={() => setTab('production')}>
          Production orders
        </button>
      </nav>

      {tab === 'production' ? <ProductionOrdersNeeds /> : (
        <>
          <nav className="tabs doc-tabs" aria-label="Steps">
            {STEPS.map(s => (
              <button key={s.id} type="button" className={`tab${step === s.id ? ' on' : ''}`} aria-current={step === s.id ? 'page' : undefined} onClick={() => setStep(s.id)}>
                {s.name}
              </button>
            ))}
          </nav>

          <div className="panel" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="fld" style={{ maxWidth: 180 }}>
              <span className="lbl">Replenishment</span>
              <select className="select" aria-label="Replenishment" value={params.replenishment} onChange={e => set({ replenishment: e.target.value as NeedsCalcParams['replenishment'] })}>
                <option value="all">All</option>
                {Object.entries(STOCK_REPLENISHMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld" style={{ maxWidth: 200 }}>
              <span className="lbl">Method</span>
              <select className="select" aria-label="Method" value={params.method} onChange={e => set({ method: e.target.value as NeedsMethod })}>
                {Object.entries(NEEDS_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld" style={{ maxWidth: 130 }}>
              <span className="lbl">Step</span>
              <select className="select" aria-label="Step" value={params.step} onChange={e => set({ step: e.target.value as NeedsCalcParams['step'] })}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
            <label className="fld" style={{ width: 90 }}>
              <span className="lbl">Periods</span>
              <input className="inp num" type="number" min="1" max="60" aria-label="Periods" value={params.periods} onChange={e => set({ periods: Number(e.target.value) || 1 })} />
            </label>
            <label className="fld" style={{ maxWidth: 160 }}>
              <span className="lbl">From</span>
              <input className="inp" type="date" aria-label="From" value={from} onChange={e => { setFrom(e.target.value); set({ from: e.target.value }); }} />
            </label>
            <label className="fld" style={{ maxWidth: 180 }}>
              <span className="lbl">Warehouse</span>
              <select className="select" aria-label="Warehouse" value={params.warehouseId ?? ''} disabled={!params.byWarehouse} onChange={e => set({ warehouseId: e.target.value || undefined })}>
                <option value="">All warehouses</option>
                {(warehouses.data ?? []).map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld" style={{ width: 60 }}>
              <span className="lbl">By warehouse</span>
              <input type="checkbox" className="check" aria-label="By warehouse" checked={params.byWarehouse} onChange={e => set({ byWarehouse: e.target.checked })} />
            </label>
            <label className="fld" style={{ width: 120 }}>
              <span className="lbl">Safety days</span>
              <input className="inp num" type="number" min="0" max="365" aria-label="Safety days" value={params.safetyDays} onChange={e => set({ safetyDays: Number(e.target.value) || 0 })} />
            </label>
            <label className="fld" style={{ width: 120 }}>
              <span className="lbl">Safety %</span>
              <input className="inp num" type="number" min="-100" max="1000" aria-label="Safety percent" value={params.safetyPct ?? ''} placeholder="0" onChange={e => set({ safetyPct: e.target.value === '' ? undefined : e.target.value })} />
            </label>
          </div>

          {calc.isError ? (
            <EmptyState icon={<CircleAlert size={20} />} error title="Could not calculate the needs" action={<Button size="sm" onClick={() => calc.refetch()}>Retry</Button>}>
              {(calc.error as Error).message}
            </EmptyState>
          ) : calc.isPending ? (
            <div style={{ padding: 16 }}>
              <Skeleton w="100%" h={36} />
            </div>
          ) : !rows.length ? (
            <EmptyState icon={<PackageSearch size={20} />} title="No stock levels">
              The calculation uses the minimum and maximum stock of a product. Set them in the product card, on the Stock levels tab.
            </EmptyState>
          ) : step === 'orders' ? (
            <OrdersStep drafts={created} onPost={() => void postAll()} />
          ) : (
            <div className="table-wrap">
              <table className="dtbl" aria-label="Stock needs">
                <thead>
                  <tr>
                    {step === 'planning' && <th style={{ width: 34 }} />}
                    <th>Product</th>
                    <th style={{ width: 150 }}>Warehouse</th>
                    <th style={{ width: 110 }}>Replenishment</th>
                    <th style={{ width: 90 }} className="r">
                      Balance
                    </th>
                    <th style={{ width: 80 }} className="r">
                      Reserved
                    </th>
                    <th style={{ width: 90 }} className="r">
                      Min / max
                    </th>
                    <th style={{ width: 110 }} className="r">
                      {step === 'planning' ? 'Order' : 'Recommendation'}
                    </th>
                    <th style={{ width: 90 }} className="r">
                      Overdue
                    </th>
                    <th style={{ width: 110 }}>Due</th>
                    <th style={{ width: 100 }} className="r">
                      Amount
                    </th>
                    <th style={{ width: 150 }}>{step === 'planning' ? 'Source' : 'Supplier'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const k = keyOf(r);
                    return (
                      <React.Fragment key={k}>
                        <tr data-row={Number(r.recommendation) > 0 ? 'deficit' : undefined}>
                          {step === 'planning' && (
                            <td>
                              {Number(r.recommendation) > 0 && canWrite && <input type="checkbox" className="check" aria-label={`Select ${r.productName}`} checked={!!sel[k]} onChange={() => setSel(s => ({ ...s, [k]: !s[k] }))} />}
                            </td>
                          )}
                          <td className="trunc">{r.productName}</td>
                          <td className="trunc muted">{r.warehouseName ?? 'Company'}</td>
                          <td className="muted">
                            {step === 'planning' && canWrite ? (
                              <select className="select" aria-label={`Replenishment for ${r.productName}`} value={modeOf(r)} onChange={e => edit(r, { replenishment: e.target.value as StockReplenishment })}>
                                {(Object.keys(STOCK_REPLENISHMENT_LABELS) as StockReplenishment[]).map(m => (
                                  <option key={m} value={m}>
                                    {STOCK_REPLENISHMENT_LABELS[m]}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              STOCK_REPLENISHMENT_LABELS[r.replenishment]
                            )}
                          </td>
                          <td className="r num">{r.balance}</td>
                          <td className="r num muted">{r.reserved}</td>
                          <td className="r num muted">
                            {r.minQty} / {r.maxQty}
                          </td>
                          <td className="r num">
                            {step === 'planning' ? (
                              canWrite ? (
                                <input className="inp num" style={{ width: 90, textAlign: 'right' }} aria-label={`Order ${r.productName}`} type="number" step="0.001" value={qtyOf(r)} onChange={e => setQty(s => ({ ...s, [k]: e.target.value }))} />
                              ) : (
                                <span className="num">{r.recommendation}</span>
                              )
                            ) : Number(r.recommendation) > 0 ? (
                              <Badge tone="amber" dot>
                                {r.recommendation}
                              </Badge>
                            ) : (
                              <span className="faint">—</span>
                            )}
                          </td>
                          <td className="r num">{Number(r.overdue) > 0 ? <span className="num">{r.overdue}</span> : <span className="faint">—</span>}</td>
                          <td className="num muted">
                            {step === 'planning' && canWrite ? (
                              // дата поступления: правится, но не раньше «сегодня + срок»
                              <input className="inp" type="date" aria-label={`Date for ${r.productName}`} min={earliestDate(r, modeOf(r))} value={dateOf(r)} onChange={e => edit(r, { date: e.target.value })} />
                            ) : r.dueDate ? (
                              fmtDate(parse(r.dueDate))
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="r num">{r.amount ?? <span className="faint">—</span>}</td>
                          <td className="trunc muted">
                            {step === 'planning' && canWrite && modeOf(r) === 'production' ? (
                              <select className="select" aria-label={`Work center for ${r.productName}`} value={editOf(r).workCenterId ?? ''} onChange={e => edit(r, { workCenterId: e.target.value || undefined })}>
                                <option value="">Work center…</option>
                                {(workCenters.data?.items ?? []).map(w => (
                                  <option key={w.id} value={w.id}>
                                    {w.name}
                                  </option>
                                ))}
                              </select>
                            ) : step === 'planning' && canWrite && modeOf(r) === 'transfer' ? (
                              <select className="select" aria-label={`Source warehouse for ${r.productName}`} value={editOf(r).sourceWarehouseId ?? r.sourceWarehouseId ?? ''} onChange={e => edit(r, { sourceWarehouseId: e.target.value || undefined })}>
                                <option value="">Source warehouse…</option>
                                {(warehouses.data ?? [])
                                  .filter(w => w.id !== r.warehouseId)
                                  .map(w => (
                                    <option key={w.id} value={w.id}>
                                      {w.name}
                                    </option>
                                  ))}
                              </select>
                            ) : step === 'planning' && canWrite && modeOf(r) === 'purchase' && r.suppliers.length > 0 ? (
                              // поставщик строки — из тех, у кого товар покупали: цена и дата последнего поступления для сравнения
                              <select className="select" aria-label={`Supplier for ${r.productName}`} value={supplierOf(r) ?? ''} onChange={e => setSupplier(s => ({ ...s, [k]: e.target.value }))}>
                                {!r.suppliers.some(x => x.supplierId === r.supplierId) && r.supplierId && <option value={r.supplierId}>{r.supplierName ?? 'Default supplier'}</option>}
                                {r.suppliers.map(x => (
                                  <option key={x.supplierId} value={x.supplierId}>
                                    {x.name}
                                    {x.price ? ` · ${x.price}` : ''}
                                    {x.date ? ` · ${fmtDate(parse(x.date))}` : ''}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              (r.supplierName ?? <span className="faint">No supplier</span>)
                            )}
                          </td>
                        </tr>
                        {step === 'recommendations' && (r.incoming.length > 0 || r.demand.length > 0) && (
                          <tr className="sub">
                            <td colSpan={12}>
                              <details>
                                <summary>
                                  Documents: {r.incoming.length} incoming · {r.demand.length} consumption
                                </summary>
                                <ul className="muted" style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
                                  {r.incoming.map((f, i) => (
                                    <li key={`i${i}`}>
                                      {f.date} · +{f.qty} · {SOURCE_LABEL[f.source] ?? f.source}
                                      {f.label ? ` ${f.label}` : ''}
                                    </li>
                                  ))}
                                  {r.demand.map((f, i) => (
                                    <li key={`d${i}`}>
                                      {f.date} · −{f.qty} · {SOURCE_LABEL[f.source] ?? f.source}
                                      {f.label ? ` ${f.label}` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              {step === 'planning' && (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={fillByDeficit}>
                    Fill by deficit
                  </Button>
                  <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                    <input type="checkbox" className="check" checked={singleDate} onChange={e => setSingleDate(e.target.checked)} />
                    One date for the whole delivery
                  </label>
                  <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                    <input type="checkbox" className="check" checked={perCustomerOrder} onChange={e => setPerCustomerOrder(e.target.checked)} />
                    Separate orders per customer order
                  </label>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Шаг «Orders»: созданные черновики и массовое проведение */
function OrdersStep({ drafts, onPost }: { drafts: { id: string; type: string; number: string | null; date: string }[]; onPost: () => void }) {
  const canWrite = useCanWrite();
  const list = useDraftList(drafts.map(d => d.id));
  const docs = list.data?.items ?? [];
  return (
    <section className="panel" aria-label="Created drafts">
      <div className="ph" style={{ padding: '12px 14px 8px' }}>
        <div>
          <h2 style={{ fontSize: 15 }}>Drafts</h2>
          <span className="faint" style={{ fontSize: 12 }}>
            Documents are created without posting. Post them all at once or open a document to edit it.
          </span>
        </div>
        {canWrite && docs.length > 0 && (
          <Button variant="primary" onClick={onPost}>
            <Send size={14} />
            Post all
          </Button>
        )}
      </div>
      {!drafts.length ? (
        <p className="muted" style={{ padding: 14, margin: 0 }}>
          No drafts yet. Mark the lines on the Planning step and create the orders.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="dtbl" aria-label="Drafts">
            <thead>
              <tr>
                <th>Type</th>
                <th>Number</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d: { id: string; type: string; number: string | null; status: string; date: string }) => (
                <tr key={d.id}>
                  <td>{d.type}</td>
                  <td>
                    <a className="crm-link" href={`/documents/${d.id}`}>
                      {d.number ?? 'draft'}
                    </a>
                  </td>
                  <td className="num muted">{d.date}</td>
                  <td>
                    <Badge tone={d.status === 'posted' ? 'green' : 'gray'} dot>
                      {d.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Карточки созданных черновиков: номер и состояние */
function useDraftList(ids: string[]) {
  const ws = useWsId();
  return useQuery({
    queryKey: ['ws', ws, 'needs-drafts', ids],
    queryFn: async () => {
      const out: { id: string; type: string; number: string | null; status: string; date: string }[] = [];
      for (const id of ids) out.push(await call<{ id: string; type: string; number: string | null; status: string; date: string }>(ws, 'GET', `/documents/${id}`));
      return { items: out };
    },
    enabled: ids.length > 0,
    staleTime: Infinity,
  });
}

/** Вкладка этапа 3: сводная потребность по материалам заказов на производство */
function ProductionOrdersNeeds() {
  const ws = useWsId();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const needs = useProductionNeeds();
  const [sel, setSel] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState(false);
  const rows = needs.data?.items ?? [];
  const withDeficit = rows.filter(r => Number(r.deficit) > 0);
  const selected = withDeficit.filter(r => sel[r.productId]);

  const create = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      const res = await call<SupplierOrdersResult>(ws, 'POST', '/production/needs/supplier-orders', { lines: selected.map(r => ({ productId: r.productId, qty: r.deficit, supplierId: r.supplierId })) });
      const without = res.withoutSupplier.length;
      toast(`Supplier orders created: ${res.orders.length}${without ? ` · ${without} without a supplier` : ''}`);
      setSel({});
      void qc.invalidateQueries({ queryKey: needsKey(ws) });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="table-wrap">
      {canWrite && (
        <div style={{ padding: 12 }}>
          <Button variant="primary" disabled={busy || !selected.length} onClick={() => void create()}>
            <Truck size={14} />
            Create supplier orders
          </Button>
        </div>
      )}
      {!rows.length ? (
        <EmptyState icon={<Factory size={20} />} title="No materials are needed">
          The needs appear when a production order is posted and its materials are not covered by the stock.
        </EmptyState>
      ) : (
        <table className="dtbl" aria-label="Production order needs">
          <thead>
            <tr>
              <th style={{ width: 34 }} />
              <th>Material</th>
              <th style={{ width: 100 }} className="r">
                Needed
              </th>
              <th style={{ width: 100 }} className="r">
                Reserved
              </th>
              <th style={{ width: 100 }} className="r">
                Placed
              </th>
              <th style={{ width: 100 }} className="r">
                Free
              </th>
              <th style={{ width: 100 }} className="r">
                Incoming
              </th>
              <th style={{ width: 110 }} className="r">
                Deficit
              </th>
              <th style={{ width: 170 }}>Supplier</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: ProductionNeedsRow) => (
              <tr key={r.productId} data-row={Number(r.deficit) > 0 ? 'deficit' : undefined}>
                <td>
                  {Number(r.deficit) > 0 && canWrite && <input type="checkbox" className="check" aria-label={`Select ${r.productName}`} checked={!!sel[r.productId]} onChange={() => setSel(prev => ({ ...prev, [r.productId]: !prev[r.productId] }))} />}
                </td>
                <td className="trunc">{r.productName}</td>
                <td className="r num">{r.need}</td>
                <td className="r num">{r.reserved}</td>
                <td className="r num">{r.placed}</td>
                <td className="r num muted">{r.free}</td>
                <td className="r num muted">{r.incoming}</td>
                <td className="r num">{Number(r.deficit) > 0 ? <Badge tone="amber" dot>{r.deficit}</Badge> : <span className="muted">—</span>}</td>
                <td className="trunc muted">{r.supplierName ?? <span className="faint">No supplier</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}