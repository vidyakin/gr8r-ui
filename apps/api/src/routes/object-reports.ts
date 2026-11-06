/* Сводка о ходе работ по объекту (задача 1277, docs/architecture/construction.md): настройка расписания,
   отправка сейчас и печатный отчёт для заказчика.
   Путь /objects уже в TENANT_PATHS и модуле trade. Права: чтение — участник, запись расписания — admin+ или
   ответственный объекта, «Отправить сейчас» — member и выше, печать — участник. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { objectProgressReportData, objectReportSchedule, saveObjectReportSchedule, sendObjectDigest } from '@gr8r/db';
import { objectProgressReportQuery, objectReportScheduleSave, renderObjectProgressReport, uuid } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const objectIdParam = z.object({ id: uuid });

export const objectReportRoutes = new Hono<AppEnv>()
  // настройка «Сводка о ходе работ»: выключено по умолчанию, получатели по умолчанию — ответственный и прорабы
  .get('/:id/report-schedule', zValidator('param', objectIdParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await objectReportSchedule(ctx.db, c.req.valid('param').id));
  })
  // запись расписания: admin и выше или ответственный объекта (иначе 403 forbidden — проверяет сервис)
  .put('/:id/report-schedule', requireRole('member'), zValidator('param', objectIdParam, validationHook), zValidator('json', objectReportScheduleSave, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    return c.json(await saveObjectReportSchedule(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role }, id, c.req.valid('json')));
  })
  // «Отправить сводку сейчас»: то же самое немедленно, получателям из расписания (нет расписания — ответственный и прорабы)
  .post('/:id/report-now', requireRole('member'), zValidator('param', objectIdParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await sendObjectDigest(ctx.db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, c.req.valid('param').id, {}));
  })
  // печатный отчёт о ходе работ для заказчика: HTML A4 без внутренней себестоимости (почта отложена — задача 1092)
  .get('/:id/progress-report', zValidator('param', objectIdParam, validationHook), zValidator('query', objectProgressReportQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const { from, to } = c.req.valid('query');
    const data = await objectProgressReportData(ctx.db, c.req.valid('param').id, { from, to });
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderObjectProgressReport(data));
  });
