/* Английский словарь — источник ключей. Новый модуль: свой файл-неймспейс здесь и в ../ru */
import { catalog, enums } from './catalog';
import { common, dates, ui } from './common';
import { errors } from './errors';
import { nav, projectTabs, sections } from './nav';
import { overlays } from './overlays';
import { pages } from './pages';
import { languages, settings } from './settings';

export const en = { common, dates, ui, sections, projectTabs, nav, settings, languages, catalog, enums, errors, overlays, pages };
