/* Настройки → Интеграции → 1С (задача 1226): таблица соответствий объектов */
import type { Widen } from '../types';
import type { icLinks as L } from '../en/ic-links';

export const icLinks: Widen<typeof L> = {
  title: 'Сопоставления с 1С',
  lead: 'Свяжите записи воркспейса с существующими объектами 1С по GUID.',
  source: 'Конфигурация',
  sources: { buh3: '1С:Бухгалтерия 3.0', ut: '1С:Управление торговлей' },
  entityType: 'Тип объекта',
  types: { organization: 'Организация', company: 'Контрагент', product: 'Номенклатура', bank_account: 'Банковский счёт', document: 'Документ', contract: 'Договор', warehouse: 'Склад' },
  count: '{n} связей',
  add: 'Связать вручную',
  link: 'Связать',
  linked: 'Объекты связаны',
  ourId: 'id нашей записи',
  guid: 'GUID 1С',
  name1c: 'Имя в 1С',
  matchedBy: 'Как сопоставлено',
  manual: 'Вручную',
  auto: 'Авто ({rule})',
  generated: 'При выгрузке',
  refresh: 'Обновить сопоставления',
  updated: 'Обновлено',
  unlink: 'Разорвать связь',
  unlinked: 'Связь удалена',
  confirmUnlink: 'Разорвать связь «{name}»? Объекты останутся на месте; обмен посчитает их новыми.',
  empty: 'Связей пока нет',
  emptyHint: 'Добавьте сопоставление вручную или сохраните новые GUID при выгрузке.',
  autoHint: 'Если запись уже есть в 1С, укажите её GUID перед выгрузкой.',
};
