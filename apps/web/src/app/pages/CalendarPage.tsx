/* Календарь — порт pageWsCalendar из views/calendar.js */
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, applyView, generalScope } from '../data/selectors';
import { CalendarView } from '../components/calendar-view';
import { ViewToolbar, useListView } from '../components/view-toolbar';
import { useTaskForm } from '../overlays';
import { useT } from '@/i18n';

export function CalendarPage() {
  const t = useT();
  const { data } = useWorkspace();
  const api = useListView();
  const tasks = applyView(generalScope(allTasks(data), api.view), api.view);
  const taskForm = useTaskForm();
  const newTask = () => taskForm.open();

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('pages.calendar.title')}</h1>
          <p>{t('pages.calendar.subline')}</p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={newTask}>
            <Plus size={14} />
            {t('pages.calendar.newTask')}
          </Button>
        </div>
      </div>
      <ViewToolbar api={api} />
      <CalendarView tasks={tasks} events={data.events} onAdd={due => taskForm.open({ due })} />
    </div>
  );
}
