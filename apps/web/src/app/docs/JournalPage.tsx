/* Журнал документов продаж или закупок: вкладки по типам, фильтры (статус, организация), поиск по номеру, контрагенту и комментарию,
   суммы по выборке. Новый документ создаётся черновиком сразу и открывается в форме. */
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CircleAlert, FilePlus, FileText, Plus, CircleDot, Building2 } from 'lucide-react';
import { DOCUMENT_META, documentTypesOf, type DocumentGroup, type DocumentType } from '@gr8r/shared';
import { Badge, Button, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { useCanWrite } from '../meta/custom-fields';
import { money } from '../catalog/data';
import { PayBadge } from '../money/PayControls';
import { fmtDate, parse } from '../lib/dates';
import { STATUS_LABEL, STATUS_TONE, typeLabel, useDocsApi, useDocuments, useOrganizations, type DocDetail, type DocListItem } from './data';


/** Журнал группы документов; `type` открывает сразу один тип (вкладка экрана переработки) */
export function JournalPage({ group, type: fixed }: { group: DocumentGroup; type?: DocumentType }) {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const canWrite = useCanWrite();
  const api = useDocsApi();
  const orgs = useOrganizations();
  const filters = useFilterState();
  const t = useT();
  const types = documentTypesOf(group);
  const typeParam = sp.get('type') as DocumentType | null;
  const type = fixed ?? (typeParam && types.includes(typeParam) ? typeParam : null);
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const tt = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(tt);
  }, [filters.q]);

  const status = filters.values.status ?? [];
  const org = (filters.values.org ?? [])[0];
  const list = useDocuments({ group: type ? undefined : group, type: type ?? undefined, status: status.length ? status : undefined, organizationId: org, q: q || undefined });
  const rows = list.data?.items ?? [];
  const sum = list.data?.sum;

  const setType = (tt: DocumentType | null) =>
    setSp(
      p => {
        const n = new URLSearchParams(p);
        if (tt) n.set('type', tt);
        else n.delete('type');
        return n;
      },
      { replace: true },
    );

  const create = async (tt: DocumentType) => {
    const r = await api<DocDetail>('POST', '/documents', { type: tt });
    if (r) navigate(`/documents/${r.id}`);
  };

  // складские документы: вместо контрагента — склады, вместо сумм — стоимость по себестоимости
  const stockCols: Column<DocListItem>[] = [
    { id: 'warehouse', header: t('docs.journal.col.fromWarehouse'), width: 170, value: d => d.warehouseName ?? '', cell: d => <span className="trunc muted">{d.warehouseName ?? '—'}</span> },
    { id: 'target', header: t('docs.journal.col.toWarehouse'), width: 170, value: d => d.targetWarehouseName ?? '', cell: d => <span className="trunc muted">{d.targetWarehouseName ?? '—'}</span> },
  ];
  const partyCols: Column<DocListItem>[] = [
    { id: 'counterparty', header: DOCUMENT_META[types[0]!].party === 'customer' ? t('docs.journal.col.customer') : t('docs.journal.col.supplier'), width: 260, value: d => d.counterpartyName ?? '', cell: d => (d.counterpartyName ? <span className="trunc">{d.counterpartyName}</span> : <span className="faint">—</span>) },
    { id: 'warehouse', header: t('docs.journal.col.warehouse'), width: 170, defaultHidden: true, value: d => d.warehouseName ?? '', cell: d => <span className="trunc muted">{d.warehouseName ?? '—'}</span> },
  ];
  const costCol: Column<DocListItem> = { id: 'cost', header: t('docs.journal.col.cost'), width: 140, align: 'right', value: d => Number(d.costTotal ?? 0), cell: d => <span className="num" style={{ fontWeight: 500 }}>{d.costTotal === null || d.costTotal === undefined ? '—' : money(d.costTotal)}</span>, total: () => (sum?.cost ? <span className="num" style={{ fontWeight: 600 }}>{money(sum.cost)}</span> : null) };
  const sumCols: Column<DocListItem>[] = [
    { id: 'net', header: t('docs.journal.col.net'), width: 124, align: 'right', defaultHidden: true, value: d => Number(d.amountNet), cell: d => <span className="num muted">{money(d.amountNet)}</span>, total: () => (sum ? <span className="num">{money(sum.net)}</span> : null) },
    { id: 'vat', header: t('docs.journal.col.vat'), width: 110, align: 'right', value: d => Number(d.vatTotal), cell: d => <span className="num muted">{money(d.vatTotal)}</span>, total: () => (sum ? <span className="num">{money(sum.vat)}</span> : null) },
    { id: 'total', header: t('docs.journal.col.total'), width: 132, align: 'right', value: d => Number(d.total), cell: d => <span className="num" style={{ fontWeight: 500 }}>{money(d.total)}</span>, total: () => (sum ? <span className="num" style={{ fontWeight: 600 }}>{money(sum.total)}</span> : null) },
  ];

  const columns: Column<DocListItem>[] = [
    { id: 'number', header: t('docs.journal.col.number'), width: 150, value: d => d.number ?? '', cell: d => (d.number ? <span className="mono" style={{ fontWeight: 450 }}>{d.number}</span> : <span className="faint">{t('docs.journal.draft')}</span>) },
    { id: 'type', header: t('docs.journal.col.type'), width: 150, value: d => typeLabel(d.type), cell: d => <span className="muted">{typeLabel(d.type)}</span> },
    { id: 'date', header: t('docs.journal.col.date'), width: 112, value: d => d.date, cell: d => <span className="num muted">{fmtDate(parse(d.date))}</span> },
    ...(group === 'stock' ? stockCols : partyCols),
    { id: 'org', header: t('docs.journal.col.org'), width: 190, defaultHidden: true, value: d => d.organizationName, cell: d => <span className="trunc muted">{d.organizationName}</span> },
    ...(group === 'sales' || group === 'purchases'
      ? [{ id: 'payment', header: t('docs.journal.col.payment'), width: 150, value: (d: DocListItem) => (d.payment ? (d.payment.prepaid ? 'prepaid' : d.payment.state) : ''), cell: (d: DocListItem) => (d.payment ? <PayBadge s={d.payment} compact /> : <span className="faint">—</span>) } satisfies Column<DocListItem>]
      : []),
    { id: 'status', header: t('common.status'), width: 112, value: d => STATUS_LABEL[d.status], cell: d => <Badge tone={STATUS_TONE[d.status]} dot>{STATUS_LABEL[d.status]}</Badge> },
    ...(group === 'stock' ? [costCol] : sumCols),
  ];
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });

  const filterFields: FilterField[] = [
    { id: 'status', name: t('common.status'), icon: <CircleDot size={15} />, options: [{ id: 'draft', name: t('docs.status.draft') }, { id: 'posted', name: t('docs.status.posted') }, { id: 'cancelled', name: t('docs.status.cancelled') }] },
    ...((orgs.data?.length ?? 0) > 1 ? [{ id: 'org', name: t('docs.journal.col.org'), icon: <Building2 size={15} />, options: (orgs.data ?? []).map(o => ({ id: o.id, name: o.name })) }] : []),
  ];

  const newMenu = canWrite && (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="primary">
          <Plus size={14} />
          {t('docs.journal.newDocument')}
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        {types.filter(tt => !DOCUMENT_META[tt].own).map(tt => (
          <MenuItem key={tt} icon={<FilePlus size={15} />} onSelect={() => void create(tt)}>
            {typeLabel(tt)}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
  const head = { title: t(`docs.journalHead.${group}.title`), lead: t(`docs.journalHead.${group}.lead`) };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{head.title}</h1>
          <p>{head.lead}</p>
        </div>
        <div className="acts">{newMenu}</div>
      </div>
      <nav className="tabs doc-tabs" aria-label={t('docs.journal.typesAria', { title: head.title })}>
        {!fixed && (
        <button type="button" className={cn('tab', !type && 'on')} aria-current={!type ? 'page' : undefined} onClick={() => setType(null)}>
          {t('docs.journal.allTypes')}
        </button>
        )}
        {types.map(tt => (
          <button key={tt} type="button" className={cn('tab', type === tt && 'on')} aria-current={type === tt ? 'page' : undefined} onClick={() => setType(tt)}>
            {typeLabel(tt)}
          </button>
        ))}
      </nav>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: group === 'stock' ? t('docs.journal.searchStock') : t('docs.journal.searchParty') }}
        fields={filterFields}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('docs.journal.loadError')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length && !filters.count && !q ? (
        <EmptyState icon={<FileText size={20} />} title={type ? t('docs.journal.emptyByType', { type: typeLabel(type).toLowerCase() }) : t('docs.journal.emptyByGroup', { group: head.title.toLowerCase() })} action={newMenu || undefined}>
          {t('docs.journal.emptyHint')}
        </EmptyState>
      ) : (
        <>
          <DataTable
            aria-label={t('docs.journal.journalAria', { title: head.title })}
            columns={columns}
            rows={rows}
            table={table}
            getId={d => d.id}
            onRowClick={d => navigate(d.type === 'service_day' ? `/crm/appointments/day/${d.id}` : `/documents/${d.id}`)}
            showTotals={rows.length > 0}
            totalLabel={t('ui.total')}
            empty={
              <EmptyState icon={<CircleAlert size={20} />} title={t('common.noResults')} action={<Button size="sm" onClick={() => (filters.reset(), setQ(''))}>{t('common.clearFilters')}</Button>}>
                {t('docs.journal.emptyFilteredHint')}
              </EmptyState>
            }
          />
          <p className="faint" style={{ padding: '8px 16px', fontSize: 12 }}>
            {group === 'stock' ? t('docs.journal.costHint') : t('docs.journal.totalHint')}
            {list.data && list.data.total > rows.length && t('docs.journal.moreHint', { shown: rows.length, total: list.data.total })}
          </p>
        </>
      )}
    </div>
  );
}
