/* Демо-данные воркспейса — порт data/seed.js из gr8r-studio.
   Файлы, события и настройки аккаунта пока не перенесены: добавятся вместе со страницами, которым они нужны. */
import { STATUSES } from '../constants';
import { dOff, minsAgo } from './dates';
import type { Activity, CalendarEvent, Comment, LabelId, Member, Notification, Priority, Project, ProjectFile, Status, Subtask, Task, Team, TimeLog, WorkspaceData } from '../domain';

/** Прежние пять уровней приоритета → шкала 1–10 */
const PRIO_SCALE: Record<'urgent' | 'high' | 'medium' | 'low' | 'none', Priority> = { urgent: 10, high: 8, medium: 5, low: 3, none: null };

let aid = 0;
const uid = (p: string) => p + ++aid;

export const TEAMS_SEED: Team[] = [
  { id: 'design', name: 'Дизайн', icon: 'palette', c: '#8662C9', desc: 'Продуктовый дизайн, бренд и исследования' },
  { id: 'eng', name: 'Разработка', icon: 'code', c: '#3B82C4', desc: 'Веб, мобильная и платформенная разработка' },
  { id: 'mkt', name: 'Маркетинг', icon: 'megaphone', c: '#C54B78', desc: 'Кампании, контент и рост' },
  { id: 'product', name: 'Продукт', icon: 'target', c: '#C48A1E', desc: 'Дорожная карта, планирование и тестирование' },
];

/** Оценка из старого формата ('3d', '4h', '30m') в часы: день = 8 часов */
const hoursOf = (e: string) => (e.endsWith('d') ? parseFloat(e) * 8 : e.endsWith('m') ? parseFloat(e) / 60 : parseFloat(e));

/** Подзадача для демо-данных: plan — часы (null — сумма вложенных), kids — вложенные подзадачи */
const sub = (id: string, title: string, done = false, plan: number | null = null, kids: Subtask[] = [], extra: Partial<Subtask> = {}): Subtask => ({
  id,
  title,
  done,
  planHours: plan,
  subtasks: kids,
  ...extra,
});

