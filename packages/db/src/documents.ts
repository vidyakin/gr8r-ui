/* Документы продаж и закупок: создание и правка, «на основании», проведение и отмена проведения, нумерация, остаток к отгрузке.
   Все функции работают на переданной транзакции арендатора (Db под withContext): изоляцию дают политики RLS, поэтому в запросах нет ручных
   фильтров по workspace_id. Правила проведения и склада описаны в docs/architecture/documents.md и stock.md. */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  canChangeState,
  computeLine,
  computeTotals,
  DOCUMENT_META,
  DOCUMENT_OPERATION_CHOICES,
  dec,
  div,
  fmt,
  formatDocumentNumber,
  addDays,
  basedOnTargets,
  lineRole,
  paramFields,
  stockPlan,
  FULFIL_TYPES,
  PRODUCTION_OPERATIONS,
  TRANSFER_OPERATIONS,
  type DocumentLineInput,
  type DocumentType,
  type PrintBank,
  type PrintData,
  type PrintParty,
  type Role,
  type TollingRole,
  type VatRate,
  isInvestmentFactType,
} from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { DOCUMENT_HOOKS, DOCUMENT_CREATED_HOOKS, STATE_HOOKS, STATE_PROVIDERS, type StatePayload } from './document-hooks';
import { recordEvent } from './events';
import { applyStockMoves, defaultPostingCost, documentCosts, documentLineCosts, loadInventorySettings, revertStockMoves, sourceMoveCosts, syncReservations, type MoveRequest } from './stock';
import { syncWorkOrderResources } from './planning';
import { assertPeriodOpen, assertServiceCostItems, clearPeriodCosts, syncPeriodCosts } from './cost-closing';
import { bankAccounts, companies, contracts, costItems, documentCounters, documentLines, documentStates, documents, investmentProjects, materialAllocationItems, members, organizations, products, tasks, units, warehouses, workCenters, workOrderAssignments, workOrderKinds, workOrderMaterials } from './schema';
import { assertInvestmentTarget, investmentOpen } from './investments';
import { assertContractOfCompany, contractDocumentProducts, contractPlanProductIds, defaultContract } from './contracts';
import { ensureVariant, specParamsOfProduct } from './variants';
import { checkParamValues, loadCategoryAttributeDefs } from './specs';
import { uuidv7 } from './uuid';
import { saveSerials, checkInventorySerials, lineSerialsView } from './serials';
import { repairPrintData, syncWarrantyKind, workOrderKindType } from './repair';

export interface DocCtx {
  workspaceId: string;
  /** members.id автора действия */
  memberId: string | null;
  /** Роль автора: стоимость видят только admin и owner */
  role?: Role;
}

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentLineRow = typeof documentLines.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- организация и склад по умолчанию ---------------- */

/** Новому воркспейсу — организация по умолчанию (по его названию) и основной склад, чтобы документы можно было создавать сразу */
export async function ensureDocumentDefaults(db: Db, workspaceId: string, name: string): Promise<void> {
  const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (!org) await db.insert(organizations).values({ workspaceId, name, fullName: name, isDefault: true });
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses).limit(1);
  if (!wh) await db.insert(warehouses).values({ workspaceId, name: 'Основной склад', code: 'MAIN', isDefault: true });
}

/** Системные статьи затрат и доходов: без них не оформить списание и оприходование */
const SYSTEM_COST_ITEMS: { key: string; name: string; kind: 'expense' | 'income' }[] = [
  { key: 'brak', name: 'Брак', kind: 'expense' },
  { key: 'porcha', name: 'Порча', kind: 'expense' },
  { key: 'nedostacha', name: 'Недостача', kind: 'expense' },
  { key: 'othody', name: 'Отходы', kind: 'expense' },
  { key: 'v_expluaciatsiyu', name: 'Передача в эксплуатацию', kind: 'expense' },
  { key: 'izlishki', name: 'Излишки', kind: 'income' },
  { key: 'garantiynyy_remont', name: 'Гарантийный ремонт', kind: 'expense' },
];

/** Статьи затрат и доходов по умолчанию: добавляются один раз, свои статьи воркспейс заводит сам */
export async function ensureCostItems(db: Db, workspaceId: string): Promise<void> {
  const have = new Set((await db.select({ systemKey: costItems.systemKey }).from(costItems).where(eq(costItems.workspaceId, workspaceId))).map(r => r.systemKey).filter((x): x is string => !!x));
  const missing = SYSTEM_COST_ITEMS.filter(i => !have.has(i.key));
  if (missing.length) await db.insert(costItems).values(missing.map(i => ({ workspaceId, name: i.name, kind: i.kind, systemKey: i.key }))).onConflictDoNothing();
}

/* ---------------- загрузка ---------------- */

async function loadDoc(db: Db, id: string, lock = false): Promise<DocumentRow> {
  const q = db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new DomainError(404, 'not_found', 'document not found');
  return row;
}

const linesOf = (db: Db, documentId: string) => db.select().from(documentLines).where(eq(documentLines.documentId, documentId)).orderBy(asc(documentLines.sortOrder), asc(documentLines.createdAt));

async function assertRefs(db: Db, h: { organizationId?: string | null; counterpartyId?: string | null; warehouseId?: string | null; targetWarehouseId?: string | null; costItemId?: string | null; workCenterId?: string | null; responsibleId?: string | null }) {
  if (h.organizationId) {
    const [o] = await db.select({ id: organizations.id, archivedAt: organizations.archivedAt }).from(organizations).where(eq(organizations.id, h.organizationId)).limit(1);
    if (!o || o.archivedAt) throw new DomainError(422, 'invalid_reference', 'Organization does not exist or is archived');
  }
  if (h.counterpartyId) {
    const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, h.counterpartyId)).limit(1);
    if (!c) throw new DomainError(422, 'invalid_reference', 'Counterparty does not exist');
  }
  if (h.warehouseId) {
    const [w] = await db.select({ id: warehouses.id, archivedAt: warehouses.archivedAt }).from(warehouses).where(eq(warehouses.id, h.warehouseId)).limit(1);
    if (!w || w.archivedAt) throw new DomainError(422, 'invalid_reference', 'Warehouse does not exist or is archived');
  }
  if (h.targetWarehouseId) {
    const [w] = await db.select({ id: warehouses.id, archivedAt: warehouses.archivedAt }).from(warehouses).where(eq(warehouses.id, h.targetWarehouseId)).limit(1);
    if (!w || w.archivedAt) throw new DomainError(422, 'invalid_reference', 'The target warehouse does not exist or is archived');
  }
  if (h.costItemId) {
    const [c] = await db.select({ id: costItems.id, kind: costItems.kind, archivedAt: costItems.archivedAt }).from(costItems).where(eq(costItems.id, h.costItemId)).limit(1);
    if (!c || c.archivedAt) throw new DomainError(422, 'invalid_reference', 'The cost item does not exist or is archived');
  }
  if (h.workCenterId) {
    const [w] = await db.select({ id: workCenters.id, archivedAt: workCenters.archivedAt }).from(workCenters).where(eq(workCenters.id, h.workCenterId)).limit(1);
    if (!w || w.archivedAt) throw new DomainError(422, 'invalid_reference', 'The work center does not exist or is archived');
  }
}

/* ---------------- строки и суммы ---------------- */

interface ResolvedLine {
  id: string;
  productId: string;
  name: string;
  unitCode: string;
  qty: string;
  price: string;
  discountPct: string;
  vatRate: VatRate;
  /** Роль строки выпуска (производства): приход или расход */
  stockRole?: 'in' | 'out';
  /** Учётное количество по остаткам (инвентаризация) */
  bookQty: string;
  /** Принятое количество (перемещение «в пути») */
  receivedQty: string;
  /** Вкладка строки отчёта о переработке: продукция, использованное сырьё или отходы */
  tollingRole: TollingRole | null;
  /** Статья косвенных затрат строки-услуги поступления */
  costItemId: string | null;
  /** Участок строки-услуги поступления */
  workCenterId: string | null;
  /** Значения параметров спецификации изделия (замеры, цвет): по ним считается состав выпуска */
  params: Record<string, unknown>;
}

/** Подставляет из товара название, единицу и ставку НДС, которых нет в строке; новые строки — только по действующим товарам.
    У инвентаризации количество строки — фактическое (нулевое значит «товара нет»), у остальных типов оно строго положительно */
