/* Поле «Инвестпроект» в шапке документа: документ целиком идёт в факт выбранного проекта.
   Варианты — неархивные и незакрытые проекты; уже выбранный закрытый проект остаётся в списке, чтобы его было видно */
import { Field, Select } from '@/components/ui';
import { useT } from '@/i18n';
import { useInvestmentOptions } from './data';

export function DocInvestmentField({ value, current, disabled, onChange }: { value: string | null; current?: { id: string; name: string } | null; disabled: boolean; onChange: (v: string | null) => void }) {
  const tt = useT();
  const options = useInvestmentOptions();
  const items = [...(options.data ?? [])];
  if (current && !items.some(x => x.id === current.id)) items.push({ ...current, status: 'closed' });
  return (
    <Field label={tt('finance.docField.label')}>
      {p => (
        <Select
          id={p.id}
          disabled={disabled}
          value={value ?? ''}
          onValueChange={v => onChange(v || null)}
          options={[{ value: '', label: tt('finance.docField.none') }, ...items.map(x => ({ value: x.id, label: x.name }))]}
          aria-label={tt('finance.docField.label')}
        />
      )}
    </Field>
  );
}
