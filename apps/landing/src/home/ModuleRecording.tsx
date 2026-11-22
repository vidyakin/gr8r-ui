/* Остров: «запись» модуля из реестра (используется страницей модуля) */
import { DEFAULT_LOCALE, type Locale } from '../i18n';
import { Recording } from '../demo/player';
import { SCENES, type ModuleId } from '../demo/registry';

export default function ModuleRecording({ id, label, caption, locale = DEFAULT_LOCALE }: { id: ModuleId; label: string; caption: string; locale?: Locale }) {
  const scene = SCENES[id];
  return scene ? <Recording scene={scene} label={label} caption={caption} locale={locale} /> : null;
}