async function resolveLines(db: Db, inputs: DocumentLineInput[], existingIds: Set<string>, type: DocumentType): Promise<ResolvedLine[]> {
  const ids = [...new Set(inputs.map(l => l.productId))];
  const rows = ids.length ? await db.select().from(products).where(inArray(products.id, ids)) : [];
  const by = new Map(rows.map(p => [p.id, p]));
  return inputs.map(l => {
    const p = by.get(l.productId);
    if (!p) throw new DomainError(422, 'invalid_reference', 'A line refers to a product that does not exist');
    const id = l.id ?? uuidv7();
    if (p.archivedAt && !existingIds.has(id)) throw new DomainError(422, 'invalid_reference', `Product "${p.name}" is archived`);
    if (type !== 'inventory_count' && dec(l.qty) <= 0n) throw new DomainError(422, 'invalid_qty', `"${p.name}": the quantity must be greater than zero`);
    return {
      id,
      productId: p.id,
      name: l.name?.trim() || p.name,
      unitCode: l.unitCode ?? p.unitCode,
      qty: l.qty,
      price: l.price,
      discountPct: l.discountPct ?? '0',
      vatRate: (l.vatRate ?? p.vatRate) as VatRate,
      stockRole: l.stockRole,
      bookQty: l.bookQty ?? '0',
      receivedQty: l.receivedQty ?? (type === 'stock_transfer' ? l.qty : '0'),
      costItemId: l.costItemId ?? null,
      workCenterId: l.workCenterId ?? null,
      tollingRole: l.tollingRole ?? null,
      params: l.params ?? {},
    };
  });
}

/** Вариант товара для строки заказа: комбинация параметров с флажком «разрез склада» даёт отдельную складскую позицию.
    Значения проверяются по описанию параметров спецификации товара. Строка, уже ссылающаяся на вариант, при смене
    значений переходит на вариант той же основы; без значений «разреза склада» товар строки не меняется */
async function resolveLineVariants(db: Db, ctx: DocCtx, lines: ResolvedLine[]): Promise<void> {
  for (const l of lines) {
    if (!Object.keys(l.params).length) continue;
    const [row] = await db.select().from(products).where(eq(products.id, l.productId)).limit(1);
    if (!row) continue;
    // основа варианта: у варианта — его родитель
    const base = row.parentProductId ? ((await db.select().from(products).where(eq(products.id, row.parentProductId)).limit(1))[0] ?? row) : row;
    // параметры товара (по ним же строятся варианты) и характеристики его категории
    const params = await specParamsOfProduct(db, ctx.workspaceId, base.id);
    const attrs = (await loadCategoryAttributeDefs(db, [base.id])).get(base.id) ?? [];
    l.params = checkParamValues([...paramFields(params), ...attrs], l.params);
    const variant = await ensureVariant(db, ctx.workspaceId, base, params, l.params);
    if (!variant || variant.id === l.productId) continue;
    // название строки — от товара: у прежнего варианта оно было его названием
    if (!l.name || l.name === row.name) l.name = variant.name;
    l.productId = variant.id;
  }
}

const amounts = (l: { qty: string; price: string; discountPct: string; vatRate: string }, includesVat: boolean) => computeLine(l, includesVat);

/** Итоги документа по его строкам в БД (суммы строк уже посчитаны) */
async function writeTotals(db: Db, docId: string): Promise<void> {
  const lines = await linesOf(db, docId);
  const t = computeTotals(lines.map(l => ({ net: l.net, vatAmount: l.vatAmount, total: l.total, vatRate: l.vatRate })));
  await db.update(documents).set({ amountNet: t.net, vatTotal: t.vat, total: t.total, updatedAt: new Date() }).where(eq(documents.id, docId));
}

/** Пересчёт сумм всех строк (смена способа указания НДС или перед проведением) */
async function recalcLines(db: Db, doc: DocumentRow): Promise<DocumentLineRow[]> {
  const lines = await linesOf(db, doc.id);
  const out: DocumentLineRow[] = [];
  for (const l of lines) {
    const a = amounts(l, doc.priceIncludesVat);
    if (a.net !== l.net || a.vatAmount !== l.vatAmount || a.total !== l.total) {
      await db.update(documentLines).set({ net: a.net, vatAmount: a.vatAmount, total: a.total }).where(eq(documentLines.id, l.id));
      out.push({ ...l, net: a.net, vatAmount: a.vatAmount, total: a.total });
    } else out.push(l);
  }
  await writeTotals(db, doc.id);
  return out;
}

/** Заказ на переработку: заказ покупателя с видом операции «Переработка» — по нему хранится давальческое сырьё */
export async function assertProcessingOrder(db: Db, id: string): Promise<DocumentRow> {
  const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!row || row.type !== 'customer_order' || row.operation !== 'processing') throw new DomainError(422, 'invalid_tolling_order', 'Select a customer order with the processing kind of operation');
  return row;
}

/** Строки документа заменяются списком: существующие (по id) обновляются, новые добавляются, отсутствующие удаляются.
    Ссылки «на основании» у потомков остаются на сохранённых строках */
async function saveLines(db: Db, ctx: DocCtx, doc: DocumentRow, inputs: DocumentLineInput[], includesVat: boolean): Promise<void> {
  const type = doc.type as DocumentType;
  const meta = DOCUMENT_META[type];
  const existing = await db
    .select({ id: documentLines.id, price: documentLines.price, stockRole: documentLines.stockRole, costItemId: documentLines.costItemId, workCenterId: documentLines.workCenterId })
    .from(documentLines)
    .where(eq(documentLines.documentId, doc.id));
  const existingIds = new Set(existing.map(e => e.id));
  const prevPrice = new Map(existing.map(e => [e.id, e.price]));
  const prevRole = new Map(existing.map(e => [e.id, e.stockRole]));
  const prevCostItem = new Map(existing.map(e => [e.id, e.costItemId]));
  const prevCenter = new Map(existing.map(e => [e.id, e.workCenterId]));
  const resolved = await resolveLines(db, inputs, existingIds, type);
  // заказ покупателя: комбинация значений параметров с флажком «разрез склада» даёт вариант товара.
  // Вариант создаётся лениво (первый заказ комбинации) и заменяет товар в строке: склад, резервы и документы работают по нему
  if (type === 'customer_order') await resolveLineVariants(db, ctx, resolved);
  await assertRefs(db, { costItemId: resolved.find(l => l.costItemId)?.costItemId ?? null, workCenterId: resolved.find(l => l.workCenterId)?.workCenterId ?? null });
  const keep = new Set(resolved.map(l => l.id));
  const drop = [...existingIds].filter(id => !keep.has(id));
  if (drop.length) await db.delete(documentLines).where(inArray(documentLines.id, drop));
  for (const [i, l] of resolved.entries()) {
    const a = amounts(l, includesVat);
    const values = {
      name: l.name,
      unitCode: l.unitCode,
      qty: l.qty,
      price: l.price,
      discountPct: l.discountPct,
      vatRate: l.vatRate,
      net: a.net,
      vatAmount: a.vatAmount,
      total: a.total,
      sortOrder: i,
      productId: l.productId,
      bookQty: l.bookQty,
      receivedQty: l.receivedQty,
      // статья и участок строки-услуги (поступление) клиент присылает сам; у прочих типов документов сохраняем прежние
      costItemId: l.costItemId ?? prevCostItem.get(l.id) ?? null,
      workCenterId: l.workCenterId ?? prevCenter.get(l.id) ?? null,
      // вкладка строки отчёта о переработке: продукция, использованное сырьё или отходы
      tollingRole: l.tollingRole ?? null,
      params: l.params ?? {},
    };
    // приём и возврат давальческого сырья ничего не продают: цена строки нулевая, НДС нет
    if (meta.noPrice) {
      const b = amounts({ ...l, price: '0', vatRate: 'none' }, includesVat);
      Object.assign(values, { price: '0', vatRate: 'none', net: b.net, vatAmount: b.vatAmount, total: b.total });
    }
    if (meta.party === null) {
      // внутренний документ: без НДС и продажной цены, роль строки проставляет сервер
      // у выпуска роль задаёт каждая строка (материал — расход, продукция — приход): её сохраняем при правке
      const role = type === 'production' ? (prevRole.get(l.id) ?? l.stockRole ?? 'out') : lineRole(type);
      const price = await internalPrice(db, ctx, doc, l, prevPrice.get(l.id));
      const b = amounts({ ...l, price, vatRate: 'none' }, includesVat);
      Object.assign(values, { price, vatRate: 'none', stockRole: role, net: b.net, vatAmount: b.vatAmount, total: b.total });
    }
    if (existingIds.has(l.id)) await db.update(documentLines).set(values).where(eq(documentLines.id, l.id));
    else await db.insert(documentLines).values({ ...values, id: l.id, workspaceId: ctx.workspaceId, documentId: doc.id });
  }
  // серийные номера строк (задача 1099): присланный список заменяет прежний
  for (const [i, l] of resolved.entries()) if (inputs[i]?.serials !== undefined) await saveSerials(db, ctx.workspaceId, doc.id, { lineId: l.id }, inputs[i]!.serials!);
  await writeTotals(db, doc.id);
}

/** Цена строки внутреннего документа: у списания и перемещения — ноль, у оприходования — себестоимость прихода.
    Цену оприходования вправе задать admin и owner, остальным сервер подставляет текущую среднюю */
