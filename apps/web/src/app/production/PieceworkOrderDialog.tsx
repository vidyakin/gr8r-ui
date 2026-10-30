/* Сдельный наряд: создание и правка черновика, проведение и отмена проведения. Наряд — документ типа piecework_order;
   строки правятся до проведения, расценка пустая — берётся действующая на дату наряда (docs/architecture/piecework.md). */
import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Dialog, DialogContent, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { useWorkCenters } from '../catalog/data';
import { useCanWrite } from '../meta/custom-fields';
import { STATUS_LABEL, STATUS_TONE } from '../docs/data';
import { useOperations, usePieceworkApi, usePieceworkOrder } from './piecework-data';
import { useT } from '@/i18n';
import { fmtNumber } from '@/i18n/format';

interface FormLine {
  key: string;
  id?: string;
  operationId: string;
  qty: string;
  rate: string;
  /** Поля, которые форма не показывает, но не должна терять при сохранении */
  keep: { hours: string; planQty: string; assignmentId: string | null; releaseDocumentId: string | null; productId: string | null; orderDocumentId: string | null };
}

const today = () => new Date().toISOString().slice(0, 10);
const trim = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);
let seq = 0;
const emptyLine = (): FormLine => ({ key: `n${++seq}`, operationId: '', qty: '1', rate: '', keep: { hours: '0', planQty: '0', assignmentId: null, releaseDocumentId: null, productId: null, orderDocumentId: null } });

