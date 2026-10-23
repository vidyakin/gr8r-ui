/* Английский словарь — источник ключей. Новый модуль: свой файл-неймспейс здесь и в ../ru */
import { automations } from './automations';
import { catalog, enums } from './catalog';
import { common, dates, ui } from './common';
import { crm } from './crm';
import { docs } from './docs';
import { errors } from './errors';
import { meta } from './meta';
import { nav, projectTabs, sections } from './nav';
import { overlays } from './overlays';
import { pages } from './pages';
import { production, productionEnums } from './production';
import { languages, settings } from './settings';
import { views } from './views';

export const en = { common, dates, ui, sections, projectTabs, nav, settings, languages, catalog, enums, production, productionEnums, docs, errors, crm, automations, meta, views, overlays, pages };
