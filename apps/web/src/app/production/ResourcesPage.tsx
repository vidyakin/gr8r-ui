/* Планирование: справочник ключевых ресурсов (оборудование), сменные рабочие графики, праздники воркспейса
   и исключения из графика (отпуск, больничный, ремонт). Меняет admin и выше. */
import * as React from 'react';
import { CalendarDays, CircleAlert, Hammer, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Segmented, Skeleton, toast } from '@/components/ui';
import { useIsAdmin } from '../catalog/data';
import { usePlanningApi, useCalendarExceptions, useCalendars, useHolidays, useResources, type WorkCalendar } from './planning-data';

type Tab = 'resources' | 'calendars' | 'holidays' | 'exceptions';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function ResourcesPage() {
  const isAdmin = useIsAdmin();
  const [tab, setTab] = React.useState<Tab>('resources');
  const api = usePlanningApi();
  const resources = useResources();
  const calendars = useCalendars();
  const [dialog, setDialog] = React.useState<{ kind: 'resource' | 'calendar'; id?: string } | null>(null);
  const [removing, setRemoving] = React.useState<{ kind: 'resource' | 'calendar'; id: string; name: string } | null>(null);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Resources and calendars</h1>
          <p>Equipment that work needs, shift calendars (weekly or cyclic like 2/2), holidays of the workspace and exceptions — vacation, sick leave, repair.</p>
        </div>
        <div className="acts">
          <Segmented
            aria-label="Section"
            value={tab}
            onValueChange={v => setTab(v as Tab)}
            items={[
              { value: 'resources', label: 'Resources' },
              { value: 'calendars', label: 'Work calendars' },
              { value: 'holidays', label: 'Holidays' },
              { value: 'exceptions', label: 'Exceptions' },
            ]}
          />
          {isAdmin && (tab === 'resources' || tab === 'calendars') && (
            <Button variant="primary" onClick={() => setDialog({ kind: tab === 'resources' ? 'resource' : 'calendar' })}>
              <Plus size={14} />
              {tab === 'resources' ? 'New resource' : 'New work calendar'}
            </Button>
          )}
        </div>
      </div>

      {tab === 'resources' && (
        <div style={{ padding: '0 var(--gutter) 24px' }}>
          {resources.isError ? (
            <EmptyState icon={<CircleAlert size={20} />} error title="Could not load the resources" action={<Button size="sm" onClick={() => resources.refetch()}>Retry</Button>}>
              {(resources.error as Error).message}
            </EmptyState>
          ) : resources.isPending ? (
            <Skeleton w="100%" h={36} />
          ) : !resources.data?.items.length ? (
            <EmptyState icon={<Hammer size={20} />} title="No resources yet">
              Add the equipment a work needs — a table saw, a press, a welding booth.
            </EmptyState>
          ) : (
            <div className="panel" style={{ padding: 14, display: 'grid', gap: 10 }}>
              {resources.data.items.map(r => (
                <div key={r.id} className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 550 }}>{r.name}</div>
                    <div className="faint" style={{ fontSize: 12.5 }}>
                      {r.kind === 'equipment' ? 'Equipment' : 'Other resource'}
                      {r.capacityUnits > 1 ? ` · ${r.capacityUnits} units` : ''}
                      {r.code ? ` · ${r.code}` : ''}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="row" style={{ gap: 2 }}>
                      <button type="button" className="ibtn ibtn-xs" aria-label={`Edit ${r.name}`} onClick={() => setDialog({ kind: 'resource', id: r.id })}>
                        <Plus size={13} style={{ transform: 'rotate(45deg)' }} />
                      </button>
                      <button type="button" className="ibtn ibtn-xs" aria-label={`Delete ${r.name}`} onClick={() => setRemoving({ kind: 'resource', id: r.id, name: r.name })}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'calendars' && (
        <div style={{ padding: '0 var(--gutter) 24px', display: 'grid', gap: 12 }}>
          {!calendars.data?.items.length ? (
            <EmptyState icon={<CalendarDays size={20} />} title="No work calendars yet">
              A calendar tells when a resource or an employee works: five days a week, or a cycle like 2/2.
            </EmptyState>
          ) : (
            calendars.data.items.map(c => (
              <div key={c.id} className="panel" style={{ padding: 14 }}>
                <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 550 }}>{c.name}</div>
                    <div className="faint" style={{ fontSize: 12.5 }}>
                      {c.kind === 'weekly' ? 'Weekly' : 'Cyclic'} · {c.hoursPerDay} h/day
                      {c.kind === 'cycle' && c.cycleStart ? ` · from ${c.cycleStart}` : ''}
                    </div>
                  </div>
                  {c.isDefault && <Badge tone="accent">Default</Badge>}
                  {isAdmin && (
                    <div className="row" style={{ gap: 2 }}>
                      <button type="button" className="ibtn ibtn-xs" aria-label={`Edit ${c.name}`} onClick={() => setDialog({ kind: 'calendar', id: c.id })}>
                        <Plus size={13} style={{ transform: 'rotate(45deg)' }} />
                      </button>
                      <button type="button" className="ibtn ibtn-xs" aria-label={`Delete ${c.name}`} onClick={() => setRemoving({ kind: 'calendar', id: c.id, name: c.name })}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
                {c.kind === 'weekly' ? (
                  <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
                    {WEEKDAYS.filter((_, i) => (c.pattern.weekdays ?? [1, 2, 3, 4, 5]).includes(i + 1)).join(', ') || 'No working days'}
                  </div>
                ) : (
                  <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
                    Cycle: {(c.pattern.cycle ?? []).map(d => (d ? 'W' : '–')).join(' ')}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'holidays' && <HolidaysTab />}

      {tab === 'exceptions' && <ExceptionsTab />}

      {dialog?.kind === 'resource' && <ResourceDialog id={dialog.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'calendar' && <CalendarDialog id={dialog.id} onClose={() => setDialog(null)} />}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={o => !o && setRemoving(null)}
        danger
        title={removing?.kind === 'resource' ? 'Delete resource?' : 'Delete work calendar?'}
        description={removing ? <><b>{removing.name}</b> will be archived.</> : undefined}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={async () => {
          if (!removing) return;
          const path = removing.kind === 'resource' ? `/production/resources/${removing.id}` : `/production/calendars/${removing.id}`;
          if (await api('DELETE', path)) toast(`Deleted “${removing.name}”`);
          setRemoving(null);
        }}
      />
    </div>
  );
}

/** Праздники воркспейса: общий календарь нерабочих дней */
function HolidaysTab() {
  const isAdmin = useIsAdmin();
  const holidays = useHolidays();
  const api = usePlanningApi();
  const [date, setDate] = React.useState('');
  const [name, setName] = React.useState('');

  const add = async () => {
    if (!date) return;
    if (await api('POST', '/production/holidays', { date, name })) {
      toast('Holiday added');
      setDate('');
      setName('');
    }
  };

  return (
    <div style={{ padding: '0 var(--gutter) 24px', display: 'grid', gap: 12 }}>
      {isAdmin && (
        <div className="row" style={{ gap: 8 }}>
          <Input aria-label="Holiday date" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 180 }} />
          <Input aria-label="Holiday name" placeholder="New Year" value={name} onChange={e => setName(e.target.value)} style={{ width: 240 }} />
          <Button onClick={add} disabled={!date}>
            <Plus size={14} />
            Add holiday
          </Button>
        </div>
      )}
      {!holidays.data?.items.length ? (
        <EmptyState icon={<CalendarDays size={20} />} title="No holidays yet">
          Holidays of the workspace are non-working days for everyone.
        </EmptyState>
      ) : (
        <div className="panel" style={{ padding: 14, display: 'grid', gap: 8 }}>
          {holidays.data.items.map(h => (
            <div key={h.date} className="row" style={{ gap: 10 }}>
              <span className="num" style={{ width: 110 }}>
                {h.date}
              </span>
              <span className="grow">{h.name}</span>
              {isAdmin && (
                <button type="button" className="ibtn ibtn-xs" aria-label={`Delete ${h.date}`} onClick={() => api('DELETE', `/production/holidays/${h.date}`)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Исключения из графика: отпуск, больничный, ремонт */
function ExceptionsTab() {
  const isAdmin = useIsAdmin();
  const exceptions = useCalendarExceptions();
  const resources = useResources();
  const api = usePlanningApi();
  const [scope, setScope] = React.useState<'member' | 'work_center' | 'resource'>('resource');
  const [scopeId, setScopeId] = React.useState('');
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');

  const add = async () => {
    if (!scopeId || !dateFrom) return;
    if (await api('POST', '/production/calendar-exceptions', { scope, scopeId, dateFrom, dateTo: dateTo || dateFrom })) {
      toast('Exception added');
      setScopeId('');
      setDateFrom('');
      setDateTo('');
    }
  };

  return (
    <div style={{ padding: '0 var(--gutter) 24px', display: 'grid', gap: 12 }}>
      {isAdmin && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Segmented
            aria-label="Scope"
            value={scope}
            onValueChange={v => {
              setScope(v as typeof scope);
              setScopeId('');
            }}
            items={[
              { value: 'resource', label: 'Resource' },
              { value: 'work_center', label: 'Work center' },
              { value: 'member', label: 'Employee' },
            ]}
          />
          <select className="select !h-[30px] !w-auto !text-xs" aria-label="Object" value={scopeId} onChange={e => setScopeId(e.target.value)}>
            <option value="">Choose…</option>
            {scope === 'resource' &&
              (resources.data?.items ?? []).map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
          <Input aria-label="From" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 160 }} />
          <Input aria-label="To" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 160 }} />
          <Button onClick={add} disabled={!scopeId || !dateFrom}>
            <Plus size={14} />
            Add exception
          </Button>
        </div>
      )}
      {!exceptions.data?.items.length ? (
        <EmptyState icon={<CalendarDays size={20} />} title="No exceptions yet">
          Vacation, sick leave or a repair — days when the resource does not work.
        </EmptyState>
      ) : (
        <div className="panel" style={{ padding: 14, display: 'grid', gap: 8 }}>
          {exceptions.data.items.map(e => (
            <div key={e.id} className="row" style={{ gap: 10 }}>
              <span className="num" style={{ width: 200 }}>
                {e.dateFrom} — {e.dateTo}
              </span>
              <span className="faint">{e.scope}</span>
              {isAdmin && (
                <button type="button" className="ibtn ibtn-xs" aria-label="Delete exception" onClick={() => api('DELETE', `/production/calendar-exceptions/${e.id}`)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Форма ресурса */
function ResourceDialog({ id, onClose }: { id?: string; onClose: () => void }) {
  const api = usePlanningApi();
  const resources = useResources();
  const calendars = useCalendars();
  const current = resources.data?.items.find(r => r.id === id);
  const [name, setName] = React.useState(current?.name ?? '');
  const [code, setCode] = React.useState(current?.code ?? '');
  const [kind, setKind] = React.useState<'equipment' | 'other'>(current?.kind ?? 'equipment');
  const [capacity, setCapacity] = React.useState(String(current?.capacityUnits ?? 1));
  const [calendarId, setCalendarId] = React.useState(current?.calendarId ?? '');
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (!name.trim()) {
      setErr({ name: 'Enter a name' });
      return;
    }
    setBusy(true);
    const body = { name: name.trim(), code: code.trim(), kind, capacityUnits: Number(capacity) || 1, calendarId: calendarId || null };
    const r = current ? await api('PATCH', `/production/resources/${current.id}`, body) : await api('POST', '/production/resources', body);
    setBusy(false);
    if (!r) return;
    toast(current ? 'Saved' : 'Resource added');
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={current ? 'Edit resource' : 'New resource'}
        description="Equipment or another resource that a work needs. Several resources may be needed for one work."
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {current ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <form
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Name" error={err.name}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <Field label="Code">{p => <Input {...p} value={code} onChange={e => setCode(e.target.value)} />}</Field>
          <Field label="Kind">
            {() => (
              <Segmented
                aria-label="Kind"
                value={kind}
                onValueChange={v => setKind(v as 'equipment' | 'other')}
                items={[
                  { value: 'equipment', label: 'Equipment' },
                  { value: 'other', label: 'Other' },
                ]}
              />
            )}
          </Field>
          <Field label="Units available at once">
            {p => <Input {...p} type="number" min={1} value={capacity} onChange={e => setCapacity(e.target.value)} />}
          </Field>
          <Field label="Work calendar" hint="Without a calendar the default calendar of the workspace is used.">
            {() => (
              <select className="select" aria-label="Work calendar" value={calendarId} onChange={e => setCalendarId(e.target.value)}>
                <option value="">Default</option>
                {(calendars.data?.items ?? []).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Форма сменного графика */
function CalendarDialog({ id, onClose }: { id?: string; onClose: () => void }) {
  const api = usePlanningApi();
  const calendars = useCalendars();
  const current: WorkCalendar | undefined = calendars.data?.items.find(c => c.id === id);
  const [name, setName] = React.useState(current?.name ?? '');
  const [kind, setKind] = React.useState<'weekly' | 'cycle'>(current?.kind ?? 'weekly');
  const [weekdays, setWeekdays] = React.useState<number[]>(current?.pattern.weekdays ?? [1, 2, 3, 4, 5]);
  const [cycle, setCycle] = React.useState<string>(current?.pattern.cycle?.map(d => (d ? '1' : '0')).join('') ?? '1100');
  const [cycleStart, setCycleStart] = React.useState(current?.cycleStart ?? '');
  const [hoursPerDay, setHoursPerDay] = React.useState(current?.hoursPerDay ?? '8');
  const [isDefault, setIsDefault] = React.useState(current?.isDefault ?? false);
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Enter a name';
    if (kind === 'cycle' && !cycleStart) errs.cycleStart = 'Set the date the cycle starts from';
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = {
      name: name.trim(),
      kind,
      hoursPerDay,
      isDefault,
      cycleStart: kind === 'cycle' ? cycleStart : null,
      pattern: kind === 'weekly' ? { weekdays } : { cycle: cycle.split('').map(c => (c === '1' ? 1 : 0)) },
    };
    const r = current ? await api('PATCH', `/production/calendars/${current.id}`, body) : await api('POST', '/production/calendars', body);
    setBusy(false);
    if (!r) return;
    toast(current ? 'Saved' : 'Calendar added');
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={current ? 'Edit work calendar' : 'New work calendar'}
        description="A weekly calendar lists the working days of the week; a cyclic one repeats a pattern of days from the start date (2/2, four days on, four days off)."
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {current ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <form
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Name" error={err.name}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <Field label="Kind">
            {() => (
              <Segmented
                aria-label="Kind"
                value={kind}
                onValueChange={v => setKind(v as 'weekly' | 'cycle')}
                items={[
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'cycle', label: 'Cyclic' },
                ]}
              />
            )}
          </Field>
          {kind === 'weekly' ? (
            <Field label="Working days">
              {() => (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {WEEKDAYS.map((d, i) => (
                    <label key={d} className="row" style={{ gap: 4, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={weekdays.includes(i + 1)}
                        onChange={e => setWeekdays(prev => (e.target.checked ? [...prev, i + 1].sort() : prev.filter(x => x !== i + 1)))}
                      />
                      {d}
                    </label>
                  ))}
                </div>
              )}
            </Field>
          ) : (
            <>
              <Field label="Pattern" hint="1 — working day, 0 — day off. For 2/2: 1100.">
                {p => <Input {...p} value={cycle} onChange={e => setCycle(e.target.value.replace(/[^01]/g, ''))} />}
              </Field>
              <Field label="Cycle starts from" error={err.cycleStart}>
                {p => <Input {...p} type="date" value={cycleStart} onChange={e => (setCycleStart(e.target.value), setErr({}))} />}
              </Field>
            </>
          )}
          <Field label="Hours per day">
            {p => <Input {...p} value={hoursPerDay} onChange={e => setHoursPerDay(e.target.value)} />}
          </Field>
          <Field label="Default calendar of the workspace">
            {() => (
              <label className="row" style={{ gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
                Use it when a calendar is not assigned
              </label>
            )}
          </Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
