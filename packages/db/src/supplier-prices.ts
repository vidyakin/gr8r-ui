/* Загрузка прайсов поставщиков (docs/superpowers/specs/2026-11-11-supplier-price-upload-design.md): профили формата файла,
   загрузка строк по профилю, сопоставление по артикулам контрагента, разбор, применение цен в вид цен поставщика.
   Вызывается под контекстом арендатора (RLS). Права (admin+) проверяет маршрут API; файл читает API (readTable) и отдаёт строки сюда.
   Деньги — строки и decimal из @gr8r/shared. */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { parsePriceCell } from '@gr8r/shared';
import type { Db } from './client';
import { createAttachment, type Actor } from './attachments';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { companies, organizations, priceKinds, productPartnerArticles, products, supplierPriceLines, supplierPriceProfiles, supplierPrices, units } from './schema';
import { uuidv7 } from './uuid';

export type SupplierPriceProfile = typeof supplierPriceProfiles.$inferSelect;
export type SupplierPrice = typeof supplierPrices.$inferSelect;
export type SupplierPriceLine = typeof supplierPriceLines.$inferSelect;

const cell = (row: string[], col: number | null | undefined): string => (col ? String(row[col - 1] ?? '').trim() : '');
const norm = (s: string) => s.trim().toLowerCase();

async function loadCompany(db: Db, workspaceId: string, companyId: string) {
  const [c] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.workspaceId, workspaceId), eq(companies.id, companyId)));
  if (!c) throw new DomainError(404, 'not_found', 'company not found');
  return c;
}

/* ---------------- профили формата ---------------- */

export interface SupplierProfileInput {
  /** Есть id — обновление, иначе создание */
  id?: string | undefined;
  companyId: string;
  name: string;
  firstRow: number;
  articleCol: number;
  nameCol?: number | null | undefined;
  priceCol: number;
  unitCol?: number | null | undefined;
}

export async function listSupplierProfiles(db: Db, workspaceId: string, companyId: string): Promise<SupplierPriceProfile[]> {
  return db
    .select()
    .from(supplierPriceProfiles)
    .where(and(eq(supplierPriceProfiles.workspaceId, workspaceId), eq(supplierPriceProfiles.companyId, companyId), isNull(supplierPriceProfiles.archivedAt)))
    .orderBy(asc(supplierPriceProfiles.name));
}

function assertProfileInput(i: SupplierProfileInput): void {
  const ok = (n: number | null | undefined) => n === null || n === undefined || (Number.isInteger(n) && n >= 1);
  if (!i.name.trim() || !Number.isInteger(i.firstRow) || i.firstRow < 1 || !ok(i.articleCol) || !ok(i.priceCol) || !ok(i.nameCol) || !ok(i.unitCol))
    throw new DomainError(422, 'supplier_profile_invalid', 'Profile name, first row and columns must be set');
}

/** Создать или обновить профиль. Одинаковое название среди неархивных профилей поставщика — 409 */
export async function saveSupplierProfile(db: Db, actor: Actor, input: SupplierProfileInput): Promise<SupplierPriceProfile> {
  assertProfileInput(input);
  const ws = actor.workspaceId;
  await loadCompany(db, ws, input.companyId);
  const name = input.name.trim();
  const dup = await db
    .select({ id: supplierPriceProfiles.id })
    .from(supplierPriceProfiles)
    .where(and(eq(supplierPriceProfiles.workspaceId, ws), eq(supplierPriceProfiles.companyId, input.companyId), isNull(supplierPriceProfiles.archivedAt), sql`lower(${supplierPriceProfiles.name}) = ${norm(name)}`));
  if (dup.some(d => d.id !== input.id)) throw new DomainError(409, 'supplier_profile_exists', 'A format with this name already exists for the supplier');
  const values = { name, firstRow: input.firstRow, articleCol: input.articleCol, nameCol: input.nameCol ?? null, priceCol: input.priceCol, unitCol: input.unitCol ?? null };
  if (!input.id) {
    const [row] = await db.insert(supplierPriceProfiles).values({ workspaceId: ws, companyId: input.companyId, ...values }).returning();
    await recordEvent(db, { workspaceId: ws, type: 'supplier_price_profile.created', entity: 'supplier_price_profile', recordId: row!.id, actorId: actor.memberId, payload: { companyId: input.companyId } });
    return row!;
  }
  const [row] = await db
    .update(supplierPriceProfiles)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(supplierPriceProfiles.workspaceId, ws), eq(supplierPriceProfiles.id, input.id), eq(supplierPriceProfiles.companyId, input.companyId), isNull(supplierPriceProfiles.archivedAt)))
    .returning();
  if (!row) throw new DomainError(404, 'not_found', 'profile not found');
  await recordEvent(db, { workspaceId: ws, type: 'supplier_price_profile.updated', entity: 'supplier_price_profile', recordId: row.id, actorId: actor.memberId, payload: { companyId: input.companyId } });
  return row;
}

