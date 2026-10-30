/* Каталог статей из сырых файлов docs/user: заголовок, группа, поиск, подбор статей раздела. */
import { parseHeader, type Frontmatter } from './header';

export interface DocArticle {
  /** путь без `.md` от docs/user, например `finance/payments` */
  id: string;
  /** первая папка пути: ключ группы */
  group: string;
  title: string;
  fm: Frontmatter;
  /** markdown без шапки */
  body: string;
  /** простой текст для поиска (в нижнем регистре) */
  plain: string;
}

export interface DocGroup {
  key: string;
  title: string;
  articles: DocArticle[];
}

export interface Catalog {
  articles: DocArticle[];
  byId: Map<string, DocArticle>;
}

/** Порядок и названия групп оглавления (папки docs/user) */
export const GROUP_TITLES: [string, string][] = [
  ['general', 'Работа и проекты'],
  ['crm', 'CRM'],
  ['catalog', 'Каталог'],
  ['trade', 'Торговля'],
  ['production', 'Производство'],
  ['services', 'Услуги'],
  ['transport', 'Транспорт'],
  ['finance', 'Финансы'],
  ['automations', 'Автоматизации'],
  ['howto', 'Сценарии «как сделать»'],
];

export const groupTitle = (key: string) => GROUP_TITLES.find(([k]) => k === key)?.[1] ?? key;

/** Убирает разметку: для поиска и сниппетов */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#|]/g, ' ')
    .replace(/^\s*[-+]\s+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** raw: путь (в любом виде, важна часть после `docs/user/`) → текст файла. README и шаблоны пропускаются */
export function buildCatalog(raw: Record<string, string>): Catalog {
  const articles: DocArticle[] = [];
  for (const [path, text] of Object.entries(raw)) {
    const rel = path.includes('docs/user/') ? path.slice(path.lastIndexOf('docs/user/') + 'docs/user/'.length) : path.replace(/^\.?\//, '');
    if (!rel.endsWith('.md') || rel === 'README.md' || rel.split('/').some(s => s.startsWith('_'))) continue;
    const id = rel.slice(0, -3);
    const h = parseHeader(text);
    const title = h.fm.title ?? /^#\s+(.+)$/m.exec(h.body)?.[1]?.trim() ?? id;
    const plain = plainText(h.body);
    articles.push({ id, group: id.includes('/') ? id.split('/')[0]! : '', title, fm: h.fm, body: h.body, plain: plain.toLowerCase() });
  }
  articles.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return { articles, byId: new Map(articles.map(a => [a.id, a])) };
}

/** Оглавление по группам; keep — фильтр статей (например, по включённым модулям) */
export function tocOf(cat: Catalog, keep: (a: DocArticle) => boolean = () => true): DocGroup[] {
  const known = new Set(GROUP_TITLES.map(([k]) => k));
  const keys = [...GROUP_TITLES.map(([k]) => k), ...new Set(cat.articles.map(a => a.group).filter(g => !known.has(g)))];
  return keys.map(key => ({ key, title: groupTitle(key), articles: cat.articles.filter(a => a.group === key && keep(a)) })).filter(g => g.articles.length);
}

/** Статьи раздела приложения (поле `sections` шапки) */
export const articlesOfSection = (cat: Catalog, sectionId: string, keep: (a: DocArticle) => boolean = () => true) =>
  cat.articles.filter(a => a.fm.sections.includes(sectionId) && keep(a));

export interface SearchHit {
  article: DocArticle;
  score: number;
  /** фрагмент текста вокруг первого совпадения */
  snippet: string;
}

/** Приставка слова для грубого учёта русских окончаний */
const stem = (w: string) => (w.length > 5 ? w.slice(0, w.length - 2) : w);

/** Простой поиск: все слова запроса должны встретиться в заголовке или тексте; заголовок весит больше */
export function searchDocs(cat: Catalog, query: string, keep: (a: DocArticle) => boolean = () => true, limit = 30): SearchHit[] {
  const words = query.toLowerCase().split(/[\s,.;:!?«»"()]+/).filter(Boolean).map(stem);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const a of cat.articles) {
    if (!keep(a)) continue;
    const title = a.title.toLowerCase();
    let score = 0;
    let ok = true;
    for (const w of words) {
      const inTitle = title.includes(w);
      const inText = a.plain.includes(w);
      if (!inTitle && !inText) {
        ok = false;
        break;
      }
      score += (inTitle ? 10 : 0) + (inText ? 1 : 0);
    }
    if (!ok) continue;
    const at = a.plain.indexOf(words[0]!);
    const snippet = at < 0 ? '' : (at > 40 ? '…' : '') + a.plain.slice(Math.max(0, at - 40), at + 100).trim() + '…';
    hits.push({ article: a, score, snippet });
  }
  return hits.sort((x, y) => y.score - x.score || x.article.title.localeCompare(y.article.title, 'ru')).slice(0, limit);
}

/** Раздел приложения по адресу: самый длинный путь раздела, которому принадлежит адрес. `/` — только главная */
export function sectionOfPath(pathname: string, sections: Record<string, { path: string }>): string | null {
  let best: string | null = null;
  let len = -1;
  for (const [id, s] of Object.entries(sections)) {
    const p = s.path;
    const hit = p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(p + '/');
    if (hit && p.length > len) [best, len] = [id, p.length];
  }
  return best;
}