async function internalPrice(db: Db, ctx: DocCtx, doc: DocumentRow, l: ResolvedLine, prev?: string): Promise<string> {
  const type = doc.type as DocumentType;
  if (type !== 'stock_posting') return '0';
  const canSet = ctx.role === 'owner' || ctx.role === 'admin';
  if (canSet && dec(l.price) > 0n) return l.price;
  if (prev !== undefined) return prev;
  const cost = await defaultPostingCost(db, doc.warehouseId, l.productId);
  return cost.cost;
}

/* ---------------- создание, правка, удаление ---------------- */

export interface DocumentCreateInput {
  id?: string;
  type: DocumentType;
  /** Вид заказ-наряда (только у work_order): пусто — вид по умолчанию */
  workOrderKindId?: string | null;
  /** Заказ на переработку (приём, отчёт о переработке и возврат): по нему берётся давалец */
  tollingOrderId?: string | null;
  organizationId?: string | null;
  counterpartyId?: string | null;
  /** Договор: пусто — договор по умолчанию контрагента (если он есть) */
  contractId?: string | null;
  warehouseId?: string | null;
  targetWarehouseId?: string | null;
  costItemId?: string | null;
  /** Участок списания: стоимость уходит в косвенные затраты участка (только у списания) */
  workCenterId?: string | null;
  /** Инвестпроект: документ идёт в факт проекта (только у типов из INVESTMENT_FACT_TYPES) */
  investmentProjectId?: string | null;
  /** Вид перемещения: сразу, «в пути», в эксплуатацию или обратно (только у перемещения между складами) */
  operation?: string;
  /** Получатель в эксплуатацию: участник или участок (ровно один) */
  inUseMemberId?: string | null;
  inUseWorkCenterId?: string | null;
  date?: string;
  dueDate?: string | null;
  priceIncludesVat?: boolean;
  comment?: string;
  responsibleId?: string | null;
  /** Документ-основание: выпуск производства, из которого сделан документ (списание брака) */
  basedOnId?: string | null;
  lines?: DocumentLineInput[];
  custom?: Record<string, unknown>;
}

/** Вид операции документа: у перемещения и у заказов переработки — из запроса, у производственных — сборка или разборка
    (выпуск по заказу на переработку — «processing»), у остальных типов — из метаданных */
function operationOf(type: DocumentType, input?: string | null): string | null {
  if (type === 'production_order' || type === 'production') {
    const op = input ?? 'assembly';
    const allowed: readonly string[] = [...PRODUCTION_OPERATIONS, ...(DOCUMENT_OPERATION_CHOICES[type] ?? [])];
    if (!allowed.includes(op)) throw new DomainError(422, 'invalid_operation', 'Unknown kind of production operation');
    return op;
  }
  const choices = DOCUMENT_OPERATION_CHOICES[type];
  if (choices) {
    const op = input ?? null;
    if (op !== null && !choices.includes(op as never)) throw new DomainError(422, 'invalid_operation', 'Unknown kind of operation');
    return op ?? DOCUMENT_META[type].operation ?? null;
  }
  if (type !== 'stock_transfer') return DOCUMENT_META[type].operation ?? null;
  const op = input ?? 'transfer';
  if (!TRANSFER_OPERATIONS.includes(op as (typeof TRANSFER_OPERATIONS)[number])) throw new DomainError(422, 'invalid_operation', 'Unknown kind of transfer');
  return op;
}

/** Перемещению «в пути» и обычному перемещению нужен склад-получатель; передаче в эксплуатацию — нет */
const needsTargetWarehouse = (operation: string | null) => operation === 'transfer' || operation === 'in_transit';

/** Получатель имущества в эксплуатацию: участник или участок (ровно один) */
async function assertInUseHolder(db: Db, memberId: string | null, workCenterId: string | null): Promise<void> {
  if ((memberId ? 1 : 0) + (workCenterId ? 1 : 0) !== 1) throw new DomainError(422, 'in_use_holder_required', 'Select who receives the goods: a member or a work center');
  if (memberId) {
    const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, memberId)).limit(1);
    if (!m) throw new DomainError(422, 'invalid_reference', 'The member does not exist');
  }
  if (workCenterId) {
    const [w] = await db.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.id, workCenterId)).limit(1);
    if (!w) throw new DomainError(422, 'invalid_reference', 'The work center does not exist');
  }
}

export async function createDocument(db: Db, ctx: DocCtx, input: DocumentCreateInput): Promise<string> {
  const meta = DOCUMENT_META[input.type];
  let organizationId = input.organizationId ?? null;
  if (!organizationId) {
    const [o] = await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.archivedAt)).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
    if (!o) throw new DomainError(422, 'organization_required', 'Add an organization in Settings → Organizations first');
    organizationId = o.id;
  }
  let warehouseId = input.warehouseId ?? null;
  if (input.warehouseId === undefined && (meta.stock || meta.reserves || meta.stockRole)) {
    const [w] = await db.select({ id: warehouses.id }).from(warehouses).where(isNull(warehouses.archivedAt)).orderBy(desc(warehouses.isDefault), asc(warehouses.createdAt)).limit(1);
    warehouseId = w?.id ?? null;
  }
  // внутренний документ: контрагента нет, вид операции задаёт тип
  const counterpartyId = meta.party === null ? null : input.counterpartyId ?? null;
  const operation = operationOf(input.type, input.operation);
  const inUseMemberId = input.type === 'stock_transfer' ? input.inUseMemberId ?? null : null;
  const inUseWorkCenterId = input.type === 'stock_transfer' ? input.inUseWorkCenterId ?? null : null;
  const targetWarehouseId = meta.production ? input.targetWarehouseId ?? null : meta.stockRole === 'transfer' ? (needsTargetWarehouse(operation) ? input.targetWarehouseId ?? null : null) : null;
  const needsCostItem = !!meta.costItemKind || operation === 'to_operation';
  const costItemId = needsCostItem ? input.costItemId ?? null : null;
  // участок списания: себестоимость списанного уходит в косвенные затраты участка (у остальных типов он не нужен)
  const workCenterId = input.type === 'write_off' || input.type === 'material_allocation' ? input.workCenterId ?? null : null;
  // вид заказ-наряда: только у work_order, пусто — вид по умолчанию (его поставит хук создания)
  const workOrderKindId = input.type === 'work_order' ? input.workOrderKindId ?? null : null;
  // заказ на переработку: только у документов переработки (приём, отчёт, возврат)
  const tollingOrderId = meta.tolling ? (input.tollingOrderId ?? null) : null;
  if (tollingOrderId) await assertProcessingOrder(db, tollingOrderId);
  const investmentProjectId = input.investmentProjectId ?? null;
  if (investmentProjectId) await assertInvestmentTarget(db, investmentProjectId, input.type);
  // договор: заданный или по умолчанию у контрагента; его условия подставляются в документ
  let contractId: string | null = null;
  let contract: Awaited<ReturnType<typeof defaultContract>> = null;
  if (meta.party !== null && counterpartyId) {
    if (input.contractId) {
      contract = await assertContractOfCompany(db, input.contractId, counterpartyId);
      contractId = contract.id;
    } else {
      contract = await defaultContract(db, counterpartyId);
      contractId = contract?.id ?? null;
    }
  }
  await assertRefs(db, { organizationId, counterpartyId, warehouseId, targetWarehouseId, costItemId, workCenterId, responsibleId: input.responsibleId });
  if (needsTargetWarehouse(operation) && (!targetWarehouseId || targetWarehouseId === warehouseId)) throw new DomainError(422, 'target_warehouse_required', 'Select another warehouse to move the goods to');
  if (operation === 'to_operation' || operation === 'from_operation') await assertInUseHolder(db, inUseMemberId, inUseWorkCenterId);
  if (costItemId) await assertCostItemKind(db, input.type, costItemId, operation === 'to_operation' ? 'expense' : undefined);
  const [row] = await db
    .insert(documents)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      type: input.type,
      date: input.date ?? today(),
      dueDate: input.dueDate ?? (contract && contract.paymentDays ? addDays(input.date ?? today(), contract.paymentDays) : null),
      state: null,
      operation,
      organizationId,
      counterpartyId,
      contractId,
      warehouseId,
      targetWarehouseId,
      costItemId,
      workCenterId,
      workOrderKindId,
      inUseMemberId,
      inUseWorkCenterId,
      tollingOrderId,
      investmentProjectId,
      basedOnId: input.basedOnId ?? null,
      priceIncludesVat: input.priceIncludesVat ?? true,
      comment: input.comment ?? '',
      responsibleId: input.responsibleId ?? ctx.memberId,
      custom: input.custom ?? {},
      createdBy: ctx.memberId,
    })
    .returning();
  if (input.lines?.length) await saveLines(db, ctx, row!, input.lines, row!.priceIncludesVat);
  // ресурсы строк-работ заказ-наряда подставляются из норматива работ
  if (input.type === 'work_order') await syncWorkOrderResources(db, ctx, row!.id);
  await DOCUMENT_CREATED_HOOKS[input.type]?.(db, ctx, row!);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: row!.id, actorId: ctx.memberId, payload: { documentType: input.type } });
  return row!.id;
}

