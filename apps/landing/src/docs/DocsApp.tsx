/* Сайт документации (/docs): оглавление по группам, статья, поиск. Адрес статьи — в хеше (`#/finance/payments`),
   поэтому серверу хватает одного файла docs/index.html. */
import * as React from 'react';
import { renderMarkdown, searchDocs, tocOf } from '@gr8r/docs';
import { Brand } from '../demo/shell';
import { catalog, imageUrl } from './bundle';

const idFromHash = () => decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));

function useArticleId() {
  const [id, setId] = React.useState(idFromHash);
  React.useEffect(() => {
    const on = () => setId(idFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return id;
}

export function DocsApp() {
  const id = useArticleId();
  const [query, setQuery] = React.useState('');
  const [nav, setNav] = React.useState(false);
  const toc = React.useMemo(() => tocOf(catalog), []);
  const article = catalog.byId.get(id);
  const q = query.trim();
  const hits = React.useMemo(() => (q ? searchDocs(catalog, q) : []), [q]);
  const html = React.useMemo(
    () => (article ? renderMarkdown(article.body, { from: article.id, hasArticle: x => catalog.byId.has(x), linkHref: x => `#/${x}`, imageUrl }) : ''),
    [article],
  );

  React.useEffect(() => {
    document.title = article ? `${article.title} — документация FutureERP` : 'Документация — FutureERP';
    window.scrollTo({ top: 0 });
    setNav(false);
  }, [article]);

  return (
    <>
      <header className="l-head">
        <div className="l-wrap l-head-in">
          <a className="l-brand" href="/">
            <Brand size={24} />
            <span>
              Future<b>ERP</b>
            </span>
          </a>
          <nav className="l-nav">
            <a href="#/" aria-current={!article ? 'page' : undefined}>
              Документация
            </a>
          </nav>
          <span className="docs-sp" />
          <button type="button" className="btn btn-secondary docs-menu-btn" aria-expanded={nav} onClick={() => setNav(v => !v)}>
            Оглавление
          </button>
        </div>
      </header>
      <div className="l-wrap docs-layout">
        <aside className={nav ? 'docs-side open' : 'docs-side'} aria-label="Оглавление">
          <input className="docs-search" type="search" value={query} placeholder="Поиск по документации" aria-label="Поиск по документации" onChange={e => setQuery(e.target.value)} />
          {q ? (
            hits.length ? (
              <ul className="docs-hits">
                {hits.map(h => (
                  <li key={h.article.id}>
                    <a href={`#/${h.article.id}`} onClick={() => setQuery('')}>
                      {h.article.title}
                      {h.snippet && <span>{h.snippet}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="docs-muted">Ничего не найдено</p>
            )
          ) : (
            toc.map(g => (
              <details key={g.key} open={g.articles.some(a => a.id === id) || !id}>
                <summary>{g.title}</summary>
                <ul>
                  {g.articles.map(a => (
                    <li key={a.id}>
                      <a href={`#/${a.id}`} aria-current={a.id === id ? 'page' : undefined}>
                        {a.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            ))
          )}
        </aside>
        <main className="docs-main" id="main">
          {article ? (
            <article className="docs-article" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div className="docs-article">
              <h1>Документация FutureERP</h1>
              <p>Руководство по разделам системы и сценарии «как сделать». Выберите статью в оглавлении или воспользуйтесь поиском.</p>
              {toc.map(g => (
                <section key={g.key}>
                  <h2>{g.title}</h2>
                  <ul>
                    {g.articles.map(a => (
                      <li key={a.id}>
                        <a href={`#/${a.id}`}>{a.title}</a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
