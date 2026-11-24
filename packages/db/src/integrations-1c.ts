/* Соответствие наших объектов объектам 1С (задача 1226, docs/plans/2026-11-02-1c-exchange.md): основа всех обменов.
   GUID ищется по правилам (ИНН/КПП, артикул, штрихкод, БИК+счёт, номер+дата документа), ссылка ставится руками или автоматически.
   Ручная связь приоритетнее: автопоиск её не трогает. 1С — главный: при загрузке значения из 1С выигрывают. */
import { and, eq, inArray, isNull, or, sql, type SQLWrapper } from 'drizzle-orm';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { bankAccounts, cashRegisters, companies, contracts, documents, integrations1cLinks, organizations, products, warehouses } from './schema';
import type { Actor } from './attachments';

type IcActor = Omit<Actor, 'memberId'> & { memberId: string | null };

export type IcLink = typeof integrations1cLinks.$inferSelect;
export type IcSource = IcLink['source'];
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
  a: IcActor,
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
  organizationId?: string;
  companyId?: string;
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
  existing?: IcLink[],
): Promise<{ candidate: IcCandidate; result: MatchResult }[]> {
  const links = existing ?? await linksOf(db, wsId, source, entityType);
  const byRef = new Map(links.map(l => [l.refUuid, l]));
  const pending = candidates.filter(candidate => !byRef.has(candidate.refUuid));
  const matchCatalog = entityType !== 'document' && pending.length ? await catalogMatcher(db, wsId, entityType, pending) : undefined;
  const out: { candidate: IcCandidate; result: MatchResult }[] = [];
  for (const candidate of candidates) {
    const have = byRef.get(candidate.refUuid);
    const result: MatchResult = have
      ? { status: 'matched', entity: { entityId: have.entityId, name: have.refName }, rule: 'existing' }
      : entityType === 'document' ? await matchDocument(db, wsId, candidate) : matchCatalog!(candidate);
    out.push({ candidate, result });
  }
  return out;
}

const pickMatch = (rows: { id: string; name: string }[], rule: string): MatchResult => {
  const entities = rows.map(row => ({ entityId: row.id, name: row.name }));
  if (entities.length === 1) return { status: 'matched', entity: entities[0]!, rule };
  return entities.length ? { status: 'candidates', candidates: entities, rule } : { status: 'none' };
};

function indexMatches<Row>(rows: Row[], key: (row: Row) => string) {
  const index = new Map<string, Row[]>();
  for (const row of rows) {
    const k = key(row);
    const list = index.get(k) ?? [];
    list.push(row);
    index.set(k, list);
  }
  return (key?: string) => key ? index.get(key) ?? [] : [];
}

