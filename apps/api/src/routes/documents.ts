/* Организации воркспейса, банковские счета, склады, документы продаж и закупок, печатные формы, остатки склада.
   Чтение — любой участник; организации, склады и настройки склада меняет admin и выше; документы — member и выше.
   Правила проведения, нумерации и склада — в packages/db (documents.ts, stock.ts); здесь только HTTP. */
import { zValidator } from '@hono/zod-validator';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  bankAccounts,
  renderDocumentHtml,
  documentServiceCost,
  processingOrderCost,
  cancelDocument,
  canSeeCost,
  changeDocumentState,
  companies,
  costItems,
  countSheet,
  createBasedOn,
  createDocument,
  createInventoryBasedOn,
  createOtherCostsFromWorkOrder,
  createProductionFromCustomerOrder,
  createProductionFromOrder,
  createProductionOrderFromCustomerOrder,
  defaultPostingCost,
  deleteDocument,
  documentCosts,
  paymentStatuses,
  documentDetail,
  documentFiles,
  documents,
  fillCountSheet,
  jobs,
  loadAvgCosts,
  loadInventorySettings,
  organizations,
  postDocument,
  products,
  maskProductionDetail,
  productionDetail,
  writeOffDefects,
  recordEvent,
  restoreDocument,
  stockBalances,
  stockCostAdjustments,
  stockMoves,
  stockReservations,
  unpostDocument,
  updateDocument,
  warehouses,
  workspaces,
  workCenters,
  workOrderDetail,
  assertWorkOrderPostingByState,
  inUseBalances,
  members,
  lineSerialsView,
  saveSerials,
  activateVariant,
  createVariant,
  deleteVariant,
  renameVariant,
  getTemplate,
  assertLimit,
} from '@gr8r/db';
import {
  bankAccountCreate,
  bankAccountUpdate,
  basedOnCreate,
  costItemCreate,
  costItemQuery,
  costItemUpdate,
  DOCUMENT_META,
  documentCreate,
  documentQuery,
  documentCancel,
  documentStateChange,
  documentSerialsSave,
  documentTypesOf,
  documentUpdate,
  idParam,
  inventorySettingsUpdate,
  isCashDocType,
  PAYABLE_TYPES,
  organizationCreate,
  organizationQuery,
  organizationUpdate,
  pdfRequest,
  printParam,
  printQuery,
  variantCreate,
  variantUpdate,
  stockBalanceQuery,
  stockMoveQuery,
  validateRequisites,
  warehouseCreate,
  warehouseQuery,
  warehouseUpdate,
  type CompanyKind,
  type DocumentType,
  uuid,
} from '@gr8r/shared';
import { crud, ctxOf, validationHook, type Ctx } from '../crud';
import { AppError, notFound } from '../errors';
import { hasRole, requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const write = requireRole('member');
const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => '\\' + m);
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

/** Реквизиты проверяются по итоговому состоянию записи (тип + ИНН + КПП + ОГРН): ошибка — в том же формате, что у zod */
export function assertRequisites(r: { kind: CompanyKind; inn?: string | null; kpp?: string | null; ogrn?: string | null }) {
  const errs = validateRequisites(r);
  const first = Object.entries(errs)[0];
  if (first) throw new AppError(400, 'validation_error', `${first[0]}: ${first[1]}`, { issues: Object.entries(errs).map(([path, message]) => ({ path, message })) });
}

/* ---------------- организации ---------------- */

async function clearDefault(ctx: Ctx, table: typeof organizations | typeof warehouses, exceptId?: string) {
  await ctx.db.update(table).set({ isDefault: false }).where(and(eq(table.isDefault, true), exceptId ? ne(table.id, exceptId) : undefined));
}

export const organizationRoutes = crud({
  entity: 'organization',
  table: organizations,
  create: organizationCreate,
  update: organizationUpdate,
  query: organizationQuery,
  sortable: { name: organizations.name, inn: organizations.inn, createdAt: organizations.createdAt },
  defaultSort: 'name',
  search: [organizations.name, organizations.fullName, organizations.inn],
  writeRole: 'admin',
  prepareCreate: async (ctx, body) => {
    await assertLimit(ctx.db, 'organizations');
    assertRequisites(body);
    const [any] = await ctx.db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.archivedAt)).limit(1);
    const isDefault = body.isDefault ?? !any;
    if (isDefault) await clearDefault(ctx, organizations);
    return { isDefault };
  },
  prepareUpdate: async (ctx, existing, body) => {
    assertRequisites({ kind: body.kind ?? existing.kind, inn: body.inn ?? existing.inn, kpp: body.kpp ?? existing.kpp, ogrn: body.ogrn ?? existing.ogrn });
    if (body.isDefault === true) await clearDefault(ctx, organizations, existing.id);
    if (body.isDefault === false && existing.isDefault) throw new AppError(422, 'default_required', 'Make another organization the default instead');
    return {};
  },
  beforeDelete: async (ctx, row) => {
    if (row.isDefault) {
      const [other] = await ctx.db.select({ id: organizations.id }).from(organizations).where(and(ne(organizations.id, row.id), isNull(organizations.archivedAt))).limit(1);
      if (other) throw new AppError(422, 'default_required', 'Make another organization the default before archiving this one');
    }
  },
});

