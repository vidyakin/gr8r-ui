/* Конструктор сущностей: загрузка метаданных и проверка значений по полям (типы, ссылки, уникальность).
   Используется маршрутами /entities, /data и записью custom у системных сущностей (задачи, сделки, компании, контакты). */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { companies, contacts, deals, entities, fields, isUuid, members, projects, records, SYSTEM_TABLES, tasks } from '@gr8r/db';
import { buildRecordSchema, isBlank, type FieldDef, type FieldType, type RecordData, type RecordMode } from '@gr8r/shared';
import type { Ctx } from '../crud';
import { AppError, notFound } from '../errors';

export type EntityRow = typeof entities.$inferSelect;
export type FieldRow = typeof fields.$inferSelect;

const SYSTEM_TABLE_REFS = { task: tasks, project: projects, deal: deals, company: companies, contact: contacts } as const;

/** Сущность по ключу или id. Удалённая (archived) пользовательская сущность не находится, пока явно не разрешено */
export async function loadEntity(ctx: Ctx, ref: string, opts: { archived?: boolean } = {}): Promise<EntityRow> {
  const [e] = await ctx.db.select().from(entities).where(isUuid(ref) ? eq(entities.id, ref) : eq(entities.key, ref)).limit(1);
  if (!e || (e.archivedAt && !opts.archived)) throw notFound('entity');
  return e;
}

export const loadFields = (ctx: Ctx, entityId: string, opts: { archived?: boolean } = {}) =>
  ctx.db
    .select()
    .from(fields)
    .where(and(eq(fields.entityId, entityId), opts.archived ? undefined : isNull(fields.archivedAt)))
    .orderBy(asc(fields.sortOrder), asc(fields.createdAt));

/** Строка поля → описание для схемы */
export const toDef = (f: FieldRow): FieldDef => ({ id: f.id, key: f.key, name: f.name, type: f.type as FieldType, required: f.required, unique: f.unique, filterable: f.filterable, options: f.options, sortOrder: f.sortOrder });

function schemaError(issues: { path: PropertyKey[]; message: string }[]): AppError {
  // путь — до поля (вложенные элементы массивов сворачиваются в поле)
  const list = issues.map(i => ({ path: ['data', ...i.path.slice(0, 1).map(String)].join('.'), message: i.message }));
  return new AppError(400, 'validation_error', list[0] ? `${list[0].path}: ${list[0].message}` : 'Invalid data', { issues: list });
}

/** Проверка данных по полям сущности. create — обязательные поля заполнены; patch — только присланные ключи (null очищает).
    `scope` нужен для проверки уникальности: где лежат значения (records или custom системной таблицы) */
export async function validateData(
  ctx: Ctx,
  entity: EntityRow,
  defs: FieldRow[],
  input: unknown,
  mode: RecordMode,
  selfId?: string,
): Promise<RecordData> {
  const parsed = buildRecordSchema(defs.map(toDef), mode).safeParse(input ?? {});
  if (!parsed.success) {
    // unrecognized_keys приходит одной ошибкой с path [] — раскладываем по ключам
    const issues: { path: PropertyKey[]; message: string }[] = parsed.error.issues.flatMap(i => (i.code === 'unrecognized_keys' ? i.keys.map(k => ({ path: [k] as PropertyKey[], message: 'Unknown or removed field' })) : [{ path: i.path, message: i.message }]));
    throw schemaError(issues);
  }
  const data = parsed.data as RecordData;
  await assertRefs(ctx, defs, data);
  await assertUnique(ctx, entity, defs, data, selfId);
  return data;
}

