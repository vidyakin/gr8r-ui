/* Покрытие пользовательской документации (docs/user): у каждого раздела меню есть статья или запись в pending.json.
   Быстрый тест без git; устаревание статей проверяет `bun run docs:check`. */
import { describe, expect, test } from 'bun:test';
import { SECTIONS } from '../app/routes';
import { listArticles, readPending, sectionIds } from '../../../../scripts/docs-lib';

describe('docs/user: покрытие разделов', () => {
  const ids = Object.keys(SECTIONS);
  const articles = listArticles();
  const covered = new Set(articles.flatMap(a => a.fm.sections));
  const pending = readPending().sections;

  test('разбор routes.ts в скрипте совпадает с SECTIONS', () => {
    expect(sectionIds().sort()).toEqual([...ids].sort());
  });

  test('у каждого раздела есть статья или он в docs/user/pending.json', () => {
    const missing = ids.filter(id => !covered.has(id) && !pending.includes(id));
    expect(missing, `нет статьи в docs/user/<группа>/ и записи в pending.json: ${missing.join(', ')}`).toEqual([]);
  });

  test('в статьях и pending нет неизвестных id', () => {
    const unknown = [...covered, ...pending].filter(id => !ids.includes(id));
    expect(unknown).toEqual([]);
  });

  test('написанный раздел убран из pending.json', () => {
    expect(pending.filter(id => covered.has(id))).toEqual([]);
  });
});
