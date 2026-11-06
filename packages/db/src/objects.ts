/* Объекты объектного учёта (задача 1268, docs/architecture/construction.md): справочник, прорабы, договоры,
   автосоздание проекта задач, карточка со сводкой. Всё в транзакции вызывающего; деньги карточки видят owner/admin. */
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Role } from '@gr8r/shared';
import type { Db } from './client';
import { canSeeCost } from './cost';
import { DomainError } from './errors';
import { recordEvent } from './events';
import {
  companies,
  contracts,
  documents,
  members,
  objectContracts,
  objectForemen,
  objects,
  paymentLines,
  products,
  projects,
  stockBalances,
  tasks,
  warehouses,
  workspaces,
} from './schema';

export type ObjectRow = typeof objects.$inferSelect;

export interface ObjectInput {
  id?: string | undefined;
  number: string;
  name: string;
  customerId?: string | null | undefined;
  address?: string | undefined;
  startDate?: string | null | undefined;
  dueDate?: string | null | undefined;
  status?: ObjectRow['status'] | undefined;
  managerId?: string | null | undefined;
  revenueMode?: ObjectRow['revenueMode'] | undefined;
  overheadPct?: string | undefined;
  /** Контроль бюджета объекта (задача 1270) */
  budgetPolicy?: ObjectRow['budgetPolicy'] | undefined;
  projectId?: string | null | undefined;
  warehouseId?: string | null | undefined;
  note?: string | undefined;
  foremen?: string[] | undefined;
  contracts?: string[] | undefined;
}

export interface ObjectView extends ObjectRow {
  customerName: string | null;
  managerName: string | null;
  warehouseName: string | null;
  projectName: string | null;
  foremen: string[];
  contractIds: string[];
}

/** Объект своего воркспейса и не в архиве: ссылку из документа/задачи/времени можно ставить только на него */
export async function assertObjectRef(db: Db, objectId: string): Promise<ObjectRow> {
  const [row] = await db.select().from(objects).where(eq(objects.id, objectId)).limit(1);
  if (!row || row.archivedAt) throw new DomainError(422, 'invalid_reference', 'The object does not exist or is archived');
  return row;
}

async function assertCustomer(db: Db, customerId: string): Promise<void> {
  const [row] = await db.select({ id: companies.id, archivedAt: companies.archivedAt }).from(companies).where(eq(companies.id, customerId)).limit(1);
  if (!row || row.archivedAt) throw new DomainError(422, 'invalid_reference', 'The customer does not exist or is archived');
}

async function assertMember(db: Db, memberId: string): Promise<void> {
  const [row] = await db.select({ id: members.id }).from(members).where(eq(members.id, memberId)).limit(1);
  if (!row) throw new DomainError(422, 'invalid_reference', 'The member does not exist');
}

async function assertWarehouse(db: Db, warehouseId: string): Promise<void> {
  const [row] = await db.select({ id: warehouses.id, archivedAt: warehouses.archivedAt }).from(warehouses).where(eq(warehouses.id, warehouseId)).limit(1);
  if (!row || row.archivedAt) throw new DomainError(422, 'invalid_reference', 'The warehouse does not exist or is archived');
}

async function assertContracts(db: Db, contractIds: string[]): Promise<void> {
  if (!contractIds.length) return;
  const rows = await db.select({ id: contracts.id, archivedAt: contracts.archivedAt }).from(contracts).where(inArray(contracts.id, contractIds));
  if (rows.length !== new Set(contractIds).size || rows.some(r => r.archivedAt)) throw new DomainError(422, 'invalid_reference', 'A contract does not exist or is archived');
}

async function assertInputRefs(db: Db, input: ObjectInput): Promise<void> {
  if (input.customerId) await assertCustomer(db, input.customerId);
  if (input.managerId) await assertMember(db, input.managerId);
  if (input.warehouseId) await assertWarehouse(db, input.warehouseId);
  if (input.foremen) for (const id of new Set(input.foremen)) await assertMember(db, id);
  if (input.contracts) await assertContracts(db, [...new Set(input.contracts)]);
}