export const warehouseRoutes = crud({
  entity: 'warehouse',
  table: warehouses,
  create: warehouseCreate,
  update: warehouseUpdate,
  query: warehouseQuery,
  sortable: { name: warehouses.name, code: warehouses.code, createdAt: warehouses.createdAt },
  defaultSort: 'name',
  search: [warehouses.name, warehouses.code, warehouses.address],
  writeRole: 'admin',
  prepareCreate: async (ctx, body) => {
    await assertLimit(ctx.db, 'warehouses');
    const [any] = await ctx.db.select({ id: warehouses.id }).from(warehouses).where(isNull(warehouses.archivedAt)).limit(1);
    const isDefault = body.isDefault ?? !any;
    if (isDefault) await clearDefault(ctx, warehouses);
    return { isDefault };
  },
  prepareUpdate: async (ctx, existing, body) => {
    if (body.isDefault === true) await clearDefault(ctx, warehouses, existing.id);
    if (body.isDefault === false && existing.isDefault) throw new AppError(422, 'default_required', 'Make another warehouse the default instead');
    return {};
  },
  beforeDelete: async (ctx, row) => {
    const [left] = await ctx.db.select({ id: stockBalances.productId }).from(stockBalances).where(and(eq(stockBalances.warehouseId, row.id), sql`${stockBalances.qty} <> 0`)).limit(1);
    if (left) throw new AppError(422, 'warehouse_not_empty', 'The warehouse still has stock: move or write it off first');
    if (row.isDefault) {
      const [other] = await ctx.db.select({ id: warehouses.id }).from(warehouses).where(and(ne(warehouses.id, row.id), isNull(warehouses.archivedAt))).limit(1);
      if (other) throw new AppError(422, 'default_required', 'Make another warehouse the default before archiving this one');
    }
  },
});

/* ---------------- банковские счета ---------------- */

type Owner = { companyId: string } | { organizationId: string };

async function setDefaultAccount(ctx: Ctx, owner: Owner, id: string) {
  const col = 'companyId' in owner ? bankAccounts.companyId : bankAccounts.organizationId;
  await ctx.db.update(bankAccounts).set({ isDefault: false }).where(and(eq(col, 'companyId' in owner ? owner.companyId : owner.organizationId), ne(bankAccounts.id, id)));
}

/** /companies/:id/bank-accounts (member+) и /organizations/:id/bank-accounts (admin+) */
function bankAccountList(ownerTable: typeof companies | typeof organizations, kind: 'company' | 'organization', role: 'member' | 'admin') {
  const col = kind === 'company' ? bankAccounts.companyId : bankAccounts.organizationId;
  const guard = requireRole(role);
  return new Hono<AppEnv>()
    .get('/:id/bank-accounts', zValidator('param', idParam, validationHook), async c => {
      const ctx = ctxOf(c);
      const id = c.req.valid('param').id;
      const [owner] = await ctx.db.select({ id: ownerTable.id }).from(ownerTable).where(eq(ownerTable.id, id)).limit(1);
      if (!owner) throw notFound(kind);
      const items = await ctx.db.select().from(bankAccounts).where(eq(col, id)).orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.createdAt));
      return c.json({ items, total: items.length, limit: items.length, offset: 0 });
    })
    .post('/:id/bank-accounts', guard, zValidator('param', idParam, validationHook), zValidator('json', bankAccountCreate, validationHook), async c => {
      const ctx = ctxOf(c);
      const id = c.req.valid('param').id;
      const body = c.req.valid('json');
      const [owner] = await ctx.db.select({ id: ownerTable.id }).from(ownerTable).where(eq(ownerTable.id, id)).limit(1);
      if (!owner) throw notFound(kind);
      const [first] = await ctx.db.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(col, id)).limit(1);
      const ref: Owner = kind === 'company' ? { companyId: id } : { organizationId: id };
      const isDefault = body.isDefault ?? !first;
      const [row] = await ctx.db
        .insert(bankAccounts)
        .values({ ...body, isDefault, workspaceId: ctx.workspaceId, ...ref })
        .returning();
      if (isDefault) await setDefaultAccount(ctx, ref, row!.id);
      await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'bank_account.created', entity: 'bank_account', recordId: row!.id, actorId: ctx.memberId, payload: { [`${kind}Id`]: id } });
      return c.json(row!, 201);
    });
}

export const companyBankRoutes = bankAccountList(companies, 'company', 'member');
export const organizationBankRoutes = bankAccountList(organizations, 'organization', 'admin');

