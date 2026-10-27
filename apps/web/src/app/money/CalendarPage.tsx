/* Платёжный календарь (1174г): прогноз остатка денег по дням, плановые поступления и платежи, кассовый разрыв */
import * as React from 'react';
import { Link } from 'react-router';
import { CircleAlert } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, Field, Select, Skeleton } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { typeLabel } from '../docs/data';
import { usePaymentCalendar, type CalendarDay } from './data';

const HORIZONS = [14, 30, 60, 90, 180];

/** Линия остатка по дням: ниже нуля — красная область, точка разрыва подсвечена */
function BalanceChart({ days, label }: { days: CalendarDay[]; label: string }) {
  const W = 760;
  const H = 150;
  const vals = days.map(d => Number(d.balance));
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const x = (i: number) => (days.length > 1 ? (i / (days.length - 1)) * W : W / 2);
  const y = (v: number) => 8 + ((max - v) / span) * (H - 16);
  const zero = y(0);
  const path = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} style={{ maxHeight: 180 }}>
      <line x1={0} x2={W} y1={zero} y2={zero} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="4 3" />
      {min < 0 && <rect x={0} y={zero} width={W} height={H - zero} fill="var(--red, #dc2626)" fillOpacity={0.06} />}
      <path d={path} fill="none" stroke="var(--accent, #2563eb)" strokeWidth={2} />
      {days.map((d, i) => (d.gap ? <circle key={d.date} cx={x(i)} cy={y(vals[i]!)} r={2.5} fill="var(--red, #dc2626)" /> : null))}
    </svg>
  );
}