/** Load candidates by searchable keys in one query per catalog. */
async function catalogMatcher(db: Db, wsId: string, type: Exclude<IcEntityType, 'document'>, candidates: IcCandidate[]): Promise<(candidate: IcCandidate) => MatchResult> {
  const values = (column: SQLWrapper, key: keyof IcCandidate, lower = false) => {
    const keys = [...new Set(candidates.flatMap(candidate => {
      const value = candidate[key];
      return value ? [lower ? value.toLowerCase() : value] : [];
    }))];
    return keys.length ? sql`${column} in (select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))` : sql`false`;
  };
  if (type === 'organization' || type === 'company') {
    const table = type === 'organization' ? organizations : companies;
    const rows = await db.select({ id: table.id, name: table.name, inn: table.inn, kpp: table.kpp, ogrn: table.ogrn })
      .from(table).where(and(eq(table.workspaceId, wsId), isNull(table.archivedAt), or(values(table.inn, 'inn'), values(table.ogrn, 'ogrn'))));
    const byInn = indexMatches(rows, row => row.inn);
    const byOgrn = indexMatches(rows, row => row.ogrn);
    return candidate => {
      const taxId = byInn(candidate.inn);
      if (candidate.kpp) {
        const exact = taxId.filter(row => row.kpp === candidate.kpp);
        if (exact.length) return pickMatch(exact, 'inn_kpp');
      }
      const compatible = taxId.filter(row => !candidate.kpp || !row.kpp);
      if (compatible.length) return pickMatch(compatible, 'inn');
      return pickMatch(byOgrn(candidate.ogrn).filter(row => !candidate.kpp || !row.kpp || row.kpp === candidate.kpp), 'ogrn');
    };
  }
  if (type === 'product') {
    const rows = await db.select({ id: products.id, name: products.name, sku: products.sku, barcode: products.barcode,
      kind: products.kind, archivedAt: products.archivedAt }).from(products)
      .where(and(eq(products.workspaceId, wsId), or(values(sql`lower(${products.sku})`, 'sku', true),
        values(products.barcode, 'barcode'), and(isNull(products.archivedAt), values(products.name, 'name')))));
    const bySku = indexMatches(rows, row => row.sku.toLowerCase());
    const byBarcode = indexMatches(rows, row => row.barcode);
    const byName = indexMatches(rows.filter(row => !row.archivedAt), row => row.name);
    return candidate => {
      const sku = bySku(candidate.sku?.toLowerCase());
      if (sku.length) return pickMatch(sku, 'sku');
      const barcode = byBarcode(candidate.barcode);
      if (barcode.length) return pickMatch(barcode, 'barcode');
      return pickMatch(byName(candidate.name).filter(row => !candidate.kind || row.kind === candidate.kind), 'name');
    };
  }
  if (type === 'bank_account') {
    const table = bankAccounts;
    const rows = await db.select({ id: table.id, name: table.account, bik: table.bik, organizationId: table.organizationId, companyId: table.companyId })
      .from(table).where(and(eq(table.workspaceId, wsId), values(table.account, 'account'), values(table.bik, 'bik')));
    const byAccount = indexMatches(rows, row => `${row.bik}:${row.name}`);
    return candidate => pickMatch(byAccount(candidate.bik && candidate.account ? `${candidate.bik}:${candidate.account}` : undefined)
      .filter(row => (!candidate.organizationId || row.organizationId === candidate.organizationId) && (!candidate.companyId || row.companyId === candidate.companyId)), 'account');
  }
  if (type === 'contract') {
    const table = contracts;
    const rows = await db.select({ id: table.id, name: table.number, organizationId: table.organizationId, companyId: table.companyId, date: table.date })
      .from(table).where(and(eq(table.workspaceId, wsId), isNull(table.archivedAt), values(table.number, 'number')));
    const byNumber = indexMatches(rows, row => JSON.stringify([row.organizationId, row.companyId, row.name]));
    return candidate => pickMatch(byNumber(JSON.stringify([candidate.organizationId, candidate.companyId, candidate.number]))
      .filter(row => !candidate.date || row.date === candidate.date), 'contract_number');
  }
  const table = type === 'warehouse' ? warehouses : cashRegisters;
  const rows = await db.select({ id: table.id, name: table.name }).from(table)
    .where(and(eq(table.workspaceId, wsId), isNull(table.archivedAt), values(sql`lower(${table.name})`, 'name', true)));
  const byName = indexMatches(rows, row => row.name.toLowerCase());
  return candidate => pickMatch(byName(candidate.name?.toLowerCase()), 'name');
}

async function matchDocument(db: Db, wsId: string, candidate: IcCandidate): Promise<MatchResult> {
  if (!candidate.number || !candidate.date) return { status: 'none' };
  const date = new Date(candidate.date);
  if (!Number.isFinite(date.getTime())) return { status: 'none' };
  const day = (offset: number) => new Date(date.getTime() + offset * 864e5).toISOString().slice(0, 10);
  const rows = await db.select({ id: documents.id, name: documents.number }).from(documents)
    .where(and(eq(documents.workspaceId, wsId), eq(documents.number, candidate.number), sql`${documents.date} between ${day(-1)} and ${day(1)}`));
  return pickMatch(rows.map(row => ({ ...row, name: row.name ?? '' })), 'doc_number');
}

/* ---------------- проверка объекта ---------------- */

/** Существует ли наш объект этого типа в нашем воркспейсе (полиморфная привязка без FK) */
async function assertEntity(db: Db, a: IcActor, entityType: IcEntityType, entityId: string): Promise<void> {
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
    case 'cash_register':
      rows = await db.select({ id: cashRegisters.id }).from(cashRegisters).where(and(eq(cashRegisters.workspaceId, a.workspaceId), eq(cashRegisters.id, entityId)));
      break;
    case 'document':
      rows = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.workspaceId, a.workspaceId), eq(documents.id, entityId)));
      break;
  }
  if (!rows?.length) throw notFound(entityType);
}
