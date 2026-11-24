import type { Locale } from '../../i18n';

export type AutoCat = 'trigger' | 'flow' | 'action';

export interface PaletteGroup {
  cat: AutoCat;
  name: string;
  items: { id: string; label: string; icon: 'create' | 'field' | 'cron' | 'if' | 'wait' | 'update' | 'task' | 'notify' | 'http'; demo?: string }[];
}

export interface AutomationsDict {
  crumbs: [string, string];
  scenarioTitle: string;
  typedTitle: string;
  projectName: string;
  projectId: string;
  palette: PaletteGroup[];
  paletteHelp: string;
  triggerNodeTitle: string;
  actionNodeTitle: string;
  triggerDesc: string;
  entityLabel: string;
  entityVal: string;
  fieldLabel: string;
  fieldVal: string;
  fromLabel: string;
  fromPh: string;
  toLabel: string;
  toVal: string;
  stepIdHint: string;
  actionDesc: string;
  projectLabel: string;
  projectPh: string;
  requiredErr: string;
  titleLabel: string;
  titleHint: string;
  assigneeLabel: string;
  assigneePh: string;
  statusLabel: string;
  deleteStep: string;
  activeBadge: string;
  draftBadge: string;
  issuesCount: (n: number) => string;
  graphValid: string;
  enabled: string;
  saveDraft: string;
  publish: string;
  tabs: [string, string];
  toastPublished: string;
  badgeOk: string;
  badgeRunning: string;
  allRuns: string;
  errorsOnly: string;
  justNow: string;
  runSub: (done: boolean) => string;
  runMeta: (done: boolean) => string;
  ms12: string;
  s03: string;
  inputLabel: string;
  outputLabel: string;
  step2TitleSample: string;
}

const PROJECT_ID = '0192f4a8-71c3-7e5b-9d20-3a1c5e8b';

