/* Планирование: справочник ключевых ресурсов (оборудование), сменные рабочие графики, праздники воркспейса
   и исключения из графика (отпуск, больничный, ремонт). Меняет admin и выше. */
import * as React from 'react';
import { CalendarDays, CircleAlert, Hammer, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Segmented, Skeleton, toast } from '@/components/ui';
import { useIsAdmin } from '../catalog/data';
import { usePlanningApi, useCalendarExceptions, useCalendars, useHolidays, useResources, type WorkCalendar } from './planning-data';
import { useT } from '@/i18n';

type Tab = 'resources' | 'calendars' | 'holidays' | 'exceptions';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function ResourcesPage() {
  const isAdmin = useIsAdmin();
  const tt = useT();
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
          <h1>{tt('production.resources.title')}</h1>
          <p>{tt('production.resources.subtitle')}</p>
        </div>
        <div className="acts">
          <Segmented
            aria-label={tt('production.resources.section')}
            value={tab}
            onValueChange={v => setTab(v as Tab)}
            items={[
              { value: 'resources', label: tt('production.resources.tab.resources') },
              { value: 'calendars', label: tt('production.resources.tab.calendars') },
              { value: 'holidays', label: tt('production.resources.tab.holidays') },
              { value: 'exceptions', label: tt('production.resources.tab.exceptions') },
            ]}
          />
          {isAdmin && (tab === 'resources' || tab === 'calendars') && (
            <Button variant="primary" onClick={() => setDialog({ kind: tab === 'resources' ? 'resource' : 'calendar' })}>
              <Plus size={14} />
              {tab === 'resources' ? tt('production.resources.newResource') : tt('production.resources.newCalendar')}
            </Button>
          )}
        </div>
      </div>

      {tab === 'resources' && (
        <div style={{ padding: '0 var(--gutter) 24px' }}>
          {resources.isError ? (
            <EmptyState icon={<CircleAlert size={20} />} error title={tt('production.resources.loadFailed')} action={<Button size="sm" onClick={() => resources.refetch()}>{tt('production.common.retry')}</Button>}>
              {(resources.error as Error).message}
            </EmptyState>
          ) : resources.isPending ? (
            <Skeleton w="100%" h={36} />
          ) : !resources.data?.items.length ? (
            <EmptyState icon={<Hammer size={20} />} title={tt('production.resources.emptyResources')}>
              {tt('production.resources.emptyResourcesHint')}
            </EmptyState>
          ) : (
            <div className="panel" style={{ padding: 14, display: 'grid', gap: 10 }}>
              {resources.data.items.map(r => (
                <div key={r.id} className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 550 }}>{r.name}</div>
                    <div className="faint" style={{ fontSize: 12.5 }}>
                      {r.kind === 'equipment' ? tt('production.resources.equipment') : tt('production.resources.otherResource')}
                      {r.capacityUnits > 1 ? ` · ${r.capacityUnits} ${tt('production.resources.units')}` : ''}
                      {r.code ? ` · ${r.code}` : ''}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="row" style={{ gap: 2 }}>
                      <button type="button" className="ibtn ibtn-xs" aria-label={tt('production.common.fill', { name: r.name })} onClick={() => setDialog({ kind: 'resource', id: r.id })}>
                        <Plus size={13} style={{ transform: 'rotate(45deg)' }} />
                      </button>
                      <button type="button" className="ibtn ibtn-xs" aria-label={tt('production.resources.deleteResource', { name: r.name })} onClick={() => setRemoving({ kind: 'resource', id: r.id, name: r.name })}>
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
            <EmptyState icon={<CalendarDays size={20} />} title={tt('production.resources.emptyCalendars')}>
              {tt('production.resources.emptyCalendarsHint')}
            </EmptyState>
          ) : (
            calendars.data.items.map(c => (
              <div key={c.id} className="panel" style={{ padding: 14 }}>
                <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 550 }}>{c.name}</div>
                    <div className="faint" style={{ fontSize: 12.5 }}>
                      {c.kind === 'weekly' ? tt('production.resources.weekly') : tt('production.resources.cyclic')} · {c.hoursPerDay} {tt('production.resources.hoursPerDay')}
                      {c.kind === 'cycle' && c.cycleStart ? ` · ${tt('production.resources.cycleFrom')} ${c.cycleStart}` : ''}
                    </div>
                  </div>
                  {c.isDefault && <Badge tone="accent">{tt('production.resources.defaultBadge')}</Badge>}
                  {isAdmin && (
                    <div className="row" style={{ gap: 2 }}>
                      <button type="button" className="ibtn ibtn-xs" aria-label={tt('production.common.fill', { name: c.name })} onClick={() => setDialog({ kind: 'calendar', id: c.id })}>
                        <Plus size={13} style={{ transform: 'rotate(45deg)' }} />
                      </button>
                      <button type="button" className="ibtn ibtn-xs" aria-label={tt('production.resources.deleteCalendar', { name: c.name })} onClick={() => setRemoving({ kind: 'calendar', id: c.id, name: c.name })}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
                {c.kind === 'weekly' ? (
                  <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
                    {WEEKDAYS.filter((_, i) => (c.pattern.weekdays ?? [1, 2, 3, 4, 5]).includes(i + 1)).join(', ') || tt('production.resources.noWorkingDays')}
                  </div>
                ) : (
                  <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
                    {tt('production.resources.cycle')}: {(c.pattern.cycle ?? []).map(d => (d ? 'W' : '–')).join(' ')}
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
        title={removing?.kind === 'resource' ? tt('production.resources.confirmDeleteResource') : tt('production.resources.confirmDeleteCalendar')}
        description={removing ? <><b>{removing.name}</b> {tt('production.resources.willArchive')}</> : undefined}
        confirmLabel={tt('production.common.document') === tt('production.resources.deleteBtn') ? tt('production.resources.deleteBtn') : 'Delete'}
        cancelLabel={tt('production.common.cancel')}
        onConfirm={async () => {
          if (!removing) return;
          const path = removing.kind === 'resource' ? `/production/resources/${removing.id}` : `/production/calendars/${removing.id}`;
          if (await api('DELETE', path)) toast(tt('production.resources.deleted', { name: removing.name }));
          setRemoving(null);
        }}
      />
    </div>
  );
}

/** Праздники воркспейса: общий календарь нерабочих дней */
function HolidaysTab() {
  const isAdmin = useIsAdmin();
  const tt = useT();
  const holidays = useHolidays();
  const api = usePlanningApi();
  const [date, setDate] = React.useState('');
  const [name, setName] = React.useState('');

  const add = async () => {
    if (!date) return;
    if (await api('POST', '/production/holidays', { date, name })) {
      toast(tt('production.resources.holidayAdded'));
      setDate('');
      setName('');
    }
  };

  return (
    <div style={{ padding: '0 var(--gutter) 24px', display: 'grid', gap: 12 }}>
      {isAdmin && (
        <div className="row" style={{ gap: 8 }}>
          <Input aria-label={tt('production.resources.holidayDate')} type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 180 }} />
          <Input aria-label={tt('production.resources.holidayName')} placeholder={tt('production.resources.holidayPlaceholder')} value={name} onChange={e => setName(e.target.value)} style={{ width: 240 }} />
          <Button onClick={add} disabled={!date}>
            <Plus size={14} />
            {tt('production.resources.addHoliday')}
          </Button>
        </div>
      )}
      {!holidays.data?.items.length ? (
        <EmptyState icon={<CalendarDays size={20} />} title={tt('production.resources.emptyHolidays')}>
          {tt('production.resources.emptyHolidaysHint')}
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
                <button type="button" className="ibtn ibtn-xs" aria-label={tt('production.resources.deleteDate', { date: h.date })} onClick={() => api('DELETE', `/production/holidays/${h.date}`)}>
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
  const tt = useT();
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
      toast(tt('production.resources.exceptionAdded'));
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
            aria-label={tt('production.resources.scope')}
            value={scope}
            onValueChange={v => {
              setScope(v as typeof scope);
              setScopeId('');
            }}
            items={[
              { value: 'resource', label: tt('production.resources.scopeResource') },
              { value: 'work_center', label: tt('production.resources.scopeCenter') },
              { value: 'member', label: tt('production.resources.scopeMember') },
            ]}
          />
          <select className="select !h-[30px] !w-auto !text-xs" aria-label={tt('production.resources.object')} value={scopeId} onChange={e => setScopeId(e.target.value)}>
            <option value="">{tt('production.resources.choose')}</option>
            {scope === 'resource' &&
              (resources.data?.items ?? []).map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
          <Input aria-label={tt('production.resources.from')} type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 160 }} />
          <Input aria-label={tt('production.resources.to')} type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 160 }} />
          <Button onClick={add} disabled={!scopeId || !dateFrom}>
            <Plus size={14} />
            {tt('production.resources.addException')}
          </Button>
        </div>
      )}
      {!exceptions.data?.items.length ? (
        <EmptyState icon={<CalendarDays size={20} />} title={tt('production.resources.emptyExceptions')}>
          {tt('production.resources.emptyExceptionsHint')}
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
                <button type="button" className="ibtn ibtn-xs" aria-label={tt('production.resources.deleteException')} onClick={() => api('DELETE', `/production/calendar-exceptions/${e.id}`)}>
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
  const tt = useT();
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
      setErr({ name: tt('production.resources.errName') });
      return;
    }
    setBusy(true);
    const body = { name: name.trim(), code: code.trim(), kind, capacityUnits: Number(capacity) || 1, calendarId: calendarId || null };
    const r = current ? await api('PATCH', `/production/resources/${current.id}`, body) : await api('POST', '/production/resources', body);
    setBusy(false);
    if (!r) return;
    toast(current ? tt('production.resources.saved') : tt('production.resources.resourceAdded'));
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={current ? tt('production.resources.editResource') : tt('production.resources.newResource')}
        description={tt('production.resources.resourceDialogDesc')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{tt('production.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {current ? tt('production.resources.save') : tt('production.resources.create')}
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
          <Field label={tt('production.resources.name')} error={err.name}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <Field label={tt('production.resources.code')}>{p => <Input {...p} value={code} onChange={e => setCode(e.target.value)} />}</Field>
          <Field label={tt('production.resources.kind')}>
            {() => (
              <Segmented
                aria-label={tt('production.resources.kind')}
                value={kind}
                onValueChange={v => setKind(v as 'equipment' | 'other')}
                items={[
                  { value: 'equipment', label: tt('production.resources.equipment') },
                  { value: 'other', label: tt('production.resources.otherKind') },
                ]}
              />
            )}
          </Field>
          <Field label={tt('production.resources.unitsAvailable')}>
            {p => <Input {...p} type="number" min={1} value={capacity} onChange={e => setCapacity(e.target.value)} />}
          </Field>
          <Field label={tt('production.resources.calendar')} hint={tt('production.resources.calendarHint')}>
            {() => (
              <select className="select" aria-label={tt('production.resources.calendar')} value={calendarId} onChange={e => setCalendarId(e.target.value)}>
                <option value="">{tt('production.resources.defaultOption')}</option>
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
  const tt = useT();
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
    if (!name.trim()) errs.name = tt('production.resources.errName');
    if (kind === 'cycle' && !cycleStart) errs.cycleStart = tt('production.resources.errCycleStart');
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
    toast(current ? tt('production.resources.saved') : tt('production.resources.calendarAdded'));
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={current ? tt('production.resources.editCalendar') : tt('production.resources.newCalendar')}
        description={tt('production.resources.calendarDialogDesc')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{tt('production.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {current ? tt('production.resources.save') : tt('production.resources.create')}
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
          <Field label={tt('production.resources.name')} error={err.name}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <Field label={tt('production.resources.kind')}>
            {() => (
              <Segmented
                aria-label={tt('production.resources.kind')}
                value={kind}
                onValueChange={v => setKind(v as 'weekly' | 'cycle')}
                items={[
                  { value: 'weekly', label: tt('production.resources.weekly') },
                  { value: 'cycle', label: tt('production.resources.cyclic') },
                ]}
              />
            )}
          </Field>
          {kind === 'weekly' ? (
            <Field label={tt('production.resources.workingDays')}>
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
              <Field label={tt('production.resources.pattern')} hint={tt('production.resources.patternHint')}>
                {p => <Input {...p} value={cycle} onChange={e => setCycle(e.target.value.replace(/[^01]/g, ''))} />}
              </Field>
              <Field label={tt('production.resources.cycleStarts')} error={err.cycleStart}>
                {p => <Input {...p} type="date" value={cycleStart} onChange={e => (setCycleStart(e.target.value), setErr({}))} />}
              </Field>
            </>
          )}
          <Field label={tt('production.resources.hoursPerDayField')}>
            {p => <Input {...p} value={hoursPerDay} onChange={e => setHoursPerDay(e.target.value)} />}
          </Field>
          <Field label={tt('production.resources.defaultCalendar')}>
            {() => (
              <label className="row" style={{ gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
                {tt('production.resources.defaultHint')}
              </label>
            )}
          </Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
