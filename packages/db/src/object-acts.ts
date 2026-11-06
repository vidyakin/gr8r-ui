/* Акты выполненных работ объекта (задача 1273, docs/architecture/construction.md): выручка «по объёмам» (КС-2),
   «по вехе этапа» и «по подтверждённым часам смен». Акт — черновик → подписан заказчиком (принято); подписание
   фиксирует строки, отмена подписи — admin+ и только без оплат. Из подписанного акта выставляются счёт и документ
   «Акт оказания услуг» (выручка и взаиморасчёты с заказчиком) с объектом и заказчиком объекта.
   Строки документа требуют товар — подставляется служебная услуга «Работы по объекту» воркспейса (одна на воркспейс).
   Деньги — строки через decimal из @gr8r/shared, без float. Всё в транзакции вызывающего; изменение + событие — вместе. */
import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  actLineAmount,
  computeActTotals,
  dec,
  fmt,
  milestoneAmount,
  mul,
  objectActNumber,
  type ObjectActKind,
  type ObjectActUpdate,
  type ObjectRevenueAmounts,
  type Role,
  type VatRate,
} from '@gr8r/shared';
import type { Db } from './client';
import { actMoneyByAct } from './act-money';
import { canSeeCost } from './cost';
import { createDocument, postDocument, type DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { assertObjectRef } from './objects';
import { objectContractValue } from './object-progress';
import { printOrg } from './payments';
import {
  companies,
  contracts,
  documents,
  members,
  objectActLines,
  objectActShiftHours,
  objectActs,
  objectEstimateItems,
  objectEstimates,
  objectContracts,
  objectMilestones,
  objectShiftHours,
  objectShifts,
  objects,
  organizations,
  products,
  units,
} from './schema';

export type ObjectActRow = typeof objectActs.$inferSelect;
export type ObjectActLineRow = typeof objectActLines.$inferSelect;

/** Контекст записи акта: чей воркспейс, кто автор и его роль (отмена подписи — admin+) */
export interface ActCtx extends DocCtx {
  role?: Role;
}

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

/* ---------------- чтение сметы и часов ---------------- */

interface ActEstimItem {
  id: string;
  kind: string;
  name: string;
  unitCode: string;
  qty: string;
  price: string;
  vatRate: string;
  doneQty: string;
}

/** Позиции согласованной сметы объекта: основная согласованная и согласованные допработы */
async function approvedItems(db: Db, objectId: string): Promise<ActEstimItem[]> {
  return db
    .select({
      id: objectEstimateItems.id,
      kind: objectEstimateItems.kind,
      name: objectEstimateItems.name,
      unitCode: objectEstimateItems.unitCode,
      qty: objectEstimateItems.qty,
      price: objectEstimateItems.price,
      vatRate: objectEstimateItems.vatRate,
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
    .orderBy(asc(objectEstimates.kind), asc(objectEstimateItems.sortOrder));
}

/** Уже принято по подписанным актам объекта по каждой позиции сметы */
async function acceptedByItem(db: Db, objectId: string, excludeActId?: string): Promise<Map<string, bigint>> {
  const rows = await db
    .select({ itemId: objectActLines.estimateItemId, qty: sql<string>`coalesce(sum(${objectActLines.qty}), 0)::text` })
    .from(objectActLines)
    .innerJoin(objectActs, and(eq(objectActs.workspaceId, objectActLines.workspaceId), eq(objectActs.id, objectActLines.actId)))
    .where(
      and(
        eq(objectActs.objectId, objectId),
        eq(objectActs.status, 'signed'),
        excludeActId ? ne(objectActs.id, excludeActId) : undefined,
      ),
    )
    .groupBy(objectActLines.estimateItemId);
  const out = new Map<string, bigint>();
  for (const r of rows) if (r.itemId) out.set(r.itemId, dec(r.qty));
  return out;
}

/** Ставка НДС для строк акта по вехе и по часам: самая частая ставка позиций согласованной сметы, иначе 20% */
async function defaultVatRate(db: Db, objectId: string): Promise<string> {
  const items = await approvedItems(db, objectId);
  const counts = new Map<string, number>();
  for (const i of items) if (i.vatRate !== 'none') counts.set(i.vatRate, (counts.get(i.vatRate) ?? 0) + 1);
  let best = '20';
  let top = 0;
  for (const [rate, n] of counts) if (n > top) [best, top] = [rate, n];
  return best;
}

interface EligibleHours {
  /** Всего неучтённых подтверждённых часов за период */
  hours: string;
  /** Часы смен, которые войдут в акт (строки object_shift_hours) */
  shiftHourIds: string[];
}

/** Подтверждённые часы смен объекта за период, ещё не вошедшие ни в один акт (свои строки текущего акта не считаем) */
async function eligibleHours(db: Db, objectId: string, from: string, to: string, ownActId?: string): Promise<EligibleHours> {
  const rows = await db
    .select({ id: objectShiftHours.id, hours: objectShiftHours.hours, actId: objectActShiftHours.actId })
    .from(objectShiftHours)
    .innerJoin(objectShifts, and(eq(objectShifts.workspaceId, objectShiftHours.workspaceId), eq(objectShifts.id, objectShiftHours.shiftId)))
    .leftJoin(objectActShiftHours, and(eq(objectActShiftHours.workspaceId, objectShiftHours.workspaceId), eq(objectActShiftHours.shiftHourId, objectShiftHours.id)))
    .where(and(eq(objectShifts.objectId, objectId), eq(objectShifts.status, 'confirmed'), sql`${objectShifts.workDate} between ${from} and ${to}`));
  let total = 0n;
  const ids: string[] = [];
  for (const r of rows) {
    if (r.actId && r.actId !== ownActId) continue;
    ids.push(r.id);
    total += dec(r.hours);
  }
  return { hours: fmt(total, 3), shiftHourIds: ids };
}

/** Символы единиц ОКЕИ для строк акта */
async function unitSymbols(db: Db): Promise<Map<string, string>> {
  const rows = await db.select({ code: units.code, symbol: units.symbol }).from(units);
  return new Map(rows.map(u => [u.code, u.symbol]));
}

/* ---------------- предложение строк ---------------- */

export interface ActSuggestionLine {
  estimateItemId: string | null;
  name: string;
  unitCode: string;
  unitSymbol: string;
  qty: string;
  price: string;
  vatRate: string;
  amount: string;
  /** Выполнено по позиции (акт по объёмам) */
  doneQty?: string;
  /** Уже принято подписанными актами (акт по объёмам) */
  acceptedQty?: string;
}

export interface ActSuggestion {
  objectId: string;
  kind: ObjectActKind;
  milestoneId: string | null;
  periodFrom: string;
  periodTo: string;
  lines: ActSuggestionLine[];
  totals: { net: string; vat: string; total: string };
  /** Часы (акт по часам): неучтённые подтверждённые часы и ставка для заказчика */
  hours?: { hours: string; rate: string | null };
}

export interface ActSuggestionParams {
  kind: ObjectActKind;
  from?: string | undefined;
  to?: string | undefined;
  milestoneId?: string | undefined;
}

/** Веха объекта: чужая или несуществующая — 404 */
async function loadMilestone(db: Db, objectId: string, milestoneId: string) {
  const [row] = await db.select().from(objectMilestones).where(and(eq(objectMilestones.objectId, objectId), eq(objectMilestones.id, milestoneId))).limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'milestone not found');
  return row;
}

/** Строки акта «по вехе»: одна строка — сумма вехи этапа; аванс актом не закрывается (422 advance_not_actable) */
async function milestoneLine(db: Db, objectId: string, milestoneId: string | null): Promise<{ line: ActSuggestionLine; milestoneId: string }> {
  if (!milestoneId) throw new DomainError(422, 'milestone_required', 'Select a milestone for a milestone act');
  const milestone = await loadMilestone(db, objectId, milestoneId);
  if (milestone.kind === 'advance') throw new DomainError(422, 'advance_not_actable', 'An advance is not closed by an act: it is money paid in advance, not completed work');
  const amount = milestoneAmount(milestone, await objectContractValue(db, objectId));
  if (amount === null) throw new DomainError(422, 'milestone_amount_required', 'The milestone amount cannot be calculated: the contract value is unknown');
  // одну веху закрываем одним актом: повторный акт по вехе — 422
  const [used] = await db
    .select({ id: objectActs.id })
    .from(objectActs)
    .where(and(eq(objectActs.workspaceId, milestone.workspaceId), eq(objectActs.milestoneId, milestoneId), ne(objectActs.status, 'draft')))
    .limit(1);
  if (used) throw new DomainError(422, 'act_milestone_used', 'The milestone is already invoiced by an act');
  const vatRate = await defaultVatRate(db, objectId);
  return {
    milestoneId,
    line: { estimateItemId: null, name: milestone.name, unitCode: '796', unitSymbol: 'шт', qty: '1', price: amount, vatRate, amount },
  };
}

/** Предложение строк акта по виду: объёмы (done_qty − принято), веха (сумма вехи), часы (неучтённые часы × ставка) */
export async function suggestAct(db: Db, objectId: string, params: ActSuggestionParams): Promise<ActSuggestion> {
  const object = await assertObjectRef(db, objectId);
  const from = params.from ?? monthStart(today());
  const to = params.to ?? today();
  if (from > to) throw new DomainError(422, 'invalid_value', 'The period start cannot be after its end');
  const symbols = await unitSymbols(db);

  if (params.kind === 'milestone') {
    const { line, milestoneId } = await milestoneLine(db, objectId, params.milestoneId ?? null);
    return { objectId, kind: 'milestone', milestoneId, periodFrom: from, periodTo: to, lines: [line], totals: computeActTotals([line]) };
  }

  if (params.kind === 'hours') {
    const eligible = await eligibleHours(db, objectId, from, to);
    const rate = object.customerHourRate;
    if (!rate) throw new DomainError(422, 'customer_rate_required', 'Set the customer hour rate on the object to invoice hours');
    if (dec(eligible.hours) <= 0n) return { objectId, kind: 'hours', milestoneId: null, periodFrom: from, periodTo: to, lines: [], totals: computeActTotals([]), hours: { hours: '0.000', rate } };
    const vatRate = await defaultVatRate(db, objectId);
    const line: ActSuggestionLine = {
      estimateItemId: null,
      name: 'Работы по объекту (по часам)',
      unitCode: '356',
      unitSymbol: symbols.get('356') ?? 'ч',
      qty: eligible.hours,
      price: rate,
      vatRate,
      amount: actLineAmount({ qty: eligible.hours, price: rate }),
    };
    return { objectId, kind: 'hours', milestoneId: null, periodFrom: from, periodTo: to, lines: [line], totals: computeActTotals([line]), hours: { hours: eligible.hours, rate } };
  }

  const [items, accepted] = await Promise.all([approvedItems(db, objectId), acceptedByItem(db, objectId)]);
  const lines: ActSuggestionLine[] = [];
  for (const i of items) {
    const acceptedQty = accepted.get(i.id) ?? 0n;
    const remaining = dec(i.doneQty) - acceptedQty;
    if (remaining <= 0n) continue;
    const qty = fmt(remaining, 3);
    lines.push({
      estimateItemId: i.id,
      name: i.name,
      unitCode: i.unitCode,
      unitSymbol: symbols.get(i.unitCode) ?? i.unitCode,
      qty,
      price: i.price,
      vatRate: i.vatRate,
      amount: actLineAmount({ qty, price: i.price }),
      doneQty: i.doneQty,
      acceptedQty: fmt(acceptedQty, 3),
    });
  }
  return { objectId, kind: 'volumes', milestoneId: null, periodFrom: from, periodTo: to, lines, totals: computeActTotals(lines) };
}

/* ---------------- номера и проверки ---------------- */

/** Номер акта: КС-<код объекта>-<порядковый>; порядковый растёт по числу актов объекта */
async function nextActNumber(db: Db, objectId: string, objectNumber: string): Promise<string> {
  const [{ n }] = await db.select({ n: count() }).from(objectActs).where(eq(objectActs.objectId, objectId));
  let seq = Number(n) + 1;
  for (let i = 0; i < 1000; i++) {
    const candidate = objectActNumber(objectNumber, seq);
    const [taken] = await db.select({ id: objectActs.id }).from(objectActs).where(eq(objectActs.number, candidate)).limit(1);
    if (!taken) return candidate;
    seq++;
  }
  throw new DomainError(409, 'conflict', 'Cannot allocate an act number for the object');
}

interface ActLineValues {
  estimateItemId: string | null;
  name: string;
  unitCode: string;
  qty: string;
  price: string;
  vatRate: string;
  amount: string;
}

/** Строки акта по объёмам: цена и единица — из согласованной сметы; больше выполненного принять нельзя */
async function volumeLines(db: Db, objectId: string, input: { estimateItemId: string; qty: string }[] | undefined, excludeActId?: string): Promise<ActLineValues[]> {
  const [items, accepted] = await Promise.all([approvedItems(db, objectId), acceptedByItem(db, objectId, excludeActId)]);
  const byId = new Map(items.map(i => [i.id, i]));
  const wanted = new Map<string, bigint>();
  if (input?.length) {
    for (const l of input) {
      const item = byId.get(l.estimateItemId);
      if (!item) throw new DomainError(422, 'invalid_reference', 'An estimate line of the object does not exist or its estimate is not approved');
      wanted.set(l.estimateItemId, (wanted.get(l.estimateItemId) ?? 0n) + dec(l.qty));
    }
  } else {
    // без строк принимаем предложенное: выполненное минус уже принятое
    for (const item of items) {
      const remaining = dec(item.doneQty) - (accepted.get(item.id) ?? 0n);
      if (remaining > 0n) wanted.set(item.id, remaining);
    }
  }
  const lines: ActLineValues[] = [];
  // порядок строк — порядок сметы
  for (const item of items) {
    const qty = wanted.get(item.id);
    if (!qty || qty <= 0n) continue;
    const done = dec(item.doneQty);
    const already = accepted.get(item.id) ?? 0n;
    if (qty > done - already)
      throw new DomainError(422, 'act_qty_exceeds_done', 'The accepted quantity cannot exceed the completed quantity', {
        name: item.name,
        doneQty: item.doneQty,
        acceptedQty: fmt(already, 3),
        qty: fmt(qty, 3),
      });
    const qtyText = fmt(qty, 3);
    lines.push({ estimateItemId: item.id, name: item.name, unitCode: item.unitCode, qty: qtyText, price: item.price, vatRate: item.vatRate, amount: actLineAmount({ qty: qtyText, price: item.price }) });
  }
  if (!lines.length) throw new DomainError(422, 'act_empty', 'There is nothing to accept: the object has no completed volumes left');
  return lines;
}

/** Строка акта «по часам»: подтверждённые часы за период × ставка для заказчика (422 customer_rate_required) */
async function hoursLine(db: Db, objectId: string, from: string, to: string, ownActId?: string): Promise<{ line: ActLineValues; shiftHourIds: string[] }> {
  const [object] = await db.select({ rate: objects.customerHourRate }).from(objects).where(eq(objects.id, objectId)).limit(1);
  if (!object?.rate) throw new DomainError(422, 'customer_rate_required', 'Set the customer hour rate on the object to invoice hours');
  const eligible = await eligibleHours(db, objectId, from, to, ownActId);
  if (dec(eligible.hours) <= 0n) throw new DomainError(422, 'act_empty', 'There are no confirmed shift hours for the period that are not invoiced yet');
  const vatRate = await defaultVatRate(db, objectId);
  return {
    shiftHourIds: eligible.shiftHourIds,
    line: { estimateItemId: null, name: 'Работы по объекту (по часам)', unitCode: '356', qty: eligible.hours, price: object.rate, vatRate, amount: actLineAmount({ qty: eligible.hours, price: object.rate }) },
  };
}

interface BuiltAct {
  lines: ActLineValues[];
  milestoneId: string | null;
  shiftHourIds: string[];
}

/** Строки нового акта по виду: явные строки (объёмы), сумма вехи или неучтённые часы */
async function buildActLines(db: Db, objectId: string, kind: ObjectActKind, input: { lines?: { estimateItemId: string; qty: string }[] | undefined; milestoneId?: string | null | undefined }, period: { from: string; to: string }): Promise<BuiltAct> {
  if (kind === 'milestone') {
    const { line, milestoneId } = await milestoneLine(db, objectId, input.milestoneId ?? null);
    return { lines: [{ estimateItemId: null, name: line.name, unitCode: line.unitCode, qty: line.qty, price: line.price, vatRate: line.vatRate, amount: line.amount }], milestoneId, shiftHourIds: [] };
  }
  if (kind === 'hours') {
    const { line, shiftHourIds } = await hoursLine(db, objectId, period.from, period.to);
    return { lines: [line], milestoneId: null, shiftHourIds };
  }
  return { lines: await volumeLines(db, objectId, input.lines), milestoneId: null, shiftHourIds: [] };
}

/* ---------------- запись ---------------- */

export interface ActInput {
  id?: string | undefined;
  kind: ObjectActKind;
  actDate?: string | undefined;
  periodFrom?: string | undefined;
  periodTo?: string | undefined;
  milestoneId?: string | null | undefined;
  lines?: { estimateItemId: string; qty: string }[] | undefined;
  note?: string | undefined;
}

/** Создание акта: строки по виду, номер КС-<код>-<n>; акт создаётся черновиком */
export async function createObjectAct(db: Db, ctx: ActCtx, objectId: string, input: ActInput): Promise<ObjectActRow> {
  const object = await assertObjectRef(db, objectId);
  const actDate = input.actDate ?? today();
  const periodFrom = input.periodFrom ?? monthStart(actDate);
  const periodTo = input.periodTo ?? actDate;
  if (periodFrom > periodTo) throw new DomainError(422, 'invalid_value', 'The period start cannot be after its end');
  const built = await buildActLines(db, objectId, input.kind, input, { from: periodFrom, to: periodTo });
  const [row] = await db
    .insert(objectActs)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      objectId,
      number: await nextActNumber(db, objectId, object.number),
      actDate,
      periodFrom,
      periodTo,
      kind: input.kind,
      milestoneId: built.milestoneId,
      status: 'draft',
      note: input.note ?? '',
    })
    .returning();
  await writeActLines(db, ctx, row!.id, built.lines);
  if (built.shiftHourIds.length) await db.insert(objectActShiftHours).values(built.shiftHourIds.map(shiftHourId => ({ workspaceId: ctx.workspaceId, actId: row!.id, shiftHourId })));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_act.created', entity: 'object_act', recordId: row!.id, actorId: ctx.memberId, payload: { objectId, kind: input.kind, number: row!.number } });
  return row!;
}

