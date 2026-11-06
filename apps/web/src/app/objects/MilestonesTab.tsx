/* Вехи объекта (задача 1272): вкладка карточки — этапы и аванс с суммой или процентом от стоимости договора,
   отметки «Выполнено» и «Принято», сводка «выполнено / принято / выставлено / оплачено» по этапам и отдельной строкой аванс.
   «Выставлено» и «Оплачено» заполняются из связанного акта (задача 1273): счёт и акт оказания услуг, оплаты.
   Деньги вех (цена заказчику, без НДС) видят все участники. */
import * as React from 'react';
import { CircleAlert, CircleCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import type { MilestoneKind } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { fmtDate } from '../lib/dates';
import { useObjectMilestoneApi, useObjectMilestones, type MilestoneInput, type ObjectMilestone } from './data';

const trim = (v: string | null | undefined) => (v == null ? '' : v.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'));

/** Форма вехи: сумма или процент — что-то одно; второе поле очищается при вводе */
function MilestoneDialog({ objectId, milestone, onClose }: { objectId: string; milestone: ObjectMilestone | null; onClose: () => void }) {
  const tt = useT();
  const api = useObjectMilestoneApi();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    name: milestone?.name ?? '',
    dueDate: milestone?.dueDate ?? '',
    kind: (milestone?.kind ?? 'stage') as MilestoneKind,
    amount: trim(milestone?.amount),
    pct: trim(milestone?.pct),
    note: milestone?.note ?? '',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) return void toast.error(tt('objects.milestones.nameRequired'));
    const body: MilestoneInput = {
      name: form.name.trim(),
      dueDate: form.dueDate || null,
      kind: form.kind,
      amount: form.amount.trim() || null,
      pct: form.pct.trim() || null,
      note: form.note,
    };
    setBusy(true);
    try {
      if (milestone) await api.update(objectId, milestone.id, body);
      else await api.create(objectId, body);
      toast(tt('objects.common.saved'), { duration: 1500 });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={milestone ? tt('objects.milestones.edit') : tt('objects.milestones.add')}
        description={tt('objects.milestones.amountOrPct')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{tt('common.cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>{tt('objects.common.save')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={tt('objects.milestones.name')}>{p => <Input {...p} value={form.name} onChange={e => set('name', e.target.value)} />}</Field>
          <Field label={tt('objects.milestones.kind')}>
            {p => (
              <Select
                id={p.id}
                value={form.kind}
                onValueChange={v => set('kind', v as MilestoneKind)}
                options={[
                  { value: 'stage', label: tt('objects.milestones.kindStage') },
                  { value: 'advance', label: tt('objects.milestones.kindAdvance') },
                ]}
                aria-label={tt('objects.milestones.kind')}
              />
            )}
          </Field>
          <Field label={tt('objects.milestones.dueDate')}>{p => <Input {...p} type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />}</Field>
          <Field label={tt('objects.milestones.amountField')}>
            {p => <Input {...p} inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value, pct: '' }))} />}
          </Field>
          <Field label={tt('objects.milestones.pctField')}>
            {p => <Input {...p} inputMode="decimal" value={form.pct} onChange={e => setForm(f => ({ ...f, pct: e.target.value, amount: '' }))} />}
          </Field>
          <Field label={tt('objects.field.note')}>{p => <Input {...p} value={form.note} onChange={e => set('note', e.target.value)} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Строка сводки: суммы или «—», если процент ещё не от чего считать */
function SummaryRow({ title, totals, hint }: { title: string; totals: { total: string | null; done: string | null; accepted: string | null; invoiced: string | null; paid: string | null }; hint?: string }) {
  const cells = [totals.total, totals.done, totals.accepted, totals.invoiced, totals.paid];
  return (
    <tr>
      <td>
        {title}
        {hint && <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>{hint}</span>}
      </td>
      {cells.map((v, i) => (
        <td key={i} className="r num">
          {v == null ? '—' : fmtAmount(v)}
        </td>
      ))}
    </tr>
  );
}

export function MilestonesTab({ objectId, canWrite }: { objectId: string; canWrite: boolean }) {
  const tt = useT();
  const data = useObjectMilestones(objectId);
  const api = useObjectMilestoneApi();
  const [dialog, setDialog] = React.useState<'new' | ObjectMilestone | null>(null);
  const [removing, setRemoving] = React.useState<ObjectMilestone | null>(null);
  if (data.isPending) return <Skeleton w="100%" h={120} />;
  if (data.isError) return <EmptyState icon={<CircleAlert size={20} />} error title={tt('objects.common.error')} />;
  const list = data.data;
  const mark = async (m: ObjectMilestone, kind: 'done' | 'accepted', value: boolean) => {
    try {
      if (kind === 'done') await api.setDone(objectId, m.id, value);
      else await api.setAccepted(objectId, m.id, value);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const remove = async () => {
    if (!removing) return;
    const m = removing;
    setRemoving(null);
    try {
      await api.remove(objectId, m.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {canWrite && (
          <Button disabled={false} onClick={() => setDialog('new')}>
            <Plus size={14} />
            {tt('objects.milestones.add')}
          </Button>
        )}
        <span className="faint" style={{ fontSize: 12 }}>
          {list.contractValue == null ? tt('objects.milestones.noContract') : tt('objects.milestones.contractValue', { value: fmtAmount(list.contractValue) })}
        </span>
      </div>

      {list.items.length ? (
        <div className="table-wrap">
          <table className="dtbl" aria-label={tt('objects.milestones.title')}>
            <thead>
              <tr>
                <th>{tt('objects.milestones.name')}</th>
                <th style={{ width: 110 }}>{tt('objects.milestones.dueDate')}</th>
                <th style={{ width: 90 }}>{tt('objects.milestones.kind')}</th>
                <th style={{ width: 120 }}>{tt('objects.milestones.amount')}</th>
                <th style={{ width: 80 }} className="r">{tt('objects.milestones.pct')}</th>
                <th style={{ width: 110 }} className="r">{tt('objects.milestones.value')}</th>
                <th style={{ width: 120 }}>{tt('objects.milestones.done')}</th>
                <th style={{ width: 120 }}>{tt('objects.milestones.accepted')}</th>
                <th style={{ width: 110 }} className="r">{tt('objects.milestones.invoiced')}</th>
                <th style={{ width: 110 }} className="r">{tt('objects.milestones.paid')}</th>
                {canWrite && <th style={{ width: 72 }} />}
              </tr>
            </thead>
            <tbody>
              {list.items.map(m => {
                const advance = m.kind === 'advance';
                const lock = !canWrite;
                return (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      {advance && (
                        <Badge tone="amber">
                          {tt('objects.milestones.kindAdvance')}
                        </Badge>
                      )}
                    </td>
                    <td className="muted">{m.dueDate ? fmtDate(m.dueDate) : '—'}</td>
                    <td className="muted">{advance ? tt('objects.milestones.kindAdvance') : tt('objects.milestones.kindStage')}</td>
                    <td className="r num">{m.amount == null ? '—' : fmtAmount(m.amount)}</td>
                    <td className="r num">{m.pct == null ? '—' : `${trim(m.pct)}%`}</td>
                    <td className="r num" title={m.value == null ? tt('objects.milestones.noValue') : undefined}>
                      {m.value == null ? '—' : fmtAmount(m.value)}
                    </td>
                    <td>
                      <Button size="sm" variant={m.doneAt ? 'secondary' : 'ghost'} disabled={lock} onClick={() => void mark(m, 'done', !m.doneAt)}>
                        <CircleCheck size={13} />
                        {m.doneAt ? fmtDate(m.doneAt.slice(0, 10)) : tt('objects.milestones.markDone')}
                      </Button>
                    </td>
                    <td>
                      <Button size="sm" variant={m.acceptedAt ? 'secondary' : 'ghost'} disabled={lock || !m.doneAt} onClick={() => void mark(m, 'accepted', !m.acceptedAt)}>
                        <CircleCheck size={13} />
                        {m.acceptedAt ? fmtDate(m.acceptedAt.slice(0, 10)) : tt('objects.milestones.markAccepted')}
                      </Button>
                    </td>
                    <td className="r num" title={m.act ? `${tt('objects.acts.act')} ${m.act.number}` : tt('objects.milestones.noAct')}>
                      {m.invoiced == null ? '—' : fmtAmount(m.invoiced)}
                    </td>
                    <td className="r num" title={m.act ? `${tt('objects.acts.act')} ${m.act.number}` : tt('objects.milestones.noAct')}>
                      {m.paid == null ? '—' : fmtAmount(m.paid)}
                    </td>
                    {canWrite && (
                      <td>
                        <div className="row" style={{ gap: 2 }}>
                          <IconButton size="sm" label={tt('objects.milestones.edit')} onClick={() => setDialog(m)}>
                            <Pencil size={13} />
                          </IconButton>
                          <IconButton size="sm" label={tt('objects.milestones.remove')} onClick={() => setRemoving(m)}>
                            <Trash2 size={13} />
                          </IconButton>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <SummaryRow title={tt('objects.milestones.stages')} totals={list.summary.stages} />
              <SummaryRow title={tt('objects.milestones.advance')} totals={list.summary.advance} hint={tt('objects.milestones.notCounted')} />
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="faint" style={{ padding: '12px 0' }}>{tt('objects.milestones.empty')}</p>
      )}
      {list.items.some(m => m.kind === 'advance') && <p className="faint" style={{ fontSize: 11 }}>{tt('objects.milestones.advanceHint')}</p>}

      {dialog && <MilestoneDialog objectId={objectId} milestone={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} />}
      {removing && (
        <ConfirmDialog
          open
          danger
          title={tt('objects.milestones.remove')}
          confirmLabel={tt('objects.milestones.remove')}
          description={tt('objects.milestones.confirmRemove', { name: removing.name })}
          onOpenChange={open => !open && setRemoving(null)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}
