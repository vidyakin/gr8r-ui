import * as React from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  /** Иконка слева, например <Search size={14} /> */
  icon?: React.ReactNode;
  /** Подсказка клавиши справа, например "/" */
  kbd?: string;
  invalid?: boolean;
}

export function Input({ className, size = 'md', icon, kbd, invalid, ...props }: InputProps) {
  const input = (
    <input
      className={cn('input', size === 'lg' && 'input-lg', size === 'sm' && 'search-sm w-full', invalid && 'is-error', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
  if (!icon && !kbd) return input;
  return (
    <span className="inwrap">
      {icon}
      {input}
      {kbd && <kbd className="kbd">{kbd}</kbd>}
    </span>
  );
}

export function Textarea({ className, invalid, ...props }: React.ComponentProps<'textarea'> & { invalid?: boolean }) {
  return <textarea className={cn('textarea', invalid && 'is-error', className)} aria-invalid={invalid || undefined} {...props} />;
}

export interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  /** Поле получает id, связанный с label, hint и error */
  children: (ids: { id: string; 'aria-describedby'?: string; invalid: boolean }) => React.ReactNode;
}

/** Обёртка: подпись + поле + подсказка/ошибка, связанные через id и aria-describedby */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = React.useId();
  const descId = hint || error ? id + '-d' : undefined;
  return (
    <div className={cn('field', className)}>
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      {children({ id, 'aria-describedby': descId, invalid: !!error })}
      {error ? (
        <span className="err" id={descId}>
          <CircleAlert size={12} />
          {error}
        </span>
      ) : (
        hint && (
          <span className="hint" id={descId}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}
