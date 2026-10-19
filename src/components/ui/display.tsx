import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from './tooltip';

/* ---------- badge / label / chip ---------- */

export type Tone = 'neutral' | 'accent' | 'green' | 'amber' | 'red' | 'violet' | 'gray';

export function Badge({ tone = 'neutral', dot, className, children, ...props }: React.ComponentProps<'span'> & { tone?: Tone; dot?: boolean }) {
  return (
    <span className={cn('badge', tone !== 'neutral' && tone, className)} {...props}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

/** Метка с цветной точкой; color — любой CSS-цвет или токен, например "var(--violet)" */
export function Label({ color, className, children, style, ...props }: React.ComponentProps<'span'> & { color: string }) {
  return (
    <span className={cn('lbl', className)} style={{ '--c': color, ...style } as React.CSSProperties} {...props}>
      <i />
      {children}
    </span>
  );
}

/** Чип фильтра: «Статус: В работе ×» */
export function Chip({ name, children, onRemove, className }: { name?: React.ReactNode; children: React.ReactNode; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn('chip', className)}>
      {name && <b>{name}</b>}
      {children}
      {onRemove && (
        <button type="button" className="ibtn" onClick={onRemove} aria-label="Убрать">
          <X size={12} />
        </button>
      )}
    </span>
  );
}

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return <kbd className={cn('kbd', className)} {...props} />;
}

/* ---------- avatar ---------- */

export type AvatarSize = 'sm' | 'default' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  /** Без name рисуется пустой аватар «не назначено» */
  name?: string;
  /** Цвет; по умолчанию стабильно выбирается из палитры по имени */
  color?: string;
  src?: string;
  size?: AvatarSize;
  online?: boolean;
  tooltip?: boolean;
  className?: string;
}

const AV_COLORS = ['#5A67D8', '#3B82C4', '#8662C9', '#23918A', '#C54B78', '#C48A1E', '#3D8E5F', '#C0612B'];
const colorFor = (s: string) => AV_COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
const initials = (s: string) =>
  s
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function Avatar({ name, color, src, size = 'default', online, tooltip = true, className }: AvatarProps) {
  const cls = cn('av', size !== 'default' && size, !name && 'empty', online && 'presence', className);
  const el = !name ? (
    <span className={cls} aria-label="Не назначено" role="img" />
  ) : (
    <span className={cls} style={{ '--c': color || colorFor(name) } as React.CSSProperties} role="img" aria-label={name}>
      {src ? <img src={src} alt="" className="size-full rounded-full object-cover" /> : name.startsWith('+') ? name : initials(name)}
    </span>
  );
  return tooltip ? <Tooltip content={name || 'Не назначено'}>{el}</Tooltip> : el;
}

export function AvatarStack({ names, max = 4, size = 'sm' }: { names: string[]; max?: number; size?: AvatarSize }) {
  const rest = names.length - max;
  return (
    <span className="avs">
      {names.slice(0, max).map(n => (
        <Avatar key={n} name={n} size={size} />
      ))}
      {rest > 0 && <Avatar name={`+${rest}`} color="var(--gray)" size={size} tooltip={false} />}
    </span>
  );
}

/* ---------- progress ---------- */

export function Progress({ value, tone, className, ...props }: { value: number; tone?: 'green' | 'amber' | 'red'; className?: string; 'aria-label'?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className={cn('prog', tone, className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} {...props}>
      <i style={{ '--p': v / 100 } as React.CSSProperties} />
    </span>
  );
}

/** Составная полоска: [{value: 40, color: 'var(--st-done)'}, …] */
export function StackBar({ parts, className }: { parts: { value: number; color: string; label?: string }[]; className?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className={cn('stackbar', className)} role="img" aria-label={parts.map(p => `${p.label ?? ''} ${p.value}`).join(', ')}>
      {parts.map((p, i) => (
        <i key={i} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}
