/* Справочник «Этапы»: виды производства и их упорядоченные этапы (как в 1С:УНФ — «Настройки этапов производства»).
   Для каждого вида производства — свой список этапов; последний этап финальный («Завершение производства»):
   продукция приходуется только им. Спецификация без вида производства работает как раньше — единственный
   предопределённый этап «Завершение производства» (PRODUCTION_STAGES в shared).

   Правила — docs/architecture.md, раздел «Виды производства и этапы». */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import type { DocCtx } from './documents';
import { bomLines, manufacturedItems, productionComponents, productionHeaders, productionItems, productionKinds, productionStages } from './schema';
import { uuidv7 } from './uuid';

/** Этап выпуска: id пустой — предопределённый этап «Завершение производства» (вид производства не задан) */
export interface StageDef {
  id: string | null;
  name: string;
  sortOrder: number;
  /** Финальный этап: продукция приходуется только им */
  isFinal: boolean;
}

/** Вид производства с этапами */
export interface KindWithStages {
  id: string;
  name: string;
  note: string;
  archivedAt: Date | null;
  stages: StageDef[];
}

/** План этапов изделия: этапы его вида производства или единственный предопределённый этап */
export interface ItemStagePlan {
  /** Вид производства изделия; пусто — этапов нет, единственный этап «Завершение производства» */
  kindId: string | null;
  stages: StageDef[];
}

/** Предопределённый этап для изделия без вида производства */
export const FINAL_STAGE: StageDef = { id: null, name: 'Completion of production', sortOrder: 0, isFinal: true };

/** Ключ этапа во внутренних расчётах: id этапа или признак предопределённого этапа */
export const stageKey = (id: string | null): string => id ?? 'final';

/** Все виды производства с этапами */
export async function listProductionKinds(db: Db, _workspaceId: string, includeArchived = false): Promise<KindWithStages[]> {
  const kinds = await db.select().from(productionKinds).where(includeArchived ? undefined : isNull(productionKinds.archivedAt)).orderBy(asc(productionKinds.name));
  const stages = kinds.length ? await db.select().from(productionStages).where(inArray(productionStages.kindId, kinds.map(k => k.id))).orderBy(asc(productionStages.sortOrder), asc(productionStages.createdAt)) : [];
  return kinds.map(k => ({
    id: k.id,
    name: k.name,
    note: k.note,
    archivedAt: k.archivedAt,
    stages: stages.filter(s => s.kindId === k.id).map(s => ({ id: s.id, name: s.name, sortOrder: s.sortOrder, isFinal: s.isFinal })),
  }));
}

/** Этапы вида производства */
export async function stagesOfKind(db: Db, kindId: string): Promise<StageDef[]> {
  const rows = await db.select().from(productionStages).where(eq(productionStages.kindId, kindId)).orderBy(asc(productionStages.sortOrder), asc(productionStages.createdAt));
  return rows.map(s => ({ id: s.id, name: s.name, sortOrder: s.sortOrder, isFinal: s.isFinal }));
}

/** План этапов изделия: вид производства спецификации задаёт этапы, без него — единственный этап */
export async function itemStagePlan(db: Db, itemId: string): Promise<ItemStagePlan> {
  const [item] = await db.select({ kindId: manufacturedItems.productionKindId }).from(manufacturedItems).where(eq(manufacturedItems.id, itemId)).limit(1);
  if (!item?.kindId) return { kindId: null, stages: [FINAL_STAGE] };
  const stages = await stagesOfKind(db, item.kindId);
  return { kindId: item.kindId, stages: stages.length ? stages : [FINAL_STAGE] };
}

/** Этапы по id — для рабочего места и карточек */
export async function loadStageDefs(db: Db): Promise<Map<string, StageDef>> {
  const rows = await db.select().from(productionStages);
  return new Map(rows.map(s => [s.id, { id: s.id, name: s.name, sortOrder: s.sortOrder, isFinal: s.isFinal }]));
}

