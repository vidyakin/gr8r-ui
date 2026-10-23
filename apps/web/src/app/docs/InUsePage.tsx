/* Имущество в эксплуатации: переданные сотрудникам и участкам товары — у кого и сколько.
   Учёт количественный, без стоимости: стоимость списания лежит в статье затрат перемещения. */
import * as React from 'react';
import { CircleAlert, PackageCheck } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { useT } from '@/i18n';
import { unitSymbol, useUnits } from '../catalog/data';
import { useInUseBalances, type InUseBalance } from './data';

const qty = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v) || '0';

export function InUsePage() {
  const units = useUnits();
  const filters = useFilterState();
  const list = useInUseBalances();
  const t = useT();
  const rows = list.data ?? [];
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const tt = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(tt);
  }, [filters.q]);

  const filtered = React.useMemo(() => {
    const needle = q.toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => r.name.toLowerCase().includes(needle) || r.sku.toLowerCase().includes(needle) || (r.memberName ?? '').toLowerCase().includes(needle) || (r.workCenterName ?? '').toLowerCase().includes(needle));
  }, [rows, q]);

  const columns = React.useMemo<Column<InUseBalance>[]>(
    () => [
      { id: 'name', header: t('docs.inUse.col.product'), width: 300, value: r => r.name, cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{r.name}</span> },
      { id: 'sku', header: t('docs.inUse.col.sku'), width: 130, value: r => r.sku, cell: r => (r.sku ? <span className="mono">{r.sku}</span> : <span className="faint">—</span>) },
      { id: 'holder', header: t('docs.inUse.col.holder'), width: 240, value: r => r.memberName ?? r.workCenterName ?? '', cell: r => <span className="trunc muted">{r.memberName ?? r.workCenterName ?? '—'}</span> },
      { id: 'qty', header: t('docs.inUse.col.qty'), width: 120, align: 'right', value: r => Number(r.qty), cell: r => <span className="num" style={{ fontWeight: 500 }}>{qty(r.qty)} <span className="faint">{unitSymbol(units.data, r.unitCode)}</span></span> },
    ],
    [units.data, t],
  );
  const table = useDataTable(columns, { sort: { id: 'name', dir: 1 } });
  const filterFields: FilterField[] = [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('docs.inUse.title')}</h1>
          <p>{t('docs.inUse.lead')}</p>
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('docs.inUse.searchPlaceholder') }}
        fields={filterFields}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('docs.inUse.loadError')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label={t('docs.inUse.ariaLabel')}
          columns={columns}
          rows={filtered}
          table={table}
          getId={r => `${r.productId}:${r.memberId ?? r.workCenterId}`}
          showTotals={filtered.length > 0}
          totalLabel={t('ui.total')}
          empty={
            <EmptyState icon={<PackageCheck size={20} />} title={filters.count || q ? t('docs.inUse.emptyFiltered') : t('docs.inUse.emptyTitle')}>
              {filters.count || q ? t('docs.inUse.emptyFilteredHint') : t('docs.inUse.emptyHint')}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
