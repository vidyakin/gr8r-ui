/* Deals — воронка продаж: доска по этапам (Kanban) и таблица (DataTable) с фильтрами, сортировкой и группировкой */
import * as React from 'react';
import { Building2, CircleDot, Plus, SquareKanban, Table2, User } from 'lucide-react';
import { Button, EmptyState, Segmented } from '@/components/ui';
import { DataTable, columnsMenu, sortRows, useDataTable } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { Kanban } from '@/components/gr8r/kanban';
import { useWorkspace } from '../data/store';
import { MemberAvatar } from '../components/workspace';
import { useT } from '@/i18n';
import { CompanyLink, CompanyLogo, DealCard, OwnerCell, StageIcon, StageLabel, useOwnerName } from './components';
import { dealColumns, dealSorts } from './columns';
import { money, pct } from './format';
import { dealRows, filterDeals, pipeline, sumAmount, sumWeighted, type DealRow } from './selectors';
import { STAGES, isOpen } from './stages';
import { useCrm } from './store';
import { useCrmUi } from './ui-context';
import { stageName, dealGroupName } from './labels';
import type { StageId } from './types';
import { useMembersWith } from '../positions/data';

type Mode = 'board' | 'table';
type GroupId = 'stage' | 'owner' | 'company' | 'none';

const GROUPS: { id: GroupId; icon?: React.ReactNode }[] = [
  { id: 'stage', icon: <CircleDot size={15} /> },
  { id: 'owner', icon: <User size={15} /> },
  { id: 'company', icon: <Building2 size={15} /> },
  { id: 'none' },
];

export function DealsPage() {
  const { data } = useCrm();
  const { data: ws } = useWorkspace();
  const ui = useCrmUi();
  const ownerName = useOwnerName();
  const t = useT();
  const filters = useFilterState();
  const [mode, setMode] = React.useState<Mode>('board');
  const [group, setGroup] = React.useState<GroupId>('stage');
  const columns = React.useMemo(() => dealColumns(t), [t]);
  const table = useDataTable(columns);
  const ownerCandidates = useMembersWith(ws.members.filter(m => m.status === 'active'), 'sales_manager'); // менеджеры продаж (задача 1172)

  const all = React.useMemo(() => dealRows(data, ownerName), [data, ownerName]);
  const rows = React.useMemo(() => filterDeals(data, all, { q: filters.q, owner: filters.values.owner, company: filters.values.company, stage: filters.values.stage }).sort((a, b) => a.order - b.order), [data, all, filters.q, filters.values]);
  // Порядок карточек на доске: ручной (order) или по выбранному полю сортировки
  const ordered = React.useMemo(() => sortRows(rows, columns, table.sort), [rows, columns, table.sort]);
  const total = pipeline(data.deals);

  const fields: FilterField[] = [
    { id: 'owner', name: t('crm.deals.col.owner'), icon: <User size={15} />, options: ownerCandidates.map(m => ({ id: m.id, name: m.name + (m.id === ws.me ? t('crm.deals.you') : ''), icon: <MemberAvatar id={m.id} size="sm" tooltip={false} /> })) },
    { id: 'company', name: t('crm.deals.col.company'), icon: <Building2 size={15} />, options: [...data.companies].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ id: c.id, name: c.name, icon: <CompanyLogo name={c.name} size={14} /> })) },
    { id: 'stage', name: t('crm.deals.col.stage'), icon: <CircleDot size={15} />, options: STAGES.map(s => ({ id: s.id, name: stageName(s.id, s.name), icon: <StageIcon stage={s.id} /> })) },
  ];

  const groupOptions = GROUPS.map(g => ({ id: g.id, name: dealGroupName(g.id, g.id), icon: g.icon }));

  const groupBy =
    group === 'none'
      ? undefined
      : group === 'stage'
        ? { key: (r: DealRow) => r.stage, order: STAGES.map(s => s.id), label: (k: string) => <StageLabel stage={k as StageId} /> }
        : group === 'owner'
          ? { key: (r: DealRow) => r.owner, label: (k: string) => <OwnerCell id={k} /> }
          : { key: (r: DealRow) => r.company, label: (k: string) => <CompanyLink id={k} logo /> };

  const kanbanColumns = STAGES.map(s => {
    const list = rows.filter(r => r.stage === s.id);
    const open = isOpen(s.id);
    return {
      id: s.id,
      title: stageName(s.id, s.name),
      icon: <StageIcon stage={s.id} />,
      subtitle: (
        <>
          <b className="num">{money(sumAmount(list))}</b>
        </>
      ),
      footer: open ? (
        <>
          <span>
            {t('crm.deals.weightedFoot', { pct: pct(s.p) })}
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
          <h1>{t('crm.deals.title')}</h1>
          <p>{t('crm.deals.summary', { count: total.count, amount: money(total.amount), weighted: money(total.weighted) })}</p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => ui.newDeal()}>
            <Plus size={14} />
            {t('crm.deals.newDeal')}
          </Button>
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('crm.deals.searchPlaceholder') }}
        fields={fields}
        filters={filters}
        sort={{ options: dealSorts(t), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        group={mode === 'table' ? { options: groupOptions, value: group, onChange: g => setGroup(g as GroupId) } : undefined}
        columns={mode === 'table' ? columnsMenu(columns, table) : undefined}
        left={
          <Segmented
            aria-label="View"
            value={mode}
            onValueChange={setMode}
            items={[
              { value: 'board', label: <span className="hide-m">{t('crm.deals.viewBoard')}</span>, icon: <SquareKanban size={13} />, 'aria-label': t('crm.deals.viewBoard') },
              { value: 'table', label: <span className="hide-m">{t('crm.deals.viewTable')}</span>, icon: <Table2 size={13} />, 'aria-label': t('crm.deals.viewTable') },
            ]}
          />
        }
      />
      {noDeals ? (
        <EmptyState icon={<SquareKanban size={20} />} title={t('crm.deals.noDeals')} action={<Button size="sm" variant="primary" onClick={() => ui.newDeal()}><Plus size={14} />{t('crm.deals.newDeal')}</Button>}>
          {t('crm.deals.noDealsHint')}
        </EmptyState>
      ) : mode === 'board' ? (
        <Kanban
          aria-label={t('crm.deals.title')}
          columns={kanbanColumns}
          items={ordered}
          getId={r => r.id}
          getColumn={r => r.stage}
          renderCard={r => <DealCard deal={r} />}
          onMove={(r, col, before) => ui.moveDeal(r.id, col as StageId, before)}
          onAdd={col => ui.newDeal({ stage: col as StageId })}
          canAdd={col => isOpen(col as StageId)}
          addLabel={t('crm.deals.addDeal')}
        />
      ) : (
        <DataTable
          aria-label={t('crm.deals.table')}
          columns={columns}
          rows={rows}
          table={table}
          getId={r => r.id}
          onRowClick={r => ui.openDeal(r.id)}
          groupBy={groupBy}
          onNew={() => ui.newDeal()}
          newLabel={t('crm.deals.newDeal')}
          empty={
            <EmptyState icon={<SquareKanban size={20} />} title={t('crm.deals.noResults')} action={<Button size="sm" onClick={filters.reset}>{t('crm.deals.clearFilters')}</Button>}>
              {t('crm.deals.noResultsHint')}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
