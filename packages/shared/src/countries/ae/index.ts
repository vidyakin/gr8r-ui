import { splitAmount } from '../amount';
import { ibanChecksumOk, isValidSwiftBic } from '../bank';
import { makeRequisitesSchema, type CountryPack, type RequisiteField } from '../types';

export const isValidAeIban = (value: string) => /^AE\d{21}$/.test(value) && ibanChecksumOk(value);
export const isValidTrn = (value: string) => /^\d{15}$/.test(value);

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion'];

function wordsUnderThousand(n: number): string {
  if (n < 20) return SMALL[n]!;
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)]!;
    return n % 10 ? `${tens}-${SMALL[n % 10]}` : tens;
  }
  const hundreds = `${SMALL[Math.floor(n / 100)]} hundred`;
  return n % 100 ? `${hundreds} ${wordsUnderThousand(n % 100)}` : hundreds;
}

function numberToWordsEn(value: bigint): string {
  if (value === 0n) return 'zero';
  const groups: string[] = [];
  for (let i = 0; value > 0n; i++, value /= 1000n) {
    const scale = SCALES[i];
    if (scale === undefined) throw new RangeError('Number is too large');
    const group = Number(value % 1000n);
    if (group) groups.unshift(wordsUnderThousand(group) + (scale ? ` ${scale}` : ''));
  }
  return groups.join(' ');
}

export function amountInWordsAed(amount: string | number): string {
  const { major, minor, negative } = splitAmount(amount);
  const words = `${negative ? 'minus ' : ''}${numberToWordsEn(major)}`;
  return `${words[0]!.toUpperCase()}${words.slice(1)} ${major === 1n ? 'dirham' : 'dirhams'} and ${String(minor).padStart(2, '0')} ${minor === 1n ? 'fil' : 'fils'}`;
}

const requisiteFields = [
  { key: 'trn', label: 'TRN', mask: '000000000000000', maxLength: 15, numeric: true, validate: isValidTrn },
  { key: 'iban', label: 'IBAN', mask: 'AE000000000000000000000', maxLength: 23, validate: isValidAeIban },
  { key: 'bic', label: 'BIC / SWIFT', mask: 'AAAAAE00XXX', maxLength: 11, validate: isValidSwiftBic },
] satisfies RequisiteField[];

export const aeCountryPack = {
  code: 'AE',
  currency: 'AED',
  currencySymbol: 'AED',
  vatRates: ['none', '0', '5'],
  defaultVatRate: '5',
  vatRateLabels: { none: 'Exempt', '0': '0%', '5': '5%' },
  amountInWords: amountInWordsAed,
  requisiteFields,
  requisitesSchema: makeRequisitesSchema(requisiteFields),
  taxSystems: ['standard', 'exempt'],
  printFormIds: [],
} as const satisfies CountryPack;
