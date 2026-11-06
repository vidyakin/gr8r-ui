/* Субподряд в карточке объекта (задача 1274): сводка (заказано / предъявлено / принято / отклонено / оплачено),
   заказы субподрядчикам (документы supplier_order с объектом), акты субподрядчика с приёмкой и отклонением,
   «Новый акт» с предложенными строками из заказа, причинами отклонения из справочника брака и материалами
   со склада объекта. Деньги — закупочные суммы субподрядчика, их видят все участники. */
import * as React from 'react';
import { Link } from 'react-router';
import { CircleAlert, CircleCheck, FileText, Plus, Trash2, Undo2, XCircle } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { fmtDate } from '../lib/dates';
import { useCompanies } from '../catalog/data';
import { useDefectReasons } from '../production/quality-data';
import { useObjectSummary } from './data';
import {
  useSubActApi,
  useSubActSuggestion,
  useSubcontractList,
  type SubAct,
  type SubActMaterialInput,
  type SubcontractAmounts,
  type SubcontractSummary,
} from './subcontract-data';
import { DateInput } from '@/components/gr8r/date-picker';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
/** Строка количества без хвостовых нулей — как в остальных таблицах карточки */
const qtyText = (v: string) => v.replace(/\.?0+$/, '') || '0';
const num = (v: string) => (v.trim() ? v.replace(',', '.') : '0');

/** Подпись статуса акта субподрядчика */
function SubActStatus({ status }: { status: SubAct['status'] }) {
  const tt = useT();
  const tone = status === 'accepted' ? 'green' : status === 'rejected' ? 'neutral' : 'gray';
  return <Badge tone={tone}>{tt(`objects.subcontract.status.${status}`)}</Badge>;
}

/** Ключи словаря категорий затрат: код предупреждения бюджета → подпись категории */
const CATEGORY_KEY = {
  material: 'objects.budget.category.material',
  labor: 'objects.budget.category.labor',
  subcontract: 'objects.budget.category.subcontract',
  other: 'objects.budget.category.otherCosts',
} as const;

/** Предупреждения приёмки: закрытый период и превышение бюджета объекта */
function warningText(tt: ReturnType<typeof useT>, code: string): string {
  if (code === 'period_closed') return tt('objects.subcontract.periodClosed');
  if (code.startsWith('budget_exceeded:')) {
    const cat = code.slice('budget_exceeded:'.length);
    const key = cat in CATEGORY_KEY ? CATEGORY_KEY[cat as keyof typeof CATEGORY_KEY] : CATEGORY_KEY.other;
    return tt('objects.budget.warnExceeded', { category: tt(key) });
  }
  return code;
}

/** Сводка субподряда: пять состояний не смешиваются */
function SubcontractSummaryRow({ amounts }: { amounts: SubcontractAmounts }) {
  const tt = useT();
  const cells: { key: keyof SubcontractAmounts; label: string }[] = [
    { key: 'ordered', label: tt('objects.subcontract.ordered') },
    { key: 'presented', label: tt('objects.subcontract.presented') },
    { key: 'accepted', label: tt('objects.subcontract.accepted') },
    { key: 'rejected', label: tt('objects.subcontract.rejected') },
    { key: 'paid', label: tt('objects.subcontract.paid') },
  ];
  return (
    <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
      {cells.map(c => (
        <div key={c.key}>
          <div className="faint" style={{ fontSize: 11 }}>
            {c.label}
          </div>
          <div className="num" style={{ fontWeight: 600 }}>
            {amounts[c.key] == null ? '—' : fmtAmount(amounts[c.key]!)}
          </div>
        </div>
      ))}
    </div>
  );
}

interface LineDraft {
  key: string;
  estimateItemId: string | null;
  name: string;
  unitCode: string;
  unitSymbol: string;
  qty: string;
  price: string;
  acceptedQty: string;
  defectReasonId: string;
  note: string;
  orderedQty?: string;
}

