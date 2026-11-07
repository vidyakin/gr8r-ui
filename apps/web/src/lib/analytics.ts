/* Аналитика активности на Umami (docs/architecture/analytics.md). Включается только при заданном ID сайта; без него —
   полностью no-op (тесты, dev). Отправляем только нормализованный путь и пару kind/name у окон: без query и hash, без заголовков
   страниц (в них имена клиентов), без email и имён. Скрипт грузится с того же origin (/stats/), CSP остаётся 'self'. */

type Payload = Record<string, unknown>;
type UmamiApi = {
  track: (arg?: string | Payload | ((props: Payload) => Payload), data?: Payload) => void;
  identify: (id: string, data?: Payload) => void;
};

declare global {
  interface Window {
    __GR8R_CONFIG__?: { umamiWebsiteId?: string };
    __gr8rUmamiBeforeSend?: (type: string, payload: Payload) => Payload;
    umami?: UmamiApi;
  }
}

const SCRIPT_URL = '/stats/m.js'; // имя скрипта — TRACKER_SCRIPT_NAME в compose
const HOST_URL = '/stats'; // точка сбора: <host>/api/m (COLLECT_API_ENDPOINT), nginx отрезает /stats
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Путь без query и hash; сегменты-идентификаторы (UUID, числа, всё с цифрами, длинные хэши) заменены на `:id` */
export function normalizePath(path: string): string {
  const pathname = path.split(/[?#]/)[0] || '/';
  const parts = pathname.split('/').map(seg => {
    if (!seg) return seg;
    let s = seg;
    try {
      s = decodeURIComponent(seg);
    } catch {
      /* битая последовательность — как есть */
    }
    return UUID.test(s) || /\d/.test(s) || s.length >= 20 ? ':id' : seg;
  });
  const out = parts.join('/').replace(/\/{2,}/g, '/');
  return out.length > 1 ? out.replace(/\/$/, '') : out || '/';
}

/** ID сайта: рантайм-конфиг (/config.js, пишет контейнер web) важнее сборочного VITE_UMAMI_WEBSITE_ID */
export function websiteId(): string | null {
  const fromRuntime = typeof window === 'undefined' ? undefined : window.__GR8R_CONFIG__?.umamiWebsiteId;
  const fromBuild = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_UMAMI_WEBSITE_ID;
  const id = (fromRuntime || fromBuild || '').trim();
  return id || null;
}

function doNotTrack(): boolean {
  if (typeof navigator === 'undefined') return false;
  const w = typeof window === 'undefined' ? undefined : (window as unknown as { doNotTrack?: string });
  const v = navigator.doNotTrack ?? w?.doNotTrack ?? (navigator as unknown as { msDoNotTrack?: string }).msDoNotTrack;
  return v === '1' || v === 'yes';
}

export function isAnalyticsEnabled(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && !!websiteId() && !doNotTrack();
}

// Вызовы до загрузки скрипта ждут в очереди; без включения не копятся
const queue: Array<(u: UmamiApi) => void> = [];
let started = false;
let currentPath = '/';

function flush() {
  const u = window.umami;
  if (!u) return;
  for (const fn of queue.splice(0)) fn(u);
}

function start() {
  if (started) return;
  started = true;
  const s = document.createElement('script');
  s.defer = true;
  s.src = SCRIPT_URL;
  s.dataset.websiteId = websiteId()!;
  s.dataset.hostUrl = `${window.location.origin}${HOST_URL}`;
  s.dataset.autoTrack = 'false';
  s.dataset.doNotTrack = 'true';
  s.dataset.excludeSearch = 'true';
  s.dataset.excludeHash = 'true';
  // Последний рубеж: любое событие (и identify, который не принимает свой url/title) уходит с нормализованным путём без заголовка
  window.__gr8rUmamiBeforeSend = (_type, payload) => base(payload);
  s.dataset.beforeSend = '__gr8rUmamiBeforeSend';
  s.onload = flush;
  s.onerror = () => queue.splice(0); // блокировщик или нет сервиса: молча отключаемся
  document.head.appendChild(s);
}

function run(fn: (u: UmamiApi) => void) {
  if (!isAnalyticsEnabled()) return;
  start();
  if (window.umami) fn(window.umami);
  else queue.push(fn);
}

// Нормализованный url, пустой заголовок и referrer: иначе уйдут document.title (имена клиентов) и полный адрес со query
const base = (p: Payload): Payload => ({ ...p, url: currentPath, title: '', referrer: '' });

/** Просмотр страницы: вызывать при смене маршрута */
export function trackPageview(pathname: string) {
  currentPath = normalizePath(pathname);
  run(u => u.track());
}

/** Кто смотрит: только id пользователя и воркспейса и роль — без email и имени */
export function identifyUser(v: { userId: string; workspaceId?: string | null; role?: string | null }) {
  run(u => u.identify(v.userId, { workspace: v.workspaceId ?? '', role: v.role ?? '' }));
}

/** Открытие окна: kind — вид (window, drawer, palette), name — стабильное имя места вызова, не текст и не данные записи */
export function trackOpen(kind: string, name: string) {
  run(u => u.track('open', { kind, name }));
}

/** Для тестов: сбросить состояние модуля */
export function resetAnalyticsForTests() {
  queue.length = 0;
  started = false;
  currentPath = '/';
}
