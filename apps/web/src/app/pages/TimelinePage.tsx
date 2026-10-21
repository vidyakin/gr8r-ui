/* Timeline — порт pageWsTimeline из views/timeline.js */
import { useWorkspace } from '../data/store';
import { allTasks, applyView, generalScope } from '../data/selectors';
import { TimelineControls, TimelineView, useTimeline } from '../components/timeline-view';
import { ViewToolbar, useListView } from '../components/view-toolbar';
import { useTaskForm } from '../overlays';

export function TimelinePage() {
  const { data } = useWorkspace();
  const api = useListView();
  const tl = useTimeline('project');
  const taskForm = useTaskForm();
  const tasks = applyView(generalScope(allTasks(data), api.view), api.view, data);
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Timeline</h1>
          <p>Schedules, dependencies, and milestones across projects.</p>
        </div>
      </div>
      <ViewToolbar api={api} group={false} extra={<TimelineControls tl={tl} />} />
      <TimelineView tasks={tasks} tl={tl} onNewTask={() => taskForm.open()} />
    </div>
  );
}
