/* Журнал документов продаж или закупок: вкладки по типам, фильтры (статус, организация), поиск по номеру, контрагенту и комментарию,
   суммы по выборке. Новый документ создаётся черновиком сразу и открывается в форме. */
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CircleAlert, FilePlus, FileText, Plus, CircleDot, Building2 } from 'lucide-react';
import { DOCUMENT_META, documentTypesOf, type DocumentGroup, type DocumentType } from '@gr8r/shared';
import { Badge, Button, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { cn } from '@/lib/utils';
import { useCanWrite } from '../meta/custom-fields';
import { money } from '../catalog/data';
import { fmtDate, parse } from '../lib/dates';
import { STATUS_LABEL, STATUS_TONE, typeLabel, useDocsApi, useDocuments, useOrganizations, type DocDetail, type DocListItem } from './data';

const TITLES: Record<DocumentGroup, { title: string; lead: string }> = {
  sales: { title: 'Sales', lead: 'Quotes, customer orders, invoices, shipments (UPD), service acts and returns.' },
  purchases: { title: 'Purchases', lead: 'Supplier orders, goods receipts and returns to suppliers.' },
  stock: { title: 'Stock documents', lead: 'Transfers between warehouses, write-offs and postings. The amount shown is the cost at average price.' },
  production: { title: 'Production', lead: 'Production orders and releases. The amount shown is the cost at average price.' },
};

export function JournalPage({ group }: { group: DocumentGroup }) {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const canWrite = useCanWrite();
  const api = useDocsApi();
  const orgs = useOrganizations();
  const filters = useFilterState();
  const types = documentTypesOf(group);
  const typeParam = sp.get('type') as DocumentType | null;
  const type = typeParam && types.includes(typeParam) ? typeParam : null;
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  const status = filters.values.status ?? [];
  const org = (filters.values.org ?? [])[0];
  const list = useDocuments({ group: type ? undefined : group, type: type ?? undefined, status: status.length ? status : undefined, organizationId: org, q: q || undefined });
  const rows = list.data?.items ?? [];
  const sum = list.data?.sum;

  const setType = (t: DocumentType | null) =>
    setSp(
      p => {
        const n = new URLSearchParams(p);
        if (t) n.set('type', t);
        else n.delete('type');
        return n;
      },
      { replace: true },
    );

  const create = async (t: DocumentType) => {
    const r = await api<DocDetail>('POST', '/documents', { type: t });
    if (r) navigate(`/documents/${r.id}`);
  };

  // складские документы: вместо контрагента — склады, вместо сумм — стоимость по себестоимости
  const stockCols: Column<DocListItem>[] = [
    { id: 'warehouse', header: 'From warehouse', width: 170, value: d => d.warehouseName ?? '', cell: d => <span className="trunc muted">{d.warehouseName ?? '—'}</span> },
    { id: 'target', header: 'To warehouse', width: 170, value: d => d.targetWarehouseName ?? '', cell: d => <span className="trunc muted">{d.targetWarehouseName ?? '—'}</span> },
  ];
  const partyCols: Column<DocListItem>[] = [
    { id: 'counterparty', header: DOCUMENT_META[types[0]!].party === 'customer' ? 'Customer' : 'Supplier', width: 260, value: d => d.counterpartyName ?? '', cell: d => (d.counterpartyName ? <span className="trunc">{d.counterpartyName}</span> : <span className="faint">—</span>) },
    { id: 'warehouse', header: 'Warehouse', width: 170, defaultHidden: true, value: d => d.warehouseName ?? '', cell: d => <span className="trunc muted">{d.warehouseName ?? '—'}</span> },
  ];
  const costCol: Column<DocListItem> = { id: 'cost', header: 'Cost', width: 140, align: 'right', value: d => Number(d.costTotal ?? 0), cell: d => <span className="num" style={{ fontWeight: 500 }}>{d.costTotal === null || d.costTotal === undefined ? '—' : money(d.costTotal)}</span>, total: () => (sum?.cost ? <span className="num" style={{ fontWeight: 600 }}>{money(sum.cost)}</span> : null) };
  const sumCols: Column<DocListItem>[] = [
    { id: 'net', header: 'Without VAT', width: 124, align: 'right', defaultHidden: true, value: d => Number(d.amountNet), cell: d => <span className="num muted">{money(d.amountNet)}</span>, total: () => (sum ? <span className="num">{money(sum.net)}</span> : null) },
    { id: 'vat', header: 'VAT', width: 110, align: 'right', value: d => Number(d.vatTotal), cell: d => <span className="num muted">{money(d.vatTotal)}</span>, total: () => (sum ? <span className="num">{money(sum.vat)}</span> : null) },
    { id: 'total', header: 'Total', width: 132, align: 'right', value: d => Number(d.total), cell: d => <span className="num" style={{ fontWeight: 500 }}>{money(d.total)}</span>, total: () => (sum ? <span className="num" style={{ fontWeight: 600 }}>{money(sum.total)}</span> : null) },
  ];

  const columns: Column<DocListItem>[] = [
    { id: 'number', header: 'Number', width: 150, value: d => d.number ?? '', cell: d => (d.number ? <span className="mono" style={{ fontWeight: 450 }}>{d.number}</span> : <span className="faint">Draft</span>) },
    { id: 'type', header: 'Type', width: 150, value: d => typeLabel(d.type), cell: d => <span className="muted">{typeLabel(d.type)}</span> },
    { id: 'date', header: 'Date', width: 112, value: d => d.date, cell: d => <span className="num muted">{fmtDate(parse(d.date))}</span> },
    ...(group === 'stock' ? stockCols : partyCols),
    { id: 'org', header: 'Organization', width: 190, defaultHidden: true, value: d => d.organizationName, cell: d => <span className="trunc muted">{d.organizationName}</span> },
    { id: 'status', header: 'Status', width: 112, value: d => STATUS_LABEL[d.status], cell: d => <Badge tone={STATUS_TONE[d.status]} dot>{STATUS_LABEL[d.status]}</Badge> },
    ...(group === 'stock' ? [costCol] : sumCols),
  ];
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });

  const filterFields: FilterField[] = [
    { id: 'status', name: 'Status', icon: <CircleDot size={15} />, options: [{ id: 'draft', name: 'Draft' }, { id: 'posted', name: 'Posted' }, { id: 'cancelled', name: 'Cancelled' }] },
    ...((orgs.data?.length ?? 0) > 1 ? [{ id: 'org', name: 'Organization', icon: <Building2 size={15} />, options: (orgs.data ?? []).map(o => ({ id: o.id, name: o.name })) }] : []),
  ];

  const newMenu = canWrite && (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="primary">
          <Plus size={14} />
          New document
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        {types.map(t => (
          <MenuItem key={t} icon={<FilePlus size={15} />} onSelect={() => void create(t)}>
            {typeLabel(t)}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
  const head = TITLES[group];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{head.title}</h1>
          <p>{head.lead}</p>
        </div>
        <div className="acts">{newMenu}</div>
      </div>
      <nav className="tabs doc-tabs" aria-label={`${head.title} document types`}>
        <button type="button" className={cn('tab', !type && 'on')} aria-current={!type ? 'page' : undefined} onClick={() => setType(null)}>
          All
        </button>
        {types.map(t => (
          <button key={t} type="button" className={cn('tab', type === t && 'on')} aria-current={type === t ? 'page' : undefined} onClick={() => setType(t)}>
            {typeLabel(t)}
          </button>
        ))}
      </nav>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: group === 'stock' ? 'Search by number or comment' : 'Search by number, customer or comment' }}
        fields={filterFields}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load documents" action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length && !filters.count && !q ? (
        <EmptyState icon={<FileText size={20} />} title={type ? `No ${typeLabel(type).toLowerCase()} documents yet` : `No ${head.title.toLowerCase()} documents yet`} action={newMenu || undefined}>
          Documents you create show up here with their status and totals.
        </EmptyState>
      ) : (
        <>
          <DataTable
            aria-label={`${head.title} journal`}
            columns={columns}
            rows={rows}
            table={table}
            getId={d => d.id}
            onRowClick={d => navigate(`/documents/${d.id}`)}
            showTotals={rows.length > 0}
            totalLabel="Total"
            empty={
              <EmptyState icon={<CircleAlert size={20} />} title="No results found" action={<Button size="sm" onClick={() => (filters.reset(), setQ(''))}>Clear filters</Button>}>
                No documents match these filters.
              </EmptyState>
            }
          />
          <p className="faint" style={{ padding: '8px 16px', fontSize: 12 }}>
            {group === 'stock' ? 'The cost is the average cost of the goods moved. Only admins and owners see it.' : 'Totals do not include cancelled documents.'}
            {list.data && list.data.total > rows.length && ` Showing the latest ${rows.length} of ${list.data.total} documents: narrow the list with filters or search.`}
          </p>
        </>
      )}
    </div>
  );
}
