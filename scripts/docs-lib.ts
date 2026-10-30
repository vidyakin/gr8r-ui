/* Общее для docs:check, docs:verify и теста покрытия: чтение статей пользовательской документации (docs/user). */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dir, '..');
export const DOCS_DIR = join(ROOT, 'docs/user');
const ROUTES_FILE = join(ROOT, 'apps/web/src/app/routes.ts');

export interface Frontmatter {
  title?: string;
  sections: string[];
  module?: string;
  sources: string[];
  verified?: string;
  screenshots: string[];
}

export interface Article {
  /** путь от корня репозитория */
  file: string;
  /** папка внутри docs/user (первая часть пути) */
  folder: string;
  howto: boolean;
  fm: Frontmatter;
  /** текст после шапки */
  body: string;
  /** есть ли шапка вообще */
  hasHeader: boolean;
  /** ошибки разбора шапки */
  errors: string[];
}

const unquote = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, '$2');
const LIST_KEYS = ['sections', 'sources', 'screenshots'] as const;
type ListKey = (typeof LIST_KEYS)[number];
const isListKey = (k: string): k is ListKey => (LIST_KEYS as readonly string[]).includes(k);

/** Шапка: `key: значение`, `key: [a, b]` или список строк `- a` под ключом. Остальное — ошибка. */
export function parseArticle(file: string, text: string): Article {
  const rel = relative(DOCS_DIR, join(ROOT, file)).split('/');
  const art: Article = {
    file,
    folder: rel.length > 1 ? rel[0]! : '',
    howto: rel[0] === 'howto',
    fm: { sections: [], sources: [], screenshots: [] },
    body: text,
    hasHeader: false,
    errors: [],
  };
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return art;
  art.hasHeader = true;
  art.body = text.slice(m[0].length);
  const known = ['title', 'sections', 'module', 'sources', 'verified', 'screenshots'];
  let key: string | null = null;
  for (const raw of m[1]!.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item) {
      if (key && isListKey(key)) art.fm[key].push(unquote(item[1]!));
      else art.errors.push(`лишний элемент списка: «${raw.trim()}»`);
      continue;
    }
    const kv = /^([a-z_]+):\s*(.*)$/.exec(raw);
    if (!kv) {
      art.errors.push(`не разобрана строка шапки: «${raw.trim()}»`);
      continue;
    }
    key = kv[1]!;
    const val = kv[2]!.trim();
    if (!known.includes(key)) {
      art.errors.push(`неизвестное поле шапки «${key}»`);
      key = null;
    } else if (isListKey(key)) {
      if (val.startsWith('[')) {
        if (!val.endsWith(']')) art.errors.push(`список «${key}» не закрыт скобкой`);
        const inner = val.replace(/^\[/, '').replace(/\]$/, '').trim();
        art.fm[key].push(...(inner ? inner.split(',').map(unquote).filter(Boolean) : []));
        key = null;
      } else if (val) art.errors.push(`поле «${key}» — список: [a, b] или строки «- a»`);
    } else if (val) (art.fm as unknown as Record<string, string>)[key] = unquote(val);
  }
  return art;
}

/** Все статьи (без README, шаблонов `_…` и служебных папок) */
export function listArticles(): Article[] {
  const out: Article[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('_') || name.startsWith('.') || name === 'img') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.md') && !(dir === DOCS_DIR && name === 'README.md')) out.push(parseArticle(relative(ROOT, p), readFileSync(p, 'utf8')));
    }
  };
  if (existsSync(DOCS_DIR)) walk(DOCS_DIR);
  return out;
}

/** Строки routes.ts между `export const <name> = {` и закрывающей `} satisfies` */
function routesBlock(name: string): string[] {
  const lines = readFileSync(ROUTES_FILE, 'utf8').split('\n');
  const start = lines.findIndex(l => l.startsWith(`export const ${name} = {`));
  if (start < 0) throw new Error(`в routes.ts нет ${name}`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('} satisfies'));
  return lines.slice(start + 1, end);
}

/** id разделов из SECTIONS (разбор текста routes.ts без запуска интерфейса) */
export const sectionIds = (): string[] => routesBlock('SECTIONS').flatMap(l => /^ {2}(\w+): \{ path:/.exec(l)?.[1] ?? []);

/** Ключи групп меню из NAV_GROUPS */
export const navGroupIds = (): string[] => routesBlock('NAV_GROUPS').flatMap(l => /^ {2}(\w+): \{/.exec(l)?.[1] ?? []);

/** Папки статей вне групп меню (см. docs/user/README.md) */
export const EXTRA_FOLDERS = ['general', 'crm', 'catalog', 'automations'];

export interface Pending {
  sections: string[];
}
export function readPending(): Pending {
  const f = join(DOCS_DIR, 'pending.json');
  if (!existsSync(f)) return { sections: [] };
  const j = JSON.parse(readFileSync(f, 'utf8')) as Partial<Pending>;
  return { sections: j.sections ?? [] };
}

export function git(args: string[]): { ok: boolean; out: string } {
  const r = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  return { ok: r.exitCode === 0, out: r.stdout.toString().trim() };
}
