/* Экран «Объекты: прогноз» (задача 1275): портфель по всем активным объектам — стоимость договора, факт, прогноз
   себестоимости, прибыль и маржа, процент выполнения. Суммы видят только owner/admin: раздел в меню виден всем
   (механизма ограничения разделов по роли нет), сервер отвечает 403, и экран показывает «Нет доступа». */
import { Link } from 'react-router';
import { CircleAlert } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/ui';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { ApiError } from '../data/api';
import { useObjectsPortfolio } from './forecast-data';

const money = (v: string | null | undefined) => (v == null ? '—' : fmtAmount(v));
const percent = (v: string | null) => (v == null ? '—' : `${fmtNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const negClass = (v: string | null | undefined) => (v != null && v.startsWith('-') ? 'r num neg' : 'r num');

export function ObjectsForecastPage() {
  const tt = useT();
  const list = useObjectsPortfolio();
  if (list.isPending) return <Skeleton w="100%" h={200} />;
  if (list.isError) {
    const forbidden = list.error instanceof ApiError && list.error.code === 'forbidden';
    return (
      <div className="page flush">
        <EmptyState icon={<CircleAlert size={20} />} error title={forbidden ? tt('objects.forecast.noAccess') : tt('objects.common.error')}>
          {forbidden ? tt('errors.forbidden') : (list.error as Error).message}
        </EmptyState>
      </div>
    );
  }
  const data = list.data;
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('objects.forecast.portfolio.title')}</h1>
          <p className="faint">{tt('objects.forecast.portfolio.subtitle')}</p>
        </div>
      </div>
      <div style={{ padding: '0 var(--gutter)' }}>
        {!data.items.length ? (
          <EmptyState icon={<CircleAlert size={20} />} title={tt('objects.forecast.portfolio.empty')} />
        ) : (
          <div className="table-wrap">
            <table className="dtbl" aria-label={tt('objects.forecast.portfolio.title')}>
              <thead>
                <tr>
                  <th style={{ width: 130 }}>{tt('objects.forecast.portfolio.column.number')}</th>
                  <th>{tt('objects.forecast.portfolio.column.object')}</th>
                  <th style={{ width: 160 }}>{tt('objects.forecast.portfolio.column.customer')}</th>
                  <th style={{ width: 110 }}>{tt('objects.forecast.portfolio.column.progress')}</th>
                  <th className="r" style={{ width: 130 }}>{tt('objects.forecast.portfolio.column.contract')}</th>
                  <th className="r" style={{ width: 130 }}>{tt('objects.forecast.portfolio.column.fact')}</th>
                  <th className="r" style={{ width: 130 }}>{tt('objects.forecast.portfolio.column.forecast')}</th>
                  <th className="r" style={{ width: 130 }}>{tt('objects.forecast.portfolio.column.profit')}</th>
                  <th className="r" style={{ width: 90 }}>{tt('objects.forecast.portfolio.column.margin')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(r => (
                  <tr key={r.objectId}>
                    <td className="mono">
                      <Link className="crm-link" to={`/objects/${r.objectId}`}>
                        {r.number}
                      </Link>
                    </td>
                    <td>
                      {r.name}
                      {!r.hasEstimate && <span className="faint"> · {tt('objects.forecast.portfolio.noEstimate')}</span>}
                    </td>
                    <td className="muted">{r.customerName ?? '—'}</td>
                    <td className="r num">{percent(r.progressPercent)}</td>
                    <td className="r num">{money(r.contractValue)}</td>
                    <td className="r num">{money(r.factCost)}</td>
                    <td className="r num">{money(r.forecastCost)}</td>
                    <td className={negClass(r.profit)}>{money(r.profit)}</td>
                    <td className={negClass(r.marginPct)}>{percent(r.marginPct)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}><b>{tt('objects.forecast.portfolio.totals', { objects: String(data.totals.objects) })}</b></td>
                  <td className="r num"><b>{money(data.totals.contractValue)}</b></td>
                  <td className="r num"><b>{money(data.totals.factCost)}</b></td>
                  <td className="r num"><b>{money(data.totals.forecastCost)}</b></td>
                  <td className={negClass(data.totals.profit)}><b>{money(data.totals.profit)}</b></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