/** «Удаление» профиля — архив: на него ссылаются загруженные прайсы */
export async function archiveSupplierProfile(db: Db, actor: Actor, id: string): Promise<void> {
  const [row] = await db
    .update(supplierPriceProfiles)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(supplierPriceProfiles.workspaceId, actor.workspaceId), eq(supplierPriceProfiles.id, id), isNull(supplierPriceProfiles.archivedAt)))
    .returning({ companyId: supplierPriceProfiles.companyId });
  if (!row) throw new DomainError(404, 'not_found', 'profile not found');
  await recordEvent(db, { workspaceId: actor.workspaceId, type: 'supplier_price_profile.deleted', entity: 'supplier_price_profile', recordId: id, actorId: actor.memberId, payload: { companyId: row.companyId } });
}

/* ---------------- вид цен поставщика ---------------- */

/** Неархивный вид цен с supplier_id = поставщик; нет — создаётся ручной «Цены <поставщик>» (при занятом имени «(2)», «(3)»…) */
export async function ensureSupplierPriceKind(db: Db, workspaceId: string, companyId: string): Promise<typeof priceKinds.$inferSelect> {
  const [have] = await db
    .select()
    .from(priceKinds)
    .where(and(eq(priceKinds.workspaceId, workspaceId), eq(priceKinds.supplierId, companyId), isNull(priceKinds.archivedAt)))
    .orderBy(asc(priceKinds.createdAt))
    .limit(1);
  if (have) return have;
  const company = await loadCompany(db, workspaceId, companyId);
  const taken = new Set((await db.select({ name: priceKinds.name }).from(priceKinds).where(and(eq(priceKinds.workspaceId, workspaceId), isNull(priceKinds.archivedAt)))).map(k => norm(k.name)));
  const base = `Цены ${company.name}`;
  let name = base;
  for (let n = 2; taken.has(norm(name)); n++) name = `${base} (${n})`;
  const [row] = await db.insert(priceKinds).values({ workspaceId, name, method: 'manual', supplierId: companyId, sortOrder: 100 }).returning();
  return row!;
}

/* ---------------- единицы и сопоставление ---------------- */

/** Единица текстом из файла → код ОКЕИ: по названию, символу или коду без регистра; не нашли — штука '796' */
export async function resolveUnitCodes(db: Db, workspaceId: string, texts: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(texts.map(norm).filter(Boolean))];
  if (!wanted.length) return out;
  const all = await db.select({ code: units.code, name: units.name, symbol: units.symbol }).from(units).where(eq(units.workspaceId, workspaceId));
  const byKey = new Map<string, string>();
  for (const u of all) for (const k of [u.name, u.symbol, u.code]) if (norm(k) && !byKey.has(norm(k))) byKey.set(norm(k), u.code);
  for (const t of wanted) out.set(t, byKey.get(t.replace(/\.$/, '')) ?? byKey.get(t) ?? '796');
  return out;
}

interface MatchResult {
  status: 'matched' | 'unmatched' | 'conflict';
  productId: string | null;
  candidates: string[];
}

