/* Обзор воркспейса — порт pageOverview() из pages/overview.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { ChartGantt, Plus } from 'lucide-react';
import { Button, Progress } from '@/components/ui';
import { StatusIcon } from '@/components/gr8r/task';
import { useWorkspace } from '../data/store';
import { diffDays, fmtDate, parse, relDate, today } from '../lib/dates';
import { allTasks, canSee, fmtHours, isOverdue, member, progressOf, projectColor, tasksOf, totalTime, visibleProjects } from '../data/selectors';
import { SECTIONS } from '../routes';
import { ProjectIcon, ProjectStatus } from '../components/project';
import { MemberAvatar } from '../components/workspace';
import { TimeTotals } from '../components/time-summary';
import { useProjectForms } from '../overlays';
import { useT } from '@/i18n';

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
  const tr = useT();
  const projectForms = useProjectForms();
  const { data } = useWorkspace();
  const navigate = useNavigate();

  const ps = visibleProjects(data).filter(p => canSee(data, p));
  const all = allTasks(data);
  const total = Math.max(all.length, 1);
  const done = all.filter(t => t.status === 'done').length;
  const counts = data.statuses.map(s => ({ s, n: all.filter(t => t.status === s.id).length }));
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
  const time = totalTime(data.timeLogs, all);
  const byProject = ps
    .map(p => ({ p, x: totalTime(data.timeLogs, tasksOf(data, p.id)) }))
    .filter(r => r.x.plan > 0 || r.x.actual > 0)
    .sort((a, b) => b.x.actual - a.x.actual)
    .slice(0, 5);

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>{tr('pages.overview.title')}</h1>
          <p>{tr('pages.overview.subline', { name: data.ws.name })}</p>
        </div>
        <div className="acts">
          <Button onClick={() => navigate(SECTIONS.timeline.path)}>
            <ChartGantt size={14} />
            {tr('pages.overview.timeline')}
          </Button>
          <Button variant="primary" onClick={() => projectForms.create()}>
            <Plus size={14} />
            {tr('pages.overview.newProject')}
          </Button>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label={tr('pages.overview.statProjects')} value={ps.length} note={tr('pages.overview.statProjectsNote', { count: ps.filter(p => p.status === 'complete').length })} />
        <Stat label={tr('pages.overview.statTasks')} value={all.length} note={tr('pages.overview.statTasksNote', { count: all.length - done })} />
        <Stat label={tr('pages.overview.statCompletion')} value={`${Math.round((done / total) * 100)}%`} note={tr('pages.overview.statCompletionNote')} />
        <Stat label={tr('pages.overview.statMembers')} value={data.members.length} note={tr('pages.overview.statMembersNote', { count: data.members.filter(m => m.status === 'invited').length })} />
      </div>

      <div className="grid2">
        <Panel title={tr('pages.overview.portfolio')}>
          <div style={{ overflowX: 'auto' }}>
            <table className="perm-t" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 14 }}>{tr('pages.overview.colProject')}</th>
                  <th style={{ textAlign: 'left' }}>{tr('pages.overview.colLead')}</th>
                  <th style={{ textAlign: 'left' }}>{tr('pages.overview.colStatus')}</th>
                  <th style={{ textAlign: 'left', width: '22%' }}>{tr('pages.overview.colProgress')}</th>
                  <th>{tr('pages.overview.colOpen')}</th>
                  <th>{tr('pages.overview.colOverdue')}</th>
                  <th style={{ textAlign: 'left' }}>{tr('pages.overview.colDue')}</th>
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
          <Panel title={tr('pages.overview.tasksByStatus')}>
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
            title={tr('pages.overview.time')}
            actions={
              <span className="faint" style={{ fontSize: 11.5 }}>
                {tr('pages.overview.timeNote')}
              </span>
            }
          >
            <div className="panel-b">
              <TimeTotals x={time} />
              {byProject.map(({ p, x }) => (
                <div
                  key={p.id}
                  className="row"
                  style={{ height: 30, fontSize: 13, cursor: 'pointer' }}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/projects/${p.id}/overview`)}
                  onKeyDown={e => e.key === 'Enter' && navigate(`/projects/${p.id}/overview`)}
                >
                  <ProjectIcon project={p} size={14} />
                  <span style={{ width: 84 }} className="trunc">
                    {p.name}
                  </span>
                  <Progress value={x.plan > 0 ? Math.min(x.pct ?? 0, 100) : 0} tone={x.over ? 'red' : undefined} aria-label={`${p.name} hours against plan`} />
                  <span className="num muted" style={{ width: 84, textAlign: 'right', fontSize: 12, color: x.over ? 'var(--red)' : undefined }}>
                    {x.plan > 0 ? `${+x.actual.toFixed(1)}/${fmtHours(x.plan)}` : fmtHours(x.actual)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title={tr('pages.overview.workload')}
            actions={
              <span className="faint" style={{ fontSize: 11.5 }}>
                {tr('pages.overview.workloadNote')}
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
                  onClick={() => navigate(`${SECTIONS.members.path}/${l.m.id}`)}
                  onKeyDown={e => e.key === 'Enter' && navigate(`${SECTIONS.members.path}/${l.m.id}`)}
                >
                  <MemberAvatar id={l.m.id} size="sm" tooltip={false} />
                  <span style={{ width: 96 }} className="trunc">
                    {l.m.name.split(' ')[0]}
                  </span>
                  <span className="grow" style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-3)' }}>
                    <span style={{ display: 'flex', width: `${(l.ts.length / maxL) * 100}%` }}>
                      {data.statuses.filter(s => s.id !== 'done').map(s => {
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

          <Panel title={tr('pages.overview.milestones')}>
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
                <div className="faint">{tr('pages.overview.noMilestones')}</div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
