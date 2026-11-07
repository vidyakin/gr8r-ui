/* Отчёт «Старение запасов» (docs/architecture/stock.md, «Старение запасов»).
   Остаток на дату по (склад, товар), разложенный по возрасту поступления. Возраст = дата отчёта − дата прихода слоя.
   Слои: у товара с партиями (движение с batch_id) слой — партия, возраст от первого прихода партии; движения без партии —
   FIFO по приходным движениям: расходы съедают самые старые приходы, остаётся хвост самых свежих. Оценка слоя — по цене
   его прихода (с корректировкой закрытия периода), для партии — средневзвешенная цена приходов; поэтому сумма отчёта может
   отличаться от стоимости остатка по средней скользящей в «Остатках». Всё считается SQL-запросом по stock_moves
   (движения с moved_at ≤ даты отчёта), стоимость отдаёт API только admin и owner. */
import { sql } from 'drizzle-orm';
import { dec, fmt } from '@gr8r/shared';
import type { Db } from './client';

/** Границы корзин возраста, дней: 0–30, 31–60, 61–90, 91–180, >180 */
export const AGING_BUCKETS = [30, 60, 90, 180] as const;

export interface StockAgingRow {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  sku: string;
  unitCode: string;
  categoryId: string | null;
  qty: string;
  value: string;
  /** Количество по корзинам возраста (5 значений) */
  bucketsQty: string[];
  /** Сумма по корзинам возраста (5 значений) */
  bucketsValue: string[];
}

export interface StockAgingReport {
  asOf: string;
  items: StockAgingRow[];
  totals: { qty: string; value: string; bucketsQty: string[]; bucketsValue: string[] };
}

export interface StockAgingFilter {
  warehouseId?: string;
  /** Категория товара вместе с вложенными */
  categoryId?: string;
  productId?: string;
  /** Дата отчёта YYYY-MM-DD; по умолчанию сегодня */
  asOf?: string;
}

interface Raw {
  warehouse_id: string;
  warehouse_name: string;
  product_id: string;
  product_name: string;
  sku: string;
  unit_code: string;
  category_id: string | null;
  qty: string;
  value: string;
  q0: string; q1: string; q2: string; q3: string; q4: string;
  v0: string; v1: string; v2: string; v3: string; v4: string;
}

const sum = (xs: string[]) => xs.reduce((a, x) => a + dec(x), 0n);
const fmt3 = (d: bigint) => fmt(d, 3);
const fmt2 = (d: bigint) => fmt(d, 2);

export async function stockAging(db: Db, workspaceId: string, f: StockAgingFilter = {}): Promise<StockAgingReport> {
  const asOf = f.asOf ?? new Date().toISOString().slice(0, 10);
  const wh = f.warehouseId ? sql`and m.warehouse_id = ${f.warehouseId}::uuid` : sql``;
  const pr = f.productId ? sql`and m.product_id = ${f.productId}::uuid` : sql``;
  const cat = f.categoryId ? sql`and p.category_id in (select id from cat_tree)` : sql``;
  const rows = (await db.execute(sql`
    with recursive cat_tree as (
      select id from product_categories where workspace_id = ${workspaceId}::uuid and id = ${f.categoryId ?? null}::uuid
      union all
      select c.id from product_categories c join cat_tree t on c.parent_id = t.id where c.workspace_id = ${workspaceId}::uuid
    ),
    mv as (
      select m.warehouse_id, m.product_id, m.batch_id, m.moved_at, m.seq, m.qty,
             m.cost + coalesce(a.delta_cost, 0) as cost
      from stock_moves m
      join products p on p.workspace_id = m.workspace_id and p.id = m.product_id
      left join stock_cost_adjustments a on a.workspace_id = m.workspace_id and a.move_id = m.id
      where m.workspace_id = ${workspaceId}::uuid and m.moved_at <= ${asOf}::date ${wh} ${pr} ${cat}
    ),
    batch_layers as (
      select warehouse_id, product_id,
             min(moved_at) filter (where qty > 0) as since,
             sum(qty) as qty,
             coalesce(sum(qty * cost) filter (where qty > 0) / nullif(sum(qty) filter (where qty > 0), 0), 0) as cost
      from mv where batch_id is not null
      group by warehouse_id, product_id, batch_id
      having sum(qty) > 0 and min(moved_at) filter (where qty > 0) is not null
    ),
    fifo_rem as (
      select warehouse_id, product_id, sum(qty) as rem from mv where batch_id is null group by warehouse_id, product_id having sum(qty) > 0
    ),
    fifo_in as (
      select i.warehouse_id, i.product_id, i.moved_at, i.qty, i.cost, r.rem,
             coalesce(sum(i.qty) over (partition by i.warehouse_id, i.product_id order by i.moved_at desc, i.seq desc rows between unbounded preceding and 1 preceding), 0) as newer
      from mv i join fifo_rem r on r.warehouse_id = i.warehouse_id and r.product_id = i.product_id
      where i.batch_id is null and i.qty > 0
    ),
    layers as (
      select warehouse_id, product_id, since, qty, cost from batch_layers
      union all
      select warehouse_id, product_id, moved_at, least(qty, rem - newer), cost from fifo_in where rem - newer > 0
    ),
    aged as (
      select warehouse_id, product_id, qty, qty * cost as val,
             case when (${asOf}::date - since) <= ${AGING_BUCKETS[0]} then 0
                  when (${asOf}::date - since) <= ${AGING_BUCKETS[1]} then 1
                  when (${asOf}::date - since) <= ${AGING_BUCKETS[2]} then 2
                  when (${asOf}::date - since) <= ${AGING_BUCKETS[3]} then 3 else 4 end as b
      from layers
    )
    select a.warehouse_id, w.name as warehouse_name, a.product_id, p.name as product_name, p.sku, p.unit_code, p.category_id,
           sum(a.qty)::numeric(18,3)::text as qty, round(sum(a.val), 2)::text as value,
           ${sql.join([0, 1, 2, 3, 4].map(b => sql.raw(`coalesce(sum(a.qty) filter (where a.b = ${b}), 0)::numeric(18,3)::text as q${b}`)), sql`, `)},
           ${sql.join([0, 1, 2, 3, 4].map(b => sql.raw(`coalesce(round(sum(a.val) filter (where a.b = ${b}), 2), 0)::text as v${b}`)), sql`, `)}
    from aged a
    join products p on p.workspace_id = ${workspaceId}::uuid and p.id = a.product_id
    join warehouses w on w.workspace_id = ${workspaceId}::uuid and w.id = a.warehouse_id
    group by a.warehouse_id, w.name, a.product_id, p.name, p.sku, p.unit_code, p.category_id
    order by p.name, w.name
  `)) as unknown as Raw[];
  const items: StockAgingRow[] = rows.map(r => ({
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name,
    productId: r.product_id,
    productName: r.product_name,
    sku: r.sku,
    unitCode: r.unit_code,
    categoryId: r.category_id,
    qty: r.qty,
    value: r.value,
    bucketsQty: [r.q0, r.q1, r.q2, r.q3, r.q4],
    bucketsValue: [r.v0, r.v1, r.v2, r.v3, r.v4],
  }));
  const totals = {
    qty: fmt3(sum(items.map(i => i.qty))),
    value: fmt2(sum(items.map(i => i.value))),
    bucketsQty: [0, 1, 2, 3, 4].map(b => fmt3(sum(items.map(i => i.bucketsQty[b]!)))),
    bucketsValue: [0, 1, 2, 3, 4].map(b => fmt2(sum(items.map(i => i.bucketsValue[b]!)))),
  };
  return { asOf, items, totals };
}
