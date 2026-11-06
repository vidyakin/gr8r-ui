/* Предупреждения проведения: сервер отдаёт код (warnings в ответе POST /documents/:id/post),
   интерфейс переводит его. Категория бюджета объекта приходит в составном коде budget_exceeded:<категория>. */
import type { TKey } from '@/i18n';

const BUDGET_CATEGORY: Record<string, TKey> = {
  material: 'objects.budget.category.material',
  labor: 'objects.budget.category.labor',
  subcontract: 'objects.budget.category.subcontract',
  // ключ словаря не 'other': объект с полем other тип принимает за форму множественного числа
  other: 'objects.budget.category.otherCosts',
};

const BUDGET_PREFIX = 'budget_exceeded:';

/** Текст предупреждения по коду; неизвестный код показывается как есть */
export function warningText(translate: (key: TKey, params?: Record<string, string>) => string, code: string): string {
  if (code.startsWith(BUDGET_PREFIX)) {
    const key = BUDGET_CATEGORY[code.slice(BUDGET_PREFIX.length)];
    return translate('objects.budget.warnExceeded', { category: key ? translate(key) : code.slice(BUDGET_PREFIX.length) });
  }
  if (code === 'supplier_rating_level_d') return translate('docs.document.warnSupplierRatingD');
  return code;
}