export interface DocumentPatch {
  organizationId?: string | null;
  /** Вид заказ-наряда (только у work_order) */
  workOrderKindId?: string | null;
  /** Заказ на переработку (приём, отчёт о переработке, возврат) */
  tollingOrderId?: string | null;
  counterpartyId?: string | null;
  /** Договор документа */
  contractId?: string | null;
  warehouseId?: string | null;
  targetWarehouseId?: string | null;
  costItemId?: string | null;
  /** Участок списания: стоимость уходит в косвенные затраты участка (только у списания) */
  workCenterId?: string | null;
  investmentProjectId?: string | null;
  /** Вид перемещения (только у перемещения между складами) */
  operation?: string;
  /** Получатель в эксплуатацию: участник или участок */
  inUseMemberId?: string | null;
  inUseWorkCenterId?: string | null;
  date?: string;
  dueDate?: string | null;
  priceIncludesVat?: boolean;
  comment?: string;
  responsibleId?: string | null;
  lines?: DocumentLineInput[];
  custom?: Record<string, unknown>;
}

/** Статья затрат или доходов должна соответствовать виду документа: списание — расходная, оприходование — доходная */
async function assertCostItemKind(db: Db, type: DocumentType, costItemId: string, kind?: 'expense' | 'income'): Promise<void> {
  const meta = DOCUMENT_META[type];
  const want = kind ?? meta.costItemKind;
  if (!want) return;
  const [c] = await db.select({ id: costItems.id, kind: costItems.kind }).from(costItems).where(eq(costItems.id, costItemId)).limit(1);
  if (!c) throw new DomainError(422, 'invalid_reference', 'The cost item does not exist');
  if (c.kind !== want) throw new DomainError(422, 'cost_item_kind_mismatch', want === 'expense' ? 'This document needs an expense cost item' : 'This document needs an income cost item');
}

export async function updateDocument(db: Db, ctx: DocCtx, id: string, patch: DocumentPatch): Promise<void> {
  const doc = await loadDoc(db, id, true);
  const type = doc.type as DocumentType;
  const meta = DOCUMENT_META[type];
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', doc.status === 'posted' ? 'A posted document cannot be edited: unpost it first' : 'A cancelled document cannot be edited: restore it first');
  if (patch.organizationId !== undefined && patch.organizationId === null) throw new DomainError(422, 'organization_required', 'A document needs an organization');
  const orgChanged = patch.organizationId !== undefined && patch.organizationId !== doc.organizationId;
  if (doc.numberSeq !== null) {
    // номер принадлежит последовательности (организация, тип, год): сменой организации или года его не сломать
    if (orgChanged) throw new DomainError(422, 'number_locked', 'The document already has a number from this organization: it cannot move to another organization');
    if (patch.date && Number(patch.date.slice(0, 4)) !== doc.numberYear) throw new DomainError(422, 'number_locked', `The document is numbered in ${doc.numberYear}: its date must stay in that year`);
  }
  await assertRefs(db, { organizationId: orgChanged ? patch.organizationId : undefined, counterpartyId: patch.counterpartyId, warehouseId: patch.warehouseId, targetWarehouseId: patch.targetWarehouseId, costItemId: patch.costItemId, workCenterId: patch.workCenterId, responsibleId: patch.responsibleId });
  const operation = patch.operation !== undefined ? operationOf(type, patch.operation) : doc.operation;
  const inUseMemberId = patch.inUseMemberId !== undefined ? patch.inUseMemberId : doc.inUseMemberId;
  const inUseWorkCenterId = patch.inUseWorkCenterId !== undefined ? patch.inUseWorkCenterId : doc.inUseWorkCenterId;
  if (patch.costItemId) await assertCostItemKind(db, type, patch.costItemId, operation === 'to_operation' ? 'expense' : undefined);
  const targetWarehouseId = meta.stockRole === 'transfer' ? (needsTargetWarehouse(operation) ? patch.targetWarehouseId ?? doc.targetWarehouseId : null) : doc.targetWarehouseId;
  if (needsTargetWarehouse(operation)) {
    const wh = patch.warehouseId ?? doc.warehouseId;
    if (!targetWarehouseId || targetWarehouseId === wh) throw new DomainError(422, 'target_warehouse_required', 'Select another warehouse to move the goods to');
  }
  if (operation === 'to_operation' || operation === 'from_operation') await assertInUseHolder(db, inUseMemberId, inUseWorkCenterId);
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (patch.organizationId) set.organizationId = patch.organizationId;
  if (patch.counterpartyId !== undefined) set.counterpartyId = meta.party === null ? null : patch.counterpartyId;
  if (patch.contractId !== undefined && meta.party !== null) {
    if (patch.contractId) {
      const c = await assertContractOfCompany(db, patch.contractId, patch.counterpartyId ?? doc.counterpartyId);
      set.contractId = c.id;
    } else set.contractId = null;
  }
  if (patch.warehouseId !== undefined) set.warehouseId = patch.warehouseId;
  if (patch.operation !== undefined && (type === 'stock_transfer' || type === 'production_order' || type === 'production' || DOCUMENT_OPERATION_CHOICES[type])) set.operation = operation;
  if (patch.tollingOrderId !== undefined && meta.tolling) {
    if (patch.tollingOrderId) await assertProcessingOrder(db, patch.tollingOrderId);
    set.tollingOrderId = patch.tollingOrderId;
  }
  // проверяем только смену проекта: черновик, привязанный до закрытия проекта, по-прежнему правится (проведение его не пустит)
  if (patch.investmentProjectId !== undefined && patch.investmentProjectId !== doc.investmentProjectId) {
    if (patch.investmentProjectId) await assertInvestmentTarget(db, patch.investmentProjectId, type);
    set.investmentProjectId = patch.investmentProjectId;
  }
  if (patch.inUseMemberId !== undefined && type === 'stock_transfer') set.inUseMemberId = patch.inUseMemberId;
  if (patch.inUseWorkCenterId !== undefined && type === 'stock_transfer') set.inUseWorkCenterId = patch.inUseWorkCenterId;
  if (patch.targetWarehouseId !== undefined && (meta.stockRole === 'transfer' || meta.production)) set.targetWarehouseId = patch.targetWarehouseId;
  if (meta.stockRole === 'transfer' && !needsTargetWarehouse(operation)) set.targetWarehouseId = null;
  if (patch.costItemId !== undefined && (meta.costItemKind || operation === 'to_operation')) set.costItemId = patch.costItemId;
  if (patch.workCenterId !== undefined && (type === 'write_off' || type === 'material_allocation')) set.workCenterId = patch.workCenterId;
  // смена даты черновика в закрытый период запрещена: иначе документ нельзя будет провести
  if (patch.date) await assertPeriodOpen(db, ctx.workspaceId, patch.date);
  if (patch.workOrderKindId !== undefined && type === 'work_order') {
    // закрытый или отменённый заказ-наряд сменой вида не переоткрыть: возврат в работу — сменой состояния (admin+)
    if (patch.workOrderKindId !== doc.workOrderKindId && doc.state) {
      const [cur] = await db.select({ category: documentStates.category }).from(documentStates).where(and(eq(documentStates.kindId, doc.workOrderKindId!), eq(documentStates.key, doc.state))).limit(1);
      if (cur && (cur.category === 'delivered' || cur.category === 'cancelled')) throw new DomainError(422, 'invalid_state', 'A closed work order keeps its kind: move it back to work first');
    }
    // смена вида меняет и набор состояний: документ встаёт в первое состояние нового вида
    set.workOrderKindId = patch.workOrderKindId;
    if (patch.workOrderKindId && patch.workOrderKindId !== doc.workOrderKindId) {
      const [first] = await db.select({ key: documentStates.key }).from(documentStates).where(and(eq(documentStates.kindId, patch.workOrderKindId), eq(documentStates.category, 'new'))).limit(1);
      set.state = first?.key ?? null;
    }
  }
  if (patch.date) set.date = patch.date;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.priceIncludesVat !== undefined) set.priceIncludesVat = patch.priceIncludesVat;
  if (patch.comment !== undefined) set.comment = patch.comment;
  if (patch.responsibleId !== undefined) set.responsibleId = patch.responsibleId;
  if (patch.custom) set.custom = { ...doc.custom, ...patch.custom };
  const [after] = await db.update(documents).set(set).where(eq(documents.id, id)).returning();
  if (patch.lines) {
    await saveLines(db, ctx, after!, patch.lines, after!.priceIncludesVat);
    // ресурсы строк-работ заказ-наряда подставляются из норматива работ
    if (type === 'work_order') await syncWorkOrderResources(db, ctx, id);
  } else if (patch.priceIncludesVat !== undefined && patch.priceIncludesVat !== doc.priceIncludesVat) await recalcLines(db, after!);
  // гарантийный ремонт: цены нулевые, затраты на системную статью; другой вид снимает статью
  if (type === 'work_order') await syncWarrantyKind(db, ctx, id);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(patch) } });
}

