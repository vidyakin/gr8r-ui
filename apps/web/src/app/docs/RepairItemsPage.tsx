/* Изделия в ремонте (задача 1099): принятые от клиентов и не выданные, включая переданные сервис-партнёрам. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { CircleAlert, Wrench } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState } from '@/components/gr8r/filter-bar';
import { useT } from '@/i18n';
import { fmtDate, parse } from '../lib/dates';
import { useRepairItems, type RepairListItem } from './serials-data';

export function RepairItemsPage() {
  const t = useT();
  const navigate = useNavigate();
  const filters = useFilterState();
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const h = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(h);
  }, [filters.q]);
  const scope = filters.values.scope?.[0] ?? '1';
  const list = useRepairItems({ q: q || undefined, open: scope === 'all' ? undefined : (scope as '1' | '0') });
  const rows = list.data?.items ?? [];

  const columns = React.useMemo<Column<RepairListItem>[]>(
    () => [
      { id: 'item', header: t('serials.items.col.item'), width: 240, value: r => r.productName || r.name, cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{r.productName || r.name || '—'}</span> },
      { id: 'serial', header: t('serials.items.col.serial'), width: 170, value: r => r.registrySerial || r.serialText, cell: r => <span className="mono">{r.registrySerial || r.serialText || '—'}</span> },
      { id: 'customer', header: t('serials.items.col.customer'), width: 220, value: r => r.counterpartyName ?? '', cell: r => <span className="trunc muted">{r.counterpartyName ?? '—'}</span> },
      { id: 'order', header: t('serials.items.col.workOrder'), width: 150, value: r => r.documentNumber ?? '', cell: r => <span className="mono">{r.documentNumber ?? '—'}</span> },
      { id: 'kind', header: t('serials.items.col.kind'), width: 160, value: r => r.kindType, cell: r => <Badge tone={r.kindType === 'warranty' ? 'green' : 'neutral'}>{r.kindType === 'warranty' ? t('serials.items.kindType.warranty') : t('serials.items.kindType.repair')}</Badge> },
      { id: 'state', header: t('serials.items.col.state'), width: 140, value: r => r.stateLabel ?? '', cell: r => <span className="muted">{r.stateLabel ?? '—'}</span> },
      { id: 'received', header: t('serials.items.col.received'), width: 112, value: r => r.receivedAt ?? '', cell: r => (r.receivedAt ? <span className="num muted">{fmtDate(parse(r.receivedAt))}</span> : <span className="faint">—</span>) },
      { id: 'returned', header: t('serials.items.col.returned'), width: 112, value: r => r.returnedAt ?? '', cell: r => (r.returnedAt ? <span className="num muted">{fmtDate(parse(r.returnedAt))}</span> : <span className="faint">—</span>) },
      {
        id: 'partner',
        header: t('serials.items.col.partner'),
        width: 220,
        value: r => r.outsourceName ?? '',
        cell: r => (r.atPartner ? <span className="trunc" title={t('serials.items.atPartner', { name: r.outsourceName ?? '—', date: r.outsourcedAt ? fmtDate(parse(r.outsourcedAt)) : '—' })}>{r.outsourceName}</span> : <span className="faint">—</span>),
      },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'received', dir: -1 } });

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('serials.items.title')}</h1>
          <p>{t('serials.items.lead')}</p>
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('serials.items.searchPlaceholder') }}
        fields={[{ id: 'scope', name: t('serials.items.col.state'), icon: <Wrench size={15} />, options: [{ id: '1', name: t('serials.items.open') }, { id: '0', name: t('serials.items.returned') }, { id: 'all', name: t('serials.items.all') }] }]}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('serials.items.loadError')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label={t('serials.items.ariaList')}
          columns={columns}
          rows={rows}
          table={table}
          getId={r => r.id}
          onRowClick={r => navigate(`/documents/${r.documentId}`)}
          empty={
            <EmptyState icon={<Wrench size={20} />} title={t('serials.items.emptyTitle')}>
              {t('serials.items.emptyHint')}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
