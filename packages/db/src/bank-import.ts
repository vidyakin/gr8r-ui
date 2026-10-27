/* Банковская выписка (задача 1174в): предпросмотр импорта, создание документов «Поступление на счёт» / «Списание со счёта»
   и выгрузка платёжных поручений. Файл разбирает чистая функция из @gr8r/shared (`parseBankStatement`); сюда приходит уже
   разобранная выписка — так же её отдаст адаптер API банка (1174д). Правила — docs/architecture/payments.md, «Банковская выписка». */
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  bankBookedDate,
  bankCounterparty,
  bankDirection,
  bankImportKey,
  extractDocumentRefs,
  parseBankAmount,
  PAYABLE_TYPES,
  renderPaymentOrders,
  type BankDirection,
  type BankStatement,
  type BankTransaction,
  type PaymentOrderExport,
} from '@gr8r/shared';
import type { Db } from './client';
import { postDocument, type DocCtx } from './documents';
import { DomainError } from './errors';
import { createPayment, type CashDocType } from './payments';
import { payableOf } from './settlements';
import { bankAccounts, companies, documents, organizations } from './schema';

const digits = (v: string) => v.replace(/\D+/g, '');

/** Операции, которые импорт может создать из строки выписки, по направлению */
export const IMPORT_OPERATIONS: Record<BankDirection, readonly string[]> = {
  in: ['from_customer', 'supplier_refund', 'other_income'],
  out: ['to_supplier', 'customer_refund', 'other_expense'],
};

export type BankRowIssue = 'duplicate' | 'internal_transfer' | 'other_account' | 'counterparty_not_found' | 'counterparty_ambiguous' | 'document_ambiguous' | 'counterparty_from_document';

export interface BankImportRow {
  index: number;
  key: string;
  direction: BankDirection | null;
  number: string;
  /** Дата документа в выписке */
  docDate: string;
  /** Дата по счёту: поступило / списано */
  bookedDate: string;
  amount: string;
  purpose: string;
  party: { name: string; inn: string; kpp: string; account: string; bik: string; bank: string };
  counterpartyId: string | null;
  counterpartyName: string | null;
  candidates: { id: string; name: string }[];
  settlementDocumentId: string | null;
  settlementDocument: { id: string; type: string; number: string | null; date: string; remaining: string } | null;
  operation: string | null;
  /** Строку по умолчанию не создавать: дубль, перемещение между своими счетами, чужой счёт */
  skip: boolean;
  issues: BankRowIssue[];
}

export interface BankImportPreview {
  /** Банковский счёт организации, по которому разобрана выписка */
  bankAccount: { id: string; label: string; organizationId: string } | null;
  /** Свои счета, найденные в файле (если их несколько — можно выбрать другой и повторить предпросмотр) */
  accounts: { id: string; label: string; account: string }[];
  statementAccounts: string[];
  period: { from: string | null; to: string | null };
  balances: BankStatement['balances'];
  warnings: BankStatement['warnings'];
  rows: BankImportRow[];
  summary: { total: number; incoming: number; outgoing: number; duplicates: number; unmatched: number };
}

/** Номера считаются одинаковыми, если совпадают целиком (без регистра и знаков) или последняя цифровая группа без нулей слева («СЧ-000045» = «45») */
export function sameDocumentNumber(docNumber: string, token: string): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/[^0-9a-zа-яё]/g, '');
  if (norm(docNumber) === norm(token)) return true;
  const last = (v: string) => (v.match(/\d+/g) ?? []).pop()?.replace(/^0+(?=\d)/, '');
  const a = last(docNumber);
  const b = last(token);
  return !!a && !!b && a === b;
}

async function ownAccounts(db: Db) {
  return db
    .select({ id: bankAccounts.id, account: bankAccounts.account, bankName: bankAccounts.bankName, organizationId: bankAccounts.organizationId, orgName: organizations.name })
    .from(bankAccounts)
    .innerJoin(organizations, eq(organizations.id, bankAccounts.organizationId))
    .where(isNotNull(bankAccounts.organizationId))
    .orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.createdAt));
}

