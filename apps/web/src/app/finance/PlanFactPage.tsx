/* Сводный план-факт: вложения и поступления всех неархивных проектов — план, факт, отклонение; NPV плана и прогноза */
import { Link } from 'react-router';
import { CircleAlert, Scale } from 'lucide-react';
import { dec, fmt, type InvestmentMetrics } from '@gr8r/shared';
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { useT } from '@/i18n';
import { useCanSeeAmounts, useInvestments } from './data';
import { amount, statusTone } from './InvestmentsPage';

const dev = (fact?: string | null, plan?: string | null) => (fact == null || plan == null ? null : fmt(dec(fact) - dec(plan), 2));
const sum = (ms: (InvestmentMetrics | null)[], key: 'totalOutflow' | 'totalInflow' | 'npv') => fmt(ms.reduce((s, m) => s + dec(m?.[key] ?? '0'), 0n), 2);

export function PlanFactPage() {
  const tt = useT();
  const canSee = useCanSeeAmounts();
  const list = useInvestments();
  const rows = list.data?.items ?? [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('finance.planFact.title')}</h1>
          <p>{tt('finance.planFact.subtitle')}</p>
        </div>
      </div>
      {!canSee && <p className="faint" style={{ fontSize: 12, padding: '0 var(--gutter) 8px' }}>{tt('finance.common.hiddenAmounts')}</p>}
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('finance.planFact.title')} action={<Button size="sm" onClick={() => list.refetch()}>{tt('finance.common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<Scale size={20} />} title={tt('finance.list.noProjects')}>
          {tt('finance.list.noProjectsHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('finance.planFact.title')}>
            <thead>
              <tr>
                <th>{tt('finance.field.name')}</th>
                <th style={{ width: 110 }}>{tt('finance.field.status')}</th>
                <th className="r">{tt('finance.planFact.planOut')}</th>
                <th className="r">{tt('finance.planFact.factOut')}</th>
                <th className="r">{tt('finance.metric.deviation')}</th>
                <th className="r">{tt('finance.planFact.planIn')}</th>
                <th className="r">{tt('finance.planFact.factIn')}</th>
                <th className="r">{tt('finance.metric.deviation')}</th>
                <th className="r">{tt('finance.planFact.npvPlan')}</th>
                <th className="r">{tt('finance.planFact.npvForecast')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/investments/${r.id}`} className="crm-link">
                      {r.name}
                    </Link>
                  </td>
                  <td>
                    <Badge tone={statusTone(r.status)} dot>
                      {tt(`finance.status.${r.status}`)}
                    </Badge>
                  </td>
                  <td className="r num">{amount(r.plan?.totalOutflow)}</td>
                  <td className="r num">{amount(r.fact?.totalOutflow)}</td>
                  <td className="r num">{amount(dev(r.fact?.totalOutflow, r.plan?.totalOutflow))}</td>
                  <td className="r num">{amount(r.plan?.totalInflow)}</td>
                  <td className="r num">{amount(r.fact?.totalInflow)}</td>
                  <td className="r num">{amount(dev(r.fact?.totalInflow, r.plan?.totalInflow))}</td>
                  <td className={`r num ${Number(r.plan?.npv) < 0 ? 'inv-neg' : ''}`}>{amount(r.plan?.npv)}</td>
                  <td className={`r num ${Number(r.forecast?.npv) < 0 ? 'inv-neg' : ''}`}>{amount(r.forecast?.npv)}</td>
                </tr>
              ))}
            </tbody>
            {canSee && (
              <tfoot>
                <tr className="inv-total">
                  <td colSpan={2}>{tt('finance.planFact.total')}</td>
                  <td className="r num">{amount(sum(rows.map(r => r.plan), 'totalOutflow'))}</td>
                  <td className="r num">{amount(sum(rows.map(r => r.fact), 'totalOutflow'))}</td>
                  <td className="r num">{amount(dev(sum(rows.map(r => r.fact), 'totalOutflow'), sum(rows.map(r => r.plan), 'totalOutflow')))}</td>
                  <td className="r num">{amount(sum(rows.map(r => r.plan), 'totalInflow'))}</td>
                  <td className="r num">{amount(sum(rows.map(r => r.fact), 'totalInflow'))}</td>
                  <td className="r num">{amount(dev(sum(rows.map(r => r.fact), 'totalInflow'), sum(rows.map(r => r.plan), 'totalInflow')))}</td>
                  <td className="r num">{amount(sum(rows.map(r => r.plan), 'npv'))}</td>
                  <td className="r num">{amount(sum(rows.map(r => r.forecast), 'npv'))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
