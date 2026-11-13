/* «Запись» на первом экране: сводка CRM — сделка выигрывается, растёт окупаемость канала */
import { t } from '../i18n';
import { Recording } from '../demo/player';
import { crmScene } from '../demo/CrmScene';

export default function HeroRecording() {
  return <Recording scene={crmScene} label={t('home.hero.recLabel')} caption={t('home.hero.recCaption')} />;
}
