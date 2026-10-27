/* Русский словарь: форма обязана совпадать с ../en (Widen), иначе ошибка типов */
import { automations } from './automations';
import { catalog, enums } from './catalog';
import { common, dates, ui } from './common';
import { crm } from './crm';
import { docs } from './docs';
import { errors } from './errors';
import { finance } from './finance';
import { meta } from './meta';
import { money } from './money';
import { nav, projectTabs, sections } from './nav';
import { overlays } from './overlays';
import { pages } from './pages';
import { production, productionEnums } from './production';
import { serviceReports } from './services';
import { serials } from './serials';
import { delivery } from './delivery';
import { repeat } from './repeat';
import { appt } from './appt';
import { positions } from './positions';
import { languages, settings } from './settings';
import { views } from './views';

export const ru = { common, dates, ui, sections, projectTabs, nav, settings, languages, catalog, enums, production, productionEnums, docs, errors, finance, crm, automations, meta, views, overlays, pages, serviceReports, serials, repeat, appt, delivery, positions, money };
