/* Соответствие объектов с 1С (задача 1226): валидация API /integrations/1c/links */
import { z } from 'zod';
import { uuid } from './schemas/common';

/** Конфигурация-источник GUID */
export const IC_SOURCES = ['buh3', 'ut', 'unf'] as const;
/** Типы сопоставляемых объектов */
const refUuid = z.string().trim().regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\})$/i)
  .transform(value => value.replace(/[{}]/g, '').toLowerCase());

export const IC_ENTITY_TYPES = ['organization', 'company', 'product', 'bank_account', 'document', 'contract', 'warehouse', 'cash_register'] as const;

/** Ручное сопоставление: наш объект + ссылка 1С */
export const icLinkCreate = z
  .object({
    source: z.enum(IC_SOURCES),
    entityType: z.enum(IC_ENTITY_TYPES),
    entityId: uuid,
    refUuid,
    refName: z.string().trim().max(255).optional(),
  })
  .strict();
export type IcLinkCreate = z.infer<typeof icLinkCreate>;

/** Разрыв связи: наш объект */
export const icLinkDelete = z
  .object({
    source: z.enum(IC_SOURCES),
    entityType: z.enum(IC_ENTITY_TYPES),
    entityId: uuid,
  })
  .strict();
export type IcLinkDelete = z.infer<typeof icLinkDelete>;

/** Автопоиск: кандидаты из 1С (GUID + данные для правил) */
export const icAutoMatchQuery = z
  .object({
    source: z.enum(IC_SOURCES),
    entityType: z.enum(IC_ENTITY_TYPES),
    /** применить найденное (без — dry-run предпросмотр) */
    apply: z.boolean().optional(),
    candidates: z
      .array(
        z
          .object({
            refUuid,
            refName: z.string().trim().max(255).optional(),
            inn: z.string().trim().max(12).optional(),
            kpp: z.string().trim().max(9).optional(),
            ogrn: z.string().trim().max(15).optional(),
            sku: z.string().trim().max(100).optional(),
            barcode: z.string().trim().max(64).optional(),
            name: z.string().trim().max(255).optional(),
            kind: z.enum(['goods', 'service']).optional(),
            bik: z.string().trim().max(9).optional(),
            account: z.string().trim().max(20).optional(),
            number: z.string().trim().max(64).optional(),
            date: z.string().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export type IcAutoMatchQuery = z.infer<typeof icAutoMatchQuery>;

const exchangeDate = z.iso.date().refine(date => !date.startsWith('0000-'));
export const icUploadSource = z.object({ source: z.enum(IC_SOURCES) }).strict();
export const icImportApplyQuery = icUploadSource.extend({
  catalogTypes: z.string().transform(value => value ? value.split(',') : [])
    .pipe(z.array(z.enum(IC_ENTITY_TYPES.filter(type => type !== 'document'))).max(IC_ENTITY_TYPES.length - 1)),
  date: exchangeDate.optional(),
  stock: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  money: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  settlements: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  post: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
}).refine(value => !(value.stock || value.money || value.settlements) || value.date, {
  path: ['date'], message: 'Select the opening date',
});
export type IcImportOptions = Omit<z.output<typeof icImportApplyQuery>, 'source'>;

export const icReconcileQuery = icUploadSource.extend({ dateFrom: exchangeDate, dateTo: exchangeDate, organizationId: uuid.optional() })
  .refine(value => value.dateFrom <= value.dateTo, { path: ['dateTo'], message: 'End date must be on or after start date' });
export type IcReconcileOptions = Omit<z.output<typeof icReconcileQuery>, 'source'>;
