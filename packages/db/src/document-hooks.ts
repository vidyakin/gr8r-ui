/* Хуки типа документа: то, что не лезет в общий код проведения (выпуск продукции со списанием материалов и себестоимостьом).
   Реестр живёт отдельно от сервиса документов, чтобы сервис производства мог зарегистрировать свои хуки без цикла импорта. */
import type { DocumentType } from '@gr8r/shared';
import type { Db } from './client';
import type { DocCtx, DocumentLineRow, DocumentRow } from './documents';

export interface DocumentHooks {
  /** Проверки до проведения: свой документ проверяет состав сам (строк в document_lines может не быть) */
  check?: (db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]) => Promise<void>;
  /** Проведение целиком: движения склада и себестоимость */
  post?: (db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]) => Promise<void>;
  /** Проверки до отмены проведения: свой документ решает, можно ли его снимать (этап 4б: промежуточный этап) */
  beforeUnpost?: (db: Db, ctx: DocCtx, doc: DocumentRow) => Promise<void>;
  /** После проведения: резервы, записи о факте */
  afterPost?: (db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]) => Promise<void>;
  /** После отмены проведения: снятие резервов, записи о факте */
  afterUnpost?: (db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]) => Promise<void>;
}

/** Хуки по типу документа: заполняет сервис типа (packages/db/src/production.ts, packages/db/src/internal-ops.ts) */
export const DOCUMENT_HOOKS: Partial<Record<DocumentType, DocumentHooks>> = {};

/** Хук смены состояния документа: перемещение «в пути» (этап 0б), заказ на производство (этап 2), заказ-наряд (план услуг).
    Вызывается после записи состояния — хук делает движения склада (приёмка) или отменяет их */
export type StateHook = (db: Db, ctx: DocCtx, doc: DocumentRow, from: string | null, to: string, payload?: StatePayload) => Promise<void>;

/** Дополнительные данные смены состояния: принятые количества (перемещение «в пути») */
export interface StatePayload {
  /** Принятое количество по строкам документа */
  received?: { id: string; qty: string }[];
}

export const STATE_HOOKS: Partial<Record<DocumentType, StateHook>> = {};