async function assertProject(db: Db, projectId: string): Promise<void> {
  const [row] = await db.select({ id: projects.id, archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row || row.archivedAt) throw new DomainError(422, 'invalid_reference', 'The project does not exist or is archived');
}

/** Ключ проекта задач из кода объекта: A-Z и цифры, 2–10 символов, уникален в воркспейсе */
async function uniqueProjectKey(db: Db, workspaceId: string, number: string): Promise<string> {
  let base = number.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
  if (!/^[A-Z]/.test(base)) base = `O${base}`;
  base = base.slice(0, 8) || 'OBJ';
  const taken = new Set((await db.select({ key: projects.key }).from(projects).where(eq(projects.workspaceId, workspaceId))).map(r => r.key.toLowerCase()));
  for (let i = 0; i < 1000; i++) {
    const suffix = i ? String(i) : '';
    const candidate = (base + suffix).slice(0, 10);
    if (candidate.length >= 2 && !taken.has(candidate.toLowerCase())) return candidate;
  }
  throw new DomainError(409, 'conflict', 'Cannot allocate a project key for the object');
}

async function saveForemen(db: Db, workspaceId: string, objectId: string, foremen: string[]): Promise<void> {
  await db.delete(objectForemen).where(eq(objectForemen.objectId, objectId));
  const uniq = [...new Set(foremen)];
  if (uniq.length) await db.insert(objectForemen).values(uniq.map(memberId => ({ workspaceId, objectId, memberId })));
}

async function saveContracts(db: Db, workspaceId: string, objectId: string, contractIds: string[]): Promise<void> {
  await db.delete(objectContracts).where(eq(objectContracts.objectId, objectId));
  const uniq = [...new Set(contractIds)];
  if (uniq.length) await db.insert(objectContracts).values(uniq.map(contractId => ({ workspaceId, objectId, contractId })));
}

/** Создание объекта: свой проект задач (если не передан), процент накладных из настройки воркспейса, прорабы и договоры */
export async function createObject(db: Db, ctx: { workspaceId: string; memberId: string | null }, input: ObjectInput): Promise<ObjectRow> {
  await assertInputRefs(db, input);
  let projectId = input.projectId ?? null;
  if (projectId) await assertProject(db, projectId);
  else {
    const key = await uniqueProjectKey(db, ctx.workspaceId, input.number);
    const [project] = await db
      .insert(projects)
      .values({
        workspaceId: ctx.workspaceId,
        key,
        name: input.name,
        module: 'general',
        status: 'active',
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        createdBy: ctx.memberId,
      })
      .returning({ id: projects.id });
    projectId = project!.id;
  }
  let overheadPct = input.overheadPct;
  if (overheadPct === undefined) {
    const [ws] = await db.select({ pct: workspaces.objectOverheadPct }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId)).limit(1);
    overheadPct = ws?.pct ?? '0';
  }
  const [row] = await db
    .insert(objects)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      number: input.number.trim(),
      name: input.name.trim(),
      customerId: input.customerId ?? null,
      address: input.address ?? '',
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      status: input.status ?? 'planning',
      managerId: input.managerId ?? null,
      revenueMode: input.revenueMode ?? 'acts',
      overheadPct: overheadPct!,
      budgetPolicy: input.budgetPolicy ?? 'warn',
      projectId,
      warehouseId: input.warehouseId ?? null,
      note: input.note ?? '',
    })
    .returning();
  if (input.foremen) await saveForemen(db, ctx.workspaceId, row!.id, input.foremen);
  if (input.contracts) await saveContracts(db, ctx.workspaceId, row!.id, input.contracts);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object.created', entity: 'object', recordId: row!.id, actorId: ctx.memberId, payload: { number: row!.number, name: row!.name } });
  return row!;
}

