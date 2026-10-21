/* Задачи — порт pageTasks из pages/tasks.js */
import * as React from 'react';
import { useLocation } from 'react-router';
import { List, Plus, SquareKanban, Table2 } from 'lucide-react';
import { Button, Segmented } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, applyView, generalScope, canSee, groupTasks, visibleProjects } from '../data/selectors';
import { BoardOptions, BoardView, useBoardDensity, useBoardSubtasks } from '../components/board-view';
import { BucketIcon, TableView, useTaskColumns } from '../components/table-view';
import { LIST_OPTIONAL_COLUMNS, TaskList, withTimeColumn, type TaskGroup } from '../components/task-list';
import { ViewToolbar, useListView } from '../components/view-toolbar';
import { useTaskForm } from '../overlays';

type Mode = 'list' | 'board' | 'table';

export function TasksPage() {
  const { data } = useWorkspace();
  // Палитра открывает «Overdue tasks» через state перехода
  const preset = useLocation().state?.filter === 'overdue';
  const api = useListView(preset ? { filters: [{ f: 'due', v: ['overdue'] }] } : undefined);
  const [mode, setMode] = React.useState<Mode>('list');
  const [showSubs, setShowSubs] = useBoardSubtasks();
  const [density, setDensity] = useBoardDensity();
  const defaultProject = visibleProjects(data)[0]?.id ?? '';
  const tasks = applyView(generalScope(allTasks(data), api.view), api.view, data);

  const taskColumns = useTaskColumns();
  const taskForm = useTaskForm();
  const newTask = () => taskForm.open();

  const groups: TaskGroup[] = groupTasks(data, tasks, api.group).map(g => ({
    key: g.key,
    name: g.name,
    icon: <BucketIcon group={api.group} bucket={g} />,
    tasks: g.tasks,
    defaults: g.set,
  }));

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Tasks</h1>
          <p>Every task across {visibleProjects(data).filter(p => canSee(data, p)).length} projects.</p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={newTask}>
            <Plus size={14} />
            New task
          </Button>
        </div>
      </div>
      <ViewToolbar
        api={api}
        group={mode !== 'board'}
        columns={mode === 'table' ? taskColumns.toggle : mode === 'list' ? LIST_OPTIONAL_COLUMNS : undefined}
        resetWidths={mode === 'table'}
        extra={mode === 'board' && <BoardOptions density={density} onDensity={setDensity} showSubtasks={showSubs} onShowSubtasks={setShowSubs} />}
        left={
          <Segmented
            aria-label="View"
            value={mode}
            onValueChange={setMode}
            items={[
              { value: 'list', label: <span className="hide-m">List</span>, icon: <List size={13} />, 'aria-label': 'List' },
              { value: 'board', label: <span className="hide-m">Board</span>, icon: <SquareKanban size={13} />, 'aria-label': 'Board' },
              { value: 'table', label: <span className="hide-m">Table</span>, icon: <Table2 size={13} />, 'aria-label': 'Table' },
            ]}
          />
        }
      />
      {mode === 'board' && <BoardView tasks={tasks} defaultProject={defaultProject} showSubtasks={showSubs} density={density} />}
      {mode === 'table' && <TableView tasks={tasks} api={api} onNewTask={newTask} />}
      {mode === 'list' && (
        <div className="list-wrap">
          <TaskList groups={groups} columns={withTimeColumn(['status', 'assignee', 'priority', 'due', 'project'], api.hidden)} defaultProject={defaultProject} sort={api.view.sort.f === 'manual' ? undefined : api.view.sort} onSort={f => api.setSort(f)} />
        </div>
      )}
    </div>
  );
}
