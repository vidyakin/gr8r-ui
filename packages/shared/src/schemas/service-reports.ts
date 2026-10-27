/* zod-запросы отчётов услуг (задача 1097), раздел docs/architecture/service-reports.md. */
import { z } from 'zod';
import { isoDate, uuid } from './common';

/** Общие отборы: период, клиент, исполнитель (участник), вид заказ-наряда; today нужен просрочке и тестам */
const base = {
  from: isoDate,
  to: isoDate,
  counterpartyId: uuid.optional(),
  assigneeId: uuid.optional(),
  kindId: uuid.optional(),
  today: isoDate.optional(),
};

export const serviceStatesReportQuery = z.object(base);
export const serviceScheduleReportQuery = z.object(base);
export const serviceLoadReportQuery = z.object(base);
export const serviceClientsReportQuery = z.object(base);
