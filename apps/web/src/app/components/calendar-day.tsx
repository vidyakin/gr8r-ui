/* Режим дня в календаре: задачи дня сверху + временная шкала 08:00–20:00 с шагом 15 минут, прокруткой и красной линией текущего времени */
import * as React from 'react';
import { Clock, Plus } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { PriorityIcon, StatusIcon } from '@/components/erp/task';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { project, projectColor } from '../data/selectors';
import type { CalendarEvent, Task } from '../data/types';
import { MemberAvatar, useTaskActions } from './workspace';

const START_HOUR = 8;
const END_HOUR = 20;
const SLOT_MIN = 15;
const SLOT_H = 20;
const TOTAL_SLOTS = ((END_HOUR - START_HOUR) * 60) / SLOT_MIN; // 48 слотов

function parseTimeMin(time?: string): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const fmtClock = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

export interface DayScheduleProps {
  ds: string;
  isToday: boolean;
  tasks: Task[];
  events: CalendarEvent[];
  onAdd?: (due: string) => void;
  renderEvent?: (e: CalendarEvent) => React.ReactNode;
}

export function DaySchedule({ ds, isToday, tasks, events, onAdd, renderEvent }: DayScheduleProps) {
  const { data } = useWorkspace();
  const { open } = useTaskActions();
  const tt = useT();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [nowMin, setNowMin] = React.useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  React.useEffect(() => {
    if (!isToday) return;
    const tick = () => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [isToday]);

  const inRange = isToday && nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60;
  const nowTop = ((nowMin - START_HOUR * 60) / SLOT_MIN) * SLOT_H;

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !inRange) return;
    el.scrollTop = Math.max(0, nowTop - el.clientHeight / 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, isToday]);

  const timedEvents: { ev: CalendarEvent; min: number }[] = [];
  const otherEvents: CalendarEvent[] = [];
  for (const ev of events) {
    const min = parseTimeMin(ev.time);
    if (min != null && min >= START_HOUR * 60 && min < END_HOUR * 60) timedEvents.push({ ev, min });
    else otherEvents.push(ev);
  }

  return (
    <div className="cday-view">
      {(tasks.length > 0 || otherEvents.length > 0 || onAdd) && (
        <div className="cday-allday">
          <div className="cday-allday-list">
            {otherEvents.map(ev => (renderEvent ? renderEvent(ev) : null))}
            {tasks.map(t => (
              <button
                key={t.id}
                type="button"
                data-ctx="task"
                data-id={t.id}
                className={cn('cev', t.status === 'done' && 'done')}
                style={{ '--c': projectColor(project(data, t.project)), width: 'auto', maxWidth: '100%' } as React.CSSProperties}
                title={t.title}
                onClick={() => open(t)}
              >
                {t.status === 'done' ? <StatusIcon status="done" size={11} /> : t.priority != null && <PriorityIcon priority={t.priority} size={11} />}
                <span className="trunc">{t.title}</span>
                <MemberAvatar id={t.assignee} tooltip={false} />
              </button>
            ))}
            {tasks.length === 0 && otherEvents.length === 0 && (
              <span className="faint" style={{ fontSize: 12 }}>
                {tt('views.calendar.noTasks')}
              </span>
            )}
          </div>
          {onAdd && (
            <IconButton size="xs" label={tt('views.calendar.addTask')} tooltip={false} onClick={() => onAdd(ds)}>
              <Plus size={14} />
            </IconButton>
          )}
        </div>
      )}

      <div ref={scrollRef} className="cday-scroll">
        <div className="cday-timeline" style={{ height: TOTAL_SLOTS * SLOT_H }}>
          {Array.from({ length: TOTAL_SLOTS }, (_, i) => {
            const totalMin = START_HOUR * 60 + i * SLOT_MIN;
            const h = Math.floor(totalMin / 60);
            const m = totalMin % 60;
            const isHour = m === 0;
            const isHalf = m === 30;
            return (
              <div
                key={i}
                className={cn('cday-slot', isHour ? 'is-hour' : isHalf ? 'is-half' : 'is-q')}
                style={{ height: SLOT_H }}
              >
                <span className="cday-time">{isHour ? fmtClock(h, 0) : ''}</span>
                <div className="cday-lane" />
              </div>
            );
          })}
          <div className="cday-end-label">{fmtClock(END_HOUR, 0)}</div>

          <div className="cday-events-layer">
            {timedEvents.map(({ ev, min }) => {
              const top = ((min - START_HOUR * 60) / SLOT_MIN) * SLOT_H;
              const p = project(data, ev.project);
              return (
                <div key={ev.id} className="cday-ev-wrap" style={{ top }}>
                  {renderEvent ? (
                    renderEvent(ev)
                  ) : (
                    <div className="cev event" style={{ '--c': projectColor(p) } as React.CSSProperties}>
                      <Clock size={11} />
                      <span className="num">{ev.time}</span>
                      <span className="trunc">{ev.title}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {inRange && (
            <div className="cday-now" style={{ top: nowTop }} aria-hidden>
              <span className="cday-now-badge">{fmtClock(Math.floor(nowMin / 60), nowMin % 60)}</span>
              <span className="cday-now-dot" />
              <span className="cday-now-line" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
