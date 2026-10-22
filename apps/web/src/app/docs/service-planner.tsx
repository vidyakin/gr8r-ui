/* Планировщик работ услуг: часовой масштаб. Строки — исполнители или ресурсы, полосы — назначения заказ-нарядов
   и работы их ресурсов. Перетаскивание полосы меняет интервал (и исполнителя, если полоса перенесена на другую строку),
   нерабочие часы смены и перегрузка подсвечены: перегрузка — предупреждение, план сохраняется в любом случае. */
import * as React from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, CircleAlert, Crosshair } from 'lucide-react';
import { Badge, Button, EmptyState, Segmented, Skeleton, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { TimeGrid } from '../components/time-grid';
import { useCanWrite } from '../meta/custom-fields';
import { usePlanningApi, useServiceSchedule, type ServiceScheduleEntry, type ServiceWarning } from '../production/planning-data';

const RH = 36;
/** Ширина часа, px */
const HOUR_W = 42;

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + n);
  return dayKey(x);
};
/** Час и минуты локального времени */
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function ServicePlannerPage() {
  const canWrite = useCanWrite();
  const api = usePlanningApi();
  const [rowType, setRowType] = React.useState<'member' | 'resource'>('member');
  const [day, setDay] = React.useState(() => dayKey(new Date()));
  const from = `${day}T00:00:00Z`;
  const to = `${day}T23:59:59Z`;
  const plan = useServiceSchedule(from, to, rowType);

  const rows = plan.data?.rows ?? [];
  const entries = plan.data?.entries ?? [];
  const warnings = plan.data?.warnings ?? [];
  const dayWidth = 24 * HOUR_W;

  /** Полосы по строкам */
  const byRow = React.useMemo(() => {
    const map = new Map<string, ServiceScheduleEntry[]>();
    for (const e of entries) {
      const list = map.get(e.rowId) ?? [];
      list.push(e);
      map.set(e.rowId, list);
    }
    return map;
  }, [entries]);

  /** Перетаскивание полосы: сдвиг по часам меняет интервал, перенос на другую строку — исполнителя */
  const [drag, setDrag] = React.useState<{ id: string; hours: number; rowId: string | null } | null>(null);

  /** Сетка: по ней считаем, на какой строке стоит указатель */
  const gridRef = React.useRef<HTMLDivElement>(null);
  const rowAt = (clientY: number): string | null => {
    const el = gridRef.current?.querySelector('.tl-grid');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const idx = Math.floor((clientY - rect.top) / RH);
    return rows[idx]?.rowId ?? null;
  };

  const startDrag = (e: React.PointerEvent, entry: ServiceScheduleEntry) => {
    if (e.button !== 0 || !canWrite || entry.kind !== 'assignment') return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let hours = 0;
    let rowId: string | null = null;
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 4 || Math.abs(ev.clientY - y0) > 4) moved = true;
      if (!moved) return;
      hours = Math.round(dx / HOUR_W);
      rowId = rowAt(ev.clientY);
      setDrag({ id: entry.id, hours, rowId });
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      setDrag(null);
      if (!moved) return;
      void move(entry, hours, rowId);
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  };

  /** Новый интервал и исполнитель */
  const move = async (entry: ServiceScheduleEntry, hours: number, rowId: string | null) => {
    if (!entry.taskId) return;
    const body: { startAt?: string; endAt?: string; assigneeId?: string } = {};
    const start = new Date(entry.startAt);
    const end = new Date(entry.endAt);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      body.startAt = new Date(start.getTime() + hours * 3_600_000).toISOString();
      body.endAt = new Date(end.getTime() + hours * 3_600_000).toISOString();
    }
    // полоса, перенесённая на другую строку сотрудников, меняет исполнителя
    if (rowId && rowId !== entry.rowId) {
      const target = rows.find(r => r.rowId === rowId);
      if (target && target.rowType === 'member') body.assigneeId = target.rowId;
    }
    if (!body.startAt && !body.assigneeId) return;
    const r = await api<{ warnings: ServiceWarning[] }>('PATCH', `/work-order-assignments/${entry.taskId}`, body);
    if (!r) return;
    toast(body.startAt ? `Moved to ${hhmm(body.startAt)}` : 'Executor changed');
    for (const w of r.warnings ?? []) toast.info(w.message, { duration: 6000 });
  };

  const bars = rows.map((row, i) => {
    const y = i * RH;
    const list = byRow.get(row.rowId) ?? [];
    const slots = row.slots.filter(s => s.start.startsWith(day));
    return (
      <React.Fragment key={row.rowId}>
        <div className="tl-rowbg" style={{ top: y }} />
        {slots.map(s => {
          const hour = Number(s.start.slice(11, 13));
          const x = hour * HOUR_W;
          if (!s.working) return <div key={`off${s.start}`} className="tl-off" style={{ left: x, top: y, width: HOUR_W, height: RH }} />;
          if (s.overloaded) return <div key={`ov${s.start}`} className="tl-over" style={{ left: x, top: y, width: HOUR_W, height: RH }} />;
          return null;
        })}
        {list.map(e => {
          const shift = drag?.id === e.id ? drag.hours * HOUR_W : 0;
          // перенесённая полоса показывается на строке, под которую её перетащили
          const targetIdx = drag?.id === e.id && drag.rowId ? rows.findIndex(r => r.rowId === drag.rowId) : -1;
          const barY = (targetIdx >= 0 ? targetIdx : i) * RH;
          const startMs = new Date(e.startAt).getTime();
          const endMs = new Date(e.endAt).getTime();
          const x = ((startMs - new Date(from).getTime()) / 3_600_000) * HOUR_W + shift;
          const w = Math.max(12, ((endMs - startMs) / 3_600_000) * HOUR_W);
          const over = row.overloaded && e.kind === 'assignment';
          return (
            <div
              key={e.id}
              className={cn('bar', drag?.id === e.id && 'dragging')}
              style={{ '--c': over ? 'var(--red)' : 'var(--accent)', left: x, top: barY + 7, width: w } as React.CSSProperties}
              title={`${e.title} · ${hhmm(e.startAt)} – ${hhmm(e.endAt)} · ${e.hours} h`}
              onPointerDown={ev => startDrag(ev, e)}
            >
              <span className="trunc">{w > 110 ? e.title : ''}</span>
            </div>
          );
        })}
      </React.Fragment>
    );
  });

  const headerCells = React.useMemo(() => Array.from({ length: 24 }, (_, h) => ({ label: `${pad(h)}:00`, span: 1 / 24 })), []);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Service planner</h1>
          <p>Work of the service jobs by hours. Drag a bar to move it — an overload or work outside the shift is a warning, not a block.</p>
        </div>
        <div className="acts">
          <Segmented
            aria-label="Rows"
            value={rowType}
            onValueChange={v => setRowType(v as 'member' | 'resource')}
            items={[
              { value: 'member', label: 'Employees' },
              { value: 'resource', label: 'Resources' },
            ]}
          />
          <Button variant="ghost" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">
            <ChevronLeft size={14} />
          </Button>
          <Button variant="ghost" onClick={() => setDay(addDays(day, 1))} aria-label="Next day">
            <ChevronRight size={14} />
          </Button>
          <Button variant="ghost" onClick={() => setDay(dayKey(new Date()))}>
            <Crosshair size={14} />
            Today
          </Button>
        </div>
      </div>

      {plan.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load the plan" action={<Button size="sm" onClick={() => plan.refetch()}>Retry</Button>}>
          {(plan.error as Error).message}
        </EmptyState>
      ) : plan.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<CalendarRange size={20} />} title="Nothing to plan yet">
          Assign executors to the works of a work order — their intervals appear here.
        </EmptyState>
      ) : (
        <>
          <div ref={gridRef}>
            <TimeGrid
              days={[day]}
              dayWidth={dayWidth}
              headerCells={headerCells}
              leftTitle={rowType === 'member' ? 'Employee' : 'Resource'}
              rowHeight={RH}
              height={rows.length * RH}
              today={day}
              hourTicks
              leftRows={rows.map(r => (
                <div key={r.rowId} className="tl-row">
                  <span className="trunc grow">{r.name}</span>
                  {r.overloaded && (
                    <Badge tone="red">
                      <CircleAlert size={11} />
                      {r.bookedHours} h
                    </Badge>
                  )}
                </div>
              ))}
            >
              {bars}
            </TimeGrid>
          </div>
          {!!warnings.length && (
            <div className="panel" style={{ margin: 12, padding: 12 }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 'var(--fs-sm)' }}>Warnings</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {warnings.map((w, i) => (
                  <li key={i} className="muted">
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