export const AUTOMATIONS_DICT: Record<Locale, AutomationsDict> = {
  ru: {
    crumbs: ['Платформа', 'Автоматизации'],
    scenarioTitle: 'Сделка выиграна → задача в работу',
    typedTitle: 'Передать в работу: {{trigger.record.name}}',
    projectName: 'Заказы клиентов',
    projectId: PROJECT_ID,
    palette: [
      { cat: 'trigger', name: 'Триггер', items: [{ id: 'create', label: 'Создана запись', icon: 'create' }, { id: 'field', label: 'Изменено поле', icon: 'field' }, { id: 'cron', label: 'По расписанию', icon: 'cron' }] },
      { cat: 'flow', name: 'Логика', items: [{ id: 'if', label: 'Условие', icon: 'if' }, { id: 'wait', label: 'Пауза', icon: 'wait' }] },
      { cat: 'action', name: 'Действие', items: [{ id: 'update', label: 'Изменить поле', icon: 'update' }, { id: 'task', label: 'Создать задачу', icon: 'task', demo: 'pal-task' }, { id: 'notify', label: 'Уведомить участника', icon: 'notify' }, { id: 'http', label: 'HTTP-запрос', icon: 'http' }] },
    ],
    paletteHelp: 'Нажмите, чтобы добавить шаг после выбранного, или перетащите его на холст.',
    triggerNodeTitle: 'Изменено поле',
    actionNodeTitle: 'Создать задачу',
    triggerDesc: 'Запускается, когда меняется поле записи — при желании только на определённое значение.',
    entityLabel: 'Сущность',
    entityVal: 'Сделка',
    fieldLabel: 'Поле',
    fieldVal: 'Этап',
    fromLabel: 'Было (необязательно)',
    fromPh: 'Любой этап',
    toLabel: 'Стало (необязательно)',
    toVal: 'Выиграна',
    stepIdHint: 'Идентификатор шага: trigger — используйте {{steps.trigger.…}} в следующих шагах.',
    actionDesc: 'Создаёт задачу в проекте.',
    projectLabel: 'Проект',
    projectPh: 'Выберите проект',
    requiredErr: 'Обязательно',
    titleLabel: 'Название',
    titleHint: 'Подстановки {{…}}: значения триггера и прошлых шагов',
    assigneeLabel: 'Исполнитель (необязательно)',
    assigneePh: 'Участник',
    statusLabel: 'Статус',
    deleteStep: 'Удалить шаг',
    activeBadge: 'Действует · v1',
    draftBadge: 'Черновик',
    issuesCount: n => `Замечаний: ${n}`,
    graphValid: 'Граф корректен',
    enabled: 'Включено',
    saveDraft: 'Сохранить черновик',
    publish: 'Опубликовать',
    tabs: ['Редактор', 'Запуски'],
    toastPublished: 'Опубликована версия 1 — автоматизация включена',
    badgeOk: 'Успешно',
    badgeRunning: 'Выполняется',
    allRuns: 'Все запуски',
    errorsOnly: 'Ошибки',
    justNow: 'только что',
    runSub: done => `Событие · v1 · ${done ? '0.4 с' : '—'} · 2 шага`,
    runMeta: done => `Триггер: Событие · версия 1 · начало 29.10.2026, 14:32 · длительность ${done ? '0.4 с' : '—'}`,
    ms12: '12 мс',
    s03: '0.3 с',
    inputLabel: 'Вход',
    outputLabel: 'Выход',
    step2TitleSample: 'Передать в работу: Кухня, ЖК Северный',
  },
  en: {
    crumbs: ['Platform', 'Automations'],
    scenarioTitle: 'Deal won → create task',
    typedTitle: 'Hand off to work: {{trigger.record.name}}',
    projectName: 'Client orders',
    projectId: PROJECT_ID,
    palette: [
      { cat: 'trigger', name: 'Trigger', items: [{ id: 'create', label: 'Record created', icon: 'create' }, { id: 'field', label: 'Field updated', icon: 'field' }, { id: 'cron', label: 'Scheduled', icon: 'cron' }] },
      { cat: 'flow', name: 'Logic', items: [{ id: 'if', label: 'Condition', icon: 'if' }, { id: 'wait', label: 'Delay', icon: 'wait' }] },
      { cat: 'action', name: 'Action', items: [{ id: 'update', label: 'Update field', icon: 'update' }, { id: 'task', label: 'Create task', icon: 'task', demo: 'pal-task' }, { id: 'notify', label: 'Notify member', icon: 'notify' }, { id: 'http', label: 'HTTP request', icon: 'http' }] },
    ],
    paletteHelp: 'Click to add a step after the selected one, or drag it onto the canvas.',
    triggerNodeTitle: 'Field updated',
    actionNodeTitle: 'Create task',
    triggerDesc: 'Runs when a record field changes — optionally only for a specific value.',
    entityLabel: 'Entity',
    entityVal: 'Deal',
    fieldLabel: 'Field',
    fieldVal: 'Stage',
    fromLabel: 'From (optional)',
    fromPh: 'Any stage',
    toLabel: 'To (optional)',
    toVal: 'Won',
    stepIdHint: 'Step ID: trigger — use {{steps.trigger.…}} in later steps.',
    actionDesc: 'Creates a task in a project.',
    projectLabel: 'Project',
    projectPh: 'Select project',
    requiredErr: 'Required',
    titleLabel: 'Title',
    titleHint: 'Placeholders {{…}}: trigger and previous step values',
    assigneeLabel: 'Assignee (optional)',
    assigneePh: 'Member',
    statusLabel: 'Status',
    deleteStep: 'Delete step',
    activeBadge: 'Active · v1',
    draftBadge: 'Draft',
    issuesCount: n => `Issues: ${n}`,
    graphValid: 'Valid graph',
    enabled: 'Enabled',
    saveDraft: 'Save draft',
    publish: 'Publish',
    tabs: ['Editor', 'Runs'],
    toastPublished: 'Version 1 published — automation enabled',
    badgeOk: 'Succeeded',
    badgeRunning: 'Running',
    allRuns: 'All runs',
    errorsOnly: 'Errors',
    justNow: 'just now',
    runSub: done => `Event · v1 · ${done ? '0.4 s' : '—'} · 2 steps`,
    runMeta: done => `Trigger: Event · version 1 · started Oct 29, 2026, 14:32 · duration ${done ? '0.4 s' : '—'}`,
    ms12: '12 ms',
    s03: '0.3 s',
    inputLabel: 'Input',
    outputLabel: 'Output',
    step2TitleSample: 'Hand off to work: Kitchen, North Park',
  },
  es: {
    crumbs: ['Plataforma', 'Automatizaciones'],
    scenarioTitle: 'Trato ganado → crear tarea',
    typedTitle: 'Pasar a producción: {{trigger.record.name}}',
    projectName: 'Pedidos de clientes',
    projectId: PROJECT_ID,
    palette: [
      { cat: 'trigger', name: 'Disparador', items: [{ id: 'create', label: 'Registro creado', icon: 'create' }, { id: 'field', label: 'Campo actualizado', icon: 'field' }, { id: 'cron', label: 'Programado', icon: 'cron' }] },
      { cat: 'flow', name: 'Lógica', items: [{ id: 'if', label: 'Condición', icon: 'if' }, { id: 'wait', label: 'Pausa', icon: 'wait' }] },
      { cat: 'action', name: 'Acción', items: [{ id: 'update', label: 'Actualizar campo', icon: 'update' }, { id: 'task', label: 'Crear tarea', icon: 'task', demo: 'pal-task' }, { id: 'notify', label: 'Notificar miembro', icon: 'notify' }, { id: 'http', label: 'Petición HTTP', icon: 'http' }] },
    ],
    paletteHelp: 'Haz clic para añadir un paso tras el seleccionado o arrástralo al lienzo.',
    triggerNodeTitle: 'Campo actualizado',
    actionNodeTitle: 'Crear tarea',
    triggerDesc: 'Se ejecuta al cambiar un campo — opcionalmente solo para un valor concreto.',
    entityLabel: 'Entidad',
    entityVal: 'Trato',
    fieldLabel: 'Campo',
    fieldVal: 'Etapa',
    fromLabel: 'Anterior (opcional)',
    fromPh: 'Cualquier etapa',
    toLabel: 'Nuevo (opcional)',
    toVal: 'Ganado',
    stepIdHint: 'ID del paso: trigger — usa {{steps.trigger.…}} en los pasos siguientes.',
    actionDesc: 'Crea una tarea en un proyecto.',
    projectLabel: 'Proyecto',
    projectPh: 'Seleccionar proyecto',
    requiredErr: 'Obligatorio',
    titleLabel: 'Título',
    titleHint: 'Variables {{…}}: valores del disparador y pasos previos',
    assigneeLabel: 'Responsable (opcional)',
    assigneePh: 'Miembro',
    statusLabel: 'Estado',
    deleteStep: 'Eliminar paso',
    activeBadge: 'Activa · v1',
    draftBadge: 'Borrador',
    issuesCount: n => `Avisos: ${n}`,
    graphValid: 'Grafo válido',
    enabled: 'Activada',
    saveDraft: 'Guardar borrador',
    publish: 'Publicar',
    tabs: ['Editor', 'Ejecuciones'],
    toastPublished: 'Versión 1 publicada — automatización activada',
    badgeOk: 'Correcto',
    badgeRunning: 'En curso',
    allRuns: 'Todas',
    errorsOnly: 'Errores',
    justNow: 'ahora mismo',
    runSub: done => `Evento · v1 · ${done ? '0.4 s' : '—'} · 2 pasos`,
    runMeta: done => `Disparador: Evento · versión 1 · inicio 29/10/2026, 14:32 · duración ${done ? '0.4 s' : '—'}`,
    ms12: '12 ms',
    s03: '0.3 s',
    inputLabel: 'Entrada',
    outputLabel: 'Salida',
    step2TitleSample: 'Pasar a producción: Cocina, Res. Norte',
  },
};