/** Артикулы поставщика → наши товары (неархивные): ключ — артикул без регистра и краёв */
async function articleIndex(db: Db, workspaceId: string, companyId: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ article: productPartnerArticles.article, productId: productPartnerArticles.productId })
    .from(productPartnerArticles)
    .innerJoin(products, and(eq(products.workspaceId, productPartnerArticles.workspaceId), eq(products.id, productPartnerArticles.productId)))
    .where(and(eq(productPartnerArticles.workspaceId, workspaceId), eq(productPartnerArticles.companyId, companyId), isNull(products.archivedAt), sql`${productPartnerArticles.article} <> ''`));
  const idx = new Map<string, string[]>();
  for (const r of rows) {
    const k = norm(r.article);
    idx.set(k, [...(idx.get(k) ?? []), r.productId]);
  }
  return idx;
}

function matchArticle(idx: Map<string, string[]>, article: string): MatchResult {
  const hit = article ? (idx.get(norm(article)) ?? []) : [];
  if (hit.length === 1) return { status: 'matched', productId: hit[0]!, candidates: [] };
  if (hit.length > 1) return { status: 'conflict', productId: null, candidates: hit };
  return { status: 'unmatched', productId: null, candidates: [] };
}

/** Пересчёт счётчиков прайса по его строкам (total — все сохранённые строки) */
export async function recountSupplierPrice(db: Db, workspaceId: string, priceId: string): Promise<void> {
  const rows = await db
    .select({ status: supplierPriceLines.status, n: sql<number>`count(*)::int` })
    .from(supplierPriceLines)
    .where(and(eq(supplierPriceLines.workspaceId, workspaceId), eq(supplierPriceLines.priceId, priceId)))
    .groupBy(supplierPriceLines.status);
  const n = (s: string) => rows.find(r => r.status === s)?.n ?? 0;
  await db
    .update(supplierPrices)
    .set({ linesTotal: rows.reduce((a, r) => a + r.n, 0), linesMatched: n('matched'), linesUnmatched: n('unmatched'), linesConflict: n('conflict') })
    .where(and(eq(supplierPrices.workspaceId, workspaceId), eq(supplierPrices.id, priceId)));
}

/* ---------------- загрузка ---------------- */

export interface UploadSupplierPriceInput {
  companyId: string;
  profileId: string;
  /** Название прайса; по умолчанию — имя файла или дата */
  name?: string | undefined;
  /** Дата действия цен, YYYY-MM-DD */
  date: string;
  pricesIncludeVat: boolean;
  /** Строки файла как таблица (результат readTable), с нулевой строкой-шапкой включительно */
  rows: string[][];
  file?: { name: string; mime?: string | null; data: Uint8Array } | undefined;
}

/** Разбирает строки по профилю, сопоставляет по артикулам этого поставщика и сохраняет черновик прайса.
    Строки с пустыми артикулом и ценой пропускаются без записи; нечисловая цена — строка skipped (price_invalid) */
