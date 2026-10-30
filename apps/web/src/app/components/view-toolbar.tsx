/* Панель вида списка: поиск, фильтры, сортировка и строка фильтров-чипов — порт viewToolbar / filterChips
   из shell/view-engine.js. Конструктор фильтров упрощён: поле → набор значений (условие «is»). */
import * as React from 'react';
import { ArrowUpDown, Boxes, Calendar, CircleDot, Columns3, Folder, ListFilter, Minus, Plus, RotateCcw, Rows3, Search, SignalHigh, User, X } from 'lucide-react';
import { Badge, Button, Input, Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '@/components/ui';
import { PRIORITIES, PriorityIcon, StatusIcon } from '@/components/gr8r/task';
import { TASK_MODULES, TASK_MODULE_LABELS } from '@gr8r/shared';
import { tEnum, useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { canSee, statusName, visibleProjects, type Filter, type FilterField, type GroupBy, type ListView, type SortField } from '../data/selectors';
import { MemberAvatar } from './workspace';
import { ProjectDot } from './project';

interface Option {
  id: string;
  name: string;
  icon?: React.ReactNode;
}

function useFields(): Record<FilterField, { name: string; icon: React.ReactNode; options: Option[] }> {
  const { data } = useWorkspace();
  const tt = useT();
  return {
    status: { name: tt('views.toolbar.field.status'), icon: <CircleDot size={15} />, options: data.statuses.map(s => ({ id: s.id, name: statusName(s), icon: <StatusIcon status={s.id} /> })) },
    assignee: {
      name: tt('views.toolbar.field.assignee'),
      icon: <User size={15} />,
      options: [
        { id: 'none', name: tt('views.toolbar.unassigned'), icon: <MemberAvatar id={null} size="sm" tooltip={false} /> },
        ...data.members.map(m => ({ id: m.id, name: m.name + (m.id === data.me ? tt('views.toolbar.you') : ''), icon: <MemberAvatar id={m.id} size="sm" tooltip={false} /> })),
      ],
    },
    priority: { name: tt('views.toolbar.field.priority'), icon: <SignalHigh size={15} />, options: [...PRIORITIES, null].map(p => ({ id: p == null ? 'none' : String(p), name: p == null ? tt('views.toolbar.noPriority') : String(p), icon: <PriorityIcon priority={p} /> })) },
    due: {
      name: tt('views.toolbar.field.due'),
      icon: <Calendar size={15} />,
      options: [
        { id: 'overdue', name: tt('views.toolbar.dueOption.overdue') },
        { id: 'today', name: tt('views.toolbar.dueOption.today') },
        { id: 'week', name: tt('views.toolbar.dueOption.week') },
        { id: 'later', name: tt('views.toolbar.dueOption.later') },
        { id: 'nodate', name: tt('views.toolbar.dueOption.nodate') },
      ],
    },
    project: {
      name: tt('views.toolbar.field.project'),
      icon: <Folder size={15} />,
      options: visibleProjects(data)
        .filter(p => canSee(data, p))
        .map(p => ({ id: p.id, name: p.name, icon: <ProjectDot project={p} /> })),
    },
    module: {
      name: tt('views.toolbar.field.module'),
      icon: <Boxes size={15} />,
      options: TASK_MODULES.map(m => ({ id: m, name: tEnum('taskModule', m, TASK_MODULE_LABELS[m]) })),
    },
  };
}

function getSorts(tt: ReturnType<typeof useT>): { f: SortField; name: string }[] {
  return [
    { f: 'manual', name: tt('views.toolbar.field.manual') },
    { f: 'title', name: tt('views.toolbar.field.title') },
    { f: 'due', name: tt('views.toolbar.field.due') },
    { f: 'priority', name: tt('views.toolbar.field.priority') },
    { f: 'status', name: tt('views.toolbar.field.status') },
    { f: 'created', name: tt('views.toolbar.field.created') },
    { f: 'updated', name: tt('views.toolbar.field.updated') },
  ];
}

function getSortNames(tt: ReturnType<typeof useT>): Partial<Record<SortField, string>> {
  return {
    assignee: tt('views.toolbar.field.assignee'),
    start: tt('views.toolbar.field.start'),
    plan: tt('views.toolbar.field.plan'),
    actual: tt('views.toolbar.field.actual'),
    variance: tt('views.toolbar.field.variance'),
    project: tt('views.toolbar.field.project'),
  };
}

function getGroups(tt: ReturnType<typeof useT>): { id: GroupBy; name: string; icon: React.ReactNode }[] {
  return [
    { id: 'status', name: tt('views.toolbar.field.status'), icon: <CircleDot size={15} /> },
    { id: 'priority', name: tt('views.toolbar.field.priority'), icon: <SignalHigh size={15} /> },
    { id: 'assignee', name: tt('views.toolbar.field.assignee'), icon: <User size={15} /> },
    { id: 'project', name: tt('views.toolbar.field.project'), icon: <Folder size={15} /> },
    { id: 'due', name: tt('views.toolbar.field.due'), icon: <Calendar size={15} /> },
    { id: 'none', name: tt('views.toolbar.noGrouping'), icon: <Minus size={15} /> },
  ];
}

/** Состояние вида списка + операции над ним */
export function useListView(initial?: Partial<ListView>) {
  const [view, setView] = React.useState<ListView>({ q: '', filters: [], sort: { f: 'manual', dir: 1 }, ...initial });
  // Группировка и колонки таблицы — только для видов, которые их показывают (Tasks, страница проекта)
  const [group, setGroup] = React.useState<GroupBy>('status');
  const [hidden, setHidden] = React.useState<string[]>(['start', 'created', 'deps', 'actual', 'variance', 'time']);
  const [colW, setColW] = React.useState<Record<string, number>>({});
  return {
    view,
    group,
    setGroup,
    hidden,
    toggleColumn: (c: string) => setHidden(h => (h.includes(c) ? h.filter(x => x !== c) : [...h, c])),
    colW,
    setColW: (c: string, w: number) => setColW(m => ({ ...m, [c]: w })),
    resetColW: () => setColW({}),
    setQuery: (q: string) => setView(v => ({ ...v, q })),
    toggleValue: (f: FilterField, id: string) =>
      setView(v => {
        const cur = v.filters.find(x => x.f === f);
        const vals = cur ? (cur.v.includes(id) ? cur.v.filter(x => x !== id) : [...cur.v, id]) : [id];
        const filters: Filter[] = cur ? v.filters.map(x => (x.f === f ? { f, v: vals } : x)) : [...v.filters, { f, v: vals }];
        return { ...v, filters: filters.filter(x => x.v.length) };
      }),
    removeFilter: (f: FilterField) => setView(v => ({ ...v, filters: v.filters.filter(x => x.f !== f) })),
    clearFilters: () => setView(v => ({ ...v, filters: [] })),
    setSort: (f: SortField, dir?: 1 | -1) => setView(v => ({ ...v, sort: { f, dir: dir ?? (v.sort.f === f ? (v.sort.dir === 1 ? -1 : 1) : 1) } })),
  };
}

export type ViewApi = ReturnType<typeof useListView>;

function FilterMenu({ api, children }: { api: ViewApi; children: React.ReactElement }) {
  const fields = useFields();
  const tt = useT();
  return (
    <Menu>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent>
        <MenuLabel>{tt('views.toolbar.filterBy')}</MenuLabel>
        {(Object.keys(fields) as FilterField[]).map(f => {
          const F = fields[f];
          const sel = api.view.filters.find(x => x.f === f)?.v ?? [];
          return (
            <MenuSub key={f}>
              <MenuSubTrigger icon={F.icon}>
                {F.name}
                {!!sel.length && <span className="faint"> · {sel.length}</span>}
              </MenuSubTrigger>
              <MenuSubContent>
                {F.options.map(o => (
                  <MenuCheckboxItem key={o.id} icon={o.icon} checked={sel.includes(o.id)} onCheckedChange={() => api.toggleValue(f, o.id)} onSelect={e => e.preventDefault()}>
                    {o.name}
                  </MenuCheckboxItem>
                ))}
              </MenuSubContent>
            </MenuSub>
          );
        })}
      </MenuContent>
    </Menu>
  );
}

export interface ViewToolbarProps {
  api: ViewApi;
  /** Контролы перед поиском (например, переключатель видов) */
  left?: React.ReactNode;
  right?: React.ReactNode;
  /** Кнопка «Group» */
  group?: boolean;
  /** Кнопка «Columns» со списком переключаемых колонок */
  columns?: { id: string; name: string }[];
  /** Пункт «Reset widths» в меню колонок (у списка ширины не меняются) */
  resetWidths?: boolean;
  /** Доп. контролы после стандартных кнопок (например, масштаб Timeline) */
  extra?: React.ReactNode;
}

export function ViewToolbar({ api, left, right, group, columns, resetWidths = true, extra }: ViewToolbarProps) {
  const fields = useFields();
  const tt = useT();
  const SORTS = getSorts(tt);
  const SORT_NAMES = getSortNames(tt);
  const GROUPS = getGroups(tt);
  const { view } = api;
  const sortName = SORTS.find(s => s.f === view.sort.f)?.name ?? SORT_NAMES[view.sort.f];
  return (
    <>
      <div className="toolbar" role="toolbar">
        {left}
        <Input size="sm" icon={<Search size={13} />} className="!w-[200px]" placeholder={tt('views.toolbar.searchTasks')} aria-label={tt('views.toolbar.searchTasks')} value={view.q} onChange={e => api.setQuery(e.target.value)} />
        <FilterMenu api={api}>
          <Button variant="ghost" className={view.filters.length ? 'on' : undefined}>
            <ListFilter size={14} />
            {tt('views.toolbar.filter')}
            {!!view.filters.length && (
              <Badge tone="accent" style={{ height: 16, padding: '0 5px' }}>
                {view.filters.length}
              </Badge>
            )}
          </Button>
        </FilterMenu>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost">
              <ArrowUpDown size={14} />
              <span className="hide-m">{tt('views.toolbar.sort')}:</span> {sortName}
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuRadioGroup value={view.sort.f} onValueChange={f => api.setSort(f as SortField, 1)}>
              {SORTS.map(s => (
                <MenuRadioItem key={s.f} value={s.f}>
                  {s.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
            <MenuSeparator />
            <MenuRadioGroup value={String(view.sort.dir)} onValueChange={d => api.setSort(view.sort.f, +d as 1 | -1)}>
              <MenuRadioItem value="1">{tt('views.toolbar.ascending')}</MenuRadioItem>
              <MenuRadioItem value="-1">{tt('views.toolbar.descending')}</MenuRadioItem>
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
        {group && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost">
                <Rows3 size={14} />
                <span className="hide-m">{tt('views.toolbar.group')}:</span> {GROUPS.find(g => g.id === api.group)?.name === tt('views.toolbar.noGrouping') ? tt('views.toolbar.none') : GROUPS.find(g => g.id === api.group)?.name}
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>{tt('views.toolbar.groupBy')}</MenuLabel>
              <MenuRadioGroup value={api.group} onValueChange={g => api.setGroup(g as GroupBy)}>
                {GROUPS.map(g => (
                  <MenuRadioItem key={g.id} value={g.id} icon={g.icon}>
                    {g.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        )}
        {columns && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost">
                <Columns3 size={14} />
                {tt('views.toolbar.columns')}
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>{tt('views.toolbar.visibleColumns')}</MenuLabel>
              {columns.map(c => (
                <MenuCheckboxItem key={c.id} checked={!api.hidden.includes(c.id)} onCheckedChange={() => api.toggleColumn(c.id)} onSelect={e => e.preventDefault()}>
                  {c.name}
                </MenuCheckboxItem>
              ))}
              {resetWidths && (
                <>
                  <MenuSeparator />
                  <MenuItem icon={<RotateCcw size={14} />} onSelect={api.resetColW}>
                    {tt('views.toolbar.resetWidths')}
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        )}
        {extra}
        <span className="sp" />
        {right}
      </div>
      {!!view.filters.length && (
        <div className="chipsbar">
          <ListFilter size={13} />
          {view.filters.map((f, i) => {
            const F = fields[f.f];
            const names = f.v.map(id => F.options.find(o => o.id === id)?.name ?? id);
            return (
              <React.Fragment key={f.f}>
                {i > 0 && <span>{tt('views.toolbar.and')}</span>}
                <span className="chip">
                  <FilterMenu api={api}>
                    <button style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                      {React.cloneElement(F.icon as React.ReactElement<{ size: number }>, { size: 12 })}
                      <b>{F.name}</b> {tt('ui.is')} <span>{names.length > 2 ? tt('views.toolbar.selected', { count: names.length }) : names.join(', ')}</span>
                    </button>
                  </FilterMenu>
                  <button className="ibtn" aria-label={tt('views.toolbar.removeFilter')} onClick={() => api.removeFilter(f.f)}>
                    <X size={12} />
                  </button>
                </span>
              </React.Fragment>
            );
          })}
          <FilterMenu api={api}>
            <Button size="sm" variant="ghost">
              <Plus size={12} />
              {tt('views.toolbar.addFilter')}
            </Button>
          </FilterMenu>
          <span className="sp" />
          <Button size="sm" variant="ghost" onClick={api.clearFilters}>
            {tt('views.toolbar.clearAll')}
          </Button>
        </div>
      )}
    </>
  );
}