/** Предпросмотр импорта: направление, контрагент по ИНН (+КПП, счёту), документ по номеру в назначении, дубли */
export async function previewBankImport(db: Db, statement: BankStatement, opts: { bankAccountId?: string | null } = {}): Promise<BankImportPreview> {
  const own = await ownAccounts(db);
  const label = (a: (typeof own)[number]) => `${a.orgName} · ${a.bankName} · ${a.account}`;
  const stAccounts = new Set([...statement.accounts, ...statement.transactions.flatMap(t => [t.payer.account, t.receiver.account])].map(digits));
  const matched = own.filter(a => stAccounts.has(digits(a.account)) && (statement.accounts.length === 0 || statement.accounts.includes(digits(a.account))));
  const chosen = opts.bankAccountId ? own.find(a => a.id === opts.bankAccountId) : matched[0];
  if (opts.bankAccountId && !chosen) throw new DomainError(422, 'invalid_reference', 'The bank account does not exist');
  const base = {
    accounts: matched.map(a => ({ id: a.id, label: label(a), account: a.account })),
    statementAccounts: statement.accounts,
    period: { from: statement.dateFrom, to: statement.dateTo },
    balances: statement.balances,
    warnings: statement.warnings,
  };
  if (!chosen) return { ...base, bankAccount: null, rows: [], summary: { total: 0, incoming: 0, outgoing: 0, duplicates: 0, unmatched: 0 } };

  const ownNumbers = own.map(a => digits(a.account));
  const ownInns = new Set((await db.select({ inn: organizations.inn }).from(organizations)).map(o => o.inn).filter(Boolean));
  const stRows = statement.transactions.map((tx, index) => ({ tx, index, dir: bankDirection(tx, [chosen.account]), internal: bankDirection(tx, ownNumbers) === 'internal' }));

  // контрагенты: по ИНН, затем по расчётному счёту
  const parties = stRows.map(r => (r.dir && r.dir !== 'internal' ? bankCounterparty(r.tx, r.dir) : null));
  const inns = [...new Set(parties.map(p => p?.inn).filter((x): x is string => !!x))];
  const partyAccounts = [...new Set(parties.map(p => p?.account).filter((x): x is string => !!x))];
  const byInn = inns.length ? await db.select({ id: companies.id, name: companies.name, inn: companies.inn, kpp: companies.kpp }).from(companies).where(and(inArray(companies.inn, inns), isNull(companies.archivedAt))) : [];
  const byAccount = partyAccounts.length
    ? await db.select({ id: companies.id, name: companies.name, account: bankAccounts.account }).from(bankAccounts).innerJoin(companies, eq(companies.id, bankAccounts.companyId)).where(and(inArray(bankAccounts.account, partyAccounts), isNull(companies.archivedAt)))
    : [];
  const matchCompany = (p: BankTransaction['payer']): { hit: { id: string; name: string } | null; candidates: { id: string; name: string }[] } => {
    let list = p.inn ? byInn.filter(c => c.inn === p.inn) : [];
    if (list.length > 1 && p.kpp) {
      const k = list.filter(c => c.kpp === p.kpp);
      if (k.length) list = k;
    }
    if (list.length === 1) return { hit: list[0]!, candidates: [] };
    if (list.length > 1) {
      const viaAcc = list.filter(c => byAccount.some(a => a.id === c.id && a.account === p.account));
      if (viaAcc.length === 1) return { hit: viaAcc[0]!, candidates: [] };
      return { hit: null, candidates: list.map(c => ({ id: c.id, name: c.name })) };
    }
    const acc = p.account ? byAccount.filter(a => a.account === p.account) : [];
    const ids = [...new Set(acc.map(a => a.id))];
    if (ids.length === 1) return { hit: { id: ids[0]!, name: acc[0]!.name }, candidates: [] };
    return { hit: null, candidates: [] };
  };

  // дубли
  const keys = stRows.map(r => (r.dir && r.dir !== 'internal' ? bankImportKey(chosen.account, r.dir, r.tx) : null));
  const known = new Set(
    keys.filter((k): k is string => !!k).length
      ? (await db.select({ key: documents.bankImportKey }).from(documents).where(inArray(documents.bankImportKey, keys.filter((k): k is string => !!k)))).map(d => d.key)
      : [],
  );

  // документы по номерам из назначения
  const refs = stRows.map(r => extractDocumentRefs(r.tx.purpose).numbers);
  const tokens = [...new Set(refs.flat())].slice(0, 200);
  const cpIds = [...new Set(stRows.map((_r, i) => (parties[i] ? (matchCompany(parties[i]!).hit?.id ?? null) : null)).filter((x): x is string => !!x))];
  const clauses = [...tokens.map(t => ilike(documents.number, `%${t.replace(/[%_\\]/g, '')}%`)), ...(cpIds.length ? [inArray(documents.counterpartyId, cpIds)] : [])];
  const docs = clauses.length
    ? await db
        .select({ id: documents.id, type: documents.type, number: documents.number, date: documents.date, counterpartyId: documents.counterpartyId })
        .from(documents)
        .where(and(inArray(documents.type, PAYABLE_TYPES), ne(documents.status, 'cancelled'), isNotNull(documents.number), isNotNull(documents.counterpartyId), or(...clauses)))
    : [];
  const docCps = [...new Set(docs.map(d => d.counterpartyId!))];
  const cpName = new Map((docCps.length ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, docCps)) : []).map(c => [c.id, c.name]));
  const statusCache = new Map<string, Awaited<ReturnType<typeof payableOf>>>();
  const payable = async (id: string) => {
    if (!statusCache.has(id)) statusCache.set(id, await payableOf(db, id));
    return statusCache.get(id)!;
  };

  const rows: BankImportRow[] = [];
  for (const [i, r] of stRows.entries()) {
    const { tx, dir } = r;
    const p = parties[i];
    const issues: BankRowIssue[] = [];
    const row: BankImportRow = {
      index: r.index,
      key: dir && dir !== 'internal' ? bankImportKey(chosen.account, dir, tx) : '',
      direction: dir && dir !== 'internal' ? dir : null,
      number: tx.number,
      docDate: tx.date,
      bookedDate: dir && dir !== 'internal' ? bankBookedDate(tx, dir) : tx.date,
      amount: tx.amount,
      purpose: tx.purpose,
      party: p ? { name: p.name, inn: p.inn, kpp: p.kpp, account: p.account, bik: p.bik, bank: p.bank } : { name: '', inn: '', kpp: '', account: '', bik: '', bank: '' },
      counterpartyId: null,
      counterpartyName: null,
      candidates: [],
      settlementDocumentId: null,
      settlementDocument: null,
      operation: null,
      skip: false,
      issues,
    };
    if (r.internal || (p && p.inn && ownInns.has(p.inn) && ownNumbers.includes(p.account))) {
      issues.push('internal_transfer');
      row.skip = true;
    } else if (!dir || dir === 'internal') {
      issues.push('other_account');
      row.skip = true;
    }
    if (row.skip) {
      rows.push(row);
      continue;
    }
    if (known.has(row.key)) {
      issues.push('duplicate');
      row.skip = true;
    }
    const m = matchCompany(p!);
    row.counterpartyId = m.hit?.id ?? null;
    row.counterpartyName = m.hit?.name ?? null;
    row.candidates = m.candidates;
    if (m.candidates.length) issues.push('counterparty_ambiguous');

    // документ: по номеру из назначения среди документов контрагента (или любых, если контрагент не найден)
    const wantSide = dir === 'in' ? 'customer' : 'supplier';
    const found = new Map<string, NonNullable<Awaited<ReturnType<typeof payableOf>>>>();
    for (const d of docs) {
      if (row.counterpartyId && d.counterpartyId !== row.counterpartyId) continue;
      if (!refs[i]!.some(t => sameDocumentNumber(d.number!, t))) continue;
      const st = await payable(d.id);
      if (st && !found.has(st.status.rootId)) found.set(st.status.rootId, st);
    }
    let list = [...found.values()];
    if (list.length > 1) {
      const open = list.filter(s => Number(s.status.remaining) > 0);
      if (open.length) list = open;
    }
    if (list.length > 1) {
      const side = list.filter(s => s.status.side === wantSide);
      if (side.length) list = side;
    }
    if (list.length === 1) {
      const s = list[0]!;
      const root = docs.find(d => d.id === s.status.rootId) ?? null;
      row.settlementDocumentId = s.status.rootId;
      row.settlementDocument = { id: s.status.rootId, type: root?.type ?? '', number: s.rootNumber, date: root?.date ?? '', remaining: s.status.remaining };
      if (!row.counterpartyId) {
        row.counterpartyId = s.counterpartyId;
        row.counterpartyName = cpName.get(s.counterpartyId) ?? null;
        row.candidates = [];
        const k = issues.indexOf('counterparty_ambiguous');
        if (k >= 0) issues.splice(k, 1);
        issues.push('counterparty_from_document');
      }
      row.operation = dir === 'in' ? (s.status.side === 'supplier' ? 'supplier_refund' : 'from_customer') : s.status.side === 'customer' ? 'customer_refund' : 'to_supplier';
    } else if (list.length > 1) {
      issues.push('document_ambiguous');
    }
    if (!row.operation) row.operation = row.counterpartyId ? (dir === 'in' ? 'from_customer' : 'to_supplier') : dir === 'in' ? 'other_income' : 'other_expense';
    if (!row.counterpartyId && !m.candidates.length) issues.push('counterparty_not_found');
    rows.push(row);
  }

  return {
    ...base,
    bankAccount: { id: chosen.id, label: label(chosen), organizationId: chosen.organizationId! },
    rows,
    summary: {
      total: rows.length,
      incoming: rows.filter(r => r.direction === 'in').length,
      outgoing: rows.filter(r => r.direction === 'out').length,
      duplicates: rows.filter(r => r.issues.includes('duplicate')).length,
      unmatched: rows.filter(r => !r.skip && !r.counterpartyId).length,
    },
  };
}

