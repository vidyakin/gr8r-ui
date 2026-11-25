import { z } from 'zod';

export const COUNTRY_CODES = ['RU', 'KZ', 'AE'] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];
export type CountryRequisites = Record<string, string>;

export interface RequisiteField {
  key: string;
  label: string;
  mask: string;
  maxLength: number;
  numeric?: boolean;
  validate(value: string): boolean;
}

export interface CountryPack {
  code: CountryCode;
  currency: 'RUB' | 'KZT' | 'AED';
  currencySymbol: string;
  vatRates: readonly string[];
  defaultVatRate: string;
  vatRateLabels: Readonly<Record<string, string>>;
  amountInWords(amount: string | number, locale?: string): string;
  requisitesSchema: z.ZodType<CountryRequisites>;
  requisiteFields: readonly RequisiteField[];
  taxSystems: readonly string[];
  printFormIds: readonly string[];
  printFormsByType?: Readonly<Partial<Record<string, readonly string[]>>>;
  bankStatementFormat?: string;
}

export function makeRequisitesSchema(fields: readonly RequisiteField[]): z.ZodType<CountryRequisites> {
  const byKey = new Map(fields.map(field => [field.key, field]));
  return z.record(z.string(), z.string().trim().max(64)).superRefine((values, ctx) => {
    for (const [key, value] of Object.entries(values)) {
      const field = byKey.get(key);
      if (!field || (value && !field.validate(value))) {
        ctx.addIssue({ code: 'custom', path: [key], message: field ? `${field.label}: invalid format or checksum` : 'Unknown requisite for this country' });
      }
    }
  });
}
