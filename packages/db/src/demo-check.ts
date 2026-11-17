/* Проверка целостности учёта воркспейса: регистры сходятся с документами, остатки и деньги не уходят в минус.
   Нужна после перезаполнения демо (seed-history.ts) и как регрессия бизнес-логики проведения: тест
   `packages/db/test/demo-check.test.ts` заполняет демо и требует ноль ошибок; CLI — `bun run demo:check [адрес]`.
   error — нарушение инварианта (баг проведения или сида), warning — подозрительно, но допустимо правилами. */
import type { Tx } from './client';

export interface CheckIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  rows: Record<string, unknown>[];
}

export interface CheckReport {
  issues: CheckIssue[];
  stats: Record<string, number>;
}

const SALES_PURCHASE = ['quote', 'customer_order', 'invoice', 'realization', 'act', 'customer_return', 'supplier_order', 'receipt', 'supplier_return'];
const MONEY_DOCS = ['cash_receipt', 'cash_payment', 'bank_receipt', 'bank_payment'];
const STOCK_DOCS = ['receipt', 'realization', 'customer_return', 'supplier_return', 'stock_transfer', 'write_off', 'stock_posting', 'opening_stock'];

/** Запускать внутри транзакции с контекстом арендатора (withContext с workspaceId) */
export async function checkWorkspace(tx: Tx, workspaceId: string): Promise<CheckReport> {
  const issues: CheckIssue[] = [];
  const add = (level: CheckIssue['level'], code: string, message: string, rows: Record<string, unknown>[]) => {
    if (rows.length) issues.push({ level, code, message, rows: rows.slice(0, 10) });
  };

  // 1. остаток регистра = сумма движений
  add(
    'error',
    'balance_mismatch',
    'stock_balances.qty differs from the sum of stock_moves',
    await tx`
      select b.warehouse_id, b.product_id, b.qty::text as balance, coalesce(m.s, 0)::text as moves
      from stock_balances b
      full join (select warehouse_id, product_id, sum(qty) s from stock_moves where workspace_id = ${workspaceId} group by 1, 2) m
        on m.warehouse_id = b.warehouse_id and m.product_id = b.product_id
      where coalesce(b.workspace_id, ${workspaceId}) = ${workspaceId} and coalesce(b.qty, 0) <> coalesce(m.s, 0)`,
  );

  // 2. отрицательный остаток сейчас
  add('error', 'negative_stock', 'Negative stock balance', await tx`
    select w.name as warehouse, p.sku, b.qty::text from stock_balances b join warehouses w on w.id = b.warehouse_id join products p on p.id = b.product_id
    where b.workspace_id = ${workspaceId} and b.qty < 0`);

  // 3. остаток на дату уходил в минус (документ проведён задним числом раньше прихода)
  add('warning', 'negative_stock_on_date', 'Stock went negative on some date (backdated posting)', await tx`
    select warehouse, sku, moved_at::text as date, running::text from (
      select w.name as warehouse, p.sku, m.moved_at, sum(m.qty) over (partition by m.warehouse_id, m.product_id order by m.moved_at, m.qty desc, m.seq) as running
      from stock_moves m join warehouses w on w.id = m.warehouse_id join products p on p.id = m.product_id where m.workspace_id = ${workspaceId}) x
    where running < 0 order by date limit 10`);

  // 4. проведённый складской документ без движений и движения у непроведённого
  add('error', 'posted_without_moves', 'Posted stock document has no stock moves', await tx`
    select d.type, d.number, d.date::text from documents d
    where d.workspace_id = ${workspaceId} and d.status = 'posted' and d.type in ${tx(STOCK_DOCS)}
      and exists (select 1 from document_lines l join products p on p.id = l.product_id where l.document_id = d.id and p.kind = 'goods')
      and not exists (select 1 from stock_moves m where m.document_id = d.id)`);
  add('error', 'moves_of_unposted', 'Stock moves belong to a draft or cancelled document', await tx`
    select d.type, d.number, d.status from documents d where d.workspace_id = ${workspaceId} and d.status <> 'posted'
      and exists (select 1 from stock_moves m where m.document_id = d.id)`);

  // 5. итог документа = сумма строк
  add('error', 'total_mismatch', 'Document total differs from the sum of its lines', await tx`
    select d.type, d.number, d.total::text, sum(l.total)::text as lines from documents d join document_lines l on l.document_id = d.id
    where d.workspace_id = ${workspaceId} and d.type in ${tx(SALES_PURCHASE)} group by d.id having d.total <> sum(l.total)`);
  add('error', 'line_math', 'Line total differs from net + VAT', await tx`
    select d.type, d.number, l.net::text, l.vat_amount::text, l.total::text from document_lines l join documents d on d.id = l.document_id
    where l.workspace_id = ${workspaceId} and d.type in ${tx(SALES_PURCHASE)} and l.net + l.vat_amount <> l.total`);

  // 6. деньги: проведённый платёж двигает кассу/счёт на свою сумму
  add('error', 'payment_cash_mismatch', 'Posted payment: cash moves differ from the document total', await tx`
    select d.type, d.number, d.total::text, coalesce(sum(c.amount), 0)::text as moved from documents d
      left join cash_moves c on c.document_id = d.id and c.account_kind in ('cash', 'bank')
        -- перемещение денег пишет расход и приход: сверяем сторону самого документа
        and c.direction = case when d.type like '%receipt' then 'in' else 'out' end
    where d.workspace_id = ${workspaceId} and d.status = 'posted' and d.type in ${tx(MONEY_DOCS)} group by d.id having d.total <> coalesce(sum(c.amount), 0)`);
  add('error', 'payment_lines_mismatch', 'Payment total differs from the sum of payment lines', await tx`
    select d.type, d.number, d.total::text, sum(pl.amount)::text as lines from documents d join payment_lines pl on pl.document_id = d.id
    where d.workspace_id = ${workspaceId} and d.type in ${tx(MONEY_DOCS)} group by d.id having d.total <> sum(pl.amount)`);

  // 7. остаток денег на счёте/в кассе сейчас и на любую дату
  add('error', 'negative_cash', 'Cash register or bank account balance is negative now', await tx`
    select account_kind, coalesce(cash_register_id, bank_account_id)::text as account, sum(case when direction = 'in' then amount else -amount end)::text as balance
    from cash_moves where workspace_id = ${workspaceId} and account_kind in ('cash', 'bank') group by 1, 2 having sum(case when direction = 'in' then amount else -amount end) < 0`);
  add('warning', 'negative_cash_on_date', 'Money balance went negative on some date', await tx`
    select account_kind, date::text, running::text from (
      select account_kind, date, sum(case when direction = 'in' then amount else -amount end) over (partition by account_kind, coalesce(cash_register_id, bank_account_id) order by date, direction) as running
      from cash_moves where workspace_id = ${workspaceId} and account_kind in ('cash', 'bank')) x where running < 0 order by date limit 10`);

  // 8. резерв не больше остатка склада
  add('warning', 'over_reserved', 'Reserved quantity exceeds stock on hand', await tx`
    select w.name as warehouse, p.sku, r.reserved::text, coalesce(b.qty, 0)::text as on_hand from
      (select warehouse_id, product_id, sum(qty) reserved from stock_reservations where workspace_id = ${workspaceId} group by 1, 2) r
      join warehouses w on w.id = r.warehouse_id join products p on p.id = r.product_id
      left join stock_balances b on b.warehouse_id = r.warehouse_id and b.product_id = r.product_id
    where r.reserved > coalesce(b.qty, 0)`);

  // 9. номера проведённых документов уникальны в пределах вида и года
  add('error', 'duplicate_number', 'Duplicate document number', await tx`
    select type, number, extract(year from date)::int as year, count(*)::int as n from documents
    where workspace_id = ${workspaceId} and number is not null and status = 'posted' group by 1, 2, 3 having count(*) > 1`);

  // 10. в закрытом периоде нет черновиков с движениями и все месяцы до даты запрета закрыты
  const [lock] = await tx`select closed_through::text as closed from workspaces where id = ${workspaceId}`;
  if (lock?.closed) {
    add('warning', 'unclosed_month', 'Month before the lock date has stock moves but no cost closing', await tx`
      select distinct to_char(m.moved_at, 'YYYY-MM') as month from stock_moves m
      where m.workspace_id = ${workspaceId} and m.moved_at <= ${lock.closed as string}::date
        and not exists (select 1 from production_cost_closings c where c.workspace_id = ${workspaceId} and c.period = date_trunc('month', m.moved_at)::date and c.status = 'done')
      order by 1`);
  }

  const [s] = await tx`
    select
      (select count(*)::int from documents where workspace_id = ${workspaceId}) as documents,
      (select count(*)::int from documents where workspace_id = ${workspaceId} and status = 'posted') as posted,
      (select count(*)::int from companies where workspace_id = ${workspaceId}) as companies,
      (select count(*)::int from products where workspace_id = ${workspaceId}) as products,
      (select count(*)::int from stock_moves where workspace_id = ${workspaceId}) as stock_moves,
      (select count(*)::int from cash_moves where workspace_id = ${workspaceId}) as cash_moves,
      (select count(*)::int from settlement_moves where workspace_id = ${workspaceId}) as settlement_moves`;
  return { issues, stats: s as Record<string, number> };
}

export function formatReport(r: CheckReport): string {
  const out = [`stats: ${Object.entries(r.stats).map(([k, v]) => `${k}=${v}`).join(', ')}`];
  if (!r.issues.length) out.push('OK: no issues');
  for (const i of r.issues) {
    out.push(`${i.level.toUpperCase()} ${i.code}: ${i.message} (${i.rows.length}${i.rows.length === 10 ? '+' : ''})`);
    for (const row of i.rows.slice(0, 5)) out.push(`  ${JSON.stringify(row)}`);
  }
  return out.join('\n');
}
