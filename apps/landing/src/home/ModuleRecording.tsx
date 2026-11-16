/* Остров: «запись» модуля из реестра (используется страницей модуля) */
import { Recording } from '../demo/player';
import { SCENES, type ModuleId } from '../demo/registry';

export default function ModuleRecording({ id, label, caption }: { id: ModuleId; label: string; caption: string }) {
  const scene = SCENES[id];
  return scene ? <Recording scene={scene} label={label} caption={caption} /> : null;
}
