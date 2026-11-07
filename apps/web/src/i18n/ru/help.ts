import type { Widen } from '../types';
import type { help as H } from '../en/help';

export const help: Widen<typeof H> = {
  open: 'Справка',
  title: 'Справка',
  back: 'Назад',
  toc: 'Оглавление',
  searchPlaceholder: 'Поиск по справке',
  searchResults: 'Результаты поиска',
  noResults: 'Ничего не найдено',
  moreForSection: 'Статьи об этом разделе',
  noArticle: 'Статьи об этом разделе пока нет. Выберите статью в оглавлении.',
  cmdOpen: 'Справка',
  group: 'Справка',
  /** Страница «Что нового» (журнал доработок docs/changelog.md, записи только по-русски) */
  whatsNew: {
    title: 'Что нового',
    lead: 'Что и когда добавлено в FutureERP.',
    allModules: 'Все модули',
    loadError: 'Не удалось загрузить журнал доработок',
  },
};