/** Строки акта заменяются списком: старые удаляются, новые пишутся по порядку */
async function writeActLines(db: Db, ctx: ActCtx, actId: string, lines: ActLineValues[]): Promise<void> {
  await db.delete(objectActLines).where(eq(objectActLines.actId, actId));
  if (!lines.length) return;
  await db.insert(objectActLines).values(
    lines.map((l, n) => ({
      workspaceId: ctx.workspaceId,
      actId,
      estimateItemId: l.estimateItemId,
      sortOrder: n,
      name: l.name,
      unitCode: l.unitCode,
      qty: l.qty,
      price: l.price,
      vatRate: l.vatRate,
      amount: l.amount,
    })),
  );
}

/** Акт своего воркспейса: чужой — 404 (RLS и фильтр воркспейса) */
async function loadAct(db: Db, id: string, lock = false): Promise<ObjectActRow> {
  const query = db.select().from(objectActs).where(eq(objectActs.id, id)).limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new DomainError(404, 'not_found', 'act not found');
  return row;
}

/** Подписанный акт не правится: строки зафиксированы подписью заказчика (422 act_signed) */
function assertDraft(row: ObjectActRow): void {
  if (row.status === 'signed') throw new DomainError(422, 'act_signed', 'A signed act cannot be changed: unsign it first (an admin can do that)');
}

