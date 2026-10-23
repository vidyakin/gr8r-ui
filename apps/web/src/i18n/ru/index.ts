/* Русский словарь: форма обязана совпадать с ../en (Widen), иначе ошибка типов */
import { catalog, enums } from './catalog';
import { common, dates, ui } from './common';
import { docs } from './docs';
import { errors } from './errors';
import { nav, projectTabs, sections } from './nav';
import { production, productionEnums } from './production';
import { languages, settings } from './settings';

export const ru = { common, dates, ui, sections, projectTabs, nav, settings, languages, catalog, enums, production, productionEnums, docs, errors };
