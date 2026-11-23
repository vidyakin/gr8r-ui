/* Интерактивные доски (whiteboards): русский словарь */
import type { whiteboards as E } from '../en/whiteboards';
import type { Widen } from '../types';

export const whiteboards: Widen<typeof E> = {
  title: 'Доски',
  subtitle: 'Интерактивные доски для схем, брейнштормов и живых карточек ERP/CRM',
  search: 'Поиск по названию доски…',
  newBoard: 'Новая доска',
  blankBoard: 'Пустая доска',
  defaultTitle: 'Новая доска',
  templatesTitle: 'Быстрые шаблоны',
  templatesHint: 'Начните с готовой структуры',
  elements: { one: '{count} элемент', few: '{count} элемента', many: '{count} элементов', other: '{count} элемента' },
  empty: {
    title: 'Пока нет ни одной доски',
    hint: 'Создайте пустую доску или выберите один из шаблонов выше.',
    noResults: 'По вашему запросу доски не найдены',
  },
  deleteTitle: 'Удалить доску',
  deleteConfirm: 'Удалить доску «{name}»? Это действие нельзя отменить.',
  delete: 'Удалить',
  cancel: 'Отмена',
  back: 'Назад',
  titlePlaceholder: 'Название доски',
  saving: 'Сохранение…',
  saved: 'Сохранено',
  saveError: 'Не удалось сохранить изменения',
  loadFailed: 'Не удалось загрузить доску',
  notFound: 'Доска не найдена',
  picker: {
    title: 'Добавить карточку ERP/CRM',
    description: 'Выберите задачу, сделку или контрагента, чтобы разместить живую карточку на доске',
    search: 'Поиск по названию…',
    tabs: {
      tasks: 'Задачи',
      deals: 'Сделки',
      companies: 'Компании',
    },
    empty: 'Ничего не найдено',
    loading: 'Загрузка…',
  },
  toast: {
    taskCreated: 'Задача «{title}» создана',
    noProjectForTask: 'Сначала создайте активный проект, чтобы превращать стикеры в задачи',
    deleted: 'Доска удалена',
    created: 'Доска создана',
  },
};
