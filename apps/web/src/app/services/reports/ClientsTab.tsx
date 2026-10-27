/* Отчёт «Клиенты»: выручка без НДС (заказ-наряды + акты и реализации − возвраты), разбивка «работы и услуги / товары»,
   себестоимость и маржа. Себестоимость, маржа и процент — только admin и owner: остальным колонки не показываются. */
import { dec, marginPct } from '@gr8r/shared';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { BarChart, type BarGroup } from '../../production/reports/BarChart';
import { ReportTable, type ReportColumn } from '../../production/reports/ReportTable';
import { ChartPanel, ReportState } from '../../production/reports/shared';
import { useCanSeeCost } from '../../docs/data';
import type { ServiceTabProps } from './ServiceReportsPage';
import { useClientsReport, type ClientsRow } from './service-reports-data';

const money = { format: (v: string) => fmtAmount(v), scale: 2 };
const count = { format: (v: string) => fmtNumber(v, { maximumFractionDigits: 0 }), scale: 0 };
const pct = (v: string | null) => (v === null ? '—' : `${fmtNumber(v)} %`);

export function ClientsTab({ filter }: ServiceTabProps) {
  const tt = useT();
  const seeCost = useCanSeeCost();
  const q = useClientsReport(filter);
  const costColumns: ReportColumn<ClientsRow>[] = seeCost
    ? [
        { id: 'cost', header: tt('serviceReports.clients.col.cost'), align: 'r', value: r => r.cost, render: r => fmtAmount(r.cost), total: money },
        { id: 'margin', header: tt('serviceReports.clients.col.margin'), align: 'r', value: r => r.margin, render: r => <strong>{fmtAmount(r.margin)}</strong>, total: money },
        {
          id: 'marginPct',
          header: tt('serviceReports.clients.col.marginPct'),
          align: 'r',
          value: r => r.marginPct ?? '',
          render: r => pct(r.marginPct),
          // процент итога — от сумм, а не среднее процентов
          total: list => pct(marginPct(list.reduce((s, r) => s + dec(r.margin), 0n), list.reduce((s, r) => s + dec(r.revenue), 0n))),
          totalCsv: list => marginPct(list.reduce((s, r) => s + dec(r.margin), 0n), list.reduce((s, r) => s + dec(r.revenue), 0n)),
        },
      ]
    : [];
  const columns: ReportColumn<ClientsRow>[] = [
    { id: 'client', header: tt('serviceReports.clients.col.client'), value: r => r.counterpartyName ?? tt('serviceReports.clients.noClient') },
    { id: 'orders', header: tt('serviceReports.clients.col.orders'), align: 'r', value: r => r.orders, total: count },
    { id: 'documents', header: tt('serviceReports.clients.col.documents'), align: 'r', value: r => r.documents, total: count },
    { id: 'services', header: tt('serviceReports.clients.col.services'), align: 'r', value: r => r.revenueServices, render: r => fmtAmount(r.revenueServices), total: money },
    { id: 'goods', header: tt('serviceReports.clients.col.goods'), align: 'r', value: r => r.revenueGoods, render: r => fmtAmount(r.revenueGoods), total: money },
    { id: 'revenue', header: tt('serviceReports.clients.col.revenue'), align: 'r', value: r => r.revenue, render: r => <strong>{fmtAmount(r.revenue)}</strong>, total: money },
    ...costColumns,
  ];
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => {
        const chart: BarGroup[] = d.rows.slice(0, 12).map(r => ({ label: r.counterpartyName ?? tt('serviceReports.clients.noClient'), values: { revenue: Number(r.revenue), cost: Number(r.cost ?? 0) } }));
        return (
          <>
            <p className="muted" style={{ margin: '0 var(--gutter) 8px', fontSize: 12 }}>{tt('serviceReports.clients.hint')}</p>
            <ChartPanel title={tt('serviceReports.clients.chart')}>
              <BarChart groups={chart} title={tt('serviceReports.clients.chart')} series={[{ id: 'revenue', label: tt('serviceReports.clients.revenueSeries'), color: 'var(--blue)' }, ...(seeCost ? [{ id: 'cost', label: tt('serviceReports.clients.costSeries'), color: 'var(--amber)' }] : [])]} />
            </ChartPanel>
            <ReportTable rows={d.rows} columns={columns} groups={[]} rowKey={r => r.counterpartyId ?? ''} href={r => (r.counterpartyId ? `/crm/companies/${r.counterpartyId}/documents` : null)} filename="service-clients" label={tt('serviceReports.tab.clients')} />
          </>
        );
      }}
    </ReportState>
  );
}
