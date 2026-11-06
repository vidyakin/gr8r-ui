/* Бюджет объекта и контроль затрат (задача 1270, docs/architecture/construction.md).
   Бюджет категории — сумма qty × cost_price позиций согласованной основной сметы и согласованных допработ.
   Факт категории — проведённые документы и платежи с аналитикой объекта, без НДС:
   материалы — себестоимость расхода по движениям склада (списание, выпуск, распределение материалов, заказ-наряд),
   субподряд — строки-услуги поступлений, прочие — «Прочие затраты» и расходные платежи без документа-основания,
   труд — сумма cost_amount подтверждённых смен объекта (табель прораба). Деньги — decimal (dec/fmt), без float.
   Всё в транзакции вызывающего. */
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  dec,
  estimateLineTotals,
  ESTIMATE_KIND_CATEGORY,
  fmt,
  OBJECT_COST_CATEGORIES,
  type BudgetPolicy,
  type ObjectCostCategory,
  type Role,
} from '@gr8r/shared';
import type { Db } from './client';
import { canSeeCost } from './cost';
import { DomainError } from './errors';
import { recordEvent } from './events';
import {
  cashFlowItems,
  documentLines,
  documents,
  objectEstimateItems,
  objectEstimates,
  objects,
  objectShiftHours,
  objectShifts,
  paymentLines,
  products,
  stockCostAdjustments,
  stockMoves,
} from './schema';

/** Контекст записи: чей воркспейс и кто автор (для события о превышении бюджета) */
export interface BudgetCtx {
  workspaceId: string;
  memberId: string | null;
}

/** Документы, чей расход со склада становится материалом объекта (перемещение, приходы и возвраты — не затрата) */
const MATERIAL_FACT_TYPES = ['write_off', 'production', 'material_allocation', 'work_order'] as const;
/** Платёжные документы: расходные строки с объектом дают факт «прочие затраты» */
const PAYMENT_DOC_TYPES = ['cash_payment', 'bank_payment', 'advance_report'] as const;
/** Типы документов, которые после проведения могут превысить бюджет: они дают факт категории */
const BUDGET_DOC_TYPES: readonly string[] = [...MATERIAL_FACT_TYPES, 'receipt', 'other_costs'];

export interface ObjectBudgetCategory {
  /** Бюджет категории: согласованная смета и согласованные допработы; null — нет права видеть суммы */
  budget: string | null;
  /** Факт: проведённые документы и платежи объекта; null — нет права видеть суммы */
  fact: string | null;
  /** Остаток = бюджет − факт */
  rest: string | null;
  /** Перерасход: факт больше бюджета */
  over: boolean;
}

export interface ObjectBudgetView {
  objectId: string;
  /** Политика контроля бюджета: не контролировать, предупредить, запретить */
  policy: BudgetPolicy;
  /** Есть ли согласованная смета: без неё бюджета нет и контроль не действует */
  hasEstimate: boolean;
  categories: Record<ObjectCostCategory, ObjectBudgetCategory>;
  totals: ObjectBudgetCategory;
  /** Суммы видят только owner и admin (как в сводке объекта) */
  canSeeCost: boolean;
}

/** Факт по категориям: суммы без НДС */
export type ObjectCostFacts = Record<ObjectCostCategory, string>;

const money = (v: string | null | undefined): string => fmt(dec(v ?? '0'), 2);

