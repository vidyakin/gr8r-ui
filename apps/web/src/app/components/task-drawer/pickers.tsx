/* Поповеры карточки задачи — порт popList / поповера date из overlays/popovers.js, autosize и rte из actions/actions.js.
   ListPopover — список с поиском (labels, deps, recur, estimate, project, subassignee), DatePopover — быстрые даты + календарь. */
import * as React from 'react';
import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, toast } from '@/components/ui';
import { Calendar } from '@/components/shadcn/calendar';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { dOff, iso, parse, today } from '../../lib/dates';

export interface PickItem {
  id: string;
  name: string;
  icon?: React.ReactNode;
  on?: boolean;
}

/** Список выбора в поповере. multi — остаётся открытым после выбора; search — плейсхолдер поля поиска */
export function ListPopover({
  trigger,
  items,
  search,
  multi,
  onPick,
  align = 'start',
  width,
}: {
  trigger: React.ReactElement;
  items: PickItem[];
  search?: string;
  multi?: boolean;
  onPick: (id: string) => void;
  align?: 'start' | 'end';
  width?: number;
}) {
  const tt = useT();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const list = items.filter(it => !q || it.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        collisionPadding={8}
        role="menu"
        className="!p-1"
        style={width ? { width } : undefined}
        onClick={e => e.stopPropagation()}
        onOpenAutoFocus={e => {
          e.preventDefault();
          const c = e.currentTarget as HTMLElement;
          (c.querySelector<HTMLElement>('input') ?? c.querySelector<HTMLElement>('[aria-checked="true"]') ?? c.querySelector<HTMLElement>('.mi'))?.focus({ preventScroll: true });
        }}
        onKeyDown={e => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
          const els = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button.mi')];
          if (!els.length) return;
          e.preventDefault();
          const i = els.indexOf(document.activeElement as HTMLElement);
          const n = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
          els[n].focus();
        }}
      >
        {search && (
          <div className="pin">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={search} aria-label={search} />
          </div>
        )}
        {list.map(it => (
          <button
            key={it.id}
            className="mi"
            role="menuitemradio"
            aria-checked={!!it.on}
            onClick={() => {
              onPick(it.id);
              if (!multi) setOpen(false);
            }}
          >
            {it.icon}
            <span className="trunc">{it.name}</span>
            {it.on && (
              <span className="ck">
                <Check size={14} />
              </span>
            )}
          </button>
        ))}
        {!list.length && (
          <div className="mi faint" style={{ cursor: 'default' }}>
            {tt('views.drawer.noMatches')}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** «Next week» в оригинале — ближайший понедельник */
const nextMonday = () => 7 - ((today().getDay() + 6) % 7);
function getQuick(tt: ReturnType<typeof useT>): { label: string; n: () => number }[] {
  return [
    { label: tt('views.drawer.dateToday'), n: () => 0 },
    { label: tt('views.drawer.dateTomorrow'), n: () => 1 },
    { label: tt('views.drawer.dateNextWeek'), n: nextMonday },
    { label: tt('views.drawer.dateIn2Weeks'), n: () => 14 },
  ];
}

/** Выбор даты: быстрые варианты и календарь. trigger — кнопка, открывающая поповер */
export function DatePopover({ trigger, value, onChange, align = 'start' }: { trigger: React.ReactElement; value: string | null | undefined; onChange: (v: string | null) => void; align?: 'start' | 'end' }) {
  const tt = useT();
  const [open, setOpen] = React.useState(false);
  const set = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };
  const quick = getQuick(tt);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} collisionPadding={8} className="!max-w-none !p-1" onClick={e => e.stopPropagation()}>
        <div className="flex max-w-[248px] flex-wrap gap-1 p-1 pb-0">
          {quick.map(q => (
            <button key={q.label} className="btn btn-sm btn-ghost" onClick={() => set(dOff(q.n()))}>
              {q.label}
            </button>
          ))}
          {value && (
            <button className="btn btn-sm btn-ghost" style={{ color: 'var(--red)' }} onClick={() => set(null)}>
              {tt('views.field.clear')}
            </button>
          )}
        </div>
        <Calendar mode="single" weekStartsOn={1} selected={value ? parse(value) : undefined} defaultMonth={value ? parse(value) : undefined} onSelect={d => d && set(iso(d))} />
      </PopoverContent>
    </Popover>
  );
}

/** Подгоняет высоту textarea под содержимое (autosize из shell/render.js) */
export function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

export const AutoTextarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(function AutoTextarea({ onInput, ...props }, ref) {
  const inner = React.useRef<HTMLTextAreaElement>(null);
  React.useImperativeHandle(ref, () => inner.current!);
  React.useLayoutEffect(() => autosize(inner.current), [props.value]);
  React.useEffect(() => {
    const on = () => autosize(inner.current);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return (
    <textarea
      ref={inner}
      onInput={e => {
        autosize(e.currentTarget);
        onInput?.(e);
      }}
      {...props}
    />
  );
});

/** Редактор описания (data-rte в оригинале): contenteditable + execCommand, панель форматирования */
export function RichText({ html, onChange, labelledBy, className }: { html: string; onChange: (html: string) => void; labelledBy: string; className?: string }) {
  const tt = useT();
  const ref = React.useRef<HTMLDivElement>(null);
  // Содержимое ставим вручную, чтобы не сбрасывать курсор при наборе
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }, [html]);
  return (
    <div
      ref={ref}
      className={cn('rte-body', className)}
      id="d-desc"
      contentEditable
      suppressContentEditableWarning
      data-ph={tt('views.drawer.descPlaceholder')}
      role="textbox"
      aria-multiline="true"
      aria-labelledby={labelledBy}
      onInput={e => onChange(e.currentTarget.innerHTML)}
    />
  );
}

/** Команда форматирования описания; возвращает новый html или null */
export function runFormat(cmd: string, tt: ReturnType<typeof useT>) {
  const [name, arg] = cmd.split(':');
  if (name === 'createLink') {
    const s = String(getSelection());
    if (/^https?:\/\//.test(s)) document.execCommand('createLink', false, s);
    else toast.info(tt('views.drawer.selectUrl'));
  } else document.execCommand(name, false, arg ? `<${arg}>` : undefined);
  return (document.getElementById('d-desc') as HTMLElement | null)?.innerHTML ?? null;
}
