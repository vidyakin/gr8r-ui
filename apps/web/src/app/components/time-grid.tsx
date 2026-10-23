/* Общая сетка времени: левая панель со строками и правая — колонки дней с полосами.
   Используется диаграммой Ганта задач (components/timeline-view.tsx) и планировщиком загрузки
   (production/PlannerPage.tsx) — сетка одна, различаются только строки и полосы. */
import * as React from 'react';
import { useT } from '@/i18n';

/** Ячейка шапки: подпись и сколько дней она занимает */
export interface TimeGridHeaderCell {
  label: React.ReactNode;
  span: number;
  /** Класс ячейки (например, «сегодня») */
  className?: string;
}

export interface TimeGridProps {
  /** Дни периода (YYYY-MM-DD) */
  days: string[];
  /** Ширина дня, px */
  dayWidth: number;
  /** Ячейки шапки (день или неделя) */
  headerCells: TimeGridHeaderCell[];
  /** Заголовок левой панели */
  leftTitle: React.ReactNode;
  /** Строки левой панели */
  leftRows?: React.ReactNode;
  /** Число строк (для высоты сетки, если она не задана) */
  rowCount?: number;
  /** Высота строки, px */
  rowHeight?: number;
  /** Высота сетки, px (если не задана — по числу строк) */
  height?: number;
  /** Сегодняшний день (YYYY-MM-DD) */
  today?: string;
  /** Подсвечивать выходные */
  markWeekends?: boolean;
  /** Часовые линии сетки (масштаб часа): день делится на часы */
  hourTicks?: boolean;
  /** Содержимое сетки: полосы и линии (абсолютные позиции) */
  children?: React.ReactNode;
  /** Обработчик прокрутки правой панели */
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
  /** Ссылка на прокручиваемую область правой панели */
  scrollRef?: React.Ref<HTMLDivElement>;
  /** Ссылка на список строк левой панели */
  leftRef?: React.Ref<HTMLDivElement>;
  /** Дополнительные классы корня */
  className?: string;
}

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

const weekdayOf = (date: string): number => {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
};

/** Группировка дней по месяцам: подпись и число дней */
function monthGroups(days: string[], tt: ReturnType<typeof useT>): { label: string; span: number }[] {
  const out: { label: string; span: number }[] = [];
  for (const d of days) {
    const dt = new Date(`${d}T00:00:00Z`);
    const last = out[out.length - 1];
    const label = `${tt(`views.calendar.monthsLong.${MONTH_KEYS[dt.getUTCMonth()]}`)} ${dt.getUTCFullYear()}`;
    if (last && last.label === label) last.span += 1;
    else out.push({ label, span: 1 });
  }
  return out;
}

export function TimeGrid({
  days,
  dayWidth,
  headerCells,
  leftTitle,
  leftRows,
  rowCount,
  rowHeight = 36,
  height,
  today,
  markWeekends = true,
  hourTicks = false,
  children,
  onScroll,
  scrollRef,
  leftRef,
  className,
}: TimeGridProps) {
  const tt = useT();
  const width = days.length * dayWidth;
  const gridHeight = height ?? (rowCount ?? 0) * rowHeight;
  const months = React.useMemo(() => monthGroups(days, tt), [days, tt]);
  const todayIndex = today ? days.indexOf(today) : -1;

  return (
    <div className={className ? `tl ${className}` : 'tl'}>
      <div className="tl-left">
        <div className="tl-head">{leftTitle}</div>
        <div className="tl-rows" ref={leftRef}>
          {leftRows}
        </div>
      </div>
      <div className="tl-right" ref={scrollRef} onScroll={onScroll}>
        <div className="tl-head" style={{ width }}>
          <div className="tl-months">
            {months.map(m => (
              <div key={m.label} style={{ width: m.span * dayWidth }}>
                <span>{m.label}</span>
              </div>
            ))}
          </div>
          <div className="tl-days">
            {headerCells.map((c, i) => (
              <div key={i} className={c.className} style={{ width: c.span * dayWidth }}>
                {c.label}
              </div>
            ))}
          </div>
        </div>
        <div className="tl-grid" style={{ width, height: gridHeight }}>
          {markWeekends &&
            days.map((d, i) => {
              const wd = weekdayOf(d);
              return wd === 6 || wd === 7 ? <div key={d} className="tl-we" style={{ left: i * dayWidth, width: dayWidth }} /> : null;
            })}
          {days.map((d, i) => (
            <div key={`gl${d}`} className="tl-gl" style={{ left: i * dayWidth }} />
          ))}
          {hourTicks &&
            days.map((d, i) =>
              Array.from({ length: 23 }, (_, h) => <div key={`h${d}${h}`} className="tl-hour" style={{ left: i * dayWidth + ((h + 1) * dayWidth) / 24 }} />),
            )}
          {todayIndex >= 0 && <div className="tl-today" style={{ left: todayIndex * dayWidth + dayWidth / 2 }} title={tt('views.calendar.today')} />}
          {children}
        </div>
      </div>
    </div>
  );
}
