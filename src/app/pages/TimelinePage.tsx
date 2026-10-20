/* Timeline — порт pageWsTimeline из views/timeline.js */
import { toast } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, applyView } from '../data/selectors';
import { TimelineControls, TimelineView, useTimeline } from '../components/timeline-view';
import { ViewToolbar, useListView } from '../components/view-toolbar';

export function TimelinePage() {
  const { data } = useWorkspace();
  const api = useListView();
  const tl = useTimeline('project');
  const tasks = applyView(allTasks(data), api.view, data);
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Timeline</h1>
          <p>Schedules, dependencies, and milestones across projects.</p>
        </div>
      </div>
      <ViewToolbar api={api} group={false} extra={<TimelineControls tl={tl} />} />
      <TimelineView tasks={tasks} tl={tl} onNewTask={() => toast.info('Форма новой задачи пока не перенесена')} />
    </div>
  );
}
