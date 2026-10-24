/* Инвестпроекты: список с ключевыми показателями плана (NPV, IRR, окупаемость) и итогами факта.
   Суммы видят admin и owner — у остальных колонки сумм пустые. */
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { CircleAlert, FilePlus2 } from 'lucide-react';
import { INVESTMENT_STATUSES, type InvestmentStatus } from '@gr8r/shared';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { fmtAmount, t, useT } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { useCanSeeAmounts, useInvestments } from './data';

export const statusTone = (s: InvestmentStatus) => (s === 'approved' ? 'green' : s === 'closed' ? 'neutral' : 'gray');

/** Сумма или прочерк (сумма скрыта или показателя нет) */
export const amount = (v: string | null | undefined) => (v === null || v === undefined ? t('finance.common.empty') : fmtAmount(v));
export const num = (v: string | null | undefined, never?: boolean) => (v === null || v === undefined ? (never ? t('finance.metric.never') : t('finance.common.empty')) : fmtAmount(v));

export function InvestmentsPage() {
  const tt = useT();
  const navigate = useNavigate();
  const canManage = useCanSeeAmounts();
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState<InvestmentStatus | ''>('');
  const list = useInvestments({ q: q || undefined, status: status || undefined });
  const rows = list.data?.items ?? [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('finance.list.title')}</h1>
          <p>{tt('finance.list.subtitle')}</p>
        </div>
        <div className="acts">
          {canManage && (
            <Button variant="primary" onClick={() => void navigate('/investments/new')}>
              <FilePlus2 size={14} />
              {tt('finance.list.new')}
            </Button>
          )}
        </div>
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px' }}>
        <Field label={tt('finance.common.search')}>{p => <Input {...p} value={q} onChange={e => setQ(e.target.value)} />}</Field>
        <Field label={tt('finance.field.status')}>
          {p => (
            <Select
              {...p}
              value={status || 'all'}
              onValueChange={v => setStatus(v === 'all' ? '' : (v as InvestmentStatus))}
              options={[{ value: 'all', label: tt('finance.list.allStatuses') }, ...INVESTMENT_STATUSES.map(s => ({ value: s, label: tt(`finance.status.${s}`) }))]}
            />
          )}
        </Field>
      </div>
      {!canManage && <p className="faint" style={{ fontSize: 12, padding: '0 var(--gutter) 8px' }}>{tt('finance.common.hiddenAmounts')}</p>}
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('finance.list.title')} action={<Button size="sm" onClick={() => list.refetch()}>{tt('finance.common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<FilePlus2 size={20} />} title={tt('finance.list.noProjects')}>
          {tt('finance.list.noProjectsHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('finance.list.table')}>
            <thead>
              <tr>
                <th>{tt('finance.field.name')}</th>
                <th style={{ width: 110 }}>{tt('finance.field.status')}</th>
                <th style={{ width: 150 }}>{tt('finance.field.periodKind')}</th>
                <th style={{ width: 110 }}>{tt('finance.field.startDate')}</th>
                <th style={{ width: 130 }} className="r">{tt('finance.metric.totalOutflow')}</th>
                <th style={{ width: 130 }} className="r">{tt('finance.metric.npv')}</th>
                <th style={{ width: 100 }} className="r">{tt('finance.metric.irr')}</th>
                <th style={{ width: 110 }} className="r">{tt('finance.metric.payback')}</th>
                <th style={{ width: 130 }} className="r">{tt('finance.metric.fact')}</th>
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
                  <td className="muted">
                    {tt(`finance.periodKind.${r.periodKind}`)} × {r.periods}
                  </td>
                  <td className="muted">{fmtDate(r.startDate)}</td>
                  <td className="r num">{amount(r.plan?.totalOutflow)}</td>
                  <td className="r num">{amount(r.plan?.npv)}</td>
                  <td className="r num">{r.plan ? num(r.plan.irr) : amount(null)}</td>
                  <td className="r num">{r.plan ? num(r.plan.payback, true) : amount(null)}</td>
                  <td className="r num muted">{amount(r.fact?.totalOutflow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
