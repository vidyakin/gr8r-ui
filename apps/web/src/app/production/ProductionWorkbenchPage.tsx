/* Рабочее место «Выпуск продукции»: заказы покупателей и заказы на производство с остатком к выпуску.
   Мастера отмечает строки и этапы, выбирает участок-изготовителя и жмёт «Выполнить» — на участок, дату и этап
   создаётся (или дополняется) документ выпуска. */
import * as React from 'react';
import { CircleAlert, Factory, ListChecks, PanelRightClose, PanelRightOpen, Play, RefreshCw, X } from 'lucide-react';
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Input, Segmented, Select, Skeleton } from '@/components/ui';
import { useCanWrite } from '../meta/custom-fields';
import { STATE_LABEL, STATE_TONE } from './orders-data';
import { useWorkbench, useWorkbenchExecute, type WorkbenchMode, type WorkbenchOrder, type WorkbenchRow } from './workbench-data';
import { tProductionEnum, useT } from '@/i18n';

/** Состояние этапа строки: отмечен ли и сколько выпустить */
interface StageState {
  checked: boolean;
  qty: string;
}

interface RowState {
  /** Этапы строки по ключу этапа */
  stages: Record<string, StageState>;
  /** Участок-изготовитель */
  workCenterId: string;
}

const key = (o: WorkbenchOrder, r: WorkbenchRow) => `${o.id}:${r.id}`;
const stageKey = (id: string | null) => id ?? 'final';
const today = () => new Date().toISOString().slice(0, 10);

