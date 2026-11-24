/* Запись «CRM»: сделка переходит в «Выиграна», суммы этапов пересчитываются, затем отчёт по каналам (ROMI) — разметка как у DealsPage и /crm/ads */
import type * as React from 'react';
import { BarChart3, Calendar, Ellipsis, Plus } from 'lucide-react';
import type { Locale } from '../i18n';
import { Av, DemoShell, StatusIcon, money } from './shell';
import { CRM_DICT, type CrmStage, type DealData } from './i18n/crm';
import type { Scene } from './player';

interface S {
  deals: Record<CrmStage, DealData[]>;
  drag: string | null;
  over: CrmStage | null;
  fresh: string | null;
  page: 'board' | 'report';
}

const makeInitial = (locale: Locale): S => ({
  deals: CRM_DICT[locale].initialDeals,
  drag: null,
  over: null,
  fresh: null,
  page: 'board',
});

const win = (s: S): S => {
  const x = s.deals.kp.find(v => v.id === 'd4')!;
  return { ...s, drag: null, over: null, fresh: 'd4', deals: { ...s.deals, kp: s.deals.kp.filter(v => v !== x), won: [x, ...s.deals.won] } };
};

const romi = (rev: number, exp: number) => (exp ? Math.round(((rev - exp) / exp) * 100) + ' %' : '—');

function DealCard({ x, locale, dragging, fresh }: { x: DealData; locale: Locale; dragging?: boolean; fresh?: boolean }) {
  return (
    <div className={'kcard crm-deal' + (dragging ? ' dragging' : '') + (fresh ? ' d-fresh' : '')} data-demo={`deal-${x.id}`}>
      <div className="top">
        <div className="title">{x.title}</div>
      </div>
      <div className="crm-co">
        <span className="picon crm-logo" style={{ '--c': `var(--${x.c})`, '--sz': '16px', fontSize: 8 } as React.CSSProperties}>
          {x.co.replace(/^(ООО|ИП|Семья|Familia) «?/, '')[0]}
        </span>
        <span className="trunc">{x.co}</span>
      </div>
      <div className="meta">
        <span className="amt num">{money(x.sum, locale)}</span>
        <span className="due">
          <Calendar size={12} />
          {x.due}
        </span>
        <Av i={x.av[0]} c={x.av[1]} />
      </div>
    </div>
  );
}

function Board({ s, compact, cursor, locale }: { s: S; compact: boolean; cursor: { x: number; y: number; dur: number }; locale: Locale }) {
  const d = CRM_DICT[locale];
  const stages = compact ? d.stages.slice(1) : d.stages;
  const dragged = s.drag ? s.deals.kp.find(x => x.id === s.drag) : null;
  const open = d.stages.slice(0, 3).flatMap(([id]) => s.deals[id]);
  const openSum = money(open.reduce((a, x) => a + x.sum, 0), locale);
  return (
    <>
      <div className="d-ph">
        <div>
          <h1>{d.dealsTitle}</h1>
          <p>{d.openDeals(open.length, openSum)}</p>
        </div>
        <span className="sp" />
        <span className="btn btn-secondary" data-demo="btn-report">
          <BarChart3 size={14} />
          {d.channelReportBtn}
        </span>
        {!compact && (
          <span className="btn btn-primary">
            <Plus size={14} />
            {d.newDealBtn}
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
                  {money(sum, locale)}
                </b>
              </div>
              <div className="bcol-b" data-demo={`stage-${id}`}>
                {s.over === id && <div className="drop-line" />}
                {list.map(x => (
                  <DealCard key={x.id} x={x} locale={locale} dragging={s.drag === x.id} fresh={s.fresh === x.id} />
                ))}
              </div>
              <div className="bcol-f">
                <span>{d.weighted(p)}</span>
                <b className="num">{money(Math.round((sum * p) / 100), locale)}</b>
              </div>
            </section>
          );
        })}
      </div>
      {dragged && (
        <div className="ghost" style={{ transform: `translate(${cursor.x - 60}px, ${cursor.y - 20}px) rotate(1.5deg)`, transitionDuration: `${cursor.dur}ms` }}>
          <DealCard x={dragged} locale={locale} />
        </div>
      )}
    </>
  );
}