/** Правка: undefined — не трогать, null — очистить. Прорабы и договоры заменяются списком целиком */
export async function updateObject(db: Db, ctx: { workspaceId: string; memberId: string | null }, id: string, input: Partial<ObjectInput>): Promise<ObjectRow> {
  const [existing] = await db.select().from(objects).where(eq(objects.id, id)).limit(1).for('update');
  if (!existing || existing.archivedAt) throw new DomainError(404, 'not_found', 'object not found');
  await assertInputRefs(db, input as ObjectInput);
  if (input.projectId) await assertProject(db, input.projectId);
  const set: Partial<typeof objects.$inferInsert> = { updatedAt: new Date() };
  if (input.number !== undefined) set.number = input.number.trim();
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.customerId !== undefined) set.customerId = input.customerId;
  if (input.address !== undefined) set.address = input.address;
  if (input.startDate !== undefined) set.startDate = input.startDate;
  if (input.dueDate !== undefined) set.dueDate = input.dueDate;
  if (input.status !== undefined) set.status = input.status;
  if (input.managerId !== undefined) set.managerId = input.managerId;
  if (input.revenueMode !== undefined) set.revenueMode = input.revenueMode;
  if (input.overheadPct !== undefined) set.overheadPct = input.overheadPct;
  if (input.budgetPolicy !== undefined) set.budgetPolicy = input.budgetPolicy;
  if (input.projectId !== undefined) set.projectId = input.projectId;
  if (input.warehouseId !== undefined) set.warehouseId = input.warehouseId;
  if (input.note !== undefined) set.note = input.note;
  const [row] = await db.update(objects).set(set).where(eq(objects.id, id)).returning();
  if (input.foremen !== undefined) await saveForemen(db, ctx.workspaceId, id, input.foremen);
  if (input.contracts !== undefined) await saveContracts(db, ctx.workspaceId, id, input.contracts);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object.updated', entity: 'object', recordId: id, actorId: ctx.memberId, payload: {} });
  return row!;
}

/** Удаление объекта = архив: данные и привязки документов сохраняются */
export async function archiveObject(db: Db, ctx: { workspaceId: string; memberId: string | null }, id: string): Promise<void> {
  const [existing] = await db.select().from(objects).where(eq(objects.id, id)).limit(1).for('update');
  if (!existing) throw new DomainError(404, 'not_found', 'object not found');
  if (existing.archivedAt) return;
  await db.update(objects).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(objects.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object.archived', entity: 'object', recordId: id, actorId: ctx.memberId, payload: {} });
}

/** Строки каталога с подписями заказчика, ответственного, склада и проекта; прорабы и договоры — id */
export async function decorateObjects(db: Db, rows: ObjectRow[]): Promise<ObjectView[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const companyIds = [...new Set(rows.map(r => r.customerId).filter((x): x is string => !!x))];
  const memberIds = [...new Set(rows.map(r => r.managerId).filter((x): x is string => !!x))];
  const warehouseIds = [...new Set(rows.map(r => r.warehouseId).filter((x): x is string => !!x))];
  const projectIds = [...new Set(rows.map(r => r.projectId).filter((x): x is string => !!x))];
  const [cos, mems, whs, projs, foremen, objectContractRows] = await Promise.all([
    companyIds.length ? db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds)) : [],
    memberIds.length ? db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, memberIds)) : [],
    warehouseIds.length ? db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(inArray(warehouses.id, warehouseIds)) : [],
    projectIds.length ? db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, projectIds)) : [],
    db.select({ objectId: objectForemen.objectId, memberId: objectForemen.memberId }).from(objectForemen).where(inArray(objectForemen.objectId, ids)),
    db.select({ objectId: objectContracts.objectId, contractId: objectContracts.contractId }).from(objectContracts).where(inArray(objectContracts.objectId, ids)),
  ]);
  const cMap = new Map(cos.map(x => [x.id, x.name]));
  const mMap = new Map(mems.map(x => [x.id, x.name]));
  const wMap = new Map(whs.map(x => [x.id, x.name]));
  const pMap = new Map(projs.map(x => [x.id, x.name]));
  return rows.map(r => ({
    ...r,
    customerName: r.customerId ? (cMap.get(r.customerId) ?? null) : null,
    managerName: r.managerId ? (mMap.get(r.managerId) ?? null) : null,
    warehouseName: r.warehouseId ? (wMap.get(r.warehouseId) ?? null) : null,
    projectName: r.projectId ? (pMap.get(r.projectId) ?? null) : null,
    foremen: foremen.filter(x => x.objectId === r.id).map(x => x.memberId),
    contractIds: objectContractRows.filter(x => x.objectId === r.id).map(x => x.contractId),
  }));
}

export interface ObjectListParams {
  status?: string | undefined;
  q?: string | undefined;
  archived?: 'exclude' | 'include' | 'only' | undefined;
  limit: number;
  offset: number;
  sort?: string | undefined;
}

