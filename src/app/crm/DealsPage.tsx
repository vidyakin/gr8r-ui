/* Deals — воронка продаж: доска по этапам (Kanban) и таблица (DataTable) с фильтрами, сортировкой и группировкой */
import * as React from 'react';
import { Building2, CircleDot, Plus, SquareKanban, Table2, User } from 'lucide-react';
import { Button, EmptyState, Segmented } from '@/components/ui';
import { DataTable, columnsMenu, sortRows, useDataTable } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { Kanban } from '@/components/gr8r/kanban';
import { useWorkspace } from '../data/store';
import { MemberAvatar } from '../components/workspace';
import { CompanyLink, CompanyLogo, DealCard, OwnerCell, StageIcon, StageLabel, useOwnerName } from './components';
import { DEAL_COLUMNS, DEAL_SORTS } from './columns';
import { money, pct } from './format';
import { dealRows, filterDeals, pipeline, sumAmount, sumWeighted, type DealRow } from './selectors';
import { STAGES, isOpen } from './stages';
import { useCrm } from './store';
import { useCrmUi } from './ui-context';
import type { StageId } from './types';

type Mode = 'board' | 'table';
type GroupId = 'stage' | 'owner' | 'company' | 'none';

const GROUPS: { id: GroupId; name: string; icon?: React.ReactNode }[] = [
  { id: 'stage', name: 'Stage', icon: <CircleDot size={15} /> },
  { id: 'owner', name: 'Owner', icon: <User size={15} /> },
  { id: 'company', name: 'Company', icon: <Building2 size={15} /> },
  { id: 'none', name: 'None' },
];

export function DealsPage() {
  const { data } = useCrm();
  const { data: ws } = useWorkspace();
  const ui = useCrmUi();
  const ownerName = useOwnerName();
  const filters = useFilterState();
  const [mode, setMode] = React.useState<Mode>('board');
  const [group, setGroup] = React.useState<GroupId>('stage');
  const table = useDataTable(DEAL_COLUMNS);

  const all = React.useMemo(() => dealRows(data, ownerName), [data, ownerName]);
  const rows = React.useMemo(() => filterDeals(data, all, { q: filters.q, owner: filters.values.owner, company: filters.values.company, stage: filters.values.stage }).sort((a, b) => a.order - b.order), [data, all, filters.q, filters.values]);
  // Порядок карточек на доске: ручной (order) или по выбранному полю сортировки
  const ordered = React.useMemo(() => sortRows(rows, DEAL_COLUMNS, table.sort), [rows, table.sort]);
  const total = pipeline(data.deals);

  const fields: FilterField[] = [
    { id: 'owner', name: 'Owner', icon: <User size={15} />, options: ws.members.filter(m => m.status === 'active').map(m => ({ id: m.id, name: m.name + (m.id === ws.me ? ' (you)' : ''), icon: <MemberAvatar id={m.id} size="sm" tooltip={false} /> })) },
    { id: 'company', name: 'Company', icon: <Building2 size={15} />, options: [...data.companies].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ id: c.id, name: c.name, icon: <CompanyLogo name={c.name} size={14} /> })) },
    { id: 'stage', name: 'Stage', icon: <CircleDot size={15} />, options: STAGES.map(s => ({ id: s.id, name: s.name, icon: <StageIcon stage={s.id} /> })) },
  ];

  const groupBy =
    group === 'none'
      ? undefined
      : group === 'stage'
        ? { key: (r: DealRow) => r.stage, order: STAGES.map(s => s.id), label: (k: string) => <StageLabel stage={k as StageId} /> }
        : group === 'owner'
          ? { key: (r: DealRow) => r.owner, label: (k: string) => <OwnerCell id={k} /> }
          : { key: (r: DealRow) => r.company, label: (k: string) => <CompanyLink id={k} logo /> };

  const columns = STAGES.map(s => {
    const list = rows.filter(r => r.stage === s.id);
    const open = isOpen(s.id);
    return {
      id: s.id,
      title: s.name,
      icon: <StageIcon stage={s.id} />,
      subtitle: (
        <>
          <b className="num">{money(sumAmount(list))}</b>
        </>
      ),
      footer: open ? (
        <>
          <span>
            Weighted · {pct(s.p)}
          </span>
          <b className="num">{money(sumWeighted(list))}</b>
        </>
      ) : undefined,
    };
  });

  const noDeals = !data.deals.length;

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Deals</h1>
          <p>
            {total.count} open deals · {money(total.amount)} in pipeline · {money(total.weighted)} weighted
          </p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => ui.newDeal()}>
            <Plus size={14} />
            New deal
          </Button>
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: 'Search deals' }}
        fields={fields}
        filters={filters}
        sort={{ options: DEAL_SORTS, value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        group={mode === 'table' ? { options: GROUPS, value: group, onChange: g => setGroup(g as GroupId) } : undefined}
        columns={mode === 'table' ? columnsMenu(DEAL_COLUMNS, table) : undefined}
        right={
          <Segmented
            aria-label="View"
            value={mode}
            onValueChange={setMode}
            items={[
              { value: 'board', label: <span className="hide-m">Board</span>, icon: <SquareKanban size={13} />, 'aria-label': 'Board' },
              { value: 'table', label: <span className="hide-m">Table</span>, icon: <Table2 size={13} />, 'aria-label': 'Table' },
            ]}
          />
        }
      />
      {noDeals ? (
        <EmptyState icon={<SquareKanban size={20} />} title="No deals yet" action={<Button size="sm" variant="primary" onClick={() => ui.newDeal()}><Plus size={14} />New deal</Button>}>
          Create the first deal to start filling the pipeline.
        </EmptyState>
      ) : mode === 'board' ? (
        <Kanban
          aria-label="Deals pipeline"
          columns={columns}
          items={ordered}
          getId={r => r.id}
          getColumn={r => r.stage}
          renderCard={r => <DealCard deal={r} />}
          onMove={(r, col, before) => ui.moveDeal(r.id, col as StageId, before)}
          onAdd={col => ui.newDeal({ stage: col as StageId })}
          canAdd={col => isOpen(col as StageId)}
          addLabel="Add deal"
        />
      ) : (
        <DataTable
          aria-label="Deals table"
          columns={DEAL_COLUMNS}
          rows={rows}
          table={table}
          getId={r => r.id}
          onRowClick={r => ui.openDeal(r.id)}
          groupBy={groupBy}
          onNew={() => ui.newDeal()}
          newLabel="New deal"
          empty={
            <EmptyState icon={<SquareKanban size={20} />} title="No results found" action={<Button size="sm" onClick={filters.reset}>Clear filters</Button>}>
              No deals match these filters.
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
