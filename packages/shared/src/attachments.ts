/* Вложения к объектам (docs/architecture/attachments.md): реестр допустимых типов объектов, лимиты, вид файла по имени. */
import { z } from 'zod';
import { FILE_KINDS } from './constants';
import type { FileKind } from './domain';

/** Типы объектов, к которым прикрепляются файлы. Новый тип — добавить сюда и в реестр сервиса (packages/db/src/attachments.ts) */
export const ATTACHMENT_ENTITY_TYPES = ['document', 'contract', 'company', 'contact', 'deal', 'lead', 'task', 'project', 'product'] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

/** Предел размера одного файла по умолчанию, байт (окружение FILE_MAX_BYTES) */
export const FILE_MAX_BYTES_DEFAULT = 50 * 1024 * 1024;


const KIND_BY_EXT: Record<string, FileKind> = {
  fig: 'fig', pdf: 'pdf', zip: 'zip', rar: 'zip', '7z': 'zip', gz: 'zip', tar: 'zip',
  png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', svg: 'img', bmp: 'img',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ods: 'sheet',
  doc: 'doc', docx: 'doc', odt: 'doc', txt: 'doc', rtf: 'doc', md: 'doc', ppt: 'doc', pptx: 'doc',
  js: 'code', ts: 'code', tsx: 'code', json: 'code', html: 'code', css: 'code', xml: 'code', py: 'code',
};

/** Вид файла по расширению имени */
export function fileKindOf(name: string): FileKind {
  const m = /\.([^.]+)$/.exec(name.trim().toLowerCase());
  return (m && KIND_BY_EXT[m[1]!]) || 'other';
}

const uuid = z.string().uuid();

export const attachmentQuery = z.object({
  entityType: z.enum(ATTACHMENT_ENTITY_TYPES).optional(),
  /** Несколько типов через запятую (файлы задач и проектов одним запросом) */
  entityTypes: z.string().max(200).optional(),
  entityId: uuid.optional(),
  q: z.string().max(200).optional(),
  archived: z.enum(['0', '1']).optional(),
});
export const attachmentUpdate = z.object({ name: z.string().trim().min(1).max(255).optional(), kind: z.enum(FILE_KINDS).optional() }).strict();
export const attachmentQuotaBody = z.object({ storageQuotaBytes: z.number().int().nonnegative().nullable() }).strict();
