/* Русский словарь: форма обязана совпадать с ../en (Widen), иначе ошибка типов */
import { automations } from './automations';
import { catalog, enums } from './catalog';
import { common, dates, ui } from './common';
import { crm } from './crm';
import { errors } from './errors';
import { meta } from './meta';
import { nav, projectTabs, sections } from './nav';
import { languages, settings } from './settings';

export const ru = { common, dates, ui, sections, projectTabs, nav, settings, languages, catalog, enums, errors, crm, automations, meta };