/** Правка черновика: undefined — не трогать, null — очистить. Строки заменяются списком (только акт по объёмам) */
export async function updateObjectAct(db: Db, ctx: ActCtx, id: string, input: ObjectActUpdate): Promise<ObjectActRow> {
  const row = await loadAct(db, id, true);
  assertDraft(row);
  const actDate = input.actDate ?? row.actDate;
  const periodFrom = input.periodFrom ?? row.periodFrom;
  const periodTo = input.periodTo ?? row.periodTo;
  if (periodFrom > periodTo) throw new DomainError(422, 'invalid_value', 'The period start cannot be after its end');
  const set: Partial<typeof objectActs.$inferInsert> = { actDate, periodFrom, periodTo, updatedAt: new Date() };
  if (input.note !== undefined) set.note = input.note;
  const [updated] = await db.update(objectActs).set(set).where(eq(objectActs.id, id)).returning();

  // строки: по объёмам — новые количества или пересчёт предложения; по часам — пересчёт неучтённых часов за новый период
  const periodChanged = periodFrom !== row.periodFrom || periodTo !== row.periodTo;
  if (row.kind === 'volumes') {
    if (input.lines !== undefined || periodChanged) {
      const lines = await volumeLines(db, row.objectId, input.lines, id);
      await writeActLines(db, ctx, id, lines);
    }
  } else if (row.kind === 'hours' && (periodChanged || input.lines !== undefined)) {
    const { line, shiftHourIds } = await hoursLine(db, row.objectId, periodFrom, periodTo, id);
    await db.delete(objectActShiftHours).where(eq(objectActShiftHours.actId, id));
    if (shiftHourIds.length) await db.insert(objectActShiftHours).values(shiftHourIds.map(shiftHourId => ({ workspaceId: ctx.workspaceId, actId: id, shiftHourId })));
    await writeActLines(db, ctx, id, [line]);
  } else if (row.kind === 'milestone' && input.lines !== undefined && input.lines.length) {
    throw new DomainError(422, 'invalid_value', 'A milestone act has exactly one line: the milestone sum');
  }
  await db.update(objectActs).set({ updatedAt: new Date() }).where(eq(objectActs.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_act.updated', entity: 'object_act', recordId: id, actorId: ctx.memberId, payload: { objectId: row.objectId, fields: Object.keys(input) } });
  return updated!;
}

/** Удаление черновика: подписанный сначала отменяют подписью, выставленный — вместе с документами */
export async function deleteObjectAct(db: Db, ctx: ActCtx, id: string): Promise<void> {
  const row = await loadAct(db, id, true);
  assertDraft(row);
  if (row.invoiceDocumentId || row.actDocumentId) throw new DomainError(422, 'act_has_documents', 'The act has invoices: unsign it and delete the documents first');
  await db.delete(objectActs).where(eq(objectActs.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_act.deleted', entity: 'object_act', recordId: id, actorId: ctx.memberId, payload: { objectId: row.objectId, number: row.number } });
}

/** Подписание заказчиком = принято: строки фиксируются, количества перепроверяются по выполненному */
export async function signObjectAct(db: Db, ctx: ActCtx, id: string): Promise<ObjectActRow> {
  const row = await loadAct(db, id, true);
  if (row.status === 'signed') throw new DomainError(422, 'invalid_status', 'The act is already signed');
  const lines = await db.select().from(objectActLines).where(eq(objectActLines.actId, id));
  if (!lines.length) throw new DomainError(422, 'act_empty', 'An empty act cannot be signed');
  if (row.kind === 'volumes') {
    // пока акт был черновиком, объёмы могли принять другие акты: перепроверяем
    await volumeLines(db, row.objectId, lines.map(l => ({ estimateItemId: l.estimateItemId!, qty: l.qty })), id);
  }
  if (row.kind === 'milestone' && row.milestoneId) {
    const [used] = await db
      .select({ id: objectActs.id })
      .from(objectActs)
      .where(and(eq(objectActs.workspaceId, ctx.workspaceId), eq(objectActs.milestoneId, row.milestoneId), eq(objectActs.status, 'signed'), ne(objectActs.id, id)))
      .limit(1);
    if (used) throw new DomainError(422, 'act_milestone_used', 'The milestone is already invoiced by an act');
  }
  const [updated] = await db
    .update(objectActs)
    .set({ status: 'signed', signedAt: new Date(), signedBy: ctx.memberId, updatedAt: new Date() })
    .where(eq(objectActs.id, id))
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_act.signed', entity: 'object_act', recordId: id, actorId: ctx.memberId, payload: { objectId: row.objectId, number: row.number } });
  return updated!;
}

/** Отмена подписи: только admin/owner и только если по акту нет оплат (422 act_has_payments) */
export async function unsignObjectAct(db: Db, ctx: ActCtx, id: string): Promise<ObjectActRow> {
  if (!canSeeCost(ctx.role)) throw new DomainError(403, 'forbidden', 'Only the owner or an admin can unsign an act');
  const row = await loadAct(db, id, true);
  if (row.status !== 'signed') throw new DomainError(422, 'invalid_status', 'The act is not signed');
  const money = await actMoneyByAct(db, [{ id: row.id, invoiceDocumentId: row.invoiceDocumentId, actDocumentId: row.actDocumentId }], await customerOf(db, row.objectId));
  if ((money.get(row.id)?.paid ?? 0n) > 0n) throw new DomainError(422, 'act_has_payments', 'The act has payments: refund them before unsigned the act');
  const [updated] = await db
    .update(objectActs)
    .set({ status: 'draft', signedAt: null, signedBy: null, updatedAt: new Date() })
    .where(eq(objectActs.id, id))
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_act.unsigned', entity: 'object_act', recordId: id, actorId: ctx.memberId, payload: { objectId: row.objectId, number: row.number } });
  return updated!;
}

/* ---------------- выставление ---------------- */

async function customerOf(db: Db, objectId: string): Promise<string | null> {
  const [row] = await db.select({ customerId: objects.customerId }).from(objects).where(eq(objects.id, objectId)).limit(1);
  return row?.customerId ?? null;
}

/** Служебная услуга «Работы по объекту»: строки документа требуют товар, а позиций сметы в каталоге нет.
    Одна на воркспейс, создаётся при первом выставлении. */
async function objectWorkProduct(db: Db, ctx: ActCtx): Promise<string> {
  const name = 'Работы по объекту';
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.kind, 'service'), eq(products.name, name), isNull(products.archivedAt)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(products)
    .values({ workspaceId: ctx.workspaceId, kind: 'service', sku: '', name, description: 'Служебная позиция для актов и счетов по объектам: наименование строки берётся из акта', unitCode: '796', vatRate: '20', price: '0', purchasePrice: '0' })
    .returning({ id: products.id });
  return created!.id;
}

/** Вложенная «транзакция» через savepoint: сбой проведения оставляет документ черновиком (как в банковской выписке) */
async function savepoint<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  const name = `object_act_${Math.random().toString(36).slice(2, 10)}`;
  await db.execute(sql.raw(`savepoint ${name}`));
  try {
    const out = await fn();
    await db.execute(sql.raw(`release savepoint ${name}`));
    return out;
  } catch (e) {
    await db.execute(sql.raw(`rollback to savepoint ${name}`));
    throw e;
  }
}

export interface InvoicedAct {
  id: string;
  invoiceDocumentId: string;
  actDocumentId: string;
  /** Коды предупреждений: документ остался черновиком (например, период закрыт) */
  warnings: string[];
}

/** Выставление: из подписанного акта создаются счёт и «Акт оказания услуг» (объект и заказчик объекта) и проводятся */
export async function invoiceObjectAct(db: Db, ctx: ActCtx, id: string): Promise<InvoicedAct> {
  const row = await loadAct(db, id, true);
  if (row.status !== 'signed') throw new DomainError(422, 'act_not_signed', 'Only a signed act can be invoiced');
  if (row.invoiceDocumentId || row.actDocumentId) throw new DomainError(422, 'act_already_invoiced', 'The act is already invoiced');
  const object = await assertObjectRef(db, row.objectId);
  if (!object.customerId) throw new DomainError(422, 'counterparty_required', 'Select the object customer before invoicing the act');
  const lines = await db.select().from(objectActLines).where(eq(objectActLines.actId, id)).orderBy(asc(objectActLines.sortOrder));
  if (!lines.length) throw new DomainError(422, 'act_empty', 'An empty act cannot be invoiced');
  const productId = await objectWorkProduct(db, ctx);
  const comment = `Акт ${row.number} за период с ${row.periodFrom} по ${row.periodTo} — ${object.name}`;
  const docCtx = { workspaceId: ctx.workspaceId, memberId: ctx.memberId, ...(ctx.role ? { role: ctx.role } : {}) };
  const docLines = lines.map(l => ({ productId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: l.price, vatRate: l.vatRate as VatRate, discountPct: '0' }));
  // суммы без НДС (цены сметы), НДС сверху по ставке строки — как в документах
  const invoiceDocumentId = await createDocument(db, docCtx, {
    type: 'invoice',
    counterpartyId: object.customerId,
    objectId: object.id,
    date: row.actDate,
    priceIncludesVat: false,
    comment,
    lines: docLines,
  });
  const actDocumentId = await createDocument(db, docCtx, {
    type: 'act',
    counterpartyId: object.customerId,
    objectId: object.id,
    date: row.actDate,
    priceIncludesVat: false,
    comment,
    lines: docLines,
  });
  const warnings: string[] = [];
  for (const docId of [invoiceDocumentId, actDocumentId]) {
    try {
      await savepoint(db, () => postDocument(db, docCtx, docId));
    } catch (e) {
      // период закрыт или проведение невозможно: документ остаётся черновиком, акт всё равно выставлен
      warnings.push(e instanceof DomainError ? e.code : 'document_not_posted');
    }
  }
  await db.update(objectActs).set({ invoiceDocumentId, actDocumentId, updatedAt: new Date() }).where(eq(objectActs.id, id));
  await db.update(objects).set({ updatedAt: new Date() }).where(eq(objects.id, object.id));
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: 'object_act.invoiced',
    entity: 'object_act',
    recordId: id,
    actorId: ctx.memberId,
    payload: { objectId: object.id, number: row.number, invoiceDocumentId, actDocumentId, warnings },
  });
  return { id, invoiceDocumentId, actDocumentId, warnings };
}

