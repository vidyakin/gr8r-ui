/* Проекты — порт pageProjects из pages/projects.js */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { FolderKanban, LayoutGrid, List, Lock, Plus, Search, SearchX, Table2 } from 'lucide-react';
import { Button, EmptyState, Input, Progress, Segmented } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { PROJECT_STATUS, member, progressOf, tasksOf, visibleProjects } from '../data/selectors';
import type { Project } from '../data/types';
import { ago, fmtDate, minsAgo } from '../lib/dates';
import { MemberAvatar, MemberStack } from '../components/workspace';
import { ProjectCard, ProjectIcon, ProjectMenu, ProjectStatus } from '../components/project';
import { useProjectForms } from '../overlays';
import { useT } from '@/i18n';

type Layout = 'grid' | 'list' | 'table';
type Sort = 'recent' | 'name' | 'due' | 'progress';

const SORTS: Sort[] = ['recent', 'name', 'due', 'progress'];

export function ProjectsPage() {
  const tr = useT();
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

  const projectForms = useProjectForms();
  const newProject = () => projectForms.create();
  const go = (p: Project) => navigate(`/projects/${p.id}`);
  const onKey = (p: Project) => (e: React.KeyboardEvent) => e.key === 'Enter' && e.target === e.currentTarget && go(p);

  let body: React.ReactNode;
  if (!all.length)
    body = (
      <div className="panel">
        <EmptyState
          icon={<FolderKanban />}
          title={tr('pages.projects.empty.title')}
          action={
            <Button size="sm" onClick={newProject}>
              <Plus size={14} />
              {tr('pages.projects.empty.action')}
            </Button>
          }
        >
          {tr('pages.projects.empty.hint')}
        </EmptyState>
      </div>
    );
  else if (!ps.length)
    body = (
      <div className="panel">
        <EmptyState
          icon={<SearchX />}
          title={tr('pages.projects.noResults.title')}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setQ('');
                setStatus('all');
              }}
            >
              {tr('common.clearFilters')}
            </Button>
          }
        >
          {tr('pages.projects.noResults.hint')}
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
              <th style={{ paddingLeft: 14 }}>{tr('pages.projects.cols.project')}</th>
              <th style={{ textAlign: 'left' }}>{tr('pages.projects.cols.status')}</th>
              <th style={{ textAlign: 'left' }}>{tr('pages.projects.cols.lead')}</th>
              <th style={{ textAlign: 'left' }}>{tr('pages.projects.cols.team')}</th>
              <th style={{ textAlign: 'left', width: '16%' }}>{tr('pages.projects.cols.progress')}</th>
              <th>{tr('pages.projects.cols.tasks')}</th>
              <th style={{ textAlign: 'left' }}>{tr('pages.projects.cols.start')}</th>
              <th style={{ textAlign: 'left' }}>{tr('pages.projects.cols.due')}</th>
              <th style={{ textAlign: 'left' }}>{tr('pages.projects.cols.lastActivity')}</th>
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
                    {data.teams.find(team => team.id === p.team)?.name}
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
          <h1>{tr('pages.projects.title')}</h1>
          <p>
            {tr('pages.projects.summary', {
              active: all.filter(p => p.status !== 'complete').length,
              done: all.filter(p => p.status === 'complete').length,
            })}
          </p>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={newProject}>
            <Plus size={14} />
            {tr('pages.projects.newAction')}
          </Button>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ width: 200 }}>
          <Input size="sm" icon={<Search size={13} />} placeholder={tr('pages.projects.search')} aria-label={tr('pages.projects.search')} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ height: 26, width: 'auto', fontSize: 12 }} aria-label={tr('pages.projects.filterStatus')} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">{tr('pages.projects.allStatuses')}</option>
          {Object.entries(PROJECT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.name}
            </option>
          ))}
        </select>
        <select className="select" style={{ height: 26, width: 'auto', fontSize: 12 }} aria-label={tr('pages.projects.sort')} value={sort} onChange={e => setSort(e.target.value as Sort)}>
          {SORTS.map(k => (
            <option key={k} value={k}>
              {tr('pages.projects.sortPrefix')}{' '}{tr(`pages.projects.sortLabel.${k}` as 'pages.projects.sortLabel.recent')}
            </option>
          ))}
        </select>
        <span className="sp" />
        <Segmented
          aria-label={tr('pages.projects.layout')}
          value={view}
          onValueChange={setView}
          items={[
            { value: 'grid', label: <span className="hide-m">{tr('pages.projects.viewGrid')}</span>, icon: <LayoutGrid size={13} />, 'aria-label': tr('pages.projects.viewGrid') },
            { value: 'list', label: <span className="hide-m">{tr('pages.projects.viewList')}</span>, icon: <List size={13} />, 'aria-label': tr('pages.projects.viewList') },
            { value: 'table', label: <span className="hide-m">{tr('pages.projects.viewTable')}</span>, icon: <Table2 size={13} />, 'aria-label': tr('pages.projects.viewTable') },
          ]}
        />
      </div>
      {body}
    </div>
  );
}
