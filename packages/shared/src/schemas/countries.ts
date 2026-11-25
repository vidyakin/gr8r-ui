import { z } from 'zod';
import { COUNTRY_CODES, COUNTRY_TAX_SYSTEMS, COUNTRY_VAT_RATES, getCountryPack, type CountryCode, type CountryRequisites } from '../countries';

export const countryCode = z.enum(COUNTRY_CODES);
export const countryVatRate = z.enum(COUNTRY_VAT_RATES);
export const countryTaxSystem = z.enum(COUNTRY_TAX_SYSTEMS);

export const countryRequisiteFields = {
  country: countryCode.default('RU'),
  requisites: z.record(z.string(), z.string().trim().max(64)).default({}),
};

export function checkCountryRequisites(value: { country: CountryCode; requisites: CountryRequisites }, ctx: z.RefinementCtx) {
  const result = getCountryPack(value.country).requisitesSchema.safeParse(value.requisites);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({ ...issue, path: ['requisites', ...issue.path] });
    }
  }
}
