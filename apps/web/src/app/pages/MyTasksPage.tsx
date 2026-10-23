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
import { useT } from '@/i18n';

export function MyTasksPage() {
  const t = useT();
  const { data } = useWorkspace();
  const api = useListView();
  const [mode, setMode] = React.useState<'list' | 'calendar'>('list');
  const now = today();
  const defaultProject = visibleProjects(data)[0]?.id ?? '';

  // «Ручной» порядок для своих задач не имеет смысла — как и в оригинале, сортируем по сроку
  const v = api.view.sort.f === 'manual' ? { ...api.view, sort: { f: 'due' as const, dir: 1 as const } } : api.view;
  const mine = applyView(
    allTasks(data).filter(t2 => t2.assignee === data.me),
    v,
  );
  const meDefault = { assignee: data.me };
  const groups: TaskGroup[] = [
    { key: 'overdue', name: t('pages.myTasks.overdue'), icon: <ClockAlert size={14} style={{ color: 'var(--red)' }} />, tasks: mine.filter(isOverdue), defaults: meDefault },
    {
      key: 'today',
      name: t('pages.myTasks.today'),
      icon: <Sun size={14} />,
      tasks: mine.filter(t2 => t2.status !== 'done' && t2.due && diffDays(parse(t2.due), now) === 0),
      defaults: { ...meDefault, due: dOff(0) },
    },
    {
      key: 'upcoming',
      name: t('pages.myTasks.upcoming'),
      icon: <CalendarDays size={14} />,
      tasks: mine.filter(t2 => t2.status !== 'done' && (!t2.due || diffDays(parse(t2.due), now) > 0)),
      defaults: { ...meDefault, due: dOff(3) },
    },
    {
      key: 'completed',
      name: t('pages.myTasks.completed'),
      icon: <CircleCheck size={14} style={{ color: 'var(--green)' }} />,
      tasks: mine.filter(t2 => t2.status === 'done'),
      defaults: { ...meDefault, status: 'done' },
      collapsed: true,
    },
  ];

  const taskForm = useTaskForm();
  const newTask = () => taskForm.open({ assignee: data.me });

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('pages.myTasks.title')}</h1>
          <p>
            {t('pages.myTasks.subline', {
              today: groups[1].tasks.length,
              overdue: groups[0].tasks.length,
              upcoming: groups[2].tasks.length,
            })}
          </p>
        </div>
        <div className="acts">
          <Segmented
            aria-label={t('pages.myTasks.viewLabel')}
            value={mode}
            onValueChange={setMode}
            items={[
              { value: 'list', label: t('pages.myTasks.list'), icon: <List size={13} /> },
              { value: 'calendar', label: t('pages.myTasks.calendar'), icon: <Calendar size={13} /> },
            ]}
          />
          <Button variant="primary" onClick={newTask}>
            <Plus size={14} />
            {t('pages.myTasks.newTask')}
          </Button>
        </div>
      </div>
      <ViewToolbar api={api} />
      {mode === 'calendar' ? (
        <CalendarView tasks={mine} onAdd={due => taskForm.open({ due, assignee: data.me })} />
      ) : (
        <div className="list-wrap">
          <TaskList groups={groups} columns={['project', 'status', 'priority', 'due']} defaultProject={defaultProject} sort={api.view.sort.f === 'manual' ? undefined : api.view.sort} onSort={f => api.setSort(f)} />
        </div>
      )}
    </div>
  );
}
