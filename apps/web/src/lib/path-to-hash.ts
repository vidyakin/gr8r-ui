/* Роутер приложения работает на хеше (#/crm/…). Прямая ссылка без хеша (/crm/companies/…) раньше открывала «Главную»:
   переносим путь в хеш до создания роутера. Если хеш уже есть (/путь#/путь) — лишний путь перед ним убираем. */
export function pathToHash(loc: { pathname: string; search: string; hash: string }): string | null {
  if (loc.pathname === '/' || loc.pathname === '/index.html') return null;
  return '/' + (loc.hash && loc.hash !== '#' ? loc.hash : '#' + loc.pathname + loc.search);
}

if (typeof window !== 'undefined') {
  const next = pathToHash(window.location);
  if (next) window.history.replaceState(window.history.state, '', next);
}
