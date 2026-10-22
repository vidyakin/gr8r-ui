/* Карточка заказа на производство: позиции (что выпускаем), снимок спецификации (материалы и работы) и действия:
   «заполнить по спецификации», «создать выпуск», состояние заказа и проведение. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CalendarRange, CircleAlert, FileText, Plus, Send, Trash2, Undo2, Wand2 } from 'lucide-react';
import { PRODUCTION_ORDER_STATES } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtDate } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { money } from '../catalog/data';
import { useWorkspace } from '../data/store';
import { STATUS_LABEL, STATUS_TONE, useDocsApi } from '../docs/data';
import { useSnapshot } from './data';
import { STATE_LABEL, STATE_TONE, useProductionOrder, useProductionOrderApi, type ProductionOrderDetail } from './orders-data';
import { useOrderOperations, usePieceworkApi, type AssignmentRow } from './piecework-data';
import { useDocumentResources, usePlanningApi, useResources } from './planning-data';
import { MaterialStockBlock, ReserveDialog, StockToggle, SupplyButtons } from './material-stock';
import type { MaterialCoverageRow } from './orders-data';

export function ProductionOrderPage() {
  const { id } = useParams();
  const q = useProductionOrder(id);
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
        <EmptyState icon={<CircleAlert size={20} />} error title="Production order not found" action={<Link to="/production/orders" className="btn btn-secondary">Back to orders</Link>}>
          This order does not exist or belongs to another workspace.
        </EmptyState>
      </div>
    );
  return <OrderView key={q.data.id} order={q.data} />;
}

function OrderView({ order }: { order: NonNullable<ReturnType<typeof useProductionOrder>['data']> }) {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const api = useProductionOrderApi();
  const docs = useDocsApi();
  const snap = useSnapshot();
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [showStock, setShowStock] = React.useState(false);
  const [editing, setEditing] = React.useState<MaterialCoverageRow | null>(null);
  const editable = canWrite && order.status === 'draft';

  const products = snap.data?.items ?? [];
  const save = (patch: Record<string, unknown>) => api.update.mutate({ id: order.id, body: patch });

  const setItems = (items: { itemId: string; qty: string; customerOrderLineId?: string | null }[]) => save({ items });

  const addItem = () => {
    const first = products[0];
    if (!first) return;
    setItems([...order.items.map(i => ({ itemId: i.itemId, qty: i.qty, customerOrderLineId: i.customerOrderLineId })), { itemId: first.id, qty: '1' }]);
  };
  const changeItem = (index: number, patch: { itemId?: string; qty?: string }) => {
    const next = order.items.map((it, n) => (n === index ? { itemId: patch.itemId ?? it.itemId, qty: patch.qty ?? it.qty, customerOrderLineId: it.customerOrderLineId } : { itemId: it.itemId, qty: it.qty, customerOrderLineId: it.customerOrderLineId }));
    setItems(next);
  };
  const removeItem = (index: number) => setItems(order.items.filter((_, n) => n !== index).map(i => ({ itemId: i.itemId, qty: i.qty, customerOrderLineId: i.customerOrderLineId })));

  const createProduction = async () => {
    const lines = order.items.map(i => ({ orderItemId: i.id, qty: String(Math.max(0, Number(i.qty) - Number(i.produced))) })).filter(l => Number(l.qty) > 0);
    if (!lines.length) return;
    setBusy(true);
    try {
      const d = await api.produce.mutateAsync({ id: order.id, body: { lines } });
      if (d) navigate(`/documents/${d.id}`);
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    setBusy(true);
    try {
      await docs('POST', `/documents/${order.id}/post`);
    } finally {
      setBusy(false);
    }
  };
  const unpost = async () => {
    setBusy(true);
    try {
      await docs('POST', `/documents/${order.id}/unpost`);
    } finally {
      setBusy(false);
    }
  };

  const remaining = order.items.map(i => Math.max(0, Number(i.qty) - Number(i.produced)));

  return (
    <div className="page doc-page">
      <div className="doc-bar">
        <div className="doc-title">
          <nav className="muted" style={{ fontSize: 12.5 }} aria-label="Section">
            <Link to="/production/orders" className="crm-link">
              Production orders
            </Link>
          </nav>
          <h1>
            Production order {order.number ?? <span className="faint">draft</span>}
            <Badge tone={STATUS_TONE[order.status]} dot>
              {STATUS_LABEL[order.status]}
            </Badge>
            {order.state && (
              <Badge tone={STATE_TONE[order.state] ?? 'gray'}>
                {STATE_LABEL[order.state] ?? order.state}
              </Badge>
            )}
          </h1>
          <span className="faint" style={{ fontSize: 12 }}>{order.date}</span>
        </div>
        <div className="doc-actions">
          {editable && (
            <Button disabled={busy} onClick={() => void api.fill.mutateAsync(order.id)}>
              <Wand2 size={14} />
              Recalculate composition
            </Button>
          )}
          {canWrite && (
            <Button disabled={busy} onClick={() => void api.schedule.mutateAsync(order.id)}>
              <CalendarRange size={14} />
              Schedule
            </Button>
          )}
          {canWrite && order.status === 'posted' && (
            <Button disabled={busy} onClick={() => void createProduction()}>
              <FileText size={14} />
              Create production
            </Button>
          )}
          {canWrite && order.status === 'draft' && (
            <Button variant="primary" disabled={busy} onClick={() => void post()}>
              <Send size={14} />
              Post
            </Button>
          )}
          {canWrite && order.status === 'posted' && (
            <Button disabled={busy} onClick={() => void unpost()}>
              <Undo2 size={14} />
              Unpost
            </Button>
          )}
          {canWrite && (
            <Select
              aria-label="State"
              value={order.state ?? ''}
              onValueChange={v => api.setState.mutate({ id: order.id, state: v })}
              options={PRODUCTION_ORDER_STATES.filter(s => s.key !== order.state).map(s => ({ value: s.key, label: s.label }))}
              placeholder="State"
              className="w-auto"
            />
          )}
        </div>
      </div>

      <section className="doc-head panel" aria-label="Order header">
        <Field label="Work center" hint="Who makes the products">
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={order.workCenter?.id ?? ''}
              onValueChange={v => save({ workCenterId: v })}
              options={(snap.data?.workCenters ?? []).map(w => ({ value: w.id, label: w.name }))}
              placeholder="Select work center"
              aria-label="Work center"
            />
          )}
        </Field>
        <Field label="Planned start">{p => <Input {...p} type="date" disabled={!editable} value={order.plannedStart ? order.plannedStart.slice(0, 10) : ''} onChange={e => save({ plannedStart: e.target.value ? new Date(e.target.value).toISOString() : null })} />}</Field>
        <Field label="Planned end">{p => <Input {...p} type="date" disabled={!editable} value={order.plannedEnd ? order.plannedEnd.slice(0, 10) : ''} onChange={e => save({ plannedEnd: e.target.value ? new Date(e.target.value).toISOString() : null })} />}</Field>
        <Field label="Comment" className="doc-wide">
          {p => <Input {...p} disabled={!editable} value={order.comment} placeholder="What is this order for" onChange={e => save({ comment: e.target.value })} />}
        </Field>
      </section>

      <section className="doc-lines panel" aria-label="Products to produce">
        <div className="table-wrap">
          <table className="dtbl" aria-label="Order items">
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th>Product</th>
                <th style={{ width: 110 }} className="r">
                  Qty
                </th>
                <th style={{ width: 100 }} className="r">
                  Produced
                </th>
                <th style={{ width: 100 }} className="r">
                  Remaining
                </th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {order.items.map((it, n) => (
                <tr key={it.id} data-row={n}>
                  <td className="faint num">{n + 1}</td>
                  <td>
                    {editable ? (
                      <Select
                        aria-label="Product"
                        value={it.itemId}
                        onValueChange={v => changeItem(n, { itemId: v })}
                        options={products.map(p => ({ value: p.id, label: p.name }))}
                      />
                    ) : (
                      <span className="trunc">{it.name}</span>
                    )}
                  </td>
                  <td className="r">
                    {editable ? (
                      <Input aria-label="Quantity" inputMode="decimal" value={it.qty} onChange={e => changeItem(n, { qty: e.target.value })} />
                    ) : (
                      <span className="num">{it.qty}</span>
                    )}
                  </td>
                  <td className="r num muted">{it.produced}</td>
                  <td className="r num">{remaining[n]}</td>
                  <td>
                    {editable && (
                      <IconButton size="xs" label="Remove product" onClick={() => removeItem(n)}>
                        <Trash2 size={13} />
                      </IconButton>
                    )}
                  </td>
                </tr>
              ))}
              {!order.items.length && (
                <tr>
                  <td colSpan={6} className="faint" style={{ textAlign: 'center', padding: 22 }}>
                    No products yet.{editable ? ' Add what to produce.' : ''}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="doc-add">
            <Button size="sm" variant="ghost" onClick={addItem}>
              <Plus size={13} />
              Add product
            </Button>
          </div>
        )}
      </section>

      <div className="doc-bottom">
        <section className="doc-links panel" aria-label="Composition">
          <h2>Bill of materials</h2>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 8 }}>
            <StockToggle on={showStock} onToggle={() => setShowStock(v => !v)} />
            <SupplyButtons orderId={order.id} />
          </div>
          {showStock ? (
            <MaterialStockBlock orderId={order.id} canWrite={canWrite} onEdit={setEditing} />
          ) : !order.components.length ? (
            <p className="faint">The composition is empty: use “Fill from BOM” to copy the specification of each product.</p>
          ) : (
            <table className="dtbl" aria-label="Composition">
              <thead>
                <tr>
                  <th>Material or work</th>
                  <th style={{ width: 100 }} className="r">
                    Qty
                  </th>
                  <th style={{ width: 90 }} className="r">
                    Hours
                  </th>
                  <th style={{ width: 120 }} className="r">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.components.map(c => (
                  <tr key={c.id}>
                    <td>
                      <span className="trunc">{c.kind === 'work' ? c.operation : c.kind === 'semi' ? 'Semi-finished product' : 'Material'}</span>
                    </td>
                    <td className="r num">{c.kind === 'work' ? '—' : c.qty}</td>
                    <td className="r num">{c.kind === 'work' ? c.hours : '—'}</td>
                    <td className="r num">{c.plannedCost === null ? '—' : money(c.plannedCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {editing && <ReserveDialog row={editing} orderId={order.id} onClose={() => setEditing(null)} />}
        </section>
        <section className="doc-links panel" aria-label="Operations">
          <h2>Operations</h2>
          <OrderOperations order={order} />
        </section>
        <section className="doc-links panel" aria-label="Resources">
          <h2>Resources</h2>
          <DocumentResourcesPanel orderId={order.id} />
        </section>
        <section className="doc-links panel" aria-label="Releases">
          <h2>Releases</h2>
          {!order.outputs.length ? (
            <p className="faint">Nothing has been released from this order yet.</p>
          ) : (
            <ul>
              {order.outputs.map(o => (
                <li key={o.id}>
                  <Link className="crm-link" to={`/documents/${o.id}`}>
                    Production {o.number ?? '(draft)'}
                  </Link>{' '}
                  <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge> <span className="faint">{fmtDate(new Date(o.date))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog open={confirm} onOpenChange={o => !o && setConfirm(false)} title="Delete this draft?" description="The draft has never been posted and has no number, so it is removed completely." confirmLabel="Delete" cancelLabel="Keep" danger onConfirm={() => setConfirm(false)} />
    </div>
  );
}

/* Операции заказа: назначения исполнителей. Назначение создаёт задачу модуля production,
   выполнение отмечает исполнитель (в своей задаче) или мастер (в рабочем месте). */