/** Правка и удаление счёта по id: счета организаций — admin+, счета контрагентов — member+ */
export const bankAccountRoutes = new Hono<AppEnv>()
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', bankAccountUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const [acc] = await ctx.db.select().from(bankAccounts).where(eq(bankAccounts.id, c.req.valid('param').id)).limit(1).for('update');
    if (!acc) throw notFound('bank_account');
    if (acc.organizationId && ctx.role !== 'owner' && ctx.role !== 'admin') throw new AppError(403, 'forbidden', 'This action requires the admin role or higher');
    const body = c.req.valid('json');
    const [row] = await ctx.db.update(bankAccounts).set({ ...body, updatedAt: new Date() }).where(eq(bankAccounts.id, acc.id)).returning();
    if (body.isDefault) await setDefaultAccount(ctx, acc.companyId ? { companyId: acc.companyId } : { organizationId: acc.organizationId! }, acc.id);
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'bank_account.updated', entity: 'bank_account', recordId: acc.id, actorId: ctx.memberId, payload: { changes: Object.keys(body) } });
    return c.json(row!);
  })
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const [acc] = await ctx.db.select().from(bankAccounts).where(eq(bankAccounts.id, c.req.valid('param').id)).limit(1).for('update');
    if (!acc) throw notFound('bank_account');
    if (acc.organizationId && ctx.role !== 'owner' && ctx.role !== 'admin') throw new AppError(403, 'forbidden', 'This action requires the admin role or higher');
    await ctx.db.delete(bankAccounts).where(eq(bankAccounts.id, acc.id));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'bank_account.deleted', entity: 'bank_account', recordId: acc.id, actorId: ctx.memberId, payload: {} });
    return c.json({ id: acc.id, deleted: true as const });
  });

/* ---------------- документы ---------------- */

const SORTABLE = {
  date: documents.date,
  number: documents.number,
  total: documents.total,
  status: documents.status,
  type: documents.type,
  createdAt: documents.createdAt,
  counterparty: companies.name,
} as const;

/** Внутренний документ: без контрагента, направление движения задаёт роль строки */
const isInternal = (t: string) => DOCUMENT_META[t as DocumentType]?.party === null;

/** Тип документа по id: нужен там, где поведение документа зависит от его типа */
async function documentTypeOf(ctx: Ctx, id: string): Promise<string> {
  const [doc] = await ctx.db.select({ type: documents.type }).from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw notFound('document');
  return doc.type;
}

/** Документы зарплаты видят и проводят только admin и owner (суммы — как себестоимость) */
async function payrollGuard(c: Parameters<typeof hasRole>[0], ctx: Ctx, id: string): Promise<void> {
  if (hasRole(c, 'admin')) return;
  const type = await documentTypeOf(ctx, id);
  if (type === 'payroll' || type === 'payroll_statement' || type === 'price_setting') throw new AppError(403, 'forbidden', 'Payroll and price setting documents require the admin role');
}

/** Склад-получатель (перемещение) — отдельным алиасом, чтобы не путать со складом шапки */
const targetWh = alias(warehouses, 'target_wh');

