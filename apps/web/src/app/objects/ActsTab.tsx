/* Акты выполненных работ объекта (задача 1273): вкладка карточки — сводка выручки (выполнено / принято /
   выставлено / оплачено), список актов (номер, дата, период, вид, сумма, статус, выставлен, оплачен),
   создание акта из предложенных строк, карточка акта со строками и итогом, подпись заказчиком, выставление
   счёта и акта оказания услуг, печать КС-2 и КС-3. Деньги — цена заказчику, их видят все участники. */
import * as React from 'react';
import { Link } from 'react-router';
import { CircleAlert, CircleCheck, FileText, Plus, Printer, Receipt, Trash2, Undo2 } from 'lucide-react';
import { actLineAmount, computeActTotals, type ObjectActKind } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { fmtDate } from '../lib/dates';
import { usePrintOpener } from '../money/data';
import { useObjectMilestones } from './data';
import { useActSuggestion, useObjectAct, useObjectActApi, useObjectActs, type ActInput, type ObjectAct, type ObjectRevenue } from './acts-data';
import { DateInput } from '@/components/gr8r/date-picker';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

/** Подпись вида акта в интерфейсе (ключи словаря en/ru) */
const KIND_LABEL: Record<ObjectActKind, 'objects.acts.kindVolumes' | 'objects.acts.kindMilestone' | 'objects.acts.kindHours'> = {
  volumes: 'objects.acts.kindVolumes',
  milestone: 'objects.acts.kindMilestone',
  hours: 'objects.acts.kindHours',
};

