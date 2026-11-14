import { expect, test } from 'bun:test';
import { pathToHash } from './path-to-hash';

test('прямая ссылка без хеша уходит в хеш', () => {
  expect(pathToHash({ pathname: '/crm/companies/1/prices/2', search: '?q=1', hash: '' })).toBe('/#/crm/companies/1/prices/2?q=1');
});
test('путь перед хешем убирается, хеш главнее', () => {
  expect(pathToHash({ pathname: '/crm/companies/1', search: '', hash: '#/catalog' })).toBe('/#/catalog');
});
test('корень не трогаем', () => {
  expect(pathToHash({ pathname: '/', search: '?x=1', hash: '#/inbox' })).toBeNull();
  expect(pathToHash({ pathname: '/index.html', search: '', hash: '' })).toBeNull();
});
