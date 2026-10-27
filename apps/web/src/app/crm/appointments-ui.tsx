/* Запись на приём (задача 1171): сетка «время × колонки» (день всех специалистов, неделя специалиста), диалог записи и карточка записи.
   Сетка работает на телефонной ширине: горизонтальная прокрутка, закреплённая колонка времени. */
import * as React from 'react';
import { freeStarts, OCCUPYING_STATUSES, productFitsSpecialist, slotsNeeded, type AppointmentStatus } from '@gr8r/shared';
import { Badge, Button, Dialog, DialogContent, Field, Input, Segmented, Select, Textarea, toast } from '@/components/ui';
import { fmtAmount, fmtDateTimeIntl, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useProducts } from '../catalog/data';
import { useCrm } from './store';
import { useApptMutation, useDayBoard, useFreeSlot, useSpecialists, type Appt, type DayColumn } from './appointments-data';

/** Время «09:30» по языку интерфейса */
export const fmtMin = (m: number) => fmtDateTimeIntl(new Date(2000, 0, 1, Math.floor(m / 60), m % 60), { hour: '2-digit', minute: '2-digit' });
export const STATUS_TONE: Record<AppointmentStatus, 'accent' | 'green' | 'amber' | 'red' | 'gray'> = { booked: 'accent', confirmed: 'amber', came: 'green', no_show: 'red', cancelled: 'gray' };
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export { isoToday };

export interface BoardCol extends Pick<DayColumn, 'specialistId' | 'date' | 'slotMinutes' | 'dayStartMin' | 'dayEndMin' | 'working' | 'appointments'> {
  key: string;
  header: React.ReactNode;
  warn?: boolean;
  holiday?: boolean;
}

/** Сетка: строка = наибольший общий шаг слотов колонок; слот специалиста занимает slotMinutes/шаг строк, запись — свои слоты подряд */
export function Board({ cols, moving, onFree, onAppt, onDropAppt, label }: { cols: BoardCol[]; moving?: boolean; onFree: (c: BoardCol, startMin: number) => void; onAppt: (a: Appt) => void; onDropAppt?: (id: string, c: BoardCol, startMin: number) => void; label: string }) {
  const t = useT();
  if (!cols.length) return null;
  const start = Math.min(...cols.map(c => c.dayStartMin));
  const end = Math.max(...cols.map(c => c.dayEndMin));
  const step = cols.reduce((g, c) => gcd(gcd(g, c.slotMinutes), c.dayStartMin - start), 0) || 15;
  const rows = Math.ceil((end - start) / step);
  const rowOf = (m: number) => Math.floor((m - start) / step) + 2;
  const cells: React.ReactNode[] = [];
  cols.forEach((c, ci) => {
    const gc = ci + 2;
    const covered = new Set<number>();
    const shown = c.appointments.filter(a => (OCCUPYING_STATUSES as string[]).includes(a.status));
    for (const a of shown) {
      const r0 = rowOf(a.startMin);
      const n = Math.max(1, Math.round((a.endMin - a.startMin) / step));
      for (let r = r0; r < r0 + n; r++) covered.add(r);
      cells.push(
        <button
          key={`a${c.key}${a.id}`}
          type="button"
          className={`appt-item ${a.status}`}
          style={{ gridColumn: gc, gridRow: `${r0} / span ${n}` }}
          draggable={a.status === 'booked' || a.status === 'confirmed'}
          onDragStart={e => e.dataTransfer.setData('text/plain', a.id)}
          onClick={() => onAppt(a)}
          title={`${fmtMin(a.startMin)}–${fmtMin(a.endMin)} · ${a.clientName} · ${a.productName ?? ''}`}
        >
          <span className="nm">{a.clientName}</span>
          <span className="sv">{fmtMin(a.startMin)} · {a.productName}</span>
        </button>,
      );
    }
    for (const s of c.working) {
      const r0 = rowOf(s);
      const n = Math.max(1, Math.round(c.slotMinutes / step));
      let taken = false;
      for (let r = r0; r < r0 + n; r++) if (covered.has(r)) taken = true;
      for (let r = r0; r < r0 + n; r++) covered.add(r);
      if (taken) continue;
      cells.push(
        <button
          key={`f${c.key}${s}`}
          type="button"
          className={`appt-cell free${moving ? ' target' : ''}`}
          style={{ gridColumn: gc, gridRow: `${r0} / span ${n}` }}
          aria-label={t('appt.board.freeSlot', { time: fmtMin(s) })}
          onClick={() => onFree(c, s)}
          onDragOver={e => onDropAppt && e.preventDefault()}
          onDrop={e => {
            const id = e.dataTransfer.getData('text/plain');
            if (id && onDropAppt) onDropAppt(id, c, s);
          }}
        >
          {fmtMin(s)}
        </button>,
      );
    }
    for (let r = 2; r < rows + 2; r++) if (!covered.has(r)) cells.push(<div key={`o${c.key}${r}`} className="appt-cell off" style={{ gridColumn: gc, gridRow: r }} aria-hidden />);
  });
  return (
    <div className="appt-scroll">
      <div className="appt-grid" role="group" aria-label={label} style={{ gridTemplateColumns: `64px repeat(${cols.length}, minmax(120px, 1fr))`, gridTemplateRows: `auto repeat(${rows}, 32px)` }}>
        <div className="appt-h corner" style={{ gridColumn: 1, gridRow: 1 }} />
        {cols.map((c, ci) => (
          <div key={`h${c.key}`} className={`appt-h${c.warn ? ' warn' : ''}${c.holiday ? ' holiday' : ''}`} style={{ gridColumn: ci + 2, gridRow: 1 }}>
            {c.header}
          </div>
        ))}
        {Array.from({ length: rows }, (_, i) => {
          const m = start + i * step;
          return (
            <div key={`t${i}`} className="appt-time" style={{ gridColumn: 1, gridRow: i + 2 }}>
              {m % 30 === 0 || step >= 30 ? fmtMin(m) : ''}
            </div>
          );
        })}
        {cells}
      </div>
    </div>
  );
}

