/* Заявка на расход (1174г): журнал и документ. Шапка над таблицей, строки — табличная часть, комментарий внизу (как в 1С).
   Проведение = подача на согласование; согласует admin и выше; оплата — документ РКО или списания на основании заявки. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleAlert, FilePlus2, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Select, Skeleton, Tab, Tabs, TabsList, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useCanWrite } from '../meta/custom-fields';
import { fmtDate } from '../lib/dates';
import { useOrganizations, useDocuments, typeLabel } from '../docs/data';
import { CounterpartyPicker } from '../docs/pickers';
import { useIsAdmin } from '../catalog/data';
import { useCashFlowItems, useRequest, useRequestApi, useRequests } from './data';

const today = () => new Date().toISOString().slice(0, 10);
const TONE = { draft: 'gray', pending: 'amber', approved: 'accent', paid: 'green', rejected: 'red', cancelled: 'neutral' } as const;
type StateKey = keyof typeof TONE;
const stateOf = (r: { status: string; state: string | null }): StateKey => (r.status === 'cancelled' ? 'cancelled' : r.status === 'draft' ? 'draft' : ((r.state ?? 'pending') as StateKey));

export function RequestsPage() {
  const tt = useT();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const [tab, setTab] = React.useState('all');
  const [q, setQ] = React.useState('');
  const list = useRequests({ state: tab === 'all' ? undefined : tab, q: q || undefined });
  const rows = list.data?.items ?? [];
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('money.request.title')}</h1>
          <p>{tt('money.request.subtitle')}</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button variant="primary" onClick={() => void navigate('/money/requests/new')}>
              <FilePlus2 size={14} />
              {tt('money.request.new')}
            </Button>
          )}
        </div>
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px', alignItems: 'flex-end' }}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label={tt('money.request.title')}>
            <Tab value="all">{tt('money.request.all')}</Tab>
            {(['draft', 'pending', 'approved', 'paid', 'rejected'] as const).map(s => (
              <Tab key={s} value={s}>{tt(`money.request.states.${s}`)}</Tab>
            ))}
          </TabsList>
        </Tabs>
        <Field label={tt('money.common.search')}>{p => <Input {...p} value={q} onChange={e => setQ(e.target.value)} />}</Field>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('money.request.title')} action={<Button size="sm" onClick={() => list.refetch()}>{tt('money.common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<FilePlus2 size={20} />} title={tt('money.request.empty')}>
          {tt('money.request.emptyHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('money.request.table')}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>{tt('money.common.number')}</th>
                <th style={{ width: 110 }}>{tt('money.common.date')}</th>
                <th style={{ width: 110 }}>{tt('money.request.dueDate')}</th>
                <th style={{ width: 150 }}>{tt('money.common.status')}</th>
                <th>{tt('money.request.payee')}</th>
                <th>{tt('money.common.comment')}</th>
                <th style={{ width: 130 }} className="r">{tt('money.form.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const s = stateOf(r);
                return (
                  <tr key={r.id}>
                    <td className="mono">
                      <Link to={`/money/requests/${r.id}`} className="crm-link">{r.number ?? tt('money.common.draft')}</Link>
                    </td>
                    <td className="muted">{fmtDate(r.date)}</td>
                    <td className="muted">{r.dueDate ? fmtDate(r.dueDate) : ''}</td>
                    <td><Badge tone={TONE[s]} dot>{tt(`money.request.states.${s}`)}</Badge></td>
                    <td>{r.counterpartyName ?? ''}</td>
                    <td className="muted">{r.comment}</td>
                    <td className="r num">{fmtAmount(r.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Line {
  id: string;
  settlementDocumentId: string | null;
  amount: string;
  cashFlowItemId: string;
  comment: string;
}
const newLine = (): Line => ({ id: crypto.randomUUID(), settlementDocumentId: null, amount: '', cashFlowItemId: '', comment: '' });

export function RequestPage() {
  const tt = useT();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const api = useRequestApi();
  const req = useRequest(isNew ? undefined : id);
  const detail = isNew ? null : req.data;
  const orgs = useOrganizations();
  const items = useCashFlowItems('expense');
  const isAdmin = useIsAdmin();

  const [operation, setOperation] = React.useState('to_supplier');
  const [organizationId, setOrganizationId] = React.useState('');
  const [date, setDate] = React.useState(today());
  const [dueDate, setDueDate] = React.useState('');
  const [counterpartyId, setCounterpartyId] = React.useState('');
  const [counterpartyName, setCounterpartyName] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [lines, setLines] = React.useState<Line[]>([newLine()]);
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!isNew || organizationId || !orgs.data?.length) return;
    setOrganizationId((orgs.data.find(o => o.isDefault) ?? orgs.data[0]!).id);
  }, [isNew, organizationId, orgs.data]);

  React.useEffect(() => {
    if (!detail || loadedFor.current === detail.id + detail.status) return;
    loadedFor.current = detail.id + detail.status;
    setOperation(detail.operation ?? 'to_supplier');
    setOrganizationId(detail.organizationId);
    setDate(detail.date);
    setDueDate(detail.dueDate ?? '');
    setCounterpartyId(detail.counterpartyId ?? '');
    setCounterpartyName(detail.counterparty?.name ?? '');
    setComment(detail.comment);
    setLines(detail.lines.length ? detail.lines.map(l => ({ id: l.id, settlementDocumentId: l.settlementDocumentId, amount: l.amount, cashFlowItemId: l.cashFlowItemId, comment: l.comment })) : [newLine()]);
  }, [detail]);

  const editable = canWrite && (!detail || detail.status === 'draft');
  const flowItems = (items.data ?? []).filter(i => !i.archivedAt && !['transfer_out', 'accountable_out', 'refund_out'].includes(i.systemKey ?? ''));
  const defaultItem = (operation === 'to_supplier' ? flowItems.find(i => i.systemKey === 'suppliers_payment') : undefined)?.id ?? flowItems[0]?.id ?? '';
  const docs = useDocuments({ counterpartyId: counterpartyId || undefined });
  const docOptions = (docs.data?.items ?? []).filter(d => ['receipt', 'supplier_order', 'work_order', 'act', 'supplier_return', 'invoice', 'realization'].includes(d.type) && d.status !== 'cancelled');

  const body = () => ({
    operation,
    organizationId,
    date,
    dueDate: dueDate || null,
    counterpartyId: counterpartyId || null,
    comment,
    lines: lines.map(l => ({ id: l.id, settlementDocumentId: operation === 'to_supplier' ? l.settlementDocumentId : null, amount: l.amount || '0', cashFlowItemId: l.cashFlowItemId || defaultItem || undefined, comment: l.comment })),
  });
  const valid = !!organizationId && !!counterpartyId && lines.length > 0 && lines.every(l => Number(l.amount) > 0);
  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      const saved = detail ? await api.update(detail.id, body()) : await api.save(body());
      toast(tt('money.common.saved'), { duration: 1500 });
      if (!detail) await navigate(`/money/requests/${saved.id}`, { replace: true });
    });
  const submit = () =>
    run(async () => {
      if (!detail) return;
      await api.update(detail.id, body());
      await api.action(detail.id, 'post');
    });
  const pay = (account: 'cash' | 'bank') =>
    run(async () => {
      if (!detail) return;
      const p = await api.pay(detail.id, account);
      toast(tt('money.request.paymentCreated'), { duration: 1500 });
      await navigate(`/money/${p.id}`);
    });

  if (!isNew && req.isPending)
    return (
      <div className="page flush">
        <div className="ph">
          <Skeleton w={260} h={24} />
        </div>
      </div>
    );

  const s = detail ? stateOf(detail) : 'draft';

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{detail?.number ?? tt('money.request.newTitle')}</h1>
          <p>{tt('money.request.title')}</p>
        </div>
        <div className="acts">
          {detail && <Badge tone={TONE[s]} dot>{tt(`money.request.states.${s}`)}</Badge>}
          {editable && (
            <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>
              {detail ? tt('money.common.save') : tt('money.common.create')}
            </Button>
          )}
          {detail && detail.status === 'draft' && canWrite && (
            <Button disabled={busy || !valid} onClick={() => void submit()}>{tt('money.request.submit')}</Button>
          )}
          {detail && s === 'pending' && isAdmin && (
            <>
              <Button variant="primary" disabled={busy} onClick={() => void run(() => api.setState(detail.id, 'approved'))}>{tt('money.request.approve')}</Button>
              <Button disabled={busy} onClick={() => void run(() => api.setState(detail.id, 'rejected'))}>{tt('money.request.reject')}</Button>
            </>
          )}
          {detail && s === 'approved' && isAdmin && (
            <Button disabled={busy} onClick={() => void run(() => api.setState(detail.id, 'pending'))}>{tt('money.request.returnToApproval')}</Button>
          )}
          {detail && s === 'rejected' && canWrite && (
            <Button disabled={busy} onClick={() => void run(() => api.setState(detail.id, 'pending'))}>{tt('money.request.returnToApproval')}</Button>
          )}
          {detail && s === 'approved' && canWrite && Number(detail.payable) > 0 && (
            <>
              <Button variant="primary" disabled={busy} onClick={() => void pay('bank')}>{tt('money.request.payBank')}</Button>
              <Button disabled={busy} onClick={() => void pay('cash')}>{tt('money.request.payCash')}</Button>
            </>
          )}
          {detail && (s === 'pending' || s === 'rejected') && canWrite && (
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => api.action(detail.id, 'unpost'))}>{tt('money.request.withdraw')}</Button>
          )}
          {detail && detail.status === 'draft' && canWrite && (
            <Button variant="ghost" onClick={() => setRemoving(true)}>{tt('money.common.delete')}</Button>
          )}
        </div>
      </div>

      <section className="panel doc-head" aria-label={tt('money.common.date')}>
        <Field label={tt('money.request.operation')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={operation}
              onValueChange={v => {
                setOperation(v);
                setLines(prev => prev.map(l => ({ ...l, settlementDocumentId: null })));
              }}
              options={(['to_supplier', 'other_expense'] as const).map(o => ({ value: o, label: tt(`money.request.ops.${o}`) }))}
              aria-label={tt('money.request.operation')}
            />
          )}
        </Field>
        <Field label={tt('money.common.date')}>{p => <Input {...p} type="date" disabled={!editable} value={date} onChange={e => setDate(e.target.value)} />}</Field>
        <Field label={tt('money.request.dueDate')}>{p => <Input {...p} type="date" disabled={!editable} value={dueDate} onChange={e => setDueDate(e.target.value)} />}</Field>
        <Field label={tt('money.form.organization')}>
          {p => <Select id={p.id} disabled={!editable || !!detail?.number} value={organizationId} onValueChange={setOrganizationId} options={(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))} aria-label={tt('money.form.organization')} />}
        </Field>
        <Field label={tt('money.request.payee')}>
          {p => (
            <CounterpartyPicker
              id={p.id}
              value={counterpartyName}
              disabled={!editable}
              onPick={c => {
                setCounterpartyId(c.id);
                setCounterpartyName(c.name);
                setLines(prev => prev.map(l => ({ ...l, settlementDocumentId: null })));
              }}
            />
          )}
        </Field>
        {detail && detail.status !== 'draft' && (
          <Field label={tt('money.request.paid')}>{() => <span className="num">{fmtAmount(detail.paid)} / {fmtAmount(detail.total)}</span>}</Field>
        )}
      </section>

      <section className="doc-lines panel" aria-label={tt('money.request.lines')}>
        <div className="table-wrap">
          <table className="dtbl" aria-label={tt('money.request.lines')}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                {operation === 'to_supplier' && <th style={{ width: 280 }}>{tt('money.request.settlementDocument')}</th>}
                <th style={{ width: 210 }}>{tt('money.request.cashFlowItem')}</th>
                <th style={{ width: 130 }} className="r">{tt('money.form.amount')}</th>
                <th>{tt('money.form.comment')}</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const set = (patch: Partial<Line>) => setLines(prev => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <tr key={l.id}>
                    <td className="faint num">{i + 1}</td>
                    {operation === 'to_supplier' && (
                      <td>
                        <Select
                          aria-label={tt('money.request.settlementDocument')}
                          disabled={!editable || !counterpartyId}
                          value={l.settlementDocumentId ?? ''}
                          onValueChange={v => {
                            const d = docOptions.find(x => x.id === v);
                            set({ settlementDocumentId: v || null, amount: l.amount || (d ? d.total : '') });
                          }}
                          options={[{ value: '', label: tt('money.request.settlementHint') }, ...docOptions.map(d => ({ value: d.id, label: `${typeLabel(d.type)} ${d.number ?? ''} · ${fmtAmount(d.total)}` }))]}
                        />
                      </td>
                    )}
                    <td>
                      <Select aria-label={tt('money.request.cashFlowItem')} disabled={!editable} value={l.cashFlowItemId || defaultItem} onValueChange={v => set({ cashFlowItemId: v })} options={flowItems.map(c => ({ value: c.id, label: c.name }))} />
                    </td>
                    <td className="r">
                      <Input aria-label={tt('money.form.amount')} inputMode="decimal" disabled={!editable} value={l.amount} onChange={e => set({ amount: e.target.value })} />
                    </td>
                    <td>
                      <Input aria-label={tt('money.form.comment')} disabled={!editable} value={l.comment} onChange={e => set({ comment: e.target.value })} />
                    </td>
                    <td>
                      {editable && lines.length > 1 && (
                        <IconButton size="xs" label={tt('money.common.remove')} onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>
                          <Trash2 size={13} />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="doc-add">
            <Button size="sm" variant="ghost" onClick={() => setLines(prev => [...prev, newLine()])}>
              <Plus size={13} />
              {tt('money.common.add')}
            </Button>
          </div>
        )}
        <div className="doc-totals panel" style={{ border: 0 }}>
          <div className="trow grand">
            <span>{tt('money.common.total')}</span>
            <span className="num">{fmtAmount(total.toFixed(2))}</span>
          </div>
        </div>
      </section>

      {detail && detail.payments.length > 0 && (
        <section className="panel" style={{ padding: 12 }} aria-label={tt('money.request.payments')}>
          <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{tt('money.request.payments')}</h2>
          <table className="dtbl" aria-label={tt('money.request.payments')}>
            <tbody>
              {detail.payments.map(p => (
                <tr key={p.id}>
                  <td className="mono"><Link to={`/money/${p.id}`} className="crm-link">{p.number ?? tt('money.common.draft')}</Link></td>
                  <td className="muted">{fmtDate(p.date)}</td>
                  <td>{p.status === 'posted' ? tt('money.common.posted') : tt('money.common.draft')}</td>
                  <td className="r num">{fmtAmount(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="doc-comment panel" aria-label={tt('money.common.comment')}>
        <Field label={tt('money.common.comment')}>{p => <Input {...p} disabled={!editable} value={comment} onChange={e => setComment(e.target.value)} />}</Field>
      </section>

      {removing && detail && (
        <ConfirmDialog
          open
          danger
          title={tt('money.common.delete')}
          confirmLabel={tt('money.common.delete')}
          onOpenChange={open => !open && setRemoving(false)}
          onConfirm={async () => {
            setRemoving(false);
            await api.remove(detail.id);
            await navigate('/money/requests', { replace: true });
          }}
          description=""
        />
      )}
    </div>
  );
}
