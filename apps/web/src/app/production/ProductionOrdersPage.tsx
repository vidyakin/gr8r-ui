/* Журнал заказов на производство: состояние, плановые сроки и участок. Заказ создаётся кнопкой и открывается в карточке. */
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CircleAlert, ClipboardList, Factory, Plus } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { fmtDate, parse } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { STATUS_LABEL, STATUS_TONE } from '../docs/data';
import { STATE_LABEL, STATE_TONE, useProductionOrderApi, useProductionOrders, type ProductionOrderListItem } from './orders-data';

export function ProductionOrdersPage() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const canWrite = useCanWrite();
  const api = useProductionOrderApi();
  const filters = useFilterState();
  const state = sp.get('state') ?? undefined;
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  const list = useProductionOrders({ state, q: q || undefined });
  const rows = list.data?.items ?? [];

  const setState = (s: string | null) =>
    setSp(
      p => {
        const n = new URLSearchParams(p);
        if (s) n.set('state', s);
        else n.delete('state');
        return n;
      },
      { replace: true },
    );

  const columns: Column<ProductionOrderListItem>[] = [
    { id: 'number', header: 'Number', width: 150, value: d => d.number ?? '', cell: d => (d.number ? <span className="mono" style={{ fontWeight: 450 }}>{d.number}</span> : <span className="faint">Draft</span>) },
    { id: 'date', header: 'Date', width: 112, value: d => d.date, cell: d => <span className="num muted">{fmtDate(parse(d.date))}</span> },
    { id: 'state', header: 'State', width: 130, value: d => d.state ?? '', cell: d => (d.state ? <Badge tone={STATE_TONE[d.state] ?? 'gray'}>{STATE_LABEL[d.state] ?? d.state}</Badge> : <span className="faint">—</span>) },
    { id: 'center', header: 'Work center', width: 190, value: d => d.workCenterName ?? '', cell: d => <span className="trunc muted">{d.workCenterName ?? '—'}</span> },
    { id: 'planned', header: 'Planned', width: 200, defaultHidden: true, value: d => d.plannedStart ?? '', cell: d => <span className="num muted">{d.plannedStart ? fmtDate(new Date(d.plannedStart)) : '—'}</span> },
    { id: 'items', header: 'Products', width: 90, align: 'right', value: d => d.itemCount },
    { id: 'status', header: 'Status', width: 112, value: d => STATUS_LABEL[d.status], cell: d => <Badge tone={STATUS_TONE[d.status]} dot>{STATUS_LABEL[d.status]}</Badge> },
  ];
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });

  const filterFields: FilterField[] = [
    {
      id: 'state',
      name: 'State',
      icon: <ClipboardList size={15} />,
      options: Object.entries(STATE_LABEL).map(([id, name]) => ({ id, name })),
    },
  ];

  const create = async () => {
    const r = await api.create.mutateAsync({ items: [] });
    if (r) navigate(`/production/orders/${r.id}`);
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Production orders</h1>
          <p>What to produce, when and where. The bill of materials is copied into the order and released as a production document.</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button variant="primary" onClick={() => void create()}>
              <Plus size={14} />
              New order
            </Button>
          )}
        </div>
      </div>
      <nav className="tabs doc-tabs" aria-label="Order states">
        <button type="button" className={`tab${!state ? ' on' : ''}`} aria-current={!state ? 'page' : undefined} onClick={() => setState(null)}>
          All
        </button>
        {Object.entries(STATE_LABEL).map(([key, label]) => (
          <button key={key} type="button" className={`tab${state === key ? ' on' : ''}`} aria-current={state === key ? 'page' : undefined} onClick={() => setState(key)}>
            {label}
          </button>
        ))}
      </nav>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: 'Search by comment' }}
        fields={filterFields}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load production orders" action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<Factory size={20} />} title="No production orders yet" action={canWrite ? <Button size="sm" onClick={() => void create()}>Create an order</Button> : undefined}>
          A production order says what to make, how much and by when. Release it into a production document when the materials are ready.
        </EmptyState>
      ) : (
        <DataTable
          aria-label="Production orders"
          columns={columns}
          rows={rows}
          table={table}
          getId={d => d.id}
          onRowClick={d => navigate(`/production/orders/${d.id}`)}
          showTotals={false}
          empty={
            <EmptyState icon={<CircleAlert size={20} />} title="No results found" action={<Button size="sm" onClick={() => (filters.reset(), setState(null))}>Clear filters</Button>}>
              No orders match these filters.
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