/* ---------------- создание документов ---------------- */

export interface BankImportCommitRow {
  direction: BankDirection;
  number: string;
  docDate: string;
  bookedDate: string;
  amount: string;
  purpose: string;
  operation: string;
  counterpartyId?: string | null;
  settlementDocumentId?: string | null;
  cashFlowItemId?: string | null;
  costItemId?: string | null;
  skip?: boolean;
}

export interface BankImportResult {
  created: { key: string; id: string; posted: boolean }[];
  skipped: { key: string; reason: 'duplicate' | 'skipped' }[];
  failed: { key: string; code: string; message: string }[];
}

let spSeq = 0;
/** Вложенная «транзакция» через savepoint: запрос API уже идёт в одной транзакции, сбой строки откатывает только её */
async function savepoint<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  const name = `bank_import_${++spSeq}`;
  await db.execute(sql.raw(`savepoint ${name}`));
  try {
    const r = await fn();
    await db.execute(sql.raw(`release savepoint ${name}`));
    return r;
  } catch (e) {
    await db.execute(sql.raw(`rollback to savepoint ${name}`));
    throw e;
  }
}

const ruDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Создаёт документы банка из строк предпросмотра (после правок пользователя). Каждая строка — в своём savepoint:
    ошибка одной строки не отменяет остальные. Повторные строки (тот же ключ) пропускаются */
