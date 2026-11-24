/* Отчёт P&L «Валовая прибыль продаж» и ABC-анализ (задача 1390).
   Выручка — по проведённым реализациям за вычетом возвратов от покупателей в периоде (`dateFrom..dateTo`).
   Себестоимость (COGS) — из `stock_moves.cost`, зафиксированной при проведении (без ретроспективного пересчёта).
   Группировки: товар, категория, контрагент, ответственный, организация, склад. */
import { sql } from 'drizzle-orm';
import {
  calculateSalesAbc,
  calculateSalesProfit,
  dec,
  div,
  fmt,
  mul,
  type AbcRow,
  type SalesProfitEntry,
  type SalesProfitGroupBy,
  type SalesProfitRow,
} from '@erp/shared';
import type { Db } from './client';

export interface SalesProfitFilter {
  dateFrom?: string;
  dateTo?: string;
  groupBy?: SalesProfitGroupBy;
  warehouseId?: string;
  organizationId?: string;
}

export interface SalesProfitTotals {
  revenue: string;
  discount: string;
  cogs: string;
  grossProfit: string;
  grossMarginPct: string | null;
}

export interface SalesProfitReport {
  dateFrom: string | null;
  dateTo: string | null;
  groupBy: SalesProfitGroupBy;
  items: SalesProfitRow[];
  totals: SalesProfitTotals;
}

export interface SalesAbcFilter extends SalesProfitFilter {
  metric?: 'revenue' | 'profit';
  thresholdA?: number;
  thresholdB?: number;
}

export interface SalesAbcClassSummary {
  count: number;
  revenue: string;
  grossProfit: string;
}

export interface SalesAbcReport {
  dateFrom: string | null;
  dateTo: string | null;
  groupBy: SalesProfitGroupBy;
  metric: 'revenue' | 'profit';
  thresholds: { a: number; b: number; c: number };
  items: AbcRow[];
  totals: SalesProfitTotals;
  summary: Record<'A' | 'B' | 'C', SalesAbcClassSummary>;
}

interface RawEntry {
  group_id: string;
  group_name: string;
  doc_type: 'realization' | 'customer_return';
  revenue: string;
  discount: string;
  cogs: string;
}

const GROUP_EXPR: Record<SalesProfitGroupBy, { id: ReturnType<typeof sql>; name: ReturnType<typeof sql> }> = {
  product: { id: sql`l.product_id::text`, name: sql`p.name` },
  category: { id: sql`coalesce(p.category_id::text, 'uncategorized')`, name: sql`coalesce(pc.name, '')` },
  company: { id: sql`coalesce(d.counterparty_id::text, 'unassigned')`, name: sql`coalesce(c.name, '')` },
  owner: { id: sql`coalesce(d.responsible_id::text, 'unassigned')`, name: sql`coalesce(mb.name, '')` },
  organization: { id: sql`d.organization_id::text`, name: sql`o.name` },
  warehouse: { id: sql`coalesce(d.warehouse_id::text, 'unassigned')`, name: sql`coalesce(w.name, '')` },
};

function computeTotals(rows: readonly SalesProfitRow[]): SalesProfitTotals {
  let revenue = 0n;
  let discount = 0n;
  let cogs = 0n;
  for (const r of rows) {
    revenue += dec(r.revenue);
    discount += dec(r.discount);
    cogs += dec(r.cogs);
  }
  const grossProfit = revenue - cogs;
  return {
    revenue: fmt(revenue, 2),
    discount: fmt(discount, 2),
    cogs: fmt(cogs, 2),
    grossProfit: fmt(grossProfit, 2),
    grossMarginPct: revenue === 0n ? null : fmt(mul(div(grossProfit, revenue), dec('100')), 2),
  };
}