/* ---------------- чтение для интерфейса ---------------- */

export interface ObjectActLineView extends Omit<ObjectActLineRow, 'workspaceId'> {
  unitSymbol: string;
}

export interface ObjectActView extends Omit<ObjectActRow, 'workspaceId'> {
  milestoneName: string | null;
  signedByName: string | null;
  /** Выставленные документы: счёт и «Акт оказания услуг» */
  invoiceDocument: { id: string; number: string | null; status: string } | null;
  actDocument: { id: string; number: string | null; status: string } | null;
  lines: ObjectActLineView[];
  totals: { net: string; vat: string; total: string };
  /** Выставлено (документ акта) и оплачено (взаиморасчёты) — суммы без НДС и оплат */
  invoiced: string;
  paid: string;
}

/** Акты объекта (новые сверху) с строками, итогами, выставлением и оплатой */
async function actViews(db: Db, rows: ObjectActRow[]): Promise<ObjectActView[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const objectIds = [...new Set(rows.map(r => r.objectId))];
  const [lines, symbols, milestoneRows, memberRows, customers] = await Promise.all([
    db.select().from(objectActLines).where(inArray(objectActLines.actId, ids)).orderBy(asc(objectActLines.sortOrder)),
    unitSymbols(db),
    db.select({ id: objectMilestones.id, name: objectMilestones.name }).from(objectMilestones).where(inArray(objectMilestones.id, rows.map(r => r.milestoneId).filter((x): x is string => !!x).concat('00000000-0000-0000-0000-000000000000'))),
    db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, rows.map(r => r.signedBy).filter((x): x is string => !!x).concat('00000000-0000-0000-0000-000000000000'))),
    db.select({ id: objects.id, customerId: objects.customerId }).from(objects).where(inArray(objects.id, objectIds)),
  ]);
  const docIds = [...new Set(rows.flatMap(r => [r.invoiceDocumentId, r.actDocumentId].filter((x): x is string => !!x)))];
  const docRows = docIds.length ? await db.select({ id: documents.id, number: documents.number, status: documents.status }).from(documents).where(inArray(documents.id, docIds)) : [];
  const docById = new Map(docRows.map(d => [d.id, d]));
  const milestoneName = new Map(milestoneRows.map(m => [m.id, m.name]));
  const memberName = new Map(memberRows.map(m => [m.id, m.name]));
  const customerOfObject = new Map(customers.map(c => [c.id, c.customerId]));
  // режим расчётов у заказчиков: акты разных объектов могут быть у разных заказчиков
  const money = new Map<string, { invoiced: bigint; paid: bigint }>();
  const byCustomer = new Map<string | null, ObjectActRow[]>();
  for (const r of rows) {
    const key = customerOfObject.get(r.objectId) ?? null;
    byCustomer.set(key, [...(byCustomer.get(key) ?? []), r]);
  }
  for (const [customerId, group] of byCustomer) {
    const part = await actMoneyByAct(db, group.map(r => ({ id: r.id, invoiceDocumentId: r.invoiceDocumentId, actDocumentId: r.actDocumentId })), customerId);
    for (const [k, v] of part) money.set(k, v);
  }
  return rows.map(r => {
    const own = lines.filter(l => l.actId === r.id);
    const { workspaceId, ...rest } = r;
    void workspaceId;
    const m = money.get(r.id) ?? { invoiced: 0n, paid: 0n };
    const inv = r.invoiceDocumentId ? docById.get(r.invoiceDocumentId) : undefined;
    const actDoc = r.actDocumentId ? docById.get(r.actDocumentId) : undefined;
    return {
      ...rest,
      milestoneName: r.milestoneId ? (milestoneName.get(r.milestoneId) ?? null) : null,
      signedByName: r.signedBy ? (memberName.get(r.signedBy) ?? null) : null,
      invoiceDocument: inv ? { id: inv.id, number: inv.number, status: inv.status } : null,
      actDocument: actDoc ? { id: actDoc.id, number: actDoc.number, status: actDoc.status } : null,
      lines: own.map(({ workspaceId: _w, ...l }) => ({ ...l, unitSymbol: symbols.get(l.unitCode) ?? l.unitCode })),
      totals: computeActTotals(own),
      invoiced: fmt(m.invoiced, 2),
      paid: fmt(m.paid, 2),
    };
  });
}

