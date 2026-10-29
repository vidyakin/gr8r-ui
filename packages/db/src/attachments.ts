/* Вложения к любым объектам: версии, лимиты, квота воркспейса, права «как у объекта» (docs/architecture/attachments.md).
   Содержимое — в FileStore (S3), метаданные — attachments / attachment_versions под RLS арендатора. */
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { ATTACHMENT_ENTITY_TYPES, fileKindOf, type AttachmentEntityType, type Role } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { attachmentKey, getFileStore, sha256Hex, storageSettings, type FileStore } from './file-store';
import { assertLimit } from './licensing';
import { attachments, attachmentVersions, companies, contacts, contracts, deals, documents, leads, products, projectMembers, projects, tasks, workspaces } from './schema';

export type Attachment = typeof attachments.$inferSelect;
export type AttachmentVersion = typeof attachmentVersions.$inferSelect;

/** Кто делает запрос: участник воркспейса */
export interface Actor {
  workspaceId: string;
  memberId: string;
  role: Role;
}

const rank: Record<Role, number> = { guest: 0, member: 1, admin: 2, owner: 3 };
const atLeast = (r: Role, min: Role) => rank[r] >= rank[min];

/* ---------------- реестр типов объектов ---------------- */

/** Уровень доступа к объекту: none — объекта нет или он скрыт, read — видит, write — может править */
type Access = 'none' | 'read' | 'write';

/** Доступ к проекту: закрытый (is_private или access = private) видят участники проекта, лид и admin+; право на запись — не 'view' */
async function projectAccess(db: Db, a: Actor, projectId: string | null): Promise<Access> {
  if (!projectId) return 'none';
  const [p] = await db.select({ isPrivate: projects.isPrivate, access: projects.access, leadId: projects.leadId }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, a.workspaceId)));
  if (!p) return 'none';
  const canWrite = atLeast(a.role, 'member');
  if (!(p.isPrivate || p.access === 'private') || atLeast(a.role, 'admin') || p.leadId === a.memberId) return canWrite ? 'write' : 'read';
  const [pm] = await db.select({ permission: projectMembers.permission }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.memberId, a.memberId)));
  if (!pm) return 'none';
  return canWrite && pm.permission !== 'view' ? 'write' : 'read';
}

const plain = async (_db: Db, a: Actor, exists: Promise<unknown[]>): Promise<Access> => ((await exists).length ? (atLeast(a.role, 'member') ? 'write' : 'read') : 'none');

type Resolver = (db: Db, a: Actor, id: string) => Promise<Access>;

/** Реестр: как проверить существование и права на объект. Новый тип объекта — добавить сюда и в ATTACHMENT_ENTITY_TYPES */
const RESOLVERS: Record<AttachmentEntityType, Resolver> = {
  document: (db, a, id) => plain(db, a, db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, id), eq(documents.workspaceId, a.workspaceId)))),
  contract: (db, a, id) => plain(db, a, db.select({ id: contracts.id }).from(contracts).where(and(eq(contracts.id, id), eq(contracts.workspaceId, a.workspaceId)))),
  company: (db, a, id) => plain(db, a, db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, id), eq(companies.workspaceId, a.workspaceId)))),
  contact: (db, a, id) => plain(db, a, db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, id), eq(contacts.workspaceId, a.workspaceId)))),
  deal: (db, a, id) => plain(db, a, db.select({ id: deals.id }).from(deals).where(and(eq(deals.id, id), eq(deals.workspaceId, a.workspaceId)))),
  lead: (db, a, id) => plain(db, a, db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.workspaceId, a.workspaceId)))),
  product: (db, a, id) => plain(db, a, db.select({ id: products.id }).from(products).where(and(eq(products.id, id), eq(products.workspaceId, a.workspaceId)))),
  project: (db, a, id) => projectAccess(db, a, id),
  task: async (db, a, id) => {
    const [t] = await db.select({ projectId: tasks.projectId }).from(tasks).where(and(eq(tasks.id, id), eq(tasks.workspaceId, a.workspaceId)));
    return t ? projectAccess(db, a, t.projectId) : 'none';
  },
};

const isEntityType = (v: string): v is AttachmentEntityType => (ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(v);

export async function entityAccess(db: Db, a: Actor, type: string, id: string): Promise<Access> {
  return isEntityType(type) ? RESOLVERS[type](db, a, id) : 'none';
}

const notFound = () => new DomainError(404, 'not_found', 'Attachment not found');

/** Вложение с проверкой доступа к объекту. Скрытый объект и чужой воркспейс — 404 */
async function load(db: Db, a: Actor, id: string, need: 'read' | 'write'): Promise<Attachment> {
  const [row] = await db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.workspaceId, a.workspaceId)));
  if (!row) throw notFound();
  const acc = await entityAccess(db, a, row.entityType, row.entityId);
  if (acc === 'none') throw notFound();
  if (need === 'write' && acc !== 'write') throw new DomainError(403, 'forbidden', 'No permission to change this object');
  return row;
}

