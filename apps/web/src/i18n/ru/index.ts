/* Русский словарь: форма обязана совпадать с ../en (Widen), иначе ошибка типов */
import { catalog, enums } from './catalog';
import { common, dates, ui } from './common';
import { errors } from './errors';
import { nav, projectTabs, sections } from './nav';
import { overlays } from './overlays';
import { pages } from './pages';
import { languages, settings } from './settings';

export const ru = { common, dates, ui, sections, projectTabs, nav, settings, languages, catalog, enums, errors, overlays, pages };
