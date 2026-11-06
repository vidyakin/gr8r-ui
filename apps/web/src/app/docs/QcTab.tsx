/* Вкладка «ОТК» выпуска продукции (задача 1186): причина брака, виновный и примечание ОТК по позициям с браком.
   Черновик правится и сохраняется сразу (qc в accounting), в проведённом выпуске у позиции с браком — «На переделку». */
import * as React from 'react';
import { Button, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Select } from '@/components/ui';
import { ShieldAlert } from 'lucide-react';
import { useT } from '@/i18n';
import { fmtNumber } from '@/i18n/format';
import { useWorkspace } from '../data/store';
import { useDefectReasons } from '../production/quality-data';
import type { DocDetail } from './data';

type Item = NonNullable<DocDetail['items']>[number];
/** Значение «не указано» в списке: Radix Select не принимает пустую строку */
const NONE = '__none';

export function QcTab({ doc, editable, canWrite, onSave, onRework }: {
  doc: DocDetail;
  editable: boolean;
  canWrite: boolean;
  onSave: (qc: { itemId: string; defectReasonId?: string | null; defectMemberId?: string | null; qcNote?: string | null }[]) => Promise<unknown>;
  onRework: (itemId: string, qty: string) => Promise<void>;
}) {
  const tt = useT();
  const reasons = useDefectReasons().data ?? [];
  const { data: ws } = useWorkspace();
  const members = (ws?.members ?? []).filter(m => m.status === 'active');
  const rows = (doc.items ?? []).filter(i => Number(i.defectQty) > 0);
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  React.useEffect(() => setNotes(Object.fromEntries((doc.items ?? []).map(i => [i.id, i.qcNote ?? '']))), [doc.items]);
  const [rework, setRework] = React.useState<{ item: Item; qty: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const nameOf = (i: Item) => doc.lines.find(l => l.id === i.documentLineId)?.name ?? '—';

  if (!rows.length) {
    return (
      <EmptyState icon={<ShieldAlert size={20} />} title={tt('production.qc.tab')}>
        {tt('production.qc.empty')}
      </EmptyState>
    );
  }
  const pick = (v: string) => (v === NONE ? null : v);

  return (
    <>
      <table className="tbl" aria-label={tt('production.qc.aria')}>
        <thead>
          <tr>
            <th>{tt('production.qc.colProduct')}</th>
            <th className="r" style={{ width: 90 }}>{tt('production.qc.colDefect')}</th>
            <th style={{ width: 200 }}>{tt('production.qc.colReason')}</th>
            <th style={{ width: 200 }}>{tt('production.qc.colCulprit')}</th>
            <th>{tt('production.qc.colNote')}</th>
            {doc.status === 'posted' && canWrite && <th style={{ width: 130 }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map(i => (
            <tr key={i.id}>
              <td>{nameOf(i)}</td>
              <td className="r num">{fmtNumber(i.defectQty, { maximumFractionDigits: 3 })}</td>
              <td>
                {editable ? (
                  <Select
                    size="sm"
                    aria-label={tt('production.qc.colReason')}
                    value={i.defectReasonId ?? NONE}
                    onValueChange={v => void onSave([{ itemId: i.id, defectReasonId: pick(v) }])}
                    options={[{ value: NONE, label: tt('production.qc.none') }, ...reasons.map(r => ({ value: r.id, label: r.name }))]}
                    placeholder={tt('production.qc.reasonPlaceholder')}
                  />
                ) : (
                  <span className="muted">{reasons.find(r => r.id === i.defectReasonId)?.name ?? '—'}</span>
                )}
              </td>
              <td>
                {editable ? (
                  <Select
                    size="sm"
                    aria-label={tt('production.qc.colCulprit')}
                    value={i.defectMemberId ?? NONE}
                    onValueChange={v => void onSave([{ itemId: i.id, defectMemberId: pick(v) }])}
                    options={[{ value: NONE, label: tt('production.qc.none') }, ...members.map(m => ({ value: m.id, label: m.name }))]}
                    placeholder={tt('production.qc.culpritPlaceholder')}
                  />
                ) : (
                  <span className="muted">{members.find(m => m.id === i.defectMemberId)?.name ?? '—'}</span>
                )}
              </td>
              <td>
                {editable ? (
                  <Input
                    aria-label={tt('production.qc.colNote')}
                    value={notes[i.id] ?? ''}
                    onChange={e => setNotes(n => ({ ...n, [i.id]: e.target.value }))}
                    onBlur={() => (notes[i.id] ?? '') !== (i.qcNote ?? '') && void onSave([{ itemId: i.id, qcNote: notes[i.id] ?? '' }])}
                  />
                ) : (
                  <span className="muted">{i.qcNote || '—'}</span>
                )}
              </td>
              {doc.status === 'posted' && canWrite && (
                <td>
                  <Button size="sm" onClick={() => setRework({ item: i, qty: String(Number(i.defectQty)) })}>
                    {tt('production.qc.rework')}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rework && (
        <Dialog open onOpenChange={o => !o && setRework(null)}>
          <DialogContent
            title={tt('production.qc.reworkTitle')}
            description={tt('production.qc.reworkHint', { qty: fmtNumber(rework.item.defectQty, { maximumFractionDigits: 3 }) })}
            footer={
              <>
                <span className="sp" />
                <DialogClose asChild>
                  <Button variant="secondary">{tt('production.common.cancel')}</Button>
                </DialogClose>
                <Button
                  variant="primary"
                  disabled={busy || !(Number(rework.qty) > 0)}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onRework(rework.item.id, rework.qty.trim().replace(',', '.'));
                      setRework(null);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {tt('production.qc.reworkCreate')}
                </Button>
              </>
            }
          >
            <Field label={tt('production.qc.reworkQty')}>
              {p => <Input {...p} autoFocus inputMode="decimal" value={rework.qty} onChange={e => setRework(r => (r ? { ...r, qty: e.target.value } : r))} />}
            </Field>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
