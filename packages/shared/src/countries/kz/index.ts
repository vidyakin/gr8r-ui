import { numberToWordsRu } from '../../ru';
import { splitAmount } from '../amount';
import { ibanChecksumOk, isValidSwiftBic } from '../bank';
import { makeRequisitesSchema, type CountryPack, type RequisiteField } from '../types';

const secondPassWeights = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];

export function isValidBinIin(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;
  const digits = [...value.slice(0, 11)].map(Number);
  const first = digits.reduce((sum, digit, i) => sum + digit * (i + 1), 0) % 11;
  const checksum = first !== 10
    ? first
    : digits.reduce((sum, digit, i) => sum + digit * secondPassWeights[i]!, 0) % 11;
  return checksum === Number(value[11]);
}

export const isValidKzIban = (value: string) => /^KZ\d{2}[A-Z0-9]{16}$/.test(value) && ibanChecksumOk(value);

export function amountInWordsKzt(amount: string | number, spellMinor = false): string {
  const { major, minor, negative } = splitAmount(amount);
  return `${negative ? 'минус ' : ''}${numberToWordsRu(major)} тенге ${spellMinor ? numberToWordsRu(minor) : String(minor).padStart(2, '0')} тиын`;
}

const requisiteFields = [
  { key: 'binIin', label: 'BIN / IIN', mask: '000000000000', maxLength: 12, numeric: true, validate: isValidBinIin },
  { key: 'iik', label: 'IIK (IBAN)', mask: 'KZ00XXXXXXXXXXXXXXXX', maxLength: 20, validate: isValidKzIban },
  { key: 'bik', label: 'BIC / SWIFT', mask: 'AAAAKZ00XXX', maxLength: 11, validate: isValidSwiftBic },
  { key: 'kbe', label: 'KBe', mask: '00', maxLength: 2, numeric: true, validate: (value: string) => /^\d{2}$/.test(value) },
  { key: 'knp', label: 'KNP', mask: '000', maxLength: 3, numeric: true, validate: (value: string) => /^\d{3}$/.test(value) },
] satisfies RequisiteField[];

const KZ_PRINT_FORMS = ['kz_invoice', 'kz_z2', 'kz_r1', 'kz_tax_invoice', 'kz_pko', 'kz_rko', 'kz_payment_order'] as const;
type KzPrintForm = (typeof KZ_PRINT_FORMS)[number];

const KZ_FORMS_BY_TYPE: Partial<Record<string, readonly KzPrintForm[]>> = {
  quote: ['kz_invoice'],
  customer_order: ['kz_invoice'],
  invoice: ['kz_invoice'],
  realization: ['kz_z2', 'kz_tax_invoice'],
  act: ['kz_r1', 'kz_tax_invoice'],
  work_order: ['kz_invoice', 'kz_r1', 'kz_z2', 'kz_tax_invoice'],
  tolling_report: ['kz_r1'],
  cash_receipt: ['kz_pko'],
  cash_payment: ['kz_rko'],
  bank_payment: ['kz_payment_order'],
};

export const kzCountryPack = {
  code: 'KZ',
  currency: 'KZT',
  currencySymbol: '₸',
  vatRates: ['none', '0', '16'],
  defaultVatRate: '16',
  vatRateLabels: { none: 'No VAT', '0': '0%', '16': '16%' },
  amountInWords: (amount: string | number) => amountInWordsKzt(amount),
  requisiteFields,
  requisitesSchema: makeRequisitesSchema(requisiteFields),
  taxSystems: ['our', 'simplified'],
  printFormIds: KZ_PRINT_FORMS,
  printFormsByType: KZ_FORMS_BY_TYPE,
  bankStatementFormat: '1CClientBankExchange KZ',
} as const satisfies CountryPack;