/** Удалить можно черновик, у которого никогда не было номера: иначе в нумерации образовалась бы дыра — такой документ отменяют */
export async function deleteDocument(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const doc = await loadDoc(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only drafts can be deleted: unpost or cancel the document instead');
  if (doc.numberSeq !== null) throw new DomainError(409, 'numbered', 'The document has been posted before and keeps its number: cancel it instead of deleting');
  await db.delete(documents).where(eq(documents.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.deleted', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: doc.type } });
}

export async function cancelDocument(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const doc = await loadDoc(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'invalid_status', doc.status === 'posted' ? 'Unpost the document before cancelling it' : 'The document is already cancelled');
  await db.update(documents).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(documents.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.cancelled', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: doc.type, number: doc.number } });
}

export async function restoreDocument(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const doc = await loadDoc(db, id, true);
  if (doc.status !== 'cancelled') throw new DomainError(409, 'invalid_status', 'Only a cancelled document can be restored');
  await db.update(documents).set({ status: 'draft', updatedAt: new Date() }).where(eq(documents.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.restored', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: doc.type } });
}

/* ---------------- состояние документа ---------------- */

/** Смена состояния документа (отдельно от проведения). Переход проверяется по метаданным типа (или по состояниям воркспейса,
    если тип их задаёт сам — так у заказ-наряда); событие пишется как document.updated с changes.state —
    автоматизация «поле изменилось» срабатывает без нового триггера.
    Хук типа выполняет побочные действия (перемещение «в пути»: приёмка и её отмена; заказ-наряд: продажа при «выполнен») */
export async function changeDocumentState(db: Db, ctx: DocCtx, id: string, state: string, payload?: StatePayload): Promise<void> {
  const doc = await loadDoc(db, id, true);
  const type = doc.type as DocumentType;
  const meta = DOCUMENT_META[type];
  await assertPeriodOpen(db, ctx.workspaceId, doc.date);
  const provider = STATE_PROVIDERS[type];
  if (!provider) {
    if (!meta.states?.length) throw new DomainError(422, 'state_not_allowed', `A ${meta.label.toLowerCase()} has no states`);
    // состояния есть только у перемещения «в пути»: у обычного перемещения их нет
    if (type === 'stock_transfer' && doc.operation !== 'in_transit') throw new DomainError(422, 'state_not_allowed', 'Only a transfer in transit has states');
    if (!canChangeState(meta, doc.state, state)) throw new DomainError(422, 'invalid_state', `Cannot change the state from "${doc.state ?? 'none'}" to "${state}"`);
  } else {
    // состояния задаёт воркспейс: набор и правила перехода — из провайдера типа
    const states = await provider.states(db, ctx, doc);
    const from = doc.state ? states.find(s => s.key === doc.state) ?? null : null;
    const to = states.find(s => s.key === state);
    if (!to) throw new DomainError(422, 'invalid_state', `Unknown state "${state}"`);
    const verdict = provider.canTransition(from, to, ctx);
    if (!verdict.ok) throw new DomainError(422, 'invalid_state', verdict.message ?? `Cannot change the state from "${doc.state ?? 'none'}" to "${state}"`);
  }
  const from = doc.state;
  await db.update(documents).set({ state, updatedAt: new Date() }).where(eq(documents.id, id));
  await STATE_HOOKS[type]?.(db, ctx, doc, from, state, payload);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { changes: { state: { from, to: state } } } });
}

/* ---------------- нумерация ---------------- */

/** Следующий номер по (организация, тип, год). Строка счётчика блокируется до конца транзакции, откат отменяет и приращение:
    номера идут подряд, без дыр и без повторов даже при параллельном проведении */
async function nextNumber(db: Db, doc: DocumentRow): Promise<{ number: string; year: number; seq: number }> {
  const year = Number(doc.date.slice(0, 4));
  const [c] = await db
    .insert(documentCounters)
    .values({ workspaceId: doc.workspaceId, organizationId: doc.organizationId, type: doc.type, year, lastNumber: 1 })
    .onConflictDoUpdate({ target: [documentCounters.organizationId, documentCounters.type, documentCounters.year], set: { lastNumber: sql`${documentCounters.lastNumber} + 1` } })
    .returning({ n: documentCounters.lastNumber });
  return { number: formatDocumentNumber(doc.type as DocumentType, year, c!.n), year, seq: c!.n };
}

/* ---------------- проведение ---------------- */

/** Не больше, чем заказано (исполнение заказа) и не больше, чем отгружено (возврат): суммы проведённых документов цепочки + этот */
async function checkLimits(db: Db, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  const type = doc.type as DocumentType;
  const isReturn = type === 'customer_return' || type === 'supplier_return';
  if (!DOCUMENT_META[type].fulfils && !isReturn) return;
  const key = (l: DocumentLineRow) => (isReturn ? l.sourceLineId : l.originLineId);
  const refs = [...new Set(lines.map(key).filter((x): x is string => !!x))];
  if (!refs.length) return;
  const limits = await db.select({ id: documentLines.id, qty: documentLines.qty, name: documentLines.name }).from(documentLines).where(inArray(documentLines.id, refs));
  const col = isReturn ? documentLines.sourceLineId : documentLines.originLineId;
  const doneRows = await db
    .select({ ref: col, qty: sql<string>`sum(${documentLines.qty})` })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(inArray(col, refs), eq(documents.status, 'posted'), isReturn ? eq(documents.type, type) : inArray(documents.type, FULFIL_TYPES), ne(documents.id, doc.id)))
    .groupBy(col);
  const done = new Map(doneRows.map(r => [r.ref!, dec(r.qty)]));
  const mine = new Map<string, bigint>();
  for (const l of lines) {
    const k = key(l);
    if (k) mine.set(k, (mine.get(k) ?? 0n) + dec(l.qty));
  }
  for (const lim of limits) {
    const total = (done.get(lim.id) ?? 0n) + (mine.get(lim.id) ?? 0n);
    if (total > dec(lim.qty)) {
      const msg = isReturn ? `"${lim.name}": more is returned (${fmt(total, 3)}) than was ${type === 'customer_return' ? 'shipped' : 'received'} (${fmt(dec(lim.qty), 3)})` : `"${lim.name}": ${fmt(total, 3)} would be fulfilled, but only ${fmt(dec(lim.qty), 3)} was ordered`;
      throw new DomainError(422, isReturn ? 'over_return' : 'over_fulfilment', msg);
    }
  }
}

export async function postDocument(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const doc = await loadDoc(db, id, true);
  const type = doc.type as DocumentType;
  const meta = DOCUMENT_META[type];
  if (doc.status !== 'draft') throw new DomainError(409, 'invalid_status', doc.status === 'posted' ? 'The document is already posted' : 'A cancelled document cannot be posted: restore it first');
  await assertPeriodOpen(db, ctx.workspaceId, doc.date);
  if (doc.investmentProjectId && !(await investmentOpen(db, doc.investmentProjectId))) throw new DomainError(422, 'investment_closed', 'The investment project is closed or archived: unlink it before posting');
  if (meta.party && !doc.counterpartyId) throw new DomainError(422, 'counterparty_required', meta.party === 'customer' ? 'Select a customer before posting' : 'Select a supplier before posting');
  // договор: должен быть того же контрагента и организации и действовать на дату документа
  const contractWarnings: string[] = [];
  if (doc.contractId) {
    const c = await assertContractOfCompany(db, doc.contractId, doc.counterpartyId);
    if (c.organizationId !== doc.organizationId) throw new DomainError(422, 'contract_mismatch', 'The contract belongs to another organization');
    if (doc.date < c.validFrom || (c.validTo && doc.date > c.validTo)) throw new DomainError(422, 'contract_not_valid', `The contract is not valid on ${doc.date}`);
    if (c.isService) {
      // номенклатура вне тарифного плана: разрешить, предупредить или запретить
      const planProducts = await contractPlanProductIds(db, doc.contractId);
      const outside = (await contractDocumentProducts(db, id)).filter(l => !planProducts.includes(l.productId));
      if (outside.length) {
        if (c.extraProductPolicy === 'forbid') throw new DomainError(422, 'extra_product_forbidden', `«${outside[0]!.name}» is not in the tariff plan: selling it under this contract is forbidden`);
        if (c.extraProductPolicy === 'warn') contractWarnings.push(`«${outside.map(l => l.name).join('», «')}» is not in the tariff plan`);
      }
    }
  }
  await assertRefs(db, { organizationId: doc.organizationId, warehouseId: doc.warehouseId, targetWarehouseId: doc.targetWarehouseId, costItemId: doc.costItemId });
  if (doc.basedOnId) {
    const [base] = await db.select({ status: documents.status, number: documents.number, type: documents.type }).from(documents).where(eq(documents.id, doc.basedOnId)).limit(1);
    // заказ-наряд — исключение: счёт по нему выставляют до выполнения (предоплата)
    if (base && base.status !== 'posted' && base.type !== 'work_order') throw new DomainError(422, 'base_not_posted', `Post the basis document${base.number ? ` ${base.number}` : ''} first`);
  }
  const lines = await recalcLines(db, doc);
  // статью затрат несут только строки-услуги поступления — товар двигает склад, услуга становится косвенной затратой
  await assertServiceCostItems(db, type, lines);
  const hook = DOCUMENT_HOOKS[type];
  if (hook?.check) await hook.check(db, ctx, doc, lines);
  else if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one line before posting');
  await checkLimits(db, doc, lines);

  const kinds = new Map((await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, [...new Set(lines.map(l => l.productId))]))).map(p => [p.id, p.kind]));
  const goods = lines.filter(l => kinds.get(l.productId) === 'goods');
  if (type === 'inventory_count') await checkInventorySerials(db, { id: doc.id, warehouseId: doc.warehouseId }, goods.map(l => ({ id: l.id, productId: l.productId, qty: l.qty, name: l.name })));
  if (type === 'inventory_count' && !doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before posting');
  // возврат из эксплуатации склад не меняет — склад ему не нужен
  const needsWarehouse = meta.stock || (meta.stockRole && doc.operation !== 'from_operation');
  if (goods.length && needsWarehouse && !doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before posting');
  if (meta.stockRole === 'transfer' && needsTargetWarehouse(doc.operation) && goods.length && (!doc.targetWarehouseId || doc.targetWarehouseId === doc.warehouseId)) throw new DomainError(422, 'target_warehouse_required', 'Select another warehouse to move the goods to');
  if (meta.costItemKind) {
    if (!doc.costItemId) throw new DomainError(422, 'cost_item_required', meta.costItemKind === 'expense' ? 'Select an expense cost item before posting' : 'Select an income cost item before posting');
    await assertCostItemKind(db, type, doc.costItemId);
  }
  if (hook?.post) {
    // свой тип документа проводит сам (выпуск: списание материалов и приход продукции по себестоимости)
    await hook.post(db, ctx, doc, lines);
  } else if (goods.length) {
    await applyDocumentMoves(db, ctx, doc, lines);
  }

  const num = doc.numberSeq === null ? await nextNumber(db, doc) : null;
  await db
    .update(documents)
    .set({ status: 'posted', postedAt: new Date(), postedBy: ctx.memberId, updatedAt: new Date(), ...(num ? { number: num.number, numberYear: num.year, numberSeq: num.seq } : {}) })
    .where(eq(documents.id, id));

  await syncAfterChange(db, ctx, doc, lines, true);
  await hook?.afterPost?.(db, ctx, doc, lines);
  const [after] = await db.select({ number: documents.number, total: documents.total }).from(documents).where(eq(documents.id, id)).limit(1);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.posted', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: type, number: after!.number, total: after!.total, warnings: contractWarnings } });
}

/** Движения склада по документу (общий путь): план строк → расходы и приходы. Продажи, закупки и обычное перемещение.
    Приход перемещения — по фактической цене расхода той же строки, поэтому товар переезжает по своей себестоимости */
export async function applyDocumentMoves(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  const type = doc.type as DocumentType;
  const kinds = new Map((await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, [...new Set(lines.map(l => l.productId))]))).map(p => [p.id, p.kind]));
  const goods = lines.filter(l => kinds.get(l.productId) === 'goods');
  if (!goods.length) return;
  const plan = stockPlan({ type, warehouseId: doc.warehouseId, targetWarehouseId: doc.targetWarehouseId }, goods.map(l => ({ id: l.id, productId: l.productId, qty: l.qty, stockRole: l.stockRole })));
  if (!plan.length) return;
  const [org] = await db.select({ taxSystem: organizations.taxSystem }).from(organizations).where(eq(organizations.id, doc.organizationId)).limit(1);
  const returnCosts = type === 'customer_return' ? await sourceMoveCosts(db, goods.map(l => l.sourceLineId).filter((x): x is string => !!x)) : new Map<string, bigint>();
  const byLine = new Map(lines.map(l => [l.id, l]));
  const reqs: MoveRequest[] = plan.map(m => {
    const l = byLine.get(m.lineId)!;
    const req: MoveRequest = { warehouseId: m.warehouseId, productId: m.productId, lineId: m.lineId, qty: dec(m.qty), direction: m.direction };
    if (type === 'receipt') req.cost = div(dec(org?.taxSystem === 'usn' ? l.total : l.net), dec(l.qty)); // при УСН входной НДС входит в себестоимость
    if (type === 'customer_return' && l.sourceLineId && returnCosts.has(l.sourceLineId)) req.cost = returnCosts.get(l.sourceLineId);
    if (type === 'stock_posting') req.cost = dec(l.price); // цена оприходования — себестоимость прихода
    if (type === 'stock_transfer' && m.direction === 'in') req.costFromLine = true; // приход по фактической цене расхода
    return req;
  });
  await applyStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, reqs, await loadInventorySettings(db, ctx.workspaceId));
}

