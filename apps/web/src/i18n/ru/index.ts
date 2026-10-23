/* Русский словарь: форма обязана совпадать с ../en (Widen), иначе ошибка типов */
import { automations } from './automations';
import { catalog, enums } from './catalog';
import { common, dates, ui } from './common';
import { crm } from './crm';
import { docs } from './docs';
import { errors } from './errors';
import { meta } from './meta';
import { nav, projectTabs, sections } from './nav';
import { production, productionEnums } from './production';
import { languages, settings } from './settings';
import { views } from './views';

export const ru = { common, dates, ui, sections, projectTabs, nav, settings, languages, catalog, enums, production, productionEnums, docs, errors, crm, automations, meta, views };
