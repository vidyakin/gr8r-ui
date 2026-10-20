import * as React from 'react';
import { Select as S } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.ComponentProps<typeof S.Root>, 'children'> {
  options: SelectOption[];
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  id?: string;
  invalid?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/** Выпадающий список в стиле Gr8r: триггер как .input, меню как .pop/.mi */
export function Select({ options, placeholder, size = 'md', className, id, invalid, ...props }: SelectProps) {
  const { 'aria-label': ariaLabel, 'aria-describedby': describedBy, ...root } = props;
  return (
    <S.Root {...root}>
      <S.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={cn('select-btn input', size === 'lg' && 'input-lg', size === 'sm' && 'search-sm w-full', invalid && 'is-error', className)}
        style={{ paddingRight: 28 }}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon className="chev">
          <ChevronDown size={13} />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className="pop select-menu" position="popper" sideOffset={4}>
          <S.Viewport>
            {options.map(o => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled} className="mi">
                {o.icon}
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="ck">
                  <Check size={14} />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