/** Этап выпуска по id: null — предопределённый этап «Завершение производства» */
export async function stageDef(db: Db, stageId: string | null): Promise<StageDef> {
  if (!stageId) return FINAL_STAGE;
  const [row] = await db.select().from(productionStages).where(eq(productionStages.id, stageId)).limit(1);
  if (!row) throw new DomainError(422, 'invalid_reference', 'The stage does not exist');
  return { id: row.id, name: row.name, sortOrder: row.sortOrder, isFinal: row.isFinal };
}

export interface KindInput {
  id?: string;
  name: string;
  note?: string;
  /** Этапы по порядку; последний — финальный */
  stages: { id?: string; name: string }[];
}

/** Создание вида производства с этапами */
export async function createProductionKind(db: Db, ctx: DocCtx, input: KindInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new DomainError(422, 'validation_error', 'The name is required');
  const [same] = await db.select({ id: productionKinds.id }).from(productionKinds).where(and(eq(productionKinds.workspaceId, ctx.workspaceId), sql`lower(${productionKinds.name}) = lower(${name})`, isNull(productionKinds.archivedAt))).limit(1);
  if (same) throw new DomainError(409, 'duplicate_name', `“${name}” already exists`);
  const id = input.id ?? uuidv7();
  await db.insert(productionKinds).values({ id, workspaceId: ctx.workspaceId, name, note: input.note ?? '' });
  await replaceStages(db, ctx, id, input.stages);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'production_kind.created', entity: 'production_kind', recordId: id, actorId: ctx.memberId, payload: { name } });
  return id;
}

export interface KindPatch {
  name?: string;
  note?: string;
  stages?: { id?: string; name: string }[];
}

/** Правка вида производства: наименование и состав этапов */
export async function updateProductionKind(db: Db, ctx: DocCtx, id: string, patch: KindPatch): Promise<void> {
  const [kind] = await db.select().from(productionKinds).where(eq(productionKinds.id, id)).limit(1);
  if (!kind) throw new DomainError(404, 'not_found', 'The production kind does not exist');
  const set: Partial<typeof productionKinds.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new DomainError(422, 'validation_error', 'The name is required');
    const [same] = await db.select({ id: productionKinds.id }).from(productionKinds).where(and(eq(productionKinds.workspaceId, ctx.workspaceId), sql`lower(${productionKinds.name}) = lower(${name})`, isNull(productionKinds.archivedAt), sql`${productionKinds.id} <> ${id}`)).limit(1);
    if (same) throw new DomainError(409, 'duplicate_name', `“${name}” already exists`);
    set.name = name;
  }
  if (patch.note !== undefined) set.note = patch.note;
  await db.update(productionKinds).set(set).where(eq(productionKinds.id, id));
  if (patch.stages) await replaceStages(db, ctx, id, patch.stages);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'production_kind.updated', entity: 'production_kind', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(patch) } });
}

/** Список этапов вида заменяется целиком: последний этап — финальный */
async function replaceStages(db: Db, ctx: DocCtx, kindId: string, stages: { id?: string; name: string }[]): Promise<void> {
  const current = await db.select().from(productionStages).where(eq(productionStages.kindId, kindId)).orderBy(asc(productionStages.sortOrder));
  const byId = new Map(current.map(s => [s.id, s]));
  const kept = new Set(stages.map(s => s.id).filter((x): x is string => !!x && byId.has(x)));
  // удаляемые этапы: их нельзя удалить, если на них ссылаются спецификации или выпуски
  for (const s of current) if (!kept.has(s.id)) await assertStageUnused(db, s.id);
  // финальный этап у вида один: сначала снимаем признак у всех, потом ставим новому
  await db.update(productionStages).set({ isFinal: false }).where(eq(productionStages.kindId, kindId));
  const rows = stages.map((s, i) => ({
    id: s.id && byId.has(s.id) ? s.id : uuidv7(),
    workspaceId: ctx.workspaceId,
    kindId,
    sortOrder: i,
    name: s.name.trim(),
    isFinal: i === stages.length - 1,
  }));
  for (const r of rows) if (!r.name) throw new DomainError(422, 'validation_error', 'The stage name is required');
  for (const r of rows) {
    if (byId.has(r.id)) await db.update(productionStages).set({ sortOrder: r.sortOrder, name: r.name, isFinal: r.isFinal, updatedAt: new Date() }).where(eq(productionStages.id, r.id));
    else await db.insert(productionStages).values(r);
  }
  for (const s of current) if (!kept.has(s.id)) await db.delete(productionStages).where(eq(productionStages.id, s.id));
  await db.update(productionKinds).set({ updatedAt: new Date() }).where(eq(productionKinds.id, kindId));
}

