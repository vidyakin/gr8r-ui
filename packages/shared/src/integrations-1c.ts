/* Соответствие объектов с 1С (задача 1226): валидация API /integrations/1c/links */
import { z } from 'zod';
import { uuid } from './schemas/common';

/** Конфигурация-источник GUID */
export const IC_SOURCES = ['buh3', 'ut'] as const;
/** Типы сопоставляемых объектов */
const refUuid = z.string().trim().regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\})$/i)
  .transform(value => value.replace(/[{}]/g, '').toLowerCase());

export const IC_ENTITY_TYPES = ['organization', 'company', 'product', 'bank_account', 'document', 'contract', 'warehouse'] as const;

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
