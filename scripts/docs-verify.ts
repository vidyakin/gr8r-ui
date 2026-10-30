/* bun run docs:verify <файл…> — ставит в шапке статьи `verified` = текущий HEAD (статья сверена с кодом на этом коммите).
   Запускать, когда статья сверена с кодом экрана, перед коммитом статьи: в `verified` попадает HEAD до этого коммита. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, ROOT } from './docs-lib';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Использование: bun run docs:verify docs/user/<папка>/<статья>.md [ещё…]');
  process.exit(2);
}
const head = git(['rev-parse', '--short=10', 'HEAD']);
if (!head.ok) {
  console.error('Не удалось получить HEAD (это не git-репозиторий?).');
  process.exit(2);
}

let bad = 0;
for (const f of files) {
  const p = resolve(process.cwd(), f);
  let text: string;
  try {
    text = readFileSync(p, 'utf8');
  } catch {
    console.error(`  ✗ ${f}: файл не найден`);
    bad++;
    continue;
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) {
    console.error(`  ✗ ${f}: нет шапки (---)`);
    bad++;
    continue;
  }
  const header = m[1]!;
  const next = /^verified:.*$/m.test(header) ? header.replace(/^verified:.*$/m, `verified: ${head.out}`) : `${header}\nverified: ${head.out}`;
  writeFileSync(p, text.replace(header, () => next));
  console.log(`  ✓ ${p.replace(ROOT + '/', '')}: verified = ${head.out}`);
}
process.exit(bad ? 1 : 0);