/** Факт затрат объекта по категориям. Деньги карточки видят owner/admin, но для контроля считаем всегда полностью */
export async function objectCostFacts(db: Db, objectId: string): Promise<ObjectCostFacts> {
  // материалы: себестоимость расхода по движениям склада документов объекта (перемещение на склад объекта — не затрата)
  const [material] = await db
    .select({
      s: sql<string>`coalesce(sum(case when ${stockMoves.qty} < 0 then -${stockMoves.qty} * (${stockMoves.cost} + coalesce(${stockCostAdjustments.deltaCost}, 0)) else 0 end), 0)::text`,
    })
    .from(stockMoves)
    .innerJoin(documents, and(eq(documents.workspaceId, stockMoves.workspaceId), eq(documents.id, stockMoves.documentId)))
    .leftJoin(stockCostAdjustments, and(eq(stockCostAdjustments.workspaceId, stockMoves.workspaceId), eq(stockCostAdjustments.moveId, stockMoves.id)))
    .where(and(eq(documents.objectId, objectId), eq(documents.status, 'posted'), inArray(documents.type, [...MATERIAL_FACT_TYPES])));
  // субподряд: строки-услуги поступлений с объектом, сумма без НДС
  const [subcontract] = await db
    .select({ s: sql<string>`coalesce(sum(${documentLines.net}), 0)::text` })
    .from(documentLines)
    .innerJoin(documents, and(eq(documents.workspaceId, documentLines.workspaceId), eq(documents.id, documentLines.documentId)))
    .innerJoin(products, and(eq(products.workspaceId, documentLines.workspaceId), eq(products.id, documentLines.productId)))
    .where(and(eq(documents.objectId, objectId), eq(documents.status, 'posted'), eq(documents.type, 'receipt'), eq(products.kind, 'service')));
  // прочие прямые: документы «Прочие затраты» с объектом
  const [otherCosts] = await db
    .select({ s: sql<string>`coalesce(sum(${documents.total}), 0)::text` })
    .from(documents)
    .where(and(eq(documents.objectId, objectId), eq(documents.status, 'posted'), eq(documents.type, 'other_costs')));
  // прочие прямые: расходные строки платежей с объектом без документа-основания (оплата по поступлению
  // уже учтена как субподряд, поэтому платёж со ссылкой на документ расчётов в факт не берётся)
  const [payments] = await db
    .select({ s: sql<string>`coalesce(sum(${paymentLines.amount}), 0)::text` })
    .from(paymentLines)
    .innerJoin(documents, and(eq(documents.workspaceId, paymentLines.workspaceId), eq(documents.id, paymentLines.documentId)))
    .innerJoin(cashFlowItems, and(eq(cashFlowItems.workspaceId, paymentLines.workspaceId), eq(cashFlowItems.id, paymentLines.cashFlowItemId)))
    .where(
      and(
        eq(paymentLines.objectId, objectId),
        eq(documents.status, 'posted'),
        inArray(documents.type, [...PAYMENT_DOC_TYPES]),
        eq(cashFlowItems.kind, 'expense'),
        isNull(paymentLines.settlementDocumentId),
        // перевод между своими кассами и счетами затратой не является
        sql`${documents.operation} is distinct from 'money_transfer'`,
      ),
    );
  // труд: сумма подтверждённых смен объекта (табель прораба, задача 1271). Строка без стоимости часа
  // (нет ни почасовой ставки, ни оклада) даёт пробел, а не ноль: cost_amount пустой
  const [labor] = await db
    .select({ s: sql<string>`coalesce(sum(coalesce(${objectShiftHours.costAmount}, 0)), 0)::text` })
    .from(objectShiftHours)
    .innerJoin(objectShifts, and(eq(objectShifts.workspaceId, objectShiftHours.workspaceId), eq(objectShifts.id, objectShiftHours.shiftId)))
    .where(and(eq(objectShifts.objectId, objectId), eq(objectShifts.status, 'confirmed')));
  return {
    material: money(material?.s),
    labor: money(labor?.s),
    subcontract: money(subcontract?.s),
    other: money(fmt(dec(otherCosts?.s) + dec(payments?.s), 2)),
  };
}

/** Бюджет категорий: позиции согласованной основной сметы и согласованных допработ (qty × cost_price) */
async function objectBudgets(db: Db, objectId: string): Promise<Record<ObjectCostCategory, string>> {
  const rows = await db
    .select({ kind: objectEstimateItems.kind, qty: objectEstimateItems.qty, costPrice: objectEstimateItems.costPrice })
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
    );
  const sums: Record<ObjectCostCategory, bigint> = { material: 0n, labor: 0n, subcontract: 0n, other: 0n };
  for (const r of rows) {
    // себестоимость строки считается той же функцией, что и в смете: округление до копейки по строке
    sums[ESTIMATE_KIND_CATEGORY[r.kind]] += dec(estimateLineTotals({ kind: r.kind, qty: r.qty, price: '0', costPrice: r.costPrice, laborHours: '0' }).cost);
  }
  return { material: fmt(sums.material, 2), labor: fmt(sums.labor, 2), subcontract: fmt(sums.subcontract, 2), other: fmt(sums.other, 2) };
}

/** Есть ли у объекта согласованная смета: без неё бюджета нет и контроль не действует */
async function hasApprovedEstimate(db: Db, objectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: objectEstimates.id })
    .from(objectEstimates)
    .where(
      and(
        eq(objectEstimates.objectId, objectId),
        or(
          and(eq(objectEstimates.kind, 'main'), eq(objectEstimates.status, 'approved')),
          and(eq(objectEstimates.kind, 'change'), eq(objectEstimates.changeStatus, 'approved')),
        ),
      ),
    )
    .limit(1);
  return !!row;
}