export async function commitBankImport(db: Db, ctx: DocCtx, input: { bankAccountId: string; post: boolean; rows: BankImportCommitRow[] }): Promise<BankImportResult> {
  const [acc] = await db.select({ id: bankAccounts.id, account: bankAccounts.account, organizationId: bankAccounts.organizationId }).from(bankAccounts).where(eq(bankAccounts.id, input.bankAccountId)).limit(1);
  if (!acc || !acc.organizationId) throw new DomainError(422, 'invalid_reference', 'Select a bank account of your organization');
  const result: BankImportResult = { created: [], skipped: [], failed: [] };
  const seen = new Set<string>();
  for (const raw of input.rows) {
    const r = { ...raw, amount: parseBankAmount(raw.amount) ?? raw.amount };
    const key = bankImportKey(acc.account, r.direction, { date: r.docDate, number: r.number, amount: r.amount });
    if (r.skip) {
      result.skipped.push({ key, reason: 'skipped' });
      continue;
    }
    const [dup] = seen.has(key) ? [{}] : await db.select({ id: documents.id }).from(documents).where(eq(documents.bankImportKey, key)).limit(1);
    if (dup) {
      result.skipped.push({ key, reason: 'duplicate' });
      continue;
    }
    seen.add(key);
    try {
      if (!IMPORT_OPERATIONS[r.direction].includes(r.operation)) throw new DomainError(422, 'invalid_operation', 'This operation does not match the direction of the bank operation');
      const type: CashDocType = r.direction === 'in' ? 'bank_receipt' : 'bank_payment';
      const out = await savepoint(db, async () => {
        const id = await createPayment(db, ctx, {
          type,
          operation: r.operation,
          organizationId: acc.organizationId,
          bankAccountId: acc.id,
          date: r.bookedDate,
          counterpartyId: r.counterpartyId ?? null,
          bankImportKey: key,
          comment: `${r.number ? `№ ${r.number} ` : ''}от ${ruDate(r.docDate)}${r.purpose ? `: ${r.purpose}` : ''}`.slice(0, 2000),
          lines: [{ id: crypto.randomUUID(), settlementDocumentId: r.settlementDocumentId ?? null, amount: r.amount, cashFlowItemId: r.cashFlowItemId ?? null, costItemId: r.costItemId ?? null, comment: '' } as never],
        });
        return id;
      });
      let posted = false;
      if (input.post) {
        // проведение — отдельный savepoint: не получилось — остаётся черновик, причина в failed
        try {
          await savepoint(db, () => postDocument(db, ctx, out));
          posted = true;
        } catch (e) {
          if (!(e instanceof DomainError)) throw e;
          result.failed.push({ key, code: e.code, message: e.message });
        }
      }
      result.created.push({ key, id: out, posted });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      result.failed.push({ key, code: e.code, message: e.message });
    }
  }
  return result;
}

