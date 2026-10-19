import * as React from 'react';
import { DropdownMenu as M, ContextMenu as C, Popover as P } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ---------- dropdown menu ---------- */

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuGroup = M.Group;
export const MenuSub = M.Sub;

export function MenuContent({ className, sideOffset = 4, align = 'start', ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={sideOffset} align={align} className={cn('pop', className)} {...props} />
    </M.Portal>
  );
}

export interface MenuItemProps extends React.ComponentProps<typeof M.Item> {
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
}

export function MenuItem({ className, icon, shortcut, danger, children, ...props }: MenuItemProps) {
  return (
    <M.Item className={cn('mi', danger && 'danger', className)} {...props}>
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut && (
        <span className="r">
          <kbd className="kbd">{shortcut}</kbd>
        </span>
      )}
    </M.Item>
  );
}

export function MenuCheckboxItem({ className, icon, children, ...props }: React.ComponentProps<typeof M.CheckboxItem> & { icon?: React.ReactNode }) {
  return (
    <M.CheckboxItem className={cn('mi', className)} {...props}>
      {icon}
      <span className="flex-1">{children}</span>
      <M.ItemIndicator className="ck">
        <Check size={14} />
      </M.ItemIndicator>
    </M.CheckboxItem>
  );
}

export const MenuRadioGroup = M.RadioGroup;
export function MenuRadioItem({ className, icon, children, ...props }: React.ComponentProps<typeof M.RadioItem> & { icon?: React.ReactNode }) {
  return (
    <M.RadioItem className={cn('mi', className)} {...props}>
      {icon}
      <span className="flex-1">{children}</span>
      <M.ItemIndicator className="ck">
        <Check size={14} />
      </M.ItemIndicator>
    </M.RadioItem>
  );
}

export function MenuSubTrigger({ className, icon, children, ...props }: React.ComponentProps<typeof M.SubTrigger> & { icon?: React.ReactNode }) {
  return (
    <M.SubTrigger className={cn('mi', className)} {...props}>
      {icon}
      <span className="flex-1">{children}</span>
      <ChevronRight size={14} className="text-text-3" />
    </M.SubTrigger>
  );
}

export function MenuSubContent({ className, ...props }: React.ComponentProps<typeof M.SubContent>) {
  return (
    <M.Portal>
      <M.SubContent sideOffset={6} alignOffset={-4} className={cn('pop', className)} {...props} />
    </M.Portal>
  );
}

export function MenuLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn('mh', className)} {...props} />;
}

export function MenuSeparator({ className, ...props }: React.ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn('msep', className)} {...props} />;
}

/* ---------- context menu (правый клик) — тот же вид, другой триггер ---------- */

export const ContextMenu = C.Root;
export const ContextMenuTrigger = C.Trigger;
export function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof C.Content>) {
  return (
    <C.Portal>
      <C.Content className={cn('pop', className)} {...props} />
    </C.Portal>
  );
}
export function ContextMenuItem({ className, icon, shortcut, danger, children, ...props }: React.ComponentProps<typeof C.Item> & Omit<MenuItemProps, keyof React.ComponentProps<typeof M.Item>>) {
  return (
    <C.Item className={cn('mi', danger && 'danger', className)} {...props}>
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut && (
        <span className="r">
          <kbd className="kbd">{shortcut}</kbd>
        </span>
      )}
    </C.Item>
  );
}
export function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof C.Separator>) {
  return <C.Separator className={cn('msep', className)} {...props} />;
}

/* ---------- popover: произвольное содержимое в той же «таблетке» ---------- */

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;
export function PopoverContent({ className, sideOffset = 4, align = 'start', ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content sideOffset={sideOffset} align={align} className={cn('pop pad', className)} {...props} />
    </P.Portal>
  );
}
