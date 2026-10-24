/* Вкладка «План-факт» карточки инвестпроекта: по статьям (план, факт, отклонение), по периодам и документы факта.
   Участник без права видеть суммы получает состав статей и документов без сумм. */
import { Link } from 'react-router';
import { dec, fmt } from '@gr8r/shared';
import { Badge, Skeleton } from '@/components/ui';
import { useT } from '@/i18n';
import { typeLabel } from '../docs/data';
import { fmtDate } from '../lib/dates';
import { useInvestmentPlanFact, type PlanFactRow } from './data';
import { amount } from './InvestmentsPage';

/** Сумма по периоду для строк одного направления */
const periodSum = (rows: PlanFactRow[], dir: 'in' | 'out', key: 'plan' | 'fact', i: number) => fmt(rows.filter(r => r.direction === dir).reduce((s, r) => s + dec(r[key]?.[i] ?? '0'), 0n), 2);

export function PlanFactTab({ id }: { id: string }) {
  const tt = useT();
  const pf = useInvestmentPlanFact(id);
  if (pf.isPending) return <Skeleton w="100%" h={36} />;
  if (!pf.data) return null;
  const { rows, documents, periodList } = pf.data;
  const hidden = rows.some(r => r.planTotal === null);
  const devClass = (v: string | null, dir: 'in' | 'out') => (v === null || Number(v) === 0 ? '' : (Number(v) > 0) === (dir === 'in') ? 'inv-pos' : 'inv-neg');

  return (
    <section className="doc-lines panel" aria-label={tt('finance.card.planFactTab')}>
      <h3 className="inv-sub">{tt('finance.planFact.byItem')}</h3>
      <div className="table-wrap">
        <table className="dtbl" aria-label={tt('finance.planFact.byItem')}>
          <thead>
            <tr>
              <th>{tt('finance.field.costItem')}</th>
              <th style={{ width: 130 }}>{tt('finance.field.direction')}</th>
              <th style={{ width: 140 }} className="r">{tt('finance.metric.plan')}</th>
              <th style={{ width: 140 }} className="r">{tt('finance.metric.fact')}</th>
              <th style={{ width: 140 }} className="r">{tt('finance.metric.deviation')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.direction}:${r.costItemId ?? ''}`}>
                <td>{r.costItemName ?? <span className="faint">{tt('finance.field.noCostItem')}</span>}</td>
                <td>
                  <Badge tone={r.direction === 'in' ? 'green' : 'gray'}>{tt(`finance.direction.${r.direction}`)}</Badge>
                </td>
                <td className="r num">{amount(r.planTotal)}</td>
                <td className="r num">{amount(r.factTotal)}</td>
                <td className={`r num ${devClass(r.deviation, r.direction)}`}>{amount(r.deviation)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!hidden && (
        <>
          <h3 className="inv-sub">{tt('finance.planFact.byPeriod')}</h3>
          <div className="table-wrap">
            <table className="dtbl" aria-label={tt('finance.planFact.byPeriod')}>
              <thead>
                <tr>
                  <th style={{ width: 120 }}>{tt('finance.field.period')}</th>
                  <th className="r">{tt('finance.planFact.planOut')}</th>
                  <th className="r">{tt('finance.planFact.factOut')}</th>
                  <th className="r">{tt('finance.metric.deviation')}</th>
                  <th className="r">{tt('finance.planFact.planIn')}</th>
                  <th className="r">{tt('finance.planFact.factIn')}</th>
                  <th className="r">{tt('finance.metric.deviation')}</th>
                </tr>
              </thead>
              <tbody>
                {periodList.map(p => {
                  const [po, fo, pi, fi] = [periodSum(rows, 'out', 'plan', p.index), periodSum(rows, 'out', 'fact', p.index), periodSum(rows, 'in', 'plan', p.index), periodSum(rows, 'in', 'fact', p.index)];
                  const dOut = fmt(dec(fo) - dec(po), 2);
                  const dIn = fmt(dec(fi) - dec(pi), 2);
                  return (
                    <tr key={p.index}>
                      <td>{p.label}</td>
                      <td className="r num">{amount(po)}</td>
                      <td className="r num">{amount(fo)}</td>
                      <td className={`r num ${devClass(dOut, 'out')}`}>{amount(dOut)}</td>
                      <td className="r num">{amount(pi)}</td>
                      <td className="r num">{amount(fi)}</td>
                      <td className={`r num ${devClass(dIn, 'in')}`}>{amount(dIn)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="inv-sub">{tt('finance.planFact.documents')}</h3>
      {!documents.length ? (
        <p className="faint" style={{ padding: '0 12px 12px' }}>{tt('finance.planFact.noDocuments')}</p>
      ) : (
        <div className="table-wrap">
          <table className="dtbl" aria-label={tt('finance.planFact.documents')}>
            <thead>
              <tr>
                <th>{tt('finance.field.document')}</th>
                <th style={{ width: 110 }}>{tt('finance.field.date')}</th>
                <th style={{ width: 110 }}>{tt('finance.field.period')}</th>
                <th>{tt('finance.field.costItem')}</th>
                <th style={{ width: 130 }}>{tt('finance.field.via')}</th>
                <th style={{ width: 140 }} className="r">{tt('finance.field.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d, i) => (
                <tr key={`${d.documentId}:${i}`}>
                  <td>
                    <Link to={d.type === 'other_costs' ? `/other-costs/${d.documentId}` : `/documents/${d.documentId}`} className="crm-link">
                      {typeLabel(d.type)} {d.number ?? ''}
                    </Link>
                  </td>
                  <td className="muted">{fmtDate(d.date)}</td>
                  <td className="muted">{periodList[d.periodIndex]?.label}</td>
                  <td>{d.costItemName ?? <span className="faint">{tt('finance.field.noCostItem')}</span>}</td>
                  <td>
                    <Badge tone={d.via === 'field' ? 'accent' : 'violet'}>{tt(`finance.via.${d.via}`)}</Badge>
                  </td>
                  <td className="r num">{amount(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