export async function uploadSupplierPrice(db: Db, actor: Actor, input: UploadSupplierPriceInput): Promise<{ price: SupplierPrice; lines: SupplierPriceLine[] }> {
  const ws = actor.workspaceId;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new DomainError(422, 'supplier_price_date_invalid', 'Price date must be YYYY-MM-DD');
  const [profile] = await db
    .select()
    .from(supplierPriceProfiles)
    .where(and(eq(supplierPriceProfiles.workspaceId, ws), eq(supplierPriceProfiles.id, input.profileId), eq(supplierPriceProfiles.companyId, input.companyId), isNull(supplierPriceProfiles.archivedAt)));
  if (!profile) throw new DomainError(404, 'not_found', 'profile not found');
  const company = await loadCompany(db, ws, input.companyId);

  type Draft = { rowNo: number; article: string; name: string; unitText: string; price: string | null };
  const drafts: Draft[] = [];
  for (let i = profile.firstRow - 1; i < input.rows.length; i++) {
    const row = input.rows[i] ?? [];
    const article = cell(row, profile.articleCol);
    const priceRaw = cell(row, profile.priceCol);
    if (!article && !priceRaw) continue;
    drafts.push({ rowNo: i + 1, article, name: cell(row, profile.nameCol), unitText: cell(row, profile.unitCol), price: parsePriceCell(priceRaw) });
  }
  if (!drafts.length) throw new DomainError(422, 'supplier_price_empty', 'The file has no data rows for this format');

  const kind = await ensureSupplierPriceKind(db, ws, input.companyId);
  const priceId = uuidv7();
  const name = (input.name?.trim() || input.file?.name || `${company.name} ${input.date}`).slice(0, 200);
  await db.insert(supplierPrices).values({
    id: priceId,
    workspaceId: ws,
    companyId: input.companyId,
    profileId: profile.id,
    name,
    kindId: kind.id,
    date: input.date,
    pricesIncludeVat: input.pricesIncludeVat,
    fileName: input.file?.name ?? '',
    fileSize: input.file?.data.length ?? 0,
    createdBy: actor.memberId,
  });
  if (input.file) {
    const { attachment } = await createAttachment(db, actor, 'supplier_price', priceId, { name: input.file.name, mime: input.file.mime ?? null, data: input.file.data });
    await db.update(supplierPrices).set({ attachmentId: attachment.id }).where(and(eq(supplierPrices.workspaceId, ws), eq(supplierPrices.id, priceId)));
  }

  const idx = await articleIndex(db, ws, input.companyId);
  const unitMap = await resolveUnitCodes(db, ws, drafts.map(d => d.unitText));
  const values = drafts.map(d => {
    const unitCode = d.unitText ? (unitMap.get(norm(d.unitText)) ?? '796') : null;
    if (d.price === null) return { workspaceId: ws, priceId, rowNo: d.rowNo, article: d.article, name: d.name, unitCode, price: null, productId: null, status: 'skipped' as const, note: 'price_invalid', candidates: [] as string[] };
    const m = matchArticle(idx, d.article);
    return { workspaceId: ws, priceId, rowNo: d.rowNo, article: d.article, name: d.name, unitCode, price: d.price, productId: m.productId, status: m.status, note: '', candidates: m.candidates };
  });
  for (let i = 0; i < values.length; i += 500) await db.insert(supplierPriceLines).values(values.slice(i, i + 500));
  await recountSupplierPrice(db, ws, priceId);
  const price = await getSupplierPrice(db, ws, priceId);
  await recordEvent(db, { workspaceId: ws, type: 'supplier_price.uploaded', entity: 'supplier_price', recordId: priceId, actorId: actor.memberId, payload: { companyId: input.companyId, lines: price.linesTotal, matched: price.linesMatched } });
  return { price, lines: await listSupplierPriceLines(db, ws, priceId) };
}

export async function getSupplierPrice(db: Db, workspaceId: string, id: string): Promise<SupplierPrice> {
  const [row] = await db.select().from(supplierPrices).where(and(eq(supplierPrices.workspaceId, workspaceId), eq(supplierPrices.id, id)));
  if (!row) throw new DomainError(404, 'not_found', 'supplier price not found');
  return row;
}

export async function listSupplierPrices(db: Db, workspaceId: string, companyId: string): Promise<SupplierPrice[]> {
  return db
    .select()
    .from(supplierPrices)
    .where(and(eq(supplierPrices.workspaceId, workspaceId), eq(supplierPrices.companyId, companyId)))
    .orderBy(sql`${supplierPrices.createdAt} desc`, sql`${supplierPrices.id} desc`);
}

export async function listSupplierPriceLines(db: Db, workspaceId: string, priceId: string, status?: SupplierPriceLine['status']): Promise<SupplierPriceLine[]> {
  return db
    .select()
    .from(supplierPriceLines)
    .where(and(eq(supplierPriceLines.workspaceId, workspaceId), eq(supplierPriceLines.priceId, priceId), status ? eq(supplierPriceLines.status, status) : undefined))
    .orderBy(asc(supplierPriceLines.rowNo));
}


/* ---------------- разбор строк (только для draft) ---------------- */

