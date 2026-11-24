import type { Locale } from '../../i18n';

export type TaskCol = 'backlog' | 'todo' | 'progress' | 'done';

export interface TaskCardData {
  key: string;
  title: string;
  labels: [string, string][];
  prio: number;
  due?: string;
  late?: boolean;
  av: [string, string];
}

export interface TasksDict {
  crumbs: [string, string];
  projectTitle: string;
  statusInProgress: string;
  tabs: [string, string, string, string, string];
  cols: [TaskCol, string][];
  addTask: string;
  inputHint: string;
  initial: Record<TaskCol, TaskCardData[]>;
  newCard: TaskCardData;
}

const c = (key: string, title: string, labels: [string, string][], prio: number, av: [string, string], due?: string, late?: boolean): TaskCardData => ({ key, title, labels, prio, av, due, late });

export const TASKS_DICT: Record<Locale, TasksDict> = {
  ru: {
    crumbs: ['Проекты', 'Сайт мебельной фабрики'],
    projectTitle: 'Сайт мебельной фабрики',
    statusInProgress: 'В работе',
    tabs: ['Обзор', 'Доска', 'Список', 'Таймлайн', 'Файлы'],
    cols: [['backlog', 'Бэклог'], ['todo', 'К выполнению'], ['progress', 'В работе'], ['done', 'Готово']],
    addTask: 'Добавить задачу',
    inputHint: 'Enter — создать · Esc — отмена',
    initial: {
      backlog: [c('WEB-131', 'Тексты для раздела «Доставка»', [['Контент', 'rose']], 3, ['ИВ', '#C48A1E'], '14 нояб.'), c('WEB-133', 'Настроить события аналитики', [['Бэкенд', 'teal']], 5, ['МЛ', '#8662C9'])],
      todo: [c('WEB-136', 'Проверить доступность шаблонов', [['QA', 'green']], 8, ['ЛФ', '#3D8E5F'], '11 нояб.'), c('WEB-138', 'Фото для карточек товаров', [['Контент', 'rose']], 4, ['ИВ', '#C48A1E'], '20 нояб.')],
      progress: [c('WEB-128', 'Перенести каталог', [['Бэкенд', 'teal']], 6, ['МЛ', '#8662C9'], 'Сегодня', true), c('WEB-129', 'Форма заявки на замер', [['Фронтенд', 'blue']], 5, ['АК', '#5A67D8'], '6 нояб.')],
      done: [c('WEB-120', 'Дизайн-токены сайта', [['Дизайн', 'violet']], 3, ['ЕС', '#23918A'], '28 окт.')],
    },
    newCard: c('WEB-142', 'Согласовать макет главной', [['Дизайн', 'violet']], 6, ['АК', '#5A67D8'], '8 нояб.'),
  },
  en: {
    crumbs: ['Projects', 'Furniture factory website'],
    projectTitle: 'Furniture factory website',
    statusInProgress: 'In progress',
    tabs: ['Overview', 'Board', 'List', 'Timeline', 'Files'],
    cols: [['backlog', 'Backlog'], ['todo', 'To do'], ['progress', 'In progress'], ['done', 'Done']],
    addTask: 'Add task',
    inputHint: 'Enter to create · Esc to cancel',
    initial: {
      backlog: [c('WEB-131', 'Copy for the Delivery section', [['Content', 'rose']], 3, ['IV', '#C48A1E'], 'Nov 14'), c('WEB-133', 'Set up analytics events', [['Backend', 'teal']], 5, ['ML', '#8662C9'])],
      todo: [c('WEB-136', 'Audit template accessibility', [['QA', 'green']], 8, ['LF', '#3D8E5F'], 'Nov 11'), c('WEB-138', 'Photos for product cards', [['Content', 'rose']], 4, ['IV', '#C48A1E'], 'Nov 20')],
      progress: [c('WEB-128', 'Migrate product catalog', [['Backend', 'teal']], 6, ['ML', '#8662C9'], 'Today', true), c('WEB-129', 'Measurement request form', [['Frontend', 'blue']], 5, ['AK', '#5A67D8'], 'Nov 6')],
      done: [c('WEB-120', 'Website design tokens', [['Design', 'violet']], 3, ['ES', '#23918A'], 'Oct 28')],
    },
    newCard: c('WEB-142', 'Approve homepage mockup', [['Design', 'violet']], 6, ['AK', '#5A67D8'], 'Nov 8'),
  },
  es: {
    crumbs: ['Proyectos', 'Web de la fábrica de muebles'],
    projectTitle: 'Web de la fábrica de muebles',
    statusInProgress: 'En curso',
    tabs: ['Resumen', 'Tablero', 'Lista', 'Cronograma', 'Archivos'],
    cols: [['backlog', 'Pendiente'], ['todo', 'Por hacer'], ['progress', 'En curso'], ['done', 'Hecho']],
    addTask: 'Añadir tarea',
    inputHint: 'Enter para crear · Esc para cancelar',
    initial: {
      backlog: [c('WEB-131', 'Textos para la sección Envíos', [['Contenido', 'rose']], 3, ['IV', '#C48A1E'], '14 nov'), c('WEB-133', 'Configurar eventos de analítica', [['Backend', 'teal']], 5, ['ML', '#8662C9'])],
      todo: [c('WEB-136', 'Revisar accesibilidad de plantillas', [['QA', 'green']], 8, ['LF', '#3D8E5F'], '11 nov'), c('WEB-138', 'Fotos para fichas de producto', [['Contenido', 'rose']], 4, ['IV', '#C48A1E'], '20 nov')],
      progress: [c('WEB-128', 'Migrar el catálogo', [['Backend', 'teal']], 6, ['ML', '#8662C9'], 'Hoy', true), c('WEB-129', 'Formulario de solicitud de medición', [['Frontend', 'blue']], 5, ['AC', '#5A67D8'], '6 nov')],
      done: [c('WEB-120', 'Tokens de diseño web', [['Diseño', 'violet']], 3, ['ES', '#23918A'], '28 oct')],
    },
    newCard: c('WEB-142', 'Aprobar maqueta de inicio', [['Diseño', 'violet']], 6, ['AC', '#5A67D8'], '8 nov'),
  },
};
