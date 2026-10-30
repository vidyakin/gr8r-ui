/* Общее для docs:check, docs:verify и теста покрытия: чтение статей пользовательской документации (docs/user). */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseHeader, type Frontmatter } from '../packages/docs/src/header';

export const ROOT = resolve(import.meta.dir, '..');
export const DOCS_DIR = join(ROOT, 'docs/user');
const ROUTES_FILE = join(ROOT, 'apps/web/src/app/routes.ts');

export type { Frontmatter };

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

/** Статья: путь, папка и разбор шапки (сам разбор — пакет @gr8r/docs, его же использует приложение) */
export function parseArticle(file: string, text: string): Article {
  const rel = relative(DOCS_DIR, join(ROOT, file)).split('/');
  return { file, folder: rel.length > 1 ? rel[0]! : '', howto: rel[0] === 'howto', ...parseHeader(text) };
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
