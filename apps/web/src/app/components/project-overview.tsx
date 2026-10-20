/* Вкладки Overview и Activity страницы проекта — порт projOverview / projActivity из views/project-overview.js */
import { useNavigate } from 'react-router';
import { Activity, Calendar, CircleCheck, CircleDot, ClockAlert, Flag, Pencil, User, UserPlus, Users } from 'lucide-react';
import { Badge, Button, EmptyState } from '@/components/ui';
import { StatusIcon } from '@/components/gr8r/task';
import { useWorkspace } from '../data/store';
import { dayBucket, fmtHours, isOverdue, member, progressOf, projectColor, sortTasks, task as findTask, taskTime, tasksOf, totalTime } from '../data/selectors';
import type { Activity as ActivityRec, Project, Status } from '../data/types';
import { diffDays, fmtDate, parse, today } from '../lib/dates';
import { NamedIcon } from './icons';
import { ProjectStatus, ProjectStatusMenu } from './project';
import { ActivityItem, MemberAvatar, MemberStack, MiniTaskRow, useTaskActions } from './workspace';
import { TimeTotals } from './time-summary';
import { useProjectForms } from '../overlays';

interface OverviewProps {
  project: Project;
  /** Переход на вкладку проекта */
  onTab: (tab: string) => void;
  /** Список проекта, отфильтрованный по статусу (goFilteredList) */
  onStatusList: (s: Status) => void;
}