/** repost — документ снимается, чтобы сразу провести заново (дописывание в документ дня): свои запреты отмены не проверяются */
export async function unpostDocument(db: Db, ctx: DocCtx, id: string, opts: { repost?: boolean } = {}): Promise<void> {
  const doc = await loadDoc(db, id, true);
  const type = doc.type as DocumentType;
  if (doc.status !== 'posted') throw new DomainError(409, 'invalid_status', 'Only a posted document can be unposted');
  await assertPeriodOpen(db, ctx.workspaceId, doc.date);
  const kids = await db.select({ id: documents.id, type: documents.type, number: documents.number }).from(documents).where(and(eq(documents.basedOnId, id), eq(documents.status, 'posted')));
  if (kids.length)
    throw new DomainError(409, 'has_posted_children', `Unpost the documents created from this one first: ${kids.map(k => k.number ?? DOCUMENT_META[k.type as DocumentType].label).join(', ')}`, { documents: kids });
  // свои проверки типа документа: например, промежуточный этап нельзя снимать, если следующий уже выполнен
  if (!opts.repost) await DOCUMENT_HOOKS[type]?.beforeUnpost?.(db, ctx, doc);
  // отмена проведения возвращает движения склада (у внутренних документов — обе стороны перемещения)
  await revertStockMoves(db, ctx.workspaceId, id, await loadInventorySettings(db, ctx.workspaceId));
  await db.update(documents).set({ status: 'draft', postedAt: null, postedBy: null, updatedAt: new Date() }).where(eq(documents.id, id));
  await syncAfterChange(db, ctx, { ...doc, status: 'draft' }, await linesOf(db, id), false);
  await DOCUMENT_HOOKS[doc.type as DocumentType]?.afterUnpost?.(db, ctx, { ...doc, status: 'draft' }, await linesOf(db, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.unposted', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: type, number: doc.number } });
}

/** Резервы затронутых заказов: сам заказ (его строки) или заказы, которые исполняет документ (по originLineId).
    Здесь же косвенные затраты периода: при проведении они набираются, при отмене — очищаются */
async function syncAfterChange(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[], posted: boolean): Promise<void> {
  const reserves = DOCUMENT_META[doc.type as DocumentType].reserves;
  const ids = reserves ? lines.map(l => l.id) : lines.map(l => l.originLineId).filter((x): x is string => !!x);
  if (ids.length) await syncReservations(db, ctx.workspaceId, ids);
  // косвенные затраты периода: набираются при проведении и очищаются при отмене.
  // У «Прочих затрат» строк товаров нет — их набирает хук проведения этого типа
  if (doc.type === 'other_costs') return;
  if (posted) await syncPeriodCosts(db, ctx, doc, lines);
  else await clearPeriodCosts(db, ctx.workspaceId, doc.id);
}

/* ---------------- на основании ---------------- */

/** Создаёт черновик указанного типа из документа: шапка и строки копируются, связь хранится в based_on_id и в строках (source / origin).
    Для документов, исполняющих заказ, количество строки = остаток к исполнению (заказано − уже в документах цепочки); для возвратов — остаток к возврату */
export async function createBasedOn(db: Db, ctx: DocCtx, sourceId: string, target: DocumentType): Promise<string> {
  const src = await loadDoc(db, sourceId);
  const srcType = src.type as DocumentType;
  if (src.status === 'cancelled') throw new DomainError(422, 'invalid_based_on', 'A cancelled document cannot be a basis');
  if (!basedOnTargets(srcType).includes(target)) throw new DomainError(422, 'invalid_based_on', `${DOCUMENT_META[target].label} cannot be created from ${DOCUMENT_META[srcType].label.toLowerCase()}`);
  // гарантийный ремонт не продаётся: счёт, акт и реализация на его основании недоступны
  if (srcType === 'work_order' && ['invoice', 'act', 'realization'].includes(target) && (await workOrderKindType(db, src.workOrderKindId)) === 'warranty') throw new DomainError(422, 'warranty_no_billing', 'A warranty repair has no revenue: invoices, acts and shipments cannot be created from it');
  const srcLines = await linesOf(db, sourceId);
  const isOrder = DOCUMENT_META[srcType].isOrder === true;
  const isReturn = DOCUMENT_META[target].isReturn === true;
  const fulfils = DOCUMENT_META[target].fulfils;

  // уже запланированное: непроведённые и проведённые (но не отменённые) документы-исполнители / возвраты по тем же строкам
  const refCol = isReturn ? documentLines.sourceLineId : documentLines.originLineId;
  const refIds = srcLines.map(l => (isReturn ? l.id : (isOrder ? l.id : l.originLineId))).filter((x): x is string => !!x);
  const plannedRows = refIds.length && (fulfils || isReturn)
    ? await db
        .select({ ref: refCol, qty: sql<string>`sum(${documentLines.qty})` })
        .from(documentLines)
        .innerJoin(documents, eq(documents.id, documentLines.documentId))
        .where(and(inArray(refCol, refIds), ne(documents.status, 'cancelled'), isReturn ? eq(documents.type, target) : inArray(documents.type, FULFIL_TYPES)))
        .groupBy(refCol)
    : [];
  const planned = new Map(plannedRows.map(r => [r.ref!, dec(r.qty)]));
  const originQty = new Map<string, bigint>();
  if (fulfils && !isOrder) {
    const origins = [...new Set(srcLines.map(l => l.originLineId).filter((x): x is string => !!x))];
    if (origins.length) for (const o of await db.select({ id: documentLines.id, qty: documentLines.qty }).from(documentLines).where(inArray(documentLines.id, origins))) originQty.set(o.id, dec(o.qty));
  }

  const newLines: DocumentLineInput[] = [];
  const meta: { source: string; origin: string | null }[] = [];
  for (const l of srcLines) {
    let qty = dec(l.qty);
    if (isReturn) qty = dec(l.qty) - (planned.get(l.id) ?? 0n);
    else if (fulfils) {
      const origin = isOrder ? l.id : l.originLineId;
      if (origin) {
        const total = isOrder ? dec(l.qty) : (originQty.get(origin) ?? dec(l.qty));
        const left = total - (planned.get(origin) ?? 0n);
        qty = left < qty ? left : qty;
      }
    }
    if (qty <= 0n) continue;
    newLines.push({ productId: l.productId, name: l.name, unitCode: l.unitCode, qty: fmt(qty, 3), price: l.price, discountPct: l.discountPct, vatRate: l.vatRate as VatRate });
    meta.push({ source: l.id, origin: isOrder ? l.id : l.originLineId });
  }
  if (!newLines.length) throw new DomainError(422, 'nothing_to_create', isReturn ? 'Everything has already been returned' : 'Everything from this document is already covered by other documents');

  const id = await createDocument(db, ctx, {
    type: target,
    organizationId: src.organizationId,
    counterpartyId: src.counterpartyId,
    warehouseId: src.warehouseId ?? undefined,
    priceIncludesVat: src.priceIncludesVat,
    comment: src.comment,
    dueDate: target === 'invoice' ? src.dueDate : null,
    // инвестпроект переходит в документ-исполнитель и возврат, если проект ещё принимает документы
    investmentProjectId: src.investmentProjectId && isInvestmentFactType(target) && (await investmentOpen(db, src.investmentProjectId)) ? src.investmentProjectId : null,
    lines: newLines,
  });
  await db.update(documents).set({ basedOnId: sourceId }).where(eq(documents.id, id));
  const created = await linesOf(db, id);
  for (const [i, l] of created.entries()) await db.update(documentLines).set({ sourceLineId: meta[i]!.source, originLineId: meta[i]!.origin }).where(eq(documentLines.id, l.id));
  return id;
}

/* ---------------- карточка документа ---------------- */

export interface DocumentLineView extends DocumentLineRow {
  sku: string;
  kind: 'goods' | 'service' | 'work' | 'operation';
  /** Товар с учётом по серийным номерам */
  trackSerials: boolean;
  /** Для строк заказов: исполнено проведёнными документами (отгружено / получено) и запланировано (с черновиками) */
  shipped: string;
  planned: string;
  /** Для строк реализации и поступления: уже возвращено проведёнными возвратами */
  returned: string;
}

export async function documentDetail(db: Db, id: string) {
  const doc = await loadDoc(db, id);
  const type = doc.type as DocumentType;
  const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, doc.organizationId)).limit(1);
  const [cp] = doc.counterpartyId ? await db.select({ id: companies.id, name: companies.name, inn: companies.inn }).from(companies).where(eq(companies.id, doc.counterpartyId)).limit(1) : [];
  const [wh] = doc.warehouseId ? await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, doc.warehouseId)).limit(1) : [];
  const [contract] = doc.contractId ? await db.select({ id: contracts.id, number: contracts.number, companyId: contracts.companyId, companyName: companies.name, validFrom: contracts.validFrom, validTo: contracts.validTo, isService: contracts.isService }).from(contracts).innerJoin(companies, eq(companies.id, contracts.companyId)).where(eq(contracts.id, doc.contractId)).limit(1) : [];
  const [base] = doc.basedOnId ? await db.select({ id: documents.id, type: documents.type, number: documents.number, status: documents.status, date: documents.date }).from(documents).where(eq(documents.id, doc.basedOnId)).limit(1) : [];
  const children = await db
    .select({ id: documents.id, type: documents.type, number: documents.number, status: documents.status, date: documents.date, total: documents.total })
    .from(documents)
    .where(eq(documents.basedOnId, id))
    .orderBy(asc(documents.createdAt));
  // выпуск в режиме смены: распределения материалов, в которые он вошёл, — тоже его дочерние документы
  if (type === 'production') {
    const allocs = await db
      .selectDistinct({ id: documents.id, type: documents.type, number: documents.number, status: documents.status, date: documents.date, total: documents.total, createdAt: documents.createdAt })
      .from(materialAllocationItems)
      .innerJoin(documents, eq(documents.id, materialAllocationItems.documentId))
      .where(eq(materialAllocationItems.releaseId, id))
      .orderBy(asc(documents.createdAt));
    for (const { createdAt: _, ...a } of allocs) if (!children.some(c => c.id === a.id)) children.push(a);
  }
  const rows = await db
    .select({ line: documentLines, sku: products.sku, kind: products.kind, trackSerials: products.trackSerials })
    .from(documentLines)
    .innerJoin(products, eq(products.id, documentLines.productId))
    .where(eq(documentLines.documentId, id))
    .orderBy(asc(documentLines.sortOrder), asc(documentLines.createdAt));
  const ids = rows.map(r => r.line.id);
  const isOrder = DOCUMENT_META[type].isOrder === true;
  const isReturnable = DOCUMENT_META[type].isReturn === true;
  const sums = async (col: typeof documentLines.originLineId | typeof documentLines.sourceLineId, types: string[], posted: boolean) => {
    if (!ids.length) return new Map<string, string>();
    const r = await db
      .select({ ref: col, qty: sql<string>`sum(${documentLines.qty})` })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .where(and(inArray(col, ids), inArray(documents.type, types), posted ? eq(documents.status, 'posted') : ne(documents.status, 'cancelled')))
      .groupBy(col);
    return new Map(r.map(x => [x.ref!, x.qty]));
  };
  const shipped = isOrder ? await sums(documentLines.originLineId, FULFIL_TYPES, true) : new Map<string, string>();
  const planned = isOrder ? await sums(documentLines.originLineId, FULFIL_TYPES, false) : new Map<string, string>();
  const returned = isReturnable ? await sums(documentLines.sourceLineId, [type === 'realization' ? 'customer_return' : 'supplier_return'], true) : new Map<string, string>();
  const lines: DocumentLineView[] = rows.map(r => ({ ...r.line, sku: r.sku, kind: r.kind, trackSerials: r.trackSerials, shipped: fmt(dec(shipped.get(r.line.id) ?? 0), 3), planned: fmt(dec(planned.get(r.line.id) ?? 0), 3), returned: fmt(dec(returned.get(r.line.id) ?? 0), 3) }));
  const totals = computeTotals(lines.map(l => ({ net: l.net, vatAmount: l.vatAmount, total: l.total, vatRate: l.vatRate })));
  const [targetWh] = doc.targetWarehouseId ? await db.select({ id: warehouses.id, name: warehouses.name, kind: warehouses.kind }).from(warehouses).where(eq(warehouses.id, doc.targetWarehouseId)).limit(1) : [];
  const [costItem] = doc.costItemId ? await db.select({ id: costItems.id, name: costItems.name, kind: costItems.kind }).from(costItems).where(eq(costItems.id, doc.costItemId)).limit(1) : [];
  // получатель имущества в эксплуатацию: сотрудник или участок
  const [inUseMember] = doc.inUseMemberId ? await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.id, doc.inUseMemberId)).limit(1) : [];
  const [inUseWorkCenter] = doc.inUseWorkCenterId ? await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(eq(workCenters.id, doc.inUseWorkCenterId)).limit(1) : [];
  // участок списания: себестоимость списанного уходит в косвенные затраты участка (закрытие периода)
  const [workCenter] = doc.workCenterId ? await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(eq(workCenters.id, doc.workCenterId)).limit(1) : [];
  // внутренний документ: стоимость по себестоимости (сумма qty × cost движений)
  const costs = DOCUMENT_META[type].party === null ? await documentCosts(db, [id]) : new Map<string, string>();
  const [investmentProject] = doc.investmentProjectId ? await db.select({ id: investmentProjects.id, name: investmentProjects.name, status: investmentProjects.status }).from(investmentProjects).where(eq(investmentProjects.id, doc.investmentProjectId)).limit(1) : [];
  return { ...doc, investmentProject: investmentProject ?? null, organization: org ?? null, counterparty: cp ?? null, contract: contract ?? null, warehouse: wh ?? null, targetWarehouse: targetWh ?? null, costItem: costItem ?? null, workCenter: workCenter ?? null, inUseMember: inUseMember ?? null, inUseWorkCenter: inUseWorkCenter ?? null, costTotal: costs.get(id) ?? '0.00', basedOn: base ?? null, children, lines, totals, serials: await lineSerialsView(db, id) };
}

