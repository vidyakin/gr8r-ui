/* Отчёт по дополнительным расходам за период (задача 1385): документы, статьи, основания и товары.
   Суммы считает сервер (GET /landed-costs/report); без права на себестоимость приходят null — экран показывает «—». */
import * as React from 'react';
import { ChartNoAxesCombined } from 'lucide-react';
import { EmptyState, Field, Skeleton } from '@/components/ui';
import { DateInput } from '@/components/erp/date-picker';
import { Stat } from '@/components/erp/panel';
import { fmtAmount, fmtNumber, t } from '@/i18n';
import { STATUS_LABEL } from './data';
import { METHOD_LABEL, useLandedCostReport } from './landed-costs-data';

const firstOfMonth = () => {
  const d = new Date();
  return `${d.toISOString().slice(0, 7)}-01`;
};
const today = () => new Date().toISOString().slice(0, 10);
const money = (v: string | null) => (v === null ? '—' : fmtAmount(v));

export function LandedCostsReportPage() {
  const [from, setFrom] = React.useState(firstOfMonth);
  const [to, setTo] = React.useState(today);
  const report = useLandedCostReport(from, to);
  const data = report.data;

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('landedCosts.reportPage.title')}</h1>
          <p>{t('landedCosts.reportPage.lead')}</p>
        </div>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '0 var(--gutter) 12px' }}>
        <Field label={t('landedCosts.reportPage.from')}>{p => <DateInput {...p} size="sm" required value={from} max={to} onChange={v => v && setFrom(v)} />}</Field>
        <Field label={t('landedCosts.reportPage.to')}>{p => <DateInput {...p} size="sm" required value={to} min={from} onChange={v => v && setTo(v)} />}</Field>
      </div>
      {report.isError ? (
        <EmptyState icon={<ChartNoAxesCombined size={20} />} error title={t('landedCosts.reportPage.title')}>
          {(report.error as Error).message}
        </EmptyState>
      ) : report.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !data?.documents.length ? (
        <EmptyState icon={<ChartNoAxesCombined size={20} />} title={t('landedCosts.reportPage.empty')} />
      ) : (
        <>
          <div className="stats" style={{ padding: '0 16px 12px' }}>
            <Stat label={t('landedCosts.reportPage.total')} value={money(data.total)} note="" />
            <Stat label={t('landedCosts.reportPage.posted')} value={money(data.postedTotal)} note="" />
            <Stat label={t('landedCosts.reportPage.documents')} value={String(data.documents.length)} note="" />
          </div>
          <div className="table-wrap" style={{ padding: '0 var(--gutter) 16px' }}>
            <table className="dtbl" aria-label={t('landedCosts.reportPage.documents')}>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>{t('landedCosts.col.number')}</th>
                  <th style={{ width: 110 }}>{t('landedCosts.col.date')}</th>
                  <th style={{ width: 110 }}>{t('landedCosts.col.status')}</th>
                  <th style={{ width: 170 }}>{t('landedCosts.col.method')}</th>
                  <th style={{ width: 200 }}>{t('landedCosts.col.supplier')}</th>
                  <th style={{ width: 180 }}>{t('landedCosts.col.costItem')}</th>
                  <th style={{ width: 90 }} className="r">
                    {t('landedCosts.col.lines')}
                  </th>
                  <th style={{ width: 130 }} className="r">
                    {t('landedCosts.col.total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.documents.map(d => (
                  <tr key={d.id}>
                    <td className="mono">{d.number ?? t('landedCosts.draft')}</td>
                    <td className="muted">{d.date}</td>
                    <td className="muted">{STATUS_LABEL[d.status]}</td>
                    <td className="muted">{METHOD_LABEL[d.method]}</td>
                    <td className="trunc">{d.supplierName ?? '—'}</td>
                    <td className="trunc muted">{d.costItemName ?? '—'}</td>
                    <td className="r num muted">{d.lineCount}</td>
                    <td className="r num">{money(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ gap: 16, padding: '0 var(--gutter) 24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Group title={t('landedCosts.reportPage.byCostItem')} rows={data.byCostItem.map(g => ({ id: g.costItemId, name: g.name || t('landedCosts.reportPage.unknownItem'), value: g.amount }))} aria={t('landedCosts.reportPage.byCostItem')} />
            <Group title={t('landedCosts.reportPage.byBase')} rows={data.byBase.map(g => ({ id: g.baseDocumentId, name: `${g.number ?? g.date} · ${g.date}`, value: g.amount }))} aria={t('landedCosts.reportPage.byBase')} />
            <Group title={t('landedCosts.reportPage.byProduct')} rows={data.byProduct.map(g => ({ id: g.productId, name: `${g.name}${g.sku ? ` · ${g.sku}` : ''}`, value: g.amount, note: `${fmtNumber(g.qty)}` }))} aria={t('landedCosts.reportPage.byProduct')} />
          </div>
        </>
      )}
    </div>
  );
}

function Group({ title, rows, aria }: { title: string; rows: { id: string; name: string; value: string | null; note?: string }[]; aria: string }) {
  return (
    <div className="panel" style={{ flex: '1 1 320px', minWidth: 280 }}>
      <table className="dtbl" aria-label={aria}>
        <thead>
          <tr>
            <th>{title}</th>
            <th style={{ width: 110 }} className="r">
              {t('landedCosts.col.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="trunc">
                {r.name}
                {r.note ? <span className="faint num" style={{ marginLeft: 6 }}>{r.note}</span> : null}
              </td>
              <td className="r num">{r.value === null ? '—' : fmtAmount(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
