/* Архив — порт pageArchive из features/archive.js и действий restoreTask/purgeTask/restoreProject из actions/archive.js */
import * as React from 'react';
import { Archive, RotateCcw, Trash2 } from 'lucide-react';
import { Button, EmptyState, IconButton, Tab, Tabs, TabsList, toast } from '@/components/ui';
import { StatusIcon } from '@/components/gr8r/task';
import { useWorkspace } from '../data/store';
import { PROJECT_STATUS, canSee, project } from '../data/selectors';
import type { Project, Task } from '../data/types';
import { ago } from '../lib/dates';
import { ProjectIcon } from '../components/project';
import { ConfirmModal, type ConfirmSpec } from '../overlays/project-dialogs';
import { useProjectForms, useTaskDrawer } from '../overlays';

type TabId = 'tasks' | 'projects';

/** Строка архива: иконка, название с подписью, когда архивировано, «Restore» и «Delete permanently» */
function Row({ lead, title, sub, when, onRestore, onDelete }: { lead: React.ReactNode; title: React.ReactNode; sub: React.ReactNode; when: string; onRestore: () => void; onDelete: () => void }) {
  return (
    <div className="mini" style={{ minHeight: 52, cursor: 'default', gap: 12 }}>
      {lead}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="trunc" style={{ fontWeight: 500 }}>
          {title}
        </div>
        <div className="faint trunc" style={{ fontSize: 12 }}>
          {sub}
        </div>
      </div>
      <span className="faint hide-m" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        {when}
      </span>
      <Button variant="secondary" size="sm" onClick={onRestore}>
        <RotateCcw size={13} />
        Restore
      </Button>
      <IconButton size="sm" label="Delete permanently" style={{ color: 'var(--red)' }} onClick={onDelete}>
        <Trash2 size={15} />
      </IconButton>
    </div>
  );
}

export function ArchivePage() {
  const { data, dispatch } = useWorkspace();
  const drawer = useTaskDrawer();
  const projectForms = useProjectForms();
  const [tab, setTab] = React.useState<TabId>('tasks');
  const [confirm, setConfirm] = React.useState<ConfirmSpec | null>(null);

  // Архивные задачи не из архивных проектов (те лежат во вкладке Projects)
  const ts = data.tasks
    .filter(t => t.archived && canSee(data, project(data, t.project)) && !project(data, t.project)?.archived)
    .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  const ps = data.projects.filter(p => p.archived);

  const restoreTask = (t: Task) => {
    dispatch({ type: 'task/restore', id: t.id });
    toast(`Restored “${t.title}”`, { action: { label: 'Open', onClick: () => drawer.open(t.id) } });
  };
  const purgeTask = (t: Task) =>
    setConfirm({
      title: 'Delete task permanently?',
      body: (
        <>
          <b>{t.title}</b>, its subtasks, comments, and attachments will be deleted for everyone. This can't be undone.
        </>
      ),
      ok: 'Delete permanently',
      danger: true,
      run: () => {
        const snap = data;
        dispatch({ type: 'task/delete', ids: [t.id] });
        toast(`Deleted “${t.title}”`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'data/restore', data: snap }) } });
      },
    });
  const restoreProject = (p: Project) => {
    dispatch({ type: 'project/update', id: p.id, patch: { archived: false, archivedAt: null } });
    toast(`Restored ${p.name}`);
  };

  let body: React.ReactNode;
  if (tab === 'tasks')
    body = ts.length ? (
      <div className="panel" style={{ overflow: 'hidden' }}>
        {ts.map(t => (
          <Row
            key={t.id}
            lead={<StatusIcon status={t.status} size={15} />}
            title={t.title}
            sub={
              <>
                <span className="mono">{t.key}</span> · {project(data, t.project)?.name}
              </>
            }
            when={t.archivedAt ? 'Archived ' + ago(t.archivedAt) : 'Archived'}
            onRestore={() => restoreTask(t)}
            onDelete={() => purgeTask(t)}
          />
        ))}
      </div>
    ) : (
      <div className="panel">
        <EmptyState icon={<Archive />} title="No archived tasks">
          Archive finished or abandoned tasks to keep boards focused. They wait here until you restore them.
        </EmptyState>
      </div>
    );
  else
    body = ps.length ? (
      <div className="panel" style={{ overflow: 'hidden' }}>
        {ps.map(p => (
          <Row
            key={p.id}
            lead={<ProjectIcon project={p} size={14} />}
            title={p.name}
            sub={`${data.tasks.filter(t => t.project === p.id).length} tasks · ${PROJECT_STATUS[p.status].name}`}
            when={p.archivedAt ? 'Archived ' + ago(p.archivedAt) : 'Archived'}
            onRestore={() => restoreProject(p)}
            onDelete={() => projectForms.remove(p.id)}
          />
        ))}
      </div>
    ) : (
      <div className="panel">
        <EmptyState icon={<Archive />} title="No archived projects">
          Archived projects disappear from the sidebar and project lists but keep every task, file, and comment.
        </EmptyState>
      </div>
    );

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="ph">
        <div>
          <h1>Archive</h1>
          <p>Archived work is hidden everywhere else. Restore it any time, or delete it for good.</p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={v => setTab(v as TabId)}>
        <TabsList aria-label="Archive" style={{ marginBottom: 14 }}>
          <Tab value="tasks" count={ts.length}>
            Tasks
          </Tab>
          <Tab value="projects" count={ps.length}>
            Projects
          </Tab>
        </TabsList>
      </Tabs>
      {body}
      {confirm && <ConfirmModal spec={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
