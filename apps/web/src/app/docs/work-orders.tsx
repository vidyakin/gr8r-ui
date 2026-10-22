/* Заказ-наряд: журнал и карточка. Состояния задаёт воркспейс (у каждого вида свои), логика — по категории:
   вход в «выполнен» проводит заказ-наряд как продажу, отмена требует причины. */
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CircleAlert, CircleDot, ClipboardList, FilePlus, Plus, Trash2 } from 'lucide-react';
import { WORK_ORDER_BILLING_LABELS, WORK_ORDER_BILLING_MODES, WORK_ORDER_CATEGORY_LABELS, type WorkOrderBillingMode, type WorkOrderStateCategory } from '@gr8r/shared';
import type { Tone } from '@/components/ui';
import { Badge, Button, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState } from '@/components/gr8r/filter-bar';
import { useCanWrite } from '../meta/custom-fields';
import { money } from '../catalog/data';
import { fmtDate, parse } from '../lib/dates';
import { useWorkspace } from '../data/store';
import { STATUS_LABEL, STATUS_TONE, docsKey, useDocsApi, useDocumentStates, useWorkOrderKinds, useWorkOrderTime, useWorkOrders, type DocDetail, type WorkOrderAssignment, type WorkOrderListItem } from './data';
import { useQueryClient } from '@tanstack/react-query';
import { useWsId } from '../meta/data';
import { DocumentResourcesPanel } from '../production/ProductionOrderPage';

/** Тон бейджа по категории состояния */
const CATEGORY_TONE: Record<WorkOrderStateCategory, Tone> = {
  new: 'neutral',
  scheduled: 'accent',
  in_progress: 'amber',
  done: 'green',
  delivered: 'violet',
  cancelled: 'red',
};

/* ---------------- журнал ---------------- */

export function WorkOrdersPage() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const canWrite = useCanWrite();
  const api = useDocsApi();
  const filters = useFilterState();
  const states = useDocumentStates();
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(t);
  }, [filters.q]);
  const state = sp.get('state') ?? undefined;
  const status = filters.values.status?.[0];
  const list = useWorkOrders({ state, status, q: q || undefined });
  const rows = list.data?.items ?? [];
  const sum = list.data?.sum;

  const columns: Column<WorkOrderListItem>[] = [
    { id: 'number', header: 'Number', width: 150, value: d => d.number ?? '', cell: d => (d.number ? <span className="mono" style={{ fontWeight: 450 }}>{d.number}</span> : <span className="faint">Draft</span>) },
    { id: 'state', header: 'State', width: 170, value: d => d.stateLabel ?? '', cell: d => (d.stateLabel ? <Badge tone={CATEGORY_TONE[d.category ?? 'new']}>{d.stateLabel}</Badge> : <span className="faint">—</span>) },
    { id: 'kind', header: 'Kind', width: 150, defaultHidden: true, value: d => d.kindName ?? '', cell: d => <span className="trunc muted">{d.kindName ?? '—'}</span> },
    { id: 'date', header: 'Date', width: 112, value: d => d.date, cell: d => <span className="num muted">{fmtDate(parse(d.date))}</span> },
    { id: 'customer', header: 'Customer', width: 240, value: d => d.counterpartyName ?? '', cell: d => (d.counterpartyName ? <span className="trunc">{d.counterpartyName}</span> : <span className="faint">—</span>) },
    { id: 'status', header: 'Status', width: 112, value: d => STATUS_LABEL[d.status], cell: d => <Badge tone={STATUS_TONE[d.status]} dot>{STATUS_LABEL[d.status]}</Badge> },
    { id: 'total', header: 'Total', width: 132, align: 'right', value: d => Number(d.total), cell: d => <span className="num" style={{ fontWeight: 500 }}>{money(d.total)}</span>, total: () => (sum ? <span className="num" style={{ fontWeight: 600 }}>{money(sum.total)}</span> : null) },
  ];
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });

  const create = async () => {
    const r = await api<DocDetail>('POST', '/documents', { type: 'work_order' });
    if (r) navigate(`/documents/${r.id}`);
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Work orders</h1>
          <p>Works, goods and materials of a service job. The work order is posted when it reaches the Done state.</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button variant="primary" onClick={() => void create()}>
              <Plus size={14} />
              New work order
            </Button>
          )}
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: 'Search by number or comment' }}
        fields={[
          { id: 'status', name: 'Status', icon: <CircleDot size={15} />, options: [{ id: 'draft', name: 'Draft' }, { id: 'posted', name: 'Posted' }, { id: 'cancelled', name: 'Cancelled' }] },
        ]}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      <div className="doc-tabs-wrap">
        <nav className="tabs doc-tabs" aria-label="Work order states">
          <button type="button" className={!state ? 'tab on' : 'tab'} aria-current={!state ? 'page' : undefined} onClick={() => setSp(p => { const n = new URLSearchParams(p); n.delete('state'); return n; }, { replace: true })}>
            All
          </button>
          {states.data?.map(s => (
            <button
              key={s.id}
              type="button"
              className={state === s.key ? 'tab on' : 'tab'}
              aria-current={state === s.key ? 'page' : undefined}
              onClick={() => setSp(p => { const n = new URLSearchParams(p); n.set('state', s.key); return n; }, { replace: true })}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load work orders" action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<ClipboardList size={20} />} title="No work orders yet" action={canWrite ? <Button size="sm" onClick={() => void create()}>New work order</Button> : undefined}>
          Work orders combine works, goods and materials of a service job.
        </EmptyState>
      ) : (
        <DataTable
          aria-label="Work orders"
          columns={columns}
          rows={rows}
          table={table}
          getId={d => d.id}
          onRowClick={d => navigate(`/documents/${d.id}`)}
          showTotals={rows.length > 0}
          totalLabel="Total"
        />
      )}
    </div>
  );
}