/** Акт по id для карточки */
export async function getObjectAct(db: Db, id: string): Promise<ObjectActView> {
  const [row] = await actViews(db, [await loadAct(db, id)]);
  return row!;
}

/** Сводка выручки объекта: выполнено (по смете), принято (подписанные акты), выставлено и оплачено */
export async function objectRevenue(db: Db, objectId: string): Promise<ObjectRevenueAmounts & { objectId: string; acts: number; signed: number }> {
  await assertObjectRef(db, objectId);
  const [items, actRows] = await Promise.all([
    approvedItems(db, objectId),
    db.select().from(objectActs).where(eq(objectActs.objectId, objectId)),
  ]);
  let done = 0n;
  for (const i of items) done += mul(dec(i.doneQty), dec(i.price));
  const signed = actRows.filter(a => a.status === 'signed');
  // «принято» — суммы строк подписанных актов без НДС
  const signedIds = signed.map(a => a.id);
  const lineRows = signedIds.length ? await db.select({ actId: objectActLines.actId, amount: objectActLines.amount }).from(objectActLines).where(inArray(objectActLines.actId, signedIds)) : [];
  let accepted = 0n;
  for (const l of lineRows) accepted += dec(l.amount);
  const views = await actViews(db, actRows);
  let invoiced = 0n;
  let paid = 0n;
  for (const v of views) {
    invoiced += dec(v.invoiced);
    paid += dec(v.paid);
  }
  return {
    objectId,
    done: items.length ? fmt(done, 2) : null,
    accepted: fmt(accepted, 2),
    invoiced: fmt(invoiced, 2),
    paid: fmt(paid, 2),
    acts: actRows.length,
    signed: signed.length,
  };
}

