/* Главная — порт pageHome() из pages/home.js */
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowRight,
  ArrowUpRight,
  Calendar,
  CircleCheck,
  CircleDashed,
  ClockAlert,
  FolderKanban,
  FolderPlus,
  ListChecks,
  Plus,
  UserPlus,
} from 'lucide-react';
import { Button, EmptyState, IconButton, Progress, Segmented } from '@/components/ui';
import { PriorityIcon } from '@/components/gr8r/task';
import { useWorkspace } from '../data/store';
import { DAY, diffDays, fmtDate, parse, today } from '../lib/dates';
import { allTasks, canSee, isOverdue, me, progressOf, project, sortTasks, visibleProjects } from '../data/selectors';
import type { Task } from '../data/types';
import { SECTIONS } from '../routes';
import { ProjectDot, ProjectIcon, ProjectStatus } from '../components/project';
import { ActivityItem, MemberAvatar, MemberStack, MiniTaskRow, useTaskActions } from '../components/workspace';
import { useInvite, useProjectForms, useTaskForm } from '../overlays';
import { fmtDateTimeIntl, useT } from '@/i18n';

type Tab = 'upcoming' | 'overdue' | 'completed';
const MAX_ROWS = 7;

function greeting(h: number, t: ReturnType<typeof useT>): string {
  return h < 12 ? t('pages.home.greetingMorning') : h < 18 ? t('pages.home.greetingAfternoon') : t('pages.home.greetingEvening');
}

function Stat({ icon, label, value, note, tone, to }: { icon: React.ReactNode; label: string; value: number; note: string; tone?: 'up' | 'bad'; to: string }) {
  return (
    <Link className="stat" to={to}>
      <span className="k">
        {icon}
        {label}
      </span>
      <span className="v" style={tone === 'bad' ? { color: 'var(--red)' } : undefined}>
        {value}
      </span>
      <span className={`d ${tone ?? ''}`}>{note}</span>
    </Link>
  );
}

