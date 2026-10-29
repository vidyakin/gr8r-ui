/* Оболочка приложения в кадре: левая панель, верхняя строка, содержимое. Классы — из apps/web (.sitem, .topbar, .crumbs…),
   раскладка своя (.d-shell): у настоящей .shell медиазапросы по ширине окна, а кадр живёт в своей ширине. */
import * as React from 'react';
import { Bell, CalendarCheck, ChartNoAxesCombined, CircleCheck, Factory, Play, Wrench, FileText, FolderKanban, Handshake, House, Inbox, ListChecks, Megaphone, Plus, ReceiptText, Search, UserPlus, Warehouse } from 'lucide-react';

const NAV = [
  { group: '', items: [['home', House, 'Главная'], ['inbox', Inbox, 'Входящие'], ['my', CircleCheck, 'Мои задачи']] },
  { group: 'Воркспейс', items: [['projects', FolderKanban, 'Проекты'], ['tasks', ListChecks, 'Задачи']] },
  { group: 'CRM', items: [['crm', ChartNoAxesCombined, 'Сводка'], ['leads', UserPlus, 'Лиды'], ['ads', Megaphone, 'Реклама'], ['deals', Handshake, 'Сделки']] },
  { group: 'Продажи', items: [['sales', ReceiptText, 'Документы продаж'], ['quotes', FileText, 'Коммерческие предложения'], ['stock', Warehouse, 'Склад']] },
  { group: 'Услуги', items: [['appts', CalendarCheck, 'Запись'], ['workorders', Wrench, 'Заказ-наряды']] },
  { group: 'Производство', items: [['prodorders', Factory, 'Заказы на производство'], ['release', Play, 'Выпуск продукции']] },
] as const;

export type NavId = (typeof NAV)[number]['items'][number][0];

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

export function DemoShell({ compact, active, crumbs, children }: { compact: boolean; active: NavId; crumbs: string[]; children: React.ReactNode }) {
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
          <div className="side-scroll">
            {NAV.map(g => (
              <div key={g.group} className={g.group ? 'sgroup' : undefined}>
                {g.group && <div className="sgroup-h">{g.group}</div>}
                {g.items.map(([id, Icon, name]) => (
                  <a key={id} className={'sitem' + (id === active ? ' on' : '')} data-demo={`nav-${id}`}>
                    <Icon size={16} />
                    <span className="trunc">{name}</span>
                  </a>
                ))}
              </div>
            ))}
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
              Создать
            </span>
          )}
          <span className="av md" style={{ '--c': '#5A67D8' } as React.CSSProperties}>
            АК
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

/** Число с пробелами-разделителями тысяч, как formatMoney приложения (демо-данные — всегда рубли) */
export const rub = (n: number, kop = false) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: kop ? 2 : 0, maximumFractionDigits: kop ? 2 : 0 }) + (kop ? '' : ' ₽');
