/* Обзор воркспейса — порт pageOverview() из pages/overview.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { ChartGantt, Plus } from 'lucide-react';
import { Button, Progress, toast } from '@/components/ui';
import { STATUSES, StatusIcon } from '@/components/gr8r/task';
import { useWorkspace } from '../data/store';
import { diffDays, fmtDate, parse, relDate, today } from '../lib/dates';
import { allTasks, canSee, isOverdue, member, progressOf, projectColor, tasksOf, visibleProjects } from '../data/selectors';
import { SECTIONS } from '../routes';
import { ProjectIcon, ProjectStatus } from '../components/project';
import { MemberAvatar } from '../components/workspace';

function Panel({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>{title}</h2>
        {actions && <div className="acts">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  return (
    <div className="stat">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      <span className="d">{note}</span>
    </div>
  );
}

export function OverviewPage() {
  const { data } = useWorkspace();
  const navigate = useNavigate();

  const ps = visibleProjects(data).filter(p => canSee(data, p));
  const all = allTasks(data);
  const total = Math.max(all.length, 1);
  const done = all.filter(t => t.status === 'done').length;
  const counts = STATUSES.map(s => ({ s, n: all.filter(t => t.status === s.id).length }));
  const now = today();
  const ms = ps
    .flatMap(p => p.milestones.map(m => ({ ...m, p })))
    .filter(m => diffDays(parse(m.date), now) >= 0)
    .sort((a, b) => (a.date > b.date ? 1 : -1))
    .slice(0, 6);
  const load = data.members
    .filter(m => m.status === 'active')
    .map(m => ({ m, ts: all.filter(t => t.assignee === m.id && t.status !== 'done') }))
    .sort((a, b) => b.ts.length - a.ts.length);
  const maxL = Math.max(...load.map(l => l.ts.length), 1);

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Workspace overview</h1>
          <p>Health of every project in {data.ws.name}.</p>
        </div>
        <div className="acts">
          <Button onClick={() => navigate(SECTIONS.timeline.path)}>
            <ChartGantt size={14} />
            Timeline
          </Button>
          <Button variant="primary" onClick={() => toast.info('Создание проекта пока не перенесено')}>
            <Plus size={14} />
            New project
          </Button>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label="Projects" value={ps.length} note={`${ps.filter(p => p.status === 'complete').length} completed`} />
        <Stat label="Tasks" value={all.length} note={`${all.length - done} open`} />
        <Stat label="Completion rate" value={`${Math.round((done / total) * 100)}%`} note="across all projects" />
        <Stat label="Members" value={data.members.length} note={`${data.members.filter(m => m.status === 'invited').length} pending invite`} />
      </div>

      <div className="grid2">
        <Panel title="Portfolio">
          <div style={{ overflowX: 'auto' }}>
            <table className="perm-t" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 14 }}>Project</th>
                  <th style={{ textAlign: 'left' }}>Lead</th>
                  <th style={{ textAlign: 'left' }}>Status</th>
                  <th style={{ textAlign: 'left', width: '22%' }}>Progress</th>
                  <th>Open</th>
                  <th>Overdue</th>
                  <th style={{ textAlign: 'left' }}>Due</th>
                </tr>
              </thead>
              <tbody>
                {ps.map(p => {
                  const ts = tasksOf(data, p.id);
                  const pr = progressOf(data, p.id);
                  const ov = ts.filter(isOverdue).length;
                  const go = () => navigate(`/projects/${p.id}/overview`);
                  return (
                    <tr
                      key={p.id}
                      style={{ cursor: 'pointer' }}
                      tabIndex={0}
                      aria-label={p.name}
                      onClick={go}
                      onKeyDown={e => e.key === 'Enter' && go()}
                    >
                      <td style={{ paddingLeft: 14 }}>
                        <span className="row">
                          <ProjectIcon project={p} size={14} />
                          <span className="trunc" style={{ fontWeight: 500 }}>
                            {p.name}
                          </span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        <span className="row">
                          <MemberAvatar id={p.lead} size="sm" />
                          <span className="muted trunc">{member(data, p.lead)?.name.split(' ')[0]}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        <ProjectStatus status={p.status} />
                      </td>
                      <td>
                        <span className="row">
                          <Progress value={pr} tone={p.status === 'complete' ? 'green' : p.status === 'risk' ? 'red' : undefined} aria-label={`${p.name} progress`} />
                          <span className="num faint" style={{ fontSize: 11.5, width: 30 }}>
                            {pr}%
                          </span>
                        </span>
                      </td>
                      <td className="num">{ts.filter(t => t.status !== 'done').length}</td>
                      <td className="num" style={{ color: ov ? 'var(--red)' : 'var(--text-3)' }}>
                        {ov}
                      </td>
                      <td style={{ textAlign: 'left' }} className="num muted">
                        {fmtDate(p.due)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="stack">
          <Panel title="Tasks by status">
            <div className="panel-b">
              <div className="stackbar" style={{ height: 10, marginBottom: 12 }}>
                {counts.map(c => (
                  <i key={c.s.id} style={{ width: `${(c.n / total) * 100}%`, background: `var(--st-${c.s.id})` }} title={`${c.s.name}: ${c.n}`} />
                ))}
              </div>
              {counts.map(c => (
                <div key={c.s.id} className="row" style={{ height: 28, fontSize: 13 }}>
                  <StatusIcon status={c.s.id} />
                  <span className="grow">{c.s.name}</span>
                  <span className="num muted">{c.n}</span>
                  <span className="num faint" style={{ width: 36, textAlign: 'right' }}>
                    {Math.round((c.n / total) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Workload"
            actions={
              <span className="faint" style={{ fontSize: 11.5 }}>
                Open tasks per person
              </span>
            }
          >
            <div className="panel-b">
              {load.map(l => (
                <div
                  key={l.m.id}
                  className="row"
                  style={{ height: 30, fontSize: 13, cursor: 'pointer' }}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(SECTIONS.members.path)}
                  onKeyDown={e => e.key === 'Enter' && navigate(SECTIONS.members.path)}
                >
                  <MemberAvatar id={l.m.id} size="sm" tooltip={false} />
                  <span style={{ width: 96 }} className="trunc">
                    {l.m.name.split(' ')[0]}
                  </span>
                  <span className="grow" style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-3)' }}>
                    <span style={{ display: 'flex', width: `${(l.ts.length / maxL) * 100}%` }}>
                      {STATUSES.filter(s => s.id !== 'done').map(s => {
                        const n = l.ts.filter(t => t.status === s.id).length;
                        return n ? <i key={s.id} style={{ display: 'block', flex: n, background: `var(--st-${s.id})` }} /> : null;
                      })}
                    </span>
                  </span>
                  <span className="num muted" style={{ width: 22, textAlign: 'right' }}>
                    {l.ts.length}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Upcoming milestones">
            <div className="panel-b">
              {ms.length ? (
                ms.map(m => (
                  <div
                    key={m.p.id + m.name}
                    className="row"
                    style={{ height: 32, fontSize: 13, cursor: 'pointer' }}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/projects/${m.p.id}/timeline`)}
                    onKeyDown={e => e.key === 'Enter' && navigate(`/projects/${m.p.id}/timeline`)}
                  >
                    <span style={{ width: 9, height: 9, transform: 'rotate(45deg)', background: projectColor(m.p), borderRadius: 2, flexShrink: 0, margin: '0 3px' }} />
                    <span className="grow trunc">
                      {m.name} <span className="faint">· {m.p.name}</span>
                    </span>
                    <span className="num muted">{relDate(m.date)}</span>
                  </div>
                ))
              ) : (
                <div className="faint">No upcoming milestones</div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
