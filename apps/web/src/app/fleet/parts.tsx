/* Общие части экранов автопарка (задача 1210): шапка страницы, метка срока документа, универсальный диалог формы по описанию полей. */
import * as React from 'react';
import type { DocTermState } from '@gr8r/shared';
import { Badge, Button, Dialog, DialogContent, Field, Input, Select, Textarea, type SelectOption } from '@/components/ui';
import { useT } from '@/i18n';

export function FleetHead({ title, lead, actions }: { title: string; lead?: string; actions?: React.ReactNode }) {
  return (
    <div className="ph">
      <div>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {actions && <div className="row" style={{ gap: 8 }}>{actions}</div>}
    </div>
  );
}

const TERM_TONE = { ok: 'green', expiring: 'amber', expired: 'red', unlimited: 'gray' } as const;

/** Состояние срока документа: «ещё 12 дн.», «просрочен», «бессрочный» */
export function TermBadge({ state, daysLeft }: { state: DocTermState; daysLeft: number | null }) {
  const t = useT();
  const text = state === 'unlimited' ? t('fleet.term.unlimited') : state === 'expired' ? t('fleet.term.expired', { days: Math.abs(daysLeft ?? 0) }) : t('fleet.term.left', { days: daysLeft ?? 0 });
  return <Badge tone={TERM_TONE[state]}>{text}</Badge>;
}

export type FieldDef =
  | { key: string; label: string; type: 'text' | 'date' | 'time' | 'datetime'; hint?: string; required?: boolean }
  | { key: string; label: string; type: 'number'; hint?: string; required?: boolean }
  | { key: string; label: string; type: 'textarea'; hint?: string }
  | { key: string; label: string; type: 'select'; options: SelectOption[]; hint?: string; required?: boolean }
  | { key: string; label: string; type: 'check' };

export type Values = Record<string, string | boolean>;

/** Диалог формы по описанию полей. Значения — строки (числа и даты отдаёт вызывающий код), флажки — boolean. */
export function FormDialog({
  title,
  description,
  fields,
  initial,
  submitLabel,
  extra,
  size = 'md',
  onSubmit,
  onClose,
  footerExtra,
  hideSubmit,
}: {
  title: string;
  description?: string;
  fields: FieldDef[];
  initial: Values;
  submitLabel?: string;
  /** Блок под полями (списки, строки ремонта) */
  extra?: (values: Values, set: (patch: Values) => void) => React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  onSubmit: (v: Values) => Promise<boolean> | boolean;
  onClose: () => void;
  footerExtra?: React.ReactNode | ((v: Values, close: () => void) => React.ReactNode);
  /** Не показывать кнопку «Сохранить» (только действия в подвале) */
  hideSubmit?: boolean;
}) {
  const t = useT();
  const [v, setV] = React.useState<Values>(initial);
  const [busy, setBusy] = React.useState(false);
  const set = (patch: Values) => setV(s => ({ ...s, ...patch }));
  const missing = fields.some(f => 'required' in f && f.required && !String(v[f.key] ?? '').trim());
  const submit = async () => {
    setBusy(true);
    try {
      if (await onSubmit(v)) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={title}
        {...(description ? { description } : {})}
        size={size}
        footer={
          <>
            {typeof footerExtra === 'function' ? footerExtra(v, onClose) : footerExtra}
            <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            {!hideSubmit && <Button disabled={missing || busy} onClick={submit}>{submitLabel ?? t('common.save')}</Button>}
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
            {fields.map(f =>
              f.type === 'check' ? (
                <label key={f.key} className="row" style={{ gap: 8, alignSelf: 'end', minHeight: 36 }}>
                  <input type="checkbox" checked={!!v[f.key]} onChange={e => set({ [f.key]: e.target.checked })} />
                  {f.label}
                </label>
              ) : (
                <Field key={f.key} label={f.label} {...('hint' in f && f.hint ? { hint: f.hint } : {})} className={f.type === 'textarea' ? 'fleet-wide' : ''}>
                  {p =>
                    f.type === 'select' ? (
                      <Select id={p.id} aria-label={f.label} value={String(v[f.key] ?? '')} onValueChange={x => set({ [f.key]: x })} options={f.options} />
                    ) : f.type === 'textarea' ? (
                      <Textarea id={p.id} rows={2} value={String(v[f.key] ?? '')} onChange={e => set({ [f.key]: e.target.value })} />
                    ) : (
                      <Input
                        {...p}
                        type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'datetime' ? 'datetime-local' : 'text'}
                        {...(f.type === 'number' ? { inputMode: 'decimal' as const } : {})}
                        value={String(v[f.key] ?? '')}
                        onChange={e => set({ [f.key]: e.target.value })}
                      />
                    )
                  }
                </Field>
              ),
            )}
          </div>
          {extra?.(v, set)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Пустая строка → null, иначе строка (для необязательных полей API) */
export const orNull = (s: string | boolean | undefined): string | null => (typeof s === 'string' && s.trim() !== '' ? s.trim() : null);
/** Число из поля: пустое → undefined */
export const num = (s: string | boolean | undefined): string | undefined => (typeof s === 'string' && s.trim() !== '' ? s.trim().replace(',', '.') : undefined);
export const intOrNull = (s: string | boolean | undefined): number | null => (typeof s === 'string' && s.trim() !== '' ? Math.round(Number(s.replace(',', '.'))) : null);
/** ISO-момент из datetime-local и обратно (локальное время браузера) */
export const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (s: string | boolean | undefined): string | null => (typeof s === 'string' && s ? new Date(s).toISOString() : null);
