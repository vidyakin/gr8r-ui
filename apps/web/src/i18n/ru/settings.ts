import type { Widen } from '../types';
import type { languages as L, settings as S } from '../en/settings';

export const settings: Widen<typeof S> = {
  language: {
    lead: 'Язык и региональные форматы.',
    title: 'Язык',
    hint: 'Язык интерфейса.',
    workspaceDefault: 'Как в воркспейсе ({lang})',
    workspaceTitle: 'Язык воркспейса',
    workspaceHint: 'Язык по умолчанию для участников, которые не выбрали свой.',
    notSet: 'Не задан (язык браузера)',
    saved: 'Язык сохранён',
    spellcheck: 'Проверка орфографии',
    spellcheckHint: 'Проверять орфографию в описаниях и комментариях.',
  },
};

export const languages: Widen<typeof L> = {
  en: 'English',
  ru: 'Русский',
};
