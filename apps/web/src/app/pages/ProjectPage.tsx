/* Страница проекта — порт pageProject / taskViewBody из pages/project.js */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronDown, ListChecks, ListFilter, Plus, SearchX, Settings, Share2, Star, UserPlus } from 'lucide-react';
import { Button, EmptyState, IconButton, Tooltip, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../data/store';
import { useMyPrefs } from '../data/settings';
import { PROJECT_STATUS, applyView, canSee, groupTasks, project as findProject, tasksOf } from '../data/selectors';
import type { Project, SavedView } from '../data/types';
import { BoardOptions, BoardView, useBoardDensity, useBoardSubtasks } from '../components/board-view';
import { CalendarView } from '../components/calendar-view';
import { Page404, StateDenied } from '../components/error-states';
import { ProjectActivity, ProjectOverview } from '../components/project-overview';
import { ProjectIcon, ProjectMenu, ProjectStatusMenu } from '../components/project';
import { BucketIcon, CUSTOMER_COLUMN, TableView, useTaskColumns } from '../components/table-view';
import { LIST_OPTIONAL_COLUMNS, TaskList, withCustomerColumn, withTimeColumn, type TaskGroup } from '../components/task-list';
import { ProjectTimelineTab } from '../components/timeline-view';
import { ProjectFilesTab } from '../components/files-view';
import { ViewToolbar, useListView, type ViewApi } from '../components/view-toolbar';
import { MemberStack } from '../components/workspace';
import { useProjectForms, useTaskForm } from '../overlays';
import { useT } from '@/i18n';

const PTABS: string[] = ['overview', 'board', 'list', 'table', 'calendar', 'timeline', 'files', 'activity'];

export function ProjectPage() {
  const { id, tab } = useParams();
  const { data } = useWorkspace();
  const prefs = useMyPrefs();
  const p = findProject(data, id);
  if (!p) return <Page404 />;
  if (!canSee(data, p)) return <StateDenied project={p} />;
  // key: при смене проекта состояние фильтров вида сбрасывается (в оригинале оно хранится по ключу проекта)
  return <ProjectView key={p.id} project={p} tab={tab || prefs.defaultTab} />;
}

function ProjectView({ project: p, tab }: { project: Project; tab: string }) {
  const tr = useT();
  const { data, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const api = useListView();
  const views = data.savedViews.filter(v => v.project === p.id);
  const projectForms = useProjectForms();
  const goTab = (t: string) => navigate(`/projects/${p.id}/${t}`);

  let body: React.ReactNode;
  if (tab.startsWith('v:')) {
    const sv = views.find(v => 'v:' + v.id === tab);
    body = sv ? <SavedViewBody key={sv.id} view={sv} project={p} /> : <Page404 />;
  } else if (tab === 'overview') {
    body = (
      <ProjectOverview
        project={p}
        onTab={goTab}
        onStatusList={s => {
          // goFilteredList: список проекта с фильтром по статусу и группировкой по статусу
          api.clearFilters();
          api.toggleValue('status', s);
          api.setGroup('status');
          goTab('list');
        }}
      />
    );
  } else if (tab === 'files') {
    body = <ProjectFilesTab project={p} />;
  } else if (tab === 'timeline') {
    body = <ProjectTimelineTab project={p} api={api} />;
  } else if (tab === 'activity') body = <ProjectActivity project={p} />;
  else body = <TaskViewBody type={tab} project={p} api={api} />;

  return (
    <div className="page flush">
      <div className="proj-h">
        <div className="t">
          <ProjectIcon project={p} size={18} className="lg" />
          <h1>{p.name}</h1>
          <IconButton
            size="sm"
            label={p.fav ? tr('pages.project.favRemove') : tr('pages.project.favAdd')}
            aria-pressed={p.fav}
            style={p.fav ? { color: 'var(--amber)' } : undefined}
            onClick={() => {
              dispatch({ type: 'project/toggleFav', id: p.id });
              toast(!p.fav ? tr('pages.project.favAdded', { name: p.name }) : tr('pages.project.favRemoved'), { duration: 1800 });
            }}
          >
            <Star size={15} />
          </IconButton>
          <ProjectStatusMenu project={p}>
            <button className="pillbtn bordered" aria-label={tr('pages.project.statusLabel')} style={{ height: 24 }}>
              <span className="pdot" style={{ '--c': PROJECT_STATUS[p.status].c, borderRadius: '50%', width: 7, height: 7 } as React.CSSProperties} />
              {PROJECT_STATUS[p.status].name}
              <ChevronDown size={12} />
            </button>
          </ProjectStatusMenu>
          <span className="sp" />
          <div className="row" style={{ gap: 4 }}>
            <button className="row" aria-label={tr('pages.project.membersLabel')} style={{ gap: 0 }} onClick={() => projectForms.share(p.id)}>
              <MemberStack ids={p.members} max={5} size="md" />
            </button>
            <IconButton size="sm" label={tr('pages.project.addMember')} onClick={() => projectForms.share(p.id)}>
              <UserPlus size={15} />
            </IconButton>
            <Button size="sm" className="hide-m" onClick={() => projectForms.share(p.id)}>
              <Share2 size={13} />
              {tr('pages.project.share')}
            </Button>
            <IconButton size="sm" label={tr('pages.project.settings')} onClick={() => projectForms.edit(p.id)}>
              <Settings size={15} />
            </IconButton>
            <ProjectMenu project={p} />
          </div>
        </div>
        <nav className="tabs" aria-label={tr('pages.project.viewsNav')}>
          {PTABS.map(k => (
            <Link key={k} to={`/projects/${p.id}/${k}`} className={cn('tab', tab === k && 'on')} aria-current={tab === k ? 'page' : undefined}>
              {tr(`pages.project.tabs.${k}` as 'pages.project.tabs.board')}
            </Link>
          ))}
          {views.map(v => (
            <Link key={v.id} to={`/projects/${p.id}/v:${v.id}`} className={cn('tab', tab === 'v:' + v.id && 'on')} aria-current={tab === 'v:' + v.id ? 'page' : undefined}>
              <ListFilter size={14} />
              {v.name}
            </Link>
          ))}
          <Tooltip content={tr('pages.project.saveViewHint')}>
            <button className="tab" aria-label={tr('pages.project.saveView')} onClick={() => projectForms.saveView(p.id, api.view.filters)}>
              <Plus size={14} />
            </button>
          </Tooltip>
        </nav>
      </div>
      <div className="pbody">{body}</div>
    </div>
  );
}

/** Сохранённый вид: свои фильтры поверх вида своего типа (ключ sv:<id> в оригинале) */
function SavedViewBody({ view, project: p }: { view: SavedView; project: Project }) {
  const api = useListView({ filters: view.filters });
  return <TaskViewBody type={view.type} project={p} api={api} />;
}

/** Панель вида + содержимое для board / list / table / calendar */
function TaskViewBody({ type, project: p, api }: { type: string; project: Project; api: ViewApi }) {
  const tr = useT();
  const taskColumns = useTaskColumns();
  const { data } = useWorkspace();
  const all = tasksOf(data, p.id);
  const ts = applyView(all, api.view, data);
  const noTasks = !all.length;
  const taskForm = useTaskForm();
  const newTask = () => taskForm.open({ project: p.id });
  const [showSubs, setShowSubs] = useBoardSubtasks();
  const [density, setDensity] = useBoardDensity();

  const addBtn = (
    <Button size="sm" variant="primary" onClick={newTask}>
      <Plus size={13} />
      {tr('pages.project.newTask')}
    </Button>
  );
  const emptyAll = (
    <EmptyState
      icon={<ListChecks size={20} />}
      title={tr('pages.project.emptyTasks')}
      action={
        <Button size="sm" variant="primary" onClick={newTask}>
          <Plus size={14} />
          {tr('pages.project.addTask')}
        </Button>
      }
    >
      {tr('pages.project.emptyTasksHint')}
    </EmptyState>
  );
  const emptyFilter = (
    <EmptyState
      icon={<SearchX size={20} />}
      title={tr('pages.project.noTasksMatch')}
      action={
        <Button
          size="sm"
          onClick={() => {
            api.clearFilters();
            api.setQuery('');
          }}
        >
          {tr('common.clearFilters')}
        </Button>
      }
    >
      {tr('pages.project.noTasksMatchHint')}
    </EmptyState>
  );

  if (type === 'board')
    return (
      <>
        <ViewToolbar api={api} right={addBtn} extra={<BoardOptions density={density} onDensity={setDensity} showSubtasks={showSubs} onShowSubtasks={setShowSubs} />} />
        {noTasks ? emptyAll : <BoardView tasks={ts} defaultProject={p.id} project={p.id} showSubtasks={showSubs} density={density} />}
      </>
    );
  if (type === 'list') {
    const groups: TaskGroup[] = groupTasks(data, ts, api.group).map(g => ({
      key: g.key,
      name: g.name,
      icon: <BucketIcon group={api.group} bucket={g} />,
      tasks: g.tasks,
      // новая задача в группе получает поля группы и остаётся в этом проекте
      defaults: { ...g.set, project: p.id },
    }));
    return (
      <>
        <ViewToolbar api={api} group columns={LIST_OPTIONAL_COLUMNS} resetWidths={false} right={addBtn} />
        <div className="list-wrap">
          {noTasks ? (
            emptyAll
          ) : !ts.length ? (
            emptyFilter
          ) : (
            <TaskList groups={groups} columns={withCustomerColumn(withTimeColumn(['status', 'assignee', 'priority', 'due', 'labels'], api.hidden), p.module === 'services')} defaultProject={p.id} sort={api.view.sort.f === 'manual' ? undefined : api.view.sort} onSort={f => api.setSort(f)} />
          )}
        </div>
      </>
    );
  }
  if (type === 'table')
    return (
      <>
        <ViewToolbar api={api} group columns={p.module === 'services' ? [...taskColumns.toggle, CUSTOMER_COLUMN] : taskColumns.toggle} right={addBtn} />
        {noTasks ? emptyAll : <TableView tasks={ts} api={api} onNewTask={newTask} project={p.id} customer={p.module === 'services'} />}
      </>
    );
  if (type === 'calendar')
    return (
      <>
        <ViewToolbar api={api} right={addBtn} />
        <CalendarView tasks={ts} events={data.events.filter(e => e.project === p.id)} onAdd={due => taskForm.open({ due, project: p.id })} />
      </>
    );
  return <Page404 />;
}
