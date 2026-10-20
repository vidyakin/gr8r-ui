/* Склад: остатки по складам и товарам (количество, резерв, доступно, средняя себестоимость, стоимость) и карточка движений товара.
   Данные считает сервер; остатки и движения пишет проведение документов — здесь только чтение. */
import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Boxes, CircleAlert, Eye, EyeOff, Warehouse as WarehouseIcon } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { DrawerSection, EntityDrawer } from '@/components/gr8r/entity-drawer';
import { Stat } from '@/components/gr8r/panel';
import { money, unitSymbol, useUnits } from '../catalog/data';
import { fmtDate, parse } from '../lib/dates';
import { typeLabel, useStockBalances, useStockMoves, useWarehouses, type StockBalance } from './data';

const qty = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v) || '0';

export function InventoryPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const warehouses = useWarehouses();
  const units = useUnits();
  const filters = useFilterState();
  const [q, setQ] = React.useState('');
  const [hideZero, setHideZero] = React.useState(true);
  React.useEffect(() => {
    const t = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(t);
  }, [filters.q]);
  const wh = (filters.values.warehouse ?? [])[0] ?? sp.get('warehouse') ?? undefined;

  const list = useStockBalances({ warehouseId: wh, q: q || undefined, nonZero: hideZero });
  const rows = list.data?.items ?? [];
  const reservedRows = rows.filter(r => Number(r.reserved) > 0).length;

  const columns = React.useMemo<Column<StockBalance>[]>(
    () => [
      { id: 'name', header: 'Product', width: 300, value: r => r.name, cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{r.name}</span> },
      { id: 'sku', header: 'SKU', width: 130, value: r => r.sku, cell: r => (r.sku ? <span className="mono">{r.sku}</span> : <span className="faint">—</span>) },
      { id: 'warehouse', header: 'Warehouse', width: 200, value: r => r.warehouseName, cell: r => <span className="trunc muted">{r.warehouseName}</span> },
      { id: 'qty', header: 'On hand', width: 112, align: 'right', value: r => Number(r.qty), cell: r => <span className={Number(r.qty) < 0 ? 'num neg' : 'num'}>{qty(r.qty)} <span className="faint">{unitSymbol(units.data, r.unitCode)}</span></span> },
      { id: 'reserved', header: 'Reserved', width: 104, align: 'right', value: r => Number(r.reserved), cell: r => (Number(r.reserved) ? <span className="num">{qty(r.reserved)}</span> : <span className="faint">—</span>) },
      { id: 'available', header: 'Available', width: 108, align: 'right', value: r => Number(r.available), cell: r => <span className="num" style={{ fontWeight: 500 }}>{qty(r.available)}</span> },
      { id: 'avg', header: 'Average cost', width: 124, align: 'right', value: r => Number(r.avgCost), cell: r => <span className="num muted">{money(r.avgCost)}</span> },
      { id: 'value', header: 'Value', width: 132, align: 'right', value: r => Number(r.value), cell: r => <span className="num">{money(r.value)}</span>, total: () => (list.data ? <span className="num" style={{ fontWeight: 600 }}>{money(list.data.value)}</span> : null) },
    ],
    [units.data, list.data],
  );
  const table = useDataTable(columns, { sort: { id: 'name', dir: 1 } });
  const filterFields: FilterField[] = [{ id: 'warehouse', name: 'Warehouse', icon: <WarehouseIcon size={15} />, options: (warehouses.data ?? []).map(w => ({ id: w.id, name: w.name })) }];

  const open = (r: StockBalance) => navigate({ pathname: `/inventory/${r.productId}`, search: sp.toString() });
  const selected = rows.find(r => r.productId === productId);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Inventory</h1>
          <p>Stock by warehouse and product. Documents change it when they are posted.</p>
        </div>
        <div className="acts">
          <Button onClick={() => setHideZero(v => !v)} aria-pressed={!hideZero}>
            {hideZero ? <Eye size={14} /> : <EyeOff size={14} />}
            {hideZero ? 'Show zero stock' : 'Hide zero stock'}
          </Button>
        </div>
      </div>
      <div className="stats" style={{ padding: '0 16px 12px' }}>
        <Stat label="Stock value" value={list.data ? money(list.data.value) : '—'} note="at average cost" />
        <Stat label="Positions" value={list.data?.total ?? '—'} note={wh ? 'in the selected warehouse' : 'across all warehouses'} />
        <Stat label="With reserves" value={reservedRows} note="held for customer orders" />
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: 'Search by product or SKU' }}
        fields={filterFields}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load stock" action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label="Stock balances"
          columns={columns}
          rows={rows}
          table={table}
          getId={r => `${r.warehouseId}:${r.productId}`}
          onRowClick={open}
          showTotals
          empty={
            <EmptyState icon={<Boxes size={20} />} title={filters.count || q ? 'No results found' : 'No stock yet'} action={filters.count || q ? <Button size="sm" onClick={() => (filters.reset(), setQ(''))}>Clear filters</Button> : <Link to="/purchases" className="btn btn-secondary">Go to Purchases</Link>}>
              {filters.count || q ? 'No stock matches these filters.' : 'Post a goods receipt and the items appear here.'}
            </EmptyState>
          }
        />
      )}
      {productId && <ProductCard productId={productId} row={selected} onClose={() => navigate({ pathname: '/inventory', search: sp.toString() })} />}
    </div>
  );
}

