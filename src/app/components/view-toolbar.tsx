/* Панель вида списка: поиск, фильтры, сортировка и строка фильтров-чипов — порт viewToolbar / filterChips
   из shell/view-engine.js. Конструктор фильтров упрощён: поле → набор значений (условие «is»). */
import * as React from 'react';
import { ArrowUpDown, Calendar, CircleDot, Folder, ListFilter, Plus, Search, SignalHigh, User, X } from 'lucide-react';
import { Badge, Button, Input, Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '@/components/ui';
import { PRIORITIES, PriorityIcon, STATUSES, StatusIcon } from '@/components/gr8r/task';
import { useWorkspace } from '../data/store';
import { canSee, visibleProjects, type Filter, type FilterField, type ListView, type SortField } from '../data/selectors';
import { MemberAvatar } from './workspace';
import { ProjectDot } from './project';

interface Option {
  id: string;
  name: string;
  icon?: React.ReactNode;
}

function useFields(): Record<FilterField, { name: string; icon: React.ReactNode; options: Option[] }> {
  const { data } = useWorkspace();
  return {
    status: { name: 'Status', icon: <CircleDot size={15} />, options: STATUSES.map(s => ({ id: s.id, name: s.name, icon: <StatusIcon status={s.id} /> })) },
    assignee: {
      name: 'Assignee',
      icon: <User size={15} />,
      options: [
        { id: 'none', name: 'Unassigned', icon: <MemberAvatar id={null} size="sm" tooltip={false} /> },
        ...data.members.map(m => ({ id: m.id, name: m.name + (m.id === data.me ? ' (you)' : ''), icon: <MemberAvatar id={m.id} size="sm" tooltip={false} /> })),
      ],
    },
    priority: { name: 'Priority', icon: <SignalHigh size={15} />, options: PRIORITIES.map(p => ({ id: p.id, name: p.name, icon: <PriorityIcon priority={p.id} /> })) },
    due: {
      name: 'Due date',
      icon: <Calendar size={15} />,
      options: [
        { id: 'overdue', name: 'Overdue' },
        { id: 'today', name: 'Today' },
        { id: 'week', name: 'Next 7 days' },
        { id: 'later', name: 'Later' },
        { id: 'nodate', name: 'No due date' },
      ],
    },
    project: {
      name: 'Project',
      icon: <Folder size={15} />,
      options: visibleProjects(data)
        .filter(p => canSee(data, p))
        .map(p => ({ id: p.id, name: p.name, icon: <ProjectDot project={p} /> })),
    },
  };
}

const SORTS: { f: SortField; name: string }[] = [
  { f: 'manual', name: 'Manual' },
  { f: 'title', name: 'Title' },
  { f: 'due', name: 'Due date' },
  { f: 'priority', name: 'Priority' },
  { f: 'status', name: 'Status' },
  { f: 'created', name: 'Created' },
  { f: 'updated', name: 'Updated' },
];

/** Состояние вида списка + операции над ним */
export function useListView(initial?: Partial<ListView>) {
  const [view, setView] = React.useState<ListView>({ q: '', filters: [], sort: { f: 'manual', dir: 1 }, ...initial });
  return {
    view,
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

type ViewApi = ReturnType<typeof useListView>;

function FilterMenu({ api, children }: { api: ViewApi; children: React.ReactElement }) {
  const fields = useFields();
  return (
    <Menu>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent>
        <MenuLabel>Filter by</MenuLabel>
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

export function ViewToolbar({ api, right }: { api: ViewApi; right?: React.ReactNode }) {
  const fields = useFields();
  const { view } = api;
  const sortName = SORTS.find(s => s.f === view.sort.f)?.name;
  return (
    <>
      <div className="toolbar" role="toolbar">
        <Input size="sm" icon={<Search size={13} />} className="!w-[200px]" placeholder="Search tasks" aria-label="Search tasks" value={view.q} onChange={e => api.setQuery(e.target.value)} />
        <FilterMenu api={api}>
          <Button variant="ghost" className={view.filters.length ? 'on' : undefined}>
            <ListFilter size={14} />
            Filter
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
              <span className="hide-m">Sort:</span> {sortName}
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
              <MenuRadioItem value="1">Ascending</MenuRadioItem>
              <MenuRadioItem value="-1">Descending</MenuRadioItem>
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
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
                {i > 0 && <span>and</span>}
                <span className="chip">
                  <FilterMenu api={api}>
                    <button style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                      {React.cloneElement(F.icon as React.ReactElement<{ size: number }>, { size: 12 })}
                      <b>{F.name}</b> is <span>{names.length > 2 ? `${names.length} selected` : names.join(', ')}</span>
                    </button>
                  </FilterMenu>
                  <button className="ibtn" aria-label="Remove filter" onClick={() => api.removeFilter(f.f)}>
                    <X size={12} />
                  </button>
                </span>
              </React.Fragment>
            );
          })}
          <FilterMenu api={api}>
            <Button size="sm" variant="ghost">
              <Plus size={12} />
              Add
            </Button>
          </FilterMenu>
          <span className="sp" />
          <Button size="sm" variant="ghost" onClick={api.clearFilters}>
            Clear all
          </Button>
        </div>
      )}
    </>
  );
}