export function ProductionWorkbenchPage() {
  const canWrite = useCanWrite();
  const tt = useT();
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

  // колонки этапов: объединение этапов всех строк (по порядку первого появления)
  const stageColumns = React.useMemo(() => {
    const map = new Map<string, { id: string | null; name: string }>();
    for (const o of orders)
      for (const r of o.rows)
        for (const st of r.stages) if (!map.has(stageKey(st.id))) map.set(stageKey(st.id), { id: st.id, name: st.name });
    return [...map.values()];
  }, [orders]);

  // состояние строк по умолчанию: остаток и участок заказа (или участок по умолчанию из панели)
  const stateOf = (o: WorkbenchOrder, r: WorkbenchRow): RowState => {
    const k = key(o, r);
    const saved = rows[k];
    if (saved) return saved;
    const stages: Record<string, StageState> = {};
    for (const st of r.stages) stages[stageKey(st.id)] = { checked: false, qty: r.remaining };
    return { stages, workCenterId: o.workCenterId ?? defaultCenter };
  };
  const patch = (o: WorkbenchOrder, r: WorkbenchRow, p: Partial<RowState>) => setRows(prev => ({ ...prev, [key(o, r)]: { ...stateOf(o, r), ...p } }));
  const patchStage = (o: WorkbenchOrder, r: WorkbenchRow, stage: string, p: Partial<StageState>) =>
    setRows(prev => {
      const cur = stateOf(o, r);
      return { ...prev, [key(o, r)]: { ...cur, stages: { ...cur.stages, [stage]: { ...cur.stages[stage], ...p } } } };
    });

  // строка изменилась, если её состояние отличается от исходного
  const changed = React.useMemo(
    () =>
      orders.some(o =>
        o.rows.some(r => {
          const s = stateOf(o, r);
          return Object.values(s.stages).some(x => x.checked) || s.workCenterId !== (o.workCenterId ?? defaultCenter);
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, rows, defaultCenter],
  );

  // «Fill» отмечает следующий доступный этап каждой строки — тот, который можно выполнить сейчас
  const fill = () => {
    const next: Record<string, RowState> = {};
    for (const o of orders)
      for (const r of o.rows) {
        const stages: Record<string, StageState> = {};
        for (const st of r.stages) {
          const k = stageKey(st.id);
          const ready = Number(st.available) > 0;
          const already = r.stages.slice(0, r.stages.indexOf(st)).some(x => Number(x.available) > 0);
          stages[k] = { checked: ready && !already, qty: r.remaining };
        }
        next[key(o, r)] = { stages, workCenterId: o.workCenterId ?? defaultCenter };
      }
    setRows(next);
  };
  const clear = () => setRows({});

  const run = () => {
    const payload = orders.flatMap(o =>
      o.rows.flatMap(r => {
        const s = stateOf(o, r);
        return r.stages.flatMap(st => {
          const state = s.stages[stageKey(st.id)];
          if (!state?.checked) return [];
          return [{ orderId: o.id, source: r.source, lineId: r.id, stageId: st.id, qty: mode === 'extended' ? state.qty : undefined, workCenterId: s.workCenterId || undefined }];
        });
      }),
    );
    if (!payload.length) return;
    execute.mutate(
      { date, mode, rows: payload },
      { onSuccess: () => setRows({}) },
    );
  };

  const marked = orders.reduce((n, o) => n + o.rows.reduce((m, r) => m + Object.values(stateOf(o, r).stages).filter(x => x.checked).length, 0), 0);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('production.workbench.title')}</h1>
          <p>{tt('production.workbench.subtitle')}</p>
        </div>
        <div className="acts">
          <Segmented
            aria-label={tt('production.workbench.modeLabel')}
            value={mode}
            onValueChange={v => setMode(v as WorkbenchMode)}
            items={[
              { value: 'simple', label: tt('production.workbench.mode.simple') },
              { value: 'extended', label: tt('production.workbench.mode.extended') },
            ]}
          />
          <Input aria-label={tt('production.workbench.date')} type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 150 }} />
          <Button onClick={() => void list.refetch()} title={tt('production.common.refresh')}>
            <RefreshCw size={14} />
          </Button>
          <IconButton label={panelOpen ? tt('production.workbench.hidePanel') : tt('production.workbench.showPanel')} onClick={() => setPanelOpen(v => !v)}>
            {panelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </IconButton>
          {canWrite && (
            <Button variant="primary" disabled={!marked || execute.isPending} onClick={() => run()}>
              <Play size={14} />
              {marked ? tt('production.workbench.releaseCount', { count: marked }) : tt('production.workbench.release')}
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: '0 var(--gutter) 24px', minHeight: 0, flex: 1 }}>
        <section className="panel" style={{ flex: 1, minWidth: 0, padding: 0 }}>
          {list.isError ? (
            <EmptyState icon={<CircleAlert size={20} />} error title={tt('production.workbench.loadFailed')} action={<Button size="sm" onClick={() => list.refetch()}>{tt('production.common.retry')}</Button>}>
              {(list.error as Error).message}
            </EmptyState>
          ) : list.isPending ? (
            <div style={{ padding: 16 }}>
              <Skeleton w="100%" h={36} />
            </div>
          ) : !orders.length ? (
            <EmptyState icon={<Factory size={20} />} title={tt('production.workbench.nothingToRelease')}>
              {tt('production.workbench.nothingToReleaseHint')}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="dtbl" aria-label={tt('production.workbench.table')}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <span className="faint">#</span>
                    </th>
                    <th>{tt('production.field.product')}</th>
                    <th style={{ width: 96 }} className="r">
                      {tt('production.workbench.col.ordered')}
                    </th>
                    <th style={{ width: 96 }} className="r">
                      {tt('production.workbench.col.produced')}
                    </th>
                    <th style={{ width: 96 }} className="r">
                      {tt('production.workbench.col.remaining')}
                    </th>
                    {stageColumns.map(st => (
                      <th key={stageKey(st.id)} style={{ width: 150 }}>
                        {st.name}
                      </th>
                    ))}
                    <th style={{ width: 190 }}>{tt('production.field.workCenter')}</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <OrderGroup
                      key={o.id}
                      order={o}
                      stageColumns={stageColumns}
                      stateOf={stateOf}
                      patch={patch}
                      patchStage={patchStage}
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
              <h2>{tt('production.workbench.panel.title')}</h2>
              {changed && <Badge tone="accent">{tt('production.workbench.panel.changed')}</Badge>}
            </div>
            <div style={{ padding: 12, display: 'grid', gap: 12 }}>
              <Field label={tt('production.workbench.panel.search')} hint={tt('production.workbench.panel.searchHint')}>
                {p => <Input {...p} value={q} placeholder={tt('production.workbench.panel.searchPlaceholder')} onChange={e => setQ(e.target.value)} />}
              </Field>
              <Field label={tt('production.workbench.panel.state')}>
                {p => (
                  <Select
                    id={p.id}
                    aria-label={tt('production.workbench.panel.state')}
                    value={state}
                    onValueChange={v => setState(v)}
                    options={[{ value: '', label: tt('production.workbench.panel.anyState') }, ...Object.entries(STATE_LABEL).map(([value, label]) => ({ value, label: tProductionEnum('productionOrderState', value, label) }))]}
                  />
                )}
              </Field>
              <Field label={tt('production.workbench.panel.plannedUntil')} hint={tt('production.workbench.panel.plannedUntilHint')}>
                {p => <Input {...p} type="date" value={to} onChange={e => setTo(e.target.value)} />}
              </Field>
              <Field label={tt('production.workbench.panel.defaultCenter')} hint={tt('production.workbench.panel.defaultCenterHint')}>
                {p => (
                  <Select
                    id={p.id}
                    aria-label={tt('production.workbench.panel.defaultCenter')}
                    value={defaultCenter}
                    onValueChange={v => setDefaultCenter(v)}
                    options={[{ value: '', label: tt('production.workbench.panel.notChosen') }, ...centers.map(c => ({ value: c.id, label: c.name }))]}
                  />
                )}
              </Field>
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" onClick={fill}>
                  <ListChecks size={13} />
                  {tt('production.workbench.panel.fill')}
                </Button>
                <Button size="sm" variant="ghost" onClick={clear} disabled={!Object.keys(rows).length}>
                  <X size={13} />
                  {tt('production.workbench.panel.clear')}
                </Button>
              </div>
              <p className="faint" style={{ fontSize: 12, margin: 0 }}>
                {tt('production.workbench.panel.modeHint')}
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
  stageColumns,
  stateOf,
  patch,
  patchStage,
  mode,
  centers,
  canWrite,
  onPatchAll,
}: {
  order: WorkbenchOrder;
  stageColumns: { id: string | null; name: string }[];
  stateOf: (o: WorkbenchOrder, r: WorkbenchRow) => RowState;
  patch: (o: WorkbenchOrder, r: WorkbenchRow, p: Partial<RowState>) => void;
  patchStage: (o: WorkbenchOrder, r: WorkbenchRow, stage: string, p: Partial<StageState>) => void;
  mode: WorkbenchMode;
  centers: { id: string; name: string }[];
  canWrite: boolean;
  onPatchAll: (p: Partial<RowState>, rows: WorkbenchRow[]) => void;
}) {
  const tt = useT();
  const center = stateOf(order, order.rows[0]).workCenterId;
  const all = order.rows.every(r => r.stages.every(st => stateOf(order, r).stages[stageKey(st.id)]?.checked));
  return (
    <>
      <tr>
        <td colSpan={6 + stageColumns.length} style={{ background: 'var(--surface-2, rgba(127,127,127,0.06))', padding: '6px 10px' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <strong style={{ fontWeight: 550 }}>{order.number ?? tt('production.common.draft')}</strong>
            <span className="faint">{order.type === 'customer_order' ? tt('production.workbench.customerOrder') : tt('production.workbench.productionOrder')}</span>
            {order.state && <Badge tone={STATE_TONE[order.state] ?? 'gray'}>{tProductionEnum('productionOrderState', order.state, STATE_LABEL[order.state] ?? order.state)}</Badge>}
            {order.counterparty && <span className="muted">{order.counterparty.name}</span>}
            {order.workCenterName && <span className="faint">· {order.workCenterName}</span>}
            {order.dueDate && <span className="faint">· {order.dueDate}</span>}
            {canWrite && (
              <div className="row" style={{ gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
                <Select
                  aria-label={tt('production.workbench.forOrder')}
                  size="sm"
                  value={center}
                  onValueChange={v => onPatchAll({ workCenterId: v }, order.rows)}
                  options={[{ value: '', label: tt('production.workbench.noWorkCenter') }, ...centers.map(c => ({ value: c.id, label: c.name }))]}
                  className="w-auto"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    for (const r of order.rows) for (const st of r.stages) patchStage(order, r, stageKey(st.id), { checked: !all });
                  }}
                >
                  {all ? tt('production.workbench.uncheckAll') : tt('production.workbench.checkAll')}
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
              {canWrite ? (
                <Checkbox
                  aria-label={tt('production.workbench.releaseLine', { name: r.productName })}
                  checked={r.stages.length > 0 && r.stages.every(st => s.stages[stageKey(st.id)]?.checked)}
                  onChange={e => {
                    for (const st of r.stages) patchStage(order, r, stageKey(st.id), { checked: e.target.checked });
                  }}
                />
              ) : (
                <span className="faint">{r.stages.length && r.stages.every(st => Number(st.done) > 0) ? '✓' : ''}</span>
              )}
            </td>
            <td>
              <span className="trunc">{r.productName}</span>
              {r.productionKindName && <span className="faint" style={{ marginLeft: 6 }}>{r.productionKindName}</span>}
            </td>
            <td className="r num">{r.qty}</td>
            <td className="r num muted">{r.produced}</td>
            <td className="r num">{r.remaining}</td>
            {stageColumns.map(col => {
              const st = r.stages.find(x => stageKey(x.id) === stageKey(col.id));
              if (!st) return <td key={stageKey(col.id)} />;
              const state = s.stages[stageKey(col.id)] ?? { checked: false, qty: r.remaining };
              return (
                <td key={stageKey(col.id)}>
                  {canWrite ? (
                    <div className="row" style={{ gap: 6 }}>
                      <Checkbox
                        aria-label={tt('production.workbench.releaseStage', { stage: st.name, name: r.productName })}
                        checked={state.checked}
                        disabled={Number(st.available) <= 0}
                        onChange={e => patchStage(order, r, stageKey(col.id), { checked: e.target.checked })}
                      />
                      {mode === 'extended' ? (
                        <Input aria-label={tt('production.workbench.qtyStage', { stage: st.name })} inputMode="decimal" value={state.qty} onChange={e => patchStage(order, r, stageKey(col.id), { qty: e.target.value })} />
                      ) : (
                        <span className="num faint">{st.remaining}</span>
                      )}
                    </div>
                  ) : (
                    <span className="num faint">{st.remaining}</span>
                  )}
                </td>
              );
            })}
            <td>
              {canWrite ? (
                <Select
                  aria-label={tt('production.field.workCenter')}
                  size="sm"
                  value={s.workCenterId}
                  onValueChange={v => patch(order, r, { workCenterId: v })}
                  options={[{ value: '', label: tt('production.workbench.noWorkCenter') }, ...centers.map(c => ({ value: c.id, label: c.name }))]}
                />
              ) : (
                <span className="faint">—</span>
              )}
            </td>
            <td />
          </tr>
        );
      })}
    </>
  );
}
