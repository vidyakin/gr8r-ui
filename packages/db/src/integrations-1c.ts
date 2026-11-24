/* Соответствие наших объектов объектам 1С (задача 1226, docs/plans/2026-11-02-1c-exchange.md): основа всех обменов.
   GUID ищется по правилам (ИНН/КПП, артикул, штрихкод, БИК+счёт, номер+дата документа), ссылка ставится руками или автоматически.
   Ручная связь приоритетнее: автопоиск её не трогает. 1С — главный: при загрузке значения из 1С выигрывают. */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { bankAccounts, companies, contracts, documents, integrations1cLinks, organizations, products, warehouses } from './schema';
import type { Actor } from './attachments';

export type IcLink = typeof integrations1cLinks.$inferSelect;
export type IcSource = 'buh3' | 'ut';
export type IcEntityType = IcLink['entityType'];

const notFound = (what: string) => new DomainError(404, 'not_found', `${what} not found`);
const conflict = (what: string) => new DomainError(409, 'conflict', what);

/* ---------------- запись и чтение связей ---------------- */

/** Serialize manual matching and GUID assignment during export for the same destination. */
export async function lockIcLinks(db: Db, workspaceId: string, source: IcSource) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`integrations-1c:${workspaceId}:${source}`}, 0))`);
}

/** GUID 1С для наших объектов: используется при выгрузке — у каких объектов ссылка уже есть */
export async function linksOf(db: Db, wsId: string, source: IcSource, entityType: IcEntityType, entityIds?: string[]) {
  return db
    .select()
    .from(integrations1cLinks)
    .where(
      entityIds?.length
        ? and(eq(integrations1cLinks.workspaceId, wsId), eq(integrations1cLinks.source, source), eq(integrations1cLinks.entityType, entityType), inArray(integrations1cLinks.entityId, entityIds))
        : and(eq(integrations1cLinks.workspaceId, wsId), eq(integrations1cLinks.source, source), eq(integrations1cLinks.entityType, entityType)),
    );
}

/** Поставить связь (руками или автопоиском). Ручная перезаписывает автоматическую; автопоиск ручную не трогает. */
export async function linkEntity(
  db: Db,
  a: Actor,
  source: IcSource,
  entityType: IcEntityType,
  entityId: string,
  ref: { refUuid: string; refName?: string },
  opts: { by: 'manual' | 'auto'; rule?: string | null } = { by: 'manual' },
): Promise<IcLink> {
  // объект существует и наш
  await assertEntity(db, a, entityType, entityId);
  await lockIcLinks(db, a.workspaceId, source);
  // GUID не должен уже принадлежать другому объекту того же типа
  const [taken] = await db
    .select({ entityId: integrations1cLinks.entityId, matchedBy: integrations1cLinks.matchedBy })
    .from(integrations1cLinks)
    .where(and(eq(integrations1cLinks.workspaceId, a.workspaceId), eq(integrations1cLinks.source, source), eq(integrations1cLinks.entityType, entityType), eq(integrations1cLinks.refUuid, ref.refUuid)));
  if (taken && taken.entityId !== entityId) {
    throw conflict(`1C object is already linked to another record`);
  }
  // наша текущая связь
  const [current] = await db
    .select()
    .from(integrations1cLinks)
    .where(and(eq(integrations1cLinks.workspaceId, a.workspaceId), eq(integrations1cLinks.source, source), eq(integrations1cLinks.entityType, entityType), eq(integrations1cLinks.entityId, entityId)));
  if (current && current.matchedBy === 'manual' && opts.by === 'auto') {
    return current; // ручную связь автопоиск не трогает
  }
  const values = { workspaceId: a.workspaceId, source, entityType, entityId, refUuid: ref.refUuid, refName: ref.refName ?? '', matchedBy: opts.by, matchedRule: opts.rule ?? null, createdBy: a.memberId };
  const [row] = current
    ? await db.update(integrations1cLinks).set({ ...values, updatedAt: sql`now()` }).where(eq(integrations1cLinks.id, current.id)).returning()
    : await db.insert(integrations1cLinks).values(values).returning();
  await recordEvent(db, { workspaceId: a.workspaceId, type: 'ic_link.updated', entity: 'ic_link', recordId: row!.id, actorId: a.memberId });
  return row!;
}

/** Разорвать связь */
export async function unlinkEntity(db: Db, { workspaceId: wsId, memberId }: Actor, source: IcSource, entityType: IcEntityType, entityId: string): Promise<void> {
  await lockIcLinks(db, wsId, source);
  const r = await db
    .delete(integrations1cLinks)
    .where(and(eq(integrations1cLinks.workspaceId, wsId), eq(integrations1cLinks.source, source), eq(integrations1cLinks.entityType, entityType), eq(integrations1cLinks.entityId, entityId)))
    .returning({ id: integrations1cLinks.id });
  if (!r.length) throw notFound('1C link');
  await recordEvent(db, { workspaceId: wsId, type: 'ic_link.deleted', entity: 'ic_link', recordId: r[0]!.id, actorId: memberId });
}

/* ---------------- автосопоставление ---------------- */

/** Кандидат на сопоставление из 1С */
export interface IcCandidate {
  refUuid: string;
  refName?: string;
  /** Данные для поиска по правилам */
  inn?: string;
  kpp?: string;
  ogrn?: string;
  sku?: string;
  barcode?: string;
  name?: string;
  kind?: 'goods' | 'service';
  bik?: string;
  account?: string;
  number?: string;
  date?: string;
}

/** Найденный наш объект */
export interface MatchedEntity {
  entityId: string;
  /** Человекочитаемое имя нашего объекта (для предпросмотра) */
  name: string;
}

/** Результат автопоиска для одного кандидата */
export type MatchResult =
  | { status: 'matched'; entity: MatchedEntity; rule: string }
  | { status: 'candidates'; candidates: MatchedEntity[]; rule: string }
  | { status: 'none' };

/**
 * Автосопоставление пакета объектов из 1С: по правилам в порядке убывания точности.
 * Не пишет в БД — сначала предпросмотр; запись — linkEntity с by: 'auto'.
 * Уже связанный объект (в т.ч. вручную) — 'matched' по существующей связи.
 */
export async function autoMatch(
  db: Db,
  wsId: string,
  source: IcSource,
  entityType: IcEntityType,
  candidates: IcCandidate[],
): Promise<{ candidate: IcCandidate; result: MatchResult }[]> {
  const existing = await linksOf(db, wsId, source, entityType);
  const byRef = new Map(existing.map(l => [l.refUuid, l]));
  const out: { candidate: IcCandidate; result: MatchResult }[] = [];
  for (const c of candidates) {
    const have = byRef.get(c.refUuid);
    if (have) {
      out.push({ candidate: c, result: { status: 'matched', entity: { entityId: have.entityId, name: have.refName }, rule: 'existing' } });
      continue;
    }
    out.push({ candidate: c, result: await matchOne(db, wsId, entityType, c) });
  }
  return out;
}

/** Правила поиска по типу: первое однозначное совпадение выигрывает */
async function matchOne(db: Db, wsId: string, entityType: IcEntityType, c: IcCandidate): Promise<MatchResult> {
  if (entityType === 'organization' || entityType === 'company') {
    const table = entityType === 'organization' ? organizations : companies;
    const cols = entityType === 'organization'
      ? { inn: organizations.inn, kpp: organizations.kpp, ogrn: organizations.ogrn }
      : { inn: companies.inn, kpp: companies.kpp, ogrn: companies.ogrn };
    const base = (where?: SQL) => db.select({ id: table.id, name: table.name }).from(table).where(where ? and(eq(table.workspaceId, wsId), where) : eq(table.workspaceId, wsId));
    if (c.inn && c.kpp) {
      const rows = await base(and(eq(cols.inn, c.inn), eq(cols.kpp, c.kpp)));
      if (rows.length === 1) return { status: 'matched', entity: { entityId: rows[0]!.id, name: rows[0]!.name }, rule: 'inn_kpp' };
      if (rows.length > 1) return { status: 'candidates', candidates: rows.map(r => ({ entityId: r.id, name: r.name })), rule: 'inn_kpp' };
    }
    if (c.inn) {
      const rows = await base(eq(cols.inn, c.inn));
      if (rows.length === 1) return { status: 'matched', entity: { entityId: rows[0]!.id, name: rows[0]!.name }, rule: 'inn' };
      if (rows.length > 1) return { status: 'candidates', candidates: rows.map(r => ({ entityId: r.id, name: r.name })), rule: 'inn' };
    }
    if (c.ogrn) {
      const rows = await base(eq(cols.ogrn, c.ogrn));
      if (rows.length === 1) return { status: 'matched', entity: { entityId: rows[0]!.id, name: rows[0]!.name }, rule: 'ogrn' };
    }
    return { status: 'none' };
  }
  if (entityType === 'product') {
    const pick = (rows: { id: string; name: string }[], rule: string): MatchResult =>
      rows.length === 1 ? { status: 'matched', entity: { entityId: rows[0]!.id, name: rows[0]!.name }, rule } : rows.length > 1 ? { status: 'candidates', candidates: rows.map(r => ({ entityId: r.id, name: r.name })), rule } : { status: 'none' };
    if (c.sku) {
      const rows = await db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.workspaceId, wsId), eq(products.sku, c.sku)));
      const r = pick(rows, 'sku');
      if (r.status !== 'none') return r;
    }
    if (c.barcode) {
      const rows = await db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.workspaceId, wsId), eq(products.barcode, c.barcode)));
      const r = pick(rows, 'barcode');
      if (r.status !== 'none') return r;
    }
    if (c.name) {
      const rows = await db
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(and(eq(products.workspaceId, wsId), eq(products.name, c.name), c.kind ? eq(products.kind, c.kind) : undefined));
      return pick(rows, 'name');
    }
    return { status: 'none' };
  }
  if (entityType === 'bank_account') {
    if (c.bik && c.account) {
      const rows = await db
        .select({ id: bankAccounts.id, name: bankAccounts.account })
        .from(bankAccounts)
        .where(and(eq(bankAccounts.workspaceId, wsId), eq(bankAccounts.bik, c.bik), eq(bankAccounts.account, c.account)));
      if (rows.length === 1) return { status: 'matched', entity: { entityId: rows[0]!.id, name: rows[0]!.name }, rule: 'account' };
    }
    return { status: 'none' };
  }
  if (entityType !== 'document') return { status: 'none' };
  // document: номер + дата ±1 день (documents.date — календарная дата в режиме string)
  if (c.number && c.date) {
    const d = new Date(c.date);
    if (!Number.isNaN(d.getTime())) {
      const day = (offset: number) => new Date(d.getTime() + offset * 864e5).toISOString().slice(0, 10);
      const rows = await db
        .select({ id: documents.id, name: documents.number })
        .from(documents)
        .where(and(eq(documents.workspaceId, wsId), eq(documents.number, c.number), sql`${documents.date} between ${day(-1)} and ${day(1)}`));
      if (rows.length === 1) return { status: 'matched', entity: { entityId: rows[0]!.id, name: rows[0]!.name ?? '' }, rule: 'doc_number' };
    }
  }
  return { status: 'none' };
}

/* ---------------- проверка объекта ---------------- */

/** Существует ли наш объект этого типа в нашем воркспейсе (полиморфная привязка без FK) */
async function assertEntity(db: Db, a: Actor, entityType: IcEntityType, entityId: string): Promise<void> {
  let rows: unknown[];
  switch (entityType) {
    case 'organization':
      rows = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.workspaceId, a.workspaceId), eq(organizations.id, entityId)));
      break;
    case 'company':
      rows = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.workspaceId, a.workspaceId), eq(companies.id, entityId)));
      break;
    case 'contract':
      rows = await db.select({ id: contracts.id }).from(contracts).where(and(eq(contracts.workspaceId, a.workspaceId), eq(contracts.id, entityId)));
      break;
    case 'warehouse':
      rows = await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.workspaceId, a.workspaceId), eq(warehouses.id, entityId)));
      break;
    case 'product':
      rows = await db.select({ id: products.id }).from(products).where(and(eq(products.workspaceId, a.workspaceId), eq(products.id, entityId)));
      break;
    case 'bank_account':
      rows = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(and(eq(bankAccounts.workspaceId, a.workspaceId), eq(bankAccounts.id, entityId)));
      break;
    case 'document':
      rows = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.workspaceId, a.workspaceId), eq(documents.id, entityId)));
      break;
  }
  if (!rows?.length) throw notFound(entityType);
}
