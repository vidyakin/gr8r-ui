/* Старение запасов: остаток на дату по складу и товару, разложенный по возрасту поступления
   (0–30, 31–60, 61–90, 91–180, >180 дней). Данные считает сервер (`GET /stock/aging`), здесь только чтение и отборы. */
import * as React from 'react';
import { CircleAlert, Hourglass } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState } from '@/components/gr8r/filter-bar';
import { DateInput } from '@/components/gr8r/date-picker';
import { Stat } from '@/components/gr8r/panel';
import { useT } from '@/i18n';
import { fmtAmount, fmtNumber } from '@/i18n/format';
import { buildCategoryTree, useCategories, type CategoryNode } from '../catalog/data';
import { call, useWsId } from '../meta/data';
import { docsKey, useWarehouses } from './data';
import { useQuery } from '@tanstack/react-query';

export interface StockAgingItem {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  sku: string;
  unitCode: string;
  categoryId: string | null;
  qty: string;
  /** null — стоимость скрыта (видят admin и owner) */
  value: string | null;
  bucketsQty: string[];
  bucketsValue: string[] | null;
}

export interface StockAgingData {
  asOf: string;
  items: StockAgingItem[];
  totals: { qty: string; value: string | null; bucketsQty: string[]; bucketsValue: string[] | null };
  costVisible: boolean;
}

export function useStockAging(params: { warehouseId?: string; categoryId?: string; asOf: string }) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'aging', params),
    queryFn: () => {
      const sp = new URLSearchParams({ asOf: params.asOf });
      if (params.warehouseId) sp.set('warehouseId', params.warehouseId);
      if (params.categoryId) sp.set('categoryId', params.categoryId);
      return call<StockAgingData>(ws, 'GET', `/stock/aging?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

const BUCKETS = [0, 1, 2, 3, 4] as const;
const flatten = (nodes: CategoryNode[]): CategoryNode[] => nodes.flatMap(n => [n, ...flatten(n.children)]);

export function StockAgingPage() {
  const t = useT();
  const filters = useFilterState();
  const warehouses = useWarehouses();
  const categories = useCategories();
  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = React.useState(today);
  const [warehouseId, setWarehouseId] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('');
  const [mode, setMode] = React.useState<'qty' | 'value'>('qty');
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const timer = setTimeout(() => setQ(filters.q.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [filters.q]);

  const report = useStockAging({ warehouseId: warehouseId || undefined, categoryId: categoryId || undefined, asOf });
  const costVisible = report.data?.costVisible ?? false;
  const showValue = mode === 'value' && costVisible;
  const rows = React.useMemo(() => (report.data?.items ?? []).filter(r => !q || r.productName.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)), [report.data, q]);
  const categoryOptions = React.useMemo(() => flatten(buildCategoryTree(categories.data ?? [])), [categories.data]);

  const columns = React.useMemo<Column<StockAgingItem>[]>(() => {
    const cellOf = (r: StockAgingItem, b: number) => {
      const v = showValue ? r.bucketsValue?.[b] : r.bucketsQty[b];
      return Number(v) ? <span className="num">{showValue ? fmtAmount(v) : fmtNumber(v)}</span> : <span className="faint">—</span>;
    };
    return [
      { id: 'product', header: t('docs.stockAging.col.product'), width: 280, value: r => r.productName, cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{r.productName}</span> },
      { id: 'sku', header: t('docs.stockAging.col.sku'), width: 120, value: r => r.sku, cell: r => (r.sku ? <span className="mono">{r.sku}</span> : <span className="faint">—</span>) },
      { id: 'warehouse', header: t('docs.stockAging.col.warehouse'), width: 170, value: r => r.warehouseName, cell: r => <span className="trunc muted">{r.warehouseName}</span> },
      ...BUCKETS.map<Column<StockAgingItem>>(b => ({
        id: `b${b}`,
        header: t(`docs.stockAging.bucket.b${b}`),
        width: 110,
        align: 'right',
        value: r => Number((showValue ? r.bucketsValue?.[b] : r.bucketsQty[b]) ?? 0),
        cell: r => cellOf(r, b),
      })),
      {
        id: 'total',
        header: t('docs.stockAging.col.total'),
        width: 124,
        align: 'right',
        value: r => Number((showValue ? r.value : r.qty) ?? 0),
        cell: r => <span className="num" style={{ fontWeight: 500 }}>{showValue ? fmtAmount(r.value) : fmtNumber(r.qty)}</span>,
      },
    ];
  }, [t, showValue]);
  const table = useDataTable(columns, { sort: { id: 'product', dir: 1 } });

  const totals = report.data?.totals;
  const stat = (b: number) => (totals ? (showValue ? (totals.bucketsValue ? fmtAmount(totals.bucketsValue[b]) : '—') : fmtNumber(totals.bucketsQty[b])) : '—');

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('docs.stockAging.title')}</h1>
          <p>{t('docs.stockAging.lead')}</p>
        </div>
        {costVisible && (
          <div className="acts">
            <Button onClick={() => setMode(m => (m === 'qty' ? 'value' : 'qty'))} aria-pressed={mode === 'value'}>
              {mode === 'qty' ? t('docs.stockAging.showValue') : t('docs.stockAging.showQty')}
            </Button>
          </div>
        )}
      </div>
      <div className="stats" style={{ padding: '0 16px 12px' }}>
        {BUCKETS.map(b => (
          <Stat key={b} label={t(`docs.stockAging.bucket.b${b}`)} value={stat(b)} note={b === 0 && showValue ? t('docs.stockAging.valueHint') : undefined} />
        ))}
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('docs.stockAging.searchPlaceholder') }}
        fields={[]}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
        extra={
          <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 13 }}>{t('docs.stockAging.asOf')}</span>
              <DateInput size="sm" required value={asOf} max={today} onChange={v => v && setAsOf(v)} aria-label={t('docs.stockAging.asOf')} />
            </label>
            <select className="select" aria-label={t('docs.stockAging.warehouse')} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
              <option value="">{t('docs.stockAging.allWarehouses')}</option>
              {(warehouses.data ?? []).map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <select className="select" aria-label={t('docs.stockAging.category')} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">{t('docs.stockAging.allCategories')}</option>
              {categoryOptions.map(c => (
                <option key={c.id} value={c.id}>{`${'  '.repeat(c.depth)}${c.name}`}</option>
              ))}
            </select>
          </div>
        }
      />
      {report.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('docs.stockAging.loadError')} action={<Button size="sm" onClick={() => report.refetch()}>{t('common.retry')}</Button>}>
          {(report.error as Error).message}
        </EmptyState>
      ) : report.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label={t('docs.stockAging.ariaLabel')}
          columns={columns}
          rows={rows}
          table={table}
          getId={r => `${r.warehouseId}:${r.productId}`}
          empty={<EmptyState icon={<Hourglass size={20} />} title={t('docs.stockAging.emptyTitle')}>{t('docs.stockAging.emptyHint')}</EmptyState>}
        />
      )}
    </div>
  );
}
