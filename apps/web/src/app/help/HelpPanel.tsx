/* Боковая панель справки: статья текущего раздела, оглавление по группам, поиск, переходы по ссылкам между статьями.
   Грузится лениво вместе с текстами статей (bundle.ts). Показывает только статьи включённых модулей арендатора. */
import * as React from 'react';
import { useLocation } from 'react-router';
import { ArrowLeft, List, Search, X } from 'lucide-react';
import { articlesOfSection, renderMarkdown, searchDocs, sectionOfPath, tocOf, type DocArticle } from '@gr8r/docs';
import type { ModuleId } from '@gr8r/shared';
import { IconButton } from '@/components/ui';
import { useT } from '@/i18n';
import { SECTIONS } from '../routes';
import { useSectionAccess } from '../positions/access';
import { catalog, imageUrl } from './bundle';

export interface HelpInit {
  article?: string;
  query?: string;
}

function ArticleList({ items, onPick }: { items: DocArticle[]; onPick: (id: string) => void }) {
  return (
    <ul className="help-list">
      {items.map(a => (
        <li key={a.id}>
          <button type="button" onClick={() => onPick(a.id)}>
            {a.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Article({ a, onPick }: { a: DocArticle; onPick: (id: string) => void }) {
  const html = React.useMemo(
    () => renderMarkdown(a.body, { from: a.id, hasArticle: id => catalog.byId.has(id), linkHref: id => `#doc:${id}`, imageUrl }),
    [a],
  );
  return (
    <div
      className="help-article"
      onClick={e => {
        const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-doc]');
        if (!link) return;
        e.preventDefault();
        onPick(link.dataset.doc!);
      }}
      // html собран renderMarkdown: сырой HTML экранируется, опасные ссылки отбрасываются
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function HelpPanel({ init, onClose }: { init: HelpInit; onClose: () => void }) {
  const t = useT();
  const { pathname } = useLocation();
  const access = useSectionAccess();
  const [stack, setStack] = React.useState<string[]>(init.article ? [init.article] : []);
  const [query, setQuery] = React.useState(init.query ?? '');
  const body = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  const keep = React.useCallback((a: DocArticle) => !a.fm.module || access.module(a.fm.module as ModuleId), [access]);
  const sectionId = sectionOfPath(pathname, SECTIONS);
  const ofSection = React.useMemo(() => (sectionId ? articlesOfSection(catalog, sectionId, keep) : []), [sectionId, keep]);
  const toc = React.useMemo(() => tocOf(catalog, keep), [keep]);

  // Раздел с одной статьёй открывается сразу этой статьёй; с несколькими или без статьи — списком
  const current = stack.length ? stack[stack.length - 1]! : ofSection.length === 1 ? ofSection[0]!.id : null;
  const article = current ? catalog.byId.get(current) : undefined;
  const q = query.trim();
  const hits = React.useMemo(() => (q ? searchDocs(catalog, q, keep) : []), [q, keep]);

  const pick = (id: string) => {
    setQuery('');
    setStack(s => [...s, id]);
  };
  const back = () => setStack(s => s.slice(0, -1));
  const canBack = !q && stack.length > 0;

  React.useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [current, q]);

  React.useEffect(() => {
    if (init.query) searchRef.current?.focus();
    else (document.querySelector('.help-panel') as HTMLElement | null)?.focus({ preventScroll: true });
  }, [init.query]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]:not(.help-panel), [role="menu"]')) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <aside className="help-panel" role="dialog" aria-label={t('help.title')} tabIndex={-1}>
      <div className="help-h">
        {canBack ? (
          <IconButton size="sm" label={t('help.back')} onClick={back}>
            <ArrowLeft size={16} />
          </IconButton>
        ) : null}
        <h2 className="trunc">{article && !q ? article.title : t('help.title')}</h2>
        <span className="sp" />
        {article && !q && (
          <IconButton size="sm" label={t('help.toc')} onClick={() => setStack(s => [...s, ''])}>
            <List size={16} />
          </IconButton>
        )}
        <IconButton size="sm" label={t('ui.close')} shortcut="Esc" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="help-search">
        <Search size={14} />
        <input ref={searchRef} type="search" value={query} placeholder={t('help.searchPlaceholder')} aria-label={t('help.searchPlaceholder')} onChange={e => setQuery(e.target.value)} />
      </div>
      <div className="help-b" ref={body}>
        {q ? (
          hits.length ? (
            <>
              <div className="eyebrow">{t('help.searchResults')}</div>
              <ul className="help-list hits">
                {hits.map(h => (
                  <li key={h.article.id}>
                    <button type="button" onClick={() => pick(h.article.id)}>
                      {h.article.title}
                      {h.snippet && <span className="snip">{h.snippet}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="help-empty">{t('help.noResults')}</p>
          )
        ) : article ? (
          <Article a={article} onPick={pick} />
        ) : (
          <>
            {ofSection.length > 1 ? (
              <>
                <div className="eyebrow">{t('help.moreForSection')}</div>
                <ArticleList items={ofSection} onPick={pick} />
              </>
            ) : (
              <p className="help-empty">{t('help.noArticle')}</p>
            )}
            <div className="eyebrow">{t('help.toc')}</div>
            {toc.map(g => (
              <details key={g.key} className="help-group" open={g.articles.some(a => ofSection.includes(a))}>
                <summary>{g.title}</summary>
                <ArticleList items={g.articles} onPick={pick} />
              </details>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
