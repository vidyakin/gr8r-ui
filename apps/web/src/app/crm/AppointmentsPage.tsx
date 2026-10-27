/* Раздел CRM «Запись» (задача 1171): /crm/appointments. Вкладки: сетка дня всех специалистов, неделя специалиста,
   незакрытые дни, графики приёма. Перенос — выбором свободного слота (или перетаскиванием записи на слот). */
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CalendarCheck, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { addDaysIso, weekStartOf } from '@gr8r/shared';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtDateTimeIntl, useT, weekdayShort } from '@/i18n';
import { cn } from '@/lib/utils';
import { errorMessage } from '../data/api';
import { useWorkspace } from '../data/store';
import { useSession } from '../data/session';
import { useCanWrite } from '../meta/custom-fields';
import { fmtDate, parse } from '../lib/dates';
import { ScheduleEditor } from './ScheduleEditor';
import { ApptDialog, BookDialog, Board, isoToday, type BoardCol, type BookPreset } from './appointments-ui';
import { useApptMutation, useDayBoard, useSpecialists, useUnclosedDays, useWeekBoard, type Appt, type DayDoc } from './appointments-data';

const TABS = ['day', 'week', 'unclosed', 'schedules'] as const;
type Tab = (typeof TABS)[number];

export function AppointmentsPage() {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '') ? (sp.get('tab') as Tab) : 'day';
  const canWrite = useCanWrite();
  const unclosed = useUnclosedDays();
  const [book, setBook] = React.useState<BookPreset | null>(null);
  const [card, setCard] = React.useState<Appt | null>(null);
  const [moving, setMoving] = React.useState<Appt | null>(null);
  const move = useApptMutation<Appt>('POST');

  const doMove = (id: string, specialistId: string, date: string, startMin: number) =>
    move.mutate({ path: `/${id}/move`, body: { specialistId, date, startMin } }, { onSuccess: () => { toast(t('appt.board.moved')); setMoving(null); }, onError: e => toast.error(errorMessage(e)) });
  const onFree = (c: BoardCol, startMin: number) => (moving ? doMove(moving.id, c.specialistId, c.date, startMin) : canWrite && setBook({ specialistId: c.specialistId, date: c.date, startMin }));
  const common = { moving: !!moving, onFree, onAppt: setCard, onDropAppt: (id: string, c: BoardCol, startMin: number) => doMove(id, c.specialistId, c.date, startMin) };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('appt.page.title')}</h1>
          <p>{t('appt.page.lead')}</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button variant="primary" onClick={() => setBook({})}>
              <Plus size={14} />
              {t('appt.page.new')}
            </Button>
          )}
        </div>
      </div>
      <nav className="tabs doc-tabs" aria-label={t('appt.page.tabs')}>
        {TABS.map(k => (
          <button key={k} type="button" className={cn('tab', tab === k && 'on')} aria-current={tab === k ? 'page' : undefined} onClick={() => setSp({ tab: k }, { replace: true })}>
            {t(`appt.tabs.${k}`)}
            {k === 'unclosed' && !!unclosed.data?.length && <Badge tone="red" style={{ marginLeft: 6 }}>{unclosed.data.length}</Badge>}
          </button>
        ))}
      </nav>
      {moving && (
        <div className="appt-banner" role="status">
          <span>{t('appt.board.moving', { name: moving.clientName })}</span>
          <Button size="sm" onClick={() => setMoving(null)}>{t('common.cancel')}</Button>
        </div>
      )}
      {tab === 'day' && <DayTab {...common} />}
      {tab === 'week' && <WeekTab {...common} />}
      {tab === 'unclosed' && <UnclosedTab />}
      {tab === 'schedules' && <SchedulesTab />}
      {book && <BookDialog open onOpenChange={v => !v && setBook(null)} preset={book} />}
      <ApptDialog appt={card} onClose={() => setCard(null)} onMove={a => { setCard(null); setMoving(a); setSp({ tab: 'week' }, { replace: true }); }} />
    </div>
  );
}

type GridProps = { moving: boolean; onFree: (c: BoardCol, startMin: number) => void; onAppt: (a: Appt) => void; onDropAppt: (id: string, c: BoardCol, startMin: number) => void };

