/* Обёртка с default export для острова Astro */
import { DEFAULT_LOCALE, type Locale } from '../i18n';
import { LeadForm } from '../LeadForm';

export default function LeadFormIsland({ locale = DEFAULT_LOCALE }: { locale?: Locale }) {
  return <LeadForm locale={locale} />;
}