/* ---------------- данные для печатной формы ---------------- */

async function defaultBank(db: Db, owner: { companyId?: string; organizationId?: string }): Promise<PrintBank | null> {
  const where = owner.companyId ? eq(bankAccounts.companyId, owner.companyId) : eq(bankAccounts.organizationId, owner.organizationId!);
  const [b] = await db.select().from(bankAccounts).where(where).orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.createdAt)).limit(1);
  return b ? { bik: b.bik, account: b.account, corrAccount: b.corrAccount, bankName: b.bankName } : null;
}

/** Данные заказ-наряда для печатной формы: вид, состояние, материалы и исполнители */
async function workOrderPrintData(db: Db, d: DocumentRow): Promise<NonNullable<PrintData['workOrder']>> {
  const [kind] = d.workOrderKindId ? await db.select({ name: workOrderKinds.name }).from(workOrderKinds).where(eq(workOrderKinds.id, d.workOrderKindId)).limit(1) : [];
  // ключ состояния уникален только внутри вида
  const [state] = d.state && d.workOrderKindId ? await db.select({ label: documentStates.label }).from(documentStates).where(and(eq(documentStates.kindId, d.workOrderKindId), eq(documentStates.key, d.state))).limit(1) : [];
  const materials = await db
    .select({ name: products.name, unitCode: workOrderMaterials.unitCode, symbol: units.symbol, qty: workOrderMaterials.qty })
    .from(workOrderMaterials)
    .innerJoin(products, eq(products.id, workOrderMaterials.productId))
    .leftJoin(units, eq(units.code, workOrderMaterials.unitCode))
    .where(eq(workOrderMaterials.documentId, d.id))
    .orderBy(asc(workOrderMaterials.createdAt));
  const assignees = await db
    .select({ name: members.name, centerName: workCenters.name, plannedHours: workOrderAssignments.plannedHours, startDate: tasks.startDate, dueDate: tasks.dueDate })
    .from(workOrderAssignments)
    .innerJoin(tasks, eq(tasks.id, workOrderAssignments.taskId))
    .leftJoin(members, eq(members.id, tasks.assigneeId))
    .leftJoin(workCenters, eq(workCenters.id, workOrderAssignments.workCenterId))
    .where(eq(workOrderAssignments.documentId, d.id))
    .orderBy(asc(workOrderAssignments.createdAt));
  return {
    kindName: kind?.name ?? '',
    stateLabel: state?.label ?? '',
    materials: materials.map((m, i) => ({ n: i + 1, name: m.name, unitCode: m.unitCode, unitSymbol: m.symbol ?? m.unitCode, qty: m.qty })),
    assignees: assignees.map(a => ({ name: a.name ?? '', workCenterName: a.centerName, plannedHours: a.plannedHours, startDate: a.startDate, dueDate: a.dueDate })),
  };
}

