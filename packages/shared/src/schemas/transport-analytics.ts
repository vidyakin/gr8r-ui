/* zod-схема запроса аналитики транспорта (задача 1216). */
import { z } from 'zod';
import { isoDate } from './common';

export const transportAnalyticsQuery = z.object({
  from: isoDate,
  to: isoDate,
});
