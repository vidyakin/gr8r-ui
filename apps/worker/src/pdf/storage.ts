/* Хранилище сформированных PDF. Интерфейс отделён от реализации: сейчас файл лежит в БД (document_files.data), потом — S3/MinIO
   (по ключу storage_key). API читает файл тем же путём, поэтому смена хранилища не меняет ни задачу, ни маршруты. */
import { eq } from 'drizzle-orm';
import { documentFiles, type Db } from '@gr8r/db';

export interface PdfFileRef {
  id: string;
  workspaceId: string;
}

export interface PdfStore {
  /** Сохраняет готовый PDF и помечает файл готовым */
  save(db: Db, file: PdfFileRef, bytes: Uint8Array): Promise<void>;
}

/** Хранение в PostgreSQL (bytea): ничего не требует от окружения, подходит для печатных форм в десятки килобайт */
export const dbPdfStore: PdfStore = {
  async save(db, file, bytes) {
    await db
      .update(documentFiles)
      .set({ status: 'ready', data: Buffer.from(bytes), size: bytes.length, error: null, finishedAt: new Date() })
      .where(eq(documentFiles.id, file.id));
  },
};

/** Заготовка под S3: ключ вида `<workspace>/documents/<file>.pdf`, в БД остаются только метаданные и storage_key.
    Реализуется вместе с загрузкой файлов (печать и подписи организаций) на этапе с MinIO */
export const s3PdfStore: PdfStore = {
  async save() {
    throw new Error('S3 storage for PDF files is not implemented yet: use PDF_STORE=db');
  },
};

export function pdfStoreFromEnv(env: Record<string, string | undefined> = process.env): PdfStore {
  return env.PDF_STORE === 's3' ? s3PdfStore : dbPdfStore;
}
