/* Отчёты услуг (задача 1097): один экран /services/reports, вкладка — в адресе (?tab=).
   Общие отборы: период, клиент, исполнитель, вид заказ-наряда. Каркас таблиц, графиков и состояний — из отчётов производства. */
import * as React from 'react';
import { useSearchParams } from 'react-router';
import { X } from 'lucide-react';
import { Field, IconButton, Input, Select } from '@/components/ui';
import { useT, type TKey } from '@/i18n';
import { iso, today } from '../../lib/dates';
import { useWorkspace } from '../../data/store';
import { useWorkOrderKinds } from '../../docs/data';
import { CounterpartyPicker } from '../../docs/pickers';
import { ClientsTab } from './ClientsTab';
import { LoadTab } from './LoadTab';
import { ScheduleTab } from './ScheduleTab';
import { StatesTab } from './StatesTab';
import type { ServiceReportFilter } from './service-reports-data';

export interface ServiceTabProps {
  filter: ServiceReportFilter;
}

interface ServiceTabDef {
  id: string;
  label: TKey;
  Component: React.ComponentType<ServiceTabProps>;
}

/** Реестр вкладок: порядок — порядок в интерфейсе */
export const SERVICE_REPORT_TABS: ServiceTabDef[] = [
  { id: 'states', label: 'serviceReports.tab.states', Component: StatesTab },
  { id: 'schedule', label: 'serviceReports.tab.schedule', Component: ScheduleTab },
  { id: 'load', label: 'serviceReports.tab.load', Component: LoadTab },
  { id: 'clients', label: 'serviceReports.tab.clients', Component: ClientsTab },
];

const ALL = 'all';
const monthStart = () => iso(new Date(today().getFullYear(), today().getMonth(), 1));

export function ServiceReportsPage() {
  const tt = useT();
  const [sp, setSp] = useSearchParams();
  const tab = SERVICE_REPORT_TABS.find(x => x.id === sp.get('tab')) ?? SERVICE_REPORT_TABS[0]!;
  const members = useWorkspace().data.members;
  const kinds = useWorkOrderKinds();
  const [from, setFrom] = React.useState(monthStart());
  const [to, setTo] = React.useState(iso(today()));
  const [client, setClient] = React.useState<{ id: string; name: string } | null>(null);
  const [assignee, setAssignee] = React.useState(ALL);
  const [kind, setKind] = React.useState(ALL);
  const filter: ServiceReportFilter = { from, to, counterpartyId: client?.id, assigneeId: assignee === ALL ? undefined : assignee, kindId: kind === ALL ? undefined : kind };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('serviceReports.title')}</h1>
          <p>{tt('serviceReports.subtitle')}</p>
        </div>
      </div>

      <nav className="tabs doc-tabs" aria-label={tt('serviceReports.tabs')}>
        {SERVICE_REPORT_TABS.map(x => (
          <button key={x.id} type="button" className={`tab${x.id === tab.id ? ' on' : ''}`} aria-current={x.id === tab.id ? 'page' : undefined} onClick={() => setSp({ tab: x.id }, { replace: true })}>
            {tt(x.label)}
          </button>
        ))}
      </nav>

      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={tt('serviceReports.filters.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || monthStart())} />}</Field>
          <Field label={tt('serviceReports.filters.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || iso(today()))} />}</Field>
          <Field label={tt('serviceReports.filters.client')}>
            {p => (
              <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                <CounterpartyPicker id={p.id} value={client?.name ?? ''} placeholder={tt('serviceReports.filters.clientPlaceholder')} onPick={c => setClient({ id: c.id, name: c.name })} />
                {client && (
                  <IconButton label={tt('serviceReports.filters.clearClient')} onClick={() => setClient(null)}>
                    <X size={14} />
                  </IconButton>
                )}
              </div>
            )}
          </Field>
          <Field label={tt('serviceReports.filters.assignee')}>
            {p => <Select id={p.id} value={assignee} onValueChange={setAssignee} options={[{ value: ALL, label: tt('serviceReports.filters.allAssignees') }, ...members.map(m => ({ value: m.id, label: m.name }))]} aria-label={tt('serviceReports.filters.assignee')} />}
          </Field>
          <Field label={tt('serviceReports.filters.kind')}>
            {p => <Select id={p.id} value={kind} onValueChange={setKind} options={[{ value: ALL, label: tt('serviceReports.filters.allKinds') }, ...(kinds.data ?? []).map(k => ({ value: k.id, label: k.name }))]} aria-label={tt('serviceReports.filters.kind')} />}
          </Field>
        </div>
      </section>

      <tab.Component filter={filter} />
    </div>
  );
}
