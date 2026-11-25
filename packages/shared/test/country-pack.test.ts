import { expect, test } from 'bun:test';
import * as shared from '../src';

test('the country registry keeps the RU defaults and print forms', () => {
  const { getCountryPack, PRINT_FORMS } = shared;
  expect(getCountryPack()).toBe(getCountryPack('RU'));
  expect(getCountryPack(null)).toBe(getCountryPack('RU'));
  expect(getCountryPack('unknown')).toBe(getCountryPack('RU'));
  expect(getCountryPack('RU')).toMatchObject({ currency: 'RUB', defaultVatRate: '20', printFormIds: PRINT_FORMS });
  expect(shared.VAT_RATES).toEqual(['none', '0', '5', '7', '10', '20']);
  expect(shared.formAllowedFor('invoice', 'contract_invoice', 'RU')).toBe(true);
  expect(shared.formAllowedFor('invoice', 'invoice', 'KZ')).toBe(false);
  expect(getCountryPack('KZ')).toMatchObject({ currency: 'KZT', vatRates: ['none', '0', '16'], defaultVatRate: '16' });
  expect(getCountryPack('AE')).toMatchObject({ currency: 'AED', vatRates: ['none', '0', '5'], defaultVatRate: '5' });
});

test('KZ BIN/IIN performs both checksum passes', () => {
  const { isValidBinIin } = shared;
  expect(isValidBinIin('900101350122')).toBe(true);
  expect(isValidBinIin('000000000016')).toBe(false);
  expect(isValidBinIin('000000000101')).toBe(true);
  expect(isValidBinIin('000000000103')).toBe(false);
  expect(isValidBinIin('000000002810')).toBe(false);
});

test('KZ and AE IBAN check both format and mod 97', () => {
  const { isValidKzIban, isValidAeIban } = shared;
  expect(isValidKzIban('KZ86125KZT5004100100')).toBe(true);
  expect(isValidKzIban('KZ87125KZT5004100100')).toBe(false);
  expect(isValidKzIban('KZ8A125KZT5004100100')).toBe(false);
  expect(isValidAeIban('AE070331234567890123456')).toBe(true);
  expect(isValidAeIban('AE070331234567890123457')).toBe(false);
  expect(isValidAeIban('AE07033123456789012345A')).toBe(false);
});

test('AE TRN consists of 15 digits', () => {
  expect(shared.isValidTrn('100123456789012')).toBe(true);
  expect(shared.isValidTrn('10012345678901')).toBe(false);
  expect(shared.isValidTrn('10012345678901A')).toBe(false);
});

test('KZT and AED amounts use their respective units and round minor units', () => {
  expect(shared.amountInWordsKzt('1234.50')).toBe('одна тысяча двести тридцать четыре тенге 50 тиын');
  expect(shared.amountInWordsKzt('-0.995')).toBe('минус один тенге 00 тиын');
  expect(shared.amountInWordsAed(1234.5)).toBe('One thousand two hundred thirty-four dirhams and 50 fils');
  expect(shared.amountInWordsAed('0.995')).toBe('One dirham and 00 fils');
});

test('document totals support 16%, 5% and decimal percentages', () => {
  const { totals } = shared.computeDocument(['16', '5', '2.5'].map(vatRate => ({ qty: '1', price: '100', vatRate })), false);
  expect(totals).toMatchObject({ net: '300.00', vat: '23.50', total: '323.50' });
  expect(totals.byRate.map(({ rate, vat }) => [rate, vat])).toEqual([['2.5', '2.50'], ['5', '5.00'], ['16', '16.00']]);
  expect(shared.computeDocument([{ qty: '1', price: '102.50', vatRate: '2.5' }], true).totals.vat).toBe('2.50');
});

test('organization creation defaults are country-specific and updates remain partial', () => {
  expect(shared.organizationCreate.parse({ name: 'KZ', country: 'KZ' })).toMatchObject({ country: 'KZ', taxSystem: 'our', defaultVatRate: '16', requisites: {} });
  expect(shared.organizationCreate.parse({ name: 'AE', country: 'AE' })).toMatchObject({ country: 'AE', taxSystem: 'standard', defaultVatRate: '5' });
  expect(shared.organizationCreate.safeParse({ name: 'KZ', country: 'KZ', defaultVatRate: '20' }).success).toBe(false);
  expect(shared.organizationUpdate.parse({ name: 'Updated' })).toEqual({ name: 'Updated' });
});

test('country requisites reject keys from other countries and invalid checksums', () => {
  const schema = shared.getCountryPack('KZ').requisitesSchema;
  expect(schema.parse({ binIin: '900101350122', kbe: '17', knp: '851' })).toEqual({ binIin: '900101350122', kbe: '17', knp: '851' });
  expect(schema.safeParse({ binIin: '900101350124' }).success).toBe(false);
  expect(schema.safeParse({ trn: '100123456789012' }).success).toBe(false);
  expect(schema.safeParse({ bik: 'HSBKKZKX', kbe: '17', knp: '710' }).success).toBe(true);
  expect(schema.safeParse({ bik: 'HSBKKZK', kbe: '171', knp: '71' }).success).toBe(false);
  expect(shared.companyCreate.safeParse({ name: 'AE customer', country: 'AE', requisites: { trn: '100123456789012' } }).success).toBe(true);
  expect(shared.companyCreate.safeParse({ name: 'RU customer', requisites: { trn: '100123456789012' } }).success).toBe(false);
});