/** Этап, на который ссылаются строки спецификации или выпуски, удалить нельзя */
async function assertStageUnused(db: Db, stageId: string): Promise<void> {
  const [line] = await db.select({ id: bomLines.id }).from(bomLines).where(eq(bomLines.stageId, stageId)).limit(1);
  if (line) throw new DomainError(422, 'in_use', 'The stage is used in a bill of materials: remove it there first');
  const [item] = await db.select({ id: productionItems.id }).from(productionItems).where(eq(productionItems.stageId, stageId)).limit(1);
  if (item) throw new DomainError(422, 'in_use', 'The stage is used in a production document: remove it there first');
  const [comp] = await db.select({ id: productionComponents.id }).from(productionComponents).where(eq(productionComponents.stageId, stageId)).limit(1);
  if (comp) throw new DomainError(422, 'in_use', 'The stage is used in a production document: remove it there first');
  const [header] = await db.select({ documentId: productionHeaders.documentId }).from(productionHeaders).where(eq(productionHeaders.stageId, stageId)).limit(1);
  if (header) throw new DomainError(422, 'in_use', 'The stage is used in a production document: remove it there first');
}

/** Архивирование вида производства: им нельзя пользоваться в спецификациях */
export async function archiveProductionKind(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [kind] = await db.select().from(productionKinds).where(eq(productionKinds.id, id)).limit(1);
  if (!kind) throw new DomainError(404, 'not_found', 'The production kind does not exist');
  const [used] = await db.select({ id: manufacturedItems.id, name: manufacturedItems.name }).from(manufacturedItems).where(and(eq(manufacturedItems.productionKindId, id), isNull(manufacturedItems.archivedAt))).limit(1);
  if (used) throw new DomainError(422, 'in_use', `“${used.name}” is produced by this kind: change the kind of the product first`);
  await db.update(productionKinds).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(productionKinds.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'production_kind.archived', entity: 'production_kind', recordId: id, actorId: ctx.memberId, payload: { name: kind.name } });
}

/** Этап должен принадлежать виду производства изделия */
export async function assertStageOfKind(db: Db, kindId: string | null, stageId: string | null): Promise<void> {
  if (!stageId) {
    if (kindId) throw new DomainError(422, 'stage_required', 'Choose the stage of the production kind');
    return;
  }
  if (!kindId) throw new DomainError(422, 'stage_mismatch', 'The product has no production kind: it is produced in one stage');
  const [row] = await db.select({ kindId: productionStages.kindId }).from(productionStages).where(eq(productionStages.id, stageId)).limit(1);
  if (!row) throw new DomainError(422, 'invalid_reference', 'The stage does not exist');
  if (row.kindId !== kindId) throw new DomainError(422, 'stage_mismatch', 'The stage belongs to another production kind');
}

/** Строки спецификации изделия с видом производства: у каждой должен быть этап этого вида */
export async function assertItemStagesValid(db: Db, itemId: string): Promise<void> {
  const plan = await itemStagePlan(db, itemId);
  const lines = await db.select({ id: bomLines.id, stageId: bomLines.stageId }).from(bomLines).where(eq(bomLines.itemId, itemId));
  if (!lines.length) return;
  const stages = plan.kindId ? await stagesOfKind(db, plan.kindId) : [];
  const ids = new Set(stages.map(s => s.id));
  for (const l of lines) {
    if (!plan.kindId) {
      if (l.stageId) throw new DomainError(422, 'stage_mismatch', 'The product has no production kind: the stage of its lines is not needed');
      continue;
    }
    if (!l.stageId) throw new DomainError(422, 'stage_required', 'Set the stage of every line of the bill of materials');
    if (!ids.has(l.stageId)) throw new DomainError(422, 'stage_mismatch', 'The stage of a line belongs to another production kind');
  }
}
