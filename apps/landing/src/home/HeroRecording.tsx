/* «Запись» на первом экране: сводка CRM — сделка выигрывается, растёт окупаемость канала */
import { DEFAULT_LOCALE, useI18n, type Locale } from '../i18n';
import { Recording } from '../demo/player';
import { crmScene } from '../demo/CrmScene';

export default function HeroRecording({ locale = DEFAULT_LOCALE }: { locale?: Locale }) {
  const { t } = useI18n(locale);
  return <Recording scene={crmScene} label={t('home.hero.recLabel')} caption={t('home.hero.recCaption')} locale={locale} />;
}
