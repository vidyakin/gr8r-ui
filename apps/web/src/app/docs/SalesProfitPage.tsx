/* Отчёт P&L «Валовая прибыль продаж» и ABC-анализ (задача 1390).
   Две вкладки: валовая прибыль с группировками и ABC-анализ по выручке или прибыли с настраиваемыми порогами и экспортом XLSX. */
import * as React from 'react';
import { CircleAlert, Download, TrendingUp } from 'lucide-react';
import { SALES_PROFIT_GROUP_BY, type SalesProfitGroupBy } from '@erp/shared';
import { Badge, Button, EmptyState, Skeleton, toast, type Tone } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/erp/data-table';
import { FilterBar, useFilterState } from '@/components/erp/filter-bar';
import { DateInput } from '@/components/erp/date-picker';
import { Stat } from '@/components/erp/panel';
import { useT } from '@/i18n';
import { fmtAmount, fmtNumber } from '@/i18n/format';
import { useWsId } from '../meta/data';
import { useOrganizations, useWarehouses } from './data';
import { downloadSalesReportXlsx, useSalesAbc, useSalesProfit, type SalesAbcItem, type SalesProfitItem } from './sales-profit-data';

const ABC_TONE: Record<'A' | 'B' | 'C', Tone> = { A: 'green', B: 'amber', C: 'gray' };

const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