/** Карточка товара: остатки по складам и журнал движений с остатком после каждого */
function ProductCard({ productId, row, onClose }: { productId: string; row?: StockBalance; onClose: () => void }) {
  const all = useStockBalances({});
  const moves = useStockMoves(productId);
  const units = useUnits();
  const mine = (all.data?.items ?? []).filter(b => b.productId === productId);
  const first = mine[0] ?? row;
  const total = mine.reduce((s, b) => s + Number(b.qty), 0);
  const value = mine.reduce((s, b) => s + Number(b.value), 0);
  return (
    <EntityDrawer
      label={`Stock card: ${first?.name ?? 'product'}`}
      crumb={<span className="muted">Stock card</span>}
      title={first?.name ?? 'Product'}
      subtitle={
        <span className="muted">
          {first?.sku ? <span className="mono">{first.sku} · </span> : null}
          {qty(String(total))} {first ? unitSymbol(units.data, first.unitCode) : ''} in stock · {money(value)} at average cost
        </span>
      }
      onClose={onClose}
    >
      <DrawerSection title="By warehouse" count={mine.length}>
        {mine.length ? (
          <table className="dtbl" aria-label="Stock by warehouse">
            <thead>
              <tr>
                <th>Warehouse</th>
                <th className="r">On hand</th>
                <th className="r">Reserved</th>
                <th className="r">Avg. cost</th>
              </tr>
            </thead>
            <tbody>
              {mine.map(b => (
                <tr key={b.warehouseId}>
                  <td>{b.warehouseName}</td>
                  <td className="r num">{qty(b.qty)}</td>
                  <td className="r num muted">{Number(b.reserved) ? qty(b.reserved) : '—'}</td>
                  <td className="r num muted">{money(b.avgCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="faint">No stock</p>
        )}
      </DrawerSection>
      <DrawerSection title="Movements" count={moves.data?.length}>
        {moves.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : moves.data?.length ? (
          <table className="dtbl" aria-label="Stock movements">
            <thead>
              <tr>
                <th>Date</th>
                <th>Document</th>
                <th>Warehouse</th>
                <th className="r">Qty</th>
                <th className="r">Cost</th>
                <th className="r">Balance</th>
              </tr>
            </thead>
            <tbody>
              {moves.data.map(m => (
                <tr key={m.id}>
                  <td className="num muted">{fmtDate(parse(m.movedAt))}</td>
                  <td>
                    <Link className="crm-link" to={`/documents/${m.documentId}`} title={typeLabel(m.documentType)}>
                      {m.documentNumber ?? typeLabel(m.documentType)}
                    </Link>
                  </td>
                  <td className="muted trunc">{m.warehouseName}</td>
                  <td className="r num">
                    <Badge tone={Number(m.qty) > 0 ? 'green' : 'amber'}>{Number(m.qty) > 0 ? '+' : ''}{qty(m.qty)}</Badge>
                  </td>
                  <td className="r num muted">{money(m.cost)}</td>
                  <td className="r num">{qty(m.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="faint">No movements yet</p>
        )}
      </DrawerSection>
    </EntityDrawer>
  );
}

