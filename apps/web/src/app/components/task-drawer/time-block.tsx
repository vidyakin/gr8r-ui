/* Блок «Time» карточки задачи и подзадачи: план (правка на месте), факт, остаток, полоса прогресса,
   журнал записей и диалог «Log time». Новая функциональность — оригинала для сравнения нет. */
import * as React from 'react';
import { Calendar as CalendarIcon, Clock, Pencil, Plus, Trash2, User } from 'lucide-react';
import { Button, Dialog, DialogClose, DialogContent, Field, IconButton, Input, Progress, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
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
function PlanCell({ value, derived, onSave }: { value: number | null; derived: number; onSave: (v: number | null) => void }) {
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
    if (h == null || h > 9999) return toast.error('Enter hours, e.g. 4, 1.5 or 2d');
    onSave(Math.round(h * 100) / 100);
  };
  if (edit)
    return (
      <div className="tm-cell editing">
        <span className="k">Plan</span>
        <input
          autoFocus
          className="tm-in"
          inputMode="decimal"
          aria-label="Plan in hours"
          placeholder={derived > 0 ? `${+derived.toFixed(2)} (from subtasks)` : 'hours, e.g. 8'}
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
    <button type="button" className="tm-cell pl" aria-label="Edit plan" title="Click to edit the plan" onClick={begin}>
      <span className="k">
        Plan
        <Pencil size={11} />
      </span>
      <span className={cn('v num', !plan && 'faint')}>{plan ? fmtHours(plan) : 'Set plan'}</span>
    </button>
  );
}

/** Диалог добавления и правки записи времени */
function LogTimeDialog({ task: t, sub, log, onClose }: { task: Task; sub?: Subtask; log?: TimeLog; onClose: () => void }) {
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
      setError('Enter between 0.25 and 24 hours');
      return;
    }
    const rec = { by, hours: h, date, note: note.trim() };
    if (log) {
      dispatch({ type: 'timelog/update', id: log.id, patch: { ...rec, sub: subId || undefined } });
      toast('Time entry updated');
    } else {
      const id = newId('l');
      dispatch({ type: 'timelog/add', log: { id, task: t.id, ...(subId ? { sub: subId } : null), ...rec } });
      toast(`Logged ${fmtHours(h)} on ${t.key}`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'timelog/delete', id }) } });
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="sm"
        title={log ? 'Edit time entry' : 'Log time'}
        description={`${t.key} · ${t.title}`}
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
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" onClick={submit} id="tm-submit">
              {log ? 'Save' : 'Log time'}
            </Button>
          </>
        }
      >
        <Field label="Hours" error={error}>
          {ids => (
            <>
              <Input
                {...ids}
                type="number"
                step={0.25}
                min={0.25}
                max={24}
                inputMode="decimal"
                placeholder="e.g. 1.5"
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
            Date
          </dt>
          <dd>
            <DatePopover
              value={date}
              onChange={v => v && setDate(v)}
              trigger={
                <button type="button" className="pillbtn" aria-label="Date">
                  <CalendarIcon size={13} />
                  <span className="num">{relDate(date)}</span>
                </button>
              }
            />
          </dd>
          <dt>
            <User size={14} />
            Who
          </dt>
          <dd>
            <ListPopover
              search="Logged by…"
              items={data.members
                .filter(m => m.status === 'active' || m.id === by)
                .map(m => ({ id: m.id, name: m.name + (m.id === data.me ? ' (you)' : ''), icon: <MemberAvatar id={m.id} size="sm" tooltip={false} />, on: by === m.id }))}
              onPick={setBy}
              trigger={
                <button type="button" className="pillbtn" aria-label="Logged by">
                  <MemberAvatar id={by} size="sm" tooltip={false} />
                  <span>{who ? who.name + (who.id === data.me ? ' (you)' : '') : 'Someone'}</span>
                </button>
              }
            />
          </dd>
          {subs.length > 0 && (
            <>
              <dt>
                <Clock size={14} />
                Applies to
              </dt>
              <dd>
                <ListPopover
                  search="Find subtask…"
                  width={300}
                  items={[{ id: '', name: 'Whole task', on: !subId }, ...subs.map(({ sub: s, depth }) => ({ id: s.id, name: `${'– '.repeat(depth)}${s.title}`, on: subId === s.id }))]}
                  onPick={setSubId}
                  trigger={
                    <button type="button" className="pillbtn" aria-label="Applies to">
                      <span className="trunc" style={{ maxWidth: 260 }}>
                        {target ? target.title : 'Whole task'}
                      </span>
                    </button>
                  }
                />
              </dd>
            </>
          )}
        </dl>
        <Field label="Note">
          {ids => <Input {...ids} placeholder="What did you work on? (optional)" value={note} onChange={e => setNote(e.target.value)} />}
        </Field>
      </DialogContent>
    </Dialog>
  );
}

