/* Статьи справки (docs/user) собираются в бандл при сборке: без сети. Файл грузится лениво (import() из панели справки и палитры),
   поэтому тексты не попадают в основной чанк. Импортировать его статически нельзя. */
import { buildCatalog } from '@gr8r/docs';

const raw = import.meta.glob(['../../../../../docs/user/**/*.md', '!**/README.md', '!**/_templates/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// Скриншоты docs/user/img/<ключ>.png (делает docs:shots); пока папка пуста — картинок нет
const images = import.meta.glob('../../../../../docs/user/img/*.{png,jpg,jpeg,webp,gif,svg}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export const catalog = buildCatalog(raw);

const imageByName = new Map(Object.entries(images).map(([p, url]) => [p.slice(p.lastIndexOf('/') + 1), url]));
export const imageUrl = (name: string) => imageByName.get(name);