export function ProjectOverview({ project: p, onTab, onStatusList }: OverviewProps) {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const { open } = useTaskActions();
  const ts = tasksOf(data, p.id);
  const pr = progressOf(data, p.id);
  const cnt = data.statuses.map(s => ({ s, n: ts.filter(t => t.status === s.id).length }));
  const over = ts.filter(isOverdue);
  const soon = sortTasks(
    ts.filter(t => t.status !== 'done' && t.due),
    'due',
    1,
  ).slice(0, 6);
  const acts = data.activity.filter(a => a.project === p.id).slice(0, 6);
  const time = totalTime(data.timeLogs, ts);
  const overPlan = ts
    .map(t => ({ t, x: taskTime(data.timeLogs, t) }))
    .filter(r => r.x.over)
    .sort((a, b) => b.x.variance! - a.x.variance!)
    .slice(0, 3);
  const daysLeft = diffDays(parse(p.due), today());
  const lead = member(data, p.lead);
  const team = data.teams.find(t => t.id === p.team);
  const projectForms = useProjectForms();
  const share = () => projectForms.share(p.id);

  return (
    <div className="page" style={{ maxWidth: 1160, paddingTop: 22 }}>
      <div className="grid2">
        <div className="stack">
          <section className="panel">
            <div className="panel-h">
              <h2>About</h2>
              <div className="acts">
                <Button size="sm" variant="ghost" onClick={() => projectForms.edit(p.id)}>
                  <Pencil size={13} />
                  Edit
                </Button>
              </div>
            </div>
            <div className="panel-b" style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
              {p.desc}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>Progress</h2>
              <div className="acts">
                <span className="faint" style={{ fontSize: 12 }}>
                  {ts.filter(t => t.status === 'done').length} of {ts.length} tasks done
                </span>
              </div>
            </div>
            <div className="panel-b">
              <div className="row" style={{ alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-.03em' }} className="num">
                  {pr}%
                </span>
                <span className="muted">{daysLeft >= 0 ? `${daysLeft} days until ${fmtDate(p.due)}` : `Ended ${fmtDate(p.due)}`}</span>
                {over.length > 0 && (
                  <Badge tone="red">
                    <ClockAlert size={11} />
                    {over.length} overdue
                  </Badge>
                )}
              </div>
              <div className="stackbar" style={{ height: 8, marginBottom: 12 }}>
                {cnt.map(c => (
                  <i key={c.s.id} style={{ width: `${(c.n / Math.max(ts.length, 1)) * 100}%`, background: `var(--st-${c.s.id})` }} title={`${c.s.name}: ${c.n}`} />
                ))}
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 14, fontSize: 12.5 }}>
                {cnt.map(c => (
                  <button key={c.s.id} className="row" style={{ gap: 5 }} onClick={() => onStatusList(c.s.id)}>
                    <StatusIcon status={c.s.id} size={12} />
                    <span className="muted">{c.s.name}</span>
                    <b className="num" style={{ fontWeight: 600 }}>
                      {c.n}
                    </b>
                  </button>
                ))}
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>Time</h2>
              <div className="acts">
                <span className="faint" style={{ fontSize: 12 }}>
                  Plan vs. logged hours
                </span>
              </div>
            </div>
            <div className="panel-b">
              <TimeTotals x={time} />
              {overPlan.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="faint" style={{ fontSize: 12, marginBottom: 2 }}>
                    Over plan
                  </div>
                  {overPlan.map(({ t, x }) => (
                    <div key={t.id} className="row" style={{ height: 30, fontSize: 13, cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => open(t)} onKeyDown={e => e.key === 'Enter' && open(t)}>
                      <StatusIcon status={t.status} />
                      <span className="grow trunc">{t.title}</span>
                      <span className="num muted">
                        {fmtHours(x.actual)}/{fmtHours(x.plan)}
                      </span>
                      <span className="num" style={{ color: 'var(--red)', width: 52, textAlign: 'right' }}>
                        +{fmtHours(x.variance!)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>Coming up</h2>
              <div className="acts">
                <Button size="sm" variant="ghost" onClick={() => onTab('list')}>
                  View list
                </Button>
              </div>
            </div>
            {soon.length ? (
              soon.map(t => <MiniTaskRow key={t.id} task={t} showProject={false} onOpen={open} />)
            ) : (
              <EmptyState size="sm" icon={<CircleCheck />} title="Nothing scheduled">
                Tasks with due dates will show up here.
              </EmptyState>
            )}
          </section>
        </div>
        <div className="stack">
          <section className="panel">
            <div className="panel-h">
              <h2>Details</h2>
            </div>
            <div className="panel-b">
              <dl className="kv">
                <dt>
                  <CircleDot size={14} />
                  Status
                </dt>
                <dd>
                  <ProjectStatusMenu project={p}>
                    <button className="pillbtn">
                      <ProjectStatus status={p.status} />
                    </button>
                  </ProjectStatusMenu>
                </dd>
                <dt>
                  <User size={14} />
                  Lead
                </dt>
                <dd>
                  <span className="pillbtn">
                    <MemberAvatar id={p.lead} size="sm" tooltip={false} />
                    {lead?.name}
                  </span>
                </dd>
                <dt>
                  <Users size={14} />
                  Team
                </dt>
                <dd>
                  <button className="pillbtn" onClick={() => navigate(`/teams/${p.team}`)}>
                    {team && <NamedIcon name={team.icon} size={13} />}
                    {team?.name}
                  </button>
                </dd>
                <dt>
                  <Calendar size={14} />
                  Start
                </dt>
                <dd>
                  <span className="pillbtn num">{fmtDate(p.start, true)}</span>
                </dd>
                <dt>
                  <Flag size={14} />
                  Due
                </dt>
                <dd>
                  <span className="pillbtn num">{fmtDate(p.due, true)}</span>
                </dd>
                <dt>
                  <UserPlus size={14} />
                  Members
                </dt>
                <dd>
                  <button className="pillbtn" onClick={share}>
                    <MemberStack ids={p.members} max={6} />
                    <span className="faint">{p.members.length}</span>
                  </button>
                </dd>
              </dl>
            </div>
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>Milestones</h2>
            </div>
            <div className="panel-b">
              {p.milestones?.length ? (
                p.milestones.map(m => {
                  const n = diffDays(parse(m.date), today());
                  return (
                    <div key={m.name} className="row" style={{ height: 32, fontSize: 13 }}>
                      <span style={{ width: 9, height: 9, transform: 'rotate(45deg)', borderRadius: 2, flexShrink: 0, margin: '0 3px', background: n < 0 ? 'var(--green)' : projectColor(p) }} />
                      <span className={`grow trunc ${n < 0 ? 'faint' : ''}`}>{m.name}</span>
                      <span className="num muted">{fmtDate(m.date)}</span>
                    </div>
                  );
                })
              ) : (
                <span className="faint">No milestones yet</span>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>Recent activity</h2>
              <div className="acts">
                <Button size="sm" variant="ghost" onClick={() => onTab('activity')}>
                  View all
                </Button>
              </div>
            </div>
            <div className="panel-b feed">{acts.length ? acts.map(a => <ActivityItem key={a.id} a={a} />) : <span className="faint">No activity yet</span>}</div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function ProjectActivity({ project: p }: { project: Project }) {
  const { data } = useWorkspace();
  // Комментарии к задачам проекта тоже попадают в ленту
  const comments: ActivityRec[] = data.comments
    .filter(c => findTask(data, c.task)?.project === p.id)
    .map(c => ({ id: c.id, by: c.by, verb: 'commented on', task: c.task, project: p.id, at: c.at, extra: '' }));
  const all = [...data.activity.filter(a => a.project === p.id), ...comments].sort((a, b) => b.at - a.at);
  const buckets: Record<string, ActivityRec[]> = {};
  all.forEach(a => (buckets[dayBucket(a.at)] ||= []).push(a));
  return (
    <div className="page" style={{ maxWidth: 780, paddingTop: 18 }}>
      {all.length ? (
        Object.entries(buckets).map(([k, list]) => (
          <div key={k} className="contents">
            <div className="day-h">{k}</div>
            <div className="feed lined">
              {list.map(a => (
                <ActivityItem key={a.id} a={a} />
              ))}
            </div>
          </div>
        ))
      ) : (
        <EmptyState icon={<Activity />} title="No activity yet">
          Changes to this project will appear here.
        </EmptyState>
      )}
    </div>
  );
}
