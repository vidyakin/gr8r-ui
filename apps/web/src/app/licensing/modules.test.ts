/* Каталог модулей покрывает интерфейс: каждый раздел меню и каждый пункт настроек отнесён к модулю (docs/architecture/licensing.md) */
import { describe, expect, test } from 'bun:test';
import { MODULE_IDS, MODULE_OF_SECTION, MODULE_OF_SETTING, moduleOfSectionPath } from '@gr8r/shared';
import { en } from '@/i18n/en';
import { ru } from '@/i18n/ru';
import { SET_NAV } from '../settings/nav';
import { SECTIONS } from '../routes';

describe('licensing: интерфейс', () => {
  test('каждый раздел меню принадлежит модулю', () => {
    for (const id of Object.keys(SECTIONS)) expect(MODULE_OF_SECTION.get(id), `раздел ${id}`).toBeTruthy();
    for (const id of MODULE_OF_SECTION.keys()) expect(Object.keys(SECTIONS), `раздел ${id}`).toContain(id);
  });

  test('пункты настроек: всё, что в каталоге, существует в SET_NAV', () => {
    const ids = SET_NAV.flatMap(g => g[1].map(i => i[0]));
    for (const id of MODULE_OF_SETTING.keys()) expect(ids, `настройка ${id}`).toContain(id);
  });

  test('модуль адреса: самый длинный путь раздела', () => {
    const paths = Object.fromEntries(Object.entries(SECTIONS).map(([id, s]) => [id, s.path]));
    expect(moduleOfSectionPath('/crm/deals/123', paths)).toBe('crm');
    expect(moduleOfSectionPath('/production/needs', paths)).toBe('production');
    expect(moduleOfSectionPath('/crm/companies', paths)).toBeNull(); // справочник контрагентов — ядро
    expect(moduleOfSectionPath('/tasks', paths)).toBeNull();
  });

  test('у каждого модуля есть название и описание в обоих языках', () => {
    for (const id of MODULE_IDS) {
      expect(en.licensing.modules[id].name).toBeTruthy();
      expect(ru.licensing.modules[id].description).toBeTruthy();
    }
  });
});
