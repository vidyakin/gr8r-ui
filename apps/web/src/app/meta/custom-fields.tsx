/* Пользовательские поля системных сущностей (задача, сделка, компания, контакт): строки «название — значение» для карточек
   и ячейки таблиц. Значения лежат в колонке custom записи; правка проверяется той же zod-схемой, что и на сервере. */
import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { validateRecord } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useSession } from '../data/session';
import { FIELD_ICONS, FieldInput, FieldValue } from './field-ui';
import { useEntityFields, type MetaField } from './data';

export interface CustomRow {
  field: MetaField;
  label: string;
  icon: LucideIcon;
  node: React.ReactNode;
}

type Custom = Record<string, unknown> | undefined;

/** Можно ли менять данные: гости только читают */
export function useCanWrite() {
  const { active } = useSession();
  return !!active && active.role !== 'guest';
}

/** Строки пользовательских полей сущности. save получает изменение одного ключа ({ключ: значение|null}) */
export function useCustomRows(entityKey: string, custom: Custom, save: (patch: Record<string, unknown>) => void): CustomRow[] {
  const fields = useEntityFields(entityKey);
  const canWrite = useCanWrite();
  return fields.map(f => {
    const t = useT();
    const value = custom?.[f.key];
    const change = (v: unknown) => {
      const check = validateRecord([f], { [f.key]: v }, 'patch');
      if (!check.ok) return void toast.error(check.errors[f.key] ?? t('meta.field.invalidValue'));
      save({ [f.key]: v ?? null });
    };
    return { field: f, label: f.name, icon: FIELD_ICONS[f.type], node: canWrite ? <FieldInput field={f} value={value} onChange={change} /> : <FieldValue field={f} value={value} /> };
  });
}

/** Значение для таблицы и карточек: только чтение */
export function CustomCell({ field, custom }: { field: MetaField; custom: Custom }) {
  return <FieldValue field={field} value={custom?.[field.key]} />;
}

/** Колонки таблицы задач из пользовательских полей: id вида cf:ключ */
export const CF_PREFIX = 'cf:';
export const isCustomColumn = (id: string) => id.startsWith(CF_PREFIX);
export function useCustomColumns(entityKey: string) {
  const fields = useEntityFields(entityKey);
  return React.useMemo(() => fields.map(f => ({ id: `${CF_PREFIX}${f.key}`, name: f.name, width: f.type === 'long_text' ? 220 : 150, field: f })), [fields]);
}
