/* Профиль участника — порт pageMember из pages/members.js */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { Clock, Copy, Crown, ListChecks, Mail, MapPin, Plus } from 'lucide-react';
import { Badge, Button, EmptyState, Select, Tab, Tabs, TabsList } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { allTasks, canSee, fmtHours, isOverdue, member, sortTasks, visibleProjects } from '../data/selectors';
import { ago, dOff, minsAgo } from '../lib/dates';
import { ActivityItem, MemberAvatar, MiniTaskRow, useTaskActions } from '../components/workspace';
import { ProjectIcon } from '../components/project';
import { WeekBars } from '../components/time-summary';
import { MemberMenu, useMemberActions } from '../components/member';
import { NotFoundPage } from './PlaceholderPage';

export function MemberPage() {
  const { id } = useParams();
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const taskActions = useTaskActions();
  const actions = useMemberActions();
  const [tab, setTab] = React.useState<'assigned' | 'completed'>('assigned');
  const [mod, setMod] = React.useState<'all' | 'general' | 'production' | 'services'>('all');

  const m = member(data, id);
  if (!m) return <NotFoundPage />;

  const ts = allTasks(data).filter(t => t.assignee === m.id);
  const open = ts.filter(t => t.status !== 'done');
  const done = ts.filter(t => t.status === 'done');
  const overdue = open.filter(isOverdue).length;
  const ps = visibleProjects(data).filter(p => p.members.includes(m.id) && p.status !== 'complete' && canSee(data, p));
  const acts = data.activity.filter(a => a.by === m.id).slice(0, 8);
  const visibleIds = new Set(allTasks(data).map(t => t.id));
  const taskModule = new Map(data.tasks.map(t => [t.id, t.module]));
  const weekFrom = dOff(-6);
  const week = data.timeLogs.filter(l => l.by === m.id && l.date >= weekFrom && l.date <= dOff(0) && visibleIds.has(l.task) && (mod === 'all' || taskModule.get(l.task) === mod));
  const weekTotal = week.reduce((a, l) => a + l.hours, 0);
  const weekTasks = new Set(week.map(l => l.task)).size;
  const team = data.teams.find(t => t.id === m.team);
  const online = m.last != null && m.last < 5;
  const list = tab === 'assigned' ? sortTasks(open, 'due', 1, data) : done;

  return (
    <div className="page">
      <div className="row" style={{ gap: 18, marginBottom: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <MemberAvatar id={m.id} size="xl" online={online} tooltip={false} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 'var(--fs-2xl)', margin: 0, fontWeight: 600, letterSpacing: '-.02em' }}>{m.name}</h1>
            <Badge>
              {m.role === 'Owner' && <Crown size={11} />}
              {m.role}
            </Badge>
            {m.status === 'invited' && <Badge tone="amber">Invite pending</Badge>}
          </div>
          <div className="muted" style={{ marginTop: 3 }}>
            {m.title}
            {team && ` · ${team.name}`}
          </div>
          <div className="row faint" style={{ marginTop: 8, gap: 14, fontSize: 12.5, flexWrap: 'wrap' }}>
            <span className="row" style={{ gap: 5 }}>
              <Mail size={13} />
              <span style={{ userSelect: 'all' }}>{m.email}</span>
            </span>
            <span className="row" style={{ gap: 5 }}>
              <MapPin size={13} />
              {m.tz}
            </span>
            <span className="row" style={{ gap: 5 }}>
              <Clock size={13} />
              {m.last == null ? 'Never signed in' : online ? 'Online now' : 'Active ' + ago(minsAgo(m.last))}
            </span>
          </div>
        </div>
        <div className="row">
          <Button variant="secondary" onClick={() => actions.copyEmail(m)}>
            <Copy size={14} />
            Copy email
          </Button>
          <Button variant="primary" onClick={() => actions.assign(m)}>
            <Plus size={14} />
            Assign task
          </Button>
          <MemberMenu m={m} actions={actions} size="md" iconSize={16} label="More" />
        </div>
      </div>
      <div className="stats" style={{ marginBottom: 18 }}>
        <div className="stat">
          <span className="k">Active projects</span>
          <span className="v">{ps.length}</span>
        </div>
        <div className="stat">
          <span className="k">Assigned tasks</span>
          <span className="v">{open.length}</span>
        </div>
        <div className="stat">
          <span className="k">Completed tasks</span>
          <span className="v">{done.length}</span>
        </div>
        <div className="stat">
          <span className="k">Overdue</span>
          <span className="v" style={overdue ? { color: 'var(--red)' } : undefined}>
            {overdue}
          </span>
        </div>
      </div>
      <div className="grid2">
        <section className="panel">
          <Tabs value={tab} onValueChange={v => setTab(v as 'assigned' | 'completed')}>
            <TabsList style={{ padding: '0 8px' }}>
              <Tab value="assigned">Assigned · {open.length}</Tab>
              <Tab value="completed">Completed · {done.length}</Tab>
            </TabsList>
          </Tabs>
          {list.length ? (
            list.map(t => <MiniTaskRow key={t.id} task={t} showAssignee={false} onOpen={taskActions.open} />)
          ) : (
            <EmptyState size="sm" icon={<ListChecks />} title="No tasks here">
              Nothing to show in this list.
            </EmptyState>
          )}
        </section>
        <div className="stack">
          <section className="panel">
            <div className="panel-h">
              <h2>Active projects</h2>
            </div>
            {ps.length ? (
              ps.map(p => (
                <div key={p.id} className="mini" role="link" tabIndex={0} onClick={() => navigate(`/projects/${p.id}`)} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && navigate(`/projects/${p.id}`)}>
                  <ProjectIcon project={p} size={14} />
                  <span className="tt">{p.name}</span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {p.lead === m.id ? 'Lead' : 'Member'}
                  </span>
                </div>
              ))
            ) : (
              <div className="panel-b faint">No active projects</div>
            )}
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>Time logged</h2>
              <div className="acts">
                <span className="faint" style={{ fontSize: 12 }}>
                  Last 7 days
                </span>
                <Select
                  aria-label="Module"
                  value={mod}
                  onValueChange={v => setMod(v as typeof mod)}
                  options={[
                    { value: 'all', label: 'All modules' },
                    { value: 'general', label: 'General' },
                    { value: 'production', label: 'Production' },
                    { value: 'services', label: 'Services' },
                  ]}
                />
              </div>
            </div>
            <div className="panel-b">
              <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em' }} className="num">
                  {fmtHours(weekTotal)}
                </span>
                <span className="faint" style={{ fontSize: 12 }}>
                  across {weekTasks} task{weekTasks === 1 ? '' : 's'}
                </span>
              </div>
              <WeekBars logs={week} />
            </div>
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>Recent activity</h2>
            </div>
            <div className="panel-b feed">
              {acts.length ? acts.map(a => <ActivityItem key={a.id} a={a} />) : <span className="faint">No recent activity</span>}
            </div>
          </section>
        </div>
      </div>
      {actions.confirm}
    </div>
  );
}
