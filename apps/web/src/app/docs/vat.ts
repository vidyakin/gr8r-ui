import { type CountryPack } from '@erp/shared';
import { t, tEnum } from '@/i18n';

export function vatLabel(pack: CountryPack, rate: string): string {
  if (rate === 'none' && pack.code === 'AE') return t('enums.vat.exempt');
  return tEnum('vat', rate, pack.vatRateLabels[rate] ?? `${rate}%`);
}
