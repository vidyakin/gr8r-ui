/* Экран расчёта потребностей (обработка УНФ «Расчёт потребностей в запасах»): три шага —
   Recommendations → Planning → Orders. Открывается из Purchases, Stock и Production; справа настройки расчёта:
   способ пополнения, методика, шаг и число периодов, начало горизонта, учёт по складам или по компании.
   Вкладка «Production orders» — сводная потребность этапа 3 по материалам заказов на производство. */
import * as React from 'react';
import { handleNumericArrow } from '@/lib/numeric-step';
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
import { tProductionEnum, useT } from '@/i18n';

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
  const tt = useT();
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
      const res = await drafts.create.mutateAsync({ replenishment, lines, singleDate, perCustomerOrder, comment: tt('production.needs.comment') });
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
      toast(tt('production.needs.postResult', { posted: res.posted.length, failed: res.failed.length }));
      setCreated([]);
      void qc.invalidateQueries({ queryKey: calcKey(ws) });
    }
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('production.needs.title')}</h1>
          <p>{tt('production.needs.subtitle')}</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button onClick={() => void calc.refetch()}>
              <RotateCw size={14} />
              {tt('production.needs.recalculate')}
            </Button>
          )}
          {step === 'planning' && canWrite && (
            <Button variant="primary" disabled={!selected.length} onClick={() => void create()}>
              <Send size={14} />
              {tt('production.needs.createOrders')}
            </Button>
          )}
        </div>
      </div>

      <nav className="tabs doc-tabs" aria-label={tt('production.needs.tabs')}>
        <button type="button" className={`tab${tab === 'stock' ? ' on' : ''}`} aria-current={tab === 'stock' ? 'page' : undefined} onClick={() => setTab('stock')}>
          {tt('production.needs.tabStock')}
        </button>
        <button type="button" className={`tab${tab === 'production' ? ' on' : ''}`} aria-current={tab === 'production' ? 'page' : undefined} onClick={() => setTab('production')}>
          {tt('production.needs.tabProduction')}
        </button>
      </nav>

      {tab === 'production' ? <ProductionOrdersNeeds /> : (
        <>
          <nav className="tabs doc-tabs" aria-label={tt('production.needs.stepsLabel')}>
            {STEPS.map(s => (
              <button key={s.id} type="button" className={`tab${step === s.id ? ' on' : ''}`} aria-current={step === s.id ? 'page' : undefined} onClick={() => setStep(s.id)}>
                {tt(`production.needs.steps.${s.id}`)}
              </button>
            ))}
          </nav>

          <div className="panel" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="fld" style={{ maxWidth: 180 }}>
              <span className="lbl">{tt('production.needs.replenishment')}</span>
              <select className="select" aria-label={tt('production.needs.replenishment')} value={params.replenishment} onChange={e => set({ replenishment: e.target.value as NeedsCalcParams['replenishment'] })}>
                <option value="all">{tt('production.needs.sourceAll')}</option>
                {Object.entries(STOCK_REPLENISHMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld" style={{ maxWidth: 200 }}>
              <span className="lbl">{tt('production.needs.method')}</span>
              <select className="select" aria-label={tt('production.needs.method')} value={params.method} onChange={e => set({ method: e.target.value as NeedsMethod })}>
                {Object.entries(NEEDS_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld" style={{ maxWidth: 130 }}>
              <span className="lbl">{tt('production.needs.step')}</span>
              <select className="select" aria-label={tt('production.needs.step')} value={params.step} onChange={e => set({ step: e.target.value as NeedsCalcParams['step'] })}>
                <option value="day">{tt('production.needs.stepDay')}</option>
                <option value="week">{tt('production.needs.stepWeek')}</option>
                <option value="month">{tt('production.needs.stepMonth')}</option>
              </select>
            </label>
            <label className="fld" style={{ width: 90 }}>
              <span className="lbl">{tt('production.needs.periods')}</span>
              <input className="inp num" type="number" min="1" max="60" aria-label={tt('production.needs.periods')} value={params.periods} onChange={e => set({ periods: Number(e.target.value) || 1 })} />
            </label>
            <label className="fld" style={{ maxWidth: 160 }}>
              <span className="lbl">{tt('production.needs.from')}</span>
              <input className="inp" type="date" aria-label={tt('production.needs.from')} value={from} onChange={e => { setFrom(e.target.value); set({ from: e.target.value }); }} />
            </label>
            <label className="fld" style={{ maxWidth: 180 }}>
              <span className="lbl">{tt('production.needs.warehouseLabel')}</span>
              <select className="select" aria-label={tt('production.needs.warehouseLabel')} value={params.warehouseId ?? ''} disabled={!params.byWarehouse} onChange={e => set({ warehouseId: e.target.value || undefined })}>
                <option value="">{tt('production.needs.warehouseAny')}</option>
                {(warehouses.data ?? []).map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld" style={{ width: 60 }}>
              <span className="lbl">{tt('production.needs.byWarehouse')}</span>
              <input type="checkbox" className="check" aria-label={tt('production.needs.byWarehouse')} checked={params.byWarehouse} onChange={e => set({ byWarehouse: e.target.checked })} />
            </label>
            <label className="fld" style={{ width: 120 }}>
              <span className="lbl">{tt('production.needs.safetyDays')}</span>
              <input className="inp num" type="number" min="0" max="365" aria-label={tt('production.needs.safetyDays')} value={params.safetyDays} onChange={e => set({ safetyDays: Number(e.target.value) || 0 })} />
            </label>
            <label className="fld" style={{ width: 120 }}>
              <span className="lbl">{tt('production.needs.safetyPct')}</span>
              <input className="inp num" type="number" min="-100" max="1000" aria-label={tt('production.needs.safetyPct')} value={params.safetyPct ?? ''} placeholder={'0'} onChange={e => set({ safetyPct: e.target.value === '' ? undefined : e.target.value })} />
            </label>
          </div>

          {calc.isError ? (
            <EmptyState icon={<CircleAlert size={20} />} error title={tt('production.needs.loadFailed')} action={<Button size="sm" onClick={() => calc.refetch()}>{tt('production.common.retry')}</Button>}>
              {(calc.error as Error).message}
            </EmptyState>
          ) : calc.isPending ? (
            <div style={{ padding: 16 }}>
              <Skeleton w="100%" h={36} />
            </div>
          ) : !rows.length ? (
            <EmptyState icon={<PackageSearch size={20} />} title={tt('production.needs.emptyTitle')}>
              {tt('production.needs.emptyHint')}
            </EmptyState>
          ) : step === 'orders' ? (
            <OrdersStep drafts={created} onPost={() => void postAll()} />
          ) : (
            <div className="table-wrap">
              <table className="dtbl" aria-label={tt('production.needs.table')}>
                <thead>
                  <tr>
                    {step === 'planning' && <th style={{ width: 34 }} />}
                    <th>{tt('production.needs.col.product')}</th>
                    <th style={{ width: 150 }}>{tt('production.needs.col.warehouse')}</th>
                    <th style={{ width: 110 }}>{tt('production.needs.col.replenishment')}</th>
                    <th style={{ width: 90 }} className="r">
                      {tt('production.needs.col.balance')}
                    </th>
                    <th style={{ width: 80 }} className="r">
                      {tt('production.needs.col.reserved')}
                    </th>
                    <th style={{ width: 90 }} className="r">
                      {tt('production.needs.col.minmax')}
                    </th>
                    <th style={{ width: 110 }} className="r">
                      {step === 'planning' ? tt('production.needs.col.order') : tt('production.needs.col.recommendation')}
                    </th>
                    <th style={{ width: 90 }} className="r">
                      {tt('production.needs.col.overdue')}
                    </th>
                    <th style={{ width: 110 }}>{tt('production.needs.col.due')}</th>
                    <th style={{ width: 100 }} className="r">
                      {tt('production.needs.col.amount')}
                    </th>
                    <th style={{ width: 150 }}>{step === 'planning' ? tt('production.needs.col.source') : tt('production.needs.col.supplier')}</th>
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
                              {Number(r.recommendation) > 0 && canWrite && <input type="checkbox" className="check" aria-label={tt('production.needs.selectRow', { name: r.productName })} checked={!!sel[k]} onChange={() => setSel(s => ({ ...s, [k]: !s[k] }))} />}
                            </td>
                          )}
                          <td className="trunc">{r.productName}</td>
                          <td className="trunc muted">{r.warehouseName ?? tt('production.needs.company')}</td>
                          <td className="muted">
                            {step === 'planning' && canWrite ? (
                              <select className="select" aria-label={tt('production.needs.replenishmentFor', { name: r.productName })} value={modeOf(r)} onChange={e => edit(r, { replenishment: e.target.value as StockReplenishment })}>
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
                                <input className="inp num" style={{ width: 90, textAlign: 'right' }} aria-label={tt('production.needs.orderFor', { name: r.productName })} inputMode="decimal" value={qtyOf(r)} onChange={e => setQty(s => ({ ...s, [k]: e.target.value }))} onKeyDown={handleNumericArrow} />
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
                              <input className="inp" type="date" aria-label={tt('production.needs.dateFor', { name: r.productName })} min={earliestDate(r, modeOf(r))} value={dateOf(r)} onChange={e => edit(r, { date: e.target.value })} />
                            ) : r.dueDate ? (
                              fmtDate(parse(r.dueDate))
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="r num">{r.amount ?? <span className="faint">—</span>}</td>
                          <td className="trunc muted">
                            {step === 'planning' && canWrite && modeOf(r) === 'production' ? (
                              <select className="select" aria-label={tt('production.needs.workCenterFor', { name: r.productName })} value={editOf(r).workCenterId ?? ''} onChange={e => edit(r, { workCenterId: e.target.value || undefined })}>
                                <option value="">{tt('production.needs.workCenterPlaceholder')}</option>
                                {(workCenters.data?.items ?? []).map(w => (
                                  <option key={w.id} value={w.id}>
                                    {w.name}
                                  </option>
                                ))}
                              </select>
                            ) : step === 'planning' && canWrite && modeOf(r) === 'transfer' ? (
                              <select className="select" aria-label={tt('production.needs.sourceWarehouseFor', { name: r.productName })} value={editOf(r).sourceWarehouseId ?? r.sourceWarehouseId ?? ''} onChange={e => edit(r, { sourceWarehouseId: e.target.value || undefined })}>
                                <option value="">{tt('production.needs.sourceWarehousePlaceholder')}</option>
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
                              <select className="select" aria-label={tt('production.needs.supplierFor', { name: r.productName })} value={supplierOf(r) ?? ''} onChange={e => setSupplier(s => ({ ...s, [k]: e.target.value }))}>
                                {!r.suppliers.some(x => x.supplierId === r.supplierId) && r.supplierId && <option value={r.supplierId}>{r.supplierName ?? tt('production.needs.defaultSupplier')}</option>}
                                {r.suppliers.map(x => (
                                  <option key={x.supplierId} value={x.supplierId}>
                                    {x.name}
                                    {x.price ? ` · ${x.price}` : ''}
                                    {x.date ? ` · ${fmtDate(parse(x.date))}` : ''}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              (r.supplierName ?? <span className="faint">{tt('production.needs.noSupplier')}</span>)
                            )}
                          </td>
                        </tr>
                        {step === 'recommendations' && (r.incoming.length > 0 || r.demand.length > 0) && (
                          <tr className="sub">
                            <td colSpan={12}>
                              <details>
                                <summary>
                                  {tt('production.needs.docsSummary', { incoming: r.incoming.length, demand: r.demand.length })}
                                </summary>
                                <ul className="muted" style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
                                  {r.incoming.map((f, i) => (
                                    <li key={`i${i}`}>
                                      {f.date} · +{f.qty} · {tProductionEnum('needSource', f.source, SOURCE_LABEL[f.source] ?? f.source)}
                                      {f.label ? ` ${f.label}` : ''}
                                    </li>
                                  ))}
                                  {r.demand.map((f, i) => (
                                    <li key={`d${i}`}>
                                      {f.date} · −{f.qty} · {tProductionEnum('needSource', f.source, SOURCE_LABEL[f.source] ?? f.source)}
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
                    {tt('production.needs.fillByDeficit')}
                  </Button>
                  <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                    <input type="checkbox" className="check" checked={singleDate} onChange={e => setSingleDate(e.target.checked)} />
                    {tt('production.needs.singleDate')}
                  </label>
                  <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                    <input type="checkbox" className="check" checked={perCustomerOrder} onChange={e => setPerCustomerOrder(e.target.checked)} />
                    {tt('production.needs.perCustomerOrder')}
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
  const tt = useT();
  const list = useDraftList(drafts.map(d => d.id));
  const docs = list.data?.items ?? [];
  return (
    <section className="panel" aria-label={tt('production.needs.draftsLabel')}>
      <div className="ph" style={{ padding: '12px 14px 8px' }}>
        <div>
          <h2 style={{ fontSize: 15 }}>{tt('production.needs.draftsTitle')}</h2>
          <span className="faint" style={{ fontSize: 12 }}>
            {tt('production.needs.draftsHint')}
          </span>
        </div>
        {canWrite && docs.length > 0 && (
          <Button variant="primary" onClick={onPost}>
            <Send size={14} />
            {tt('production.needs.postAll')}
          </Button>
        )}
      </div>
      {!drafts.length ? (
        <p className="muted" style={{ padding: 14, margin: 0 }}>
          {tt('production.needs.noDrafts')}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="dtbl" aria-label={tt('production.needs.draftsTable')}>
            <thead>
              <tr>
                <th>{tt('production.needs.col.type')}</th>
                <th>{tt('production.needs.col.number')}</th>
                <th>{tt('production.needs.col.date')}</th>
                <th>{tt('production.needs.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d: { id: string; type: string; number: string | null; status: string; date: string }) => (
                <tr key={d.id}>
                  <td>{d.type}</td>
                  <td>
                    <a className="crm-link" href={`/documents/${d.id}`}>
                      {d.number ?? tt('production.common.draft')}
                    </a>
                  </td>
                  <td className="num muted">{d.date}</td>
                  <td>
                    <Badge tone={d.status === 'posted' ? 'green' : 'gray'} dot>
                      {tProductionEnum('docStatus', d.status, d.status)}
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
  const tt = useT();
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
      toast(tt('production.needs.supplierOrdersResult', { count: res.orders.length, without }));
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
            {tt('production.needs.createSupplierOrders')}
          </Button>
        </div>
      )}
      {!rows.length ? (
        <EmptyState icon={<Factory size={20} />} title={tt('production.needs.noMaterialsTitle')}>
          {tt('production.needs.noMaterialsHint')}
        </EmptyState>
      ) : (
        <table className="dtbl" aria-label={tt('production.needs.poTable')}>
          <thead>
            <tr>
              <th style={{ width: 34 }} />
              <th>{tt('production.needs.col.material')}</th>
              <th style={{ width: 100 }} className="r">
                {tt('production.needs.col.needed')}
              </th>
              <th style={{ width: 100 }} className="r">
                {tt('production.needs.col.reserved')}
              </th>
              <th style={{ width: 100 }} className="r">
                {tt('production.needs.col.placed')}
              </th>
              <th style={{ width: 100 }} className="r">
                {tt('production.needs.col.free')}
              </th>
              <th style={{ width: 100 }} className="r">
                {tt('production.needs.col.incoming')}
              </th>
              <th style={{ width: 110 }} className="r">
                {tt('production.needs.col.deficit')}
              </th>
              <th style={{ width: 170 }}>{tt('production.needs.col.supplier')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: ProductionNeedsRow) => (
              <tr key={r.productId} data-row={Number(r.deficit) > 0 ? 'deficit' : undefined}>
                <td>
                  {Number(r.deficit) > 0 && canWrite && <input type="checkbox" className="check" aria-label={tt('production.needs.selectRow', { name: r.productName })} checked={!!sel[r.productId]} onChange={() => setSel(prev => ({ ...prev, [r.productId]: !prev[r.productId] }))} />}
                </td>
                <td className="trunc">{r.productName}</td>
                <td className="r num">{r.need}</td>
                <td className="r num">{r.reserved}</td>
                <td className="r num">{r.placed}</td>
                <td className="r num muted">{r.free}</td>
                <td className="r num muted">{r.incoming}</td>
                <td className="r num">{Number(r.deficit) > 0 ? <Badge tone="amber" dot>{r.deficit}</Badge> : <span className="muted">—</span>}</td>
                <td className="trunc muted">{r.supplierName ?? <span className="faint">{tt('production.needs.noSupplier')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