export const documentRoutes = new Hono<AppEnv>()
  // журнал: фильтры по типу / группе / статусу / организации / контрагенту / датам, поиск по номеру, комментарию и контрагенту, суммы по выборке
  .get('/', zValidator('query', documentQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const conds: (SQL | undefined)[] = [
      q.type?.length ? inArray(documents.type, q.type) : undefined,
      q.group ? inArray(documents.type, documentTypesOf(q.group)) : undefined,
      q.status?.length ? inArray(documents.status, q.status) : undefined,
      q.organizationId ? eq(documents.organizationId, q.organizationId) : undefined,
      q.counterpartyId ? eq(documents.counterpartyId, q.counterpartyId) : undefined,
      q.contractId ? eq(documents.contractId, q.contractId) : undefined,
      q.dealId ? eq(documents.dealId, q.dealId) : undefined,
      q.warehouseId ? eq(documents.warehouseId, q.warehouseId) : undefined,
      q.basedOnId ? eq(documents.basedOnId, q.basedOnId) : undefined,
      q.from ? sql`${documents.date} >= ${q.from}` : undefined,
      q.to ? sql`${documents.date} <= ${q.to}` : undefined,
      q.q ? or(ilike(documents.number, `%${escapeLike(q.q)}%`), ilike(documents.comment, `%${escapeLike(q.q)}%`), ilike(companies.name, `%${escapeLike(q.q)}%`)) : undefined,
    ];
    const where = and(...conds);
    const sortKey = (q.sort ?? '-date').replace(/^-/, '');
    const sortCol = SORTABLE[sortKey as keyof typeof SORTABLE];
    if (!sortCol) throw new AppError(400, 'invalid_sort', `Cannot sort by "${sortKey}". Allowed: ${Object.keys(SORTABLE).join(', ')}`);
    const order = (q.sort ?? '-date').startsWith('-') ? desc(sortCol) : asc(sortCol);
    const base = ctx.db.select({ n: count() }).from(documents).leftJoin(companies, eq(companies.id, documents.counterpartyId)).where(where);
    const [{ n }] = await base;
    // суммы продаж и закупок: внутренние документы в них не входят — у них своя стоимость по себестоимости
    const [sum] = await ctx.db
      .select({ net: sql<string>`coalesce(sum(${documents.amountNet}), 0)::text`, vat: sql<string>`coalesce(sum(${documents.vatTotal}), 0)::text`, total: sql<string>`coalesce(sum(${documents.total}), 0)::text` })
      .from(documents)
      .leftJoin(companies, eq(companies.id, documents.counterpartyId))
      .where(and(where, ne(documents.status, 'cancelled'), sql`${documents.type} not in ('stock_transfer','write_off','stock_posting')`));
    const rows = await ctx.db
      .select({ doc: documents, counterpartyName: companies.name, organizationName: organizations.name, warehouseName: warehouses.name, targetWarehouseName: targetWh.name })
      .from(documents)
      .leftJoin(companies, eq(companies.id, documents.counterpartyId))
      .innerJoin(organizations, eq(organizations.id, documents.organizationId))
      .leftJoin(warehouses, eq(warehouses.id, documents.warehouseId))
      .leftJoin(targetWh, eq(targetWh.id, documents.targetWarehouseId))
      .where(where)
      .orderBy(order, desc(documents.createdAt), desc(documents.id))
      .limit(q.limit)
      .offset(q.offset);
    const items = rows.map(({ doc: { custom: _custom, ...doc }, ...r }) => ({ ...doc, ...r }));
    // внутренние документы: стоимость по себестоимости (сумма qty × cost движений) — её видят только admin и owner
    const internal = items.filter(d => isInternal(d.type));
    const costs = internal.length ? await documentCosts(ctx.db, internal.map(d => d.id)) : new Map<string, string>();
    // оплата проведённых документов продаж и закупок страницы — тем же пакетным расчётом, что и в карточке (без запроса на документ)
    const payable = items.filter(d => d.status === 'posted' && (PAYABLE_TYPES as string[]).includes(d.type) && d.type !== 'customer_return' && d.type !== 'supplier_return').map(d => d.id);
    const statuses = payable.length ? await paymentStatuses(ctx.db, payable) : {};
    const withCost = items.map(d => {
      const st = statuses[d.id];
      const payment = st ? { state: st.state, paid: st.paid, obligation: st.obligation, remaining: st.remaining, prepaid: st.prepaid } : null;
      return isInternal(d.type) ? { ...d, payment, costTotal: canSeeCost(ctx.role) ? (costs.get(d.id) ?? '0.00') : null } : { ...d, payment };
    });
    // сумма стоимости по выборке: у перемещения берётся расходная сторона (иначе приход и расход сократились бы)
    const costRows = internal.length
      ? await ctx.db.execute<{ cost: string }>(sql`
          select coalesce(sum(c), 0)::text as cost
          from (
            select documents.id,
              case when bool_or(m.qty < 0) then sum(case when m.qty < 0 then -m.qty * m.cost else 0 end)
                   else sum(m.qty * m.cost) end as c
            from stock_moves m
            join documents on documents.id = m.document_id
            left join companies on companies.id = documents.counterparty_id
            where ${where ?? sql`true`} and documents.status <> 'cancelled' and documents.type in ('stock_transfer','write_off','stock_posting')
            group by documents.id
          ) t`)
      : [];
    const costSum = costRows[0]?.cost ?? '0';
    return c.json({ items: withCost, total: n, limit: q.limit, offset: q.offset, sum: { net: sum!.net, vat: sum!.vat, total: sum!.total, cost: canSeeCost(ctx.role) ? costSum : null } });
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await payrollGuard(c, ctx, c.req.valid('param').id);
    const detail = await documentDetail(ctx.db, c.req.valid('param').id);
    // заказ-наряд: добавляем вид, состояния, материалы и назначения
    if (detail.type === 'work_order') {
      const wo = await workOrderDetail(ctx.db, detail.id);
      return c.json({ ...detail, ...wo });
    }
    // производственный документ: добавляем изготовителя, позиции и состав
    if (detail.type === 'production' || detail.type === 'production_order') {
      const prod = maskProductionDetail(await productionDetail(ctx.db, detail.id), ctx.role);
      return c.json({
        ...detail,
        workCenter: prod.workCenter,
        finalWorkCenter: prod.finalWorkCenter,
        plannedStart: prod.plannedStart,
        plannedEnd: prod.plannedEnd,
        wasteValuation: prod.wasteValuation,
        materialMode: prod.materialMode,
        wasteWarehouseId: prod.wasteWarehouseId,
        defectWarehouseId: prod.defectWarehouseId,
        items: prod.items,
        components: prod.components,
        outputs: prod.outputs,
      });
    }
    // цена оприходования и стоимость по себестоимости — member и guest их не видят
    if (isInternal(detail.type) && !canSeeCost(ctx.role)) return c.json({ ...detail, lines: detail.lines.map(l => ({ ...l, price: '0.00' })), costTotal: null });
    // себестоимость услуги переработки: у заказа на переработку — накопленная по заказу, у отчёта о переработке и акта
    // по нему — себестоимость партии; видят admin и owner
    const processingOrder = detail.type === 'customer_order' && detail.operation === 'processing';
    const processingDoc = detail.type === 'tolling_report' || (detail.type === 'act' && detail.basedOn?.type === 'tolling_report');
    if (processingOrder || processingDoc) {
      const serviceCost = canSeeCost(ctx.role) ? (processingOrder ? await processingOrderCost(ctx.db, detail.id) : await documentServiceCost(ctx.db, detail.id)) : null;
      return c.json({ ...detail, serviceCost });
    }
    return c.json(detail);
  })
  .post('/', write, zValidator('json', documentCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    // производственные документы создаются своим сервисом: у них позиции и состав, а не строки товаров
    // производственные документы и прочие затраты создаются своим сервисом: у них позиции и состав, а не строки товаров
    if (body.type === 'production' || body.type === 'production_order' || body.type === 'other_costs' || body.type === 'material_allocation' || body.type === 'sales_plan' || body.type === 'service_day' || body.type === 'price_setting' || isCashDocType(body.type)) throw new AppError(422, 'production_api_only', 'This document type is created in its own section of Production');
    const id = await createDocument(ctx.db, docCtx(ctx), body);
    const detail = await documentDetail(ctx.db, id);
    // заказ-наряд: карточка сразу с видом, состояниями, материалами и назначениями
    if (detail.type === 'work_order') return c.json({ ...detail, ...(await workOrderDetail(ctx.db, id)) }, 201);
    return c.json(detail, 201);
  })
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', documentUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const patchedType = await documentTypeOf(ctx, id);
    if (patchedType === 'price_setting') throw new AppError(422, 'pricing_api_only', 'The price setting is edited through /pricing/settings');
    if (isCashDocType(patchedType)) throw new AppError(422, 'payments_api_only', 'Payment documents are edited through /payments');
    await updateDocument(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await documentDetail(ctx.db, id));
  })
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await payrollGuard(c, ctx, id);
    await deleteDocument(ctx.db, docCtx(ctx), id);
    return c.json({ id, deleted: true as const });
  })
  .post('/:id/post', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    // заказ-наряд проводит состояние «выполнен», вручную его не проводят
    assertWorkOrderPostingByState((await documentTypeOf(ctx, id)) as DocumentType);
    await payrollGuard(c, ctx, id);
    await postDocument(ctx.db, docCtx(ctx), id);
    return c.json(await documentDetail(ctx.db, id));
  })
  // серийные номера строки документа или материала заказ-наряда (у товаров с учётом по номерам); список заменяется целиком
  .put('/:id/serials', write, zValidator('param', idParam, validationHook), zValidator('json', documentSerialsSave, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    await saveSerials(ctx.db, ctx.workspaceId, id, { lineId: body.lineId, materialId: body.materialId }, body.serials);
    return c.json({ serials: await lineSerialsView(ctx.db, id) });
  })
  .get('/:id/serials', zValidator('param', idParam, validationHook), async c => c.json({ serials: await lineSerialsView(ctxOf(c).db, c.req.valid('param').id) }))
  .post('/:id/unpost', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    assertWorkOrderPostingByState((await documentTypeOf(ctx, id)) as DocumentType);
    await payrollGuard(c, ctx, id);
    await unpostDocument(ctx.db, docCtx(ctx), id);
    return c.json(await documentDetail(ctx.db, id));
  })
  .post('/:id/cancel', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    // тело необязательно: причина отмены (старые клиенты вызывают без тела)
    const raw = await c.req.json().catch(() => ({}));
    const parsed = documentCancel.safeParse(raw ?? {});
    if (!parsed.success) throw new AppError(422, 'validation_error', 'Invalid cancellation reason');
    await payrollGuard(c, ctx, id);
    await cancelDocument(ctx.db, docCtx(ctx), id, parsed.data.reason);
    return c.json(await documentDetail(ctx.db, id));
  })
  .post('/:id/restore', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await payrollGuard(c, ctx, id);
    await restoreDocument(ctx.db, docCtx(ctx), id);
    return c.json(await documentDetail(ctx.db, id));
  })
  .post('/:id/based-on', write, zValidator('param', idParam, validationHook), zValidator('json', basedOnCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const type = c.req.valid('json').type;
    // списание и оприходование по результатам инвентаризации: строго по разнице
    if (type === 'write_off' || type === 'stock_posting') {
      const [src] = await ctx.db.select({ type: documents.type }).from(documents).where(eq(documents.id, id)).limit(1);
      // брак выпуска списывается своей кнопкой: черновик со строками брака «на расходы»
      if (type === 'write_off' && src?.type === 'production') {
        const { id: created } = await writeOffDefects(ctx.db, docCtx(ctx), id);
        return c.json(await documentDetail(ctx.db, created), 201);
      }
      if (src?.type === 'inventory_count') {
        const created = await createInventoryBasedOn(ctx.db, docCtx(ctx), id, type);
        return c.json(await documentDetail(ctx.db, created), 201);
      }
    }
    // прочие затраты на основании заказ-наряда: черновик с заказ-нарядом в шапке (прямые затраты заказ-наряда)
    if (type === 'other_costs') {
      const created = await createOtherCostsFromWorkOrder(ctx.db, docCtx(ctx), id);
      return c.json(await documentDetail(ctx.db, created), 201);
    }
    // производство создаётся своим сервисом: заказ на производство и выпуск из заказа покупателя
    if (type === 'production_order') {
      const orderId = await createProductionOrderFromCustomerOrder(ctx.db, docCtx(ctx), { customerOrderId: id });
      return c.json(await documentDetail(ctx.db, orderId), 201);
    }
    if (type === 'production') {
      const [src] = await ctx.db.select({ type: documents.type }).from(documents).where(eq(documents.id, id)).limit(1);
      if (src?.type === 'production_order') {
        // выпуск по заказу на производство: остаток к выпуску по его позициям
        const order = await productionDetail(ctx.db, id);
        const lines = order.items.map(i => ({ orderItemId: i.id, qty: String(Math.max(0, Number(i.qty) - Number(i.produced))) })).filter(l => Number(l.qty) > 0);
        if (!lines.length) throw new AppError(422, 'nothing_to_create', 'Everything from this production order is already produced');
        const docId = await createProductionFromOrder(ctx.db, docCtx(ctx), id, { lines });
        return c.json(await documentDetail(ctx.db, docId), 201);
      }
      const docId = await createProductionFromCustomerOrder(ctx.db, docCtx(ctx), { customerOrderId: id, lines: [] });
      return c.json(await documentDetail(ctx.db, docId), 201);
    }
    const created = await createBasedOn(ctx.db, docCtx(ctx), id, type);
    return c.json(await documentDetail(ctx.db, created), 201);
  })
  // состояние документа (отдельно от проведения): переход проверяется по метаданным типа
  .post('/:id/state', write, zValidator('param', idParam, validationHook), zValidator('json', documentStateChange, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    await changeDocumentState(ctx.db, docCtx(ctx), id, body.state, { received: body.received, cancelReason: body.cancelReason });
    return c.json(await documentDetail(ctx.db, id));
  })
  // заполнить строки инвентаризации по остаткам склада
  .post('/:id/fill-count-sheet', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await fillCountSheet(ctx.db, docCtx(ctx), id);
    return c.json(await documentDetail(ctx.db, id));
  })
  // печатная форма: готовая HTML-страница (A4); та же, что превращается в PDF в воркере
  .get('/:id/print/:form', zValidator('param', printParam, validationHook), zValidator('query', printQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, form } = c.req.valid('param');
    // форма quote: ?template=<id> — КП по шаблону
    const templateId = form === 'quote' ? c.req.valid('query').template : undefined;
    const html = await renderDocumentHtml(ctx.db, id, form, { templateId, memberId: ctx.memberId });
    c.header('Content-Security-Policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(html);
  })
  // варианты КП (КП и заказ покупателя, черновик): строки документа — основной вариант (docs/architecture/quotes.md)
  .post('/:id/variants', write, zValidator('param', idParam, validationHook), zValidator('json', variantCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await createVariant(ctx.db, docCtx(ctx), id, c.req.valid('json'));
    return c.json(await documentDetail(ctx.db, id), 201);
  })
  .post('/:id/variants/:variantId/activate', write, zValidator('param', z.object({ id: uuid, variantId: uuid }), validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, variantId } = c.req.valid('param');
    await activateVariant(ctx.db, docCtx(ctx), id, variantId);
    return c.json(await documentDetail(ctx.db, id));
  })
  .patch('/:id/variants/:variantId', write, zValidator('param', z.object({ id: uuid, variantId: uuid }), validationHook), zValidator('json', variantUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, variantId } = c.req.valid('param');
    await renameVariant(ctx.db, docCtx(ctx), id, variantId, c.req.valid('json').name);
    return c.json(await documentDetail(ctx.db, id));
  })
  .delete('/:id/variants/:variantId', write, zValidator('param', z.object({ id: uuid, variantId: uuid }), validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, variantId } = c.req.valid('param');
    await deleteVariant(ctx.db, docCtx(ctx), id, variantId);
    return c.json(await documentDetail(ctx.db, id));
  })
  // PDF: задача воркеру (headless Chromium); результат читается по id файла
  .post('/:id/pdf', write, zValidator('param', idParam, validationHook), zValidator('json', pdfRequest, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const { form, templateId } = c.req.valid('json');
    const [doc] = await ctx.db.select({ type: documents.type }).from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw notFound('document');
    if (!DOCUMENT_META[doc.type as DocumentType].forms.includes(form)) throw new AppError(422, 'form_not_available', `The "${form}" form is not available for this document type`);
    // шаблон КП проверяется сразу (доступность автору), чтобы не ставить задачу, которая заведомо упадёт
    if (templateId && form === 'quote') await getTemplate(ctx.db, docCtx(ctx), templateId);
    const [file] = await ctx.db.insert(documentFiles).values({ workspaceId: ctx.workspaceId, documentId: id, form, templateId: form === 'quote' ? (templateId ?? null) : null, requestedBy: ctx.memberId }).returning({ id: documentFiles.id, status: documentFiles.status, form: documentFiles.form });
    await ctx.db.insert(jobs).values({ workspaceId: ctx.workspaceId, type: 'document.pdf', payload: { fileId: file!.id } });
    return c.json(file!, 202);
  })
  .get('/:id/pdf/:fileId', zValidator('param', z.object({ id: idParam.shape.id, fileId: idParam.shape.id }), validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, fileId } = c.req.valid('param');
    const [file] = await ctx.db.select().from(documentFiles).where(and(eq(documentFiles.id, fileId), eq(documentFiles.documentId, id))).limit(1);
    if (!file) throw notFound('file');
    if (c.req.query('download') !== '1') return c.json({ id: file.id, form: file.form, status: file.status, size: file.size, error: file.error });
    if (file.status !== 'ready' || !file.data) throw new AppError(409, 'not_ready', file.status === 'failed' ? `PDF generation failed: ${file.error}` : 'The PDF is not ready yet');
    const [doc] = await ctx.db.select({ number: documents.number }).from(documents).where(eq(documents.id, id)).limit(1);
    const name = `${doc?.number ?? 'document'}-${file.form}.pdf`.replace(/[^\w.-]+/g, '_');
    return new Response(new Uint8Array(file.data), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}"`, 'content-length': String(file.data.length), 'x-content-type-options': 'nosniff' } });
  });

