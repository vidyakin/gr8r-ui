import * as React from 'react';
import { Tooltip as T } from 'radix-ui';
import { cn } from '@/lib/utils';

/** Оборачивает приложение один раз (см. Gr8rProvider) */
export function TooltipProvider(props: React.ComponentProps<typeof T.Provider>) {
  return <T.Provider delayDuration={350} skipDelayDuration={200} {...props} />;
}

export interface TooltipProps {
  content: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: React.ReactElement;
  className?: string;
}

export function Tooltip({ content, shortcut, side = 'bottom', children, className }: TooltipProps) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className={cn('tip', className)}>
          {content}
          {shortcut && <kbd className="kbd">{shortcut}</kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
