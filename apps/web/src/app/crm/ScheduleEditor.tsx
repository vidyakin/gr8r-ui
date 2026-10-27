/* Редактор графика приёма специалиста (задача 1171): длительность слота, диапазон сетки, недельная сетка «день × слот» (клик — рабочий слот)
   и исключения на даты (выходной или свой набор слотов). Правят admin/owner и сам специалист. */
import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { gridStarts, SLOT_MINUTES, weekdayOf } from '@gr8r/shared';
import { Button, Field, IconButton, Input, Select, toast } from '@/components/ui';
import { fmtDateTimeIntl, useT, weekdayShort } from '@/i18n';
import { errorMessage } from '../data/api';
import { fmtDate, parse } from '../lib/dates';
import { useApptMutation, useSchedule, type ScheduleView } from './appointments-data';
import { fmtMin } from './appointments-ui';

const DAYS = [1, 2, 3, 4, 5, 6, 7];
const halfHours = (from: number, to: number) => Array.from({ length: (to - from) / 30 + 1 }, (_, i) => from + i * 30);

function SlotGrid({ starts, value, onChange, disabled, label }: { starts: number[]; value: number[]; onChange: (v: number[]) => void; disabled: boolean; label: string }) {
  const set = new Set(value);
  const toggle = (s: number) => onChange(set.has(s) ? value.filter(x => x !== s) : [...value, s]);
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="sched-grid" role="group" aria-label={label} style={{ gridTemplateColumns: `52px repeat(${1}, 1fr)` }}>
        {starts.map(s => (
          <React.Fragment key={s}>
            <div className="sched-h">{fmtMin(s)}</div>
            <button type="button" className={`sched-cell${set.has(s) ? ' on' : ''}`} disabled={disabled} aria-pressed={set.has(s)} aria-label={fmtMin(s)} onClick={() => toggle(s)} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function ScheduleEditor({ memberId, canEdit }: { memberId: string; canEdit: boolean }) {
  const q = useSchedule(memberId);
  if (q.isPending) return null;
  if (!q.data) return null;
  return <Editor key={`${memberId}${q.dataUpdatedAt}`} view={q.data} canEdit={canEdit} />;
}

function Editor({ view, canEdit }: { view: ScheduleView; canEdit: boolean }) {
  const t = useT();
  const save = useApptMutation<ScheduleView>('PUT');
  const del = useApptMutation<ScheduleView>('DELETE');
  const init = view.schedule ?? { slotMinutes: 30, dayStartMin: 540, dayEndMin: 1080, week: {} };
  const [slotMinutes, setSlotMinutes] = React.useState(init.slotMinutes);
  const [dayStartMin, setStart] = React.useState(init.dayStartMin);
  const [dayEndMin, setEnd] = React.useState(init.dayEndMin);
  const [week, setWeek] = React.useState<Record<string, number[]>>(init.week);
  const starts = React.useMemo(() => gridStarts({ slotMinutes, dayStartMin, dayEndMin }), [slotMinutes, dayStartMin, dayEndMin]);
  const grid = new Set(starts);
  const dayOf = (d: number) => (week[String(d)] ?? []).filter(s => grid.has(s));
  const setDay = (d: number, v: number[]) => setWeek(w => ({ ...w, [String(d)]: v }));
  const toggle = (d: number, s: number) => setDay(d, dayOf(d).includes(s) ? dayOf(d).filter(x => x !== s) : [...dayOf(d), s]);
  const toggleDay = (d: number) => setDay(d, dayOf(d).length === starts.length ? [] : starts);
  const toggleRow = (s: number) => {
    const all = DAYS.every(d => dayOf(d).includes(s));
    setWeek(() => Object.fromEntries(DAYS.map(d => [String(d), all ? dayOf(d).filter(x => x !== s) : [...new Set([...dayOf(d), s])]])) as Record<string, number[]>);
  };
  const body = () => ({ slotMinutes, dayStartMin, dayEndMin, week: Object.fromEntries(DAYS.map(d => [String(d), dayOf(d)])) });
  const onSave = () => save.mutate({ path: `/schedules/${view.memberId}`, body: body() }, { onSuccess: () => toast(t('appt.sched.saved')), onError: e => toast.error(errorMessage(e)) });

  const [exDate, setExDate] = React.useState('');
  const [exMode, setExMode] = React.useState<'off' | 'own'>('off');
  const [exSlots, setExSlots] = React.useState<number[]>([]);
  const addEx = () =>
    save.mutate({ path: `/schedules/${view.memberId}/exceptions/${exDate}`, body: { slots: exMode === 'off' ? null : exSlots } }, { onSuccess: () => { toast(t('appt.sched.saved')); setExDate(''); setExSlots([]); }, onError: e => toast.error(errorMessage(e)) });
  const editEx = (date: string, slots: number[] | null) => { setExDate(date); setExMode(slots ? 'own' : 'off'); setExSlots(slots ?? dayOf(weekdayOf(date))); };

  return (
    <div className="stack" style={{ gap: 16, padding: '0 var(--gutter) 24px' }}>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={t('appt.sched.slot')}>{p => <Select id={p.id} value={String(slotMinutes)} disabled={!canEdit} onValueChange={v => setSlotMinutes(Number(v))} options={SLOT_MINUTES.map(m => ({ value: String(m), label: t('appt.minutes', { n: m }) }))} aria-label={t('appt.sched.slot')} />}</Field>
        <Field label={t('appt.sched.from')}>{p => <Select id={p.id} value={String(dayStartMin)} disabled={!canEdit} onValueChange={v => setStart(Number(v))} options={halfHours(0, 1410).map(m => ({ value: String(m), label: fmtMin(m) }))} aria-label={t('appt.sched.from')} />}</Field>
        <Field label={t('appt.sched.to')}>{p => <Select id={p.id} value={String(dayEndMin)} disabled={!canEdit} onValueChange={v => setEnd(Number(v))} options={halfHours(30, 1440).map(m => ({ value: String(m), label: m === 1440 ? fmtDateTimeIntl(new Date(2000, 0, 1, 23, 59), { hour: '2-digit', minute: '2-digit' }) : fmtMin(m) }))} aria-label={t('appt.sched.to')} />}</Field>
        {canEdit && <Button variant="primary" size="sm" disabled={save.isPending || dayEndMin <= dayStartMin} onClick={onSave}>{t('common.save')}</Button>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{canEdit ? t('appt.sched.hint') : t('appt.sched.readOnly')}</p>
      <div style={{ overflowX: 'auto' }}>
        <div className="sched-grid" role="group" aria-label={t('appt.sched.weekGrid')} style={{ gridTemplateColumns: `52px repeat(7, minmax(44px, 1fr))` }}>
          <div />
          {DAYS.map(d => (
            <button key={d} type="button" className="sched-h" disabled={!canEdit} onClick={() => toggleDay(d)} style={{ background: 'none', border: 0, cursor: canEdit ? 'pointer' : 'default' }}>{weekdayShort(d)}</button>
          ))}
          {starts.map(s => (
            <React.Fragment key={s}>
              <button type="button" className="sched-h" disabled={!canEdit} onClick={() => toggleRow(s)} style={{ background: 'none', border: 0, cursor: canEdit ? 'pointer' : 'default' }}>{fmtMin(s)}</button>
              {DAYS.map(d => (
                <button key={d} type="button" className={`sched-cell${dayOf(d).includes(s) ? ' on' : ''}`} disabled={!canEdit} aria-pressed={dayOf(d).includes(s)} aria-label={`${weekdayShort(d)} ${fmtMin(s)}`} onClick={() => toggle(d, s)} />
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>

      <section>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>{t('appt.sched.exceptions')}</h3>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>{t('appt.sched.exceptionsHint', { n: view.holidays.length })}</p>
        {view.exceptions.length === 0 && <p className="faint" style={{ fontSize: 13 }}>{t('appt.sched.noExceptions')}</p>}
        {view.exceptions.map(e => (
          <div key={e.date} className="row" style={{ gap: 10, height: 34, fontSize: 13 }}>
            <button type="button" className="crm-link" onClick={() => canEdit && editEx(e.date, e.slots)}>{fmtDate(parse(e.date), true)}</button>
            <span className="muted">{e.slots ? t('appt.sched.ownSlots', { n: e.slots.length }) : t('appt.sched.dayOff')}</span>
            {canEdit && <IconButton label={t('common.delete')} onClick={() => del.mutate({ path: `/schedules/${view.memberId}/exceptions/${e.date}` }, { onError: er => toast.error(errorMessage(er)) })}><Trash2 size={14} /></IconButton>}
          </div>
        ))}
        {canEdit && (
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label={t('appt.sched.date')}>{p => <Input {...p} type="date" value={exDate} onChange={e => setExDate(e.target.value)} />}</Field>
              <Field label={t('appt.sched.kind')}>{p => <Select id={p.id} value={exMode} onValueChange={v => setExMode(v as 'off' | 'own')} options={[{ value: 'off', label: t('appt.sched.dayOff') }, { value: 'own', label: t('appt.sched.ownKind') }]} aria-label={t('appt.sched.kind')} />}</Field>
              <Button size="sm" disabled={!exDate || save.isPending} onClick={addEx}>{t('appt.sched.addException')}</Button>
            </div>
            {exMode === 'own' && exDate && <SlotGrid starts={starts} value={exSlots} onChange={setExSlots} disabled={false} label={t('appt.sched.ownKind')} />}
          </div>
        )}
      </section>
    </div>
  );
}
