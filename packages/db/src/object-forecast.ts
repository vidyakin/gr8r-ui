/* Прогноз прибыли объекта (задача 1275, docs/architecture/construction.md).
   Собирает вход чистого расчёта (`computeObjectForecast` из @gr8r/shared) из БД и отдаёт отчёт:
   план по позициям согласованной сметы и согласованных допработ, факт по категориям (objectCostFacts),
   факт труда по позициям — подтверждённые смены с estimate_item_id, принятое по позициям субподряда — принятые акты
   субподрядчика, стоимость договора (objectContractValue) и накладные объекта. Ручные правки остатка живут в
   object_forecast_overrides: всегда с причиной и автором, ровно одна цель — позиция или категория.
   Деньги (себестоимость, прогноз, прибыль и ставки) видят только owner/admin (`canSeeCost`), остальным — 403.
   Всё в транзакции вызывающего; изменение правки и событие — в одной транзакции. */
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import {
  computeObjectForecast,
  dec,
  fmt,
  OBJECT_COST_CATEGORIES,
  type ObjectCostCategory,
  type ObjectForecastResult,
  type ObjectRevenueAmounts,
  type Role,
} from '@gr8r/shared';
import type { Db } from './client';
import { canSeeCost } from './cost';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { objectRevenue } from './object-acts';
import { objectCostFacts } from './object-budget';
import { objectContractValue, objectProgress } from './object-progress';
import { assertObjectRef } from './objects';
import {
  companies,
  members,
  objectActs,
  objectEstimateItems,
  objectEstimates,
  objectForecastOverrides,
  objectShiftHours,
  objectShifts,
  objectSubActLines,
  objectSubActs,
  objects,
} from './schema';

/** Контекст записи правки: чей воркспейс, кто автор и его роль (правит только admin и выше) */
export interface ForecastCtx {
  workspaceId: string;
  memberId: string | null;
  role?: Role | undefined;
}

