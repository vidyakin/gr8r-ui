/* Статьи docs/user, собранные в страницу /docs при сборке (те же файлы, что и справка в приложении). Рендер и поиск — пакет @gr8r/docs */
import { buildCatalog } from '@gr8r/docs';

const raw = import.meta.glob(['../../../../docs/user/**/*.md', '!**/README.md', '!**/_templates/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const images = import.meta.glob('../../../../docs/user/img/*.{png,jpg,jpeg,webp,gif,svg}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export const catalog = buildCatalog(raw);

const imageByName = new Map(Object.entries(images).map(([p, url]) => [p.slice(p.lastIndexOf('/') + 1), url]));
export const imageUrl = (name: string) => imageByName.get(name);
