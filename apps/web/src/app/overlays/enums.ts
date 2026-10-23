/* Подписи значений из @gr8r/shared, нужные только оверлеям и страницам.
   Перевод — overlays.oenums.* (en/overlays.ts, ru/overlays.ts); если ключа нет — fallback из shared.
   Группы общие с каталогом (vat, replenishment, fieldType) — в catalog.enums и достаются через tEnum из @/i18n */
import { hasKey, t } from '@/i18n';

/** Запасной английский из shared — для тех случаев, когда ключ в overlays.oenums не задан */
export function tOEnum(group: string, value: string, fallback: string): string {
  const key = `overlays.oenums.${group}.${value}`;
  return hasKey(key) ? t(key as never) : fallback;
}
