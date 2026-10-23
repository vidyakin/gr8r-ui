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
import { useT } from '@/i18n';

const CATS: SearchCat[] = ['all', 'tasks', 'projects', 'people', 'files', 'comments'];

export function SearchPage() {
  const t = useT();
  const catLabel = (k: SearchCat) => t(`pages.search.cats.${k}` as 'pages.search.cats.all');
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
        <input className="input input-lg" placeholder={t('pages.search.placeholder')} value={q} onChange={e => set({ q: e.target.value })} style={{ paddingLeft: 34, fontSize: 15 }} aria-label={t('pages.search.searchLabel')} />
      </div>
      <Tabs value={cat} onValueChange={v => set({ cat: v === 'all' ? '' : v })}>
        <TabsList style={{ marginBottom: 18 }}>
          {CATS.map(k => (
            <Tab key={k} value={k} count={k === 'all' ? total : r[k].length}>
              {catLabel(k)}
            </Tab>
          ))}
        </TabsList>
      </Tabs>
      {!q ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="faint" style={{ fontSize: 12.5 }}>
            {t('pages.search.recent')}
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
            t('pages.search.sectionTasks'),
            r.tasks.map(item =>
              row(
                item.id,
                () => taskActions.open(item),
                <>
                  <StatusIcon status={item.status} />
                  <span className="mono faint" style={{ fontSize: 11 }}>
                    {item.key}
                  </span>
                  <span className="tt">
                    <Highlight text={item.title} q={q} />
                  </span>
                  <span className="pj">
                    <span className="pdot" style={{ '--c': projectColor(project(data, item.project)) } as React.CSSProperties} />
                    {project(data, item.project)?.name}
                  </span>
                  <MemberAvatar id={item.assignee} size="sm" />
                </>,
              ),
            ),
          )}
          {sec(
            'projects',
            t('pages.search.sectionProjects'),
            r.projects.map(item =>
              row(
                item.id,
                () => navigate(`/projects/${item.id}`),
                <>
                  <ProjectIcon project={item} size={13} />
                  <span className="tt">
                    <Highlight text={item.name} q={q} />{' '}
                    <span className="faint" style={{ fontSize: 12 }}>
                      — {item.desc.slice(0, 70)}…
                    </span>
                  </span>
                  <ProjectStatus status={item.status} />
                </>,
              ),
            ),
          )}
          {sec(
            'people',
            t('pages.search.sectionPeople'),
            r.people.map(item =>
              row(
                item.id,
                () => navigate(`${SECTIONS.members.path}/${item.id}`),
                <>
                  <MemberAvatar id={item.id} size="md" tooltip={false} />
                  <span className="tt">
                    <Highlight text={item.name} q={q} />{' '}
                    <span className="faint" style={{ fontSize: 12 }}>
                      {item.title}
                    </span>
                  </span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {item.email}
                  </span>
                </>,
              ),
            ),
          )}
          {sec(
            'files',
            t('pages.search.sectionFiles'),
            r.files.map(item =>
              row(
                item.id,
                () => navigate(`/projects/${item.project}/files`),
                <>
                  <span className="ftype" style={{ '--c': FILE_TYPES[item.type].c } as React.CSSProperties}>
                    <KindIcon kind={item.type} size={14} />
                  </span>
                  <span className="tt">
                    <Highlight text={item.name} q={q} />
                  </span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {item.size} · {project(data, item.project)?.name}
                  </span>
                </>,
              ),
            ),
          )}
          {sec(
            'comments',
            t('pages.search.sectionComments'),
            r.comments.map(item =>
              row(
                item.id,
                () => taskActions.open(findTask(data, item.task)!),
                <>
                  <MemberAvatar id={item.by} size="sm" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12 }} className="muted">
                      <b style={{ color: 'var(--text)', fontWeight: 500 }}>{member(data, item.by)?.name}</b> {t('pages.search.commentOn', { title: findTask(data, item.task)?.title })} · {ago(item.at)}
                    </div>
                    <div style={{ fontSize: 13 }}>
                      <Highlight text={item.text} q={q} />
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
            title={t('pages.search.noResultsTitle')}
            action={
              <Button variant="secondary" size="sm" onClick={() => set({ q: '' })}>
                {t('pages.search.clearSearch')}
              </Button>
            }
          >
            {t('pages.search.noResultsHint', { q })}
          </EmptyState>
        </div>
      )}
    </div>
  );
}