async function loadDraft(db: Db, workspaceId: string, priceId: string): Promise<SupplierPrice> {
  const price = await getSupplierPrice(db, workspaceId, priceId);
  if (price.status !== 'draft') throw new DomainError(409, 'supplier_price_applied', 'The price list is already applied and cannot be changed');
  return price;
}

async function loadLine(db: Db, workspaceId: string, priceId: string, lineId: string): Promise<SupplierPriceLine> {
  const [row] = await db.select().from(supplierPriceLines).where(and(eq(supplierPriceLines.workspaceId, workspaceId), eq(supplierPriceLines.priceId, priceId), eq(supplierPriceLines.id, lineId)));
  if (!row) throw new DomainError(404, 'not_found', 'line not found');
  return row;
}

/** Артикул (и наименование) поставщика товара — в product_partner_articles: в следующий раз строка найдётся сама.
    У товара одна запись на контрагента: прежний артикул заменяется */
async function savePartnerArticle(db: Db, workspaceId: string, companyId: string, productId: string, article: string, name: string): Promise<void> {
  const a = article.slice(0, 100);
  const n = name.slice(0, 300);
  if (!a && !n) return;
  await db
    .insert(productPartnerArticles)
    .values({ workspaceId, companyId, productId, article: a, name: n })
    .onConflictDoUpdate({
      target: [productPartnerArticles.workspaceId, productPartnerArticles.companyId, productPartnerArticles.productId],
      set: { article: a || sql`${productPartnerArticles.article}`, name: n || sql`${productPartnerArticles.name}`, updatedAt: new Date() },
    });
}

async function bindLine(db: Db, price: SupplierPrice, line: SupplierPriceLine, productId: string): Promise<void> {
  await savePartnerArticle(db, price.workspaceId, price.companyId, productId, line.article, line.name);
  await db.update(supplierPriceLines).set({ productId, status: 'matched', note: '', candidates: [] }).where(eq(supplierPriceLines.id, line.id));
}

export interface SupplierLinePatch {
  /** Привязать товар (из кандидатов или любой) */
  productId?: string | undefined;
  /** true — пропустить строку, false — снять пропуск */
  skip?: boolean | undefined;
}

/** Ручной разбор строки: привязка товара с записью артикула / пропуск / снятие пропуска */
export async function updateSupplierPriceLine(db: Db, actor: Actor, priceId: string, lineId: string, patch: SupplierLinePatch): Promise<SupplierPriceLine> {
  const ws = actor.workspaceId;
  const price = await loadDraft(db, ws, priceId);
  const line = await loadLine(db, ws, priceId, lineId);
  if (patch.productId !== undefined) {
    if (line.price === null) throw new DomainError(422, 'supplier_line_price_invalid', 'The line has no valid price');
    const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.workspaceId, ws), eq(products.id, patch.productId), isNull(products.archivedAt)));
    if (!p) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
    await bindLine(db, price, line, p.id);
  } else if (patch.skip === true) {
    await db.update(supplierPriceLines).set({ status: 'skipped', note: 'manual' }).where(eq(supplierPriceLines.id, line.id));
  } else if (patch.skip === false && line.status === 'skipped') {
    if (line.price === null) throw new DomainError(422, 'supplier_line_price_invalid', 'The line has no valid price');
    if (line.productId) await db.update(supplierPriceLines).set({ status: 'matched', note: '' }).where(eq(supplierPriceLines.id, line.id));
    else {
      const m = matchArticle(await articleIndex(db, ws, price.companyId), line.article);
      await db.update(supplierPriceLines).set({ status: m.status, productId: m.productId, candidates: m.candidates, note: '' }).where(eq(supplierPriceLines.id, line.id));
    }
  }
  await recountSupplierPrice(db, ws, priceId);
  await recordEvent(db, { workspaceId: ws, type: 'supplier_price_line.updated', entity: 'supplier_price_line', recordId: lineId, actorId: actor.memberId, payload: { priceId } });
  return loadLine(db, ws, priceId, lineId);
}