/* ---------------- выгрузка платёжных поручений ---------------- */

export interface PaymentOrdersExport {
  text: string;
  count: number;
  skipped: { id: string; number: string | null; reason: 'no_counterparty' | 'no_counterparty_account' }[];
}

/** Платёжные поручения из документов «Списание со счёта» (черновики и проведённые) в формате 1CClientBankExchange */
export async function exportPaymentOrders(db: Db, input: { bankAccountId: string; from?: string; to?: string; ids?: string[] }): Promise<PaymentOrdersExport> {
  const [acc] = await db
    .select({ id: bankAccounts.id, account: bankAccounts.account, bik: bankAccounts.bik, bankName: bankAccounts.bankName, corr: bankAccounts.corrAccount, org: organizations.name, orgFull: organizations.fullName, inn: organizations.inn, kpp: organizations.kpp })
    .from(bankAccounts)
    .innerJoin(organizations, eq(organizations.id, bankAccounts.organizationId))
    .where(eq(bankAccounts.id, input.bankAccountId))
    .limit(1);
  if (!acc) throw new DomainError(422, 'invalid_reference', 'Select a bank account of your organization');
  const where = [eq(documents.type, 'bank_payment'), eq(documents.bankAccountId, input.bankAccountId), ne(documents.status, 'cancelled')];
  if (input.from) where.push(gte(documents.date, input.from));
  if (input.to) where.push(lte(documents.date, input.to));
  if (input.ids?.length) where.push(inArray(documents.id, input.ids));
  const docs = await db
    .select({ id: documents.id, number: documents.number, date: documents.date, total: documents.total, comment: documents.comment, operation: documents.operation, counterpartyId: documents.counterpartyId, created: documents.createdAt })
    .from(documents)
    .where(and(...where))
    .orderBy(asc(documents.date), asc(documents.createdAt));
  const out: PaymentOrderExport[] = [];
  const skipped: PaymentOrdersExport['skipped'] = [];
  for (const d of docs) {
    if (!d.counterpartyId) {
      skipped.push({ id: d.id, number: d.number, reason: 'no_counterparty' });
      continue;
    }
    const [cp] = await db.select({ name: companies.name, inn: companies.inn, kpp: companies.kpp }).from(companies).where(eq(companies.id, d.counterpartyId)).limit(1);
    const [ca] = await db.select().from(bankAccounts).where(eq(bankAccounts.companyId, d.counterpartyId)).orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.createdAt)).limit(1);
    if (!cp || !ca) {
      skipped.push({ id: d.id, number: d.number, reason: 'no_counterparty_account' });
      continue;
    }
    const seq = (d.number?.match(/\d+/g) ?? []).pop()?.replace(/^0+(?=\d)/, '') ?? String(out.length + 1);
    out.push({
      number: seq,
      date: d.date,
      amount: d.total,
      payer: { name: acc.orgFull || acc.org, inn: acc.inn, kpp: acc.kpp, account: acc.account, bik: acc.bik, bank: acc.bankName, corrAccount: acc.corr },
      receiver: { name: cp.name, inn: cp.inn, kpp: cp.kpp, account: ca.account, bik: ca.bik, bank: ca.bankName, corrAccount: ca.corrAccount },
      purpose: d.comment.trim() || 'Оплата по договору',
    });
  }
  return { text: renderPaymentOrders({ orders: out, createdAt: new Date().toISOString().slice(0, 10) }), count: out.length, skipped };
}
