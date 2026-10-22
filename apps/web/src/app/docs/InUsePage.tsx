/* Имущество в эксплуатации: переданные сотрудникам и участкам товары — у кого и сколько.
   Учёт количественный, без стоимости: стоимость списания лежит в статье затрат перемещения. */
import * as React from 'react';
import { CircleAlert, PackageCheck } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { unitSymbol, useUnits } from '../catalog/data';
import { useInUseBalances, type InUseBalance } from './data';

const qty = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v) || '0';

export function InUsePage() {
  const units = useUnits();
  const filters = useFilterState();
  const list = useInUseBalances();
  const rows = list.data ?? [];
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  const filtered = React.useMemo(() => {
    const needle = q.toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => r.name.toLowerCase().includes(needle) || r.sku.toLowerCase().includes(needle) || (r.memberName ?? '').toLowerCase().includes(needle) || (r.workCenterName ?? '').toLowerCase().includes(needle));
  }, [rows, q]);

  const columns = React.useMemo<Column<InUseBalance>[]>(
    () => [
      { id: 'name', header: 'Product', width: 300, value: r => r.name, cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{r.name}</span> },
      { id: 'sku', header: 'SKU', width: 130, value: r => r.sku, cell: r => (r.sku ? <span className="mono">{r.sku}</span> : <span className="faint">—</span>) },
      { id: 'holder', header: 'Holder', width: 240, value: r => r.memberName ?? r.workCenterName ?? '', cell: r => <span className="trunc muted">{r.memberName ?? r.workCenterName ?? '—'}</span> },
      { id: 'qty', header: 'In use', width: 120, align: 'right', value: r => Number(r.qty), cell: r => <span className="num" style={{ fontWeight: 500 }}>{qty(r.qty)} <span className="faint">{unitSymbol(units.data, r.unitCode)}</span></span> },
    ],
    [units.data],
  );
  const table = useDataTable(columns, { sort: { id: 'name', dir: 1 } });
  const filterFields: FilterField[] = [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>In use</h1>
          <p>Goods handed over to members and work centers. A transfer to operation writes them off the warehouse.</p>
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: 'Search by product or holder' }}
        fields={filterFields}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load the goods in use" action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label="Goods in use"
          columns={columns}
          rows={filtered}
          table={table}
          getId={r => `${r.productId}:${r.memberId ?? r.workCenterId}`}
          showTotals={filtered.length > 0}
          totalLabel="Total"
          empty={
            <EmptyState icon={<PackageCheck size={20} />} title={filters.count || q ? 'No results found' : 'Nothing is in use yet'}>
              {filters.count || q ? 'No goods match these filters.' : 'Transfer goods to a member or a work center to see them here.'}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
