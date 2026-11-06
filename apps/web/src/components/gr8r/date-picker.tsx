/* Поле выбора даты с календарём проекта — замена нативного <input type="date">.
   Внешне обычный .input: по клику открывается поповер с быстрыми датами (сегодня, завтра…),
   очисткой и календарём react-day-picker, как в карточке задачи. Значение — строка ISO (YYYY-MM-DD). */
import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { Calendar } from '@/components/shadcn/calendar';
import { cn } from '@/lib/utils';
import { useT, weekStartsOn } from '@/i18n';
import { dOff, fmtDate, iso, parse, today } from '@/app/lib/dates';

const nextMonday = () => 7 - ((today().getDay() + 6) % 7);

export function DateInput({
  value,
  onChange,
  disabled,
  placeholder,
  invalid,
  max,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  className,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  invalid?: boolean;
  /** Запретить даты позже указанной (включительно с ней) */
  max?: string;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const tt = useT();
  const [open, setOpen] = React.useState(false);
  const set = (v: string | null) => {
    onChange(v ?? '');
    setOpen(false);
  };
  const quick = [
    { label: tt('views.drawer.dateToday'), n: () => 0 },
    { label: tt('views.drawer.dateTomorrow'), n: () => 1 },
    { label: tt('views.drawer.dateNextWeek'), n: nextMonday },
    { label: tt('views.drawer.dateIn2Weeks'), n: () => 14 },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          className={cn('input', invalid && 'is-error', className)}
          style={style}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
        >
          {value ? fmtDate(value) : <span className="faint">{placeholder}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="!max-w-none !p-1" onClick={e => e.stopPropagation()}>
        <div className="flex max-w-[252px] flex-wrap gap-1 p-1">
          {quick.map(q => (
            <button key={q.label} type="button" className="badge" onClick={() => set(dOff(q.n()))}>
              {q.label}
            </button>
          ))}
          {value && (
            <button type="button" className="badge" style={{ color: 'var(--red)' }} onClick={() => set(null)}>
              {tt('views.field.clear')}
            </button>
          )}
        </div>
        <div className="msep" />
        <Calendar
          compact
          mode="single"
          weekStartsOn={weekStartsOn()}
          selected={value ? parse(value) : undefined}
          defaultMonth={value ? parse(value) : undefined}
          disabled={max ? { after: parse(max) } : undefined}
          onSelect={d => d && set(iso(d))}
        />
      </PopoverContent>
    </Popover>
  );
}