/** sub — блок для подзадачи (её план, факт по поддереву); без него — для всей задачи */
export function TimeBlock({ task: t, sub }: { task: Task; sub?: Subtask }) {
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
    toast(`Deleted ${fmtHours(l.hours)} entry`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'data/restore', data: snap }) } });
  };

  return (
    <div className="dsec tm">
      <div className="dsec-h">
        <h3>Time</h3>
        {logs.length > 0 && <span className="cnt num">{logs.length}</span>}
        <div className="acts">
          <Button size="sm" variant="ghost" onClick={() => setDlg({})}>
            <Plus size={13} />
            Log time
          </Button>
        </div>
      </div>
      <div className="tm-grid">
        <PlanCell value={own ?? null} derived={derived} onSave={setPlan} />
        <div className="tm-cell">
          <span className="k">Actual</span>
          <span className={cn('v num', x.over && 'bad')}>{fmtHours(x.actual)}</span>
        </div>
        <div className="tm-cell">
          <span className="k">{x.over ? 'Over by' : 'Remaining'}</span>
          <span className={cn('v num', x.over ? 'bad' : !x.plan && 'faint')}>{x.over ? `+${fmtHours(x.actual - x.plan)}` : x.plan ? fmtHours(x.remaining) : '—'}</span>
        </div>
      </div>
      {x.plan > 0 && (
        <div className="tm-bar">
          <Progress value={Math.min(x.pct ?? 0, 100)} tone={x.over ? 'red' : undefined} aria-label="Time spent against plan" />
          <span className={cn('num', x.over && 'bad')}>{x.pct}%</span>
        </div>
      )}
      {own == null && derived > 0 ? (
        <div className="tm-note">Plan is the sum of subtasks. Click it to set your own.</div>
      ) : own != null && kidsPlan > 0 && Math.abs(kidsPlan - own) > 0.001 ? (
        <div className={cn('tm-note', kidsPlan > own && 'warn')}>
          Subtasks are planned at {fmtHours(kidsPlan)}
          {kidsPlan > own ? `, ${fmtHours(kidsPlan - own)} over this plan` : ''}.
        </div>
      ) : null}
      {shown.map(l => {
        const s = findSub(t.subtasks, l.sub);
        const m = member(data, l.by);
        return (
          <div key={l.id} className="tm-log">
            <MemberAvatar id={l.by} size="sm" />
            <span className="h num">{fmtHours(l.hours)}</span>
            <span className="d num">{l.date === iso(today()) ? 'Today' : fmtDate(l.date)}</span>
            <span className="n trunc" title={l.note || undefined}>
              {l.note || <span className="faint">{m ? m.name.split(' ')[0] : 'Someone'}</span>}
              {s && (!sub || s.id !== sub.id) && <span className="faint"> · {s.title}</span>}
            </span>
            <IconButton size="xs" className="x" label="Edit entry" tooltip={false} onClick={() => setDlg({ log: l })}>
              <Pencil size={12} />
            </IconButton>
            <IconButton size="xs" className="x" label="Delete entry" tooltip={false} onClick={() => remove(l)}>
              <Trash2 size={12} />
            </IconButton>
          </div>
        );
      })}
      {logs.length > 4 && (
        <button type="button" className="link" style={{ fontSize: 12.5, marginTop: 4 }} onClick={() => setAll(a => !a)}>
          {all ? 'Show fewer' : `Show all ${logs.length} entries`}
        </button>
      )}
      {!logs.length && <div className="tm-note">No time logged yet.</div>}
      {dlg && <LogTimeDialog task={t} sub={sub} log={dlg.log} onClose={() => setDlg(null)} />}
    </div>
  );
}
