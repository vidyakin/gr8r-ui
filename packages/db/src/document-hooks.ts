/* Хуки типа документа: то, что не лезет в общий код проведения (выпуск продукции со списанием материалов и себестоимостью).
   Реестр живёт отдельно от сервиса документов, чтобы сервис производства мог зарегистрировать свои хуки без цикла импорта. */
import type { DocumentType } from '@gr8r/shared';
import type { Db } from './client';
import type { DocCtx, DocumentLineRow, DocumentRow } from './documents';

export interface DocumentHooks {
  /** Проверки до проведения: свой документ проверяет состав сам (строк в document_lines может не быть) */
  check?: (db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]) => Promise<void>;
  /** Проведение целиком: движения склада и себестоимость */
  post?: (db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]) => Promise<void>;
  /** После проведения: резервы, записи о факте */
  afterPost?: (db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]) => Promise<void>;
  /** После отмены проведения: снятие резервов, записи о факте */
  afterUnpost?: (db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]) => Promise<void>;
}

/** Хуки по типу документа: заполняет сервис типа (packages/db/src/production.ts) */
export const DOCUMENT_HOOKS: Partial<Record<DocumentType, DocumentHooks>> = {};