function Report({ compact, fresh, locale }: { compact: boolean; fresh: boolean; locale: Locale }) {
  const d = CRM_DICT[locale];
  const tot = d.rows.reduce((a, r) => ({ exp: a.exp + r.exp, leads: a.leads + r.leads, rev: a.rev + r.rev }), { exp: 0, leads: 0, rev: 0 });
  return (
    <div className="d-page-in">
      <div className="d-ph">
        <h1>{d.adsTitle}</h1>
      </div>
      <div className="tabs d-tabs">
        <span className="tab on">{d.reportTabs[0]}</span>
        <span className="tab">{d.reportTabs[1]}</span>
      </div>
      <div className="d-toolbar">
        <span className="btn btn-secondary btn-sm">{d.periodFilter}</span>
        <span className="btn btn-ghost btn-sm">{d.breakdownFilter}</span>
      </div>
      <section className="panel d-report">
        <table className="dtbl">
          <thead>
            <tr>
              <th>{d.cols[0]}</th>
              <th className="r">{d.cols[1]}</th>
              <th className="r">{d.cols[2]}</th>
              {!compact && <th className="r">{d.cols[3]}</th>}
              {!compact && <th className="r">{d.cols[4]}</th>}
              <th className="r">{d.cols[5]}</th>
              <th className="r">{d.cols[6]}</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map(r => (
              <tr key={r.name} className={r.hot && fresh ? 'd-row-hot' : undefined} data-demo={r.hot ? 'row-hot' : undefined}>
                <td>
                  <span className="d-src">
                    <i style={{ background: r.c }} />
                    {r.name}
                  </span>
                </td>
                <td className="r num">{money(r.exp, locale)}</td>
                <td className="r num">{r.leads}</td>
                {!compact && <td className="r num">{r.conv} %</td>}
                {!compact && <td className="r num">{r.exp ? money(Math.round(r.exp / r.leads), locale) : '—'}</td>}
                <td className="r num">
                  {r.hot && fresh && <span className="d-delta">+{money(d.wonSum, locale)}</span>}
                  <span className={r.hot && fresh ? 'd-flash' : undefined}>{money(r.rev, locale)}</span>
                </td>
                <td className="r num d-romi">
                  {r.hot && fresh && (
                    <span className="d-delta">
                      {d.wasPrefix} {romi(r.rev - d.wonSum, r.exp)}
                    </span>
                  )}
                  <span className={r.hot && fresh ? 'd-flash' : undefined}>{romi(r.rev, r.exp)}</span>
                </td>
              </tr>
            ))}
            <tr className="d-total">
              <td>{d.total}</td>
              <td className="r num">{money(tot.exp, locale)}</td>
              <td className="r num">{tot.leads}</td>
              {!compact && <td />}
              {!compact && <td className="r num">{money(Math.round(tot.exp / tot.leads), locale)}</td>}
              <td className="r num">{money(tot.rev, locale)}</td>
              <td className="r num d-romi">{romi(tot.rev, tot.exp)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

export const crmScene: Scene<S> = {
  initial: makeInitial,
  final: locale => ({ ...win(makeInitial(locale)), fresh: null, page: 'report' }),
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
  render: (s, { compact, cursor, locale }) => {
    const d = CRM_DICT[locale];
    return (
      <DemoShell compact={compact} active={s.page === 'board' ? 'deals' : 'ads'} crumbs={s.page === 'board' ? d.crumbsBoard : d.crumbsReport} locale={locale}>
        {s.page === 'board' ? <Board s={s} compact={compact} cursor={cursor} locale={locale} /> : <Report compact={compact} fresh={!!s.fresh} locale={locale} />}
      </DemoShell>
    );
  },
};
