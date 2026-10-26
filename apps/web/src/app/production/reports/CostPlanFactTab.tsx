/* Отчёт «План-факт себестоимости»: по материалам выпусков план (нормы выпуска × фактическая средняя цена списания) против факта.
   Отклонение количества и суммы, перерасход / экономия; изделие → материал → документ. Суммы видят admin и owner, количества — все. */
import { fmtAmount, useT } from '@/i18n';
import { dec, fmt } from '@gr8r/shared';
import { fmtDate } from '../../lib/dates';
import { BarChart, type BarGroup } from './BarChart';
import { useCostPlanFactReport, type CostPlanFactRow } from './reports-data';
import { ReportTable, type GroupLevel, type ReportColumn } from './ReportTable';
import { ChartPanel, num, ReportState, type TabProps } from './shared';

const money = { format: (v: string) => fmtAmount(v), scale: 4 };

export function CostPlanFactTab({ filter }: TabProps) {
  const tt = useT();
  const q = useCostPlanFactReport(filter);
  const sum = { format: num };
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => {
        const masked = d.rows[0]!.planAmount === null;
        const result = (r: CostPlanFactRow) => {
          const v = dec(r.deviationQty);
          return v > 0n ? tt('production.reports.costPlanFact.overrun') : v < 0n ? tt('production.reports.costPlanFact.saving') : tt('production.reports.costPlanFact.onNorm');
        };
        const columns: ReportColumn<CostPlanFactRow>[] = [
          { id: 'doc', header: tt('production.reports.costPlanFact.document'), value: r => r.number ?? tt('production.common.draft') },
          { id: 'date', header: tt('production.reports.col.date'), value: r => r.date, render: r => fmtDate(r.date) },
          { id: 'planQty', header: tt('production.reports.costPlanFact.planQty'), align: 'r', value: r => r.planQty, render: r => num(r.planQty), total: sum },
          { id: 'factQty', header: tt('production.reports.costPlanFact.factQty'), align: 'r', value: r => r.factQty, render: r => num(r.factQty), total: sum },
          { id: 'devQty', header: tt('production.reports.costPlanFact.deviationQty'), align: 'r', value: r => r.deviationQty, render: r => num(r.deviationQty), total: sum },
          ...(masked
            ? []
            : ([
                { id: 'planAmount', header: tt('production.reports.costPlanFact.planAmount'), align: 'r', value: r => r.planAmount, render: r => fmtAmount(r.planAmount), total: money },
                { id: 'factAmount', header: tt('production.reports.costPlanFact.factAmount'), align: 'r', value: r => r.factAmount, render: r => fmtAmount(r.factAmount), total: money },
                { id: 'devAmount', header: tt('production.reports.costPlanFact.deviationAmount'), align: 'r', value: r => r.deviationAmount, render: r => fmtAmount(r.deviationAmount), total: money },
              ] as ReportColumn<CostPlanFactRow>[])),
          { id: 'result', header: tt('production.reports.costPlanFact.result'), value: result },
        ];
        const groups: GroupLevel<CostPlanFactRow>[] = [
          { key: r => r.itemId, label: rows => rows[0]!.itemName, csv: rows => rows[0]!.itemName, csvHeader: tt('production.reports.col.product') },
          { key: r => r.productId, label: rows => rows[0]!.materialName, csv: rows => rows[0]!.materialName, csvHeader: tt('production.reports.costPlanFact.material') },
        ];
        // график: по материалам, суммы (или количества, если стоимость скрыта)
        const byMaterial = new Map<string, { label: string; plan: bigint; fact: bigint }>();
        for (const r of d.rows) {
          const g = byMaterial.get(r.productId) ?? { label: r.materialName, plan: 0n, fact: 0n };
          g.plan += dec(masked ? r.planQty : r.planAmount);
          g.fact += dec(masked ? r.factQty : r.factAmount);
          byMaterial.set(r.productId, g);
        }
        const chart: BarGroup[] = [...byMaterial.values()].map(g => ({ label: g.label, values: { plan: Number(fmt(g.plan, 2)), fact: Number(fmt(g.fact, 2)) } }));
        const title = tt(masked ? 'production.reports.costPlanFact.chartQty' : 'production.reports.costPlanFact.chartAmount');
        return (
          <>
            <ChartPanel title={title}>
              <BarChart groups={chart} title={title} series={[{ id: 'plan', label: tt('production.reports.planFact.plan'), color: 'var(--blue)' }, { id: 'fact', label: tt('production.reports.planFact.fact'), color: 'var(--green)' }]} />
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>{tt('production.reports.costPlanFact.hint')}</p>
            </ChartPanel>
            <ReportTable rows={d.rows} columns={columns} groups={groups} rowKey={r => r.documentId + r.productId + r.itemId} href={r => `/documents/${r.documentId}`} rowTone={r => (dec(r.deviationQty) > 0n ? 'danger' : undefined)} filename="production-cost-plan-fact" label={tt('production.reports.tab.costPlanFact')} />
          </>
        );
      }}
    </ReportState>
  );
}
