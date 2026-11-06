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
          <table className="dtbl" aria-label={tt('objects.list.table')}>
            <thead>
              <tr>
                <th style={{ width: 120 }}>{tt('objects.field.number')}</th>
                <th>{tt('objects.field.name')}</th>
                <th style={{ width: 220 }}>{tt('objects.field.customer')}</th>
                <th style={{ width: 130 }}>{tt('objects.field.status')}</th>
                <th style={{ width: 110 }}>{tt('objects.field.startDate')}</th>
                <th style={{ width: 110 }}>{tt('objects.field.dueDate')}</th>
                <th style={{ width: 180 }}>{tt('objects.field.manager')}</th>
                <th style={{ width: 180 }}>{tt('objects.field.project')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="mono">
                    <Link to={`/objects/${r.id}`} className="crm-link">
                      {r.number}
                    </Link>
                  </td>
                  <td>{r.name}</td>
                  <td className="muted">{r.customerName ?? '—'}</td>
                  <td>
                    <Badge tone={statusTone(r.status)} dot>
                      {tt(`objects.status.${r.status}`)}
                    </Badge>
                  </td>
                  <td className="muted">{r.startDate ? fmtDate(r.startDate) : '—'}</td>
                  <td className="muted">{r.dueDate ? fmtDate(r.dueDate) : '—'}</td>
                  <td className="muted">{r.managerName ?? '—'}</td>
                  <td className="muted">{r.projectName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

