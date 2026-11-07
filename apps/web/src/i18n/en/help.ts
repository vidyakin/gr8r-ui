/* Справка в приложении (docs/user): подписи кнопки и панели. Сами статьи — только по-русски, без перевода */
export const help = {
  open: 'Help',
  title: 'Help',
  back: 'Back',
  toc: 'Contents',
  searchPlaceholder: 'Search the help',
  searchResults: 'Search results',
  noResults: 'Nothing found',
  moreForSection: 'Articles about this section',
  noArticle: 'There is no article about this section yet. Pick one from the contents.',
  cmdOpen: 'Help',
  group: 'Help',
  /** Страница «Что нового» (журнал доработок docs/changelog.md, записи только по-русски) */
  whatsNew: {
    title: 'What’s new',
    lead: 'What was added to FutureERP and when. Entries are in Russian.',
    allModules: 'All modules',
    loadError: 'Could not load the change log',
  },
} as const;