/* ---------------- запись ---------------- */

export interface BookPreset {
  specialistId?: string;
  date?: string;
  startMin?: number;
  contactId?: string;
  companyId?: string;
}

export function BookDialog({ open, onOpenChange, preset }: { open: boolean; onOpenChange: (v: boolean) => void; preset: BookPreset }) {
  const t = useT();
  const { data: crm } = useCrm();
  const specs = useSpecialists();
  const prods = useProducts({ active: true });
  const create = useApptMutation<{ id: string }>('POST');
  const free = useFreeSlot();
  const [mode, setMode] = React.useState<'contact' | 'company' | 'new'>(preset.companyId ? 'company' : 'contact');
  const [clientId, setClientId] = React.useState(preset.contactId ?? preset.companyId ?? '');
  const [filter, setFilter] = React.useState('');
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [productId, setProductId] = React.useState('');
  const [specialistId, setSpecialistId] = React.useState(preset.specialistId ?? '');
  const [date, setDate] = React.useState(preset.date ?? isoToday());
  const [startMin, setStartMin] = React.useState<number | null>(preset.startMin ?? null);
  const [price, setPrice] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // услуги — только виды, которые оказывает выбранный специалист; специалисты — только те, кто оказывает выбранную услугу (задача 1172)
  const allServices = (prods.data ?? []).filter(p => p.kind === 'service');
  const chosen = (specs.data ?? []).find(s => s.memberId === specialistId);
  const services = allServices.filter(p => productFitsSpecialist(p.productKindId, chosen?.productKindIds ?? null));
  const product = allServices.find(p => p.id === productId);
  const specialists = (specs.data ?? []).filter(s => !product || productFitsSpecialist(product.productKindId, s.productKindIds));
  const board = useDayBoard(date);
  const col = board.data?.columns.find(c => c.specialistId === specialistId);
  const starts = React.useMemo(() => {
    if (!col) return [];
    const slots = slotsNeeded(product?.appointmentMinutes, col.slotMinutes);
    const busyRanges = col.appointments.filter(a => (OCCUPYING_STATUSES as string[]).includes(a.status)).map(a => ({ startMin: a.startMin, endMin: a.endMin }));
    return freeStarts({ working: col.working, slotMinutes: col.slotMinutes, slots, busy: busyRanges });
  }, [col, product]);
  const options = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = mode === 'company' ? crm.companies.map(c => ({ value: c.id, label: c.name })) : crm.contacts.map(c => ({ value: c.id, label: c.phone ? `${c.name} · ${c.phone}` : c.name }));
    return list.filter(o => !q || String(o.label).toLowerCase().includes(q)).slice(0, 60);
  }, [mode, filter, crm.companies, crm.contacts]);

  const pickProduct = (id: string) => {
    setProductId(id);
    const p = services.find(x => x.id === id);
    if (p) setPrice(String(Number(p.price)));
    setStartMin(null);
  };
  const findFree = () => {
    if (!productId) return;
    free.mutate(
      { productId, ...(specialistId ? { specialistId } : {}), from: date },
      {
        onSuccess: r => {
          if (!r.slot) return toast(t('appt.book.noFree'));
          setSpecialistId(r.slot.memberId);
          setDate(r.slot.date);
          setStartMin(r.slot.startMin);
          toast(t('appt.book.freeFound', { name: r.slot.specialistName, time: fmtMin(r.slot.startMin) }));
        },
        onError: e => toast.error(errorMessage(e)),
      },
    );
  };
  const valid = (mode === 'new' ? name.trim() && phone.trim() : clientId) && productId && specialistId && startMin !== null;
  const submit = async () => {
    setBusy(true);
    try {
      let contactId = mode === 'contact' ? clientId : undefined;
      if (mode === 'new') contactId = (await create.mutateAsync({ path: '/clients', body: { name: name.trim(), phone: phone.trim() } })).id;
      await create.mutateAsync({ path: '', body: { specialistId, productId, date, startMin, comment, price: price || undefined, ...(contactId ? { contactId } : {}), ...(mode === 'company' ? { companyId: clientId } : {}) } });
      toast(t('appt.book.created'));
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('appt.book.title')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={!valid || busy} onClick={() => void submit()}>{t('appt.book.submit')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Segmented<'contact' | 'company' | 'new'> value={mode} onValueChange={v => { setMode(v); setClientId(''); }} aria-label={t('appt.book.client')} items={[{ value: 'contact', label: t('appt.book.contact') }, { value: 'company', label: t('appt.book.company') }, { value: 'new', label: t('appt.book.newClient') }]} />
          {mode === 'new' ? (
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <Field label={t('appt.book.name')}>{p => <Input {...p} value={name} maxLength={200} onChange={e => setName(e.target.value)} />}</Field>
              <Field label={t('appt.book.phone')}>{p => <Input {...p} type="tel" value={phone} maxLength={40} onChange={e => setPhone(e.target.value)} />}</Field>
            </div>
          ) : (
            <>
              <Field label={t('appt.book.search')}>{p => <Input {...p} value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('appt.book.searchPlaceholder')} />}</Field>
              <Field label={t('appt.book.client')}>{p => <Select id={p.id} value={clientId} onValueChange={setClientId} options={options} placeholder={t('appt.book.pickClient')} aria-label={t('appt.book.client')} />}</Field>
            </>
          )}
          <Field label={t('appt.book.service')}>
            {p => <Select id={p.id} value={productId} onValueChange={pickProduct} options={services.map(s => ({ value: s.id, label: s.appointmentMinutes ? `${s.name} · ${t('appt.minutes', { n: s.appointmentMinutes })}` : s.name }))} placeholder={t('appt.book.pickService')} aria-label={t('appt.book.service')} />}
          </Field>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <Field label={t('appt.book.specialist')}>{p => <Select id={p.id} value={specialistId} onValueChange={v => { setSpecialistId(v); setStartMin(null); const sp = (specs.data ?? []).find(x => x.memberId === v); if (product && !productFitsSpecialist(product.productKindId, sp?.productKindIds ?? null)) setProductId(''); }} options={specialists.map(s => ({ value: s.memberId, label: s.name }))} placeholder={t('appt.book.pickSpecialist')} aria-label={t('appt.book.specialist')} />}</Field>
            <Field label={t('appt.book.date')}>{p => <Input {...p} type="date" value={date} onChange={e => { setDate(e.target.value); setStartMin(null); }} />}</Field>
            <Field label={t('appt.book.time')}>
              {p => <Select id={p.id} value={startMin === null ? '' : String(startMin)} onValueChange={v => setStartMin(Number(v))} options={starts.map(s => ({ value: String(s), label: fmtMin(s) }))} placeholder={col && !starts.length ? t('appt.book.noSlots') : t('appt.book.pickTime')} aria-label={t('appt.book.time')} />}
            </Field>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('appt.book.price')}>{p => <Input {...p} type="number" min={0} step="0.01" value={price} onChange={e => setPrice(e.target.value)} />}</Field>
            <Button size="sm" onClick={findFree} disabled={!productId || free.isPending}>{t('appt.book.findFree')}</Button>
          </div>
          <Field label={t('appt.book.comment')}>{p => <Textarea {...p} rows={2} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- карточка записи ---------------- */

export function ApptDialog({ appt, onClose, onMove }: { appt: Appt | null; onClose: () => void; onMove?: (a: Appt) => void }) {
  const t = useT();
  const act = useApptMutation<Appt>('POST');
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState('');
  React.useEffect(() => { setCancelling(false); setReason(''); }, [appt?.id]);
  if (!appt) return null;
  const run = (path: string, body?: unknown) => act.mutate({ path: `/${appt.id}/${path}`, body }, { onSuccess: () => { toast(t('appt.card.done')); onClose(); }, onError: e => toast.error(errorMessage(e)) });
  const open = appt.status === 'booked' || appt.status === 'confirmed';
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent title={appt.clientName} description={`${appt.date} · ${fmtMin(appt.startMin)}–${fmtMin(appt.endMin)}`}>
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={STATUS_TONE[appt.status]} dot>{t(`appt.status.${appt.status}`)}</Badge>
            <span>{appt.productName}</span>
            <span className="num muted">{fmtAmount(appt.price)}</span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {appt.specialistName}
            {appt.contactPhone ? ` · ${appt.contactPhone}` : ''}
          </p>
          {appt.comment && <p style={{ margin: 0, fontSize: 13 }}>{appt.comment}</p>}
          {appt.cancelReason && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('appt.card.reason')}: {appt.cancelReason}</p>}
          {open && !cancelling && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {appt.status === 'booked' && <Button size="sm" onClick={() => run('confirm')} disabled={act.isPending}>{t('appt.card.confirm')}</Button>}
              <Button size="sm" variant="primary" onClick={() => run('came')} disabled={act.isPending}>{t('appt.card.came')}</Button>
              <Button size="sm" onClick={() => run('no-show')} disabled={act.isPending}>{t('appt.card.noShow')}</Button>
              {onMove && <Button size="sm" onClick={() => onMove(appt)}>{t('appt.card.move')}</Button>}
              <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>{t('appt.card.cancel')}</Button>
            </div>
          )}
          {open && cancelling && (
            <div className="stack" style={{ gap: 8 }}>
              <Field label={t('appt.card.reason')}>{p => <Textarea {...p} rows={2} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />}</Field>
              <div className="row" style={{ gap: 8 }}>
                <Button size="sm" variant="primary" disabled={!reason.trim() || act.isPending} onClick={() => run('cancel', { reason })}>{t('appt.card.cancelSubmit')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setCancelling(false)}>{t('common.back')}</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

