/* Карточка заказа на производство: позиции (что выпускаем), снимок спецификации (материалы и работы) и действия:
   «заполнить по спецификации», «создать выпуск», состояние заказа и проведение. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleAlert, FileText, Plus, Send, Trash2, Undo2, Wand2 } from 'lucide-react';
import { PRODUCTION_ORDER_STATES } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Select, Skeleton } from '@/components/ui';
import { fmtDate } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { money } from '../catalog/data';
import { STATUS_LABEL, STATUS_TONE, useDocsApi } from '../docs/data';
import { useSnapshot } from './data';
import { STATE_LABEL, STATE_TONE, useProductionOrder, useProductionOrderApi } from './orders-data';

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
              Fill from BOM
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
          {!order.components.length ? (
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
