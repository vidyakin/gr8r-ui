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
import { useT } from '@/i18n';

type TabId = 'tasks' | 'projects';

/** Строка архива: иконка, название с подписью, когда архивировано, «Restore» и «Delete permanently» */
function Row({ lead, title, sub, when, onRestore, onDelete, t }: { lead: React.ReactNode; title: React.ReactNode; sub: React.ReactNode; when: string; onRestore: () => void; onDelete: () => void; t: ReturnType<typeof useT> }) {
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
        {t('pages.archive.restore')}
      </Button>
      <IconButton size="sm" label={t('pages.archive.deletePermanently')} style={{ color: 'var(--red)' }} onClick={onDelete}>
        <Trash2 size={15} />
      </IconButton>
    </div>
  );
}

export function ArchivePage() {
  const t = useT();
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

  const restoreTask = (task: Task) => {
    dispatch({ type: 'task/restore', id: task.id });
    toast(t('pages.archive.taskRestored', { title: task.title }), { action: { label: t('common.open'), onClick: () => drawer.open(task.id) } });
  };
  const purgeTask = (task: Task) =>
    setConfirm({
      title: t('pages.archive.deleteTaskTitle'),
      body: (
        <>
          <b>{task.title}</b>, {t('pages.archive.deleteTaskBody')}
        </>
      ),
      ok: t('pages.archive.deletePermanently'),
      danger: true,
      run: () => {
        const snap = data;
        dispatch({ type: 'task/delete', ids: [task.id] });
        toast(t('pages.archive.taskDeleted', { title: task.title }), { action: { label: t('common.undo'), onClick: () => dispatch({ type: 'data/restore', data: snap }) } });
      },
    });
  const restoreProject = (p: Project) => {
    dispatch({ type: 'project/update', id: p.id, patch: { archived: false, archivedAt: null } });
    toast(t('pages.archive.projectRestored', { name: p.name }));
  };

  let body: React.ReactNode;
  if (tab === 'tasks')
    body = ts.length ? (
      <div className="panel" style={{ overflow: 'hidden' }}>
        {ts.map(task => (
          <Row
            key={task.id}
            t={t}
            lead={<StatusIcon status={task.status} size={15} />}
            title={task.title}
            sub={
              <>
                <span className="mono">{task.key}</span> · {project(data, task.project)?.name}
              </>
            }
            when={task.archivedAt ? t('pages.archive.archivedAgo', { ago: ago(task.archivedAt) }) : t('pages.archive.archived')}
            onRestore={() => restoreTask(task)}
            onDelete={() => purgeTask(task)}
          />
        ))}
      </div>
    ) : (
      <div className="panel">
        <EmptyState icon={<Archive />} title={t('pages.archive.noArchivedTasksTitle')}>
          {t('pages.archive.noArchivedTasksHint')}
        </EmptyState>
      </div>
    );
  else
    body = ps.length ? (
      <div className="panel" style={{ overflow: 'hidden' }}>
        {ps.map(p => (
          <Row
            key={p.id}
            t={t}
            lead={<ProjectIcon project={p} size={14} />}
            title={p.name}
            sub={t('pages.archive.projectMeta', {
              tasksCount: data.tasks.filter(task => task.project === p.id).length,
              status: PROJECT_STATUS[p.status].name,
            })}
            when={p.archivedAt ? t('pages.archive.archivedAgo', { ago: ago(p.archivedAt) }) : t('pages.archive.archived')}
            onRestore={() => restoreProject(p)}
            onDelete={() => projectForms.remove(p.id)}
          />
        ))}
      </div>
    ) : (
      <div className="panel">
        <EmptyState icon={<Archive />} title={t('pages.archive.noArchivedProjectsTitle')}>
          {t('pages.archive.noArchivedProjectsHint')}
        </EmptyState>
      </div>
    );

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="ph">
        <div>
          <h1>{t('pages.archive.title')}</h1>
          <p>{t('pages.archive.subline')}</p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={v => setTab(v as TabId)}>
        <TabsList aria-label={t('pages.archive.tabsLabel')} style={{ marginBottom: 14 }}>
          <Tab value="tasks" count={ts.length}>
            {t('pages.archive.tabTasks')}
          </Tab>
          <Tab value="projects" count={ps.length}>
            {t('pages.archive.tabProjects')}
          </Tab>
        </TabsList>
      </Tabs>
      {body}
      {confirm && <ConfirmModal spec={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
