import { expect, test } from 'bun:test';

for (const file of ['crm', 'leads', 'documents', 'v1/catalog', 'v1/documents', 'pipelines']) {
  test(`${file} applies a field mask to responses`, async () => {
    const source = await Bun.file(new URL(`../src/routes/${file}.ts`, import.meta.url)).text();
    expect(source).toMatch(/import\s*\{[^}]*\bmask(?:Fields|Rows)\b[^}]*\}\s*from\s*'@erp\/shared'/);
    expect(source).toMatch(/\bmask(?:Fields|Rows)\(/);
  });
}

for (const file of ['crm', 'leads', 'documents', 'v1/documents']) {
  test(`${file} rejects writes to hidden fields`, async () => {
    const source = await Bun.file(new URL(`../src/routes/${file}.ts`, import.meta.url)).text();
    expect(source).toMatch(/import\s*\{[^}]*\bassertNoHiddenFieldWrite\b[^}]*\}\s*from\s*'@erp\/shared'/);
    expect(source).toMatch(/\bassertNoHiddenFieldWrite\(/);
  });
}
