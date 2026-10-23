/* Экран «Documents of processing»: заказы на переработку (мы — переработчик), приём давальческого сырья,
   отчёты о переработке и журнал документов переработки; отдельно — остатки давальцев
   «Stock received for processing» (склад, товар, давалец, заказ). Учёт давальцев только количественный. */
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CircleAlert, FilePlus, PackageSearch } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState } from '@/components/gr8r/filter-bar';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { money, unitSymbol, useUnits } from '../catalog/data';
import { fmtDate, parse } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { JournalPage } from './JournalPage';
import { STATUS_LABEL, STATUS_TONE, useCustomerBalances, useDocsApi, useProcessingOrders, type CustomerBalance, type DocDetail, type ProcessingOrderItem } from './data';

const TABS = [
  { id: 'orders' },
  { id: 'receipts' },
  { id: 'reports' },
  { id: 'journal' },
  { id: 'balances' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const qtyText = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v) || '0';

export function ProcessingPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabId = (TABS.find(t => t.id === raw)?.id ?? 'orders') as TabId;
  const t = useT();
  const setTab = (id: TabId) =>
    setParams(
      p => {
        const n = new URLSearchParams(p);
        n.set('tab', id);
        return n;
      },
      { replace: true },
    );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('docs.processing.title')}</h1>
          <p>{t('docs.processing.lead')}</p>
        </div>
      </div>
      <nav className="tabs doc-tabs" aria-label={t('docs.processing.ariaLabel')}>
        {TABS.map(tt => (
          <button key={tt.id} type="button" className={cn('tab', tab === tt.id && 'on')} aria-current={tab === tt.id ? 'page' : undefined} onClick={() => setTab(tt.id)}>
            {t(`docs.processing.tabs.${tt.id}`)}
          </button>
        ))}
      </nav>
      {tab === 'orders' && <OrdersTab />}
      {tab === 'receipts' && <JournalPage group="tolling" type="tolling_receipt" />}
      {tab === 'reports' && <JournalPage group="tolling" type="tolling_report" />}
      {tab === 'journal' && <JournalPage group="tolling" />}
      {tab === 'balances' && <BalancesTab />}
    </div>
  );
}

/** Заказы на переработку: что сделать и по какой цене, накопленная себестоимость услуги */
function OrdersTab() {
  const navigate = useNavigate();
  const api = useDocsApi();
  const canWrite = useCanWrite();
  const filters = useFilterState();
  const t = useT();
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const tt = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(tt);
  }, [filters.q]);
  const list = useProcessingOrders({ q: q || undefined });
  const rows = list.data?.items ?? [];

  const create = async () => {
    const r = await api<DocDetail>('POST', '/documents', { type: 'customer_order', operation: 'processing' });
    if (r) navigate(`/documents/${r.id}`);
  };

  const columns = React.useMemo<Column<ProcessingOrderItem>[]>(
    () => [
      { id: 'number', header: t('docs.processing.col.number'), width: 150, value: d => d.number ?? '', cell: d => (d.number ? <span className="mono">{d.number}</span> : <span className="faint">{t('docs.processing.draft')}</span>) },
      { id: 'date', header: t('docs.processing.col.date'), width: 112, value: d => d.date, cell: d => <span className="num muted">{fmtDate(parse(d.date))}</span> },
      { id: 'owner', header: t('docs.processing.col.customer'), width: 240, value: d => d.counterpartyName ?? '', cell: d => <span className="trunc">{d.counterpartyName ?? d.ownerName ?? '—'}</span> },
      { id: 'total', header: t('docs.processing.col.servicePrice'), width: 140, align: 'right', value: d => Number(d.total), cell: d => <span className="num">{money(d.total)}</span> },
      {
        id: 'cost',
        header: t('docs.processing.col.serviceCost'),
        width: 150,
        align: 'right',
        defaultHidden: true,
        value: d => Number(d.serviceCost ?? 0),
        cell: d => <span className="num muted">{d.serviceCost === null ? '—' : money(d.serviceCost)}</span>,
      },
      { id: 'status', header: t('common.status'), width: 112, value: d => STATUS_LABEL[d.status], cell: d => <Badge tone={STATUS_TONE[d.status]} dot>{STATUS_LABEL[d.status]}</Badge> },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });

  return (
    <>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('docs.processing.searchPlaceholder') }}
        fields={[]}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('docs.processing.loadError')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label={t('docs.processing.ordersAria')}
          columns={columns}
          rows={rows}
          table={table}
          getId={d => d.id}
          onRowClick={d => navigate(`/documents/${d.id}`)}
          empty={
            <EmptyState
              icon={<FilePlus size={20} />}
              title={t('docs.processing.emptyTitle')}
              action={canWrite ? <Button size="sm" variant="primary" onClick={() => void create()}>{t('docs.processing.newOrder')}</Button> : undefined}
            >
              {t('docs.processing.emptyHint')}
            </EmptyState>
          }
        />
      )}
    </>
  );
}

/** Остатки давальцев: «Stock received for processing» */
function BalancesTab() {
  const units = useUnits();
  const filters = useFilterState();
  const list = useCustomerBalances();
  const rows = list.data ?? [];
  const t = useT();
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const tt = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(tt);
  }, [filters.q]);

  const filtered = React.useMemo(() => {
    const needle = q.toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => `${r.name} ${r.sku} ${r.ownerName}`.toLowerCase().includes(needle));
  }, [rows, q]);

  const columns = React.useMemo<Column<CustomerBalance>[]>(
    () => [
      { id: 'owner', header: t('docs.processing.col.customer'), width: 240, value: r => r.ownerName, cell: r => <span className="trunc">{r.ownerName}</span> },
      { id: 'name', header: t('docs.processing.col.product'), width: 280, value: r => r.name, cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{r.name}</span> },
      { id: 'warehouse', header: t('docs.processing.col.warehouse'), width: 200, value: r => r.warehouseName, cell: r => <span className="trunc muted">{r.warehouseName}</span> },
      { id: 'order', header: t('docs.processing.col.order'), width: 170, value: r => r.processingOrderNumber ?? '', cell: r => (r.processingOrderNumber ? <span className="mono">{r.processingOrderNumber}</span> : <span className="faint">{t('docs.processing.general')}</span>) },
      { id: 'qty', header: t('docs.processing.col.qty'), width: 130, align: 'right', value: r => Number(r.qty), cell: r => <span className="num" style={{ fontWeight: 500 }}>{qtyText(r.qty)} <span className="faint">{unitSymbol(units.data, r.unitCode)}</span></span> },
    ],
    [units.data, t],
  );
  const table = useDataTable(columns, { sort: { id: 'owner', dir: 1 } });

  return (
    <>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('docs.processing.searchBalances') }}
        fields={[]}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('docs.processing.balancesLoadError')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label={t('docs.processing.balancesAria')}
          columns={columns}
          rows={filtered}
          table={table}
          getId={r => `${r.warehouseId}:${r.productId}:${r.ownerCompanyId}:${r.processingOrderId ?? ''}`}
          empty={
            <EmptyState icon={<PackageSearch size={20} />} title={q ? t('docs.processing.emptyBalancesSearch') : t('docs.processing.emptyBalances')}>
              {q ? t('docs.processing.emptyBalancesSearchHint') : t('docs.processing.emptyBalancesHint')}
            </EmptyState>
          }
        />
      )}
    </>
  );
}
