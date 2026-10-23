/* Команды и страница команды — порт pageTeams и pageTeam из pages/members.js */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { Pencil, Plus, UserPlus, Users } from 'lucide-react';
import { Badge, Button, EmptyState, Progress } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, progressOf, sortTasks, visibleProjects } from '../data/selectors';
import { MemberAvatar, MiniTaskRow, useTaskActions } from '../components/workspace';
import { NamedIcon } from '../components/icons';
import { ProjectIcon, ProjectStatus } from '../components/project';
import { useInvite, useTeamForm } from '../overlays';
import { NotFoundPage } from './PlaceholderPage';
import { TeamsGrid } from './MembersPage';
import { useT } from '@/i18n';

/** Все команды воркспейса (маршрут /teams, в сайдбаре отдельного пункта нет — туда ведёт крошка) */
export function TeamsPage() {
  const t = useT();
  const { data } = useWorkspace();
  const teamForm = useTeamForm();
  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>{t('pages.teams.title')}</h1>
          <p>{t('pages.teams.subline')}</p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => teamForm.create()}>
            <Plus size={14} />
            {t('pages.teams.newTeam')}
          </Button>
        </div>
      </div>
      {data.teams.length ? (
        <TeamsGrid />
      ) : (
        <div className="panel">
          <EmptyState
            icon={<Users />}
            title={t('pages.teams.noTeamsTitle')}
            action={
              <Button size="sm" onClick={() => teamForm.create()}>
                <Plus size={14} />
                {t('pages.teams.newTeam')}
              </Button>
            }
          >
            {t('pages.teams.noTeamsHint')}
          </EmptyState>
        </div>
      )}
    </div>
  );
}

export function TeamPage() {
  const tr = useT();
  const { id } = useParams();
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const taskActions = useTaskActions();
  const teamForm = useTeamForm();
  const invite = useInvite();

  const team = data.teams.find(x => x.id === id);
  if (!team) return <NotFoundPage />;

  const ms = data.members.filter(m => m.team === team.id);
  const ps = visibleProjects(data).filter(p => p.team === team.id);
  const ts = allTasks(data).filter(x => ms.some(m => m.id === x.assignee) && x.status !== 'done');
  const go = (to: string) => ({
    role: 'link',
    tabIndex: 0,
    onClick: () => navigate(to),
    onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && e.target === e.currentTarget && navigate(to),
  });

  return (
    <div className="page">
      <div className="ph">
        <div className="row" style={{ gap: 12 }}>
          <span className="picon lg" style={{ '--c': team.c } as React.CSSProperties}>
            <NamedIcon name={team.icon} size={18} />
          </span>
          <div>
            <h1>{team.name}</h1>
            <p style={{ margin: '2px 0 0' }}>{team.desc}</p>
          </div>
        </div>
        <div className="acts">
          <Button variant="secondary" onClick={() => teamForm.edit(team.id)}>
            <Pencil size={14} />
            {tr('pages.teams.editTeam')}
          </Button>
          <Button variant="secondary" onClick={() => invite.open({ team: team.id })}>
            <UserPlus size={14} />
            {tr('pages.teams.inviteToWorkspace')}
          </Button>
        </div>
      </div>
      <div className="grid2">
        <div className="stack">
          <section className="panel">
            <div className="panel-h">
              <h2>{tr('pages.teams.projectsTitle')}</h2>
              <span className="faint">{ps.length}</span>
            </div>
            {ps.length ? (
              ps.map(p => (
                <div key={p.id} className="mini" {...go(`/projects/${p.id}`)}>
                  <ProjectIcon project={p} size={14} />
                  <span className="tt">{p.name}</span>
                  <ProjectStatus status={p.status} />
                  <span className="row" style={{ width: 120 }}>
                    <Progress value={progressOf(data, p.id)} aria-label={`${p.name} progress`} />
                  </span>
                </div>
              ))
            ) : (
              <div className="panel-b faint">{tr('pages.teams.noProjects')}</div>
            )}
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>{tr('pages.teams.openTasksTitle')}</h2>
              <span className="faint">{ts.length}</span>
            </div>
            {sortTasks(ts, 'due', 1, data)
              .slice(0, 8)
              .map(x => (
                <MiniTaskRow key={x.id} task={x} onOpen={taskActions.open} />
              ))}
          </section>
        </div>
        <section className="panel" style={{ alignSelf: 'start' }}>
          <div className="panel-h">
            <h2>{tr('pages.teams.membersTitle')}</h2>
            <span className="faint">{ms.length}</span>
          </div>
          {ms.map(m => (
            <div key={m.id} className="mini" style={{ minHeight: 48 }} {...go(`/members/${m.id}`)}>
              <MemberAvatar id={m.id} size="md" tooltip={false} />
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{m.name}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {m.title}
                </div>
              </div>
              <Badge>{m.role}</Badge>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