const categoryView = (budget: string, fact: string): ObjectBudgetCategory => {
  const rest = dec(budget) - dec(fact);
  return { budget, fact, rest: fmt(rest, 2), over: rest < 0n };
};

const masked = (): ObjectBudgetCategory => ({ budget: null, fact: null, rest: null, over: false });

/** Бюджет объекта по категориям: бюджет, факт, остаток и перерасход. Суммы — только owner/admin */
export async function objectBudget(db: Db, objectId: string, role: Role | undefined): Promise<ObjectBudgetView> {
  const view = await budgetOf(db, objectId);
  if (!view) throw new DomainError(404, 'not_found', 'object not found');
  const showMoney = canSeeCost(role);
  const categories = {} as Record<ObjectCostCategory, ObjectBudgetCategory>;
  for (const cat of OBJECT_COST_CATEGORIES) categories[cat] = showMoney ? view.categories[cat] : masked();
  return { ...view, categories, totals: showMoney ? view.totals : masked(), canSeeCost: showMoney };
}

/** Бюджет без прав доступа — для контроля и служебных вызовов; null — объекта нет (или он чужой) */
async function budgetOf(db: Db, objectId: string): Promise<Omit<ObjectBudgetView, 'canSeeCost'> | null> {
  const [obj] = await db.select({ id: objects.id, policy: objects.budgetPolicy }).from(objects).where(eq(objects.id, objectId)).limit(1);
  if (!obj) return null;
  const [hasEstimate, budgets, facts] = await Promise.all([hasApprovedEstimate(db, objectId), objectBudgets(db, objectId), objectCostFacts(db, objectId)]);
  const categories = {} as Record<ObjectCostCategory, ObjectBudgetCategory>;
  let budgetTotal = 0n;
  let factTotal = 0n;
  for (const cat of OBJECT_COST_CATEGORIES) {
    budgetTotal += dec(budgets[cat]);
    factTotal += dec(facts[cat]);
    categories[cat] = categoryView(budgets[cat], facts[cat]);
  }
  return { objectId, policy: obj.policy, hasEstimate, categories, totals: categoryView(fmt(budgetTotal, 2), fmt(factTotal, 2)) };
}

/** Контроль бюджета после проведения: block — 422 budget_exceeded, warn — код предупреждения budget_exceeded:<категория>.
    Без согласованной сметы и при политике none контроля нет. Вызывать в транзакции проведения после записи движений. */
export async function assertObjectBudget(db: Db, ctx: BudgetCtx, objectId: string): Promise<string[]> {
  const budget = await budgetOf(db, objectId);
  if (!budget || !budget.hasEstimate || budget.policy === 'none') return [];
  const warnings: string[] = [];
  for (const cat of OBJECT_COST_CATEGORIES) {
    const c = budget.categories[cat];
    if (c.budget === null || c.fact === null || dec(c.fact) <= dec(c.budget)) continue;
    if (budget.policy === 'block') {
      throw new DomainError(422, 'budget_exceeded', `The ${cat} budget of the object is exceeded: spent ${c.fact} of ${c.budget}`, {
        category: cat,
        budget: c.budget,
        fact: c.fact,
      });
    }
    warnings.push(`budget_exceeded:${cat}`);
    await recordEvent(db, {
      workspaceId: ctx.workspaceId,
      type: 'object.budget_exceeded',
      entity: 'object',
      recordId: objectId,
      actorId: ctx.memberId,
      payload: { category: cat, budget: c.budget, fact: c.fact },
    });
  }
  return warnings;
}

/** Контроль бюджета при проведении документа: объект шапки или объекты строк платежа.
    Предупреждения возвращаются в ответе проведения; block бросает 422 и откатывает транзакцию. */
export async function documentBudgetWarnings(db: Db, ctx: BudgetCtx, doc: { id: string; type: string; objectId: string | null }): Promise<string[]> {
  let objectIds: string[] = [];
  if ((PAYMENT_DOC_TYPES as readonly string[]).includes(doc.type)) {
    const rows = await db
      .select({ objectId: paymentLines.objectId })
      .from(paymentLines)
      .where(and(eq(paymentLines.documentId, doc.id), isNotNull(paymentLines.objectId)));
    objectIds = [...new Set(rows.map(r => r.objectId!))];
  } else if (doc.objectId && BUDGET_DOC_TYPES.includes(doc.type)) objectIds = [doc.objectId];
  const warnings: string[] = [];
  for (const id of objectIds) warnings.push(...(await assertObjectBudget(db, ctx, id)));
  return warnings;
}
