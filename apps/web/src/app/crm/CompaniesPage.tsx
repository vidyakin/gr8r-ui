/* Companies — таблица компаний (DataTable): отрасль, размер, владелец, открытые сделки, сумма в воронке, последняя активность */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Briefcase, Building2, Plus, Ruler, User } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { useWorkspace } from '../data/store';
import { MemberAvatar } from '../components/workspace';
import { useT } from '@/i18n';
import { OwnerCell, useOwnerName } from './components';
import { companyColumns } from './columns';
import { money } from './format';
import { companyRows, type CompanyRow } from './selectors';
import { INDUSTRIES, SIZES } from './stages';
import { useCrm } from './store';
import { useCrmUi } from './ui-context';
import { companyGroupName, industryName, sizeName } from './labels';

type GroupId = 'none' | 'industry' | 'owner' | 'size';
const GROUPS: { id: GroupId; icon?: React.ReactNode }[] = [
  { id: 'none' },
  { id: 'industry', icon: <Briefcase size={15} /> },
  { id: 'owner', icon: <User size={15} /> },
  { id: 'size', icon: <Ruler size={15} /> },
];

export function CompaniesPage() {
  const { data } = useCrm();
  const { data: ws } = useWorkspace();
  const ui = useCrmUi();
  const navigate = useNavigate();
  const ownerName = useOwnerName();
  const t = useT();
  const filters = useFilterState();
  const [group, setGroup] = React.useState<GroupId>('none');
  const columns = React.useMemo(() => companyColumns(t), [t]);
  const table = useDataTable(columns);

  const all = React.useMemo(() => companyRows(data, ownerName), [data, ownerName]);
  const rows = all.filter(r => {
    const v = filters.values;
    if (v.industry?.length && !v.industry.includes(r.industry)) return false;
    if (v.owner?.length && !v.owner.includes(r.owner)) return false;
    if (v.size?.length && !v.size.includes(r.size)) return false;
    return !filters.q.trim() || `${r.name} ${r.industry} ${r.city}`.toLowerCase().includes(filters.q.trim().toLowerCase());
  });

  const fields: FilterField[] = [
    { id: 'industry', name: t('crm.companies.col.industry'), icon: <Briefcase size={15} />, options: INDUSTRIES.map(i => ({ id: i, name: industryName(i, i) })) },
    { id: 'owner', name: t('crm.companies.col.owner'), icon: <User size={15} />, options: ws.members.filter(m => m.status === 'active').map(m => ({ id: m.id, name: m.name + (m.id === ws.me ? t('crm.deals.you') : ''), icon: <MemberAvatar id={m.id} size="sm" tooltip={false} /> })) },
    { id: 'size', name: t('crm.companies.col.size'), icon: <Ruler size={15} />, options: SIZES.map(s => ({ id: s, name: sizeName(s, s) })) },
  ];

  const groupOptions = GROUPS.map(g => ({ id: g.id, name: companyGroupName(g.id, g.id), icon: g.icon }));

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
          <h1>{t('crm.companies.title')}</h1>
          <p>{t('crm.companies.summary', { count: all.length, amount: money(pipelineAll) })}</p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => ui.newCompany()}>
            <Plus size={14} />
            {t('crm.companies.newCompany')}
          </Button>
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('crm.companies.searchPlaceholder') }}
        fields={fields}
        filters={filters}
        sort={{ options: columns.map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        group={{ options: groupOptions, value: group, onChange: g => setGroup(g as GroupId) }}
        columns={columnsMenu(columns, table)}
      />
      <DataTable
        aria-label={t('crm.companies.table')}
        columns={columns}
        rows={rows}
        table={table}
        getId={r => r.id}
        onRowClick={r => navigate(`/crm/companies/${r.id}`)}
        groupBy={groupBy}
        onNew={() => ui.newCompany()}
        newLabel={t('crm.companies.newCompany')}
        empty={
          <EmptyState icon={<Building2 size={20} />} title={t('crm.companies.noResults')} action={<Button size="sm" onClick={filters.reset}>{t('crm.companies.clearFilters')}</Button>}>
            {t('crm.companies.noResultsHint')}
          </EmptyState>
        }
      />
    </div>
  );
}