/** Панель над сеткой: отступ от вкладок сверху; слева — необязательные поля (специалист) */
function DateNav({ date, setDate, step, children }: { date: string; setDate: (d: string) => void; step: number; children?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="row" style={{ gap: 8, padding: '12px var(--gutter) 10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {children && <div style={{ marginRight: 8 }}>{children}</div>}
      <Button size="sm" variant="ghost" aria-label={t('appt.board.prev')} onClick={() => setDate(addDaysIso(date, -step))}><ChevronLeft size={14} /></Button>
      <Input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} aria-label={t('appt.book.date')} style={{ width: 160 }} />
      <Button size="sm" variant="ghost" aria-label={t('appt.board.next')} onClick={() => setDate(addDaysIso(date, step))}><ChevronRight size={14} /></Button>
      <Button size="sm" onClick={() => setDate(isoToday())}>{t('appt.board.today')}</Button>
    </div>
  );
}

function DayTab(p: GridProps) {
  const t = useT();
  const [date, setDate] = React.useState(isoToday());
  const q = useDayBoard(date);
  const cols: BoardCol[] = (q.data?.columns ?? []).map(c => ({ ...c, key: c.specialistId, warn: c.unclosed, holiday: c.holiday, header: <span title={c.unclosed ? t('appt.board.unclosed') : undefined}>{c.name}{c.unclosed ? ' !' : ''}</span> }));
  return (
    <>
      <DateNav date={date} setDate={setDate} step={1} />
      {q.isPending ? <div style={{ padding: 16 }}><Skeleton w="100%" h={200} /></div> : !cols.length ? <EmptyState icon={<CalendarCheck size={20} />} title={t('appt.board.noSpecialists')}>{t('appt.board.noSpecialistsHint')}</EmptyState> : <Board cols={cols} label={t('appt.tabs.day')} {...p} />}
    </>
  );
}

function WeekTab(p: GridProps) {
  const t = useT();
  const me = useWorkspace().data.me;
  const specs = useSpecialists();
  const [pick, setPick] = React.useState('');
  const [date, setDate] = React.useState(weekStartOf(isoToday()));
  const list = specs.data ?? [];
  const specialistId = pick || (list.find(s => s.memberId === me) ?? list[0])?.memberId;
  const q = useWeekBoard(specialistId, date);
  const cols: BoardCol[] = (q.data?.days ?? []).map(d => ({
    ...d,
    key: d.date,
    warn: d.unclosed,
    holiday: d.holiday,
    header: <span>{weekdayShort(new Date(`${d.date}T00:00:00`).getDay())} {fmtDate(parse(d.date))}{d.unclosed ? ' !' : ''}</span>,
  }));
  return (
    <>
      <DateNav date={date} setDate={d => setDate(weekStartOf(d))} step={7}>
        <Field label={t('appt.book.specialist')}>{f => <div style={{ width: 350, maxWidth: '100%' }}><Select className="w-full" id={f.id} value={specialistId ?? ''} onValueChange={setPick} options={list.map(s => ({ value: s.memberId, label: s.name }))} aria-label={t('appt.book.specialist')} /></div>}</Field>
      </DateNav>
      {!specialistId ? <EmptyState icon={<CalendarCheck size={20} />} title={t('appt.board.noSpecialists')}>{t('appt.board.noSpecialistsHint')}</EmptyState> : q.isPending ? <div style={{ padding: 16 }}><Skeleton w="100%" h={200} /></div> : <Board cols={cols} label={t('appt.tabs.week')} {...p} />}
    </>
  );
}

function UnclosedTab() {
  const t = useT();
  const navigate = useNavigate();
  const q = useUnclosedDays();
  const create = useApptMutation<DayDoc>('POST');
  const open = (u: { specialistId: string; date: string; documentId: string | null }) => {
    if (u.documentId) return navigate(`/crm/appointments/day/${u.documentId}`);
    create.mutate({ path: '/day-documents', body: { specialistId: u.specialistId, date: u.date } }, { onSuccess: d => navigate(`/crm/appointments/day/${d.id}`), onError: e => toast.error(errorMessage(e)) });
  };
  if (q.isPending) return <div style={{ padding: 16 }}><Skeleton w="100%" h={80} /></div>;
  if (!q.data?.length) return <EmptyState icon={<CalendarCheck size={20} />} title={t('appt.unclosed.empty')}>{t('appt.unclosed.emptyHint')}</EmptyState>;
  return (
    <div style={{ overflowX: 'auto', padding: '12px var(--gutter) 16px' }}>
      <table className="tbl" aria-label={t('appt.tabs.unclosed')}>
        <thead>
          <tr><th>{t('appt.book.date')}</th><th>{t('appt.book.specialist')}</th><th className="r">{t('appt.unclosed.count')}</th><th /></tr>
        </thead>
        <tbody>
          {q.data.map(u => (
            <tr key={`${u.specialistId}${u.date}`}>
              <td>{fmtDateTimeIntl(parse(u.date), { dateStyle: 'medium' })}</td>
              <td>{u.specialistName}</td>
              <td className="r num">{u.count}</td>
              <td className="r"><Button size="sm" variant="primary" onClick={() => open(u)} disabled={create.isPending}>{u.documentId ? t('appt.unclosed.open') : t('appt.unclosed.create')}</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SchedulesTab() {
  const t = useT();
  const { active } = useSession();
  const ws = useWorkspace().data;
  const isAdmin = active?.role === 'owner' || active?.role === 'admin';
  const people = ws.members.filter(m => m.status === 'active' && (isAdmin || m.id === ws.me));
  const [pick, setPick] = React.useState(ws.me);
  const memberId = people.some(m => m.id === pick) ? pick : people[0]?.id;
  if (!memberId) return <EmptyState icon={<CalendarCheck size={20} />} title={t('appt.board.noSpecialists')} />;
  return (
    <>
      <div className="row" style={{ gap: 12, padding: '12px var(--gutter) 12px' }}>
        <Field label={t('appt.book.specialist')}>{f => <div style={{ width: 350, maxWidth: '100%' }}><Select className="w-full" id={f.id} value={memberId} onValueChange={setPick} options={people.map(m => ({ value: m.id, label: m.name }))} aria-label={t('appt.book.specialist')} /></div>}</Field>
      </div>
      <ScheduleEditor memberId={memberId} canEdit={isAdmin || memberId === ws.me} />
    </>
  );
}
