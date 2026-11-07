import { describe, expect, test } from 'bun:test';
import { codeParts, parseChangelog } from './parse';

const RAW = `# Журнал доработок

Вступление.

## 2026-11-07
- **Справка** — пункт открывает справку.
- **Агенты и MCP** — запись через MCP: задачи,
  сделки и лиды (1287).

## 2026-10-20
- **Каталог** и **Производство** — категории и \`спецификации\`.
- без модуля
`;

describe('parseChangelog', () => {
  test('days, modules and continued lines', () => {
    const days = parseChangelog(RAW);
    expect(days.map(d => d.date)).toEqual(['2026-11-07', '2026-10-20']);
    expect(days[0]!.items).toEqual([
      { module: 'Справка', text: 'пункт открывает справку.' },
      { module: 'Агенты и MCP', text: 'запись через MCP: задачи, сделки и лиды (1287).' },
    ]);
    expect(days[1]!.items[0]).toEqual({ module: 'Каталог и Производство', text: 'категории и `спецификации`.' });
    expect(days[1]!.items[1]).toEqual({ module: '', text: 'без модуля' });
  });

  test('the real changelog parses', async () => {
    const raw = await Bun.file(new URL('../../../../../docs/changelog.md', import.meta.url)).text();
    const days = parseChangelog(raw);
    expect(days.length).toBeGreaterThan(5);
    for (const d of days) {
      expect(d.items.length).toBeGreaterThan(0);
      for (const i of d.items) expect(i.module).not.toBe('');
    }
  });

  test('code parts', () => {
    expect(codeParts('адрес `/api/mcp` и всё')).toEqual([
      { code: false, s: 'адрес ' },
      { code: true, s: '/api/mcp' },
      { code: false, s: ' и всё' },
    ]);
  });
});
