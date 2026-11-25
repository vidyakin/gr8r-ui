import { amountInWordsRu, isValidInn, isValidKpp, isValidOgrn, TAX_SYSTEMS } from '../../ru';
import { makeRequisitesSchema, type CountryPack, type RequisiteField } from '../types';
import { PRINT_FORMS } from './print-forms';
import { VAT_RATES } from './vat';

const requisiteFields = [
  { key: 'inn', label: 'INN', mask: '0000000000 / 000000000000', maxLength: 12, numeric: true, validate: isValidInn },
  { key: 'kpp', label: 'KPP', mask: '0000AA000', maxLength: 9, validate: isValidKpp },
  { key: 'ogrn', label: 'OGRN / OGRNIP', mask: '0000000000000 / 000000000000000', maxLength: 15, numeric: true, validate: isValidOgrn },
] satisfies RequisiteField[];

export const ruCountryPack = {
  code: 'RU',
  currency: 'RUB',
  currencySymbol: '₽',
  vatRates: [...VAT_RATES, '22'],
  defaultVatRate: '20',
  vatRateLabels: { none: 'No VAT', '0': '0%', '5': '5%', '7': '7%', '10': '10%', '20': '20%', '22': '22%' },
  amountInWords: amountInWordsRu,
  requisiteFields,
  requisitesSchema: makeRequisitesSchema(requisiteFields),
  taxSystems: TAX_SYSTEMS,
  printFormIds: PRINT_FORMS,
  bankStatementFormat: '1CClientBankExchange',
} as const satisfies CountryPack;
