import { aeCountryPack } from './ae';
import { kzCountryPack } from './kz';
import { ruCountryPack } from './ru';
import { COUNTRY_CODES, type CountryCode, type CountryPack } from './types';

export { COUNTRY_CODES, type CountryCode, type CountryPack, type CountryRequisites, type RequisiteField } from './types';
export { amountInWordsAed, isValidAeIban, isValidTrn } from './ae';
export { amountInWordsKzt, isValidBinIin, isValidKzIban } from './kz';

const packs = { RU: ruCountryPack, KZ: kzCountryPack, AE: aeCountryPack } satisfies Record<CountryCode, CountryPack>;
export const COUNTRY_PRINT_FORMS = [...packs.RU.printFormIds, ...packs.KZ.printFormIds, ...packs.AE.printFormIds] as const;
export type CountryVatRate = (typeof packs)[CountryCode]['vatRates'][number];
export type CountryTaxSystem = (typeof packs)[CountryCode]['taxSystems'][number];

export const COUNTRY_VAT_RATES = [...new Set<CountryVatRate>(Object.values(packs).flatMap<CountryVatRate>(pack => [...pack.vatRates]))];
// Prefer RU's legacy label when the same rate is present in more than one pack.
export const COUNTRY_VAT_LABELS = Object.assign({}, ...Object.values(packs).reverse().map(pack => pack.vatRateLabels)) as Record<CountryVatRate, string>;
export const COUNTRY_TAX_SYSTEMS = [...new Set<CountryTaxSystem>(Object.values(packs).flatMap<CountryTaxSystem>(pack => [...pack.taxSystems]))];

export function getCountryPack(code?: string | null): CountryPack {
  return COUNTRY_CODES.some(country => country === code) ? packs[code as CountryCode] : packs.RU;
}
