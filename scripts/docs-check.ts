/* bun run docs:check [--strict] — проверка пользовательской документации docs/user.
   Ошибки (код выхода 1): битая шапка, неизвестные id разделов и модули, битые ссылки и картинки, источники без файлов, лишняя папка.
   Предупреждения: статья устарела (файлы из sources менялись в git после verified), раздел без статьи.
   --strict делает предупреждения ошибками. Правила — docs/user/README.md. */
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { Glob } from 'bun';
import { MODULE_IDS } from '@gr8r/shared';
import { type Article, DOCS_DIR, EXTRA_FOLDERS, git, listArticles, navGroupIds, readPending, ROOT, sectionIds } from './docs-lib';

const strict = process.argv.includes('--strict');
const errors: string[] = [];
const warnings: string[] = [];
const err = (a: Article, msg: string) => errors.push(`${a.file}: ${msg}`);

const articles = listArticles();
const sections = new Set(sectionIds());
const folders = new Set(['howto', ...navGroupIds(), ...EXTRA_FOLDERS]);
const modules = new Set<string>(MODULE_IDS);

/** Ссылки и картинки вне блоков кода */
function links(body: string): string[] {
  const text = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map(m => m[1]!);
}

function checkLinks(a: Article) {
  for (const href of links(a.body)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
    if (href.startsWith('/')) {
      err(a, `ссылка «${href}» абсолютная — нужна относительная`);
      continue;
    }
    const target = resolve(dirname(join(ROOT, a.file)), decodeURIComponent(href.split('#')[0]!.split('?')[0]!));
    if (!existsSync(target)) err(a, `битая ссылка «${href}»: нет файла ${relative(ROOT, target)}`);
  }
}

function checkHeader(a: Article) {
  if (!a.hasHeader) return err(a, 'нет шапки (--- … ---)');
  for (const e of a.errors) err(a, e);
  const { fm } = a;
  if (!fm.title) err(a, 'в шапке нет title');
  if (!a.howto && !fm.sections.length) err(a, 'в шапке нет sections: статья раздела должна называть хотя бы один раздел');
  for (const id of fm.sections) if (!sections.has(id)) err(a, `sections: неизвестный раздел «${id}» (нет в SECTIONS apps/web/src/app/routes.ts)`);
  if (!a.howto && !fm.module) err(a, 'в шапке нет module (модуль из каталога лицензий)');
  if (fm.module && !modules.has(fm.module)) err(a, `module: «${fm.module}» нет в каталоге лицензий (${[...modules].join(', ')})`);
  if (!folders.has(a.folder)) err(a, `папка «${a.folder || '(корень)'}» не из списка: ${[...folders].join(', ')}`);
  for (const key of fm.screenshots) if (!existsSync(join(DOCS_DIR, 'img', `${key}.png`))) err(a, `screenshots: нет файла docs/user/img/${key}.png`);
  for (const pat of fm.sources) if ([...new Glob(pat).scanSync({ cwd: ROOT })].length === 0) err(a, `sources: по глобу «${pat}» нет ни одного файла`);
}

interface Stale {
  article: Article;
  reason: string;
  commits: string[];
}

function checkStale(a: Article): Stale | null {
  const { verified, sources } = a.fm;
  if (!sources.length) return null;
  if (!verified) return { article: a, reason: 'нет verified — статья не сверена с кодом', commits: [] };
  if (!git(['cat-file', '-e', `${verified}^{commit}`]).ok) {
    err(a, `verified: коммита «${verified}» нет в репозитории`);
    return null;
  }
  const specs = sources.map(s => `:(glob)${s}`);
  const changed = git(['log', '--format=%H %h %s', `${verified}..HEAD`, '--', ...specs]);
  if (!changed.ok || !changed.out) return null;
  // коммит, который правил и источник, и саму статью, считается сверенным
  const own = new Set(git(['log', '--format=%H', `${verified}..HEAD`, '--', a.file]).out.split('\n').filter(Boolean));
  const commits = changed.out
    .split('\n')
    .filter(l => !own.has(l.split(' ')[0]!))
    .map(l => l.split(' ').slice(1).join(' '));
  return commits.length ? { article: a, reason: 'код менялся после проверки', commits } : null;
}

for (const a of articles) {
  checkHeader(a);
  checkLinks(a);
}

const stale = articles.map(checkStale).filter((s): s is Stale => !!s);

// Покрытие разделов
const covered = new Set(articles.flatMap(a => a.fm.sections));
const pending = readPending().sections;
for (const id of pending) {
  if (!sections.has(id)) errors.push(`docs/user/pending.json: неизвестный раздел «${id}»`);
  else if (covered.has(id)) warnings.push(`docs/user/pending.json: раздел «${id}» уже описан — уберите его из списка`);
}
const uncovered = [...sections].filter(id => !covered.has(id) && !pending.includes(id));
const waiting = [...sections].filter(id => !covered.has(id) && pending.includes(id));

// Вывод
const out = (s = '') => console.log(s);
out(`Документация docs/user: статей ${articles.length} (разделов ${articles.filter(a => !a.howto).length}, сценариев ${articles.filter(a => a.howto).length}), разделов приложения ${sections.size}.`);

if (stale.length) {
  out('\nУстарели (проверьте статью по коду, исправьте и запустите bun run docs:verify <файл>):');
  for (const s of stale) {
    out(`  • ${s.article.file} — ${s.reason}`);
    for (const c of s.commits.slice(0, 5)) out(`      ${c}`);
    if (s.commits.length > 5) out(`      … и ещё ${s.commits.length - 5}`);
  }
}
if (uncovered.length) out(`\nРазделы без статьи и не в pending.json (${uncovered.length}):\n  ${uncovered.join(', ')}`);
if (waiting.length) out(`\nЖдут написания (pending.json): ${waiting.length}`);
for (const w of warnings) out(`  ! ${w}`);

if (errors.length) {
  out('\nОшибки:');
  for (const e of errors) out(`  ✗ ${e}`);
}

const warnCount = stale.length + uncovered.length + warnings.length;
const fail = errors.length > 0 || (strict && warnCount > 0);
out(fail ? `\nИтог: НЕ ПРОЙДЕНО (ошибок ${errors.length}, предупреждений ${warnCount}${strict ? ', режим --strict' : ''}).` : `\nИтог: ок (предупреждений ${warnCount}).`);
process.exit(fail ? 1 : 0);
