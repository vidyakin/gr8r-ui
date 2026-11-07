/* Сторож: каждое окно печати из HTML ответа API (blob: text/html) получает meta-CSP через withPrintCsp. */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(import.meta.dir, '..', 'app');
const files = (dir: string): string[] => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));

describe('print windows', () => {
  test('HTML blobs and document.write of fetched pages go through withPrintCsp', () => {
    const offenders: string[] = [];
    for (const f of files(APP)) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/new Blob\(\[([^\]]*)\][^)]*text\/html/g)) if (!m[1]!.includes('withPrintCsp(')) offenders.push(f.slice(APP.length + 1));
      for (const m of s.matchAll(/document\.write\(([^)]*)\)/g)) if (/html\b/.test(m[1]!) && !m[1]!.includes('withPrintCsp(')) offenders.push(f.slice(APP.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});