/** Ссылки (user / ref / refs) должны указывать на существующие записи этого воркспейса (RLS скрывает чужие) */
async function assertRefs(ctx: Ctx, defs: FieldRow[], data: RecordData) {
  for (const f of defs) {
    const v = data[f.key];
    if (isBlank(v)) continue;
    if (f.type !== 'user' && f.type !== 'ref' && f.type !== 'refs') continue;
    const ids = [...new Set(Array.isArray(v) ? (v as string[]) : [v as string])];
    let found: string[];
    if (f.type === 'user') found = (await ctx.db.select({ id: members.id }).from(members).where(inArray(members.id, ids))).map(r => r.id);
    else {
      const target = f.options.refEntity ?? '';
      const sys = SYSTEM_TABLE_REFS[target as keyof typeof SYSTEM_TABLE_REFS];
      if (sys) found = (await ctx.db.select({ id: sys.id }).from(sys).where(inArray(sys.id, ids))).map(r => r.id);
      else {
        const [te] = await ctx.db.select({ id: entities.id }).from(entities).where(and(eq(entities.key, target), isNull(entities.archivedAt))).limit(1);
        found = te ? (await ctx.db.select({ id: records.id }).from(records).where(and(eq(records.entityId, te.id), inArray(records.id, ids)))).map(r => r.id) : [];
      }
    }
    if (found.length !== ids.length) throw new AppError(422, 'invalid_reference', `${f.name}: the referenced record does not exist`, { issues: [{ path: `data.${f.key}`, message: 'Referenced record not found' }] });
  }
}

/** Поля с флагом unique: значение не должно повторяться среди записей той же сущности */
async function assertUnique(ctx: Ctx, entity: EntityRow, defs: FieldRow[], data: RecordData, selfId?: string) {
  for (const f of defs) {
    if (!f.unique) continue;
    const v = data[f.key];
    if (isBlank(v)) continue;
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    const table = SYSTEM_TABLES[entity.key];
    const rows = table
      ? await ctx.db.execute(sql`select 1 from ${sql.raw(table)} where custom->>${f.key} = ${text} ${selfId ? sql`and id <> ${selfId}` : sql``} limit 1`)
      : await ctx.db.execute(sql`select 1 from records where entity_id = ${entity.id} and data->>${f.key} = ${text} ${selfId ? sql`and id <> ${selfId}` : sql``} limit 1`);
    if (rows.length) throw new AppError(409, 'conflict', `${f.name}: this value is already used`, { issues: [{ path: `data.${f.key}`, message: 'Value must be unique' }] });
  }
}

/* ---------------- custom у системных сущностей ---------------- */

/** Ключи удалённых (скрытых) полей: клиент мог прислать их вместе со старым снимком записи (Undo, PATCH целым объектом) */
const archivedKeys = async (ctx: Ctx, entityId: string) =>
  new Set((await ctx.db.select({ key: fields.key }).from(fields).where(and(eq(fields.entityId, entityId), sql`${fields.archivedAt} is not null`))).map(r => r.key));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** custom новой записи системной сущности (undefined — не задавалось). Значения скрытых полей отбрасываются */
export async function customForCreate(ctx: Ctx, entityKey: string, input: Record<string, unknown> | undefined): Promise<{ custom?: RecordData }> {
  if (input === undefined) return {};
  const entity = await loadEntity(ctx, entityKey);
  const hidden = await archivedKeys(ctx, entity.id);
  const clean = Object.fromEntries(Object.entries(input).filter(([k]) => !hidden.has(k)));
  return { custom: await validateData(ctx, entity, await loadFields(ctx, entity.id), clean, 'create') };
}

/** custom при PATCH: присланные ключи проверяются и сливаются с имеющимися, null удаляет ключ. Неизменённые значения
    (клиент может прислать объект целиком) не проверяются; значения удалённых полей не трогаются */
export async function customForUpdate(ctx: Ctx, entityKey: string, existing: Record<string, unknown>, input: Record<string, unknown> | undefined, selfId: string): Promise<{ custom?: RecordData }> {
  if (input === undefined) return {};
  const entity = await loadEntity(ctx, entityKey);
  const changed = Object.fromEntries(Object.entries(input).filter(([k, v]) => (v === null ? existing[k] !== undefined : !same(v, existing[k]))));
  const patch = await validateData(ctx, entity, await loadFields(ctx, entity.id), changed, 'patch', selfId);
  return { custom: mergeData(existing, patch) };
}

/** Слияние патча в data записи: null удаляет ключ */
export function mergeData(existing: RecordData, patch: RecordData): RecordData {
  const merged: RecordData = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete merged[k];
    else merged[k] = v;
  }
  return merged;
}