/** Шапка вкладки: сводка выручки объекта — четыре состояния не смешиваются */
function RevenueSummary({ revenue }: { revenue: ObjectRevenue }) {
  const tt = useT();
  const cells: { key: keyof ObjectRevenue; label: string }[] = [
    { key: 'done', label: tt('objects.acts.done') },
    { key: 'accepted', label: tt('objects.acts.accepted') },
    { key: 'invoiced', label: tt('objects.acts.invoiced') },
    { key: 'paid', label: tt('objects.acts.paid') },
  ];
  return (
    <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
      {cells.map(c => (
        <div key={c.key}>
          <div className="faint" style={{ fontSize: 11 }}>
            {c.label}
          </div>
          <div className="num" style={{ fontWeight: 600 }}>
            {revenue[c.key] == null ? '—' : fmtAmount(revenue[c.key]!)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Форма нового акта: вид, период, веха и предложенные строки с правкой количества */
function ActDialog({ objectId, onClose }: { objectId: string; onClose: () => void }) {
  const tt = useT();
  const api = useObjectActApi();
  const milestones = useObjectMilestones(objectId);
  const [kind, setKind] = React.useState<ObjectActKind>('volumes');
  const [actDate, setActDate] = React.useState(today());
  const [periodFrom, setPeriodFrom] = React.useState(monthStart(today()));
  const [periodTo, setPeriodTo] = React.useState(today());
  const [milestoneId, setMilestoneId] = React.useState<string>('');
  const [note, setNote] = React.useState('');
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const stages = (milestones.data?.items ?? []).filter(m => m.kind === 'stage');
  const suggestion = useActSuggestion(objectId, { kind, from: periodFrom, to: periodTo, milestoneId: milestoneId || null }, kind !== 'milestone' || !!milestoneId);
  const lines = suggestion.data?.lines ?? [];

  const save = async () => {
    setBusy(true);
    try {
      const body: ActInput = {
        kind,
        actDate,
        periodFrom,
        periodTo,
        milestoneId: kind === 'milestone' ? milestoneId || null : null,
        note,
        // объёмы: количество из формы, по умолчанию — предложенное; веха и часы считаются на сервере
        ...(kind === 'volumes'
          ? { lines: lines.map(l => ({ estimateItemId: l.estimateItemId!, qty: (qty[l.estimateItemId!] ?? l.qty).replace(',', '.') })) }
          : {}),
      };
      await api.create(objectId, body);
      toast(tt('objects.common.saved'), { duration: 1500 });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const error = suggestion.isError ? errorMessage(suggestion.error) : null;

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        size="lg"
        title={tt('objects.acts.add')}
        description={tt('objects.acts.addHint')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {tt('common.cancel')}
            </Button>
            <Button variant="primary" disabled={busy || !!error} onClick={() => void save()}>
              {tt('objects.common.save')}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <Field label={tt('objects.acts.kind')}>
              {p => (
                <Select
                  id={p.id}
                  value={kind}
                  onValueChange={v => setKind(v as ObjectActKind)}
                  options={[
                    { value: 'volumes', label: tt('objects.acts.kindVolumes') },
                    { value: 'milestone', label: tt('objects.acts.kindMilestone') },
                    { value: 'hours', label: tt('objects.acts.kindHours') },
                  ]}
                  aria-label={tt('objects.acts.kind')}
                />
              )}
            </Field>
            <Field label={tt('objects.acts.actDate')}>{p => <DateInput {...p} value={actDate} onChange={v => setActDate(v || today())} required />}</Field>
            <Field label={tt('objects.acts.periodFrom')}>{p => <DateInput {...p} value={periodFrom} onChange={v => setPeriodFrom(v || monthStart(today()))} required />}</Field>
            <Field label={tt('objects.acts.periodTo')}>{p => <DateInput {...p} value={periodTo} onChange={v => setPeriodTo(v || today())} required />}</Field>
          </div>
          {kind === 'milestone' && (
            <Field label={tt('objects.acts.milestone')} hint={tt('objects.acts.milestoneHint')}>
              {p => (
                <Select
                  id={p.id}
                  value={milestoneId}
                  onValueChange={setMilestoneId}
                  placeholder={tt('objects.acts.milestoneNone')}
                  options={stages.map(m => ({ value: m.id, label: m.name }))}
                  aria-label={tt('objects.acts.milestone')}
                />
              )}
            </Field>
          )}
          {error && <p className="faint" style={{ color: 'var(--red)' }}>{error}</p>}
          {suggestion.isPending && <Skeleton w="100%" h={80} />}
          {lines.length > 0 && (
            <div className="table-wrap">
              <table className="dtbl" aria-label={tt('objects.acts.lines')}>
                <thead>
                  <tr>
                    <th>{tt('objects.acts.lineName')}</th>
                    <th style={{ width: 70 }}>{tt('objects.acts.unit')}</th>
                    <th style={{ width: 110 }} className="r">
                      {tt('objects.acts.qty')}
                    </th>
                    <th style={{ width: 110 }} className="r">
                      {tt('objects.acts.price')}
                    </th>
                    <th style={{ width: 120 }} className="r">
                      {tt('objects.acts.amount')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => {
                    const value = l.estimateItemId ? (qty[l.estimateItemId] ?? l.qty) : l.qty;
                    return (
                      <tr key={l.estimateItemId ?? l.name}>
                        <td>
                          {l.name}
                          {l.doneQty != null && (
                            <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>
                              {tt('objects.acts.doneAndAccepted', { done: l.doneQty, accepted: l.acceptedQty ?? '0' })}
                            </span>
                          )}
                        </td>
                        <td className="muted">{l.unitSymbol}</td>
                        <td className="r">
                          {kind === 'volumes' && l.estimateItemId ? (
                            <Input
                              inputMode="decimal"
                              aria-label={`${tt('objects.acts.qty')} — ${l.name}`}
                              value={value}
                              onChange={e => setQty(q => ({ ...q, [l.estimateItemId!]: e.target.value }))}
                              style={{ width: 96, textAlign: 'right' }}
                            />
                          ) : (
                            <span className="num">{value}</span>
                          )}
                        </td>
                        <td className="r num">{fmtAmount(l.price)}</td>
                        <td className="r num">{fmtAmount(actLineAmount({ qty: value.replace(',', '.') || '0', price: l.price }))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!suggestion.isPending && !error && !lines.length && <p className="faint">{tt('objects.acts.nothingToAccept')}</p>}
          {suggestion.data?.hours && (
            <p className="faint" style={{ fontSize: 12 }}>
              {tt('objects.acts.hoursHint', { hours: suggestion.data.hours.hours, rate: fmtAmount(suggestion.data.hours.rate ?? '0') })}
            </p>
          )}
          <Field label={tt('objects.field.note')}>{p => <Input {...p} value={note} onChange={e => setNote(e.target.value)} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Карточка акта: строки, итог, подпись, выставление и печать */
function ActCardDialog({ actId, canAdmin, onClose }: { actId: string; canAdmin: boolean; onClose: () => void }) {
  const tt = useT();
  const api = useObjectActApi();
  const openPrint = usePrintOpener();
  const act = useObjectAct(actId);
  const [busy, setBusy] = React.useState(false);
  const [unsigning, setUnsigning] = React.useState(false);
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
  const detail = act.data;
  const totals = detail ? computeActTotals(detail.lines) : null;
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        size="lg"
        title={detail ? `${tt('objects.acts.act')} ${detail.number || '—'}` : tt('objects.acts.act')}
        description={detail ? `${fmtDate(detail.actDate)} · ${tt(KIND_LABEL[detail.kind])}` : undefined}
        footer={
          detail && (
            <>
              <Button variant="ghost" onClick={() => void openPrint(`/object-acts/${detail.id}/print/ks2`).catch(e => toast.error(errorMessage(e)))}>
                <Printer size={14} />
                {tt('objects.acts.printKs2')}
              </Button>
              <Button variant="ghost" onClick={() => void openPrint(`/object-acts/${detail.id}/print/ks3`).catch(e => toast.error(errorMessage(e)))}>
                <Printer size={14} />
                {tt('objects.acts.printKs3')}
              </Button>
              <Button variant="ghost" onClick={onClose}>
                {tt('common.close')}
              </Button>
            </>
          )
        }
      >
        {act.isPending && <Skeleton w="100%" h={120} />}
        {detail && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge tone={detail.status === 'signed' ? 'green' : 'gray'}>{detail.status === 'signed' ? tt('objects.acts.signed') : tt('objects.acts.draft')}</Badge>
              <span className="faint" style={{ fontSize: 12 }}>
                {tt('objects.acts.period')}: {fmtDate(detail.periodFrom)} — {fmtDate(detail.periodTo)}
              </span>
              {detail.signedByName && (
                <span className="faint" style={{ fontSize: 12 }}>
                  {tt('objects.acts.signedBy', { name: detail.signedByName })}
                </span>
              )}
              {detail.milestoneName && <span className="faint" style={{ fontSize: 12 }}>{detail.milestoneName}</span>}
            </div>
            <div className="table-wrap">
              <table className="dtbl" aria-label={tt('objects.acts.lines')}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>№</th>
                    <th>{tt('objects.acts.lineName')}</th>
                    <th style={{ width: 60 }}>{tt('objects.acts.unit')}</th>
                    <th style={{ width: 90 }} className="r">
                      {tt('objects.acts.qty')}
                    </th>
                    <th style={{ width: 100 }} className="r">
                      {tt('objects.acts.price')}
                    </th>
                    <th style={{ width: 110 }} className="r">
                      {tt('objects.acts.amount')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l, i) => (
                    <tr key={l.id}>
                      <td className="muted">{i + 1}</td>
                      <td>{l.name}</td>
                      <td className="muted">{l.unitSymbol}</td>
                      <td className="r num">{l.qty.replace(/\.?0+$/, '')}</td>
                      <td className="r num">{fmtAmount(l.price)}</td>
                      <td className="r num">{fmtAmount(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="r bold">
                      {tt('objects.acts.net')}
                    </td>
                    <td className="r num">{fmtAmount(totals!.net)}</td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="r">
                      {tt('objects.acts.vat')}
                    </td>
                    <td className="r num">{fmtAmount(totals!.vat)}</td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="r bold">
                      {tt('objects.acts.total')}
                    </td>
                    <td className="r num bold">{fmtAmount(totals!.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {detail.note && <p className="faint" style={{ fontSize: 12 }}>{detail.note}</p>}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {detail.status === 'draft' ? (
                <Button variant="primary" disabled={busy} onClick={() => void run(() => api.sign(detail.id))}>
                  <CircleCheck size={14} />
                  {tt('objects.acts.sign')}
                </Button>
              ) : (
                <>
                  {!detail.invoiceDocumentId && (
                    <Button variant="primary" disabled={busy} onClick={() => void run(() => api.invoice(detail.id))}>
                      <Receipt size={14} />
                      {tt('objects.acts.invoice')}
                    </Button>
                  )}
                  {canAdmin && (
                    <Button variant="ghost" disabled={busy} onClick={() => setUnsigning(true)}>
                      <Undo2 size={14} />
                      {tt('objects.acts.unsign')}
                    </Button>
                  )}
                </>
              )}
            </div>
            {(detail.invoiceDocument || detail.actDocument) && (
              <div className="stack" style={{ gap: 4 }}>
                <div className="faint" style={{ fontSize: 12 }}>
                  {tt('objects.acts.documents')}
                </div>
                <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                  {detail.invoiceDocument && (
                    <Link to={`/documents/${detail.invoiceDocument.id}`} className="row" style={{ gap: 6 }}>
                      <FileText size={14} />
                      {tt('objects.acts.invoiceDocument')} {detail.invoiceDocument.number ?? tt('objects.acts.draft')}
                    </Link>
                  )}
                  {detail.actDocument && (
                    <Link to={`/documents/${detail.actDocument.id}`} className="row" style={{ gap: 6 }}>
                      <FileText size={14} />
                      {tt('objects.acts.actDocument')} {detail.actDocument.number ?? tt('objects.acts.draft')}
                    </Link>
                  )}
                </div>
              </div>
            )}
            {unsigning && (
              <ConfirmDialog
                open
                danger
                title={tt('objects.acts.unsign')}
                confirmLabel={tt('objects.acts.unsign')}
                description={tt('objects.acts.unsignConfirm', { number: detail.number })}
                onOpenChange={open => !open && setUnsigning(false)}
                onConfirm={() => {
                  setUnsigning(false);
                  void run(() => api.unsign(detail.id));
                }}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ActsTab({ objectId, canWrite, canAdmin }: { objectId: string; canWrite: boolean; canAdmin: boolean }) {
  const tt = useT();
  const data = useObjectActs(objectId);
  const api = useObjectActApi();
  const [creating, setCreating] = React.useState(false);
  const [openAct, setOpenAct] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<ObjectAct | null>(null);
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
            {tt('objects.acts.add')}
          </Button>
        )}
        <RevenueSummary revenue={list.revenue} />
      </div>
      {list.items.length ? (
        <div className="table-wrap">
          <table className="dtbl" aria-label={tt('objects.acts.title')}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>{tt('objects.acts.number')}</th>
                <th style={{ width: 100 }}>{tt('objects.acts.actDate')}</th>
                <th style={{ width: 170 }}>{tt('objects.acts.period')}</th>
                <th style={{ width: 130 }}>{tt('objects.acts.kind')}</th>
                <th style={{ width: 120 }} className="r">
                  {tt('objects.acts.sum')}
                </th>
                <th style={{ width: 110 }}>{tt('objects.acts.status')}</th>
                <th style={{ width: 90 }} className="r">
                  {tt('objects.acts.invoiced')}
                </th>
                <th style={{ width: 90 }} className="r">
                  {tt('objects.acts.paid')}
                </th>
                <th style={{ width: 72 }} />
              </tr>
            </thead>
            <tbody>
              {list.items.map(a => (
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setOpenAct(a.id)}>
                  <td>{a.number || '—'}</td>
                  <td className="muted">{fmtDate(a.actDate)}</td>
                  <td className="muted">
                    {fmtDate(a.periodFrom)} — {fmtDate(a.periodTo)}
                  </td>
                  <td className="muted">
                    {tt(KIND_LABEL[a.kind])}
                    {a.milestoneName && <div style={{ fontSize: 11 }}>{a.milestoneName}</div>}
                  </td>
                  <td className="r num">{fmtAmount(a.totals.net)}</td>
                  <td>
                    <Badge tone={a.status === 'signed' ? 'green' : 'gray'}>{a.status === 'signed' ? tt('objects.acts.signed') : tt('objects.acts.draft')}</Badge>
                  </td>
                  <td className="r num">{a.invoiceDocumentId ? fmtAmount(a.invoiced) : '—'}</td>
                  <td className="r num">{fmtAmount(a.paid)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    {canWrite && a.status === 'draft' && !a.invoiceDocumentId && (
                      <IconButton size="sm" label={tt('objects.acts.remove')} onClick={() => setRemoving(a)}>
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
          {tt('objects.acts.empty')}
        </p>
      )}
      <p className="faint" style={{ fontSize: 11 }}>
        {tt('objects.acts.hint')}
      </p>
      {creating && <ActDialog objectId={objectId} onClose={() => setCreating(false)} />}
      {openAct && <ActCardDialog actId={openAct} canAdmin={canAdmin} onClose={() => setOpenAct(null)} />}
      {removing && (
        <ConfirmDialog
          open
          danger
          title={tt('objects.acts.remove')}
          confirmLabel={tt('objects.acts.remove')}
          description={tt('objects.acts.confirmRemove', { number: removing.number })}
          onOpenChange={open => !open && setRemoving(null)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}