/* ---------------- справочник статей затрат и доходов ---------------- */

/** Статьи затрат (списание) и доходов (оприходование): чтение — любой участник, меняет admin и выше */
export const costItemRoutes = crud({
  entity: 'cost_item',
  table: costItems,
  create: costItemCreate,
  update: costItemUpdate,
  query: costItemQuery,
  sortable: { name: costItems.name, kind: costItems.kind, createdAt: costItems.createdAt },
  defaultSort: 'name',
  search: [costItems.name],
  writeRole: 'admin',
  filters: q => [q.kind ? eq(costItems.kind, q.kind) : undefined],
});

/* ---------------- склад ---------------- */

export const stockRoutes = new Hono<AppEnv>()
  // остатки по складам и товарам: количество, резерв, доступно, средняя себестоимость, стоимость
  .get('/balances', zValidator('query', stockBalanceQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const reserved = sql<string>`coalesce((select sum(r.qty) from ${stockReservations} r where r.warehouse_id = ${stockBalances.warehouseId} and r.product_id = ${stockBalances.productId}), 0)`;
    const conds = and(
      q.warehouseId ? eq(stockBalances.warehouseId, q.warehouseId) : undefined,
      q.productId ? eq(stockBalances.productId, q.productId) : undefined,
      q.nonZero ? sql`${stockBalances.qty} <> 0` : undefined,
      q.q ? or(ilike(products.name, `%${escapeLike(q.q)}%`), ilike(products.sku, `%${escapeLike(q.q)}%`)) : undefined,
    );
    const rows = await ctx.db
      .select({
        warehouseId: stockBalances.warehouseId,
        warehouseName: warehouses.name,
        productId: stockBalances.productId,
        name: products.name,
        sku: products.sku,
        unitCode: products.unitCode,
        qty: stockBalances.qty,
        reserved: sql<string>`${reserved}::numeric(18,3)::text`,
        available: sql<string>`(${stockBalances.qty} - ${reserved})::numeric(18,3)::text`,
        avgCost: stockBalances.avgCost,
        value: sql<string>`round(${stockBalances.qty} * ${stockBalances.avgCost}, 2)::text`,
      })
      .from(stockBalances)
      .innerJoin(products, eq(products.id, stockBalances.productId))
      .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
      .where(conds)
      .orderBy(asc(products.name), asc(warehouses.name))
      .limit(q.limit)
      .offset(q.offset);
    const [tot] = await ctx.db
      .select({ n: count(), value: sql<string>`coalesce(sum(round(${stockBalances.qty} * ${stockBalances.avgCost}, 2)), 0)::text` })
      .from(stockBalances)
      .innerJoin(products, eq(products.id, stockBalances.productId))
      .where(conds);
    // средняя себестоимость и стоимость остатка видят только admin и owner
    const seeCost = canSeeCost(ctx.role);
    const items = rows.map(r => (seeCost ? r : { ...r, avgCost: null, value: null }));
    return c.json({ items, total: tot!.n, limit: q.limit, offset: q.offset, value: seeCost ? tot!.value : null });
  })
  // карточка движений товара: документ, склад, количество со знаком, себестоимость, остаток после движения по складу
  .get('/moves', zValidator('query', stockMoveQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const running = sql<string>`sum(${stockMoves.qty}) over (partition by ${stockMoves.warehouseId}, ${stockMoves.productId} order by ${stockMoves.seq})::numeric(18,3)::text`;
    // остаток после движения считается по всем движениям склада и товара, поэтому окно берётся раньше фильтра по документу
    const inner = ctx.db
      .select({
        id: stockMoves.id,
        seq: stockMoves.seq,
        warehouseId: stockMoves.warehouseId,
        productId: stockMoves.productId,
        documentId: stockMoves.documentId,
        qty: stockMoves.qty,
        // себестоимость движения с корректировкой закрытия периода
        cost: sql<string>`(${stockMoves.cost} + coalesce(${stockCostAdjustments.deltaCost}, 0))::numeric(18,4)::text`.as('cost'),
        movedAt: stockMoves.movedAt,
        balance: running.as('balance'),
      })
      .from(stockMoves)
      .leftJoin(stockCostAdjustments, and(eq(stockCostAdjustments.workspaceId, stockMoves.workspaceId), eq(stockCostAdjustments.moveId, stockMoves.id)))
      .where(and(q.warehouseId ? eq(stockMoves.warehouseId, q.warehouseId) : undefined, q.productId ? eq(stockMoves.productId, q.productId) : undefined))
      .as('m');
    const rows = await ctx.db
      .select({
        id: inner.id,
        seq: inner.seq,
        warehouseId: inner.warehouseId,
        warehouseName: warehouses.name,
        productId: inner.productId,
        documentId: inner.documentId,
        documentType: documents.type,
        documentNumber: documents.number,
        qty: inner.qty,
        cost: inner.cost,
        movedAt: inner.movedAt,
        balance: inner.balance,
      })
      .from(inner)
      .innerJoin(documents, eq(documents.id, inner.documentId))
      .innerJoin(warehouses, eq(warehouses.id, inner.warehouseId))
      .where(q.documentId ? eq(inner.documentId, q.documentId) : undefined)
      .orderBy(desc(inner.seq))
      .limit(q.limit)
      .offset(q.offset);
    // себестоимость движения видят только admin и owner
    const seeCost = canSeeCost(ctx.role);
    const items = rows.map(r => (seeCost ? r : { ...r, cost: null }));
    return c.json({ items, limit: q.limit, offset: q.offset });
  })
  // средняя себестоимость товаров по организации (взвешенная остатком) — источник цены материала в производстве
  .get('/avg-costs', async c => {
    const ctx = ctxOf(c);
    // себестоимость видят только admin и owner
    if (!canSeeCost(ctx.role)) return c.json({ items: [] });
    const m = await loadAvgCosts(ctx.db);
    return c.json({ items: [...m].map(([productId, avgCost]) => ({ productId, avgCost })) });
  })
  // цена оприходования по умолчанию: текущая средняя (склад, товар), иначе последняя закупочная
  .get('/default-cost', zValidator('query', z.object({ warehouseId: uuid.optional(), productId: uuid }), validationHook), async c => {
    const ctx = ctxOf(c);
    const { warehouseId, productId } = c.req.valid('query');
    const [p] = await ctx.db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
    if (!p) throw notFound('product');
    const cost = await defaultPostingCost(ctx.db, warehouseId ?? null, productId);
    return c.json({ productId, warehouseId: warehouseId ?? null, cost: canSeeCost(ctx.role) ? cost.cost : null, source: cost.source });
  })
  // опись склада для инвентаризации: текущие остатки (учётное количество)
  .get('/count-sheet', zValidator('query', z.object({ warehouseId: uuid }), validationHook), async c => {
    const ctx = ctxOf(c);
    const { warehouseId } = c.req.valid('query');
    const [w] = await ctx.db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, warehouseId)).limit(1);
    if (!w) throw notFound('warehouse');
    const items = await countSheet(ctx.db, ctx.workspaceId, warehouseId);
    return c.json({ warehouseId, items });
  })
  // имущество в эксплуатации: у какого сотрудника или участка оно лежит
  .get('/in-use', async c => {
    const ctx = ctxOf(c);
    const rows = await ctx.db
      .select({
        productId: inUseBalances.productId,
        name: products.name,
        sku: products.sku,
        unitCode: products.unitCode,
        qty: inUseBalances.qty,
        memberId: inUseBalances.memberId,
        workCenterId: inUseBalances.workCenterId,
      })
      .from(inUseBalances)
      .innerJoin(products, eq(products.id, inUseBalances.productId))
      .where(sql`${inUseBalances.qty} <> 0`)
      .orderBy(asc(products.name));
    const memberIds = [...new Set(rows.map(r => r.memberId).filter((x): x is string => !!x))];
    const centerIds = [...new Set(rows.map(r => r.workCenterId).filter((x): x is string => !!x))];
    const memberRows = memberIds.length ? await ctx.db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, memberIds)) : [];
    const centerRows = centerIds.length ? await ctx.db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(inArray(workCenters.id, centerIds)) : [];
    const memberNames = new Map(memberRows.map(m => [m.id, m.name]));
    const centerNames = new Map(centerRows.map(w => [w.id, w.name]));
    const items = rows.map(r => ({ ...r, memberName: r.memberId ? (memberNames.get(r.memberId) ?? null) : null, workCenterName: r.workCenterId ? (centerNames.get(r.workCenterId) ?? null) : null }));
    return c.json({ items, total: items.length });
  })
  .get('/settings', async c => c.json(await loadInventorySettings(ctxOf(c).db, ctxOf(c).workspaceId)))
  .patch('/settings', admin, zValidator('json', inventorySettingsUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await ctx.db.update(workspaces).set({ settings: sql`${workspaces.settings} || ${JSON.stringify(body)}::jsonb`, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'workspace.updated', entity: 'workspace', recordId: ctx.workspaceId, actorId: ctx.memberId, payload: { changes: body } });
    return c.json(await loadInventorySettings(ctx.db, ctx.workspaceId));
  });