function OrderOperations({ order }: { order: ProductionOrderDetail }) {
  const canWrite = useCanWrite();
  const { data: ws } = useWorkspace();
  const ops = useOrderOperations(order.id);
  const api = usePieceworkApi();
  const [editing, setEditing] = React.useState<{ componentId: string; name: string } | null>(null);
  const works = order.components.filter(c => c.kind === 'work');
  const rows = ops.data?.items ?? [];

  if (!works.length) return <p className="faint">The composition has no work operations: fill it from the bill of materials.</p>;
  if (!rows.length && !canWrite) return <p className="faint">No executors are assigned to the operations yet.</p>;

  return (
    <>
      <table className="dtbl" aria-label="Operations">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Executor</th>
            <th style={{ width: 90 }} className="r">
              Planned
            </th>
            <th style={{ width: 90 }} className="r">
              Done
            </th>
            <th style={{ width: 90 }} className="r">
              Left
            </th>
            {canWrite && <th style={{ width: 90 }} />}
          </tr>
        </thead>
        <tbody>
          {works.map(c => {
            const own = rows.filter(r => r.componentId === c.id);
            return (
              <tr key={c.id}>
                <td className="trunc">{c.operation || 'Work'}</td>
                <td className="trunc">{own.length ? own.map(r => r.memberName).join(', ') : <span className="faint">Not assigned</span>}</td>
                <td className="r num">{own.length ? own.reduce((s, r) => s + Number(r.plannedQty), 0).toFixed(3) : '—'}</td>
                <td className="r num">{own.length ? own.reduce((s, r) => s + Number(r.doneQty), 0).toFixed(3) : '—'}</td>
                <td className="r num">{own.length ? own.reduce((s, r) => s + Number(r.leftQty), 0).toFixed(3) : '—'}</td>
                {canWrite && (
                  <td className="r">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ componentId: c.id, name: c.operation || 'Work' })}>
                      Assign
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing && (
        <AssignDialog
          componentId={editing.componentId}
          name={editing.name}
          members={(ws?.members ?? []).filter(m => m.status === 'active')}
          current={rows.filter(r => r.componentId === editing.componentId)}
          all={rows}
          onClose={() => setEditing(null)}
          onSave={assignments => api.assign.mutate({ orderId: order.id, assignments })}
        />
      )}
    </>
  );
}

/** Назначение операции исполнителю: участник и количество (часть операции) */
function AssignDialog({
  componentId,
  name,
  members,
  current,
  all,
  onClose,
  onSave,
}: {
  componentId: string;
  name: string;
  members: { id: string; name: string }[];
  current: AssignmentRow[];
  all: AssignmentRow[];
  onClose: () => void;
  onSave: (assignments: { componentId: string; memberId: string; qty: string }[]) => void;
}) {
  const [memberId, setMemberId] = React.useState(members[0]?.id ?? '');
  const [qty, setQty] = React.useState('');
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const used = current.reduce((s, r) => s + Number(r.plannedQty), 0);

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!memberId) errs.memberId = 'Choose an executor';
    if (!qty.trim() || Number(qty) <= 0) errs.qty = 'Enter the quantity';
    setErr(errs);
    if (Object.keys(errs).length) return;
    const assignments = all.map(r => ({ componentId: r.componentId, memberId: r.memberId, qty: r.plannedQty }));
    const rest = assignments.filter(a => a.componentId !== componentId);
    const same = current.find(r => r.memberId === memberId);
    if (same) {
      const idx = rest.findIndex(a => a.memberId === memberId);
      if (idx >= 0) rest[idx] = { ...rest[idx], qty };
      else rest.push({ componentId, memberId, qty });
    } else rest.push({ componentId, memberId, qty });
    setBusy(true);
    onSave(rest);
    setBusy(false);
    toast(`The executor of “${name}” is saved`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={`Executors of “${name}”`}
        description="An operation can be shared between several executors: the sum of the assigned quantities cannot exceed the ordered one. Every executor gets a task in the Production module."
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              Save
            </Button>
          </>
        }
      >
        <form
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Executor" error={err.memberId}>
            {p => (
              <Select
                id={p.id}
                value={memberId}
                onValueChange={v => (setMemberId(v), setErr({}))}
                options={members.map(m => ({ value: m.id, label: m.name }))}
                placeholder="Choose an executor"
              />
            )}
          </Field>
          <Field label="Quantity" error={err.qty} hint={`Already assigned: ${used.toFixed(3)}`}>
            {p => <Input {...p} inputMode="decimal" value={qty} onChange={e => (setQty(e.target.value), setErr({}))} />}
          </Field>
          {current.length > 0 && (
            <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
              {current.map(r => `${r.memberName}: ${r.plannedQty}`).join('; ')}
            </p>
          )}
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* Ресурсы документа (заказа на производство или заказ-наряда): подставляются по нормативу операций
   и правятся вручную — закладка «Ресурсы». */
export function DocumentResourcesPanel({ orderId }: { orderId: string }) {
  const canWrite = useCanWrite();
  const api = usePlanningApi();
  const resources = useResources();
  const docRes = useDocumentResources(orderId);
  const [editing, setEditing] = React.useState(false);
  const items = docRes.data?.items ?? [];

  const save = async (rows: { resourceId: string; startAt: string | null; endAt: string | null; hours: string }[]) => {
    const r = await api('PUT', '/production/document-resources', {
      documentId: orderId,
      items: rows.map(x => ({ resourceId: x.resourceId, startAt: x.startAt, endAt: x.endAt, hours: x.hours })),
    });
    if (r) {
      toast('Resources saved');
      setEditing(false);
    }
  };

  if (!items.length)
    return (
      <p className="faint">
        No resources yet. Schedule the order — the resources of its operations are filled in by the norm of the operation.
      </p>
    );

  return (
    <>
      <table className="dtbl" aria-label="Resources">
        <thead>
          <tr>
            <th>Resource</th>
            <th>Hours</th>
            <th>From</th>
            <th>To</th>
          </tr>
        </thead>
        <tbody>
          {items.map(r => (
            <tr key={r.id}>
              <td>{resources.data?.items.find(x => x.id === r.resourceId)?.name ?? '—'}</td>
              <td className="num">{r.hours}</td>
              <td className="num">{r.startAt ? r.startAt.slice(0, 10) : '—'}</td>
              <td className="num">{r.endAt ? r.endAt.slice(0, 10) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canWrite && (
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit resources
        </Button>
      )}
      {editing && <ResourcesDialog orderId={orderId} onClose={() => setEditing(false)} onSave={save} />}
    </>
  );
}

/** Правка ресурсов заказа: ресурс, часы и интервал работы */
function ResourcesDialog({ orderId, onClose, onSave }: { orderId: string; onClose: () => void; onSave: (rows: { resourceId: string; startAt: string | null; endAt: string | null; hours: string }[]) => void }) {
  const resources = useResources();
  const docRes = useDocumentResources(orderId);
  const [rows, setRows] = React.useState(
    (docRes.data?.items ?? []).map(r => ({
      resourceId: r.resourceId,
      hours: r.hours,
      startAt: r.startAt ? r.startAt.slice(0, 10) : '',
      endAt: r.endAt ? r.endAt.slice(0, 10) : '',
    })),
  );
  const [busy, setBusy] = React.useState(false);

  const submit = () => {
    setBusy(true);
    void Promise.resolve(
      onSave(
        rows.map(r => ({
          resourceId: r.resourceId,
          hours: r.hours,
          startAt: r.startAt ? `${r.startAt}T00:00:00Z` : null,
          endAt: r.endAt ? `${r.endAt}T23:59:59Z` : null,
        })),
      ),
    ).finally(() => setBusy(false));
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title="Resources of the order"
        description="The resources of the operations, their hours and the interval they are busy."
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              Save
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((r, i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              <select
                className="select !h-[30px] !text-xs"
                aria-label="Resource"
                value={r.resourceId}
                onChange={e => setRows(prev => prev.map((x, n) => (n === i ? { ...x, resourceId: e.target.value } : x)))}
              >
                {(resources.data?.items ?? []).map(x => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <Input aria-label="Hours" value={r.hours} onChange={e => setRows(prev => prev.map((x, n) => (n === i ? { ...x, hours: e.target.value } : x)))} style={{ width: 90 }} />
              <Input aria-label="From" type="date" value={r.startAt} onChange={e => setRows(prev => prev.map((x, n) => (n === i ? { ...x, startAt: e.target.value } : x)))} style={{ width: 150 }} />
              <Input aria-label="To" type="date" value={r.endAt} onChange={e => setRows(prev => prev.map((x, n) => (n === i ? { ...x, endAt: e.target.value } : x)))} style={{ width: 150 }} />
              <button type="button" className="ibtn ibtn-xs" aria-label="Remove resource" onClick={() => setRows(prev => prev.filter((_, n) => n !== i))}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRows(prev => [...prev, { resourceId: resources.data?.items[0]?.id ?? '', hours: '0', startAt: '', endAt: '' }])}
          >
            <Plus size={13} />
            Add resource
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
