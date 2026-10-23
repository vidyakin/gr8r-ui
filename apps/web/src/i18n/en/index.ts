/* Английский словарь — источник ключей. Новый модуль: свой файл-неймспейс здесь и в ../ru */
import { automations } from './automations';
import { catalog, enums } from './catalog';
import { common, dates, ui } from './common';
import { crm } from './crm';
import { errors } from './errors';
import { meta } from './meta';
import { nav, projectTabs, sections } from './nav';
import { languages, settings } from './settings';

export const en = { common, dates, ui, sections, projectTabs, nav, settings, languages, catalog, enums, errors, crm, automations, meta };
