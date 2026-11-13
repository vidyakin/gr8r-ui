/* Объекты объектного учёта (задача 1268): список с поиском и фильтром по статусу. */
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { Building2, CircleAlert, FilePlus2 } from 'lucide-react';
import { OBJECT_STATUSES, type ObjectStatus } from '@gr8r/shared';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { useObjects } from './data';

export const statusTone = (s: ObjectStatus) => (s === 'active' ? 'green' : s === 'done' || s === 'closed' ? 'neutral' : s === 'hold' ? 'amber' : 'gray');

export function ObjectsPage() {
  const tt = useT();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState<ObjectStatus | ''>('');
  const list = useObjects({ q: q || undefined, status: status || undefined });
  const rows = list.data?.items ?? [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('objects.list.title')}</h1>
          <p>{tt('objects.list.subtitle')}</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button variant="primary" onClick={() => void navigate('/objects/new')}>
              <FilePlus2 size={14} />
              {tt('objects.list.new')}
            </Button>
          )}
        </div>
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px' }}>
        <Field label={tt('objects.list.search')}>{p => <Input {...p} value={q} onChange={e => setQ(e.target.value)} placeholder={tt('objects.list.search')} />}</Field>
        <Field label={tt('objects.list.status')}>
          {p => (
            <Select
              {...p}
              value={status || 'all'}
              onValueChange={v => setStatus(v === 'all' ? '' : (v as ObjectStatus))}
              options={[{ value: 'all', label: tt('objects.list.allStatuses') }, ...OBJECT_STATUSES.map(s => ({ value: s, label: tt(`objects.status.${s}`) }))]}
            />
          )}
        </Field>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('objects.list.title')} action={<Button size="sm" onClick={() => list.refetch()}>{tt('objects.common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<Building2 size={20} />} title={tt('objects.list.empty')}>
          {tt('objects.list.emptyHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          {/* строка объекта в два ряда: код на оба ряда; 1-й — название, дата начала, статус; 2-й — заказчик, проект, дата окончания, ответственный */}
          <table className="dtbl two-row" aria-label={tt('objects.list.table')}>
            <colgroup>
              <col style={{ width: 120 }} />
              <col />
              <col />
              <col style={{ width: 130 }} />
              <col style={{ width: 200 }} />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2}>{tt('objects.field.number')}</th>
                <th colSpan={2}>{tt('objects.field.name')}</th>
                <th>{tt('objects.field.startDate')}</th>
                <th>{tt('objects.field.status')}</th>
              </tr>
              <tr>
                <th>{tt('objects.field.customer')}</th>
                <th>{tt('objects.field.project')}</th>
                <th>{tt('objects.field.dueDate')}</th>
                <th>{tt('objects.field.manager')}</th>
              </tr>
            </thead>
            {rows.map(r => (
              <tbody key={r.id}>
                <tr>
                  <td className="mono" rowSpan={2}>
                    <Link to={`/objects/${r.id}`} className="crm-link">
                      {r.number}
                    </Link>
                  </td>
                  <td colSpan={2} style={{ fontWeight: 500 }}>{r.name}</td>
                  <td className="muted">{r.startDate ? fmtDate(r.startDate) : '—'}</td>
                  <td>
                    <Badge tone={statusTone(r.status)} dot>
                      {tt(`objects.status.${r.status}`)}
                    </Badge>
                  </td>
                </tr>
                <tr>
                  <td className="muted">{r.customerName ?? '—'}</td>
                  <td className="muted">{r.projectName ?? '—'}</td>
                  <td className="muted">{r.dueDate ? fmtDate(r.dueDate) : '—'}</td>
                  <td className="muted">{r.managerName ?? '—'}</td>
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}

