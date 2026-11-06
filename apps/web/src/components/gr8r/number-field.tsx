/* Числовое поле со степпером: обычное поле проекта (.input) с кнопками −/+ справа.
   Нативные спин-стрелки скрыты — вместо них наши иконки; стрелки ↑/↓ на клавиатуре
   работают как обычно (type="number"), ввод с клавиатуры тоже. */
import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  placeholder,
  id,
  'aria-label': ariaLabel,
  className,
  style,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const base = Number.isFinite(value) ? value : (min ?? 0);
  const bump = (d: number) => onChange(clamp(base + d * step));
  const canMinus = disabled || (min != null && base <= min);
  const canPlus = disabled || (max != null && base >= max);
  return (
    <div className={cn('numfield', className)} style={style}>
      <input
        type="number"
        id={id}
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={Number.isFinite(value) ? value : ''}
        onChange={e => onChange(Number.isNaN(e.target.valueAsNumber) ? 0 : e.target.valueAsNumber)}
      />
      <button type="button" tabIndex={-1} aria-hidden="true" className="ibtn ibtn-xs" disabled={canMinus} onClick={() => bump(-1)}>
        <Minus size={14} />
      </button>
      <button type="button" tabIndex={-1} aria-hidden="true" className="ibtn ibtn-xs" disabled={canPlus} onClick={() => bump(1)}>
        <Plus size={14} />
      </button>
    </div>
  );
}
