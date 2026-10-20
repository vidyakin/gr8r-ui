/* Contacts — таблица контактов (DataTable); клик по строке открывает карточку контакта */
import * as React from 'react';
import { Building2, Plus, User, Users } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { useWorkspace } from '../data/store';
import { MemberAvatar } from '../components/workspace';
import { CompanyLink, CompanyLogo, OwnerCell, PersonCell, useOwnerName } from './components';
import { CONTACT_COLUMNS } from './columns';
import { contactRows, type ContactRow } from './selectors';
import { useCrm } from './store';
import { useCrmUi } from './ui-context';

type GroupId = 'none' | 'company' | 'owner';
const GROUPS: { id: GroupId; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'company', name: 'Company' },
  { id: 'owner', name: 'Owner' },
];

export function ContactsPage() {
  const { data } = useCrm();
  const { data: ws } = useWorkspace();
  const ui = useCrmUi();
  const ownerName = useOwnerName();
  const filters = useFilterState();
  const [group, setGroup] = React.useState<GroupId>('none');
  const table = useDataTable(CONTACT_COLUMNS);

  const all = React.useMemo(() => contactRows(data, ownerName), [data, ownerName]);
  const rows = all.filter(r => {
    const v = filters.values;
    if (v.company?.length && !v.company.includes(r.company)) return false;
    if (v.owner?.length && !v.owner.includes(r.owner)) return false;
    return !filters.q.trim() || `${r.name} ${r.companyName} ${r.title} ${r.email}`.toLowerCase().includes(filters.q.trim().toLowerCase());
  });

  const fields: FilterField[] = [
    { id: 'company', name: 'Company', icon: <Building2 size={15} />, options: [...data.companies].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ id: c.id, name: c.name, icon: <CompanyLogo name={c.name} size={14} /> })) },
    { id: 'owner', name: 'Owner', icon: <User size={15} />, options: ws.members.filter(m => m.status === 'active').map(m => ({ id: m.id, name: m.name, icon: <MemberAvatar id={m.id} size="sm" tooltip={false} /> })) },
  ];

  const groupBy =
    group === 'none'
      ? undefined
      : {
          key: (r: ContactRow) => (group === 'company' ? r.company : r.owner),
          label: (k: string) => (group === 'company' ? <CompanyLink id={k} logo /> : <OwnerCell id={k} />),
        };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Contacts</h1>
          <p>{all.length} people across {data.companies.length} companies.</p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => ui.newContact()}>
            <Plus size={14} />
            New contact
          </Button>
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: 'Search contacts' }}
        fields={fields}
        filters={filters}
        sort={{ options: CONTACT_COLUMNS.map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        group={{ options: GROUPS, value: group, onChange: g => setGroup(g as GroupId) }}
        columns={columnsMenu(CONTACT_COLUMNS, table)}
      />
      <DataTable
        aria-label="Contacts table"
        columns={CONTACT_COLUMNS}
        rows={rows}
        table={table}
        getId={r => r.id}
        onRowClick={r => ui.openContact(r.id)}
        groupBy={groupBy}
        onNew={() => ui.newContact()}
        newLabel="New contact"
        renderCard={r => (
          <div className="panel dt-card">
            <div className="dt-card-t">
              <PersonCell name={r.name} />
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {r.title} · {r.companyName}
            </div>
            <div className="faint trunc" style={{ fontSize: 12 }}>
              {r.email}
            </div>
          </div>
        )}
        empty={
          <EmptyState icon={<Users size={20} />} title="No contacts found" action={<Button size="sm" onClick={filters.reset}>Clear filters</Button>}>
            No contacts match these filters.
          </EmptyState>
        }
      />
    </div>
  );
}
