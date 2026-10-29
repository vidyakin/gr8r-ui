/* Запись «CRM»: сделка переходит в «Выиграна», суммы этапов пересчитываются, затем отчёт по каналам (ROMI) — разметка как у DealsPage и /crm/ads */
import type * as React from 'react';
import { BarChart3, Calendar, Ellipsis, Plus } from 'lucide-react';
import { Av, DemoShell, StatusIcon, rub } from './shell';
import type { Scene } from './player';

type Stage = 'new' | 'qual' | 'kp' | 'won';
interface Deal {
  id: string;
  title: string;
  co: string;
  c: string;
  sum: number;
  due: string;
  av: [string, string];
}
interface S {
  deals: Record<Stage, Deal[]>;
  drag: string | null;
  over: Stage | null;
  fresh: string | null;
  page: 'board' | 'report';
}

const STAGES: [Stage, string, number, 'backlog' | 'todo' | 'progress' | 'review' | 'done'][] = [
  ['new', 'Новая', 10, 'todo'],
  ['qual', 'Квалификация', 25, 'progress'],
  ['kp', 'КП отправлено', 60, 'review'],
  ['won', 'Выиграна', 100, 'done'],
];

const d = (id: string, title: string, co: string, c: string, sum: number, due: string, av: [string, string]): Deal => ({ id, title, co, c, sum, due, av });

const initial: S = {
  deals: {
    new: [d('d1', 'Шкаф-купе, ул. Ленина', 'Иванова Елена', 'rose', 84000, '12 нояб.', ['АК', '#5A67D8'])],
    qual: [d('d2', 'Гардеробная «Лофт»', 'ООО «Северстрой»', 'teal', 236000, '19 нояб.', ['МЛ', '#8662C9']), d('d3', 'Мебель для офиса', 'ИП Громов', 'orange', 410000, '2 дек.', ['АК', '#5A67D8'])],
    kp: [d('d4', 'Кухня, ЖК Северный', 'Петров Андрей', 'blue', 318000, '5 нояб.', ['ЕС', '#23918A']), d('d5', 'Прихожая', 'Смирнова Ольга', 'violet', 96000, '9 нояб.', ['МЛ', '#8662C9'])],
    won: [d('d6', 'Детская', 'Семья Кузнецовых', 'green', 152000, '24 окт.', ['ЕС', '#23918A'])],
  },
  drag: null,
  over: null,
  fresh: null,
  page: 'board',
};

const win = (s: S): S => {
  const x = s.deals.kp.find(v => v.id === 'd4')!;
  return { ...s, drag: null, over: null, fresh: 'd4', deals: { ...s.deals, kp: s.deals.kp.filter(v => v !== x), won: [x, ...s.deals.won] } };
};
const final: S = { ...win(initial), fresh: null, page: 'report' };

/** Сумма выигранной в записи сделки */
const WON = 318000;
/** Отчёт по каналам: выручка канала «Яндекс Директ» — с выигранной кухней (318 000) */
const ROWS = [
  { name: 'Яндекс Директ', c: 'var(--red)', exp: 120000, leads: 46, conv: 15, rev: 730000, hot: true },
  { name: 'Авито', c: 'var(--green)', exp: 45000, leads: 31, conv: 10, rev: 152000 },
  { name: 'Рекомендации', c: 'var(--violet)', exp: 0, leads: 12, conv: 42, rev: 520000 },
];
const romi = (rev: number, exp: number) => (exp ? Math.round(((rev - exp) / exp) * 100) + ' %' : '—');

function DealCard({ x, dragging, fresh }: { x: Deal; dragging?: boolean; fresh?: boolean }) {
  return (
    <div className={'kcard crm-deal' + (dragging ? ' dragging' : '') + (fresh ? ' d-fresh' : '')} data-demo={`deal-${x.id}`}>
      <div className="top">
        <div className="title">{x.title}</div>
      </div>
      <div className="crm-co">
        <span className="picon crm-logo" style={{ '--c': `var(--${x.c})`, '--sz': '16px', fontSize: 8 } as React.CSSProperties}>
          {x.co.replace(/^(ООО|ИП|Семья) «?/, '')[0]}
        </span>
        <span className="trunc">{x.co}</span>
      </div>
      <div className="meta">
        <span className="amt num">{rub(x.sum)}</span>
        <span className="due">
          <Calendar size={12} />
          {x.due}
        </span>
        <Av i={x.av[0]} c={x.av[1]} />
      </div>
    </div>
  );
}

