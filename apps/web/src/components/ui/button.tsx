import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Tooltip } from './tooltip';

const buttonVariants = cva('btn', {
  variants: {
    variant: {
      primary: 'btn-primary',
      secondary: 'btn-secondary',
      ghost: 'btn-ghost',
      danger: 'btn-danger',
      'danger-ghost': 'btn-danger-ghost',
    },
    size: { sm: 'btn-sm', md: '', lg: 'btn-lg' },
    block: { true: 'btn-block' },
  },
  defaultVariants: { variant: 'secondary', size: 'md' },
});

export interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Отрисовать дочерний элемент (например, <a> или <Link>) со стилями кнопки */
  asChild?: boolean;
  loading?: boolean;
}

export function Button({ className, variant, size, block, asChild, loading, disabled, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, block }), loading && 'is-loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    />
  );
}

const iconButtonVariants = cva('ibtn', {
  variants: { size: { xs: 'ibtn-xs', sm: 'ibtn-sm', md: '' } },
  defaultVariants: { size: 'md' },
});

export interface IconButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof iconButtonVariants> {
  /** Обязательная подпись: идёт в aria-label и в тултип */
  label: string;
  /** Сочетание клавиш, показывается в тултипе */
  shortcut?: string;
  active?: boolean;
  tooltip?: boolean;
}

export function IconButton({ className, size, label, shortcut, active, tooltip = true, ...props }: IconButtonProps) {
  const btn = <button type="button" aria-label={label} aria-pressed={active} className={cn(iconButtonVariants({ size }), active && 'on', className)} {...props} />;
  return tooltip ? (
    <Tooltip content={label} shortcut={shortcut}>
      {btn}
    </Tooltip>
  ) : (
    btn
  );
}

export { buttonVariants };
