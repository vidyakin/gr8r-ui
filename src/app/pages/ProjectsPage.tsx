/* Проекты — порт pageProjects из pages/projects.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { FolderKanban, LayoutGrid, List, Lock, Plus, Search, SearchX, Table2 } from 'lucide-react';
import { Button, EmptyState, Input, Progress, Segmented, toast } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { PROJECT_STATUS, member, progressOf, tasksOf, visibleProjects } from '../data/selectors';
import type { Project } from '../data/types';
import { ago, fmtDate, minsAgo } from '../lib/dates';
import { MemberAvatar, MemberStack } from '../components/workspace';
import { ProjectCard, ProjectIcon, ProjectMenu, ProjectStatus } from '../components/project';

type Layout = 'grid' | 'list' | 'table';
type Sort = 'recent' | 'name' | 'due' | 'progress';

const SORTS: [Sort, string][] = [
  ['recent', 'Recently active'],
  ['name', 'Name'],
  ['due', 'Due date'],
  ['progress', 'Progress'],
];

export function ProjectsPage() {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState<string>('all');
  const [sort, setSort] = React.useState<Sort>('recent');
  const [view, setView] = React.useState<Layout>('grid');

  const all = visibleProjects(data);
  const needle = q.toLowerCase();
  // Порядок сортировки как в оригинале (по возрастанию ключа)
  const sorter: Record<Sort, (p: Project) => string | number> = { recent: p => p.last, name: p => p.name, due: p => p.due, progress: p => -progressOf(data, p.id) };
  const ps = all
    .filter(p => (status === 'all' || p.status === status) && (!needle || p.name.toLowerCase().includes(needle) || p.desc.toLowerCase().includes(needle)))
    .sort((a, b) => (sorter[sort](a) > sorter[sort](b) ? 1 : -1));

  const newProject = () => toast.info('Форма нового проекта пока не перенесена');
  const go = (p: Project) => navigate(`/projects/${p.id}`);
  const onKey = (p: Project) => (e: React.KeyboardEvent) => e.key === 'Enter' && e.target === e.currentTarget && go(p);

  let body: React.ReactNode;
  if (!all.length)
    body = (
      <div className="panel">
        <EmptyState
          icon={<FolderKanban />}
          title="No projects yet"
          action={
            <Button size="sm" onClick={newProject}>
              <Plus size={14} />
              Create project
            </Button>
          }
        >
          Create your first project to start organizing your work.
        </EmptyState>
      </div>
    );
  else if (!ps.length)
    body = (
      <div className="panel">
        <EmptyState
          icon={<SearchX />}
          title="No results found"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setQ('');
                setStatus('all');
              }}
            >
              Clear filters
            </Button>
          }
        >
          No projects match your search or filters. Try a different term.
        </EmptyState>
      </div>
    );
  else if (view === 'grid')
    body = (
      <div className="pgrid">
        {ps.map(p => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    );
  else if (view === 'list')
    body = (
      <div className="panel" style={{ overflow: 'hidden' }}>
        {ps.map(p => {
          const pr = progressOf(data, p.id);
          return (
            <div key={p.id} className="mini" style={{ minHeight: 52, gap: 12 }} role="link" tabIndex={0} aria-label={p.name} onClick={() => go(p)} onKeyDown={onKey(p)}>
              <ProjectIcon project={p} />
              <div className="min-w-0 flex-1">
                <div className="row" style={{ gap: 6 }}>
                  <b style={{ fontWeight: 500 }}>{p.name}</b>
                  {p.private && <Lock size={12} />}
                </div>
                <div className="trunc faint" style={{ fontSize: 12 }}>
                  {p.desc}
                </div>
              </div>
              <span className="hide-m">
                <ProjectStatus status={p.status} />
              </span>
              <span className="row hide-m" style={{ width: 140 }}>
                <Progress value={pr} aria-label={`${p.name} progress`} />
                <span className="num faint" style={{ fontSize: 11.5 }}>
                  {pr}%
                </span>
              </span>
              <span className="num muted hide-m" style={{ width: 70, fontSize: 12 }}>
                {fmtDate(p.due)}
              </span>
              <MemberStack ids={p.members} max={3} />
              <ProjectMenu project={p} />
            </div>
          );
        })}
      </div>
    );
  else
    body = (
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="perm-t" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th style={{ paddingLeft: 14 }}>Project</th>
              <th style={{ textAlign: 'left' }}>Status</th>
              <th style={{ textAlign: 'left' }}>Lead</th>
              <th style={{ textAlign: 'left' }}>Team</th>
              <th style={{ textAlign: 'left', width: '16%' }}>Progress</th>
              <th>Tasks</th>
              <th style={{ textAlign: 'left' }}>Start</th>
              <th style={{ textAlign: 'left' }}>Due</th>
              <th style={{ textAlign: 'left' }}>Last activity</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ps.map(p => {
              const pr = progressOf(data, p.id);
              return (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => go(p)}>
                  <td style={{ paddingLeft: 14 }}>
                    <span className="row">
                      <ProjectIcon project={p} size={14} />
                      <a href={`#/projects/${p.id}`} onClick={e => e.stopPropagation()} style={{ fontWeight: 500, color: 'inherit' }}>
                        {p.name}
                      </a>
                    </span>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <ProjectStatus status={p.status} />
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <span className="row">
                      <MemberAvatar id={p.lead} size="sm" />
                      {member(data, p.lead)?.name}
                    </span>
                  </td>
                  <td style={{ textAlign: 'left' }} className="muted">
                    {data.teams.find(t => t.id === p.team)?.name}
                  </td>
                  <td>
                    <span className="row">
                      <Progress value={pr} aria-label={`${p.name} progress`} />
                      <span className="num faint" style={{ fontSize: 11.5 }}>
                        {pr}%
                      </span>
                    </span>
                  </td>
                  <td className="num">{tasksOf(data, p.id).length}</td>
                  <td style={{ textAlign: 'left' }} className="num muted">
                    {fmtDate(p.start)}
                  </td>
                  <td style={{ textAlign: 'left' }} className="num muted">
                    {fmtDate(p.due)}
                  </td>
                  <td style={{ textAlign: 'left' }} className="muted">
                    {ago(minsAgo(p.last))}
                  </td>
                  <td>
                    <ProjectMenu project={p} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className="page wide">
      <div className="ph">
        <div>
          <h1>Projects</h1>
          <p>
            {all.filter(p => p.status !== 'complete').length} active · {all.filter(p => p.status === 'complete').length} completed
          </p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={newProject}>
            <Plus size={14} />
            New project
          </Button>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ width: 200 }}>
          <Input size="sm" icon={<Search size={13} />} placeholder="Search projects" aria-label="Search projects" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ height: 26, width: 'auto', fontSize: 12 }} aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {Object.entries(PROJECT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.name}
            </option>
          ))}
        </select>
        <select className="select" style={{ height: 26, width: 'auto', fontSize: 12 }} aria-label="Sort" value={sort} onChange={e => setSort(e.target.value as Sort)}>
          {SORTS.map(([k, n]) => (
            <option key={k} value={k}>
              Sort: {n}
            </option>
          ))}
        </select>
        <span className="sp" />
        <Segmented
          aria-label="Layout"
          value={view}
          onValueChange={setView}
          items={[
            { value: 'grid', label: <span className="hide-m">Grid</span>, icon: <LayoutGrid size={13} />, 'aria-label': 'Grid' },
            { value: 'list', label: <span className="hide-m">List</span>, icon: <List size={13} />, 'aria-label': 'List' },
            { value: 'table', label: <span className="hide-m">Table</span>, icon: <Table2 size={13} />, 'aria-label': 'Table' },
          ]}
        />
      </div>
      {body}
    </div>
  );
}
