/* Оболочка приложения в кадре: левая панель, верхняя строка, содержимое. Классы — из apps/web (.sitem, .topbar, .crumbs…),
   раскладка своя (.d-shell): у настоящей .shell медиазапросы по ширине окна, а кадр живёт в своей ширине. */
import * as React from 'react';
import { Bell, CalendarCheck, CalendarRange, ChartNoAxesCombined, CircleCheck, Factory, Play, Truck, Waypoints, Wallet, Workflow, Wrench, FileText, FolderKanban, Handshake, House, Inbox, ListChecks, Megaphone, Plus, ReceiptText, Search, UserPlus, Warehouse } from 'lucide-react';
import { DEFAULT_LOCALE, type Locale } from '../i18n';

const NAV_GROUPS = [
  { key: '', items: [['home', House], ['inbox', Inbox], ['my', CircleCheck]] },
  { key: 'workspace', items: [['projects', FolderKanban], ['tasks', ListChecks]] },
  { key: 'crm', items: [['crm', ChartNoAxesCombined], ['leads', UserPlus], ['ads', Megaphone], ['deals', Handshake]] },
  { key: 'sales', items: [['sales', ReceiptText], ['quotes', FileText], ['stock', Warehouse]] },
  { key: 'services', items: [['appts', CalendarCheck], ['workorders', Wrench], ['deliveries', Truck]] },
  { key: 'transport', items: [['dispatch', CalendarRange], ['trips', Waypoints]] },
  { key: 'production', items: [['prodorders', Factory], ['release', Play]] },
  { key: 'money', items: [['payroll', Wallet]] },
  { key: 'platform', items: [['automations', Workflow]] },
] as const;

export type NavId = (typeof NAV_GROUPS)[number]['items'][number][0];
type GroupKey = (typeof NAV_GROUPS)[number]['key'];

const GROUP_LABELS: Record<Locale, Record<GroupKey, string>> = {
  ru: { '': '', workspace: 'Воркспейс', crm: 'CRM', sales: 'Продажи', services: 'Услуги', transport: 'Транспорт', production: 'Производство', money: 'Деньги', platform: 'Платформа' },
  en: { '': '', workspace: 'Workspace', crm: 'CRM', sales: 'Sales', services: 'Services', transport: 'Transport', production: 'Production', money: 'Finance', platform: 'Platform' },
  es: { '': '', workspace: 'Espacio', crm: 'CRM', sales: 'Ventas', services: 'Servicios', transport: 'Transporte', production: 'Producción', money: 'Finanzas', platform: 'Plataforma' },
};

const NAV_LABELS: Record<Locale, Record<NavId, string>> = {
  ru: {
    home: 'Главная', inbox: 'Входящие', my: 'Мои задачи', projects: 'Проекты', tasks: 'Задачи',
    crm: 'Сводка', leads: 'Лиды', ads: 'Реклама', deals: 'Сделки',
    sales: 'Документы продаж', quotes: 'Коммерческие предложения', stock: 'Склад',
    appts: 'Запись', workorders: 'Заказ-наряды', deliveries: 'Доставки',
    dispatch: 'Диспетчер', trips: 'Рейсы',
    prodorders: 'Заказы на производство', release: 'Выпуск продукции',
    payroll: 'Зарплата', automations: 'Автоматизации',
  },
  en: {
    home: 'Home', inbox: 'Inbox', my: 'My tasks', projects: 'Projects', tasks: 'Tasks',
    crm: 'Overview', leads: 'Leads', ads: 'Marketing', deals: 'Deals',
    sales: 'Sales docs', quotes: 'Quotes', stock: 'Inventory',
    appts: 'Bookings', workorders: 'Work orders', deliveries: 'Deliveries',
    dispatch: 'Dispatch', trips: 'Trips',
    prodorders: 'Production orders', release: 'Production output',
    payroll: 'Payroll', automations: 'Automations',
  },
  es: {
    home: 'Inicio', inbox: 'Bandeja', my: 'Mis tareas', projects: 'Proyectos', tasks: 'Tareas',
    crm: 'Resumen', leads: 'Leads', ads: 'Publicidad', deals: 'Tratos',
    sales: 'Documentos de venta', quotes: 'Presupuestos', stock: 'Almacén',
    appts: 'Citas', workorders: 'Órdenes de trabajo', deliveries: 'Entregas',
    dispatch: 'Despacho', trips: 'Rutas',
    prodorders: 'Órdenes de producción', release: 'Salida de producción',
    payroll: 'Nómina', automations: 'Automatizaciones',
  },
};

const SHELL_UI: Record<Locale, { create: string; initials: string }> = {
  ru: { create: 'Создать', initials: 'АК' },
  en: { create: 'Create', initials: 'AK' },
  es: { create: 'Crear', initials: 'AC' },
};

export function Brand({ size = 22 }: { size?: number }) {
  return (
    <span className="ws-logo brand" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="6" fill="#000" />
        <text x="16" y="23" textAnchor="middle" fontSize="20" fontWeight="700" fontFamily="inherit" fill="#fff">
          F
        </text>
      </svg>
    </span>
  );
}