/** Всё, что нужно шаблону печатной формы (счёт, УПД, акт, ТОРГ-12): документ, обе стороны с реквизитами и банком, строки с единицами */
export async function buildPrintData(db: Db, id: string): Promise<PrintData> {
  const d = await documentDetail(db, id);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, d.organizationId)).limit(1);
  if (!org) throw new DomainError(404, 'not_found', 'organization not found');
  const [co] = d.counterpartyId ? await db.select().from(companies).where(eq(companies.id, d.counterpartyId)).limit(1) : [];
  const unitRows = await db.select({ code: units.code, symbol: units.symbol }).from(units);
  const symbol = new Map(unitRows.map(u => [u.code, u.symbol]));
  // себестоимость по строкам (внутренние документы): у перемещения — цена расходной стороны
  const lineCosts = DOCUMENT_META[d.type as DocumentType].party === null ? await documentLineCosts(db, id) : new Map<string, string>();
  // серийные номера строк и гарантия товаров (гарантийный талон)
  const serialsByLine = new Map<string, { serial: string; warrantyUntil: string | null }[]>();
  for (const sr of await lineSerialsView(db, id)) if (sr.lineId) serialsByLine.set(sr.lineId, [...(serialsByLine.get(sr.lineId) ?? []), { serial: sr.serial, warrantyUntil: sr.warrantyUntil }]);
  const warrantyRows = d.lines.length ? await db.select({ id: products.id, m: products.warrantyMonths }).from(products).where(inArray(products.id, [...new Set(d.lines.map(l => l.productId))])) : [];
  const warrantyBy = new Map(warrantyRows.map(w => [w.id, w.m]));
  const party: PrintParty = co
    ? { name: co.name, fullName: co.name, inn: co.inn, kpp: co.kpp, ogrn: co.ogrn, address: co.legalAddress || co.city, phone: '', bank: await defaultBank(db, { companyId: co.id }) }
    : { name: '', fullName: '', inn: '', kpp: '', ogrn: '', address: '', phone: '', bank: null };
  return {
    type: d.type as DocumentType,
    number: d.number,
    date: d.date,
    dueDate: d.dueDate,
    priceIncludesVat: d.priceIncludesVat,
    organization: {
      name: org.name,
      fullName: org.fullName || org.name,
      inn: org.inn,
      kpp: org.kpp,
      ogrn: org.ogrn,
      address: org.legalAddress,
      phone: org.phone,
      bank: await defaultBank(db, { organizationId: org.id }),
      kind: org.kind,
      directorName: org.directorName,
      directorTitle: org.directorTitle,
      accountantName: org.accountantName,
      taxSystem: org.taxSystem,
      stampFile: org.stampFile ?? null,
      directorSignatureFile: org.directorSignatureFile ?? null,
      accountantSignatureFile: org.accountantSignatureFile ?? null,
    },
    party,
    lines: d.lines.map((l, i) => ({
      n: i + 1,
      sku: l.sku,
      name: l.name,
      unitCode: l.unitCode,
      unitSymbol: symbol.get(l.unitCode) ?? l.unitCode,
      qty: l.qty,
      price: l.price,
      discountPct: l.discountPct,
      vatRate: l.vatRate,
      net: l.net,
      vatAmount: l.vatAmount,
      total: l.total,
      ...(d.type === 'inventory_count' ? { bookQty: l.bookQty, diffQty: fmt(dec(l.qty) - dec(l.bookQty), 3) } : {}),
      ...(lineCosts.has(l.id) ? { cost: lineCosts.get(l.id)! } : {}),
      kind: l.kind,
      ...(serialsByLine.has(l.id) ? { serials: serialsByLine.get(l.id)! } : {}),
      warrantyMonths: warrantyBy.get(l.productId) ?? null,
    })),
    totals: d.totals,
    ...(d.type === 'work_order' ? { workOrder: await workOrderPrintData(db, d) } : {}),
    ...(d.type === 'work_order' ? await repairPrintData(db, id, d.workOrderKindId, d.date, today()).then(r => (r ? { repair: r } : {})) : {}),
    basedOn: d.basedOn ? { type: d.basedOn.type as DocumentType, number: d.basedOn.number, date: d.basedOn.date } : null,
    comment: d.comment,
    warehouseName: d.warehouse?.name,
    targetWarehouseName: d.targetWarehouse?.name,
    costItemName: d.costItem?.name,
    holderName: d.inUseMember?.name ?? d.inUseWorkCenter?.name,
    operation: d.operation ?? undefined,
  };
}