/** Акты объекта за период (по дате акта) */
export async function objectActsView(db: Db, objectId: string, q: { from?: string | undefined; to?: string | undefined } = {}): Promise<{ objectId: string; items: ObjectActView[]; revenue: ObjectRevenueAmounts }> {
  await assertObjectRef(db, objectId);
  const rows = await db
    .select()
    .from(objectActs)
    .where(
      and(
        eq(objectActs.objectId, objectId),
        q.from ? sql`${objectActs.actDate} >= ${q.from}` : undefined,
        q.to ? sql`${objectActs.actDate} <= ${q.to}` : undefined,
      ),
    )
    .orderBy(desc(objectActs.actDate), desc(objectActs.createdAt));
  const totals = await objectRevenue(db, objectId);
  return { objectId, items: await actViews(db, rows), revenue: { done: totals.done, accepted: totals.accepted, invoiced: totals.invoiced, paid: totals.paid } };
}

/** Суммы актов по вехам объекта: выставлено и оплачено из связанного акта (для вкладки «Вехи») */
export async function milestoneActAmounts(db: Db, objectId: string): Promise<Map<string, { invoiced: string; paid: string; actId: string; actNumber: string }>> {
  const rows = await db
    .select()
    .from(objectActs)
    .where(and(eq(objectActs.objectId, objectId), eq(objectActs.status, 'signed'), sql`${objectActs.milestoneId} is not null`));
  const out = new Map<string, { invoiced: string; paid: string; actId: string; actNumber: string }>();
  if (!rows.length) return out;
  const views = await actViews(db, rows);
  for (const v of views) if (v.milestoneId) out.set(v.milestoneId, { invoiced: v.invoiced, paid: v.paid, actId: v.id, actNumber: v.number });
  return out;
}