const unmatchedLines = (db: Db, ws: string, priceId: string, lineIds?: string[]) =>
  db
    .select()
    .from(supplierPriceLines)
    .where(and(eq(supplierPriceLines.workspaceId, ws), eq(supplierPriceLines.priceId, priceId), eq(supplierPriceLines.status, 'unmatched'), lineIds ? inArray(supplierPriceLines.id, lineIds) : undefined))
    .orderBy(asc(supplierPriceLines.rowNo));

/** «Найти по названиям» для unmatched-строк: точное совпадение наименования без регистра и краёв (как matchImportRows).
    Один товар — подставляется с артикулом; несколько — кандидаты для ручного выбора (статус остаётся unmatched); нет — без изменений */
export async function matchSupplierLinesByName(db: Db, actor: Actor, priceId: string, lineIds?: string[]): Promise<{ matched: number; ambiguous: number; notFound: number }> {
  const ws = actor.workspaceId;
  const price = await loadDraft(db, ws, priceId);
  const lines = (await unmatchedLines(db, ws, priceId, lineIds)).filter(l => l.name.trim());
  const all = await db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.workspaceId, ws), isNull(products.archivedAt)));
  const byName = new Map<string, string[]>();
  for (const p of all) byName.set(norm(p.name), [...(byName.get(norm(p.name)) ?? []), p.id]);
  const res = { matched: 0, ambiguous: 0, notFound: 0 };
  for (const l of lines) {
    const hit = byName.get(norm(l.name)) ?? [];
    if (hit.length === 1) {
      await bindLine(db, price, l, hit[0]!);
      res.matched++;
    } else if (hit.length > 1) {
      await db.update(supplierPriceLines).set({ candidates: hit }).where(eq(supplierPriceLines.id, l.id));
      res.ambiguous++;
    } else res.notFound++;
  }
  await recountSupplierPrice(db, ws, priceId);
  if (res.matched) await recordEvent(db, { workspaceId: ws, type: 'supplier_price_line.updated', entity: 'supplier_price_line', actorId: actor.memberId, payload: { priceId, matchedByName: res.matched } });
  return res;
}

/** «Создать товар» для выбранных (или всех) unmatched-строк: наименование и единица из файла, цена продажи 0, НДС по умолчанию
    организации, артикул поставщика сразу. Строки без наименования и артикула пропускаются; одинаковый артикул в файле — один товар */
export async function createProductsForSupplierLines(db: Db, actor: Actor, priceId: string, lineIds?: string[]): Promise<{ created: number; skipped: number }> {
  const ws = actor.workspaceId;
  const price = await loadDraft(db, ws, priceId);
  const lines = await unmatchedLines(db, ws, priceId, lineIds);
  const [org] = await db.select({ vat: organizations.defaultVatRate }).from(organizations).where(and(eq(organizations.workspaceId, ws), isNull(organizations.archivedAt))).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
  const vatRate = org?.vat ?? '20';
  const byArticle = new Map<string, string>();
  const res = { created: 0, skipped: 0 };
  for (const l of lines) {
    const name = (l.name || l.article).trim();
    if (!name) {
      res.skipped++;
      continue;
    }
    const key = norm(l.article);
    let productId = key ? byArticle.get(key) : undefined;
    if (!productId) {
      const [p] = await db.insert(products).values({ workspaceId: ws, kind: 'goods', name: name.slice(0, 300), unitCode: l.unitCode ?? '796', price: '0', vatRate }).returning();
      productId = p!.id;
      if (key) byArticle.set(key, productId);
      res.created++;
      await recordEvent(db, { workspaceId: ws, type: 'product.created', entity: 'product', recordId: productId, actorId: actor.memberId, payload: { record: p } });
    }
    await bindLine(db, price, l, productId);
  }
  await recountSupplierPrice(db, ws, priceId);
  if (res.created) await recordEvent(db, { workspaceId: ws, type: 'supplier_price_line.updated', entity: 'supplier_price_line', actorId: actor.memberId, payload: { priceId, createdProducts: res.created } });
  return res;
}