export function DemoShell({ compact, active, crumbs, locale = DEFAULT_LOCALE, children }: { compact: boolean; active: NavId; crumbs: string[]; locale?: Locale; children: React.ReactNode }) {
  const scroll = React.useRef<HTMLDivElement>(null);
  const groups = GROUP_LABELS[locale];
  const labels = NAV_LABELS[locale];
  const ui = SHELL_UI[locale];
  // Выбранный пункт ниже края панели — прокручиваем, чтобы он был виден
  React.useLayoutEffect(() => {
    const box = scroll.current;
    const el = box?.querySelector<HTMLElement>('.sitem.on');
    if (!box || !el) return;
    const over = el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom;
    if (over > 0) box.scrollTop += over / (box.getBoundingClientRect().height / box.clientHeight || 1) + 40;
  }, [active, compact]);
  return (
    <div className="d-shell">
      {!compact && (
        <nav className="side">
          <div className="side-top">
            <div className="ws">
              <Brand />
              <span className="ws-name trunc">FutureERP</span>
            </div>
          </div>
          <div className="side-scroll" ref={scroll}>
            {NAV_GROUPS.map(g => {
              const gLabel = groups[g.key];
              return (
                <div key={g.key} className={g.key ? 'sgroup' : undefined}>
                  {gLabel && <div className="sgroup-h">{gLabel}</div>}
                  {g.items.map(([id, Icon]) => (
                    <a key={id} className={'sitem' + (id === active ? ' on' : '')} data-demo={`nav-${id}`}>
                      <Icon size={16} />
                      <span className="trunc">{labels[id]}</span>
                    </a>
                  ))}
                </div>
              );
            })}
          </div>
        </nav>
      )}
      <div className="main">
        <header className="topbar">
          <nav className="crumbs trunc">
            {crumbs.map((c, i) => (
              <React.Fragment key={c}>
                {i > 0 && <span className="sep">/</span>}
                <span className={i === crumbs.length - 1 ? 'cur' : undefined}>{c}</span>
              </React.Fragment>
            ))}
          </nav>
          <span className="sp" />
          <span className="ibtn">
            <Search size={16} />
          </span>
          <span className="ibtn">
            <Bell size={16} />
          </span>
          {!compact && (
            <span className="btn btn-secondary btn-sm">
              <Plus size={14} />
              {ui.create}
            </span>
          )}
          <span className="av md" style={{ '--c': '#5A67D8' } as React.CSSProperties}>
            {ui.initials}
          </span>
        </header>
        <div className="d-content">{children}</div>
      </div>
    </div>
  );
}

/** Иконка статуса колонки, как StatusIcon приложения */
export function StatusIcon({ st }: { st: 'backlog' | 'todo' | 'progress' | 'review' | 'done' }) {
  const c = `var(--st-${st})`;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
      {st === 'backlog' && <circle cx="7" cy="7" r="5.4" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="1.9 2.1" />}
      {st === 'todo' && <circle cx="7" cy="7" r="5.4" fill="none" stroke={c} strokeWidth="1.5" />}
      {st === 'progress' && (
        <>
          <circle cx="7" cy="7" r="5.4" fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M7 3.2a3.8 3.8 0 0 1 0 7.6z" fill={c} />
        </>
      )}
      {st === 'review' && (
        <>
          <circle cx="7" cy="7" r="5.4" fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M7 3.2a3.8 3.8 0 1 1-3.8 3.8H7z" fill={c} />
        </>
      )}
      {st === 'done' && (
        <>
          <circle cx="7" cy="7" r="6.2" fill={c} />
          <path d="m4.3 7.1 1.9 1.9 3.6-3.8" fill="none" stroke="var(--surface)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export const Av = ({ i, c }: { i: string; c: string }) => (
  <span className="av sm" style={{ '--c': c } as React.CSSProperties}>
    {i}
  </span>
);

export const Prio = ({ n }: { n: number }) => (
  <span className="prio" style={{ width: 16, height: 16, fontSize: 10.5, background: `var(--pr-${n})` }}>
    {n}
  </span>
);

export const Lbl = ({ c, children }: { c: string; children: React.ReactNode }) => (
  <span className="lbl" style={{ '--c': `var(--${c})` } as React.CSSProperties}>
    <i />
    {children}
  </span>
);

const INTL_LOCALE: Record<Locale, string> = { ru: 'ru-RU', en: 'en-US', es: 'es-ES' };
export const CURRENCY: Record<Locale, string> = { ru: '₽', en: '$', es: '€' };

export const fmtNum = (n: number, locale: Locale = DEFAULT_LOCALE) => n.toLocaleString(INTL_LOCALE[locale]);

/** Форматирование денег по локали: ₽ для ru, $ для en, € для es. При kop=true — 2 знака без символа валюты (для колонок таблиц). */
export const money = (n: number, locale: Locale = DEFAULT_LOCALE, kop = false) => {
  const s = n.toLocaleString(INTL_LOCALE[locale], { minimumFractionDigits: kop ? 2 : 0, maximumFractionDigits: kop ? 2 : 0 });
  if (kop) return s;
  return locale === 'en' ? `$${s}` : `${s} ${CURRENCY[locale]}`;
};

/** Сумма с двумя знаками и символом валюты (для итогов документов) */
export const moneyFull = (n: number, locale: Locale = DEFAULT_LOCALE) => {
  const s = money(n, locale, true);
  return locale === 'en' ? `$${s}` : `${s} ${CURRENCY[locale]}`;
};

/** Число с пробелами-разделителями тысяч, как formatMoney приложения */
export const rub = (n: number, kop = false) => money(n, 'ru', kop);