/** Список объектов: поиск по коду, названию и адресу, фильтр по статусу, архив (по умолчанию без него) */
export async function listObjects(db: Db, workspaceId: string, p: ObjectListParams): Promise<{ items: ObjectView[]; total: number }> {
  const conds: (SQL | undefined)[] = [eq(objects.workspaceId, workspaceId)];
  if (p.archived === 'only') conds.push(isNotNull(objects.archivedAt));
  else if (p.archived !== 'include') conds.push(isNull(objects.archivedAt));
  if (p.status) conds.push(eq(objects.status, p.status as ObjectRow['status']));
  if (p.q) conds.push(or(ilike(objects.number, `%${p.q}%`), ilike(objects.name, `%${p.q}%`), ilike(objects.address, `%${p.q}%`)));
  const where = and(...conds);
  const [by, dir] = p.sort?.startsWith('-') ? [p.sort.slice(1), desc] : [p.sort ?? 'createdAt', asc];
  const column =
    by === 'number' ? objects.number : by === 'name' ? objects.name : by === 'status' ? objects.status : by === 'startDate' ? objects.startDate : by === 'dueDate' ? objects.dueDate : objects.createdAt;
  const rows = await db.select().from(objects).where(where).orderBy(dir(column), asc(objects.id)).limit(p.limit).offset(p.offset);
  const [{ n }] = await db.select({ n: count() }).from(objects).where(where);
  return { items: await decorateObjects(db, rows), total: n };
}

/** Одна карточка объекта: 404 для чужого и архивного */
export async function getObject(db: Db, id: string): Promise<ObjectView> {
  const [row] = await db.select().from(objects).where(and(eq(objects.id, id), isNull(objects.archivedAt))).limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'object not found');
  return (await decorateObjects(db, [row]))[0]!;
}

export interface ObjectSummary {
  taskCount: number;
  documents: { id: string; type: string; number: string | null; date: string; total: string | null; status: string }[];
  payments: { id: string; documentId: string; documentType: string; documentNumber: string | null; documentDate: string; amount: string | null; comment: string }[];
  stock: { productId: string; sku: string; name: string; unitCode: string; qty: string; avgCost: string | null }[];
  canSeeCost: boolean;
}

/** Карточка объекта: число задач, документы, платежи и остатки склада объекта. Деньги — только owner/admin */
export async function objectSummary(db: Db, id: string, role: Role): Promise<ObjectSummary> {
  const obj = await assertObjectRef(db, id);
  const showMoney = canSeeCost(role);
  const [taskRow] = await db.select({ n: count() }).from(tasks).where(and(eq(tasks.objectId, id), isNull(tasks.archivedAt)));
  const docs = await db
    .select({ id: documents.id, type: documents.type, number: documents.number, date: documents.date, total: documents.total, status: documents.status })
    .from(documents)
    .where(eq(documents.objectId, id))
    .orderBy(desc(documents.date), desc(documents.createdAt));
  const payments = await db
    .select({
      id: paymentLines.id,
      documentId: documents.id,
      documentType: documents.type,
      documentNumber: documents.number,
      documentDate: documents.date,
      amount: paymentLines.amount,
      comment: paymentLines.comment,
    })
    .from(paymentLines)
    .innerJoin(documents, eq(documents.id, paymentLines.documentId))
    .where(eq(paymentLines.objectId, id))
    .orderBy(desc(documents.date), desc(paymentLines.createdAt));
  const stock = obj.warehouseId
    ? await db
        .select({ productId: stockBalances.productId, sku: products.sku, name: products.name, unitCode: products.unitCode, qty: stockBalances.qty, avgCost: stockBalances.avgCost })
        .from(stockBalances)
        .innerJoin(products, eq(products.id, stockBalances.productId))
        .where(and(eq(stockBalances.warehouseId, obj.warehouseId), sql`${stockBalances.qty} <> 0`))
        .orderBy(asc(products.name))
    : [];
  return {
    taskCount: taskRow?.n ?? 0,
    documents: docs.map(d => ({ ...d, total: showMoney ? d.total : null })),
    payments: payments.map(p => ({ ...p, amount: showMoney ? p.amount : null })),
    stock: stock.map(s => ({ ...s, avgCost: showMoney ? s.avgCost : null })),
    canSeeCost: showMoney,
  };
}