/* ---------------- карточка: состояние, материалы и исполнители ---------------- */

export function WorkOrderPanel({ doc }: { doc: DocDetail }) {
  const qc = useQueryClient();
  const ws = useWsId();
  const api = useDocsApi();
  const canWrite = useCanWrite();
  const members = useWorkspace().data.members;
  const kinds = useWorkOrderKinds();
  const time = useWorkOrderTime(doc.id);
  const [reason, setReason] = React.useState('');
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);

  const kindStates = doc.states ?? [];
  const current = kindStates.find(s => s.key === doc.state) ?? null;

  const changeState = async (key: string, cancelReason?: string) => {
    setPending(key);
    const r = await api<DocDetail>('POST', `/documents/${doc.id}/state`, { state: key, ...(cancelReason ? { cancelReason } : {}) });
    setPending(null);
    if (r) {
      setCancelOpen(false);
      setReason('');
      qc.invalidateQueries({ queryKey: docsKey(ws, 'doc', doc.id) });
    }
  };

  const onPickState = (key: string) => {
    const target = kindStates.find(s => s.key === key);
    if (target?.category === 'cancelled') {
      setCancelOpen(true);
      return;
    }
    void changeState(key);
  };

  const saveMaterials = async (materials: { id?: string; productId: string; qty: string }[]) => {
    const r = await api('POST', `/work-orders/${doc.id}/materials`, { materials });
    if (r) qc.invalidateQueries({ queryKey: docsKey(ws, 'doc', doc.id) });
  };

  const removeMaterial = async (id: string) => {
    await saveMaterials((doc.materials ?? []).filter(m => m.id !== id).map(m => ({ id: m.id, productId: m.productId, qty: m.qty })));
  };

  const addAssignment = async (assigneeId: string) => {
    if (!assigneeId) return;
    const r = await api('POST', `/work-orders/${doc.id}/assignments`, { assigneeId });
    if (r) qc.invalidateQueries({ queryKey: docsKey(ws, 'doc', doc.id) });
  };

  const removeAssignment = async (taskId: string) => {
    const r = await api('DELETE', `/work-order-assignments/${taskId}`);
    if (r) qc.invalidateQueries({ queryKey: docsKey(ws, 'doc', doc.id) });
  };

  // часовой интервал назначения: перегрузка и работа вне смены — предупреждение
  const saveInterval = async (a: WorkOrderAssignment, startAt: string, endAt: string) => {
    const r = await api<{ warnings: { message: string }[] }>('PATCH', `/work-order-assignments/${a.taskId}`, { startAt, endAt });
    if (r) {
      qc.invalidateQueries({ queryKey: docsKey(ws, 'doc', doc.id) });
      for (const w of r.warnings ?? []) toast.info(w.message, { duration: 6000 });
    }
  };

  /** Локальное значение datetime-local из ISO */
  const toLocalInput = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /** Новая пара «начало–конец» после правки одного края */
  const interval = (a: WorkOrderAssignment, edge: 'start' | 'end', value: string) => {
    const hours = Number(a.plannedHours ?? 0) || 2;
    const start = edge === 'start' ? new Date(value) : a.startAt ? new Date(a.startAt) : new Date(new Date(value).getTime() - hours * 3_600_000);
    const end = edge === 'end' ? new Date(value) : a.endAt ? new Date(a.endAt) : new Date(start.getTime() + hours * 3_600_000);
    return { startAt: start.toISOString(), endAt: end.toISOString() };
  };

  // способ выставления строки работы: по норме или по фактическим часам (список строк заменяется целиком)
  const saveBilling = async (lineId: string, billing: WorkOrderBillingMode) => {
    const lines = (time.data?.lines ?? []).map(l => ({ lineId: l.lineId, billing: l.lineId === lineId ? billing : l.billing }));
    const r = await api('POST', `/work-orders/${doc.id}/billing`, { lines });
    if (r) {
      qc.invalidateQueries({ queryKey: docsKey(ws, 'wo-time', doc.id) });
      qc.invalidateQueries({ queryKey: docsKey(ws, 'doc', doc.id) });
    }
  };

  const editable = canWrite && doc.status === 'draft';

  return (
    <>
      <section className="doc-head panel" aria-label="Work order state">
        <Field label="Kind">
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={doc.kindId ?? ''}
              onValueChange={v => void api('PATCH', `/documents/${doc.id}`, { workOrderKindId: v }).then(() => qc.invalidateQueries({ queryKey: docsKey(ws, 'doc', doc.id) }))}
              options={(kinds.data ?? []).map(k => ({ value: k.id, label: k.name }))}
              aria-label="Kind of work order"
            />
          )}
        </Field>
        <Field label="State" hint={current ? WORK_ORDER_CATEGORY_LABELS[current.category] : undefined}>
          {p => (
            <Select
              id={p.id}
              disabled={!canWrite || pending !== null}
              value={doc.state ?? ''}
              onValueChange={onPickState}
              options={kindStates.map(s => ({ value: s.key, label: `${s.label} · ${WORK_ORDER_CATEGORY_LABELS[s.category]}` }))}
              aria-label="State of the work order"
            />
          )}
        </Field>
      </section>

      <section className="doc-lines panel" aria-label="Works">
        <h2>Works</h2>
        <div className="table-wrap">
          <table className="dtbl" aria-label="Work lines of the work order">
            <thead>
              <tr>
                <th>Work</th>
                <th style={{ width: 90 }} className="r">
                  Qty
                </th>
                <th style={{ width: 170 }}>Billing</th>
                <th style={{ width: 90 }} className="r">
                  Hours
                </th>
              </tr>
            </thead>
            <tbody>
              {(time.data?.lines ?? []).map(l => {
                const line = (doc.lines ?? []).find(x => x.id === l.lineId);
                return (
                  <tr key={l.lineId}>
                    <td>{l.name}</td>
                    <td className="r num">{line?.qty ?? '—'}</td>
                    <td>
                      <Select
                        aria-label={`Billing of ${l.name}`}
                        disabled={!editable}
                        value={l.billing}
                        onValueChange={v => void saveBilling(l.lineId, v as WorkOrderBillingMode)}
                        options={WORK_ORDER_BILLING_MODES.map(m => ({ value: m, label: WORK_ORDER_BILLING_LABELS[m] }))}
                      />
                    </td>
                    <td className="r num">{l.actualHours}</td>
                  </tr>
                );
              })}
              {!(time.data?.lines ?? []).length && (
                <tr>
                  <td colSpan={4} className="faint" style={{ textAlign: 'center', padding: 18 }}>
                    No works in the work order: add a line of the “Work” type.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && (
          <p className="faint" style={{ margin: '8px 0 0' }}>
            A work billed by actual hours takes the logged time of its assignments as the quantity — the order is recalculated before it is posted.
          </p>
        )}
      </section>

      <section className="doc-lines panel" aria-label="Materials">
        <h2>Materials</h2>
        <div className="table-wrap">
          <table className="dtbl" aria-label="Materials of the work order">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ width: 70 }} className="r">
                  Qty
                </th>
                <th style={{ width: 150 }}>Warehouse</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {(doc.materials ?? []).map(m => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="r num">{m.qty}</td>
                  <td className="muted">{m.warehouseName ?? '—'}</td>
                  <td>
                    {editable && (
                      <IconButton size="xs" label="Remove material" onClick={() => void removeMaterial(m.id)}>
                        <Trash2 size={13} />
                      </IconButton>
                    )}
                  </td>
                </tr>
              ))}
              {!(doc.materials ?? []).length && (
                <tr>
                  <td colSpan={4} className="faint" style={{ textAlign: 'center', padding: 18 }}>
                    No materials: they are written off when the work order reaches the Done state.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && (
          <MaterialEditor
            onAdd={async (productId, qty) => {
              await saveMaterials([...(doc.materials ?? []).map(m => ({ id: m.id, productId: m.productId, qty: m.qty })), { productId, qty }]);
            }}
          />
        )}
      </section>

      <section className="doc-links panel" aria-label="Resources">
        <h2>Resources</h2>
        <DocumentResourcesPanel orderId={doc.id} />
      </section>

      <section className="doc-lines panel" aria-label="Assignees">
        <h2>Assignees</h2>
        <div className="table-wrap">
          <table className="dtbl" aria-label="Assignments of the work order">
            <thead>
              <tr>
                <th>Task</th>
                <th style={{ width: 170 }}>Assignee</th>
                <th style={{ width: 190 }}>From</th>
                <th style={{ width: 190 }}>To</th>
                <th style={{ width: 70 }} className="r">
                  Plan
                </th>
                <th style={{ width: 70 }} className="r">
                  Actual
                </th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {(doc.assignments ?? []).map(a => {
                const t = (time.data?.assignments ?? []).find(x => x.taskId === a.taskId);
                return (
                  <tr key={a.id}>
                    <td>
                      <span className="muted">{a.title}</span> <span className="mono faint">{a.taskKey}</span>
                    </td>
                    <td>
                      {editable ? (
                        <Select
                          aria-label={`Assignee of ${a.title}`}
                          value={a.assigneeId ?? ''}
                          onValueChange={v => void api('PATCH', `/work-order-assignments/${a.taskId}`, { assigneeId: v }).then(() => qc.invalidateQueries({ queryKey: docsKey(ws, 'doc', doc.id) }))}
                          options={members.filter(m => m.status === 'active').map(m => ({ value: m.id, label: m.name }))}
                          placeholder="Not assigned"
                        />
                      ) : (
                        a.assigneeName ?? '—'
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <Input
                          aria-label={`Start of ${a.title}`}
                          type="datetime-local"
                          value={toLocalInput(a.startAt)}
                          onChange={e => {
                            if (!e.target.value) return;
                            const { startAt, endAt } = interval(a, 'start', e.target.value);
                            void saveInterval(a, startAt, endAt);
                          }}
                        />
                      ) : (
                        <span className="num">{a.startAt ? toLocalInput(a.startAt).replace('T', ' ') : '—'}</span>
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <Input
                          aria-label={`End of ${a.title}`}
                          type="datetime-local"
                          value={toLocalInput(a.endAt)}
                          onChange={e => {
                            if (!e.target.value) return;
                            const { startAt, endAt } = interval(a, 'end', e.target.value);
                            void saveInterval(a, startAt, endAt);
                          }}
                        />
                      ) : (
                        <span className="num">{a.endAt ? toLocalInput(a.endAt).replace('T', ' ') : '—'}</span>
                      )}
                    </td>
                    <td className="r num">{t?.plannedHours ?? a.plannedHours ?? '—'}</td>
                    <td className="r num">{t?.actualHours ?? '—'}</td>
                    <td>
                      {editable && (
                        <IconButton size="xs" label="Remove assignee" onClick={() => void removeAssignment(a.taskId)}>
                          <Trash2 size={13} />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!(doc.assignments ?? []).length && (
                <tr>
                  <td colSpan={7} className="faint" style={{ textAlign: 'center', padding: 18 }}>
                    No assignees: every assignee gets a task of the Services module.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="doc-add">
            <Select
              value=""
              aria-label="Add assignee"
              onValueChange={v => void addAssignment(v)}
              options={members.filter(m => m.status === 'active').map(m => ({ value: m.id, label: m.name }))}
              placeholder="Add assignee"
            />
          </div>
        )}
      </section>

      <Dialog open={cancelOpen} onOpenChange={o => !o && setCancelOpen(false)}>
        <DialogContent
          title="Cancel the work order?"
          description="Enter the reason: it is required when a work order is cancelled."
          footer={
            <>
              <Button variant="ghost" onClick={() => setCancelOpen(false)}>
                Keep
              </Button>
              <Button variant="primary" disabled={!reason.trim()} onClick={() => void changeState('cancelled', reason.trim())}>
                Cancel work order
              </Button>
            </>
          }
        >
          <Field label="Reason">
            {p => <Input {...p} value={reason} onChange={e => setReason(e.target.value)} placeholder="The client refused the work" />}
          </Field>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Добавление материала заказ-наряда: товар каталога и количество */
function MaterialEditor({ onAdd }: { onAdd: (productId: string, qty: string) => Promise<void> }) {
  const [productId, setProductId] = React.useState('');
  const [qty, setQty] = React.useState('1');
  const [products, setProducts] = React.useState<{ id: string; name: string; sku: string }[]>([]);
  const ws = useWsId();

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const { call } = await import('../meta/data');
      const r = await call<{ items: { id: string; name: string; sku: string }[] }>(ws, 'GET', '/products?kind=goods&active=true&limit=200');
      if (alive) setProducts(r.items);
    })();
    return () => {
      alive = false;
    };
  }, [ws]);

  return (
    <div className="doc-add">
      <Select value={productId} aria-label="Material" onValueChange={setProductId} options={products.map(p => ({ value: p.id, label: p.name }))} placeholder="Add material" />
      <Input aria-label="Quantity" value={qty} onChange={e => setQty(e.target.value)} className="num" />
      <Button
        size="sm"
        variant="ghost"
        disabled={!productId || !Number(qty)}
        onClick={() => {
          void onAdd(productId, qty);
          setProductId('');
          setQty('1');
        }}
      >
        <FilePlus size={13} />
        Add material
      </Button>
    </div>
  );
}
