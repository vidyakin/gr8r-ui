/* Отчёт «Воронка продаж» (задача 1176): по воронке и периоду — сделки и сумма на каждом этапе, конверсия между этапами,
   среднее время на этапе, взвешенный прогноз. Когорта — сделки воронки, созданные в периоде. */
import * as React from 'react';
import { Select } from '@/components/ui';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { dOff, iso, today } from '../lib/dates';
import { ReportState } from '../production/reports/shared';
import { colorVar } from './stages';
import { useFunnel, usePipelines } from './pipelines';

export function FunnelPage() {
  const t = useT();
  const pipes = usePipelines();
  const [pipelineId, setPipelineId] = React.useState('');
  const [from, setFrom] = React.useState(() => dOff(-90));
  const [to, setTo] = React.useState(() => iso(today()));
  const list = pipes.data?.pipelines ?? [];
  const active = list.find(p => p.id === pipelineId) ?? list.find(p => p.isDefault) ?? list[0];
  const q = useFunnel(active?.id ?? null, from, to);
  const dash = <span className="faint">—</span>;

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('crm.funnel.title')}</h1>
          <p>{t('crm.funnel.subtitle')}</p>
        </div>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', padding: '0 var(--gutter, 16px) 12px', alignItems: 'flex-end' }}>
        <Select value={active?.id ?? ''} aria-label={t('crm.pipelines.pipeline')} onValueChange={setPipelineId} options={list.map(p => ({ value: p.id, label: p.name }))} />
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          {t('crm.funnel.from')}
          <input type="date" className="input" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          {t('crm.funnel.to')}
          <input type="date" className="input" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} />
        </label>
      </div>
      <ReportState q={q} isEmpty={d => !d.totals.deals}>
        {d => {
          const max = Math.max(...d.rows.map(r => Number(r.amount)), 1);
          return (
            <div style={{ padding: '0 var(--gutter, 16px)', overflowX: 'auto' }}>
              <table className="tbl" aria-label={t('crm.funnel.title')}>
                <thead>
                  <tr>
                    <th>{t('crm.deals.col.stage')}</th>
                    <th className="r">{t('crm.funnel.col.deals')}</th>
                    <th className="r">{t('crm.deals.col.amount')}</th>
                    <th className="r">{t('crm.funnel.col.reached')}</th>
                    <th className="r">{t('crm.funnel.col.conversion')}</th>
                    <th className="r">{t('crm.funnel.col.avgDays')}</th>
                    <th className="r">{t('crm.deals.col.prob')}</th>
                    <th className="r">{t('crm.deals.col.weighted')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map(r => (
                    <tr key={r.stageId}>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          <i style={{ display: 'inline-block', height: 8, width: `${Math.max(4, (Number(r.amount) / max) * 90)}px`, background: colorVar(r.color), borderRadius: 4 }} />
                          {r.name}
                        </span>
                      </td>
                      <td className="r num">{fmtNumber(r.count)}</td>
                      <td className="r num">{fmtAmount(r.amount)}</td>
                      <td className="r num">{r.category === 'lost' ? dash : fmtNumber(r.reached)}</td>
                      <td className="r num">{r.conversion == null ? dash : `${fmtNumber(r.conversion)}%`}</td>
                      <td className="r num">{r.avgDays == null ? dash : fmtNumber(r.avgDays)}</td>
                      <td className="r num">{r.category === 'in_progress' ? `${r.probability}%` : dash}</td>
                      <td className="r num">{r.category === 'in_progress' ? fmtAmount(r.weighted) : dash}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 600 }}>
                    <td>{t('crm.funnel.total')}</td>
                    <td className="r num">{fmtNumber(d.totals.deals)}</td>
                    <td className="r num">{fmtAmount(d.totals.amount)}</td>
                    <td />
                    <td />
                    <td />
                    <td />
                    <td className="r num">{fmtAmount(d.totals.weighted)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: 12 }}>{t('crm.funnel.note')}</p>
            </div>
          );
        }}
      </ReportState>
    </div>
  );
}