async function loadEntries(db: Db, workspaceId: string, f: SalesProfitFilter): Promise<SalesProfitEntry[]> {
  const groupBy = f.groupBy ?? 'product';
  const g = GROUP_EXPR[groupBy];
  const from = f.dateFrom ? sql`and d.date >= ${f.dateFrom}::date` : sql``;
  const to = f.dateTo ? sql`and d.date <= ${f.dateTo}::date` : sql``;
  const wh = f.warehouseId ? sql`and d.warehouse_id = ${f.warehouseId}::uuid` : sql``;
  const org = f.organizationId ? sql`and d.organization_id = ${f.organizationId}::uuid` : sql``;

  const rows = (await db.execute(sql`
    with line_cogs as (
      select m.document_line_id,
             round(sum(abs(m.qty) * m.cost), 2)::numeric(18,2) as cogs
      from stock_moves m
      where m.workspace_id = ${workspaceId}::uuid and m.document_line_id is not null
      group by m.document_line_id
    )
    select ${g.id} as group_id,
           ${g.name} as group_name,
           d.type as doc_type,
           sum(l.net)::numeric(18,2)::text as revenue,
           coalesce(round(sum((l.qty / nullif(l.unit_factor, 0)) * l.price * (l.discount_pct / 100.0)), 2), 0)::numeric(18,2)::text as discount,
           coalesce(sum(lc.cogs), 0)::numeric(18,2)::text as cogs
    from documents d
    join document_lines l on l.workspace_id = d.workspace_id and l.document_id = d.id
    join products p on p.workspace_id = l.workspace_id and p.id = l.product_id
    join organizations o on o.workspace_id = d.workspace_id and o.id = d.organization_id
    left join product_categories pc on pc.workspace_id = p.workspace_id and pc.id = p.category_id
    left join companies c on c.workspace_id = d.workspace_id and c.id = d.counterparty_id
    left join members mb on mb.workspace_id = d.workspace_id and mb.id = d.responsible_id
    left join warehouses w on w.workspace_id = d.workspace_id and w.id = d.warehouse_id
    left join line_cogs lc on lc.document_line_id = l.id
    where d.workspace_id = ${workspaceId}::uuid
      and d.status = 'posted'
      and d.type in ('realization', 'customer_return')
      ${from} ${to} ${wh} ${org}
    group by 1, 2, 3
  `)) as unknown as RawEntry[];

  return rows.map(r => ({
    groupId: r.group_id,
    groupName: r.group_name,
    type: r.doc_type,
    revenue: r.revenue,
    discount: r.discount,
    cogs: r.cogs,
  }));
}

export async function salesProfitReport(db: Db, workspaceId: string, f: SalesProfitFilter = {}): Promise<SalesProfitReport> {
  const groupBy = f.groupBy ?? 'product';
  const entries = await loadEntries(db, workspaceId, f);
  const items = calculateSalesProfit(entries).sort((a, b) => {
    const diff = dec(b.revenue) - dec(a.revenue);
    return diff > 0n ? 1 : diff < 0n ? -1 : a.groupName.localeCompare(b.groupName);
  });
  return {
    dateFrom: f.dateFrom ?? null,
    dateTo: f.dateTo ?? null,
    groupBy,
    items,
    totals: computeTotals(items),
  };
}

export async function salesAbcReport(db: Db, workspaceId: string, f: SalesAbcFilter = {}): Promise<SalesAbcReport> {
  const metric = f.metric ?? 'revenue';
  const a = f.thresholdA ?? 80;
  const b = f.thresholdB ?? 15;
  const profit = await salesProfitReport(db, workspaceId, f);
  const items = calculateSalesAbc(profit.items, metric, { a, b });

  const acc = { A: { count: 0, rev: 0n, prof: 0n }, B: { count: 0, rev: 0n, prof: 0n }, C: { count: 0, rev: 0n, prof: 0n } };
  for (const row of items) {
    const s = acc[row.abcClass];
    s.count += 1;
    s.rev += dec(row.revenue);
    s.prof += dec(row.grossProfit);
  }
  const toSummary = (k: 'A' | 'B' | 'C'): SalesAbcClassSummary => ({
    count: acc[k].count,
    revenue: fmt(acc[k].rev, 2),
    grossProfit: fmt(acc[k].prof, 2),
  });

  return {
    dateFrom: profit.dateFrom,
    dateTo: profit.dateTo,
    groupBy: profit.groupBy,
    metric,
    thresholds: { a, b, c: Math.max(0, Math.round((100 - a - b) * 100) / 100) },
    items,
    totals: profit.totals,
    summary: { A: toSummary('A'), B: toSummary('B'), C: toSummary('C') },
  };
}

/** Маскирование себестоимости, прибыли и маржи для не-администраторов (`canSeeCost`) */
export function maskSalesProfitReport(r: SalesProfitReport, showCost: boolean) {
  if (showCost) return { ...r, costVisible: true as const };
  return {
    ...r,
    costVisible: false as const,
    items: r.items.map(i => ({ ...i, cogs: null, grossProfit: null, grossMarginPct: null })),
    totals: { ...r.totals, cogs: null, grossProfit: null, grossMarginPct: null },
  };
}

export function maskSalesAbcReport(r: SalesAbcReport, showCost: boolean) {
  if (showCost) return { ...r, costVisible: true as const };
  return {
    ...r,
    costVisible: false as const,
    items: r.items.map(i => ({ ...i, cogs: null, grossProfit: null, grossMarginPct: null })),
    totals: { ...r.totals, cogs: null, grossProfit: null, grossMarginPct: null },
    summary: {
      A: { ...r.summary.A, grossProfit: null },
      B: { ...r.summary.B, grossProfit: null },
      C: { ...r.summary.C, grossProfit: null },
    },
  };
}
