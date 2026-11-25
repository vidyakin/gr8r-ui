/* Календарь — порт pageWsCalendar из views/calendar.js */
import { Plus, Search } from 'lucide-react';
import { Button, Input } from '@/components/ui';
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
        <div className="acts" style={{ flexWrap: 'nowrap' }}>
          <Input
            size="sm"
            icon={<Search size={13} />}
            className="flex-1 min-w-0 sm:flex-none sm:!w-[200px]"
            placeholder={t('views.toolbar.searchTasks')}
            aria-label={t('views.toolbar.searchTasks')}
            value={api.view.q}
            onChange={e => api.setQuery(e.target.value)}
          />
          <Button variant="primary" className="shrink-0" onClick={newTask}>
            <Plus size={14} />
            {t('pages.calendar.newTask')}
          </Button>
        </div>
      </div>
      <ViewToolbar api={api} hideSearch spreadControls />
      <CalendarView tasks={tasks} events={data.events} onAdd={due => taskForm.open({ due })} />
    </div>
  );
}