/** id — открыть существующий наряд; без id — новый */
export function PieceworkOrderDialog({ id, onClose }: { id?: string; onClose: () => void }) {
  const tt = useT();
  const canWrite = useCanWrite();
  const api = usePieceworkApi();
  const detail = usePieceworkOrder(id);
  const operations = useOperations().data?.items ?? [];
  const centers = useWorkCenters().data?.items ?? [];
  const members = useWorkspace().data.members.filter(m => m.status === 'active');
  const order = detail.data;
  const editable = canWrite && (!id || order?.status === 'draft');

  const [date, setDate] = React.useState(today());
  const [memberId, setMemberId] = React.useState('');
  const [workCenterId, setWorkCenterId] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [lines, setLines] = React.useState<FormLine[]>([emptyLine()]);
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [errors, setErrors] = React.useState<{ member?: string; lines?: string }>({});

  const loaded = React.useRef<unknown>(null);
  React.useEffect(() => {
    if (!order || loaded.current === order) return;
    loaded.current = order;
    setDate(order.date);
    setMemberId(order.member?.id ?? '');
    setWorkCenterId(order.workCenter?.id ?? '');
    setComment(order.comment ?? '');
    setLines(
      order.lines.map(l => ({
        key: l.id,
        id: l.id,
        operationId: l.operationId,
        qty: trim(l.qty),
        rate: l.rate ? trim(l.rate) : '',
        keep: { hours: l.hours, planQty: l.planQty, assignmentId: l.assignmentId, releaseDocumentId: l.releaseDocumentId, productId: l.productId, orderDocumentId: l.orderDocumentId },
      })),
    );
  }, [order]);

  const patchLine = (key: string, p: Partial<FormLine>) => setLines(prev => prev.map(l => (l.key === key ? { ...l, ...p } : l)));
  const body = () => ({
    date,
    comment,
    lines: lines.map(l => ({
      ...(l.id ? { id: l.id } : {}),
      operationId: l.operationId,
      qty: l.qty.trim(),
      ...(l.rate.trim() ? { rate: l.rate.trim() } : {}),
      ...l.keep,
    })),
  });

  const validate = () => {
    const errs: { member?: string; lines?: string } = {};
    if (!id && !memberId) errs.member = tt('production.piecework.orders.form.errExecutor');
    if (!lines.length || lines.some(l => !l.operationId || !(Number(l.qty) > 0))) errs.lines = tt('production.piecework.orders.form.errLines');
    setErrors(errs);
    return !Object.keys(errs).length;
  };

  const save = async (): Promise<boolean> => {
    if (!validate()) return false;
    setBusy(true);
    const r = id ? await api.run('PATCH', `/production/piecework/${id}`, body()) : await api.run('POST', '/production/piecework', { ...body(), memberId, workCenterId: workCenterId || null });
    setBusy(false);
    if (!r) return false;
    toast(id ? tt('production.piecework.orders.form.saved') : tt('production.piecework.orders.form.created'));
    return true;
  };
  const post = async () => {
    if (!id || !(await save())) return;
    setBusy(true);
    const r = await api.run('POST', `/documents/${id}/post`);
    setBusy(false);
    if (r) {
      toast(tt('production.piecework.orders.form.posted'));
      onClose();
    }
  };
  const unpost = async () => {
    if (!id) return;
    setBusy(true);
    const r = await api.run('POST', `/documents/${id}/unpost`);
    setBusy(false);
    if (r) toast(tt('production.piecework.orders.form.unposted'));
  };
  const remove = async () => {
    if (!id) return;
    if (await api.run('DELETE', `/documents/${id}`)) {
      toast(tt('production.piecework.orders.form.deleted'));
      onClose();
    }
  };

  const seeAmount = order?.lines.some(l => l.amount !== null) ?? false;
  const total = (order?.lines ?? []).reduce((s, l) => s + Number(l.amount ?? 0), 0);
  /** Операции для выбора; выбранная в строке остаётся в списке, даже если ушла в архив */
  const opOptions = (current: string) => {
    const list = operations.filter(o => !o.archived || o.productId === current).map(o => ({ value: o.productId, label: o.name }));
    if (current && !list.some(o => o.value === current)) list.push({ value: current, label: order?.lines.find(l => l.operationId === current)?.operationName ?? current });
    return list;
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title={
          <span className="row" style={{ gap: 8 }}>
            {id ? tt('production.piecework.orders.form.title', { number: order?.number ?? tt('production.common.draft') }) : tt('production.piecework.orders.form.newTitle')}
            {order && (
              <Badge tone={STATUS_TONE[order.status]} dot>
                {STATUS_LABEL[order.status]}
              </Badge>
            )}
          </span>
        }
        footer={
          <>
            {id && order?.status === 'draft' && canWrite && (
              <Button variant="ghost" disabled={busy} onClick={() => setRemoving(true)}>
                {tt('production.common.delete')}
              </Button>
            )}
            <span className="sp" />
            <Button variant="ghost" onClick={onClose}>
              {tt('production.common.close')}
            </Button>
            {id && order?.status === 'posted' && canWrite && (
              <Button disabled={busy} onClick={() => void unpost()}>
                {tt('production.piecework.unpost')}
              </Button>
            )}
            {editable && (
              <Button variant={id ? 'secondary' : 'primary'} disabled={busy} onClick={() => void save().then(ok => ok && !id && onClose())}>
                {id ? tt('production.common.save') : tt('production.common.create')}
              </Button>
            )}
            {id && order?.status === 'draft' && canWrite && (
              <Button variant="primary" disabled={busy} onClick={() => void post()}>
                {tt('production.piecework.post')}
              </Button>
            )}
          </>
        }
      >
        {id && detail.isPending ? (
          <Skeleton w="100%" h={120} />
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 8 }}>
              <Field label={tt('production.piecework.orders.form.date')}>{p => <Input {...p} type="date" disabled={!editable} value={date} onChange={e => setDate(e.target.value)} />}</Field>
              <Field label={tt('production.piecework.orders.col.executor')} error={errors.member}>
                {p =>
                  id ? (
                    <Input {...p} disabled value={order?.member?.name ?? ''} />
                  ) : (
                    <Select id={p.id} value={memberId} placeholder={tt('production.piecework.orders.form.executorPlaceholder')} onValueChange={v => (setMemberId(v), setErrors({}))} options={members.map(m => ({ value: m.id, label: m.name }))} />
                  )
                }
              </Field>
              <Field label={tt('production.piecework.orders.col.workCenter')}>
                {p =>
                  id ? (
                    <Input {...p} disabled value={order?.workCenter?.name ?? ''} />
                  ) : (
                    <Select id={p.id} value={workCenterId} placeholder={tt('production.common.notChosen')} onValueChange={setWorkCenterId} options={[{ value: '', label: tt('production.common.notChosen') }, ...centers.map(c => ({ value: c.id, label: c.name }))]} />
                  )
                }
              </Field>
            </div>

            <div className="stack" style={{ gap: 6 }}>
              <div className="faint" style={{ fontSize: 12.5 }}>
                {tt('production.piecework.orders.form.operations')}
              </div>
              {lines.map(l => (
                <div key={l.key} className="row" style={{ gap: 8 }}>
                  <div style={{ flex: 2, minWidth: 0 }}>
                    <Select value={l.operationId} disabled={!editable} placeholder={tt('production.piecework.orders.form.chooseOperation')} onValueChange={v => (patchLine(l.key, { operationId: v }), setErrors({}))} options={opOptions(l.operationId)} />
                  </div>
                  <Input aria-label={tt('production.piecework.output.col.qty')} placeholder={tt('production.piecework.output.col.qty')} inputMode="decimal" disabled={!editable} style={{ flex: 1 }} value={l.qty} onChange={e => (patchLine(l.key, { qty: e.target.value }), setErrors({}))} />
                  <Input aria-label={tt('production.piecework.rates.rate')} placeholder={tt('production.piecework.orders.form.rateAuto')} inputMode="decimal" disabled={!editable} style={{ flex: 1 }} value={l.rate} onChange={e => patchLine(l.key, { rate: e.target.value })} />
                  {id && seeAmount && (
                    <span className="num faint" style={{ minWidth: 70, textAlign: 'right' }}>
                      {order?.lines.find(x => x.id === l.id)?.amount ?? ''}
                    </span>
                  )}
                  {editable && (
                    <IconButton label={tt('production.piecework.orders.form.removeLine')} onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))}>
                      <Trash2 size={14} />
                    </IconButton>
                  )}
                </div>
              ))}
              {errors.lines && (
                <div className="field-error" role="alert">
                  {errors.lines}
                </div>
              )}
              <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                {editable ? (
                  <Button size="sm" variant="ghost" onClick={() => setLines(prev => [...prev, emptyLine()])}>
                    <Plus size={13} />
                    {tt('production.piecework.orders.form.addLine')}
                  </Button>
                ) : (
                  <span />
                )}
                {id && seeAmount && (
                  <span className="num">
                    {tt('production.piecework.orders.col.amount')}: <b>{fmtNumber(total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
                  </span>
                )}
              </div>
            </div>

            <Field label={tt('production.piecework.orders.form.comment')}>{p => <Input {...p} disabled={!editable} value={comment} onChange={e => setComment(e.target.value)} />}</Field>
          </div>
        )}
        <ConfirmDialog open={removing} onOpenChange={setRemoving} danger title={tt('production.piecework.orders.form.deleteTitle')} description={tt('production.piecework.orders.form.deleteHint')} confirmLabel={tt('production.common.delete')} cancelLabel={tt('production.common.cancel')} onConfirm={() => void remove()} />
      </DialogContent>
    </Dialog>
  );
}