/* ---------------- квота ---------------- */

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number | null;
  /** quota задана самим воркспейсом (иначе — значение по умолчанию из окружения) */
  custom: boolean;
  maxFileBytes: number;
}

const usedBytes = async (db: Db) => Number(((await db.execute(sql`select app_workspace_usage() as u`)) as unknown as { u: { storageBytes: number } }[])[0]!.u.storageBytes);

export async function storageUsage(db: Db, workspaceId: string): Promise<StorageUsage> {
  const [w] = await db.select({ q: workspaces.storageQuotaBytes }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const s = storageSettings();
  return { usedBytes: await usedBytes(db), quotaBytes: w?.q ?? s.defaultQuotaBytes, custom: w?.q != null, maxFileBytes: s.maxFileBytes };
}

/** Квота меняется владельцем (проверка роли — в маршруте); null — вернуть значение по умолчанию */
export async function setStorageQuota(db: Db, workspaceId: string, quotaBytes: number | null): Promise<StorageUsage> {
  await db.update(workspaces).set({ storageQuotaBytes: quotaBytes, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
  return storageUsage(db, workspaceId);
}

async function assertRoom(db: Db, workspaceId: string, add: number): Promise<void> {
  const u = await storageUsage(db, workspaceId);
  if (add > u.maxFileBytes) throw new DomainError(422, 'attachment_too_large', `File is larger than ${u.maxFileBytes} bytes`, { maxBytes: u.maxFileBytes });
  if (u.quotaBytes !== null && u.usedBytes + add > u.quotaBytes) throw new DomainError(422, 'storage_quota_exceeded', 'Workspace storage quota exceeded', { usedBytes: u.usedBytes, quotaBytes: u.quotaBytes, addBytes: add });
  await assertLimit(db, 'storageMb', add); // лимит объёма тарифа (лицензия)
}

/* ---------------- чтение ---------------- */

export interface AttachmentView extends Attachment {
  sizeBytes: number;
  mime: string | null;
  versionCount: number;
  /** Проект объекта (для файлов задач и проектов), иначе null */
  projectId: string | null;
}

export interface AttachmentFilter {
  entityType?: string;
  entityTypes?: string[];
  entityId?: string;
  q?: string;
  archived?: boolean;
}

/** Список вложений, доступных участнику: по объекту или по типам (файлы задач и проектов одним запросом) */
export async function listAttachments(db: Db, a: Actor, f: AttachmentFilter): Promise<AttachmentView[]> {
  const types = [...(f.entityTypes ?? []), ...(f.entityType ? [f.entityType] : [])].filter(isEntityType);
  const rows = await db
    .select({
      att: attachments,
      sizeBytes: attachmentVersions.sizeBytes,
      mime: attachmentVersions.mime,
      versionCount: sql<number>`(select count(*)::int from ${attachmentVersions} v where v.attachment_id = ${attachments.id})`,
      taskProject: tasks.projectId,
    })
    .from(attachments)
    .innerJoin(attachmentVersions, and(eq(attachmentVersions.attachmentId, attachments.id), eq(attachmentVersions.version, attachments.currentVersion)))
    .leftJoin(tasks, and(eq(attachments.entityType, 'task'), eq(tasks.id, attachments.entityId)))
    .where(
      and(
        eq(attachments.workspaceId, a.workspaceId),
        types.length ? inArray(attachments.entityType, types) : undefined,
        f.entityId ? eq(attachments.entityId, f.entityId) : undefined,
        f.q ? ilike(attachments.name, `%${f.q.replace(/[\\%_]/g, m => '\\' + m)}%`) : undefined,
        f.archived ? isNotNull(attachments.archivedAt) : isNull(attachments.archivedAt),
      ),
    )
    .orderBy(desc(attachments.createdAt))
    .limit(1000);
  // Права проверяем один раз на объект
  const cache = new Map<string, Access>();
  const out: AttachmentView[] = [];
  for (const r of rows) {
    const key = `${r.att.entityType}:${r.att.entityId}`;
    let acc = cache.get(key);
    if (!acc) cache.set(key, (acc = await entityAccess(db, a, r.att.entityType, r.att.entityId)));
    if (acc === 'none') continue;
    out.push({ ...r.att, sizeBytes: r.sizeBytes, mime: r.mime, versionCount: r.versionCount, projectId: r.att.entityType === 'project' ? r.att.entityId : r.taskProject });
  }
  return out;
}

export async function getAttachment(db: Db, a: Actor, id: string): Promise<{ attachment: Attachment; versions: AttachmentVersion[] }> {
  const attachment = await load(db, a, id, 'read');
  const versions = await db.select().from(attachmentVersions).where(eq(attachmentVersions.attachmentId, id)).orderBy(desc(attachmentVersions.version));
  return { attachment, versions };
}

/** Содержимое версии (по умолчанию текущей) */
export async function readContent(db: Db, a: Actor, id: string, version?: number): Promise<{ name: string; mime: string; data: Uint8Array }> {
  const att = await load(db, a, id, 'read');
  const [v] = await db
    .select()
    .from(attachmentVersions)
    .where(and(eq(attachmentVersions.attachmentId, id), eq(attachmentVersions.version, version ?? att.currentVersion)));
  if (!v) throw notFound();
  const store = requireStore();
  const data = v.storageKey ? await store.get(v.storageKey) : null;
  if (!data) throw new DomainError(404, 'file_content_missing', 'File content is not available');
  return { name: att.name, mime: v.mime || 'application/octet-stream', data };
}

/* ---------------- запись ---------------- */

const requireStore = (): FileStore => {
  const s = getFileStore();
  if (!s) throw new DomainError(503, 'storage_unavailable', 'File storage is not configured');
  return s;
};

export interface UploadInput {
  name: string;
  mime?: string | null;
  data: Uint8Array;
  comment?: string;
}

/** Сохраняет объект в сторе, затем строку версии; если запись в БД не удалась, объект убирается (иначе его подберёт сборка мусора) */
async function putVersion(db: Db, a: Actor, attachmentId: string, version: number, input: UploadInput): Promise<AttachmentVersion> {
  const store = requireStore();
  const key = attachmentKey(a.workspaceId, attachmentId, version);
  await store.put(key, input.data, input.mime);
  try {
    const [row] = await db
      .insert(attachmentVersions)
      .values({ workspaceId: a.workspaceId, attachmentId, version, storageKey: key, sizeBytes: input.data.length, mime: input.mime ?? null, sha256: sha256Hex(input.data), comment: input.comment ?? '', createdBy: a.memberId })
      .returning();
    return row!;
  } catch (e) {
    await store.delete(key).catch(() => {});
    throw e;
  }
}

/** Новое вложение: версия 1. Нужно право на запись в объект */
export async function createAttachment(db: Db, a: Actor, entityType: string, entityId: string, input: UploadInput): Promise<{ attachment: Attachment; version: AttachmentVersion }> {
  if (!isEntityType(entityType)) throw new DomainError(400, 'bad_request', 'Unknown entity type');
  const acc = await entityAccess(db, a, entityType, entityId);
  if (acc === 'none') throw new DomainError(404, 'not_found', 'Object not found');
  if (acc !== 'write') throw new DomainError(403, 'forbidden', 'No permission to change this object');
  await assertRoom(db, a.workspaceId, input.data.length);
  const [att] = await db
    .insert(attachments)
    .values({ workspaceId: a.workspaceId, entityType, entityId, name: input.name, kind: fileKindOf(input.name), currentVersion: 1, createdBy: a.memberId })
    .returning();
  const version = await putVersion(db, a, att!.id, 1, input);
  await recordEvent(db, { workspaceId: a.workspaceId, type: 'attachment.created', entity: 'attachment', recordId: att!.id, actorId: a.memberId, payload: { entityType, entityId, name: input.name, size: input.data.length } });
  return { attachment: att!, version };
}

/** Новая версия поверх файла; имя вложения остаётся (если не передано новое) */
export async function addVersion(db: Db, a: Actor, id: string, input: UploadInput & { rename?: boolean }): Promise<{ attachment: Attachment; version: AttachmentVersion }> {
  const att = await load(db, a, id, 'write');
  if (att.archivedAt) throw new DomainError(409, 'attachment_archived', 'Attachment is archived');
  await assertRoom(db, a.workspaceId, input.data.length);
  // Номер версии занимаем атомарным UPDATE, параллельная загрузка получит следующий
  const [bumped] = await db.update(attachments).set({ currentVersion: sql`${attachments.currentVersion} + 1`, ...(input.rename ? { name: input.name, kind: fileKindOf(input.name) } : {}) }).where(eq(attachments.id, id)).returning();
  const version = await putVersion(db, a, id, bumped!.currentVersion, input);
  await recordEvent(db, { workspaceId: a.workspaceId, type: 'attachment.version_added', entity: 'attachment', recordId: id, actorId: a.memberId, payload: { version: version.version, size: input.data.length } });
  return { attachment: bumped!, version };
}

export async function renameAttachment(db: Db, a: Actor, id: string, patch: { name?: string; kind?: Attachment['kind'] }): Promise<Attachment> {
  await load(db, a, id, 'write');
  const set: Partial<Attachment> = {};
  if (patch.name) set.name = patch.name;
  if (patch.kind) set.kind = patch.kind;
  if (!Object.keys(set).length) return load(db, a, id, 'write');
  const [row] = await db.update(attachments).set(set).where(eq(attachments.id, id)).returning();
  await recordEvent(db, { workspaceId: a.workspaceId, type: 'attachment.updated', entity: 'attachment', recordId: id, actorId: a.memberId, payload: set });
  return row!;
}

/** В архив: автор вложения или admin+ (и право на запись в объект) */
export async function archiveAttachment(db: Db, a: Actor, id: string): Promise<void> {
  const att = await load(db, a, id, 'write');
  if (att.createdBy !== a.memberId && !atLeast(a.role, 'admin')) throw new DomainError(403, 'forbidden', 'Only the author or an admin can archive a file');
  if (att.archivedAt) return;
  await db.update(attachments).set({ archivedAt: new Date() }).where(eq(attachments.id, id));
  await recordEvent(db, { workspaceId: a.workspaceId, type: 'attachment.archived', entity: 'attachment', recordId: id, actorId: a.memberId, payload: { entityType: att.entityType, entityId: att.entityId } });
}

/** Вернуть из архива: те же правила; квота проверяется заново */
export async function restoreAttachment(db: Db, a: Actor, id: string): Promise<Attachment> {
  const att = await load(db, a, id, 'write');
  if (att.createdBy !== a.memberId && !atLeast(a.role, 'admin')) throw new DomainError(403, 'forbidden', 'Only the author or an admin can restore a file');
  if (!att.archivedAt) return att;
  const [size] = await db.select({ s: sql<number>`coalesce(sum(${attachmentVersions.sizeBytes}), 0)::bigint` }).from(attachmentVersions).where(eq(attachmentVersions.attachmentId, id));
  const u = await storageUsage(db, a.workspaceId);
  if (u.quotaBytes !== null && u.usedBytes + Number(size!.s) > u.quotaBytes) throw new DomainError(422, 'storage_quota_exceeded', 'Workspace storage quota exceeded', { usedBytes: u.usedBytes, quotaBytes: u.quotaBytes });
  const [row] = await db.update(attachments).set({ archivedAt: null }).where(eq(attachments.id, id)).returning();
  await recordEvent(db, { workspaceId: a.workspaceId, type: 'attachment.restored', entity: 'attachment', recordId: id, actorId: a.memberId, payload: {} });
  return row!;
}

/** Удаление (архивирование) объекта архивирует и его вложения. Вызывается из crud() и маршрутов удаления */
export async function archiveAttachmentsOf(db: Db, workspaceId: string, entityType: string, entityId: string): Promise<void> {
  if (!isEntityType(entityType)) return;
  await db.update(attachments).set({ archivedAt: new Date() }).where(and(eq(attachments.workspaceId, workspaceId), eq(attachments.entityType, entityType), eq(attachments.entityId, entityId), isNull(attachments.archivedAt)));
}

/* ---------------- сборка мусора (воркер) ---------------- */

export interface GcResult {
  archivedObjects: number;
  orphanObjects: number;
}

/** Удаляет из хранилища объекты вложений, архивных дольше retentionDays, и осиротевшие ключи (нет строки версии, старше суток).
    Выполняется воркером мимо RLS (роль app_worker); db — соединение воркера */
export async function collectAttachmentGarbage(db: Db, store: FileStore, retentionDays = storageSettings().archiveRetentionDays, now = new Date()): Promise<GcResult> {
  const res: GcResult = { archivedObjects: 0, orphanObjects: 0 };
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const old = await db
    .select({ id: attachmentVersions.id, key: attachmentVersions.storageKey })
    .from(attachmentVersions)
    .innerJoin(attachments, and(eq(attachments.workspaceId, attachmentVersions.workspaceId), eq(attachments.id, attachmentVersions.attachmentId)))
    .where(and(isNotNull(attachmentVersions.storageKey), isNotNull(attachments.archivedAt), lt(attachments.archivedAt, cutoff)))
    .limit(500);
  for (const v of old) {
    await store.delete(v.key!);
    await db.update(attachmentVersions).set({ storageKey: null }).where(eq(attachmentVersions.id, v.id));
    res.archivedObjects++;
  }
  const known = new Set((await db.select({ key: attachmentVersions.storageKey }).from(attachmentVersions).where(isNotNull(attachmentVersions.storageKey))).map(r => r.key));
  const dayAgo = now.getTime() - 86_400_000;
  for (const o of await store.list('')) {
    if (known.has(o.key) || o.lastModified.getTime() > dayAgo) continue;
    await store.delete(o.key);
    res.orphanObjects++;
  }
  return res;
}
