/* Отчёт по доставкам (задача 1100): число, выручка и себестоимость доставленных, маржа, доля недоставленных — по способам,
   курьерам и периодам. Себестоимость и маржа приходят только admin и owner: остальным колонок нет. */
import * as React from 'react';
import { dec, marginPct } from '@gr8r/shared';
import { Field, Input, Select } from '@/components/ui';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { iso, today } from '../../lib/dates';
import { BarChart, type BarGroup } from '../../production/reports/BarChart';
import { ReportTable, type ReportColumn } from '../../production/reports/ReportTable';
import { ChartPanel, ReportState } from '../../production/reports/shared';
import { useCanSeeCost } from '../../docs/data';
import { useDeliveryReport, type DeliveryReportRow } from '../../docs/delivery-data';

const money = { format: (v: string) => fmtAmount(v), scale: 2 };
const count = { format: (v: string) => fmtNumber(v, { maximumFractionDigits: 0 }), scale: 0 };
const pct = (v: string | null) => (v === null ? '—' : `${fmtNumber(v, { maximumFractionDigits: 1 })} %`);

/** Доля недоставленных среди завершённых по сумме строк, % */
const share = (list: DeliveryReportRow[]): string | null => {
  const failed = list.reduce((s, r) => s + r.failed, 0);
  const done = list.reduce((s, r) => s + r.delivered + r.failed, 0);
  return done ? marginPct(dec(failed), dec(done)) : null;
};

export function DeliveryReportTab() {
  const t = useT();
  const seeCost = useCanSeeCost();
  const [from, setFrom] = React.useState(iso(new Date(today().getFullYear(), today().getMonth(), 1)));
  const [to, setTo] = React.useState(iso(today()));
  const [by, setBy] = React.useState('method');
  const q = useDeliveryReport({ from, to, by });
  const costColumns: ReportColumn<DeliveryReportRow>[] = seeCost
    ? [
        { id: 'cost', header: t('delivery.report.cost'), align: 'r', value: r => r.cost, render: r => fmtAmount(r.cost), total: money },
        { id: 'margin', header: t('delivery.report.margin'), align: 'r', value: r => r.margin, render: r => <strong>{fmtAmount(r.margin)}</strong>, total: money },
      ]
    : [];
  const columns: ReportColumn<DeliveryReportRow>[] = [
    { id: 'group', header: t('delivery.report.group'), value: r => r.label || t('delivery.report.none') },
    { id: 'count', header: t('delivery.report.count'), align: 'r', value: r => r.count, total: count },
    { id: 'delivered', header: t('delivery.report.delivered'), align: 'r', value: r => r.delivered, total: count },
    { id: 'failed', header: t('delivery.report.failed'), align: 'r', value: r => r.failed, total: count },
    {
      id: 'failedPct',
      header: t('delivery.report.failedPct'),
      align: 'r',
      value: r => r.failedPct ?? '',
      render: r => pct(r.failedPct),
      total: list => pct(share(list)),
      totalCsv: list => share(list),
    },
    { id: 'revenue', header: t('delivery.report.revenue'), align: 'r', value: r => r.revenue, render: r => fmtAmount(r.revenue), total: money },
    ...costColumns,
  ];
  return (
    <>
      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('delivery.list.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} />}</Field>
          <Field label={t('delivery.list.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || to)} />}</Field>
          <Field label={t('delivery.report.by')}>
            {p => (
              <Select
                id={p.id}
                value={by}
                onValueChange={setBy}
                aria-label={t('delivery.report.by')}
                options={[
                  { value: 'method', label: t('delivery.report.byMethod') },
                  { value: 'courier', label: t('delivery.report.byCourier') },
                  { value: 'day', label: t('delivery.report.byDay') },
                  { value: 'month', label: t('delivery.report.byMonth') },
                ]}
              />
            )}
          </Field>
        </div>
      </section>
      <ReportState q={q} isEmpty={d => !d.rows.length}>
        {d => {
          const chart: BarGroup[] = d.rows.slice(0, 12).map(r => ({ label: r.label || t('delivery.report.none'), values: { revenue: Number(r.revenue), cost: Number(r.cost ?? 0) } }));
          return (
            <>
              <p className="muted" style={{ margin: '0 var(--gutter) 8px', fontSize: 12 }}>{t('delivery.report.hint')}</p>
              <ChartPanel title={t('delivery.report.chart')}>
                <BarChart groups={chart} title={t('delivery.report.chart')} series={[{ id: 'revenue', label: t('delivery.report.revenue'), color: 'var(--blue)' }, ...(seeCost ? [{ id: 'cost', label: t('delivery.report.cost'), color: 'var(--amber)' }] : [])]} />
              </ChartPanel>
              <ReportTable rows={d.rows} columns={columns} groups={[]} rowKey={r => r.key} href={() => null} filename="deliveries" label={t('delivery.list.tabReport')} />
            </>
          );
        }}
      </ReportState>
    </>
  );
}
