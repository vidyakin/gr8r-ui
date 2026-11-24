/* Роутер приложения работает на хеше (#/crm/…). Прямая ссылка без хеша (/app/crm/companies/…) раньше открывала «Главную»:
   переносим путь в хеш до создания роутера. Если хеш уже есть (/app/путь#/путь) — лишний путь перед ним убираем. */
export function pathToHash(
  loc: { pathname: string; search: string; hash: string },
  base = import.meta.env?.BASE_URL ?? '/',
): string | null {
  const b = base.endsWith('/') ? base : `${base}/`;
  if (loc.pathname === b || loc.pathname === `${b}index.html`) return null;
  const rel = loc.pathname.startsWith(b) ? '/' + loc.pathname.slice(b.length) : loc.pathname;
  return b + (loc.hash && loc.hash !== '#' ? loc.hash : '#' + rel + loc.search);
}

if (typeof window !== 'undefined') {
  const next = pathToHash(window.location);
  if (next) window.history.replaceState(window.history.state, '', next);
}
