/* Табель сотрудника: время, записанное по задачам модуля services, — по заказчику и виду работ.
   Отдельного документа-табеля нет: это отчёт по журналу времени (time_logs). */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { CalendarClock, CircleAlert, Clock3 } from 'lucide-react';
import { Button, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { useTimesheet } from './data';

export function TimesheetPage() {
  const navigate = useNavigate();
  const members = useWorkspace().data.members;
  const [memberId, setMemberId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const sheet = useTimesheet({ memberId: memberId || undefined, from: from || undefined, to: to || undefined });
  const rows = sheet.data?.items ?? [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Timesheet</h1>
          <p>Time logged on the tasks of the Services module: rows by customer and kind of work. A member sees their own hours, managers see everyone.</p>
        </div>
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px' }}>
        <Field label="Member">
          {p => <Select id={p.id} value={memberId || undefined} onValueChange={setMemberId} options={members.map(m => ({ value: m.id, label: m.name }))} placeholder="All members" aria-label="Member" />}
        </Field>
        <Field label="From">{p => <Input {...p} type="date" value={from} onChange={e => setFrom(e.target.value)} />}</Field>
        <Field label="To">{p => <Input {...p} type="date" value={to} onChange={e => setTo(e.target.value)} />}</Field>
      </div>
      {sheet.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load the timesheet" action={<Button size="sm" onClick={() => sheet.refetch()}>Retry</Button>}>
          {(sheet.error as Error).message}
        </EmptyState>
      ) : sheet.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<CalendarClock size={20} />} title="No hours for this period">
          Time is logged in the task of a work order or in a task of the Services module with a customer.
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label="Timesheet">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Date</th>
                <th style={{ width: 160 }}>Member</th>
                <th style={{ width: 200 }}>Customer</th>
                <th>Work</th>
                <th style={{ width: 90 }} className="r">
                  Hours
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.taskId}-${r.logDate}-${i}`}>
                  <td className="num muted">{r.logDate}</td>
                  <td className="trunc">{r.memberName}</td>
                  <td className="trunc">
                    {r.companyName ?? <span className="faint">—</span>}
                    {r.documentNumber && <span className="mono faint"> {r.documentNumber}</span>}
                  </td>
                  <td className="trunc">
                    {r.workName ?? r.title}
                    <span className="mono faint"> {r.taskKey}</span>
                  </td>
                  <td className="r num">{r.hours}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4} className="r">
                  Total
                </th>
                <th className="r num">{sheet.data?.totals.hours ?? '0'}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {!!sheet.data?.totals.byMember.length && (
        <div className="row" style={{ gap: 12, padding: '0 var(--gutter) 24px' }}>
          {sheet.data.totals.byMember.map(m => (
            <span key={m.memberId} className="muted" style={{ fontSize: 12.5 }}>
              <Clock3 size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              {m.memberName}: <span className="num">{m.hours}</span> h
            </span>
          ))}
        </div>
      )}
      <p className="faint" style={{ padding: '0 var(--gutter) 24px' }}>
        Hours are logged in the task: open the task and add time to see it here.
        <button type="button" className="crm-link" style={{ marginLeft: 6 }} onClick={() => navigate('/tasks?module=services')}>
          Tasks of the Services module
        </button>
      </p>
    </div>
  );
}