/* ---------------- печатные формы КС-2 и КС-3 ---------------- */

/** Итоги подписанных актов объекта до конца периода (с начала работ и с начала года) — для справки КС-3 */
async function actsTotalsUpTo(db: Db, objectId: string, to: string, from: string): Promise<{ sinceStart: { net: string; vat: string; total: string }; sinceYear: { net: string; vat: string; total: string } }> {
  const rows = await db
    .select({ id: objectActs.id, actDate: objectActs.actDate })
    .from(objectActs)
    .where(and(eq(objectActs.objectId, objectId), eq(objectActs.status, 'signed'), sql`${objectActs.actDate} <= ${to}`));
  const ids = rows.map(r => r.id);
  const lines = ids.length ? await db.select().from(objectActLines).where(inArray(objectActLines.actId, ids)) : [];
  const sums = (filter: (actDate: string) => boolean) => {
    const actIds = new Set(rows.filter(r => filter(r.actDate)).map(r => r.id));
    return computeActTotals(lines.filter(l => actIds.has(l.actId)));
  };
  return { sinceStart: sums(() => true), sinceYear: sums(d => d >= from) };
}

export interface ActPrintData {
  ks2: import('@gr8r/shared').Ks2Data;
  ks3: import('@gr8r/shared').Ks3Data;
}

