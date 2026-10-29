/* Deals — воронка продаж: доска по этапам (Kanban) и таблица (DataTable) с фильтрами, сортировкой и группировкой */
import * as React from 'react';
import { Building2, CircleDot, Plus, SquareKanban, Table2, User } from 'lucide-react';
import { Button, Checkbox, EmptyState, Segmented } from '@/components/ui';
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
import { stage, stagesOf } from './stages';
import { useCrm } from './store';
import { useCrmUi } from './ui-context';
import { dealGroupName } from './labels';
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
  const { data, pipes } = useCrm();
  const { data: ws } = useWorkspace();
  const ui = useCrmUi();
  const ownerName = useOwnerName();
  const t = useT();
  const filters = useFilterState();
  const [mode, setMode] = React.useState<Mode>('board');
  const [group, setGroup] = React.useState<GroupId>('stage');
  // выбранная воронка (запоминается в браузере: настройка вида)
  const [pipelineId, setPipelineId] = React.useState<string>(() => {
    try {
      return localStorage.getItem('crm.deals.pipeline') ?? '';
    } catch {
      return '';
    }
  });
  const pipelineList = pipes.pipelines;
  const activePipeline = pipelineList.find(p => p.id === pipelineId) ?? pipelineList.find(p => p.isDefault) ?? pipelineList[0];
  const choosePipeline = (id: string) => {
    setPipelineId(id);
    try {
      localStorage.setItem('crm.deals.pipeline', id);
    } catch {
      /* без хранилища выбор живёт до перезагрузки */
    }
  };
  const [onlyOverdue, setOnlyOverdue] = React.useState(false);
  const stages = activePipeline ? stagesOf(activePipeline.id) : [];
  const columns = React.useMemo(() => dealColumns(t), [t]);
  const table = useDataTable(columns);
  const ownerCandidates = useMembersWith(ws.members.filter(m => m.status === 'active'), 'sales_manager'); // менеджеры продаж (задача 1172)

  const pipelineDeals = React.useMemo(() => data.deals.filter(d => stage(d.stage).pipelineId === activePipeline?.id), [data.deals, activePipeline?.id]);
  const all = React.useMemo(() => dealRows(data, ownerName, pipelineDeals), [data, ownerName, pipelineDeals]);
  const rows = React.useMemo(() => filterDeals(data, all, { q: filters.q, owner: filters.values.owner, company: filters.values.company, stage: filters.values.stage, overdue: onlyOverdue }).sort((a, b) => a.order - b.order), [data, all, filters.q, filters.values, onlyOverdue]);
  // Порядок карточек на доске: ручной (order) или по выбранному полю сортировки
  const ordered = React.useMemo(() => sortRows(rows, columns, table.sort), [rows, columns, table.sort]);
  const total = pipeline(pipelineDeals);

  const fields: FilterField[] = [
    { id: 'owner', name: t('crm.deals.col.owner'), icon: <User size={15} />, options: ownerCandidates.map(m => ({ id: m.id, name: m.name + (m.id === ws.me ? t('crm.deals.you') : ''), icon: <MemberAvatar id={m.id} size="sm" tooltip={false} /> })) },
    { id: 'company', name: t('crm.deals.col.company'), icon: <Building2 size={15} />, options: [...data.companies].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ id: c.id, name: c.name, icon: <CompanyLogo name={c.name} size={14} /> })) },
    { id: 'stage', name: t('crm.deals.col.stage'), icon: <CircleDot size={15} />, options: stages.map(s => ({ id: s.id, name: s.name, icon: <StageIcon stage={s.id} /> })) },
  ];

  const groupOptions = GROUPS.map(g => ({ id: g.id, name: dealGroupName(g.id, g.id), icon: g.icon }));

  const groupBy =
    group === 'none'
      ? undefined
      : group === 'stage'
        ? { key: (r: DealRow) => r.stage, order: stages.map(s => s.id), label: (k: string) => <StageLabel stage={k as StageId} /> }
        : group === 'owner'
          ? { key: (r: DealRow) => r.owner, label: (k: string) => <OwnerCell id={k} /> }
          : { key: (r: DealRow) => r.company, label: (k: string) => <CompanyLink id={k} logo /> };

  const kanbanColumns = stages.map(s => {
    const list = rows.filter(r => r.stage === s.id);
    const open = s.category === 'in_progress';
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
            {t('crm.deals.weightedFoot', { pct: pct(s.p) })}
          </span>
          <b className="num">{money(sumWeighted(list))}</b>
        </>
      ) : undefined,
    };
  });

  const noDeals = !pipelineDeals.length;

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('crm.deals.title')}</h1>
          <p>{t('crm.deals.summary', { count: total.count, amount: money(total.amount), weighted: money(total.weighted) })}</p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => ui.newDeal({ pipeline: activePipeline?.id })}>
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
          <>
          {pipelineList.length > 1 && (
            <select className="select" aria-label={t('crm.pipelines.pipeline')} value={activePipeline?.id ?? ''} onChange={e => choosePipeline(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
              {pipelineList.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <label className="row" style={{ gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <Checkbox checked={onlyOverdue} onChange={() => setOnlyOverdue(v => !v)} />
            {t('crm.pipelines.onlyOverdue')}
          </label>
          <Segmented
            aria-label="View"
            value={mode}
            onValueChange={setMode}
            items={[
              { value: 'board', label: <span className="hide-m">{t('crm.deals.viewBoard')}</span>, icon: <SquareKanban size={13} />, 'aria-label': t('crm.deals.viewBoard') },
              { value: 'table', label: <span className="hide-m">{t('crm.deals.viewTable')}</span>, icon: <Table2 size={13} />, 'aria-label': t('crm.deals.viewTable') },
            ]}
          />
          </>
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
          onAdd={col => ui.newDeal({ stage: col as StageId, pipeline: activePipeline?.id })}
          canAdd={col => stage(col as StageId).category === 'in_progress'}
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