function Board({ s, compact, cursor }: { s: S; compact: boolean; cursor: { x: number; y: number; dur: number } }) {
  const stages = compact ? STAGES.slice(1) : STAGES;
  const dragged = s.drag ? s.deals.kp.find(x => x.id === s.drag) : null;
  const open = STAGES.slice(0, 3).flatMap(([id]) => s.deals[id]);
  return (
    <>
      <div className="d-ph">
        <div>
          <h1>Сделки</h1>
          <p>
            {open.length} открытых сделок · {rub(open.reduce((a, x) => a + x.sum, 0))} в воронке
          </p>
        </div>
        <span className="sp" />
        <span className="btn btn-secondary" data-demo="btn-report">
          <BarChart3 size={14} />
          Отчёт по каналам
        </span>
        {!compact && (
          <span className="btn btn-primary">
            <Plus size={14} />
            Новая сделка
          </span>
        )}
      </div>
      <div className="board">
        {stages.map(([id, name, p, st]) => {
          const list = s.deals[id];
          const sum = list.reduce((a, x) => a + x.sum, 0);
          return (
            <section key={id} className={'bcol' + (s.over === id ? ' over' : '')}>
              <div className="bcol-h">
                <StatusIcon st={st} />
                <span>{name}</span>
                <span className="cnt">{list.length}</span>
                <span className="acts">
                  <span className="ibtn ibtn-xs">
                    <Ellipsis size={14} />
                  </span>
                </span>
              </div>
              <div className="bcol-sub">
                <b className={'num' + (s.fresh && (id === 'won' || id === 'kp') ? ' d-flash' : '')} key={sum}>
                  {rub(sum)}
                </b>
              </div>
              <div className="bcol-b" data-demo={`stage-${id}`}>
                {s.over === id && <div className="drop-line" />}
                {list.map(x => (
                  <DealCard key={x.id} x={x} dragging={s.drag === x.id} fresh={s.fresh === x.id} />
                ))}
              </div>
              <div className="bcol-f">
                <span>Взвешено · {p}%</span>
                <b className="num">{rub(Math.round((sum * p) / 100))}</b>
              </div>
            </section>
          );
        })}
      </div>
      {dragged && (
        <div className="ghost" style={{ transform: `translate(${cursor.x - 60}px, ${cursor.y - 20}px) rotate(1.5deg)`, transitionDuration: `${cursor.dur}ms` }}>
          <DealCard x={dragged} />
        </div>
      )}
    </>
  );
}

function Report({ compact, fresh }: { compact: boolean; fresh: boolean }) {
  const tot = ROWS.reduce((a, r) => ({ exp: a.exp + r.exp, leads: a.leads + r.leads, rev: a.rev + r.rev }), { exp: 0, leads: 0, rev: 0 });
  return (
    <div className="d-page-in">
      <div className="d-ph">
        <h1>Реклама</h1>
      </div>
      <div className="tabs d-tabs">
        <span className="tab on">Отчёт по каналам</span>
        <span className="tab">Кампании</span>
      </div>
      <div className="d-toolbar">
        <span className="btn btn-secondary btn-sm">Период: октябрь 2026</span>
        <span className="btn btn-ghost btn-sm">Разрез: источник</span>
      </div>
      <section className="panel d-report">
        <table className="dtbl">
          <thead>
            <tr>
              <th>Источник</th>
              <th className="r">Расход</th>
              <th className="r">Лиды</th>
              {!compact && <th className="r">Конверсия</th>}
              {!compact && <th className="r">CPL</th>}
              <th className="r">Выручка</th>
              <th className="r">ROMI</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(r => (
              <tr key={r.name} className={r.hot && fresh ? 'd-row-hot' : undefined} data-demo={r.hot ? 'row-hot' : undefined}>
                <td>
                  <span className="d-src">
                    <i style={{ background: r.c }} />
                    {r.name}
                  </span>
                </td>
                <td className="r num">{rub(r.exp)}</td>
                <td className="r num">{r.leads}</td>
                {!compact && <td className="r num">{r.conv} %</td>}
                {!compact && <td className="r num">{r.exp ? rub(Math.round(r.exp / r.leads)) : '—'}</td>}
                <td className="r num">
                  {r.hot && fresh && <span className="d-delta">+{rub(WON)}</span>}
                  <span className={r.hot && fresh ? 'd-flash' : undefined}>{rub(r.rev)}</span>
                </td>
                <td className="r num d-romi">
                  {r.hot && fresh && <span className="d-delta">было {romi(r.rev - WON, r.exp)}</span>}
                  <span className={r.hot && fresh ? 'd-flash' : undefined}>{romi(r.rev, r.exp)}</span>
                </td>
              </tr>
            ))}
            <tr className="d-total">
              <td>Итого</td>
              <td className="r num">{rub(tot.exp)}</td>
              <td className="r num">{tot.leads}</td>
              {!compact && <td />}
              {!compact && <td className="r num">{rub(Math.round(tot.exp / tot.leads))}</td>}
              <td className="r num">{rub(tot.rev)}</td>
              <td className="r num d-romi">{romi(tot.rev, tot.exp)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

export const crmScene: Scene<S> = {
  initial,
  final,
  height: [500, 580],
  script: async ({ set, wait, move, click }) => {
    await move('deal-d4', { ay: 0.3 });
    await wait(150);
    set(s => ({ ...s, drag: 'd4' }));
    await wait(200);
    await move('stage-won', { ay: 0.1, dur: 900 });
    set(s => ({ ...s, over: 'won' }));
    await wait(400);
    set(win);
    await wait(1800);
    await move('btn-report');
    await click();
    set(s => ({ ...s, page: 'report' }));
    await wait(500);
    await move('row-hot', { ax: 0.82 });
    await wait(600);
  },
  render: (s, { compact, cursor }) => (
    <DemoShell compact={compact} active={s.page === 'board' ? 'deals' : 'ads'} crumbs={['CRM', s.page === 'board' ? 'Сделки' : 'Реклама']}>
      {s.page === 'board' ? <Board s={s} compact={compact} cursor={cursor} /> : <Report compact={compact} fresh={!!s.fresh} />}
    </DemoShell>
  ),
};
