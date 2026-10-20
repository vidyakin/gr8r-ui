/* Результаты поиска — порт pageSearch из pages/search.js. Запрос и категория живут в адресе (?q=…&cat=…) */
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { History, Search, SearchX } from 'lucide-react';
import { Button, EmptyState, Tab, Tabs, TabsList } from '@/components/ui';
import { StatusIcon } from '@/components/gr8r/task';
import { useWorkspace } from '../data/store';
import { FILE_TYPES, member, project, projectColor, task as findTask } from '../data/selectors';
import { searchAll, useRecentSearches, type SearchCat } from '../data/search';
import { ago } from '../lib/dates';
import { Highlight } from '../components/highlight';
import { KindIcon } from '../components/files-view';
import { ProjectIcon, ProjectStatus } from '../components/project';
import { MemberAvatar, useTaskActions } from '../components/workspace';
import { SECTIONS } from '../routes';

const CATS: [SearchCat, string][] = [
  ['all', 'All'],
  ['tasks', 'Tasks'],
  ['projects', 'Projects'],
  ['people', 'People'],
  ['files', 'Files'],
  ['comments', 'Comments'],
];

export function SearchPage() {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const taskActions = useTaskActions();
  const recent = useRecentSearches();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const cat = (CATS.find(([k]) => k === params.get('cat'))?.[0] ?? 'all') as SearchCat;
  const set = (patch: Record<string, string>) =>
    setParams(
      p => {
        Object.entries(patch).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
        return p;
      },
      { replace: true },
    );

  const r = searchAll(data, q);
  const total = Object.values(r).reduce((a, b) => a + b.length, 0);
  const sec = (k: Exclude<SearchCat, 'all'>, title: string, rows: React.ReactNode) =>
    (cat === 'all' || cat === k) &&
    r[k].length > 0 && (
      <section style={{ marginBottom: 22 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          {title} · {r[k].length}
        </div>
        <div className="panel" style={{ overflow: 'hidden' }}>
          {rows}
        </div>
      </section>
    );
  const row = (key: string, onClick: () => void, children: React.ReactNode, style?: React.CSSProperties) => (
    <div key={key} className="mini" role="button" tabIndex={0} style={style} onClick={onClick} onKeyDown={e => e.target === e.currentTarget && e.key === 'Enter' && onClick()}>
      {children}
    </div>
  );

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="inwrap" style={{ marginBottom: 14 }}>
        <Search size={16} />
        <input className="input input-lg" placeholder="Search tasks, projects, people, files, and comments" value={q} onChange={e => set({ q: e.target.value })} style={{ paddingLeft: 34, fontSize: 15 }} aria-label="Search" />
      </div>
      <Tabs value={cat} onValueChange={v => set({ cat: v === 'all' ? '' : v })}>
        <TabsList style={{ marginBottom: 18 }}>
          {CATS.map(([k, n]) => (
            <Tab key={k} value={k} count={k === 'all' ? total : r[k].length}>
              {n}
            </Tab>
          ))}
        </TabsList>
      </Tabs>
      {!q ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="faint" style={{ fontSize: 12.5 }}>
            Recent:
          </span>
          {recent.map(s => (
            <button key={s} className="badge" onClick={() => set({ q: s })}>
              <History size={11} />
              {s}
            </button>
          ))}
        </div>
      ) : total ? (
        <>
          {sec(
            'tasks',
            'Tasks',
            r.tasks.map(t =>
              row(
                t.id,
                () => taskActions.open(t),
                <>
                  <StatusIcon status={t.status} />
                  <span className="mono faint" style={{ fontSize: 11 }}>
                    {t.key}
                  </span>
                  <span className="tt">
                    <Highlight text={t.title} q={q} />
                  </span>
                  <span className="pj">
                    <span className="pdot" style={{ '--c': projectColor(project(data, t.project)) } as React.CSSProperties} />
                    {project(data, t.project)?.name}
                  </span>
                  <MemberAvatar id={t.assignee} size="sm" />
                </>,
              ),
            ),
          )}
          {sec(
            'projects',
            'Projects',
            r.projects.map(p =>
              row(
                p.id,
                () => navigate(`/projects/${p.id}`),
                <>
                  <ProjectIcon project={p} size={13} />
                  <span className="tt">
                    <Highlight text={p.name} q={q} />{' '}
                    <span className="faint" style={{ fontSize: 12 }}>
                      — {p.desc.slice(0, 70)}…
                    </span>
                  </span>
                  <ProjectStatus status={p.status} />
                </>,
              ),
            ),
          )}
          {sec(
            'people',
            'People',
            r.people.map(m =>
              row(
                m.id,
                () => navigate(`${SECTIONS.members.path}/${m.id}`),
                <>
                  <MemberAvatar id={m.id} size="md" tooltip={false} />
                  <span className="tt">
                    <Highlight text={m.name} q={q} />{' '}
                    <span className="faint" style={{ fontSize: 12 }}>
                      {m.title}
                    </span>
                  </span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {m.email}
                  </span>
                </>,
              ),
            ),
          )}
          {sec(
            'files',
            'Files',
            r.files.map(f =>
              row(
                f.id,
                () => navigate(`/projects/${f.project}/files`),
                <>
                  <span className="ftype" style={{ '--c': FILE_TYPES[f.type].c } as React.CSSProperties}>
                    <KindIcon kind={f.type} size={14} />
                  </span>
                  <span className="tt">
                    <Highlight text={f.name} q={q} />
                  </span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {f.size} · {project(data, f.project)?.name}
                  </span>
                </>,
              ),
            ),
          )}
          {sec(
            'comments',
            'Comments',
            r.comments.map(c =>
              row(
                c.id,
                () => taskActions.open(findTask(data, c.task)!),
                <>
                  <MemberAvatar id={c.by} size="sm" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12 }} className="muted">
                      <b style={{ color: 'var(--text)', fontWeight: 500 }}>{member(data, c.by)?.name}</b> on {findTask(data, c.task)?.title} · {ago(c.at)}
                    </div>
                    <div style={{ fontSize: 13 }}>
                      <Highlight text={c.text} q={q} />
                    </div>
                  </div>
                </>,
                { alignItems: 'flex-start', paddingTop: 10, paddingBottom: 10 },
              ),
            ),
          )}
        </>
      ) : (
        <div className="panel">
          <EmptyState
            icon={<SearchX size={20} />}
            title="No results found"
            action={
              <Button variant="secondary" size="sm" onClick={() => set({ q: '' })}>
                Clear search
              </Button>
            }
          >
            Nothing matches “{q}”. Check the spelling or try a broader term.
          </EmptyState>
        </div>
      )}
    </div>
  );
}
