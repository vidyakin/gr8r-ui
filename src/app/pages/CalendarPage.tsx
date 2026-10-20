/* Календарь — порт pageWsCalendar из views/calendar.js */
import { Plus } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, applyView } from '../data/selectors';
import { CalendarView } from '../components/calendar-view';
import { ViewToolbar, useListView } from '../components/view-toolbar';

export function CalendarPage() {
  const { data } = useWorkspace();
  const api = useListView();
  const tasks = applyView(allTasks(data), api.view);
  // Форма новой задачи ещё не перенесена
  const newTask = () => toast.info('Форма новой задачи пока не перенесена');

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Calendar</h1>
          <p>Deadlines and events across every project.</p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={newTask}>
            <Plus size={14} />
            New task
          </Button>
        </div>
      </div>
      <ViewToolbar api={api} />
      <CalendarView tasks={tasks} events={data.events} onAdd={newTask} />
    </div>
  );
}