export function SalesProfitPage() {
  const t = useT();
  const ws = useWsId();
  const filters = useFilterState();
  const warehouses = useWarehouses();
  const organizations = useOrganizations();
  const today = new Date().toISOString().slice(0, 10);

  const [tab, setTab] = React.useState<'profit' | 'abc'>('profit');
  const [dateFrom, setDateFrom] = React.useState(monthStart);
  const [dateTo, setDateTo] = React.useState(today);
  const [groupBy, setGroupBy] = React.useState<SalesProfitGroupBy>('product');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [organizationId, setOrganizationId] = React.useState('');
  const [metric, setMetric] = React.useState<'revenue' | 'profit'>('revenue');
  const [thresholdA, setThresholdA] = React.useState(80);
  const [thresholdB, setThresholdB] = React.useState(15);
  const [exporting, setExporting] = React.useState(false);
  const [q, setQ] = React.useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => setQ(filters.q.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [filters.q]);

  const baseParams = React.useMemo(
    () => ({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, groupBy, warehouseId: warehouseId || undefined, organizationId: organizationId || undefined }),
    [dateFrom, dateTo, groupBy, warehouseId, organizationId],
  );
  const validThresholds = thresholdA >= 0 && thresholdB >= 0 && thresholdA + thresholdB <= 100;
  const abcParams = React.useMemo(() => ({ ...baseParams, metric, thresholdA, thresholdB }), [baseParams, metric, thresholdA, thresholdB]);

  const profitQuery = useSalesProfit(baseParams, tab === 'profit');
  const abcQuery = useSalesAbc(abcParams, tab === 'abc' && validThresholds);
  const active = tab === 'profit' ? profitQuery : abcQuery;
  const costVisible = profitQuery.data?.costVisible ?? abcQuery.data?.costVisible ?? false;

  React.useEffect(() => {
    if (!costVisible && metric === 'profit') setMetric('revenue');
  }, [costVisible, metric]);

  const labelOf = React.useCallback((r: SalesProfitItem) => r.groupName || t('docs.salesProfit.unassigned'), [t]);

  const profitRows = React.useMemo(
    () => (profitQuery.data?.items ?? []).filter(r => !q || labelOf(r).toLowerCase().includes(q)),
    [profitQuery.data, q, labelOf],
  );
  const abcRows = React.useMemo(
    () => (abcQuery.data?.items ?? []).filter(r => !q || labelOf(r).toLowerCase().includes(q)),
    [abcQuery.data, q, labelOf],
  );

  const profitColumns = React.useMemo<Column<SalesProfitItem>[]>(() => {
    const cols: Column<SalesProfitItem>[] = [
      { id: 'group', header: t(`docs.salesProfit.group.${groupBy}`), width: 280, value: r => labelOf(r), cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{labelOf(r)}</span> },
      { id: 'revenue', header: t('docs.salesProfit.col.revenue'), width: 140, align: 'right', value: r => Number(r.revenue), cell: r => <span className="num">{fmtAmount(r.revenue)}</span> },
      { id: 'discount', header: t('docs.salesProfit.col.discount'), width: 130, align: 'right', value: r => Number(r.discount), cell: r => <span className="num muted">{fmtAmount(r.discount)}</span> },
    ];
    if (costVisible) {
      cols.push(
        { id: 'cogs', header: t('docs.salesProfit.col.cogs'), width: 140, align: 'right', value: r => Number(r.cogs ?? 0), cell: r => <span className="num">{fmtAmount(r.cogs)}</span> },
        { id: 'grossProfit', header: t('docs.salesProfit.col.grossProfit'), width: 140, align: 'right', value: r => Number(r.grossProfit ?? 0), cell: r => <span className="num" style={{ fontWeight: 500 }}>{fmtAmount(r.grossProfit)}</span> },
        { id: 'grossMarginPct', header: t('docs.salesProfit.col.grossMarginPct'), width: 120, align: 'right', value: r => Number(r.grossMarginPct ?? -999999), cell: r => (r.grossMarginPct === null ? <span className="faint">—</span> : <span className="num">{`${fmtNumber(r.grossMarginPct)}%`}</span>) },
      );
    }
    return cols;
  }, [t, groupBy, costVisible, labelOf]);

  const abcColumns = React.useMemo<Column<SalesAbcItem>[]>(() => {
    const cols: Column<SalesAbcItem>[] = [
      { id: 'abcClass', header: t('docs.salesProfit.col.abcClass'), width: 84, value: r => r.abcClass, cell: r => <Badge tone={ABC_TONE[r.abcClass]}>{r.abcClass}</Badge> },
      { id: 'group', header: t(`docs.salesProfit.group.${groupBy}`), width: 260, value: r => labelOf(r), cell: r => <span className="trunc" style={{ fontWeight: 450 }}>{labelOf(r)}</span> },
      { id: 'revenue', header: t('docs.salesProfit.col.revenue'), width: 135, align: 'right', value: r => Number(r.revenue), cell: r => <span className="num">{fmtAmount(r.revenue)}</span> },
    ];
    if (costVisible) {
      cols.push({ id: 'grossProfit', header: t('docs.salesProfit.col.grossProfit'), width: 135, align: 'right', value: r => Number(r.grossProfit ?? 0), cell: r => <span className="num" style={{ fontWeight: 500 }}>{fmtAmount(r.grossProfit)}</span> });
    }
    cols.push(
      { id: 'contributionPct', header: t('docs.salesProfit.col.sharePct'), width: 115, align: 'right', value: r => Number(r.contributionPct), cell: r => <span className="num">{`${fmtNumber(r.contributionPct)}%`}</span> },
      { id: 'cumulativePct', header: t('docs.salesProfit.col.cumulativePct'), width: 125, align: 'right', value: r => Number(r.cumulativePct), cell: r => <span className="num muted">{`${fmtNumber(r.cumulativePct)}%`}</span> },
    );
    return cols;
  }, [t, groupBy, costVisible, labelOf]);

  const profitTable = useDataTable(profitColumns, { sort: { id: 'revenue', dir: -1 } });
  const abcTable = useDataTable(abcColumns, { sort: { id: 'cumulativePct', dir: 1 } });

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadSalesReportXlsx(ws, tab, baseParams, abcParams);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const totals = profitQuery.data?.totals;
  const abcSummary = abcQuery.data?.summary;
  const thresholdC = Math.max(0, Math.round((100 - thresholdA - thresholdB) * 100) / 100);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('docs.salesProfit.title')}</h1>
          <p>{t('docs.salesProfit.lead')}</p>
        </div>
        <div className="acts">
          <Button variant={tab === 'profit' ? 'primary' : 'secondary'} aria-pressed={tab === 'profit'} onClick={() => setTab('profit')}>
            {t('docs.salesProfit.tabProfit')}
          </Button>
          <Button variant={tab === 'abc' ? 'primary' : 'secondary'} aria-pressed={tab === 'abc'} onClick={() => setTab('abc')}>
            {t('docs.salesProfit.tabAbc')}
          </Button>
          <Button disabled={exporting || (tab === 'abc' && !validThresholds)} onClick={() => void handleExport()}>
            <Download size={14} />
            {t('docs.salesProfit.exportXlsx')}
          </Button>
        </div>
      </div>

      {tab === 'profit' ? (
        <div className="stats" style={{ padding: '0 16px 12px' }}>
          <Stat label={t('docs.salesProfit.col.revenue')} value={totals ? fmtAmount(totals.revenue) : '—'} note={undefined} />
          <Stat label={t('docs.salesProfit.col.discount')} value={totals ? fmtAmount(totals.discount) : '—'} note={undefined} />
          {costVisible && <Stat label={t('docs.salesProfit.col.cogs')} value={totals ? fmtAmount(totals.cogs) : '—'} note={undefined} />}
          {costVisible && <Stat label={t('docs.salesProfit.col.grossProfit')} value={totals ? fmtAmount(totals.grossProfit) : '—'} note={undefined} />}
          {costVisible && <Stat label={t('docs.salesProfit.col.grossMarginPct')} value={totals?.grossMarginPct ? `${fmtNumber(totals.grossMarginPct)}%` : '—'} note={undefined} />}
        </div>
      ) : (
        <div className="stats" style={{ padding: '0 16px 12px' }}>
          {(['A', 'B', 'C'] as const).map(cls => (
            <Stat
              key={cls}
              label={`${t('docs.salesProfit.col.abcClass')} ${cls} (${abcSummary?.[cls].count ?? 0})`}
              value={abcSummary ? fmtAmount(metric === 'profit' && costVisible ? abcSummary[cls].grossProfit : abcSummary[cls].revenue) : '—'}
              note={undefined}
            />
          ))}
        </div>
      )}

      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('docs.salesProfit.searchPlaceholder') }}
        fields={[]}
        filters={filters}
        sort={
          tab === 'profit'
            ? { options: profitColumns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: profitTable.sort.id, dir: profitTable.sort.dir, onChange: profitTable.setSort }
            : { options: abcColumns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: abcTable.sort.id, dir: abcTable.sort.dir, onChange: abcTable.setSort }
        }
        columns={tab === 'profit' ? columnsMenu(profitColumns, profitTable) : columnsMenu(abcColumns, abcTable)}
        extra={
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 13 }}>{t('docs.salesProfit.dateFrom')}</span>
              <DateInput size="sm" value={dateFrom} onChange={v => setDateFrom(v ?? '')} aria-label={t('docs.salesProfit.dateFrom')} />
            </label>
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 13 }}>{t('docs.salesProfit.dateTo')}</span>
              <DateInput size="sm" value={dateTo} onChange={v => setDateTo(v ?? '')} aria-label={t('docs.salesProfit.dateTo')} />
            </label>
            <select className="select" aria-label={t('docs.salesProfit.groupBy')} value={groupBy} onChange={e => setGroupBy(e.target.value as SalesProfitGroupBy)}>
              {SALES_PROFIT_GROUP_BY.map(g => (
                <option key={g} value={g}>{t(`docs.salesProfit.group.${g}`)}</option>
              ))}
            </select>
            <select className="select" aria-label={t('docs.salesProfit.warehouse')} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
              <option value="">{t('docs.salesProfit.allWarehouses')}</option>
              {(warehouses.data ?? []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select className="select" aria-label={t('docs.salesProfit.organization')} value={organizationId} onChange={e => setOrganizationId(e.target.value)}>
              <option value="">{t('docs.salesProfit.allOrganizations')}</option>
              {(organizations.data ?? []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {tab === 'abc' && (
              <>
                <select className="select" aria-label={t('docs.salesProfit.abcMetric')} value={metric} onChange={e => setMetric(e.target.value as 'revenue' | 'profit')}>
                  <option value="revenue">{t('docs.salesProfit.metricRevenue')}</option>
                  {costVisible && <option value="profit">{t('docs.salesProfit.metricProfit')}</option>}
                </select>
                <label className="row" style={{ gap: 4, alignItems: 'center', fontSize: 13 }}>
                  <span className="muted">A%</span>
                  <input className="input" type="number" min={0} max={100} style={{ width: 64 }} value={thresholdA} onChange={e => setThresholdA(Number(e.target.value) || 0)} />
                </label>
                <label className="row" style={{ gap: 4, alignItems: 'center', fontSize: 13 }}>
                  <span className="muted">B%</span>
                  <input className="input" type="number" min={0} max={100} style={{ width: 64 }} value={thresholdB} onChange={e => setThresholdB(Number(e.target.value) || 0)} />
                </label>
                <span className="muted" style={{ fontSize: 13 }}>{`C: ${thresholdC}%`}</span>
              </>
            )}
          </div>
        }
      />

      {tab === 'abc' && !validThresholds ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('docs.salesProfit.invalidThresholds')} />
      ) : active.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('docs.salesProfit.loadError')} action={<Button size="sm" onClick={() => active.refetch()}>{t('common.retry')}</Button>}>
          {(active.error as Error).message}
        </EmptyState>
      ) : active.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : tab === 'profit' ? (
        <DataTable
          aria-label={t('docs.salesProfit.ariaLabel')}
          columns={profitColumns}
          rows={profitRows}
          table={profitTable}
          getId={r => r.groupId}
          empty={<EmptyState icon={<TrendingUp size={20} />} title={t('docs.salesProfit.emptyTitle')}>{t('docs.salesProfit.emptyHint')}</EmptyState>}
        />
      ) : (
        <DataTable
          aria-label={t('docs.salesProfit.ariaLabelAbc')}
          columns={abcColumns}
          rows={abcRows}
          table={abcTable}
          getId={r => r.groupId}
          empty={<EmptyState icon={<TrendingUp size={20} />} title={t('docs.salesProfit.emptyTitle')}>{t('docs.salesProfit.emptyHint')}</EmptyState>}
        />
      )}
    </div>
  );
}
