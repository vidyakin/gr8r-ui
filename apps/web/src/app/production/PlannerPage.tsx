/* Планировщик загрузки: строки — сотрудники, участки или ресурсы, полосы — операции производства,
   назначения заказ-наряда и работы ресурсов. Перетаскивание полосы меняет даты (и при необходимости
   исполнителя), перегрузка подсвечивается — это предупреждение, план сохраняется в любом случае. */
import * as React from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, CircleAlert, Crosshair } from 'lucide-react';
import { Badge, Button, EmptyState, Segmented, Skeleton, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { TimeGrid } from '../components/time-grid';
import { usePlanningApi, useLoad, type LoadRowType, type PlannerEntry } from './planning-data';
import { useT } from '@/i18n';

const RH = 36;

/** Масштаб: день, неделя, месяц — производство планируется по дням */
type Scale = 'day' | 'week' | 'month';
const SCALE_DAYS: Record<Scale, number> = { day: 21, week: 28, month: 42 };
const SCALE_WIDTH: Record<Scale, number> = { day: 30, week: 16, month: 8 };

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + n);
  return dayKey(x);
};
const diffDays = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PlannerPage() {
  const api = usePlanningApi();
  const tt = useT();
  const [rowType, setRowType] = React.useState<LoadRowType>('member');
  const [scale, setScale] = React.useState<Scale>('day');
  const [from, setFrom] = React.useState(() => addDays(dayKey(new Date()), -7));
  const days = SCALE_DAYS[scale];
  const to = addDays(from, days - 1);
  const load = useLoad(from, to, rowType);
  const dayWidth = SCALE_WIDTH[scale];

  const rows = load.data?.rows ?? [];
  const entries = load.data?.entries ?? [];
  const dayList = React.useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from, days]);
  const today = dayKey(new Date());

  const headerCells = React.useMemo(
    () =>
      scale === 'day'
        ? dayList.map(d => ({ label: Number(d.slice(8)), span: 1, className: d === today ? 'today' : undefined }))
        : scale === 'week'
          ? dayList.map(d => ({ label: Number(d.slice(8)), span: 1, className: d === today ? 'today' : undefined }))
          : dayList.map((d, i) => ({ label: i % 7 === 0 ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}` : '', span: 1 })),
    [dayList, scale, today],
  );

  // полосы по строкам
  const byRow = React.useMemo(() => {
    const map = new Map<string, PlannerEntry[]>();
    for (const e of entries) {
      const list = map.get(e.rowId) ?? [];
      list.push(e);
      map.set(e.rowId, list);
    }
    return map;
  }, [entries]);

  /** Перетаскивание полосы: сдвиг по дням меняет даты */
  const [drag, setDrag] = React.useState<{ id: string; days: number } | null>(null);
  const startDrag = (e: React.PointerEvent, entry: PlannerEntry) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    let moved = false;
    let days = 0;
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 4) moved = true;
      if (moved) {
        days = Math.round(dx / dayWidth);
        setDrag({ id: entry.id, days });
      }
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      setDrag(null);
      if (!moved || !days) return;
      const start = addDays(entry.start, days);
      const end = addDays(entry.end, days);
      void save(entry, { start, end });
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  };

  const save = async (entry: PlannerEntry, patch: { start: string; end: string }) => {
    if (entry.kind === 'operation' && entry.assignmentId) {
      const r = await api('PATCH', `/production/operations/${entry.assignmentId}/move`, { start: patch.start, end: patch.end });
      if (r) toast(tt('production.planner.movedTo', { date: patch.start }), { duration: 2000 });
      return;
    }
    if (entry.kind === 'assignment' && entry.taskId) {
      const r = await api('PATCH', `/work-order-assignments/${entry.taskId}`, { startDate: patch.start, dueDate: patch.end });
      if (r) toast(tt('production.planner.movedTo', { date: patch.start }), { duration: 2000 });
    }
  };

  const bars = rows.map((row, i) => {
    const y = i * RH;
    const list = byRow.get(row.rowId) ?? [];
    return (
      <React.Fragment key={row.rowId}>
        <div className="tl-rowbg" style={{ top: y }} />
        {list.map(e => {
          const shift = drag?.id === e.id ? drag.days * dayWidth : 0;
          const x = diffDays(from, e.start) * dayWidth + shift;
          const w = Math.max(dayWidth, (diffDays(e.start, e.end) + 1) * dayWidth);
          const over = e.kind === 'resource' ? false : row.overloaded;
          return (
            <div
              key={e.id}
              className={cn('bar', drag?.id === e.id && 'dragging')}
              style={{ '--c': over ? 'var(--red)' : 'var(--accent)', left: x, top: y + 7, width: w } as React.CSSProperties}
              title={`${e.title} · ${e.start} → ${e.end} · ${e.hours} ${tt('production.planner.hours')}`}
              onPointerDown={ev => startDrag(ev, e)}
            >
              <span className="trunc">{w > 110 ? e.title : ''}</span>
            </div>
          );
        })}
      </React.Fragment>
    );
  });

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('production.planner.title')}</h1>
          <p>{tt('production.planner.subtitle')}</p>
        </div>
        <div className="acts">
          <Segmented
            aria-label={tt('production.planner.rows')}
            value={rowType}
            onValueChange={v => setRowType(v as LoadRowType)}
            items={[
              { value: 'member', label: tt('production.planner.rowMember') },
              { value: 'work_center', label: tt('production.planner.rowCenter') },
              { value: 'resource', label: tt('production.planner.rowResource') },
            ]}
          />
          <Segmented
            aria-label={tt('production.planner.scaleLabel')}
            value={scale}
            onValueChange={v => setScale(v as Scale)}
            items={[
              { value: 'day', label: tt('production.planner.scaleDay') },
              { value: 'week', label: tt('production.planner.scaleWeek') },
              { value: 'month', label: tt('production.planner.scaleMonth') },
            ]}
          />
          <Button variant="ghost" onClick={() => setFrom(addDays(from, -days))} aria-label={tt('production.planner.prev')}>
            <ChevronLeft size={14} />
          </Button>
          <Button variant="ghost" onClick={() => setFrom(addDays(from, days))} aria-label={tt('production.planner.next')}>
            <ChevronRight size={14} />
          </Button>
          <Button variant="ghost" onClick={() => setFrom(addDays(dayKey(new Date()), -7))}>
            <Crosshair size={14} />
            {tt('production.planner.today')}
          </Button>
        </div>
      </div>

      {load.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('production.planner.loadFailed')} action={<Button size="sm" onClick={() => load.refetch()}>{tt('production.common.retry')}</Button>}>
          {(load.error as Error).message}
        </EmptyState>
      ) : load.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<CalendarRange size={20} />} title={tt('production.planner.emptyTitle')}>
          {tt('production.planner.emptyHint')}
        </EmptyState>
      ) : (
        <TimeGrid
          days={dayList}
          dayWidth={dayWidth}
          headerCells={headerCells}
          leftTitle={rowType === 'member' ? tt('production.planner.employee') : rowType === 'work_center' ? tt('production.planner.workCenter') : tt('production.planner.resource')}
          rowHeight={RH}
          height={rows.length * RH}
          today={today}
          leftRows={rows.map(r => (
            <div key={r.rowId} className="tl-row">
              <span className="trunc grow">{r.name}</span>
              {r.overloaded && (
                <Badge tone="red">
                  <CircleAlert size={11} />
                  {r.totalHours} {tt('production.planner.hours')}
                </Badge>
              )}
            </div>
          ))}
        >
          {bars}
        </TimeGrid>
      )}
    </div>
  );
}
