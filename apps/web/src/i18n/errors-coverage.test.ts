/* Сверка кодов ошибок сервера со словарём errors.*: каждый код, который бросают apps/api, packages/db и apps/worker, имеет перевод. */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from './en';
import { ru } from './ru';

const ROOT = join(import.meta.dir, '../../../..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules') continue;
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** Коды, которые бросают DomainError и AppError (литералом вторым аргументом после статуса) */
function thrownCodes(): Set<string> {
  const codes = new Set<string>();
  for (const dir of ['apps/api/src', 'packages/db/src', 'apps/worker/src']) {
    for (const file of sources(join(ROOT, dir))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/(?:DomainError|AppError)\(\s*\d+\s*,\s*['"`]([a-z_0-9]+)['"`]/g)) codes.add(m[1]!);
    }
  }
  return codes;
}

describe('коды ошибок сервера и errors.*', () => {
  const codes = [...thrownCodes()].sort();

  test('коды найдены', () => {
    expect(codes.length).toBeGreaterThan(100);
  });

  test('у каждого кода есть английский и русский текст', () => {
    const missingEn = codes.filter(c => !(c in en.errors));
    const missingRu = codes.filter(c => !(c in ru.errors));
    expect(missingEn, `нет в en/errors.ts: ${missingEn.join(', ')}`).toEqual([]);
    expect(missingRu, `нет в ru/errors.ts: ${missingRu.join(', ')}`).toEqual([]);
  });
});