/** Данные печати КС-2 и КС-3: стороны, объект, договор, строки и итоги; суммы прописью считает шаблон */
export async function objectActPrintData(db: Db, id: string): Promise<ActPrintData> {
  const row = await loadAct(db, id);
  const [object] = await db.select().from(objects).where(eq(objects.id, row.objectId)).limit(1);
  if (!object) throw new DomainError(404, 'not_found', 'object not found');
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.archivedAt)).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
  if (!org) throw new DomainError(422, 'organization_required', 'Add an organization in Settings → Organizations first');
  const organization = await printOrg(db, org.id);
  const [company] = object.customerId ? await db.select().from(companies).where(eq(companies.id, object.customerId)).limit(1) : [];
  const customer = {
    name: company?.name ?? '',
    fullName: company?.name ?? '',
    inn: company?.inn ?? '',
    kpp: company?.kpp ?? '',
    ogrn: company?.ogrn ?? '',
    address: company ? company.legalAddress || company.city : '',
    phone: '',
    bank: null,
  };
  const [contract] = await db
    .select({ number: contracts.number, date: contracts.date })
    .from(objectContracts)
    .innerJoin(contracts, and(eq(contracts.workspaceId, objectContracts.workspaceId), eq(contracts.id, objectContracts.contractId)))
    .where(eq(objectContracts.objectId, object.id))
    .limit(1);
  const contractLabel = contract ? `№ ${contract.number} от ${contract.date}` : '';
  const [lines, symbols] = await Promise.all([
    db.select().from(objectActLines).where(eq(objectActLines.actId, id)).orderBy(asc(objectActLines.sortOrder)),
    unitSymbols(db),
  ]);
  const totals = computeActTotals(lines);
  const signed = row.status === 'signed';
  const base = {
    number: row.number,
    actDate: row.actDate,
    organization,
    customer,
    objectName: object.name,
    objectAddress: object.address,
    contractLabel,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    note: row.note,
    signed,
  };
  const yearStart = `${row.periodTo.slice(0, 4)}-01-01`;
  const ranges = await actsTotalsUpTo(db, object.id, row.periodTo, yearStart);
  return {
    ks2: {
      ...base,
      lines: lines.map((l, i) => ({ n: i + 1, name: l.name, unitCode: l.unitCode, unitSymbol: symbols.get(l.unitCode) ?? l.unitCode, qty: l.qty, price: l.price, amount: l.amount })),
      net: totals.net,
      vat: totals.vat,
      total: totals.total,
    },
    ks3: { ...base, sinceStart: ranges.sinceStart, sinceYear: ranges.sinceYear, period: totals },
  };
}
