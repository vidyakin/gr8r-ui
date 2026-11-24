/* Аутентификация, права и общие схемы запросов для публичного REST API v1 (задача 1392). */
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { TOKEN_PATH_SECTIONS, isoDate, isoDateTime, queryBool, uuid, type ModuleId, type PositionSection } from '@erp/shared';
import { AppError } from '../../errors';
import { requireModule, requireSection, requireSession, tenant } from '../../middleware';
import type { AppEnv } from '../../types';

const hasBearer = (h: string | undefined) => !!h && /^bearer\s+\S/i.test(h);

/** Публичный API v1 принимает только Bearer-токен (без cookie-сессий) */
export const requireV1Bearer = createMiddleware<AppEnv>(async (c, next) => {
  if (!hasBearer(c.req.header('authorization'))) {
    throw new AppError(401, 'token_required', 'API v1 requires an access token (Authorization: Bearer)');
  }
  await next();
});

export const v1AuthChain = [requireV1Bearer, requireSession, tenant('token')] as const;

/** Проверка разделов токена, модуля лицензии и раздела должности для ресурса v1 */
export function requireV1Scope(internalRoot: string, moduleId: ModuleId = 'core', section?: PositionSection) {
  const modMw = moduleId !== 'core' ? requireModule(moduleId) : null;
  const secMw = section ? requireSection(section) : null;
  return createMiddleware<AppEnv>(async (c, next) => {
    const apiToken = c.get('apiToken');
    const allowedSections = TOKEN_PATH_SECTIONS.get(internalRoot);
    if (apiToken && allowedSections && apiToken.sections && !allowedSections.some(s => apiToken.sections!.includes(s))) {
      throw new AppError(403, 'token_section_forbidden', `The access token is not allowed to use "${internalRoot}"`, { sections: allowedSections });
    }
    const runSec = async () => {
      if (secMw) await secMw(c, next);
      else await next();
    };
    if (modMw) {
      await modMw(c, runSec);
      return;
    }
    await runSec();
  });
}

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const updatedSinceField = isoDateTime.or(isoDate);

export const v1ProductQuery = paging.extend({
  q: z.string().trim().max(200).optional(),
  sku: z.string().trim().max(100).optional(),
  categoryId: uuid.optional(),
  kind: z.enum(['goods', 'service']).optional(),
  active: queryBool.optional(),
  updatedSince: updatedSinceField.optional(),
});

export const v1StockQuery = paging.extend({
  warehouseId: uuid.optional(),
  productId: uuid.optional(),
  q: z.string().trim().max(200).optional(),
  nonZero: queryBool.optional(),
});

export const v1PriceQuery = paging.extend({
  kindId: uuid.optional(),
  categoryId: uuid.optional(),
  date: isoDate.optional(),
  q: z.string().trim().max(200).optional(),
  inStock: queryBool.optional(),
});

export const v1CompanyQuery = paging.extend({
  q: z.string().trim().max(200).optional(),
  role: z.enum(['customer', 'supplier']).optional(),
  inn: z.string().trim().max(20).optional(),
  updatedSince: updatedSinceField.optional(),
});

export const v1WarehouseQuery = paging.extend({
  q: z.string().trim().max(200).optional(),
  updatedSince: updatedSinceField.optional(),
});

export const v1DocumentQuery = paging.extend({
  type: z.string().trim().max(50).optional(),
  status: z.enum(['draft', 'posted', 'cancelled']).optional(),
  counterpartyId: uuid.optional(),
  warehouseId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  updatedSince: updatedSinceField.optional(),
  q: z.string().trim().max(200).optional(),
});

export const parseUpdatedSince = (raw: string | undefined): Date | undefined => (raw ? new Date(raw) : undefined);
