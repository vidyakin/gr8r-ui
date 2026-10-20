/* Companies — таблица компаний (DataTable): отрасль, размер, владелец, открытые сделки, сумма в воронке, последняя активность */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Briefcase, Building2, Plus, Ruler, User } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { useWorkspace } from '../data/store';
import { MemberAvatar } from '../components/workspace';
import { OwnerCell, useOwnerName } from './components';
import { COMPANY_COLUMNS } from './columns';
import { money } from './format';
import { companyRows, type CompanyRow } from './selectors';
import { INDUSTRIES, SIZES } from './stages';
import { useCrm } from './store';
import { useCrmUi } from './ui-context';

type GroupId = 'none' | 'industry' | 'owner' | 'size';
const GROUPS: { id: GroupId; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'industry', name: 'Industry' },
  { id: 'owner', name: 'Owner' },
  { id: 'size', name: 'Size' },
];

export function CompaniesPage() {
  const { data } = useCrm();
  const { data: ws } = useWorkspace();
  const ui = useCrmUi();
  const navigate = useNavigate();
  const ownerName = useOwnerName();
  const filters = useFilterState();
  const [group, setGroup] = React.useState<GroupId>('none');
  const table = useDataTable(COMPANY_COLUMNS);

  const all = React.useMemo(() => companyRows(data, ownerName), [data, ownerName]);
  const rows = all.filter(r => {
    const v = filters.values;
    if (v.industry?.length && !v.industry.includes(r.industry)) return false;
    if (v.owner?.length && !v.owner.includes(r.owner)) return false;
    if (v.size?.length && !v.size.includes(r.size)) return false;
    return !filters.q.trim() || `${r.name} ${r.industry} ${r.city}`.toLowerCase().includes(filters.q.trim().toLowerCase());
  });

  const fields: FilterField[] = [
    { id: 'industry', name: 'Industry', icon: <Briefcase size={15} />, options: INDUSTRIES.map(i => ({ id: i, name: i })) },
    { id: 'owner', name: 'Owner', icon: <User size={15} />, options: ws.members.filter(m => m.status === 'active').map(m => ({ id: m.id, name: m.name, icon: <MemberAvatar id={m.id} size="sm" tooltip={false} /> })) },
    { id: 'size', name: 'Size', icon: <Ruler size={15} />, options: SIZES.map(s => ({ id: s, name: s })) },
  ];

  const groupBy =
    group === 'none'
      ? undefined
      : {
          key: (r: CompanyRow) => String(r[group]),
          order: group === 'size' ? SIZES : undefined,
          label: (k: string) => (group === 'owner' ? <OwnerCell id={k} /> : <span>{k}</span>),
        };

  const pipelineAll = all.reduce((a, r) => a + r.pipeline, 0);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Companies</h1>
          <p>
            {all.length} companies · {money(pipelineAll)} in open deals
          </p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => ui.newCompany()}>
            <Plus size={14} />
            New company
          </Button>
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: 'Search companies' }}
        fields={fields}
        filters={filters}
        sort={{ options: COMPANY_COLUMNS.map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        group={{ options: GROUPS, value: group, onChange: g => setGroup(g as GroupId) }}
        columns={columnsMenu(COMPANY_COLUMNS, table)}
      />
      <DataTable
        aria-label="Companies table"
        columns={COMPANY_COLUMNS}
        rows={rows}
        table={table}
        getId={r => r.id}
        onRowClick={r => navigate(`/crm/companies/${r.id}`)}
        groupBy={groupBy}
        onNew={() => ui.newCompany()}
        newLabel="New company"
        empty={
          <EmptyState icon={<Building2 size={20} />} title="No companies found" action={<Button size="sm" onClick={filters.reset}>Clear filters</Button>}>
            No companies match these filters.
          </EmptyState>
        }
      />
    </div>
  );
}
