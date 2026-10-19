import * as React from 'react';
import { Toaster as Sonner, toast as sonner, type ExternalToast } from 'sonner';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ---------- alert ---------- */

const ALERT_ICON = { info: Info, ok: CircleCheck, warn: TriangleAlert, danger: CircleAlert } as const;

export function Alert({ tone = 'info', title, children, className, action }: { tone?: keyof typeof ALERT_ICON; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const Icon = ALERT_ICON[tone];
  return (
    <div className={cn('alert', tone, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={15} />
      <div className="flex-1">
        {title && <b>{title} </b>}
        {children}
      </div>
      {action}
    </div>
  );
}

/* ---------- empty state ---------- */

export function EmptyState({ icon, title, children, action, size, error, className }: { icon: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; size?: 'sm'; error?: boolean; className?: string }) {
  return (
    <div className={cn('empty-state', size, error && 'err', className)}>
      <div className="glyph">{icon}</div>
      <h3 className="es-h">{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/* ---------- skeleton ---------- */

export function Skeleton({ className, w, h = 12, style, ...props }: React.ComponentProps<'span'> & { w?: number | string; h?: number | string }) {
  return <span className={cn('sk', className)} style={{ width: w, height: h, ...style }} aria-hidden {...props} />;
}

/* ---------- toast ---------- */

/** Поставить один раз в корень (см. Gr8rProvider) */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      gap={8}
      icons={{
        success: <CircleCheck size={15} />,
        error: <CircleAlert size={15} />,
        info: <Info size={15} />,
        warning: <TriangleAlert size={15} />,
      }}
      toastOptions={{
        unstyled: true,
        closeButton: true,
        classNames: { toast: 'toast', actionButton: 'ta', closeButton: 'ibtn ibtn-xs order-last !static !transform-none !bg-transparent !border-0 !text-inherit opacity-60' },
      }}
    />
  );
}

type ToastOpts = ExternalToast & { action?: { label: string; onClick: () => void } };

/** toast('Задача создана'), toast.error('Не сохранилось', { action: { label: 'Повторить', onClick } }) */
export const toast = Object.assign((msg: React.ReactNode, o?: ToastOpts) => sonner.success(msg, o), {
  success: (msg: React.ReactNode, o?: ToastOpts) => sonner.success(msg, o),
  error: (msg: React.ReactNode, o?: ToastOpts) => sonner.error(msg, o),
  info: (msg: React.ReactNode, o?: ToastOpts) => sonner.info(msg, o),
  dismiss: sonner.dismiss,
});
