import * as React from 'react';
import { ToggleGroup, Tabs as T } from 'radix-ui';
import { cn } from '@/lib/utils';

/* ---------- checkbox / switch / radio: нативные элементы со стилями Gr8r ---------- */

export interface CheckboxProps extends Omit<React.ComponentProps<'input'>, 'type'> {
  indeterminate?: boolean;
  round?: boolean;
}

export function Checkbox({ className, indeterminate = false, round, ref, ...props }: CheckboxProps) {
  const inner = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(ref, () => inner.current!);
  React.useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={inner} type="checkbox" className={cn('check', round && 'round', className)} {...props} />;
}

export function Switch({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return <input type="checkbox" role="switch" className={cn('toggle', className)} {...props} />;
}

export function Radio({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return <input type="radio" className={cn('radio', className)} {...props} />;
}

/** Чекбокс/свитч с подписью в одну строку */
export function Choice({ children, className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label className={cn('row cursor-pointer select-none text-sm', className)} {...props}>
      {children}
    </label>
  );
}

/* ---------- segmented control ---------- */

export interface SegmentedProps<V extends string> {
  value: V;
  onValueChange: (v: V) => void;
  items: { value: V; label?: React.ReactNode; icon?: React.ReactNode; 'aria-label'?: string }[];
  className?: string;
  'aria-label'?: string;
}

export function Segmented<V extends string>({ value, onValueChange, items, className, ...rest }: SegmentedProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={v => v && onValueChange(v as V)}
      className={cn('seg', className)}
      {...rest}
    >
      {items.map(it => (
        <ToggleGroup.Item key={it.value} value={it.value} aria-label={it['aria-label']}>
          {it.icon}
          {it.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

/* ---------- tabs ---------- */

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn('tabs', className)} {...props} />;
}

export function Tab({ className, count, children, ...props }: React.ComponentProps<typeof T.Trigger> & { count?: number }) {
  return (
    <T.Trigger className={cn('tab', className)} {...props}>
      {children}
      {count != null && <span className="cnt">{count}</span>}
    </T.Trigger>
  );
}