export function PaymentCalendarPage() {
  const tt = useT();
  const [days, setDays] = React.useState(60);
  const [pending, setPending] = React.useState(true);
  const [onlyMoves, setOnlyMoves] = React.useState(true);
  const q = usePaymentCalendar({ days, includePending: pending });
  const k = q.data;

  const rows = k ? (onlyMoves ? k.days.filter(d => Number(d.in) !== 0 || Number(d.out) !== 0) : k.days) : [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('money.calendar.title')}</h1>
          <p>{tt('money.calendar.subtitle')}</p>
        </div>
      </div>
      <div className="row" style={{ gap: 12, padding: '0 var(--gutter) 12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label={tt('money.calendar.horizon')}>
          {p => <Select id={p.id} value={String(days)} onValueChange={v => setDays(Number(v))} options={HORIZONS.map(n => ({ value: String(n), label: tt('money.calendar.days', { n }) }))} aria-label={tt('money.calendar.horizon')} />}
        </Field>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={pending} onChange={e => setPending(e.target.checked)} />
          {tt('money.calendar.includePending')}
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={onlyMoves} onChange={e => setOnlyMoves(e.target.checked)} />
          {tt('money.calendar.onlyMovements')}
        </label>
      </div>

      {q.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('money.calendar.title')} action={<Button size="sm" onClick={() => q.refetch()}>{tt('money.common.retry')}</Button>}>
          {(q.error as Error).message}
        </EmptyState>
      ) : !k ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={120} />
        </div>
      ) : (
        <div style={{ padding: '0 var(--gutter) 24px', display: 'grid', gap: 16 }}>
          <Alert tone={k.firstGap ? 'danger' : 'ok'}>
            {k.firstGap ? (
              <>
                <strong>{tt('money.calendar.gapTitle')}.</strong> {tt('money.calendar.gap', { date: fmtDate(k.firstGap.date, true), balance: fmtAmount(k.firstGap.balance), n: k.gapDays })}
              </>
            ) : (
              tt('money.calendar.noGap')
            )}
          </Alert>

          <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
            {[
              [tt('money.calendar.opening'), k.opening.total],
              [tt('money.calendar.planIn'), `+${fmtAmount(k.totals.in)}`],
              [tt('money.calendar.planOut'), `−${fmtAmount(k.totals.out)}`],
              [tt('money.calendar.endBalance'), k.endBalance],
              [tt('money.calendar.minBalance'), k.minBalance],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="faint" style={{ fontSize: 12 }}>{label}</div>
                <div className="num" style={{ fontSize: 18, fontWeight: 600, color: String(value).startsWith('-') ? 'var(--red, #dc2626)' : undefined }}>
                  {/^[+−]/.test(String(value)) ? value : fmtAmount(value)}
                </div>
              </div>
            ))}
          </div>

          <section className="panel" style={{ padding: 12 }} aria-label={tt('money.calendar.chart')}>
            <BalanceChart days={k.days} label={tt('money.calendar.chart')} />
          </section>

          <section aria-label={tt('money.calendar.byDay')}>
            <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{tt('money.calendar.byDay')}</h2>
            <div className="table-wrap">
              <table className="dtbl" aria-label={tt('money.calendar.byDay')}>
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>{tt('money.calendar.colDate')}</th>
                    <th className="r">{tt('money.calendar.colIn')}</th>
                    <th className="r">{tt('money.calendar.colOut')}</th>
                    <th className="r">{tt('money.calendar.colBalance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(d => (
                    <tr key={d.date} data-gap={d.gap || undefined}>
                      <td>{fmtDate(d.date)}</td>
                      <td className="r num">{Number(d.in) ? `+${fmtAmount(d.in)}` : ''}</td>
                      <td className="r num">{Number(d.out) ? `−${fmtAmount(d.out)}` : ''}</td>
                      <td className="r num" style={{ color: d.gap ? 'var(--red, #dc2626)' : undefined, fontWeight: d.gap ? 600 : undefined }}>{fmtAmount(d.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-label={tt('money.calendar.items')}>
            <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{tt('money.calendar.items')}</h2>
            {!k.items.length ? (
              <EmptyState icon={<CircleAlert size={20} />} title={tt('money.calendar.noItems')}>{tt('money.calendar.noItemsHint')}</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="dtbl" aria-label={tt('money.calendar.items')}>
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>{tt('money.calendar.colDate')}</th>
                      <th style={{ width: 110 }}>{tt('money.calendar.colDue')}</th>
                      <th style={{ width: 120 }} />
                      <th>{tt('money.calendar.colDoc')}</th>
                      <th>{tt('money.calendar.colCounterparty')}</th>
                      <th>{tt('money.calendar.colSource')}</th>
                      <th style={{ width: 140 }} className="r">{tt('money.form.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {k.items.map(i => (
                      <tr key={`${i.source}-${i.documentId}`}>
                        <td>{fmtDate(i.date)}</td>
                        <td className="muted">
                          {fmtDate(i.dueDate)} {i.overdue && <Badge tone="red">{tt('money.calendar.overdue')}</Badge>}
                        </td>
                        <td>
                          <Badge tone={i.direction === 'in' ? 'green' : 'amber'}>{i.direction === 'in' ? tt('money.calendar.kindIn') : tt('money.calendar.kindOut')}</Badge>
                        </td>
                        <td className="mono">
                          <Link to={i.source === 'request' ? `/money/requests/${i.documentId}` : `/documents/${i.documentId}`} className="crm-link">
                            {i.source === 'request' ? tt('money.request.title') : typeLabel(i.documentType)} {i.number ?? ''}
                          </Link>
                        </td>
                        <td>{i.counterpartyName}</td>
                        <td className="muted">
                          {i.source === 'request' ? tt('money.calendar.sourceRequest') : tt('money.calendar.sourceDocument')}
                          {i.state ? ` · ${tt(`money.request.states.${i.state as 'pending'}`)}` : ''}
                        </td>
                        <td className="r num">{i.direction === 'in' ? '+' : '−'}{fmtAmount(i.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {k.beyond > 0 && <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>{tt('money.calendar.beyond', { n: k.beyond })}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