/** Ручная правка остатка для отчёта: цель, новое значение, причина, автор и дата */
export interface ObjectForecastOverrideView {
  id: string;
  objectId: string;
  estimateItemId: string | null;
  /** Наименование позиции сметы (у правки категории — null) */
  itemName: string | null;
  category: ObjectCostCategory | null;
  remaining: string;
  reason: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

/** Справка выручки: выполнено, принято, выставлено, оплачено — не смешивается с прогнозом */
export type ObjectForecastRevenue = ObjectRevenueAmounts;

/** Отчёт прогноза объекта для интерфейса */
export interface ObjectForecastView extends ObjectForecastResult {
  objectId: string;
  number: string;
  name: string;
  /** Дата и источник расчёта (снимок: прогноз не хранится, считается на лету) */
  computedAt: string;
  source: { estimate: boolean; shifts: number; subActs: number };
  overrides: ObjectForecastOverrideView[];
  revenue: ObjectForecastRevenue;
}

/** Прогноз без прав доступа — для портфеля и служебных вызовов */
interface ForecastData {
  objectId: string;
  number: string;
  name: string;
  status: string;
  customerName: string | null;
  result: ObjectForecastResult;
  overrides: ObjectForecastOverrideView[];
  source: { estimate: boolean; shifts: number; subActs: number };
}

const money = (v: string | bigint | null | undefined): string => fmt(typeof v === 'bigint' ? v : dec(v ?? '0'), 2);

/** Согласованные позиции: основная смета и согласованные допработы */
async function approvedItems(db: Db, objectId: string) {
  return db
    .select({
      id: objectEstimateItems.id,
      kind: objectEstimateItems.kind,
      name: objectEstimateItems.name,
      unitCode: objectEstimateItems.unitCode,
      qty: objectEstimateItems.qty,
      price: objectEstimateItems.price,
      costPrice: objectEstimateItems.costPrice,
      laborHours: objectEstimateItems.laborHours,
      doneQty: objectEstimateItems.doneQty,
    })
    .from(objectEstimateItems)
    .innerJoin(objectEstimates, and(eq(objectEstimates.workspaceId, objectEstimateItems.workspaceId), eq(objectEstimates.id, objectEstimateItems.estimateId)))
    .where(
      and(
        eq(objectEstimates.objectId, objectId),
        or(
          and(eq(objectEstimates.kind, 'main'), eq(objectEstimates.status, 'approved')),
          and(eq(objectEstimates.kind, 'change'), eq(objectEstimates.changeStatus, 'approved')),
        ),
      ),
    )
    .orderBy(asc(objectEstimates.createdAt), asc(objectEstimateItems.sortOrder), asc(objectEstimateItems.id));
}

/** Факт труда по позициям сметы: подтверждённые смены с привязкой к позиции */
async function laborByItem(db: Db, objectId: string) {
  return db
    .select({
      itemId: objectShiftHours.estimateItemId,
      hours: sql<string>`coalesce(sum(${objectShiftHours.hours}), 0)::text`,
      cost: sql<string>`coalesce(sum(${objectShiftHours.costAmount}), 0)::text`,
      hoursWithoutCost: sql<string>`coalesce(sum(case when ${objectShiftHours.costAmount} is null then ${objectShiftHours.hours} else 0 end), 0)::text`,
      priced: sql<number>`count(${objectShiftHours.costAmount})::int`,
    })
    .from(objectShiftHours)
    .innerJoin(objectShifts, and(eq(objectShifts.workspaceId, objectShiftHours.workspaceId), eq(objectShifts.id, objectShiftHours.shiftId)))
    .where(and(eq(objectShifts.objectId, objectId), eq(objectShifts.status, 'confirmed'), isNotNull(objectShiftHours.estimateItemId)))
    .groupBy(objectShiftHours.estimateItemId);
}

/** Принятое по позициям субподряда: только принятые акты субподрядчика */
async function acceptedByItem(db: Db, objectId: string) {
  return db
    .select({
      itemId: objectSubActLines.estimateItemId,
      qty: sql<string>`coalesce(sum(${objectSubActLines.acceptedQty}), 0)::text`,
    })
    .from(objectSubActLines)
    .innerJoin(objectSubActs, and(eq(objectSubActs.workspaceId, objectSubActLines.workspaceId), eq(objectSubActs.id, objectSubActLines.actId)))
    .where(and(eq(objectSubActs.objectId, objectId), eq(objectSubActs.status, 'accepted'), isNotNull(objectSubActLines.estimateItemId)))
    .groupBy(objectSubActLines.estimateItemId);
}

/** Ручные правки остатка объекта с автором и наименованием позиции */
async function overrideRows(db: Db, objectId: string): Promise<ObjectForecastOverrideView[]> {
  const rows = await db
    .select({
      id: objectForecastOverrides.id,
      objectId: objectForecastOverrides.objectId,
      estimateItemId: objectForecastOverrides.estimateItemId,
      itemName: objectEstimateItems.name,
      category: objectForecastOverrides.category,
      remaining: objectForecastOverrides.remaining,
      reason: objectForecastOverrides.reason,
      authorId: objectForecastOverrides.authorId,
      authorName: members.name,
      createdAt: objectForecastOverrides.createdAt,
    })
    .from(objectForecastOverrides)
    .leftJoin(
      objectEstimateItems,
      and(eq(objectEstimateItems.workspaceId, objectForecastOverrides.workspaceId), eq(objectEstimateItems.id, objectForecastOverrides.estimateItemId)),
    )
    .leftJoin(members, and(eq(members.workspaceId, objectForecastOverrides.workspaceId), eq(members.id, objectForecastOverrides.authorId)))
    .where(eq(objectForecastOverrides.objectId, objectId))
    .orderBy(desc(objectForecastOverrides.createdAt));
  return rows.map(r => ({
    id: r.id,
    objectId: r.objectId,
    estimateItemId: r.estimateItemId,
    itemName: r.itemName,
    category: r.category,
    remaining: money(r.remaining),
    reason: r.reason,
    authorId: r.authorId,
    authorName: r.authorName,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Сколько подтверждённых смен и принятых актов субподряда у объекта (источник расчёта) */
async function factSources(db: Db, objectId: string): Promise<{ shifts: number; subActs: number }> {
  const [shifts] = await db.select({ n: count() }).from(objectShifts).where(and(eq(objectShifts.objectId, objectId), eq(objectShifts.status, 'confirmed')));
  const [subActs] = await db.select({ n: count() }).from(objectSubActs).where(and(eq(objectSubActs.objectId, objectId), eq(objectSubActs.status, 'accepted')));
  return { shifts: Number(shifts?.n ?? 0), subActs: Number(subActs?.n ?? 0) };
}

/** Прогноз без прав доступа: объект, чип расчёта, правки и источник */
async function forecastData(db: Db, objectId: string): Promise<ForecastData> {
  const [obj] = await db
    .select({
      id: objects.id,
      number: objects.number,
      name: objects.name,
      status: objects.status,
      overheadPct: objects.overheadPct,
      customerName: companies.name,
    })
    .from(objects)
    .leftJoin(companies, and(eq(companies.workspaceId, objects.workspaceId), eq(companies.id, objects.customerId)))
    .where(eq(objects.id, objectId))
    .limit(1);
  if (!obj) throw new DomainError(404, 'not_found', 'object not found');
  const [items, facts, contractValue, labor, accepted, overrides, sources] = await Promise.all([
    approvedItems(db, objectId),
    objectCostFacts(db, objectId),
    objectContractValue(db, objectId),
    laborByItem(db, objectId),
    acceptedByItem(db, objectId),
    overrideRows(db, objectId),
    factSources(db, objectId),
  ]);
  const result = computeObjectForecast({
    hasEstimate: items.length > 0,
    contractValue: contractValue ?? '0',
    overheadPct: obj.overheadPct,
    items,
    facts,
    laborByItem: labor.map(l => ({ itemId: l.itemId!, hours: l.hours, cost: Number(l.priced) > 0 ? l.cost : null, hoursWithoutCost: l.hoursWithoutCost })),
    acceptedByItem: accepted.map(a => ({ itemId: a.itemId!, qty: a.qty })),
    overrides: overrides.map(o => ({ estimateItemId: o.estimateItemId, category: o.category, remaining: o.remaining, reason: o.reason })),
  });
  return {
    objectId,
    number: obj.number,
    name: obj.name,
    status: obj.status,
    customerName: obj.customerName,
    result,
    overrides,
    source: { estimate: items.length > 0, ...sources },
  };
}

/** Отчёт прогноза прибыли объекта. Суммы видят только owner/admin — остальным 403 */
export async function objectForecast(db: Db, objectId: string, role: Role | undefined): Promise<ObjectForecastView> {
  if (!canSeeCost(role)) throw new DomainError(403, 'forbidden', 'Only the owner or an admin can see the profit forecast');
  const data = await forecastData(db, objectId);
  const revenue = await objectRevenue(db, objectId);
  return {
    objectId: data.objectId,
    number: data.number,
    name: data.name,
    ...data.result,
    computedAt: new Date().toISOString(),
    source: data.source,
    overrides: data.overrides,
    revenue: { done: revenue.done, accepted: revenue.accepted, invoiced: revenue.invoiced, paid: revenue.paid },
  };
}

/* ---------------- исполнители ---------------- */

/** Позиция сметы, на которую работник списал часы */
export interface ForecastExecutorPosition {
  estimateItemId: string | null;
  name: string | null;
  hours: string;
  costAmount: string | null;
}

/** Исполнитель по подтверждённым сменам: часы, стоимость труда и позиции */
export interface ForecastExecutorRow {
  memberId: string;
  memberName: string;
  personnelNumber: string | null;
  hours: string;
  /** Стоимость труда; null — ни у одного часа нет ставки */
  costAmount: string | null;
  /** Часы без ставки — пробел, не ноль */
  hoursWithoutCost: string;
  positions: ForecastExecutorPosition[];
}

export interface ObjectForecastExecutorsView {
  objectId: string;
  from: string | null;
  to: string | null;
  items: ForecastExecutorRow[];
  totals: { hours: string; costAmount: string | null; hoursWithoutCost: string };
}

/** Исполнители объекта по подтверждённым сменам (период необязателен). Суммы — только owner/admin */
export async function objectForecastExecutors(
  db: Db,
  objectId: string,
  role: Role | undefined,
  period: { from?: string | undefined; to?: string | undefined } = {},
): Promise<ObjectForecastExecutorsView> {
  if (!canSeeCost(role)) throw new DomainError(403, 'forbidden', 'Only the owner or an admin can see the labour cost');
  await assertObjectRef(db, objectId);
  const rows = await db
    .select({
      memberId: objectShiftHours.memberId,
      memberName: members.name,
      personnelNumber: members.personnelNumber,
      estimateItemId: objectShiftHours.estimateItemId,
      itemName: objectEstimateItems.name,
      hours: objectShiftHours.hours,
      costAmount: objectShiftHours.costAmount,
    })
    .from(objectShiftHours)
    .innerJoin(objectShifts, and(eq(objectShifts.workspaceId, objectShiftHours.workspaceId), eq(objectShifts.id, objectShiftHours.shiftId)))
    .innerJoin(members, and(eq(members.workspaceId, objectShiftHours.workspaceId), eq(members.id, objectShiftHours.memberId)))
    .leftJoin(
      objectEstimateItems,
      and(eq(objectEstimateItems.workspaceId, objectShiftHours.workspaceId), eq(objectEstimateItems.id, objectShiftHours.estimateItemId)),
    )
    .where(
      and(
        eq(objectShifts.objectId, objectId),
        eq(objectShifts.status, 'confirmed'),
        period.from ? gte(objectShifts.workDate, period.from) : undefined,
        period.to ? lte(objectShifts.workDate, period.to) : undefined,
      ),
    )
    .orderBy(asc(members.name), asc(objectEstimateItems.name));
  interface Acc {
    row: ForecastExecutorRow;
    hours: bigint;
    cost: bigint;
    withoutCost: bigint;
    priced: boolean;
    positions: Map<string, ForecastExecutorPosition>;
  }
  const byMember = new Map<string, Acc>();
  let totalHours = 0n;
  let totalCost = 0n;
  let totalWithoutCost = 0n;
  let anyCost = false;
  for (const r of rows) {
    let acc = byMember.get(r.memberId);
    if (!acc) {
      acc = {
        row: { memberId: r.memberId, memberName: r.memberName, personnelNumber: r.personnelNumber, hours: '0.00', costAmount: null, hoursWithoutCost: '0.00', positions: [] },
        hours: 0n,
        cost: 0n,
        withoutCost: 0n,
        priced: false,
        positions: new Map(),
      };
      byMember.set(r.memberId, acc);
    }
    const h = dec(r.hours);
    const cost = r.costAmount === null ? null : dec(r.costAmount);
    acc.hours += h;
    totalHours += h;
    if (cost === null) {
      acc.withoutCost += h;
      totalWithoutCost += h;
    } else {
      acc.cost += cost;
      acc.priced = true;
      totalCost += cost;
      anyCost = true;
    }
    // позиции: часы и стоимость по позиции сметы (пустая позиция — часы без привязки)
    const key = r.estimateItemId ?? '';
    const pos = acc.positions.get(key) ?? { estimateItemId: r.estimateItemId, name: r.itemName, hours: '0.00', costAmount: null };
    pos.hours = money(dec(pos.hours) + h);
    if (cost !== null) pos.costAmount = money(dec(pos.costAmount ?? '0') + cost);
    acc.positions.set(key, pos);
  }
  for (const acc of byMember.values()) {
    acc.row.hours = money(acc.hours);
    acc.row.costAmount = acc.priced ? money(acc.cost) : null;
    acc.row.hoursWithoutCost = money(acc.withoutCost);
    acc.row.positions = [...acc.positions.values()];
  }
  return {
    objectId,
    from: period.from ?? null,
    to: period.to ?? null,
    items: [...byMember.values()].map(a => a.row),
    totals: { hours: money(totalHours), costAmount: anyCost ? money(totalCost) : null, hoursWithoutCost: money(totalWithoutCost) },
  };
}

/* ---------------- портфель объектов ---------------- */

/** Строка портфеля: объект, выполнение, стоимость договора, факт, прогноз, прибыль и маржа */
export interface PortfolioRow {
  objectId: string;
  number: string;
  name: string;
  status: string;
  customerName: string | null;
  /** Процент выполнения по способу объекта (задача 1272); null — базы расчёта нет */
  progressPercent: string | null;
  contractValue: string;
  planCost: string;
  factCost: string;
  remaining: string | null;
  forecastCost: string | null;
  profit: string | null;
  marginPct: string | null;
  hasEstimate: boolean;
}

export interface ObjectPortfolioView {
  items: PortfolioRow[];
  totals: { contractValue: string; factCost: string; forecastCost: string | null; profit: string | null; objects: number };
}

/** Портфель: прогноз по всем незакрытым и неархивным объектам. Суммы — только owner/admin */
export async function objectPortfolio(db: Db, role: Role | undefined): Promise<ObjectPortfolioView> {
  if (!canSeeCost(role)) throw new DomainError(403, 'forbidden', 'Only the owner or an admin can see the portfolio forecast');
  const rows = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(inArray(objects.status, ['planning', 'active', 'hold']), sql`${objects.archivedAt} is null`))
    .orderBy(asc(objects.number));
  const items: PortfolioRow[] = [];
  let contractTotal = 0n;
  let factTotal = 0n;
  let forecastTotal = 0n;
  let profitTotal = 0n;
  let canTotal = true;
  for (const row of rows) {
    const [data, progress] = await Promise.all([forecastData(db, row.id), objectProgress(db, row.id)]);
    const t = data.result.totals;
    if (t.forecastCost === null) canTotal = false;
    else forecastTotal += dec(t.forecastCost);
    if (t.profit === null) canTotal = false;
    else profitTotal += dec(t.profit);
    contractTotal += dec(t.contractValue);
    factTotal += dec(t.factCost);
    items.push({
      objectId: data.objectId,
      number: data.number,
      name: data.name,
      status: data.status,
      customerName: data.customerName,
      progressPercent: progress.percent,
      contractValue: t.contractValue,
      planCost: t.planCost,
      factCost: t.factCost,
      remaining: t.remaining,
      forecastCost: t.forecastCost,
      profit: t.profit,
      marginPct: t.marginPct,
      hasEstimate: data.result.hasEstimate,
    });
  }
  return {
    items,
    totals: {
      contractValue: money(contractTotal),
      factCost: money(factTotal),
      forecastCost: canTotal ? money(forecastTotal) : null,
      profit: canTotal ? money(profitTotal) : null,
      objects: items.length,
    },
  };
}

/* ---------------- ручные правки остатка ---------------- */

export interface ForecastOverrideInput {
  /** Позиция сметы или категория — ровно одно */
  estimateItemId?: string | null | undefined;
  category?: ObjectCostCategory | null | undefined;
  remaining: string;
  reason: string;
}

/** Правка остатка: только admin и выше, причина обязательна, цель — одна. Upsert по (объект, позиция|категория) */
export async function saveForecastOverride(db: Db, ctx: ForecastCtx, objectId: string, input: ForecastOverrideInput): Promise<ObjectForecastOverrideView> {
  if (!canSeeCost(ctx.role)) throw new DomainError(403, 'forbidden', 'Only the owner or an admin can change the forecast');
  await assertObjectRef(db, objectId);
  const reason = input.reason.trim();
  if (!reason) throw new DomainError(422, 'forecast_reason_required', 'A reason is required to change the forecast');
  const itemId = input.estimateItemId ?? null;
  const category = input.category ?? null;
  if ((itemId === null) === (category === null)) throw new DomainError(422, 'invalid_reference', 'Set either an estimate line or a cost category');
  if (category !== null && !(OBJECT_COST_CATEGORIES as readonly string[]).includes(category))
    throw new DomainError(422, 'invalid_reference', 'Unknown cost category');
  if (itemId !== null) {
    // позиция должна принадлежать смете этого объекта
    const [item] = await db
      .select({ id: objectEstimateItems.id })
      .from(objectEstimateItems)
      .innerJoin(objectEstimates, and(eq(objectEstimates.workspaceId, objectEstimateItems.workspaceId), eq(objectEstimates.id, objectEstimateItems.estimateId)))
      .where(and(eq(objectEstimateItems.id, itemId), eq(objectEstimates.objectId, objectId)))
      .limit(1);
    if (!item) throw new DomainError(422, 'invalid_reference', 'The estimate line does not belong to this object');
  }
  const [existing] = await db
    .select({ id: objectForecastOverrides.id })
    .from(objectForecastOverrides)
    .where(
      and(
        eq(objectForecastOverrides.objectId, objectId),
        itemId !== null ? eq(objectForecastOverrides.estimateItemId, itemId) : eq(objectForecastOverrides.category, category!),
      ),
    )
    .limit(1);
  const values = { remaining: money(input.remaining), reason, authorId: ctx.memberId, createdAt: new Date() };
  let id: string;
  if (existing) {
    const [updated] = await db.update(objectForecastOverrides).set(values).where(eq(objectForecastOverrides.id, existing.id)).returning({ id: objectForecastOverrides.id });
    id = updated!.id;
  } else {
    const [created] = await db
      .insert(objectForecastOverrides)
      .values({ workspaceId: ctx.workspaceId, objectId, estimateItemId: itemId, category, ...values })
      .returning({ id: objectForecastOverrides.id });
    id = created!.id;
  }
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: 'object_forecast.override_saved',
    entity: 'object_forecast',
    recordId: id,
    actorId: ctx.memberId,
    payload: { objectId, estimateItemId: itemId, category, remaining: values.remaining },
  });
  const rows = await overrideRows(db, objectId);
  return rows.find(r => r.id === id)!;
}

/** Снятие правки: по id или по цели (позиция сметы / категория). Только admin и выше */
export async function deleteForecastOverride(
  db: Db,
  ctx: ForecastCtx,
  objectId: string,
  target: { id?: string | null | undefined; estimateItemId?: string | null | undefined; category?: ObjectCostCategory | null | undefined },
): Promise<void> {
  if (!canSeeCost(ctx.role)) throw new DomainError(403, 'forbidden', 'Only the owner or an admin can change the forecast');
  await assertObjectRef(db, objectId);
  const itemId = target.estimateItemId ?? null;
  const category = target.category ?? null;
  const where = target.id
    ? and(eq(objectForecastOverrides.objectId, objectId), eq(objectForecastOverrides.id, target.id))
    : itemId !== null
      ? and(eq(objectForecastOverrides.objectId, objectId), eq(objectForecastOverrides.estimateItemId, itemId))
      : category !== null
        ? and(eq(objectForecastOverrides.objectId, objectId), eq(objectForecastOverrides.category, category))
        : null;
  if (!where) throw new DomainError(422, 'invalid_reference', 'Set an override id, an estimate line or a cost category');
  const [removed] = await db.delete(objectForecastOverrides).where(where).returning({ id: objectForecastOverrides.id });
  if (!removed) throw new DomainError(404, 'not_found', 'override not found');
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: 'object_forecast.override_deleted',
    entity: 'object_forecast',
    recordId: removed.id,
    actorId: ctx.memberId,
    payload: { objectId },
  });
}

/** Признак фактов по объекту: подтверждённые смены, принятые акты субподряда, подписанные акты заказчику.
    Согласованную смету нельзя вернуть в черновик, пока они есть (422 estimate_has_facts, задача 1275). */
export async function objectHasFacts(db: Db, objectId: string): Promise<boolean> {
  const [shift] = await db.select({ n: count() }).from(objectShifts).where(and(eq(objectShifts.objectId, objectId), eq(objectShifts.status, 'confirmed')));
  if (Number(shift?.n ?? 0) > 0) return true;
  const [sub] = await db.select({ n: count() }).from(objectSubActs).where(and(eq(objectSubActs.objectId, objectId), eq(objectSubActs.status, 'accepted')));
  if (Number(sub?.n ?? 0) > 0) return true;
  const [act] = await db.select({ n: count() }).from(objectActs).where(and(eq(objectActs.objectId, objectId), eq(objectActs.status, 'signed')));
  return Number(act?.n ?? 0) > 0;
}
