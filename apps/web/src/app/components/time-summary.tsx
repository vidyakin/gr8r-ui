/* Сводки по времени для Overview проекта, обзора воркспейса и профиля участника: план / факт / остаток,
   полоса прогресса, часы по дням. Новая функциональность — оригинала для сравнения нет. */
import { Progress } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { fmtHours, type TaskTime } from '../data/selectors';
import { dOff, parse } from '../lib/dates';
import type { TimeLog } from '../data/types';

/** Три числа Plan / Actual / Remaining (или «Over by» при перерасходе) и полоса прогресса */
export function TimeTotals({ x }: { x: TaskTime }) {
  const tt = useT();
  const overBy = x.over ? tt('views.time.overBy') : tt('views.time.remaining');
  return (
    <>
      <div className="tm-sum">
        <div>
          <span className="k">{tt('views.time.planField')}</span>
          <span className={cn('v num', !x.plan && 'faint')}>{x.plan ? fmtHours(x.plan) : '—'}</span>
        </div>
        <div>
          <span className="k">{tt('views.time.actual')}</span>
          <span className={cn('v num', x.over && 'bad')}>{fmtHours(x.actual)}</span>
        </div>
        <div>
          <span className="k">{overBy}</span>
          <span className={cn('v num', x.over ? 'bad' : !x.plan && 'faint')}>{x.over ? `+${fmtHours(x.actual - x.plan)}` : x.plan ? fmtHours(x.remaining) : '—'}</span>
        </div>
      </div>
      {x.plan > 0 && (
        <div className="tm-bar" style={{ marginTop: 0 }}>
          <Progress value={Math.min(x.pct ?? 0, 100)} tone={x.over ? 'red' : undefined} aria-label={tt('views.time.progressAria')} />
          <span className={cn('num', x.over && 'bad')}>{x.pct}%</span>
        </div>
      )}
    </>
  );
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Часы по дням за последние 7 дней (сегодня — последний столбец) */
export function WeekBars({ logs }: { logs: TimeLog[] }) {
  const tt = useT();
  const days = [6, 5, 4, 3, 2, 1, 0].map(n => {
    const date = dOff(-n);
    return { date, hours: logs.filter(l => l.date === date).reduce((a, l) => a + l.hours, 0) };
  });
  const max = Math.max(...days.map(d => d.hours), 1);
  return (
    <div className="tm-week" role="img" aria-label={days.map(d => `${d.date}: ${fmtHours(d.hours)}`).join(', ')}>
      {days.map(d => (
        <div key={d.date} title={`${d.date}: ${fmtHours(d.hours)}`}>
          <i className={d.hours ? undefined : 'zero'} style={{ height: d.hours ? `${Math.max((d.hours / max) * 100, 6)}%` : 2 }} />
          <span>{tt(`views.calendar.weekDaysShort.${DAY_KEYS[parse(d.date).getDay()]}`)}</span>
        </div>
      ))}
    </div>
  );
}