export function seed(): WorkspaceData {
  const members: Member[] = [
    {
      id: 'm1',
      name: 'Андрей Волков',
      email: 'hello@gr8rstudio.com',
      role: 'Owner',
      team: 'product',
      title: 'Руководитель продукта',
      c: '#5A67D8',
      status: 'active',
      last: 0,
      tz: 'Сан-Франциско',
    },
    {
      id: 'm2',
      name: 'Мария Чернова',
      email: 'sarah@gr8rstudio.com',
      role: 'Admin',
      team: 'design',
      title: 'Руководитель дизайна',
      c: '#C54B78',
      status: 'active',
      last: 4,
      tz: 'Нью-Йорк',
    },
    {
      id: 'm3',
      name: 'Иван Карпов',
      email: 'john@gr8rstudio.com',
      role: 'Member',
      team: 'eng',
      title: 'Фронтенд-разработчик',
      c: '#3B82C4',
      status: 'active',
      last: 22,
      tz: 'Лондон',
    },
    {
      id: 'm4',
      name: 'Елена Орлова',
      email: 'emma@gr8rstudio.com',
      role: 'Member',
      team: 'design',
      title: 'Продуктовый дизайнер',
      c: '#23918A',
      status: 'active',
      last: 9,
      tz: 'Берлин',
    },
    {
      id: 'm5',
      name: 'Полина Шацкая',
      email: 'priya@gr8rstudio.com',
      role: 'Member',
      team: 'mkt',
      title: 'Контент-стратег',
      c: '#C48A1E',
      status: 'active',
      last: 95,
      tz: 'Торонто',
    },
    {
      id: 'm6',
      name: 'Максим Лебедев',
      email: 'marcus@gr8rstudio.com',
      role: 'Member',
      team: 'eng',
      title: 'Бэкенд-разработчик',
      c: '#8662C9',
      status: 'active',
      last: 240,
      tz: 'Сингапур',
    },
    {
      id: 'm7',
      name: 'Лариса Фомина',
      email: 'lena@gr8rstudio.com',
      role: 'Admin',
      team: 'product',
      title: 'Руководитель тестирования',
      c: '#3D8E5F',
      status: 'active',
      last: 1500,
      tz: 'Мюнхен',
    },
    {
      id: 'm8',
      name: 'Денис Алексеев',
      email: 'diego@freelance.io',
      role: 'Guest',
      team: 'mkt',
      title: 'Фриланс-копирайтер',
      c: '#C0612B',
      status: 'invited',
      last: null,
      tz: 'Мадрид',
    },
  ];
  const projects: Project[] = [
    {
      id: 'p1',
      key: 'WEB',
      name: 'Редизайн сайта',
      module: 'general',
      icon: 'globe',
      color: 'indigo',
      status: 'active',
      team: 'design',
      lead: 'm2',
      due: dOff(24),
      start: dOff(-30),
      fav: true,
      members: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
      desc: 'Пересобрать сайт с более понятной структурой, адаптивной библиотекой компонентов и быстрым блогом на CMS.',
      milestones: [
        { name: 'Макеты согласованы', date: dOff(2) },
        { name: 'Передача в разработку', date: dOff(14) },
        { name: 'Публичный запуск', date: dOff(24) },
      ],
      last: 12,
    },
    {
      id: 'p2',
      key: 'MOB',
      name: 'Мобильное приложение',
      module: 'general',
      icon: 'smartphone',
      color: 'blue',
      status: 'active',
      team: 'eng',
      lead: 'm3',
      due: dOff(52),
      start: dOff(-45),
      fav: true,
      members: ['m1', 'm3', 'm4', 'm6', 'm7'],
      desc: 'Нативный клиент для iOS и Android для выездных команд: офлайн-синхронизация, push-уведомления и вход по биометрии.',
      milestones: [
        { name: 'Бета-сборка', date: dOff(9) },
        { name: 'Отправка в App Store', date: dOff(45) },
      ],
      last: 48,
    },
    {
      id: 'p3',
      key: 'MKT',
      name: 'Маркетинговая кампания',
      module: 'general',
      icon: 'megaphone',
      color: 'rose',
      status: 'planning',
      team: 'mkt',
      lead: 'm5',
      due: dOff(40),
      start: dOff(-10),
      fav: false,
      members: ['m1', 'm4', 'm5', 'm7', 'm8'],
      desc: 'Осенняя кампания по узнаваемости: платные соцсети, рассылки и вебинар для руководителей операционных отделов.',
      milestones: [
        { name: 'Креативы утверждены', date: dOff(12) },
        { name: 'Запуск кампании', date: dOff(21) },
      ],
      last: 130,
    },
    {
      id: 'p4',
      key: 'LCH',
      name: 'Запуск продукта',
      module: 'general',
      icon: 'rocket',
      color: 'amber',
      status: 'risk',
      team: 'product',
      lead: 'm1',
      due: dOff(12),
      start: dOff(-21),
      fav: false,
      members: ['m1', 'm2', 'm3', 'm5', 'm7'],
      desc: 'Согласовать запуск «Процессов 2.0»: цены, документация, пресса и подготовка продаж во всех командах.',
      milestones: [
        { name: 'Решение о запуске', date: dOff(11) },
        { name: 'День запуска', date: dOff(12) },
      ],
      last: 35,
    },
    {
      id: 'p5',
      key: 'DS',
      name: 'Дизайн-система',
      module: 'general',
      icon: 'component',
      color: 'violet',
      status: 'active',
      team: 'design',
      lead: 'm2',
      due: dOff(70),
      start: dOff(-60),
      fav: false,
      members: ['m2', 'm3', 'm4'],
      desc: 'Общие токены, компоненты и документация для веб- и мобильной команд.',
      milestones: [{ name: 'Токены v2', date: dOff(3) }],
      last: 300,
    },
    {
      id: 'p6',
      key: 'CP',
      name: 'Клиентский портал',
      module: 'general',
      icon: 'building-2',
      color: 'teal',
      status: 'hold',
      team: 'eng',
      lead: 'm6',
      due: dOff(90),
      start: dOff(-5),
      fav: false,
      members: ['m6', 'm7'],
      private: true,
      desc: 'Портал самообслуживания по оплатам и поддержке для крупных клиентов. Доступ ограничен на время согласования договора.',
      milestones: [],
      last: 2880,
    },
    {
      id: 'p7',
      key: 'MW',
      name: 'Маркетинговый сайт',
      module: 'general',
      icon: 'layout-grid',
      color: 'green',
      status: 'complete',
      team: 'mkt',
      lead: 'm5',
      due: dOff(-18),
      start: dOff(-80),
      fav: false,
      members: ['m1', 'm3', 'm5'],
      desc: 'Сайт к весеннему релизу. Выпущен и передан веб-команде на поддержку.',
      milestones: [],
      last: 26000,
    },
  ];
  let n = 0;
  const T: Task[] = [];
  const t = (p: string, title: string, status: Status, a: string | null, prio: 'urgent' | 'high' | 'medium' | 'low' | 'none', due: number | null, labels: LabelId[] = [], x: Partial<Task> & { len?: number; est?: string; age?: number; upd?: number } = {}) => {
    const proj = projects.find(q => q.id === p)!;
    const { len, est, age, upd, ...rest } = x;
    const count = T.filter(q => q.project === p).length + 1;
    T.push(
      Object.assign(
        {
          id: 't' + ++n,
          key: proj.key + '-' + (100 + count * 3),
          project: p,
          module: proj.module,
          title,
          status,
          assignee: a,
          priority: PRIO_SCALE[prio],
          due: due == null ? null : dOff(due),
          start: due == null ? null : dOff(due - (len || 4)),
          labels,
          subtasks: [],
          attachments: [],
          deps: [],
          desc: '',
          planHours: est ? hoursOf(est) : null,
          created: minsAgo(60 * 24 * (age || 12)),
          updated: minsAgo(60 * (upd || 30)),
          order: n,
          fav: false,
          recur: null,
        },
        rest,
      ),
    );
  };
  // Website Redesign
  t('p1', 'Аудит текущей навигации', 'done', 'm2', 'high', -12, ['research'], { est: '2d', len: 5, age: 28 });
  t('p1', 'Свести интервью с заинтересованными сторонами', 'done', 'm1', 'medium', -9, ['research'], { est: '1d', age: 26 });
  t('p1', 'Нарисовать макеты главной страницы', 'review', 'm2', 'high', 1, ['design'], {
    est: '3d',
    len: 7,
    fav: true,
    desc: '<p>Схематичные макеты новой главной страницы для <b>десктопа, планшета и телефона</b>.</p><ul><li>Первый экран с ценностью продукта</li><li>Логотипы клиентов и подтверждающие факты</li><li>Обзор возможностей со ссылками на страницы продукта</li></ul><p>Решения по структуре брать из аудита навигации.</p>',
    subtasks: [
      sub('s1', 'Макет для десктопа', true, 8),
      sub('s2', 'Макет для планшета', true, 5),
      sub('s3', 'Макет для телефона', true, 5),
      sub(
        's4',
        'Описать взаимодействия',
        false,
        null,
        [
          sub('s30', 'Состояния наведения и фокуса', false, 3, [sub('s31', 'Меню навигации', true, 1.5), sub('s32', 'Кнопки и поля форм', false, 1.5, [], { assignee: 'm4' })], { assignee: 'm2', due: dOff(1) }),
          sub('s33', 'Прокрутка и закрепление', false, 2),
        ],
        { assignee: 'm2', due: dOff(1), note: 'Пометки лежат в файле Figma, по одному кадру на каждое разрешение.' },
      ),
    ],
    attachments: [
      { id: 'a1', name: 'homepage-wireframes-v3.fig', type: 'fig', size: '4.2 MB', by: 'm2', at: minsAgo(300) },
      { id: 'a2', name: 'nav-audit-findings.pdf', type: 'pdf', size: '860 KB', by: 'm2', at: minsAgo(8000) },
    ],
  });
  t('p1', 'Доработать навигацию', 'progress', 'm3', 'high', 0, ['design', 'frontend'], {
    est: '2d',
    len: 4,
    subtasks: [
      sub('s5', 'Структура главного меню', true, 6),
      sub('s6', 'Содержимое мега-меню', false, null, [sub('s34', 'Группировка колонок', true, 3), sub('s35', 'Вычитка текстов', false, 2)]),
      sub('s7', 'Поведение мобильного меню', false, 4),
    ],
  });
  t('p1', 'Спроектировать адаптивную навигацию', 'progress', 'm4', 'medium', 3, ['design'], {
    est: '3d',
    len: 6,
    subtasks: [sub('s8', 'Правила для разрешений', true, 6), sub('s9', 'Состояния закреплённой шапки', false, 4)],
  });
  t('p1', 'Подготовить токены дизайн-системы', 'todo', 'm1', 'medium', 6, ['design'], { est: '2d', len: 4 });
  t('p1', 'Проверить адаптивные макеты', 'todo', 'm4', 'medium', 8, ['qa', 'design'], { est: '1d', len: 3 });
  t('p1', 'Подготовить передачу разработчикам', 'todo', 'm2', 'high', 14, ['frontend'], { est: '2d', len: 4, deps: ['t3', 't5'] });
  t('p1', 'Спроектировать мобильное знакомство с приложением', 'progress', 'm4', 'urgent', -1, ['design'], {
    est: '3d',
    len: 6,
    subtasks: [
      sub('s10', 'Приветственные экраны', true, 8),
      sub('s11', 'Запросы разрешений', false, null, [sub('s36', 'Тексты на проверку юристам', false, 3), sub('s37', 'Запасные состояния', false, null, [sub('s38', 'Отказ', false, 1.5), sub('s39', 'Ограничено родительским контролем', false, 1.5)])]),
      sub('s12', 'Пустые состояния', false, 4),
    ],
  });
  t('p1', 'Написать тексты главной страницы', 'backlog', 'm5', 'low', 18, ['content'], { est: '2d' });
  t('p1', 'Настроить события аналитики', 'backlog', 'm6', 'medium', 20, ['backend', 'growth'], { est: '1d' });
  t('p1', 'Аудит доступности шаблонов', 'backlog', 'm7', 'high', 22, ['qa'], { est: '2d' });
  t('p1', 'Сверстать компонент первого экрана', 'todo', 'm3', 'medium', 10, ['frontend'], { est: '2d', len: 3, deps: ['t3'] });
  t('p1', 'Конвейер оптимизации изображений', 'review', 'm6', 'low', 2, ['backend'], { est: '1d', len: 5 });
  t('p1', 'Заметки с еженедельной встречи дизайнеров', 'todo', 'm1', 'low', 2, ['content'], { recur: 'Weekly', est: '30m', len: 0 });
  t('p1', 'Перенести блог на новую CMS', 'backlog', 'm3', 'medium', 28, ['backend'], { est: '5d', len: 8 });
  t('p1', 'Подвал и юридические страницы', 'done', 'm5', 'low', -5, ['frontend'], { est: '1d' });
  t('p1', 'Починить битые якорные ссылки на странице цен', 'done', 'm3', 'medium', -3, ['bug'], { est: '2h', len: 1 });
  // Mobile App
  t('p2', 'Прототип сценария знакомства', 'progress', 'm4', 'high', 4, ['design'], { est: '3d', len: 6 });
  t('p2', 'Сервис push-уведомлений', 'progress', 'm6', 'high', 6, ['backend'], { est: '5d', len: 9 });
  t('p2', 'Синхронизация в офлайн-режиме', 'todo', 'm3', 'urgent', 5, ['frontend', 'backend'], { est: '8d', len: 10, deps: ['t20'] });
  t('p2', 'Скриншоты для App Store', 'backlog', 'm5', 'low', 40, ['content'], { est: '1d' });
  t('p2', 'Настройка отчётов о сбоях', 'done', 'm6', 'medium', -8, ['backend'], { est: '1d' });
  t('p2', 'Вход по биометрии', 'review', 'm3', 'high', 2, ['frontend'], { est: '3d', len: 6 });
  t('p2', 'Редизайн экрана настроек', 'todo', 'm4', 'medium', 9, ['design'], { est: '2d' });
  t('p2', 'Разобрать отзывы бета-тестеров', 'todo', 'm1', 'medium', 0, ['research'], { est: '4h', len: 1, recur: 'Weekly' });
  t('p2', 'Сбой на Android 12 при повороте экрана', 'todo', 'm3', 'urgent', 1, ['bug'], { est: '1d', len: 1 });
  // Marketing Campaign
  t('p3', 'Бриф кампании', 'done', 'm5', 'medium', -6, ['content'], { est: '1d' });
  t('p3', 'Тексты посадочной страницы', 'progress', 'm5', 'medium', 4, ['content'], { est: '2d' });
  t('p3', 'Креативы для платных соцсетей', 'todo', 'm4', 'high', 7, ['design', 'growth'], { est: '3d', len: 5 });
  t('p3', 'Цепочка прогревающих писем', 'todo', 'm8', 'medium', 9, ['content'], { est: '2d' });
  t('p3', 'Список блогеров для рассылки', 'backlog', 'm7', 'low', null, ['growth']);
  t('p3', 'Презентация для вебинара', 'todo', 'm1', 'medium', 15, ['content'], { est: '2d' });
  t('p3', 'Согласование бюджета', 'review', 'm1', 'urgent', -2, [], { est: '1h', len: 1 });
  // Product Launch
  t('p4', 'Чек-лист готовности к запуску', 'progress', 'm1', 'urgent', 3, ['qa'], {
    est: '1d',
    len: 10,
    subtasks: [
      sub('s20', 'Документация опубликована', true, 2),
      sub('s21', 'Цены опубликованы', false, 1),
      sub('s22', 'Поддержка обучена', false, null, [sub('s40', 'Разбор для отдела продаж', false, 1), sub('s41', 'Инструкция для поддержки', false, 2)]),
      sub('s23', 'Страница статуса обновлена', true, 0.5),
    ],
  });
  t('p4', 'Обновить страницу цен', 'todo', 'm2', 'high', 6, ['design', 'frontend'], { est: '2d' });
  t('p4', 'Черновик пресс-релиза', 'review', 'm5', 'medium', 1, ['content'], { est: '1d' });
  t('p4', 'Материалы для отдела продаж', 'todo', 'm7', 'medium', 8, ['content'], { est: '2d' });
  t('p4', 'Заметки о релизе', 'backlog', 'm3', 'low', 11, ['content'], { est: '4h' });
  t('p4', 'Встреча по решению о запуске', 'todo', 'm1', 'high', 11, [], { est: '1h', len: 0 });
  // Design System
  t('p5', 'Цветовые токены v2', 'done', 'm2', 'high', -4, ['design'], { est: '3d' });
  t('p5', 'Аудит компонента кнопки', 'progress', 'm2', 'medium', 5, ['design', 'frontend'], { est: '2d' });
  t('p5', 'Состояния полей форм', 'todo', 'm4', 'medium', 12, ['design'], { est: '3d' });
  t('p5', 'Чистка библиотеки иконок', 'backlog', 'm4', 'low', null, ['design']);
  t('p5', 'Сайт документации', 'todo', 'm3', 'medium', 20, ['frontend'], { est: '5d', len: 8 });
  t('p5', 'Палитра тёмной темы', 'review', 'm2', 'high', 2, ['design'], { est: '2d' });
  // Marketing Website (complete)
  t('p7', 'Тестирование сайта перед запуском', 'done', 'm3', 'high', -20, ['qa']);
  t('p7', 'Видео на первом экране весеннего релиза', 'done', 'm5', 'medium', -24, ['content']);
  // Customer portal (restricted)
  t('p6', 'Контракт API биллинга', 'todo', 'm6', 'high', 30, ['backend']);

  const tk = (id: string) => T.find(x => x.id === id)!;
  // completed metadata
  T.filter(x => x.status === 'done').forEach((x, i) => (x.completedAt = minsAgo(60 * (6 + i * 17))));
  const comments: Comment[] = [
    {
      id: 'c1',
      task: 't3',
      by: 'm4',
      at: minsAgo(260),
      text: 'На планшете полоса с логотипами выглядит тесно. Может, оставим четыре логотипа при ширине меньше 1024 px?',
      re: { '👍': ['m2', 'm3'] },
    },
    { id: 'c2', task: 't3', by: 'm2', at: minsAgo(210), text: 'Хорошая мысль. Обновила в v3 — @Андрей Волков, посмотришь до четверга?', re: {} },
    {
      id: 'c3',
      task: 't3',
      by: 'm3',
      at: minsAgo(95),
      text: 'Отступы первого экрана ложатся на нашу сетку в 8 pt. Со стороны разработки препятствий нет.',
      re: { '🎉': ['m2'] },
    },
    { id: 'c4', task: 't4', by: 'm3', at: minsAgo(400), text: "Содержимое мега-меню от маркетинга ещё не пришло. Пока поставлю заглушку.", re: {} },
    { id: 'c5', task: 't4', by: 'm5', at: minsAgo(120), text: '@Иван Карпов, содержимое уже в общем документе — не больше шести колонок.', re: { '👍': ['m3'] } },
    { id: 'c6', task: 't9', by: 'm1', at: minsAgo(55), text: 'Это не успели вчера — @Елена Орлова, что-то мешает с запросами разрешений?', re: {} },
    { id: 'c7', task: 't24', by: 'm7', at: minsAgo(700), text: 'Переход с Face ID на код-пароль работает на iOS 17; дальше проверяю Android.', re: {} },
    { id: 'c8', task: 't34', by: 'm2', at: minsAgo(1500), text: 'Финансистам нужна разбивка по каналам, иначе не согласуют.', re: {} },
    { id: 'c9', task: 't35', by: 'm7', at: minsAgo(200), text: 'Обучение поддержки перенесли на понедельник. @Андрей Волков, подтверди текст страницы статуса.', re: {} },
  ];
  const A = (by: string, verb: string, task: string | null, project: string, m: number, extra = ''): Activity => ({ id: uid('a'), by, verb, task, project, at: minsAgo(m), extra });
  const activity: Activity[] = [
    A('m2', 'перенесла', 't3', 'p1', 38, 'на проверку'),
    A('m3', 'завершил', 't18', 'p1', 90),
    A('m4', 'прокомментировала', 't19', 'p2', 140),
    A('m1', 'изменил приоритет задачи', 't9', 'p1', 180, 'на 10'),
    A('m6', 'добавил файл к задаче', 't14', 'p1', 260),
    A('m5', 'создала', 't30', 'p3', 330),
    A('m2', 'назначила', 't8', 'p1', 420, 'на Марию Чернову'),
    A('m7', 'завершила', 't23', 'p2', 1300),
    A('m3', 'перенёс', 't24', 'p2', 1500, 'на проверку'),
    A('m1', 'создал проект', null, 'p4', 30000),
    A('m2', 'создала проект', null, 'p1', 43000),
    A('m4', 'завершила', 't41', 'p5', 5600),
    A('m5', 'завершила', 't17', 'p1', 7200),
  ];
  const notifs: Notification[] = [
    {
      id: 'n1',
      type: 'mention',
      by: 'm2',
      task: 't3',
      text: 'упомянула вас в',
      snippet: 'Обновила в v3 — @Андрей Волков, посмотришь до четверга?',
      at: minsAgo(210),
      read: false,
    },
    { id: 'n2', type: 'assign', by: 'm3', task: 't28', text: 'назначил вам', snippet: 'Срок сегодня · Приоритет 5', at: minsAgo(300), read: false },
    {
      id: 'n3',
      type: 'comment',
      by: 'm4',
      task: 't9',
      text: 'прокомментировала',
      snippet: 'Запросы разрешений нужно показать юристам — уже готовлю тексты.',
      at: minsAgo(40),
      read: false,
    },
    {
      id: 'n4',
      type: 'mention',
      by: 'm7',
      task: 't35',
      text: 'упомянула вас в',
      snippet: 'Обучение поддержки перенесли на понедельник. @Андрей Волков, подтверди текст страницы статуса.',
      at: minsAgo(200),
      read: false,
    },
    { id: 'n5', type: 'update', by: 'm2', task: 't3', text: 'перенесла на проверку', snippet: 'К выполнению → Проверка', at: minsAgo(38), read: true },
    {
      id: 'n6',
      type: 'update',
      by: null,
      project: 'p4',
      text: 'Запуск продукта под угрозой',
      snippet: '3 задачи со сроком на этой неделе не начаты',
      at: minsAgo(600),
      read: false,
    },
    {
      id: 'n7',
      type: 'comment',
      by: 'm2',
      task: 't34',
      text: 'прокомментировала',
      snippet: 'Финансистам нужна разбивка по каналам, иначе не согласуют.',
      at: minsAgo(1500),
      read: true,
    },
    { id: 'n8', type: 'assign', by: 'm2', task: 't6', text: 'назначила вам', snippet: 'Срок через 6 дней', at: minsAgo(2900), read: true },
    { id: 'n9', type: 'update', by: 'm3', task: 't18', text: 'завершил', snippet: 'Починить битые якорные ссылки на странице цен', at: minsAgo(90), read: true },
    { id: 'n10', type: 'update', by: null, task: 't28', text: 'срок сегодня', snippet: 'Разобрать отзывы бета-тестеров', at: minsAgo(20), read: false },
  ];
  const events: CalendarEvent[] = [
    { id: 'e1', title: 'Обзор дизайна', date: dOff(1), time: '10:00', project: 'p1' },
    { id: 'e2', title: 'Планирование спринта', date: dOff(5), time: '09:30', project: 'p2' },
    { id: 'e3', title: 'Синхронизация по запуску', date: dOff(0), time: '15:00', project: 'p4' },
    { id: 'e4', title: 'Демо для заинтересованных сторон', date: dOff(9), time: '14:00', project: 'p1' },
    { id: 'e5', title: 'Старт кампании', date: dOff(-3), time: '11:00', project: 'p3' },
    { id: 'e6', title: 'Ретроспектива', date: dOff(12), time: '16:00', project: 'p2' },
  ];
  const files: ProjectFile[] = [
    { id: 'f1', project: 'p1', name: 'homepage-wireframes-v3.fig', type: 'fig', size: '4.2 MB', by: 'm2', at: minsAgo(300), task: 't3' },
    { id: 'f2', project: 'p1', name: 'nav-audit-findings.pdf', type: 'pdf', size: '860 KB', by: 'm2', at: minsAgo(8000), task: 't3' },
    { id: 'f3', project: 'p1', name: 'brand-photography-set.zip', type: 'zip', size: '128 MB', by: 'm4', at: minsAgo(3000) },
    { id: 'f4', project: 'p1', name: 'hero-exploration.png', type: 'img', size: '2.1 MB', by: 'm4', at: minsAgo(1400) },
    { id: 'f5', project: 'p1', name: 'content-inventory.xlsx', type: 'sheet', size: '310 KB', by: 'm5', at: minsAgo(9000) },
    { id: 'f6', project: 'p1', name: 'sitemap-v2.pdf', type: 'pdf', size: '540 KB', by: 'm1', at: minsAgo(12000) },
    { id: 'f7', project: 'p1', name: 'interview-notes.docx', type: 'doc', size: '96 KB', by: 'm1', at: minsAgo(20000) },
    { id: 'f8', project: 'p1', name: 'analytics-events.json', type: 'code', size: '12 KB', by: 'm6', at: minsAgo(700) },
    { id: 'f9', project: 'p2', name: 'onboarding-flow.fig', type: 'fig', size: '6.8 MB', by: 'm4', at: minsAgo(500) },
    { id: 'f10', project: 'p2', name: 'beta-feedback.xlsx', type: 'sheet', size: '220 KB', by: 'm1', at: minsAgo(900) },
    { id: 'f11', project: 'p3', name: 'campaign-brief.pdf', type: 'pdf', size: '1.1 MB', by: 'm5', at: minsAgo(4000) },
    { id: 'f12', project: 'p4', name: 'launch-plan.docx', type: 'doc', size: '180 KB', by: 'm1', at: minsAgo(6000) },
  ];
  // Учёт времени: часть задач в плане, у двух (wireframes, mobile onboarding) — перерасход
  const byTitle = (title: string) => T.find(x => x.title === title)!.id;
  const timeLogs: TimeLog[] = [];
  const L = (title: string, sb: string | null, by: string, hours: number, daysAgo: number, note = '') =>
    timeLogs.push({ id: 'l' + (timeLogs.length + 1), task: byTitle(title), ...(sb ? { sub: sb } : null), by, hours, date: dOff(-daysAgo), note });
  const WF = 'Нарисовать макеты главной страницы';
  L(WF, 's1', 'm2', 6.5, 19, 'Первый проход по макету для десктопа');
  L(WF, 's1', 'm2', 2.5, 16, 'Правки после обзора дизайна');
  L(WF, 's2', 'm2', 5, 14);
  L(WF, 's3', 'm2', 4.5, 12, 'Разрешения для телефонов');
  L(WF, null, 'm2', 3, 8, 'Показ заинтересованным сторонам');
  L(WF, null, 'm3', 2, 6, 'Оценка реализуемости с разработкой');
  L(WF, null, 'm4', 1.5, 5, 'Отзывы по планшетной версии');
  L(WF, 's31', 'm2', 1.5, 3, 'Состояния наведения в меню');
  L(WF, 's33', 'm2', 1, 2);
  L(WF, null, 'm2', 2, 1, 'Обновления v3');
  L('Аудит текущей навигации', null, 'm2', 6, 27, 'Обошёл все страницы верхнего уровня');
  L('Аудит текущей навигации', null, 'm2', 5, 26);
  L('Аудит текущей навигации', null, 'm2', 4.5, 25, 'Описание выводов');
  L('Свести интервью с заинтересованными сторонами', null, 'm1', 3, 24);
  L('Свести интервью с заинтересованными сторонами', null, 'm1', 3.5, 23, 'Темы и цитаты');
  L('Доработать навигацию', 's5', 'm3', 5, 5);
  L('Доработать навигацию', 's5', 'm3', 2, 4);
  L('Доработать навигацию', null, 'm5', 1, 3, 'Проверка контента');
  L('Доработать навигацию', 's34', 'm3', 2.5, 2);
  L('Доработать навигацию', null, 'm3', 3, 1, 'Прототип мега-меню');
  L('Спроектировать адаптивную навигацию', 's8', 'm4', 4, 4);
  L('Спроектировать адаптивную навигацию', 's8', 'm4', 3, 3);
  L('Спроектировать адаптивную навигацию', null, 'm4', 1, 2);
  L('Спроектировать адаптивную навигацию', 's9', 'm4', 2.5, 1);
  const MO = 'Спроектировать мобильное знакомство с приложением';
  L(MO, 's10', 'm4', 7, 10);
  L(MO, 's10', 'm4', 3.5, 9, 'Иллюстрации');
  L(MO, null, 'm4', 6, 8, 'Прототип в Figma');
  L(MO, 's36', 'm4', 3, 6, 'Переписал после замечаний юристов');
  L(MO, 's38', 'm4', 2, 5);
  L(MO, null, 'm4', 5, 4, 'Доводка взаимодействий');
  L(MO, null, 'm1', 1, 2, 'Проверка');
  L('Подготовить токены дизайн-системы', null, 'm1', 2, 1);
  L('Сверстать компонент первого экрана', null, 'm3', 4, 2);
  L('Сверстать компонент первого экрана', null, 'm3', 2.5, 1, 'Адаптивная загрузка изображений');
  L('Конвейер оптимизации изображений', null, 'm6', 5, 3);
  L('Конвейер оптимизации изображений', null, 'm6', 2, 1, 'Замеры скорости');
  L('Подвал и юридические страницы', null, 'm5', 7.5, 6);
  L('Починить битые якорные ссылки на странице цен', null, 'm3', 2.5, 3, 'Заодно исправил два перенаправления');
  L('Прототип сценария знакомства', null, 'm4', 8, 3);
  L('Прототип сценария знакомства', null, 'm4', 6.5, 2);
  L('Прототип сценария знакомства', null, 'm4', 4, 1);
  L('Сервис push-уведомлений', null, 'm6', 8, 4);
  L('Сервис push-уведомлений', null, 'm6', 8, 3, 'Интеграция с APNs');
  L('Сервис push-уведомлений', null, 'm6', 6, 2);
  L('Сервис push-уведомлений', null, 'm6', 5.5, 1);
  L('Вход по биометрии', null, 'm3', 7, 6);
  L('Вход по биометрии', null, 'm3', 8, 5, 'Face ID и отпечаток пальца');
  L('Вход по биометрии', null, 'm3', 6.5, 2, 'Переход на код-пароль');
  L('Настройка отчётов о сбоях', null, 'm6', 6, 9);
  L('Синхронизация в офлайн-режиме', null, 'm3', 8, 1, 'Исследование разрешения конфликтов');
  L('Разобрать отзывы бета-тестеров', null, 'm1', 1.5, 7);
  L('Разобрать отзывы бета-тестеров', null, 'm1', 2, 0, 'Еженедельный разбор');
  L('Тексты посадочной страницы', null, 'm5', 6, 2);
  L('Тексты посадочной страницы', null, 'm5', 4.5, 1, 'Второй черновик');
  L('Чек-лист готовности к запуску', 's20', 'm1', 1.5, 5);
  L('Чек-лист готовности к запуску', 's20', 'm1', 2, 4, 'Справочник по API');
  L('Чек-лист готовности к запуску', 's23', 'm1', 0.5, 3);
  L('Чек-лист готовности к запуску', null, 'm1', 1, 1, 'Проверка перед запуском');
  L('Черновик пресс-релиза', null, 'm5', 5, 2);
  L('Цветовые токены v2', null, 'm2', 10, 14);
  L('Цветовые токены v2', null, 'm2', 8, 12);
  L('Цветовые токены v2', null, 'm2', 7, 10, 'Аудит контрастности');
  L('Палитра тёмной темы', null, 'm2', 6, 3);
  L('Палитра тёмной темы', null, 'm2', 5, 1, 'Подбор цветов поверхностей');
  L('Аудит компонента кнопки', null, 'm2', 3.5, 0);
  const tmp = tk('t3');
  tmp.updated = minsAgo(38);
  return {
    ws: { name: 'FutureERP', url: 'gr8rstudio', c: '#1D1C1A', brand: true },
    me: 'm1',
    members,
    projects,
    tasks: T,
    comments,
    activity,
    notifs,
    teams: TEAMS_SEED.map(x => ({ ...x })),
    events,
    files,
    timeLogs,
    projOrder: projects.map(p => p.id),
    statuses: STATUSES.map(s => ({ id: s.id, name: s.name, color: `var(--st-${s.id})`, builtin: true })),
    savedViews: [{ id: 'v1', project: 'p1', name: 'Высокий приоритет', type: 'list', filters: [{ f: 'priority', v: ['10', '8'] }] }],
  };
}
