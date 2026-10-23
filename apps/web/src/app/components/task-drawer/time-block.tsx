/* Блок «Time» карточки задачи и подзадачи: план (правка на месте), факт, остаток, полоса прогресса,
   журнал записей и диалог «Log time». Новая функциональность — оригинала для сравнения нет. */
import * as React from 'react';
import { Calendar as CalendarIcon, Clock, Pencil, Plus, Trash2, User } from 'lucide-react';
import { Button, Dialog, DialogClose, DialogContent, Field, IconButton, Input, Progress, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { newId, useWorkspace } from '../../data/store';
import { fmtHours, logsOf, member, parseHours, planOfSub, planOfTask, subTime, taskTime } from '../../data/selectors';
import { findSub, flattenSubs } from '../../data/subtasks';
import { fmtDate, iso, relDate, today } from '../../lib/dates';
import { MOD } from '../../lib/platform';
import type { Subtask, Task, TimeLog } from '../../data/types';
import { MemberAvatar } from '../workspace';
import { DatePopover, ListPopover } from './pickers';

const QUICK = [0.5, 1, 2, 4, 8];

/** Значение плана, которое правится щелчком: число → поле ввода, Enter / потеря фокуса — сохранить, Esc — отмена */
function PlanCell({ value, derived, onSave, tt }: { value: number | null; derived: number; onSave: (v: number | null) => void; tt: ReturnType<typeof useT> }) {
  const [edit, setEdit] = React.useState(false);
  const [v, setV] = React.useState('');
  const done = React.useRef(false);
  const begin = () => {
    done.current = false;
    setV(value != null ? String(value) : '');
    setEdit(true);
  };
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEdit(false);
    if (!save) return;
    if (!v.trim()) return onSave(null);
    const h = parseHours(v);
    if (h == null || h > 9999) return toast.error(tt('views.time.dialog.enterHoursError'));
    onSave(Math.round(h * 100) / 100);
  };
  if (edit)
    return (
      <div className="tm-cell editing">
        <span className="k">{tt('views.time.planField')}</span>
        <input
          autoFocus
          className="tm-in"
          inputMode="decimal"
          aria-label={tt('views.time.planAria')}
          placeholder={derived > 0 ? `${+derived.toFixed(2)} (${tt('views.time.planFromSubtasks', { n: '' }).trim()})` : tt('views.time.planPlaceholder')}
          value={v}
          onFocus={e => e.currentTarget.select()}
          onChange={e => setV(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={e => {
            if (e.key === 'Enter') finish(true);
            if (e.key === 'Escape') {
              e.stopPropagation();
              finish(false);
            }
          }}
        />
      </div>
    );
  const plan = value ?? derived;
  return (
    <button type="button" className="tm-cell pl" aria-label={tt('views.time.planEditLabel')} title={tt('views.time.planEditTitle')} onClick={begin}>
      <span className="k">
        {tt('views.time.planField')}
        <Pencil size={11} />
      </span>
      <span className={cn('v num', !plan && 'faint')}>{plan ? fmtHours(plan) : tt('views.time.setPlan')}</span>
    </button>
  );
}

/** Диалог добавления и правки записи времени */
function LogTimeDialog({ task: t, sub, log, onClose, tt }: { task: Task; sub?: Subtask; log?: TimeLog; onClose: () => void; tt: ReturnType<typeof useT> }) {
  const { data, dispatch } = useWorkspace();
  const [hours, setHours] = React.useState(log ? String(log.hours) : '');
  const [date, setDate] = React.useState(log?.date ?? iso(today()));
  const [by, setBy] = React.useState(log?.by ?? data.me);
  const [subId, setSubId] = React.useState(log ? (log.sub ?? '') : (sub?.id ?? ''));
  const [note, setNote] = React.useState(log?.note ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const subs = flattenSubs(t.subtasks);
  const target = findSub(t.subtasks, subId);
  const who = member(data, by);

  const submit = () => {
    const h = Math.round(parseFloat(hours) * 100) / 100;
    if (!(h > 0) || h > 24) {
      setError(tt('views.time.dialog.hoursError'));
      return;
    }
    const rec = { by, hours: h, date, note: note.trim() };
    if (log) {
      dispatch({ type: 'timelog/update', id: log.id, patch: { ...rec, sub: subId || undefined } });
      toast(tt('views.time.timeUpdated'));
    } else {
      const id = newId('l');
      dispatch({ type: 'timelog/add', log: { id, task: t.id, ...(subId ? { sub: subId } : null), ...rec } });
      toast(tt('views.time.timeLogged', { hours: fmtHours(h), key: t.key }), { action: { label: tt('common.undo'), onClick: () => dispatch({ type: 'timelog/delete', id }) } });
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="sm"
        title={log ? tt('views.time.dialog.editTitle') : tt('views.time.dialog.newTitle')}
        description={tt('views.time.dialog.desc', { key: t.key, title: t.title })}
        className="[&>.modal-b]:!gap-3"
        onKeyDown={e => {
          // Tab не должен уходить в ловушку фокуса карточки, из дерева которой React видит этот диалог
          if (e.key === 'Tab') e.stopPropagation();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        footer={
          <>
            <span className="faint hide-m" style={{ fontSize: 11.5 }}>
              <kbd>{MOD}</kbd> <kbd>↵</kbd>
            </span>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{tt('views.time.dialog.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" onClick={submit} id="tm-submit">
              {log ? tt('views.time.dialog.save') : tt('views.time.dialog.submit')}
            </Button>
          </>
        }
      >
        <Field label={tt('views.time.dialog.hours')} error={error}>
          {ids => (
            <>
              <Input
                {...ids}
                type="number"
                step={0.25}
                min={0.25}
                max={24}
                inputMode="decimal"
                placeholder={tt('views.time.dialog.hoursPlaceholder')}
                value={hours}
                onChange={e => {
                  setHours(e.target.value);
                  if (error) setError(null);
                }}
              />
              <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                {QUICK.map(q => (
                  <button key={q} type="button" className="pillbtn num" style={{ fontSize: 12, border: '1px solid var(--border)' }} onClick={() => { setHours(String(q)); setError(null); }}>
                    {fmtHours(q)}
                  </button>
                ))}
              </div>
            </>
          )}
        </Field>
        <dl className="kv" style={{ margin: 0 }}>
          <dt>
            <CalendarIcon size={14} />
            {tt('views.time.dialog.date')}
          </dt>
          <dd>
            <DatePopover
              value={date}
              onChange={v => v && setDate(v)}
              trigger={
                <button type="button" className="pillbtn" aria-label={tt('views.time.dialog.date')}>
                  <CalendarIcon size={13} />
                  <span className="num">{relDate(date)}</span>
                </button>
              }
            />
          </dd>
          <dt>
            <User size={14} />
            {tt('views.time.dialog.who')}
          </dt>
          <dd>
            <ListPopover
              search={tt('views.time.dialog.loggedBy')}
              items={data.members
                .filter(m => m.status === 'active' || m.id === by)
                .map(m => ({ id: m.id, name: m.name + (m.id === data.me ? tt('views.time.dialog.whoSuffix') : ''), icon: <MemberAvatar id={m.id} size="sm" tooltip={false} />, on: by === m.id }))}
              onPick={setBy}
              trigger={
                <button type="button" className="pillbtn" aria-label={tt('views.time.dialog.loggedBy')}>
                  <MemberAvatar id={by} size="sm" tooltip={false} />
                  <span>{who ? who.name + (who.id === data.me ? tt('views.time.dialog.whoSuffix') : '') : 'Someone'}</span>
                </button>
              }
            />
          </dd>
          {subs.length > 0 && (
            <>
              <dt>
                <Clock size={14} />
                {tt('views.time.dialog.appliesTo')}
              </dt>
              <dd>
                <ListPopover
                  search={tt('views.time.dialog.findSubtask')}
                  width={300}
                  items={[{ id: '', name: tt('views.time.dialog.wholeTask'), on: !subId }, ...subs.map(({ sub: s, depth }) => ({ id: s.id, name: `${'– '.repeat(depth)}${s.title}`, on: subId === s.id }))]}
                  onPick={setSubId}
                  trigger={
                    <button type="button" className="pillbtn" aria-label={tt('views.time.dialog.appliesTo')}>
                      <span className="trunc" style={{ maxWidth: 260 }}>
                        {target ? target.title : tt('views.time.dialog.wholeTask')}
                      </span>
                    </button>
                  }
                />
              </dd>
            </>
          )}
        </dl>
        <Field label={tt('views.time.dialog.note')}>
          {ids => <Input {...ids} placeholder={tt('views.time.dialog.notePlaceholder')} value={note} onChange={e => setNote(e.target.value)} />}
        </Field>
      </DialogContent>
    </Dialog>
  );
}

/** sub — блок для подзадачи (её план, факт по поддереву); без него — для всей задачи */
export function TimeBlock({ task: t, sub }: { task: Task; sub?: Subtask }) {
  const tt = useT();
  const { data, dispatch } = useWorkspace();
  const [dlg, setDlg] = React.useState<{ log?: TimeLog } | null>(null);
  const [all, setAll] = React.useState(false);
  const x = sub ? subTime(data.timeLogs, t.id, sub) : taskTime(data.timeLogs, t);
  const logs = logsOf(data.timeLogs, t.id, sub);
  const shown = all ? logs : logs.slice(0, 4);
  const own = sub ? sub.planHours : t.planHours;
  const kidsPlan = (sub ? sub.subtasks : t.subtasks).reduce((a, s) => a + planOfSub(s), 0);
  const derived = sub ? planOfSub({ ...sub, planHours: null }) : planOfTask({ ...t, planHours: null });

  const setPlan = (planHours: number | null) => (sub ? dispatch({ type: 'subtask/update', id: t.id, sub: sub.id, patch: { planHours } }) : dispatch({ type: 'task/update', id: t.id, patch: { planHours } }));
  const remove = (l: TimeLog) => {
    const snap = data;
    dispatch({ type: 'timelog/delete', id: l.id });
    toast(tt('views.time.timeDeleted', { hours: fmtHours(l.hours) }), { action: { label: tt('common.undo'), onClick: () => dispatch({ type: 'data/restore', data: snap }) } });
  };

  return (
    <div className="dsec tm">
      <div className="dsec-h">
        <h3>{tt('views.time.section')}</h3>
        {logs.length > 0 && <span className="cnt num">{logs.length}</span>}
        <div className="acts">
          <Button size="sm" variant="ghost" onClick={() => setDlg({})}>
            <Plus size={13} />
            {tt('views.time.logTime')}
          </Button>
        </div>
      </div>
      <div className="tm-grid">
        <PlanCell value={own ?? null} derived={derived} onSave={setPlan} tt={tt} />
        <div className="tm-cell">
          <span className="k">{tt('views.time.actual')}</span>
          <span className={cn('v num', x.over && 'bad')}>{fmtHours(x.actual)}</span>
        </div>
        <div className="tm-cell">
          <span className="k">{x.over ? tt('views.time.overBy') : tt('views.time.remaining')}</span>
          <span className={cn('v num', x.over ? 'bad' : !x.plan && 'faint')}>{x.over ? `+${fmtHours(x.actual - x.plan)}` : x.plan ? fmtHours(x.remaining) : '—'}</span>
        </div>
      </div>
      {x.plan > 0 && (
        <div className="tm-bar">
          <Progress value={Math.min(x.pct ?? 0, 100)} tone={x.over ? 'red' : undefined} aria-label={tt('views.time.progressAria')} />
          <span className={cn('num', x.over && 'bad')}>{x.pct}%</span>
        </div>
      )}
      {own == null && derived > 0 ? (
        <div className="tm-note">{tt('views.time.planNoteDerived')}</div>
      ) : own != null && kidsPlan > 0 && Math.abs(kidsPlan - own) > 0.001 ? (
        <div className={cn('tm-note', kidsPlan > own && 'warn')}>
          {kidsPlan > own ? tt('views.time.planNoteMismatch', { sub: fmtHours(kidsPlan), over: fmtHours(kidsPlan - own) }) : tt('views.time.planNoteUnder', { sub: fmtHours(kidsPlan) })}
        </div>
      ) : null}
      {shown.map(l => {
        const s = findSub(t.subtasks, l.sub);
        const m = member(data, l.by);
        return (
          <div key={l.id} className="tm-log">
            <MemberAvatar id={l.by} size="sm" />
            <span className="h num">{fmtHours(l.hours)}</span>
            <span className="d num">{l.date === iso(today()) ? tt('views.field.today') : fmtDate(l.date)}</span>
            <span className="n trunc" title={l.note || undefined}>
              {l.note || <span className="faint">{m ? m.name.split(' ')[0] : 'Someone'}</span>}
              {s && (!sub || s.id !== sub.id) && <span className="faint"> · {s.title}</span>}
            </span>
            <IconButton size="xs" className="x" label={tt('views.time.editEntry')} tooltip={false} onClick={() => setDlg({ log: l })}>
              <Pencil size={12} />
            </IconButton>
            <IconButton size="xs" className="x" label={tt('views.time.deleteEntry')} tooltip={false} onClick={() => remove(l)}>
              <Trash2 size={12} />
            </IconButton>
          </div>
        );
      })}
      {logs.length > 4 && (
        <button type="button" className="link" style={{ fontSize: 12.5, marginTop: 4 }} onClick={() => setAll(a => !a)}>
          {all ? tt('views.time.showFewer') : tt('views.time.showAll', { n: logs.length })}
        </button>
      )}
      {!logs.length && <div className="tm-note">{tt('views.time.noLogs')}</div>}
      {dlg && <LogTimeDialog task={t} sub={sub} log={dlg.log} onClose={() => setDlg(null)} tt={tt} />}
    </div>
  );
}
