/* Добыча (модуль mining): журнал взвешиваний (весовая). Английский словарь — источник ключей */
import type { Widen } from '../types';
import type { mining as M } from '../en/mining';

export const mining: Widen<typeof M> = {
  title: 'Весовая',
  lead: 'Взвешивания машин: брутто, тара, нетто и объём по насыпной плотности',
  new: 'Новое взвешивание',
  edit: 'Взвешивание',
  delete: 'Удалить',
  search: 'Поиск',
  filter: { all: 'Все', out: 'Отгрузка', in: 'Приёмка' },
  kpi: { count: 'Взвешиваний', net: 'Нетто всего, т', volume: 'Объём всего, м³' },
  col: { number: 'Номер', date: 'Дата', direction: 'Направление', vehicle: 'Машина', counterparty: 'Контрагент', product: 'Товар', gross: 'Брутто, кг', tare: 'Тара, кг', net: 'Нетто, кг', volume: 'Объём, м³', waybill: 'Путевой лист', source: 'Источник' },
  direction: { out: 'Отгрузка', in: 'Приёмка' },
  source: { manual: 'Вручную', scale_api: 'Scale API' },
  form: { plate: 'Госномер', driver: 'Водитель', density: 'Насыпная плотность, т/м³', notes: 'Комментарий', none: '—', calcNet: 'Нетто, кг, t', calcVolume: 'Объём, м³', noDensity: 'укажите насыпную плотность товара, чтобы получить объём' },
  api: { title: 'Scale API', hint: 'Мост весов (COM/TCP) отправляет взвешивание запросом POST /weighings с токеном агента:' },
  empty: 'Взвешиваний пока нет',
  emptyHint: 'Добавьте взвешивание вручную или подключите мост весов',
  unit: { t: 't', kg: 'kg', m3: 'm³' },
};
