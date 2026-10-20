/* Мои задачи — порт pageMyTasks из pages/my-tasks.js */
import * as React from 'react';
import { Calendar, CalendarDays, CircleCheck, ClockAlert, List, Plus, Sun } from 'lucide-react';
import { Button, Segmented } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, applyView, isOverdue, visibleProjects } from '../data/selectors';
import { dOff, diffDays, parse, today } from '../lib/dates';
import { TaskList, type TaskGroup } from '../components/task-list';
import { CalendarView } from '../components/calendar-view';
import { ViewToolbar, useListView } from '../components/view-toolbar';
import { useTaskForm } from '../overlays';

export function MyTasksPage() {
  const { data } = useWorkspace();
  const api = useListView();
  const [mode, setMode] = React.useState<'list' | 'calendar'>('list');
  const now = today();
  const defaultProject = visibleProjects(data)[0]?.id ?? 'p1';

  // «Ручной» порядок для своих задач не имеет смысла — как и в оригинале, сортируем по сроку
  const v = api.view.sort.f === 'manual' ? { ...api.view, sort: { f: 'due' as const, dir: 1 as const } } : api.view;
  const mine = applyView(
    allTasks(data).filter(t => t.assignee === data.me),
    v,
  );
  const me = { assignee: data.me };
  const groups: TaskGroup[] = [
    { key: 'overdue', name: 'Overdue', icon: <ClockAlert size={14} style={{ color: 'var(--red)' }} />, tasks: mine.filter(isOverdue), defaults: me },
    {
      key: 'today',
      name: 'Today',
      icon: <Sun size={14} />,
      tasks: mine.filter(t => t.status !== 'done' && t.due && diffDays(parse(t.due), now) === 0),
      defaults: { ...me, due: dOff(0) },
    },
    {
      key: 'upcoming',
      name: 'Upcoming',
      icon: <CalendarDays size={14} />,
      tasks: mine.filter(t => t.status !== 'done' && (!t.due || diffDays(parse(t.due), now) > 0)),
      defaults: { ...me, due: dOff(3) },
    },
    {
      key: 'completed',
      name: 'Completed',
      icon: <CircleCheck size={14} style={{ color: 'var(--green)' }} />,
      tasks: mine.filter(t => t.status === 'done'),
      defaults: { ...me, status: 'done' },
      collapsed: true,
    },
  ];

  const taskForm = useTaskForm();
  const newTask = () => taskForm.open({ assignee: data.me });

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>My Tasks</h1>
          <p>
            {groups[1].tasks.length} due today · {groups[0].tasks.length} overdue · {groups[2].tasks.length} upcoming
          </p>
        </div>
        <div className="acts">
          <Segmented
            aria-label="View"
            value={mode}
            onValueChange={setMode}
            items={[
              { value: 'list', label: 'List', icon: <List size={13} /> },
              { value: 'calendar', label: 'Calendar', icon: <Calendar size={13} /> },
            ]}
          />
          <Button variant="primary" onClick={newTask}>
            <Plus size={14} />
            New task
          </Button>
        </div>
      </div>
      <ViewToolbar api={api} />
      {mode === 'calendar' ? (
        <CalendarView tasks={mine} onAdd={newTask} />
      ) : (
        <div className="list-wrap">
          <TaskList groups={groups} columns={['project', 'status', 'priority', 'due']} defaultProject={defaultProject} sort={api.view.sort.f === 'manual' ? undefined : api.view.sort} onSort={f => api.setSort(f)} />
        </div>
      )}
    </div>
  );
}
