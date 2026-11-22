/* Поле «Объект» объектного учёта: видно при подключённом модуле «Строительство» или если значение уже задано
   (отключение модуля только прячет поле, данные не меняются). Используется в шапке документа, строке платежа и задаче. */
import { Field, Select } from '@/components/ui';
import { useT } from '@/i18n';
import { useSectionAccess } from '../positions/access';
import { useObjectOptions } from './data';

export function useObjectFieldVisible(value: string | null | undefined): boolean {
  const access = useSectionAccess();
  return access.module('construction') || !!value;
}

export function ObjectSelect({ id, value, current, disabled, onChange, ariaLabel }: { id?: string; value: string | null; current?: { id: string; number: string; name: string } | null; disabled?: boolean; onChange: (v: string | null) => void; ariaLabel?: string }) {
  const tt = useT();
  const options = useObjectOptions();
  const items = [...(options.data ?? [])];
  if (current && !items.some(x => x.id === current.id)) items.push({ ...current, status: 'closed' } as (typeof items)[number]);
  const label = ariaLabel ?? tt('objects.field.object');
  return (
    <Select
      id={id}
      disabled={disabled}
      value={value ?? ''}
      onValueChange={v => onChange(v || null)}
      options={[{ value: '', label: tt('objects.field.none') }, ...items.map(x => ({ value: x.id, label: `${x.number} · ${x.name}` }))]}
      aria-label={label}
    />
  );
}

export function ObjectField({ value, current, disabled, onChange, className }: { value: string | null; current?: { id: string; number: string; name: string } | null; disabled: boolean; onChange: (v: string | null) => void; className?: string }) {
  const tt = useT();
  if (!useObjectFieldVisible(value)) return null;
  return (
    <Field className={className} label={tt('objects.field.object')}>
      {p => <ObjectSelect id={p.id} value={value} current={current} disabled={disabled} onChange={onChange} />}
    </Field>
  );
}