function Panel({ title, id, actions, children }: { title: string; id?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-h">
        <h2 id={id}>{title}</h2>
        {actions && <div className="acts">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function HomePage() {
  const t = useT();
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState<Tab>('upcoming');
  const taskForm = useTaskForm();
  const projectForms = useProjectForms();
  const invite = useInvite();
  const openTask = useTaskActions().open;

  const now = today();
  const all = allTasks(data);
  const mine = all.filter(t => t.assignee === data.me);
  const activeProjects = visibleProjects(data).filter(p => canSee(data, p) && p.status !== 'complete');
  const open = all.filter(t => t.status !== 'done');
  const doneThisWeek = all.filter(t => t.status === 'done' && t.completedAt && Date.now() - t.completedAt < 7 * DAY);
  const overdue = all.filter(isOverdue);

  const lists: Record<Tab, Task[]> = {
    upcoming: sortTasks(
      mine.filter(t => t.status !== 'done' && !isOverdue(t)),
      'due',
    ),
    overdue: mine.filter(isOverdue),
    completed: sortTasks(
      mine.filter(t => t.status === 'done'),
      'updated',
    ),
  };
  const rows = lists[tab].slice(0, MAX_ROWS);

  const dueBetween = (label: string, from: number, to: number) => ({
    label,
    tasks: sortTasks(
      open.filter(t => {
        if (!t.due) return false;
        const n = diffDays(parse(t.due), now);
        return n >= from && n <= to;
      }),
      'priority',
    ),
  });
  const deadlines = [
    dueBetween(t('pages.home.deadlines.today'), 0, 0),
    dueBetween(t('pages.home.deadlines.tomorrow'), 1, 1),
    dueBetween(t('pages.home.deadlines.thisWeek'), 2, 7),
  ];

  const dateLine = fmtDateTimeIntl(now, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>
            {greeting(new Date().getHours(), t)}, {me(data).name.split(' ')[0]}
          </h1>
          <p>
            <span className="num">{dateLine}</span> · {t('pages.home.subline')}
          </p>
        </div>
        <div className="acts">
          <Button className="hide-m" onClick={() => invite.open()}>
            <UserPlus size={14} />
            {t('pages.home.inviteMember')}
          </Button>
          <Button className="hide-m" onClick={() => projectForms.create()}>
            <FolderPlus size={14} />
            {t('pages.home.newProject')}
          </Button>
          <Button variant="primary" onClick={() => taskForm.open()}>
            <Plus size={14} />
            {t('pages.home.newTask')}
          </Button>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat to={SECTIONS.projects.path} icon={<FolderKanban size={14} />} label={t('pages.home.activeProjects')} value={activeProjects.length} note={t('pages.home.atRisk', { count: activeProjects.filter(p => p.status === 'risk').length })} />
        <Stat to={SECTIONS.tasks.path} icon={<CircleDashed size={14} />} label={t('pages.home.openTasks')} value={open.length} note={t('pages.home.assignedToYou', { count: open.filter(task => task.assignee === data.me).length })} />
        <Stat to={SECTIONS.tasks.path} icon={<CircleCheck size={14} />} label={t('pages.home.completed')} value={doneThisWeek.length} note={t('pages.home.thisWeek')} tone="up" />
        <Stat
          to={SECTIONS.tasks.path}
          icon={<ClockAlert size={14} />}
          label={t('pages.home.overdue')}
          value={overdue.length}
          note={overdue.length ? t('pages.home.needAttention') : t('pages.home.onTrack')}
          tone={overdue.length ? 'bad' : undefined}
        />
      </div>

      <div className="grid2">
        <div className="stack">
          <Panel
            title={t('pages.home.myTasks')}
            id="h-mytasks"
            actions={
              <>
                <Segmented
                  aria-label={t('pages.home.myTasksFilter')}
                  value={tab}
                  onValueChange={setTab}
                  items={(
                    [
                      ['upcoming', t('pages.home.tabUpcoming')],
                      ['overdue', t('pages.home.tabOverdue')],
                      ['completed', t('pages.home.tabCompleted')],
                    ] as const
                  ).map(([value, name]) => ({
                    value,
                    label: (
                      <>
                        {name} <span className="faint">{lists[value].length}</span>
                      </>
                    ),
                  }))}
                />
                <IconButton size="sm" label={t('pages.home.openMyTasks')} onClick={() => navigate(SECTIONS.mytasks.path)}>
                  <ArrowUpRight size={15} />
                </IconButton>
              </>
            }
          >
            {rows.length ? (
              rows.map(t2 => <MiniTaskRow key={t2.id} task={t2} showAssignee={false} onOpen={openTask} />)
            ) : tab === 'overdue' ? (
              <EmptyState size="sm" icon={<CircleCheck />} title={t('pages.home.nothingOverdue')}>
                {t('pages.home.nothingOverdueHint')}
              </EmptyState>
            ) : (
              <EmptyState size="sm" icon={<ListChecks />} title={t('pages.home.noTasksHere')}>
                {t('pages.home.noTasksHint')}
              </EmptyState>
            )}
            {lists[tab].length > MAX_ROWS && (
              <Link className="addrow" style={{ paddingLeft: 14, borderTop: '1px solid var(--divider)', borderBottom: 0 }} to={SECTIONS.mytasks.path}>
                {t('pages.home.viewAllTasks', { count: lists[tab].length })} <ArrowRight size={13} />
              </Link>
            )}
          </Panel>

          <Panel
            title={t('pages.home.projectProgress')}
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate(SECTIONS.projects.path)}>
                {t('pages.home.allProjects')}
              </Button>
            }
          >
            <div style={{ overflowX: 'auto' }}>
              <table className="perm-t" style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 14 }}>{t('pages.home.colProject')}</th>
                    <th style={{ textAlign: 'left' }}>{t('pages.home.colStatus')}</th>
                    <th style={{ textAlign: 'left', width: '26%' }}>{t('pages.home.colProgress')}</th>
                    <th style={{ textAlign: 'left' }}>{t('pages.home.colDue')}</th>
                    <th style={{ textAlign: 'right', paddingRight: 14 }}>{t('pages.home.colTeam')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeProjects.map(p => {
                    const pr = progressOf(data, p.id);
                    return (
                      <tr key={p.id} className="cursor-pointer hover:bg-surface-2" onClick={() => navigate(`/projects/${p.id}`)}>
                        <td style={{ paddingLeft: 14 }}>
                          <Link to={`/projects/${p.id}`} className="row" onClick={e => e.stopPropagation()}>
                            <ProjectIcon project={p} size={14} />
                            <b style={{ fontWeight: 500 }}>{p.name}</b>
                          </Link>
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          <ProjectStatus status={p.status} />
                        </td>
                        <td>
                          <span className="row">
                            <Progress value={pr} tone={p.status === 'risk' ? 'red' : undefined} aria-label={t('pages.home.progressAria', { name: p.name })} />
                            <span className="num faint" style={{ fontSize: 11.5, width: 30 }}>
                              {pr}%
                            </span>
                          </span>
                        </td>
                        <td style={{ textAlign: 'left' }} className="num muted">
                          {fmtDate(p.due)}
                        </td>
                        <td style={{ textAlign: 'right', paddingRight: 14 }}>
                          <MemberStack ids={p.members} max={3} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="stack">
          <Panel
            title={t('pages.home.upcomingDeadlines')}
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate(SECTIONS.calendar.path)}>
                <Calendar size={13} />
                {t('pages.home.calendar')}
              </Button>
            }
          >
            <div className="panel-b" style={{ paddingBottom: 6 }}>
              {deadlines.map(g => (
                <div key={g.label} style={{ marginBottom: 10 }}>
                  <div className="row" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>
                    {g.label}
                    <span className="faint" style={{ fontWeight: 500 }}>
                      {g.tasks.length}
                    </span>
                  </div>
                  {g.tasks.length ? (
                    <>
                      {g.tasks.slice(0, 4).map(t2 => (
                        <div
                          key={t2.id}
                          className="row cursor-pointer"
                          style={{ height: 30, gap: 8, fontSize: 13 }}
                          role="button"
                          tabIndex={0}
                          onClick={() => openTask(t2)}
                          onKeyDown={e => e.key === 'Enter' && openTask(t2)}
                        >
                          <ProjectDot project={project(data, t2.project)} />
                          <span className="trunc flex-1">{t2.title}</span>
                          {t2.priority != null && <PriorityIcon priority={t2.priority} size={13} />}
                          <MemberAvatar id={t2.assignee} size="sm" />
                        </div>
                      ))}
                      {g.tasks.length > 4 && (
                        <div className="faint" style={{ fontSize: 11.5, paddingLeft: 16 }}>
                          {t('pages.home.more', { count: g.tasks.length - 4 })}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="faint" style={{ fontSize: 12.5, padding: '4px 0 2px' }}>
                      {t('pages.home.nothingDue')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title={t('pages.home.recentActivity')}
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate(SECTIONS.activity.path)}>
                {t('pages.home.viewAll')}
              </Button>
            }
          >
            <div className="panel-b feed lined">
              {data.activity.slice(0, 7).map(a => (
                <ActivityItem key={a.id} a={a} showProject />
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
