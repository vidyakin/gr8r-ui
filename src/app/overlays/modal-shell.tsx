/* Оболочка модального окна — разметка H()/wrap() из overlays/modals.js (заголовок, подпись, крестик) на Radix Dialog */
import * as React from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModalProps {
  /** Без заголовка рисуется окно подтверждения: заголовок внутри тела (confirmModal) */
  title?: React.ReactNode;
  sub?: React.ReactNode;
  size?: 'sm' | 'lg';
  onClose: () => void;
  /** Cmd/Ctrl+Enter отправляет форму с этим id */
  formId?: string;
  children: React.ReactNode;
}

export function Modal({ title, sub, size, onClose, formId, children }: ModalProps) {
  return (
    <D.Root open onOpenChange={o => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="scrim" />
        <div className="modal-wrap">
          <D.Content
            className={cn('modal', size)}
            aria-describedby={undefined}
            onOpenAutoFocus={e => {
              // как autofocus в оригинале: первое поле с data-af, иначе первое поле формы
              e.preventDefault();
              const el = e.currentTarget as HTMLElement;
              (el.querySelector<HTMLElement>('[data-af]') ?? el.querySelector<HTMLElement>('input,textarea,button:not([aria-label="Close"])'))?.focus();
            }}
            onKeyDown={e => {
              if (formId && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                document.getElementById(formId)?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }
            }}
          >
            {title && (
              <div className="modal-h">
                <div>
                  <D.Title asChild>
                    <h2>{title}</h2>
                  </D.Title>
                  {sub && (
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                      {sub}
                    </div>
                  )}
                </div>
                <D.Close className="ibtn ibtn-sm" aria-label="Close">
                  <X size={16} />
                </D.Close>
              </div>
            )}
            {children}
          </D.Content>
        </div>
      </D.Portal>
    </D.Root>
  );
}

/** Заголовок внутри тела окна подтверждения */
export const ModalTitle = D.Title;
