/* Партии и сроки годности (задача 1187): остатки партий по складам и товарам, фильтры «истекает в течение N дней» и «просрочено».
   Партия без срока (null) не попадает в истекающие. Количество — производное от движений (сумма по batch_id). */
import * as React from 'react';
import { CircleAlert, PackageSearch } from 'lucide-react';
import type { BatchStatus } from '@gr8r/shared';
import { Badge, Button, EmptyState, Skeleton, type Tone } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState } from '@/components/gr8r/filter-bar';
import { useT } from '@/i18n';
import { fmtNumber } from '@/i18n/format';
import { fmtDate, parse } from '../lib/dates';
import { call, useWsId } from '../meta/data';
import { docsKey } from './data';
import { BatchQualityDialog, BatchStatusBadge } from './batch-quality';
import { useQuery } from '@tanstack/react-query';

export interface BatchItem {
  batchId: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  number: string;
  producedAt: string | null;
  expiresAt: string | null;
  qty: string;
  status: BatchStatus;
}

export function useBatches(params: { warehouseId?: string; productId?: string; days?: number; expired?: boolean; q?: string }, enabled = true) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'batches', params),
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.warehouseId) sp.set('warehouseId', params.warehouseId);
      if (params.productId) sp.set('productId', params.productId);
      if (params.days !== undefined) sp.set('days', String(params.days));
      if (params.expired) sp.set('expired', '1');
      if (params.q) sp.set('q', params.q);
      return call<{ items: BatchItem[]; total: number }>(ws, 'GET', `/stock/batches?${sp}`);
    },
    enabled,
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

/** Срок годности: дата и признак просрочки на сегодня */
function Expiry({ until }: { until: string | null }) {
  const t = useT();
  if (!until) return <span className="faint">—</span>;
  const today = new Date().toISOString().slice(0, 10);
  const soon = until <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const expired = until < today;
  const tone: Tone = expired ? 'red' : soon ? 'amber' : 'gray';
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <span className="num">{fmtDate(parse(until))}</span>
      {(expired || soon) && <Badge tone={tone} dot>{expired ? t('batches.list.expired') : t('batches.list.expiringSoon')}</Badge>}
    </span>
  );
}

export function BatchesPage() {
  const t = useT();
  const filters = useFilterState();
  const [days, setDays] = React.useState<string>('');
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const timer = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(timer);
  }, [filters.q]);
  const expired = filters.values.expired?.[0] === '1';
  const daysNum = days.trim() === '' ? undefined : Math.max(0, Math.round(Number(days) || 0));
  const list = useBatches({ expired, days: daysNum, q: q || undefined });
  const rows = list.data?.items ?? [];
  const [open, setOpen] = React.useState<string | null>(null);
  const opened = rows.find(r => r.batchId === open) ?? null;

  const columns = React.useMemo<Column<BatchItem>[]>(
    () => [
      { id: 'number', header: t('batches.list.number'), width: 160, value: r => r.number, cell: r => <span className="mono" style={{ fontWeight: 450 }}>{r.number}</span> },
      { id: 'product', header: t('batches.list.product'), width: 260, value: r => r.productName, cell: r => <span className="trunc">{r.productName}</span> },
      { id: 'warehouse', header: t('batches.list.warehouse'), width: 170, value: r => r.warehouseName, cell: r => <span className="trunc muted">{r.warehouseName}</span> },
      { id: 'status', header: t('batches.list.status'), width: 130, value: r => r.status, cell: r => <BatchStatusBadge status={r.status} /> },
      { id: 'qty', header: t('batches.list.qty'), width: 110, value: r => Number(r.qty), cell: r => <span className="r num">{fmtNumber(r.qty)}</span> },
      { id: 'producedAt', header: t('batches.list.producedAt'), width: 120, value: r => r.producedAt ?? '', cell: r => (r.producedAt ? <span className="num muted">{fmtDate(parse(r.producedAt))}</span> : <span className="faint">—</span>) },
      { id: 'expiresAt', header: t('batches.list.expiresAt'), width: 190, value: r => r.expiresAt ?? '', cell: r => <Expiry until={r.expiresAt} /> },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'expiresAt', dir: 1 } });

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('batches.list.title')}</h1>
          <p>{t('batches.entry.hint')}</p>
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('batches.list.number') }}
        fields={[
          {
            id: 'expired',
            name: t('batches.list.filterExpired'),
            icon: <PackageSearch size={15} />,
            options: [{ id: '1', name: t('batches.list.expired') }],
          },
        ]}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
        extra={
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 13 }}>{t('batches.list.filterDays')}</span>
            <input className="input" type="number" min={0} style={{ width: 90 }} value={days} onChange={e => setDays(e.target.value)} />
          </label>
        }
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('serials.loadError')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div className="page-body"><Skeleton w="100%" h={36} /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<PackageSearch size={20} />} title={t('batches.list.empty')} />
      ) : (
        <DataTable aria-label={t('batches.list.title')} columns={columns} rows={rows} table={table} getId={r => r.batchId} onRowClick={r => setOpen(r.batchId)} empty={<EmptyState icon={<PackageSearch size={20} />} title={t('batches.list.empty')} />} />
      )}
      {opened && <BatchQualityDialog batch={opened} onClose={() => setOpen(null)} />}
    </div>
  );
}
