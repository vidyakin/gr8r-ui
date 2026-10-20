import * as React from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export interface DialogContentProps extends Omit<React.ComponentProps<typeof D.Content>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Кнопки внизу; обычно <DialogClose asChild><Button>…</Button></DialogClose> */
  footer?: React.ReactNode;
}

export function DialogContent({ title, description, size = 'md', footer, className, children, ...props }: DialogContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="scrim" />
      <div className="modal-wrap">
        <D.Content className={cn('modal', size !== 'md' && size, className)} {...props}>
          <div className="modal-h">
            {/* Подзаголовок внутри шапки, как в оригинале (H(title, sub)): крестик центрируется по обеим строкам */}
            <div>
              <D.Title asChild>
                <h2>{title}</h2>
              </D.Title>
              {description && <D.Description className="modal-desc">{description}</D.Description>}
            </div>
            <D.Close className="ibtn ibtn-sm" aria-label="Закрыть">
              <X size={16} />
            </D.Close>
          </div>
          {!description && <D.Description className="sr-only">{typeof title === 'string' ? title : ''}</D.Description>}
          {children && <div className="modal-b">{children}</div>}
          {footer && <div className="modal-f">{footer}</div>}
        </D.Content>
      </div>
    </D.Portal>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

/** Готовый диалог подтверждения (аналог openModal({type:'confirm'}) в оригинале) */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Подтвердить', cancelLabel = 'Отмена', danger, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={title}
        description={description}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="ghost">{cancelLabel}</Button>
            </DialogClose>
            <Button
              variant={danger ? 'danger' : 'primary'}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      />
    </Dialog>
  );
}
