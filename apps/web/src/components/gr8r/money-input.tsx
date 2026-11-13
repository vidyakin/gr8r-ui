/* Денежное поле: обычное поле проекта, ввод только цифр и одного разделителя (запятая или точка),
   не больше двух знаков после него. Значение — строка как ввёл пользователь, разбор — parseNumber. */
import * as React from 'react';
import { Input } from '@/components/ui';

/** Очищает ввод суммы: цифры, один разделитель, до двух знаков после него */
export function sanitizeMoney(raw: string): string {
  const s = raw.replace(/\s/g, '').replace(/[^0-9.,]/g, '');
  const i = s.search(/[.,]/);
  if (i < 0) return s;
  return s.slice(0, i + 1) + s.slice(i + 1).replace(/[.,]/g, '').slice(0, 2);
}

export function MoneyInput({ value, onChange, ...rest }: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'inputMode'> & { value: string; onChange: (v: string) => void }) {
  return <Input {...rest} inputMode="decimal" autoComplete="off" value={value} onChange={e => onChange(sanitizeMoney(e.target.value))} />;
}
