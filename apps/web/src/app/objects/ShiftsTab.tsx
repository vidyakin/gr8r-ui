/* Табель объекта (задача 1271): вкладка карточки объекта — смены по датам (статус, часы, сумма только owner/admin),
   табель за месяц (работники × дни по подтверждённым сменам) и кнопка «Открыть смену».
   Суммы сервер отдаёт только owner/admin (иначе null) — интерфейс показывает прочерк. */
import * as React from 'react';
import { Link } from 'react-router';
import { CircleAlert, Plus } from 'lucide-react';
import { Badge, EmptyState, Input, Skeleton } from '@/components/ui';
import { fmtAmount, fmtNumber } from '@/i18n/format';
import { useT } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { useObjectShifts, useObjectTimesheet } from './shifts-data';

/** Первый и последний день месяца из значения input type="month" */
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function ShiftsTab({ objectId }: { objectId: string }) {
  const tt = useT();
  const [month, setMonth] = React.useState(currentMonth());
  const { from, to } = monthRange(month);
  const shifts = useObjectShifts(objectId, from, to);
  const timesheet = useObjectTimesheet(objectId, from, to);

  if (shifts.isPending || timesheet.isPending) return <Skeleton w="100%" h={140} />;
  if (shifts.isError || timesheet.isError) return <EmptyState icon={<CircleAlert size={20} />} error title={tt('objects.common.error')} />;
  const list = shifts.data.items;
  const sheet = timesheet.data;
  const canSeeCost = shifts.data.canSeeCost;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ maxWidth: 180 }}>
          <Input type="month" aria-label={tt('shifts.tab.month')} value={month} onChange={e => setMonth(e.target.value || currentMonth())} />
        </div>
        <span className="sp" />
        <Link className="btn btn-primary" to={`/shifts?object=${objectId}&date=${new Date().toISOString().slice(0, 10)}`}>
          <Plus size={14} />
          {tt('shifts.tab.open')}
        </Link>
      </div>

      <section className="panel panel-b stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>{tt('shifts.tab.shifts')}</h3>
        {list.length ? (
          <div className="table-wrap">
            <table className="dtbl" aria-label={tt('shifts.tab.shifts')}>
              <thead>
                <tr>
                  <th style={{ width: 130 }}>{tt('shifts.field.date')}</th>
                  <th style={{ width: 130 }}>{tt('objects.field.status')}</th>
                  <th>{tt('shifts.field.foreman')}</th>
                  <th style={{ width: 100 }} className="r">{tt('shifts.total.hours')}</th>
                  <th style={{ width: 120 }} className="r">{tt('shifts.tab.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {list.map(s => (
                  <tr key={s.id}>
                    <td>
                      <Link className="crm-link" to={`/shifts/${s.id}`}>
                        {fmtDate(s.workDate)}
                      </Link>
                    </td>
                    <td>
                      <Badge tone={s.status === 'confirmed' ? 'green' : 'gray'}>{tt(`shifts.status.${s.status}`)}</Badge>
                    </td>
                    <td className="muted">
                      {s.foremanName} · {tt('shifts.tab.employees', { n: s.employees })}
                      {s.noRate > 0 && <span className="faint"> · {tt('shifts.tab.noRate')}</span>}
                    </td>
                    <td className="r num">{fmtNumber(Number(s.totalHours), { maximumFractionDigits: 2 })}</td>
                    <td className="r num">{canSeeCost ? (s.totalAmount == null ? '—' : fmtAmount(s.totalAmount)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="faint" style={{ margin: 0, fontSize: 12 }}>{tt('shifts.tab.shiftsEmpty')}</p>
        )}
      </section>

      <section className="panel panel-b stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>{tt('shifts.tab.timesheet')}</h3>
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>{tt('shifts.tab.timesheetHint')}</p>
        {sheet.rows.length ? (
          <div className="shift-timesheet">
            <table aria-label={tt('shifts.tab.timesheet')}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>{tt('shifts.tab.employee')}</th>
                  {sheet.days.map(d => (
                    <th key={d} style={{ textAlign: 'right' }}>
                      {Number(d.slice(8, 10))}
                    </th>
                  ))}
                  <th style={{ textAlign: 'right' }}>{tt('shifts.tab.total')}</th>
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map(r => (
                  <tr key={r.memberId}>
                    <td>
                      {r.memberName}
                      {r.personnelNumber ? <span className="faint"> · {r.personnelNumber}</span> : null}
                    </td>
                    {r.hours.map((h, i) => (
                      <td key={sheet.days[i]} className="num" style={{ textAlign: 'right' }}>
                        {Number(h) ? fmtNumber(Number(h), { maximumFractionDigits: 2 }) : '·'}
                      </td>
                    ))}
                    <td className="num" style={{ textAlign: 'right' }}>{fmtNumber(Number(r.total), { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>{tt('shifts.tab.total')}</strong>
                  </td>
                  {sheet.totalByDay.map((h, i) => (
                    <td key={sheet.days[i]} className="num" style={{ textAlign: 'right' }}>
                      {fmtNumber(Number(h), { maximumFractionDigits: 2 })}
                    </td>
                  ))}
                  <td className="num" style={{ textAlign: 'right' }}>
                    <strong>{fmtNumber(Number(sheet.total), { maximumFractionDigits: 2 })}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="faint" style={{ margin: 0, fontSize: 12 }}>{tt('shifts.tab.empty')}</p>
        )}
      </section>
    </div>
  );
}
