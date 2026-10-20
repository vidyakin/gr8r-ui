/* Задачи — порт pageTasks из pages/tasks.js */
import * as React from 'react';
import { List, Plus, SquareKanban, Table2 } from 'lucide-react';
import { Button, Segmented } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, applyView, canSee, groupTasks, visibleProjects } from '../data/selectors';
import { BoardView } from '../components/board-view';
import { BucketIcon, TOGGLE_COLUMNS, TableView } from '../components/table-view';
import { TaskList, type TaskGroup } from '../components/task-list';
import { ViewToolbar, useListView } from '../components/view-toolbar';
import { useTaskForm } from '../overlays';

type Mode = 'list' | 'board' | 'table';

export function TasksPage() {
  const { data } = useWorkspace();
  const api = useListView();
  const [mode, setMode] = React.useState<Mode>('list');
  const defaultProject = visibleProjects(data)[0]?.id ?? 'p1';
  const tasks = applyView(allTasks(data), api.view, data);

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
        columns={mode === 'table' ? TOGGLE_COLUMNS : undefined}
        right={
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
      {mode === 'board' && <BoardView tasks={tasks} defaultProject={defaultProject} />}
      {mode === 'table' && <TableView tasks={tasks} api={api} onNewTask={newTask} />}
      {mode === 'list' && (
        <div className="list-wrap">
          <TaskList groups={groups} columns={['status', 'assignee', 'priority', 'due', 'project']} defaultProject={defaultProject} sort={api.view.sort.f === 'manual' ? undefined : api.view.sort} onSort={f => api.setSort(f)} />
        </div>
      )}
    </div>
  );
}
