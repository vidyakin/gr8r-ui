/* Сборка ZIP-архива (выгрузка счетов): в архиве по файлу на счёт, содержимое совпадает, CRC сходится. */
import { describe, expect, test } from 'bun:test';
import { createZip } from '../src/pdf/zip';
import { readZip } from './zip-reader';

describe('zip archive', () => {
  test('holds one file per entry and unpacks back to the same bytes', () => {
    const a = new TextEncoder().encode('%PDF-1.4 счёт №1');
    const b = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02]);
    const zip = createZip([
      { name: 'СЧ-2026-00001.pdf', data: a },
      { name: 'СЧ-2026-00002.pdf', data: b },
    ]);
    const entries = readZip(zip);
    expect(entries.map(e => e.name)).toEqual(['СЧ-2026-00001.pdf', 'СЧ-2026-00002.pdf']);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('%PDF-1.4 счёт №1');
    expect([...entries[1]!.data]).toEqual([...b]);
  });

  test('compresses what is compressible and keeps the same bytes', () => {
    const text = new TextEncoder().encode('счёт '.repeat(500));
    const zip = createZip([{ name: 'big.pdf', data: text }]);
    const [entry] = readZip(zip);
    expect(entry!.method).toBe(8); // deflate
    expect(zip.length).toBeLessThan(text.length);
    expect(new TextDecoder().decode(entry!.data)).toBe(new TextDecoder().decode(text));
  });

  test('an empty archive is still a valid ZIP', () => {
    expect(readZip(createZip([]))).toEqual([]);
  });
});
