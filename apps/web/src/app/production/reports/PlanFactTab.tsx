/* Отчёт «План-факт производства»: строки планов производства периода против выпуска; отклонение и выполнение, график. */
import { fmtDate } from '../../lib/dates';
import { fmtNumber, useT } from '@/i18n';
import { BarChart, type BarGroup } from './BarChart';
import { usePlanFactReport, type PlanFactRow } from './reports-data';
import { ReportTable, type GroupLevel, type ReportColumn } from './ReportTable';
import { ChartPanel, num, ReportState, type TabProps } from './shared';
import { dec, div, fmt, mul } from '@gr8r/shared';

/** Выполнение плана, % по сумме строк */
const pctOf = (rows: PlanFactRow[]) => {
  const plan = rows.reduce((s, r) => s + dec(r.plan), 0n);
  const fact = rows.reduce((s, r) => s + dec(r.fact), 0n);
  return plan > 0n ? fmt(div(mul(fact, dec('100')), plan), 1) : null;
};

export function PlanFactTab({ filter }: TabProps) {
  const tt = useT();
  const q = usePlanFactReport(filter);
  const sum = { format: num };
  const columns: ReportColumn<PlanFactRow>[] = [
    { id: 'period', header: tt('production.reports.planFact.period'), value: r => `${r.periodStart} — ${r.periodEnd}`, render: r => `${fmtDate(r.periodStart)} — ${fmtDate(r.periodEnd)}` },
    { id: 'plan', header: tt('production.reports.planFact.plan'), align: 'r', value: r => r.plan, render: r => num(r.plan), total: sum },
    { id: 'fact', header: tt('production.reports.planFact.fact'), align: 'r', value: r => r.fact, render: r => num(r.fact), total: sum },
    { id: 'deviation', header: tt('production.reports.planFact.deviation'), align: 'r', value: r => r.deviation, render: r => num(r.deviation), total: sum },
    { id: 'pct', header: tt('production.reports.planFact.pct'), align: 'r', value: r => r.pct, render: r => (r.pct === null ? '—' : `${fmtNumber(r.pct, { maximumFractionDigits: 1 })} %`), total: rows => { const p = pctOf(rows); return p === null ? '—' : `${fmtNumber(p, { maximumFractionDigits: 1 })} %`; }, totalCsv: pctOf },
  ];
  const groups: GroupLevel<PlanFactRow>[] = [{ key: r => r.itemId, label: rows => rows[0]!.itemName, csv: rows => rows[0]!.itemName, csvHeader: tt('production.reports.col.product') }];
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => {
        // график: по изделиям, план и факт за весь период отбора
        const byItem = new Map<string, { label: string; plan: number; fact: number }>();
        for (const r of d.rows) {
          const g = byItem.get(r.itemId) ?? { label: r.itemName, plan: 0, fact: 0 };
          g.plan += Number(r.plan);
          g.fact += Number(r.fact);
          byItem.set(r.itemId, g);
        }
        const chart: BarGroup[] = [...byItem.values()].map(g => ({ label: g.label, values: { plan: g.plan, fact: g.fact } }));
        return (
          <>
            <ChartPanel title={tt('production.reports.planFact.chart')}>
              <BarChart groups={chart} title={tt('production.reports.planFact.chart')} series={[{ id: 'plan', label: tt('production.reports.planFact.plan'), color: 'var(--blue)' }, { id: 'fact', label: tt('production.reports.planFact.fact'), color: 'var(--green)' }]} />
            </ChartPanel>
            <ReportTable rows={d.rows} columns={columns} groups={groups} rowKey={r => `${r.itemId}${r.periodStart}${r.periodEnd}`} filename="production-plan-fact" label={tt('production.reports.tab.planFact')} />
          </>
        );
      }}
    </ReportState>
  );
}