/** Форма нового акта субподрядчика: контрагент, заказ и предложенные строки, материалы со склада объекта */
function SubActDialog({ objectId, orders, onClose }: { objectId: string; orders: SubcontractSummary['orders']; onClose: () => void }) {
  const tt = useT();
  const api = useSubActApi();
  const companies = useCompanies();
  const reasons = useDefectReasons();
  const summary = useObjectSummary(objectId);
  const [counterpartyId, setCounterpartyId] = React.useState('');
  const [orderId, setOrderId] = React.useState('');
  const [docNumber, setDocNumber] = React.useState('');
  const [docDate, setDocDate] = React.useState(today());
  const [periodFrom, setPeriodFrom] = React.useState(monthStart(today()));
  const [periodTo, setPeriodTo] = React.useState(today());
  const [note, setNote] = React.useState('');
  const [lines, setLines] = React.useState<LineDraft[]>([]);
  const [materials, setMaterials] = React.useState<SubActMaterialInput[]>([]);
  const [productId, setProductId] = React.useState('');
  const [materialQty, setMaterialQty] = React.useState('1');
  const [busy, setBusy] = React.useState(false);
  const suggestion = useSubActSuggestion(objectId, orderId || null, !!orderId);

  // заказ подставляет контрагента и строки: остаток к приёмке по строкам-услугам заказа
  React.useEffect(() => {
    if (!orderId) return;
    const order = orders.find(o => o.id === orderId);
    if (order?.counterpartyId) setCounterpartyId(order.counterpartyId);
  }, [orderId, orders]);
  React.useEffect(() => {
    const suggested = suggestion.data?.lines;
    if (!suggested) return;
    setLines(
      suggested.map(l => ({
        key: l.orderLineId,
        estimateItemId: l.estimateItemId,
        name: l.name,
        unitCode: l.unitCode,
        unitSymbol: l.unitSymbol,
        qty: qtyText(l.qty),
        price: l.price,
        acceptedQty: qtyText(l.qty),
        defectReasonId: '',
        note: '',
        orderedQty: qtyText(l.orderedQty),
      })),
    );
  }, [suggestion.data]);

  const setLine = (key: string, patch: Partial<LineDraft>) => setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const stock = summary.data?.stock ?? [];
  const addMaterial = () => {
    if (!productId || !materialQty.trim()) return;
    setMaterials(prev => [...prev, { productId, qty: materialQty, note: '' }]);
    setProductId('');
    setMaterialQty('1');
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.create(objectId, {
        counterpartyId,
        orderId: orderId || null,
        docNumber,
        docDate,
        periodFrom,
        periodTo,
        note,
        lines: lines.map(l => ({
          estimateItemId: l.estimateItemId,
          name: l.name,
          unitCode: l.unitCode,
          qty: num(l.qty),
          price: num(l.price),
          acceptedQty: num(l.acceptedQty),
          defectReasonId: l.defectReasonId || null,
          note: l.note,
        })),
        materials,
      });
      toast(tt('objects.common.saved'), { duration: 1500 });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const error = suggestion.isError ? errorMessage(suggestion.error) : null;
  const canSave = !!counterpartyId && (lines.length > 0 || materials.length > 0);

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        size="lg"
        title={tt('objects.subcontract.add')}
        description={tt('objects.subcontract.addHint')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {tt('common.cancel')}
            </Button>
            <Button variant="primary" disabled={busy || !canSave} onClick={() => void save()}>
              {tt('objects.common.save')}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <Field label={tt('objects.subcontract.counterparty')}>
              {p => (
                <Select
                  id={p.id}
                  value={counterpartyId}
                  onValueChange={setCounterpartyId}
                  placeholder={tt('objects.field.none')}
                  options={(companies.data ?? []).map(c => ({ value: c.id, label: c.name }))}
                  aria-label={tt('objects.subcontract.counterparty')}
                />
              )}
            </Field>
            <Field label={tt('objects.subcontract.order')} hint={tt('objects.subcontract.orderHint')}>
              {p => (
                <Select
                  id={p.id}
                  value={orderId}
                  onValueChange={setOrderId}
                  placeholder={tt('objects.subcontract.noOrder')}
                  options={orders.map(o => ({ value: o.id, label: `${o.number ?? '—'} · ${o.counterpartyName}` }))}
                  aria-label={tt('objects.subcontract.order')}
                />
              )}
            </Field>
            <Field label={tt('objects.subcontract.docNumber')}>
              {p => <Input {...p} value={docNumber} onChange={e => setDocNumber(e.target.value)} />}
            </Field>
            <Field label={tt('objects.subcontract.docDate')}>{p => <DateInput {...p} value={docDate} onChange={v => setDocDate(v || today())} required />}</Field>
            <Field label={tt('objects.subcontract.periodFrom')}>{p => <DateInput {...p} value={periodFrom} onChange={v => setPeriodFrom(v || monthStart(today()))} required />}</Field>
            <Field label={tt('objects.subcontract.periodTo')}>{p => <DateInput {...p} value={periodTo} onChange={v => setPeriodTo(v || today())} required />}</Field>
          </div>
          {error && (
            <p className="faint" style={{ color: 'var(--red)' }}>
              {error}
            </p>
          )}
          {suggestion.isPending && orderId && <Skeleton w="100%" h={80} />}
          {lines.length > 0 && (
            <div className="table-wrap">
              <table className="dtbl" aria-label={tt('objects.subcontract.lines')}>
                <thead>
                  <tr>
                    <th>{tt('objects.subcontract.lineName')}</th>
                    <th style={{ width: 56 }}>{tt('objects.subcontract.unit')}</th>
                    <th style={{ width: 110 }} className="r">
                      {tt('objects.subcontract.qty')}
                    </th>
                    <th style={{ width: 100 }} className="r">
                      {tt('objects.subcontract.price')}
                    </th>
                    <th style={{ width: 110 }} className="r">
                      {tt('objects.subcontract.acceptedQty')}
                    </th>
                    <th style={{ width: 180 }}>{tt('objects.subcontract.reason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.key}>
                      <td>
                        {l.name}
                        {l.orderedQty && (
                          <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>
                            {tt('objects.subcontract.orderedQty', { qty: l.orderedQty })}
                          </span>
                        )}
                      </td>
                      <td className="muted">{l.unitSymbol}</td>
                      <td className="r">
                        <Input
                          inputMode="decimal"
                          aria-label={`${tt('objects.subcontract.qty')} — ${l.name}`}
                          value={l.qty}
                          onChange={e => setLine(l.key, { qty: e.target.value })}
                          style={{ width: 96, textAlign: 'right' }}
                        />
                      </td>
                      <td className="r">
                        <Input
                          inputMode="decimal"
                          aria-label={`${tt('objects.subcontract.price')} — ${l.name}`}
                          value={l.price}
                          onChange={e => setLine(l.key, { price: e.target.value })}
                          style={{ width: 88, textAlign: 'right' }}
                        />
                      </td>
                      <td className="r">
                        <Input
                          inputMode="decimal"
                          aria-label={`${tt('objects.subcontract.acceptedQty')} — ${l.name}`}
                          value={l.acceptedQty}
                          onChange={e => setLine(l.key, { acceptedQty: e.target.value })}
                          style={{ width: 96, textAlign: 'right' }}
                        />
                      </td>
                      <td>
                        {/* отклонение возможно только с причиной из справочника причин брака */}
                        <Select
                          value={l.defectReasonId}
                          onValueChange={v => setLine(l.key, { defectReasonId: v })}
                          placeholder={tt('objects.subcontract.noReason')}
                          options={(reasons.data ?? []).map(r => ({ value: r.id, label: r.name }))}
                          aria-label={`${tt('objects.subcontract.reason')} — ${l.name}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!lines.length && (
            <p className="faint">{orderId ? tt('objects.subcontract.nothingInOrder') : tt('objects.subcontract.pickOrder')}</p>
          )}

          <div className="stack" style={{ gap: 6 }}>
            <div className="faint" style={{ fontSize: 12 }}>
              {tt('objects.subcontract.materials')}
            </div>
            {materials.length > 0 && (
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                {materials.map((m, i) => {
                  const p = stock.find(s => s.productId === m.productId);
                  return (
                    <span key={`${m.productId}-${i}`} className="row" style={{ gap: 6, fontSize: 12 }}>
                      {p?.name ?? m.productId} × {qtyText(m.qty)}
                      <IconButton size="sm" label={tt('objects.subcontract.removeMaterial')} onClick={() => setMaterials(prev => prev.filter((_, n) => n !== i))}>
                        <XCircle size={13} />
                      </IconButton>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label={tt('objects.subcontract.material')} hint={stock.length ? undefined : tt('objects.subcontract.stockEmpty')}>
                {p => (
                  <Select
                    id={p.id}
                    value={productId}
                    onValueChange={setProductId}
                    placeholder={tt('objects.field.none')}
                    options={stock.map(s => ({ value: s.productId, label: `${s.name} (${qtyText(s.qty)})` }))}
                    aria-label={tt('objects.subcontract.material')}
                  />
                )}
              </Field>
              <Field label={tt('objects.subcontract.materialQty')}>
                {p => <Input {...p} inputMode="decimal" value={materialQty} onChange={e => setMaterialQty(e.target.value)} style={{ width: 100 }} />}
              </Field>
              <Button variant="secondary" disabled={!productId} onClick={addMaterial}>
                <Plus size={14} />
                {tt('objects.subcontract.addMaterial')}
              </Button>
            </div>
            <p className="faint" style={{ fontSize: 11 }}>
              {tt('objects.subcontract.materialsHint')}
            </p>
          </div>
          <Field label={tt('objects.field.note')}>{p => <Input {...p} value={note} onChange={e => setNote(e.target.value)} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Карточка акта: строки с отклонением, материалы, документы приёмки и действия */
function SubActCardDialog({ actId, list, canAdmin, onClose }: { actId: string; list: SubAct[]; canAdmin: boolean; onClose: () => void }) {
  const tt = useT();
  const api = useSubActApi();
  const [busy, setBusy] = React.useState(false);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [rejecting, setRejecting] = React.useState(false);
  const [unaccepting, setUnaccepting] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const detail = list.find(a => a.id === actId);
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
  const accept = () =>
    run(async () => {
      const res = await api.accept(actId);
      setWarnings(res.warnings);
      if (!res.warnings.length) toast(tt('objects.subcontract.acceptedToast'), { duration: 1500 });
    });
  if (!detail) return null;
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        size="lg"
        title={`${tt('objects.subcontract.act')} ${detail.number}`}
        description={`${detail.counterpartyName} · ${tt('objects.subcontract.docNumberIn', { number: detail.docNumber || '—', date: fmtDate(detail.docDate) })}`}
        footer={
          <Button variant="ghost" onClick={onClose}>
            {tt('common.close')}
          </Button>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <SubActStatus status={detail.status} />
            <span className="faint" style={{ fontSize: 12 }}>
              {tt('objects.subcontract.period')}: {fmtDate(detail.periodFrom)} — {fmtDate(detail.periodTo)}
            </span>
            {detail.orderNumber && (
              <Link to={`/documents/${detail.orderId}`} className="row" style={{ gap: 6, fontSize: 12 }}>
                <FileText size={13} />
                {tt('objects.subcontract.order')} {detail.orderNumber}
              </Link>
            )}
            {detail.acceptedByName && (
              <span className="faint" style={{ fontSize: 12 }}>
                {tt('objects.subcontract.acceptedBy', { name: detail.acceptedByName })}
              </span>
            )}
          </div>
          <div className="table-wrap">
            <table className="dtbl" aria-label={tt('objects.subcontract.lines')}>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>№</th>
                  <th>{tt('objects.subcontract.lineName')}</th>
                  <th style={{ width: 56 }}>{tt('objects.subcontract.unit')}</th>
                  <th style={{ width: 90 }} className="r">
                    {tt('objects.subcontract.qty')}
                  </th>
                  <th style={{ width: 90 }} className="r">
                    {tt('objects.subcontract.acceptedQty')}
                  </th>
                  <th style={{ width: 90 }} className="r">
                    {tt('objects.subcontract.rejectedQty')}
                  </th>
                  <th style={{ width: 100 }} className="r">
                    {tt('objects.subcontract.price')}
                  </th>
                  <th style={{ width: 110 }} className="r">
                    {tt('objects.subcontract.acceptedAmount')}
                  </th>
                  <th style={{ width: 150 }}>{tt('objects.subcontract.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l, i) => (
                  <tr key={l.id}>
                    <td className="muted">{i + 1}</td>
                    <td>{l.name}</td>
                    <td className="muted">{l.unitSymbol}</td>
                    <td className="r num">{qtyText(l.qty)}</td>
                    <td className="r num">{qtyText(l.acceptedQty)}</td>
                    <td className="r num">{qtyText(l.rejectedQty)}</td>
                    <td className="r num">{fmtAmount(l.price)}</td>
                    <td className="r num">{fmtAmount(l.acceptedAmount)}</td>
                    <td className="muted">{l.reasonName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} className="r bold">
                    {tt('objects.subcontract.presented')}
                  </td>
                  <td className="r num">{fmtAmount(detail.totals.presented)}</td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={7} className="r bold">
                    {tt('objects.subcontract.accepted')}
                  </td>
                  <td className="r num bold">{fmtAmount(detail.totals.accepted)}</td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={7} className="r">
                    {tt('objects.subcontract.rejected')}
                  </td>
                  <td className="r num">{fmtAmount(detail.totals.rejected)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {detail.materials.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <div className="faint" style={{ fontSize: 12 }}>
                {tt('objects.subcontract.materials')}
              </div>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                {detail.materials.map(m => (
                  <span key={m.id}>
                    {m.name} × {qtyText(m.qty)} {m.unitSymbol}
                  </span>
                ))}
              </div>
            </div>
          )}
          {detail.status === 'rejected' && detail.rejectReason && (
            <p className="faint" style={{ fontSize: 12 }}>
              {tt('objects.subcontract.rejectReason')}: {detail.rejectReason}
            </p>
          )}
          {detail.note && (
            <p className="faint" style={{ fontSize: 12 }}>
              {detail.note}
            </p>
          )}
          {warnings.length > 0 && (
            <div className="stack" style={{ gap: 2, color: 'var(--amber)' }}>
              {warnings.map(w => (
                <div key={w} className="row" style={{ gap: 6, fontSize: 12 }}>
                  <CircleAlert size={13} />
                  {warningText(tt, w)}
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {detail.status === 'draft' && (
              <>
                <Button variant="primary" disabled={busy} onClick={() => void accept()}>
                  <CircleCheck size={14} />
                  {tt('objects.subcontract.accept')}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
                  <XCircle size={14} />
                  {tt('objects.subcontract.reject')}
                </Button>
              </>
            )}
            {detail.status === 'accepted' && canAdmin && (
              <Button variant="ghost" disabled={busy} onClick={() => setUnaccepting(true)}>
                <Undo2 size={14} />
                {tt('objects.subcontract.unaccept')}
              </Button>
            )}
            {detail.receiptDocument && (
              <Link to={`/documents/${detail.receiptDocument.id}`} className="row" style={{ gap: 6 }}>
                <FileText size={14} />
                {tt('objects.subcontract.receiptDocument')} {detail.receiptDocument.number ?? tt('objects.acts.draft')}
              </Link>
            )}
            {detail.writeOffDocument && (
              <Link to={`/documents/${detail.writeOffDocument.id}`} className="row" style={{ gap: 6 }}>
                <FileText size={14} />
                {tt('objects.subcontract.writeOffDocument')} {detail.writeOffDocument.number ?? tt('objects.acts.draft')}
              </Link>
            )}
          </div>
          {rejecting && (
            <Dialog open onOpenChange={v => !v && setRejecting(false)}>
              <DialogContent
                title={tt('objects.subcontract.reject')}
                description={tt('objects.subcontract.rejectHint')}
                footer={
                  <>
                    <Button variant="ghost" onClick={() => setRejecting(false)}>
                      {tt('common.cancel')}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={!reason.trim() || busy}
                      onClick={() => {
                        const text = reason.trim();
                        setRejecting(false);
                        setReason('');
                        void run(() => api.reject(actId, text));
                      }}
                    >
                      {tt('objects.subcontract.reject')}
                    </Button>
                  </>
                }
              >
                <Field label={tt('objects.subcontract.rejectReason')}>
                  {p => <Input {...p} value={reason} onChange={e => setReason(e.target.value)} />}
                </Field>
              </DialogContent>
            </Dialog>
          )}
          {unaccepting && (
            <ConfirmDialog
              open
              danger
              title={tt('objects.subcontract.unaccept')}
              confirmLabel={tt('objects.subcontract.unaccept')}
              description={tt('objects.subcontract.unacceptConfirm', { number: detail.number })}
              onOpenChange={open => !open && setUnaccepting(false)}
              onConfirm={() => {
                setUnaccepting(false);
                void run(() => api.unaccept(actId));
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SubcontractTab({ objectId, canWrite, canAdmin }: { objectId: string; canWrite: boolean; canAdmin: boolean }) {
  const tt = useT();
  const data = useSubcontractList(objectId);
  const api = useSubActApi();
  const [creating, setCreating] = React.useState(false);
  const [openAct, setOpenAct] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<SubAct | null>(null);
  if (data.isPending) return <Skeleton w="100%" h={140} />;
  if (data.isError) return <EmptyState icon={<CircleAlert size={20} />} error title={tt('objects.common.error')} />;
  const list = data.data;
  const remove = async () => {
    if (!removing) return;
    const act = removing;
    setRemoving(null);
    try {
      await api.remove(act.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={14} />
            {tt('objects.subcontract.add')}
          </Button>
        )}
        <SubcontractSummaryRow amounts={list.subcontract.amounts} />
      </div>

      {/* Заказы субподрядчикам: документы supplier_order с объектом и их исполнение по актам */}
      <div className="stack" style={{ gap: 6 }}>
        <div className="faint" style={{ fontSize: 12 }}>
          {tt('objects.subcontract.orders')}
        </div>
        {list.subcontract.orders.length ? (
          <div className="table-wrap">
            <table className="dtbl" aria-label={tt('objects.subcontract.orders')}>
              <thead>
                <tr>
                  <th style={{ width: 130 }}>{tt('objects.subcontract.number')}</th>
                  <th style={{ width: 100 }}>{tt('objects.subcontract.docDate')}</th>
                  <th>{tt('objects.subcontract.counterparty')}</th>
                  <th style={{ width: 110 }} className="r">
                    {tt('objects.subcontract.ordered')}
                  </th>
                  <th style={{ width: 110 }} className="r">
                    {tt('objects.subcontract.accepted')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.subcontract.orders.map(o => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/documents/${o.id}`} className="crm-link">
                        {o.number ?? '—'}
                      </Link>
                    </td>
                    <td className="muted">{fmtDate(o.date)}</td>
                    <td>{o.counterpartyName}</td>
                    <td className="r num">{fmtAmount(o.ordered)}</td>
                    <td className="r num">{fmtAmount(o.accepted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="faint" style={{ fontSize: 12 }}>
            {tt('objects.subcontract.noOrders')}
          </p>
        )}
      </div>

      {/* Сводка по субподрядчикам: те же состояния в разрезе контрагента */}
      {list.subcontract.counterparties.length > 1 && (
        <div className="stack" style={{ gap: 2 }}>
          <div className="faint" style={{ fontSize: 12 }}>
            {tt('objects.subcontract.byCounterparty')}
          </div>
          {list.subcontract.counterparties.map(p => (
            <div key={p.counterpartyId} className="row" style={{ gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
              <span>{p.counterpartyName}</span>
              <span className="faint">
                {tt('objects.subcontract.presented')} <span className="num">{fmtAmount(p.presented)}</span>
              </span>
              <span className="faint">
                {tt('objects.subcontract.accepted')} <span className="num">{fmtAmount(p.accepted)}</span>
              </span>
              <span className="faint">
                {tt('objects.subcontract.rejected')} <span className="num">{fmtAmount(p.rejected)}</span>
              </span>
              <span className="faint">
                {tt('objects.subcontract.paid')} <span className="num">{fmtAmount(p.paid)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Отклонённое по причинам справочника брака */}
      {list.subcontract.reasons.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          <div className="faint" style={{ fontSize: 12 }}>
            {tt('objects.subcontract.rejectedByReason')}
          </div>
          {list.subcontract.reasons.map(r => (
            <div key={`${r.reasonId ?? 'act'}-${r.reasonName}`} className="row" style={{ gap: 8, fontSize: 12 }}>
              <span className="muted">{r.reasonName}</span>
              <span className="num">{fmtAmount(r.amount)}</span>
              <span className="faint">({qtyText(r.qty)})</span>
            </div>
          ))}
        </div>
      )}

      {list.items.length ? (
        <div className="table-wrap">
          <table className="dtbl" aria-label={tt('objects.subcontract.title')}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>{tt('objects.subcontract.number')}</th>
                <th style={{ width: 160 }}>{tt('objects.subcontract.docNumber')}</th>
                <th style={{ width: 100 }}>{tt('objects.subcontract.docDate')}</th>
                <th>{tt('objects.subcontract.counterparty')}</th>
                <th style={{ width: 110 }} className="r">
                  {tt('objects.subcontract.presented')}
                </th>
                <th style={{ width: 110 }} className="r">
                  {tt('objects.subcontract.accepted')}
                </th>
                <th style={{ width: 110 }} className="r">
                  {tt('objects.subcontract.rejected')}
                </th>
                <th style={{ width: 110 }}>{tt('objects.subcontract.statusLabel')}</th>
                <th style={{ width: 100 }} className="r">
                  {tt('objects.subcontract.paid')}
                </th>
                <th style={{ width: 72 }} />
              </tr>
            </thead>
            <tbody>
              {list.items.map(a => (
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setOpenAct(a.id)}>
                  <td>{a.number || '—'}</td>
                  <td className="muted">{a.docNumber || '—'}</td>
                  <td className="muted">{fmtDate(a.docDate)}</td>
                  <td>{a.counterpartyName}</td>
                  <td className="r num">{fmtAmount(a.totals.presented)}</td>
                  <td className="r num">{fmtAmount(a.totals.accepted)}</td>
                  <td className="r num">{fmtAmount(a.totals.rejected)}</td>
                  <td>
                    <SubActStatus status={a.status} />
                  </td>
                  <td className="r num">{fmtAmount(a.paid)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    {canWrite && a.status === 'draft' && (
                      <IconButton size="sm" label={tt('objects.subcontract.remove')} onClick={() => setRemoving(a)}>
                        <Trash2 size={13} />
                      </IconButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="faint" style={{ padding: '12px 0' }}>
          {tt('objects.subcontract.empty')}
        </p>
      )}
      <p className="faint" style={{ fontSize: 11 }}>
        {tt('objects.subcontract.hint')}
      </p>
      {creating && <SubActDialog objectId={objectId} orders={list.subcontract.orders} onClose={() => setCreating(false)} />}
      {openAct && <SubActCardDialog actId={openAct} list={list.items} canAdmin={canAdmin} onClose={() => setOpenAct(null)} />}
      {removing && (
        <ConfirmDialog
          open
          danger
          title={tt('objects.subcontract.remove')}
          confirmLabel={tt('objects.subcontract.remove')}
          description={tt('objects.subcontract.confirmRemove', { number: removing.number })}
          onOpenChange={open => !open && setRemoving(null)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}
