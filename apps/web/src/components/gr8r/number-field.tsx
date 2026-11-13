/* Числовое поле со степпером: обычное поле проекта (.input) с кнопками −/+ справа.
   Нативные спин-стрелки скрыты — вместо них наши иконки; стрелки ↑/↓ на клавиатуре
   работают как обычно (type="number"), ввод с клавиатуры тоже.
   Режим `decimal` — для дробных значений: поле текстовое (запятая и точка как разделитель,
   промежуточное «1,» не теряется при вводе), наружу отдаётся число. */
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
  decimal,
  onBlur,
}: {
  value: number | string;
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
  /** текстовый ввод с запятой как разделителем — для дробных значений */
  decimal?: boolean;
  onBlur?: () => void;
}) {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const parse = (s: string) => {
    const n = Number(s.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const canonical = (n: number) => (decimal ? String(n).replace('.', ',') : String(n));
  const incoming = parse(String(value));
  const base = incoming ?? (min ?? 0);
  const bump = (d: number) => onChange(clamp(base + d * step));
  const canMinus = disabled || (min != null && base <= min);
  const canPlus = disabled || (max != null && base >= max);

  // дробный режим: держим текст пользователя (промежуточное «1,» не должно теряться)
  const [text, setText] = React.useState(() => canonical(base));
  React.useEffect(() => {
    if (!decimal || incoming == null) return;
    // текст уже означает это число (в т.ч. промежуточное «1,») — оставляем как вводил пользователь,
    // иначе значение пришло снаружи (бейдж, кнопки −/+, сброс формы) — показываем его
    setText(t => (parse(t) === incoming ? t : canonical(incoming)));
  }, [decimal, incoming]);

  return (
    <div className={cn('numfield', className)} style={style}>
      <input
        type={decimal ? 'text' : 'number'}
        id={id}
        inputMode={decimal ? 'decimal' : 'numeric'}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={decimal ? text : (Number.isFinite(Number(value)) ? Number(value) : '')}
        onChange={e => {
          if (!decimal) {
            onChange(Number.isNaN(e.target.valueAsNumber) ? 0 : e.target.valueAsNumber);
            return;
          }
          setText(e.target.value);
          const n = parse(e.target.value);
          if (n != null) onChange(n);
        }}
        onBlur={() => {
          if (decimal) {
            const n = parse(text);
            setText(canonical(n ?? base));
          }
          onBlur?.();
        }}
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
