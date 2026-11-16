/* Реестр «записей» модулей: id модуля → сцена. Модуль без записи (sales, logistics, automations, payroll пока) не указан —
   страница модуля покажет статичный скриншот, а если его нет, блок не рисуется. Новую запись добавляют одной строкой здесь. */
import type { Scene } from './player';
import { tasksScene } from './TasksScene';
import { crmScene } from './CrmScene';
import { docScene } from './DocScene';
import { servicesScene } from './ServicesScene';
import { productionScene } from './ProductionScene';

/** Девять модулей главной — порядок как в переключателе */
export const MODULE_IDS = ['tasks', 'crm', 'docs', 'services', 'production', 'sales', 'logistics', 'automations', 'payroll'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SCENES: Partial<Record<ModuleId, Scene<any>>> = {
  tasks: tasksScene,
  crm: crmScene,
  docs: docScene,
  services: servicesScene,
  production: productionScene,
};
