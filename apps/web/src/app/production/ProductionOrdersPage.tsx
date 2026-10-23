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
import { STATE_TONE, useProductionOrderApi, useProductionOrders, type ProductionOrderListItem } from './orders-data';
import { tEnum, tProductionEnum, useT } from '@/i18n';

export function ProductionOrdersPage() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const canWrite = useCanWrite();
  const api = useProductionOrderApi();
  const tt = useT();
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
    { id: 'number', header: tt('production.field.number'), width: 150, value: d => d.number ?? '', cell: d => (d.number ? <span className="mono" style={{ fontWeight: 450 }}>{d.number}</span> : <span className="faint">{tt('production.common.draft')}</span>) },
    { id: 'date', header: tt('production.field.date'), width: 112, value: d => d.date, cell: d => <span className="num muted">{fmtDate(parse(d.date))}</span> },
    { id: 'state', header: tt('production.field.state'), width: 130, value: d => d.state ?? '', cell: d => (d.state ? <Badge tone={STATE_TONE[d.state] ?? 'gray'}>{tProductionEnum('productionOrderState', d.state, d.state)}</Badge> : <span className="faint">—</span>) },
    { id: 'center', header: tt('production.field.workCenter'), width: 190, value: d => d.workCenterName ?? '', cell: d => <span className="trunc muted">{d.workCenterName ?? '—'}</span> },
    { id: 'planned', header: tt('production.field.plannedStart'), width: 200, defaultHidden: true, value: d => d.plannedStart ?? '', cell: d => <span className="num muted">{d.plannedStart ? fmtDate(new Date(d.plannedStart)) : '—'}</span> },
    { id: 'items', header: tt('production.orders.col.items'), width: 90, align: 'right', value: d => d.itemCount },
    { id: 'status', header: tt('production.field.status'), width: 112, value: d => STATUS_LABEL[d.status], cell: d => <Badge tone={STATUS_TONE[d.status]} dot>{tEnum('docStatus', d.status, STATUS_LABEL[d.status])}</Badge> },
  ];
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });

  const filterFields: FilterField[] = [
    {
      id: 'state',
      name: tt('production.field.state'),
      icon: <ClipboardList size={15} />,
      options: (['planned', 'in_progress', 'done', 'closed'] as const).map(id => ({ id, name: tProductionEnum('productionOrderState', id, id) })),
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
          <h1>{tt('production.section.orders')}</h1>
          <p>{tt('production.orders.subtitle')}</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button variant="primary" onClick={() => void create()}>
              <Plus size={14} />
              {tt('production.orders.newOrder')}
            </Button>
          )}
        </div>
      </div>
      <nav className="tabs doc-tabs" aria-label={tt('production.orders.col.state')}>
        <button type="button" className={`tab${!state ? ' on' : ''}`} aria-current={!state ? 'page' : undefined} onClick={() => setState(null)}>
          {tt('common.all')}
        </button>
        {(['planned', 'in_progress', 'done', 'closed'] as const).map(key => (
          <button key={key} type="button" className={`tab${state === key ? ' on' : ''}`} aria-current={state === key ? 'page' : undefined} onClick={() => setState(key)}>
            {tProductionEnum('productionOrderState', key, key)}
          </button>
        ))}
      </nav>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: tt('production.orders.searchPlaceholder') }}
        fields={filterFields}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('production.orders.loadFailed')} action={<Button size="sm" onClick={() => list.refetch()}>{tt('production.common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<Factory size={20} />} title={tt('production.orders.noOrders')} action={canWrite ? <Button size="sm" onClick={() => void create()}>{tt('production.orders.newOrder')}</Button> : undefined}>
          {tt('production.orders.noOrdersHint')}
        </EmptyState>
      ) : (
        <DataTable
          aria-label={tt('production.orders.table')}
          columns={columns}
          rows={rows}
          table={table}
          getId={d => d.id}
          onRowClick={d => navigate(`/production/orders/${d.id}`)}
          showTotals={false}
          empty={
            <EmptyState icon={<CircleAlert size={20} />} title={tt('production.orders.noMatch')} action={<Button size="sm" onClick={() => (filters.reset(), setState(null))}>{tt('common.clearFilters')}</Button>}>
              {tt('production.orders.noMatch')}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
