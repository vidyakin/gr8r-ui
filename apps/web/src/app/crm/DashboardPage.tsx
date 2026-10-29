/* CRM Dashboard — ключевые цифры, воронка по этапам, выручка по месяцам, топ сделок и ближайшие закрытия (в стиле Overview) */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { Plus, SquareKanban } from 'lucide-react';
import { Button, Checkbox } from '@/components/ui';
import { Panel, Stat } from '@/components/gr8r/panel';
import { MemberAvatar } from '../components/workspace';
import { diffDays, parse, relDate, today } from '../lib/dates';
import { useT } from '@/i18n';
import { CloseDate, StageIcon } from './components';
import { money, moneyShort, pct } from './format';
import { closingSoon, company as findCompany, conversionRate, openDeals, pipeline, revenueByMonth, stageSummary, sumAmount, topDeals, wonThisMonth } from './selectors';
import { stage } from './stages';
import { stageName } from './labels';
import { useCrm } from './store';
import { useCrmUi } from './ui-context';
import { cn } from '@/lib/utils';
import type { Deal } from './types';

/** Воронка: по этапу — полоса суммы (светлая) и взвешенной суммы (насыщенная) */
function Funnel({ deals, pipelineId }: { deals: Deal[]; pipelineId: string }) {
  const navigate = useNavigate();
  const t = useT();
  const rows = stageSummary(deals, pipelineId);
  const max = Math.max(...rows.map(r => r.amount), 1);
  return (
    <div className="panel-b">
      {rows.map(r => {
        const open = r.stage.category === 'in_progress';
        const w = (r.amount / max) * 100;
        const name = stageName(r.stage.id, r.stage.name);
        return (
          <div key={r.stage.id} className="crm-funnel" role="button" tabIndex={0} onClick={() => navigate('/crm/deals')} onKeyDown={e => e.key === 'Enter' && navigate('/crm/deals')}>
            <span className="row" style={{ gap: 7, width: 104 }}>
              <StageIcon stage={r.stage.id} />
              <span className="trunc">{name}</span>
            </span>
            <span className="crm-track" role="img" aria-label={`${name}: ${money(r.amount)}${open ? `, ${t('crm.dashboard.weightedLabel')} ${money(r.weighted)}` : ''}`}>
              <span className={cn('crm-fill', r.stage.category === 'won' && 'solid')} style={{ width: `${w}%`, '--c': r.stage.c } as React.CSSProperties}>
                {open && <i style={{ width: `${r.amount ? (r.weighted / r.amount) * 100 : 0}%` }} />}
              </span>
            </span>
            <span className="num muted" style={{ width: 24, textAlign: 'right' }}>
              {r.count}
            </span>
            <span className="num" style={{ width: 78, textAlign: 'right' }}>
              {moneyShort(r.amount)}
            </span>
          </div>
        );
      })}
      <div className="row faint" style={{ gap: 14, marginTop: 10, fontSize: 11.5 }}>
        <span className="row" style={{ gap: 5 }}>
          <i className="crm-key" style={{ opacity: 0.35 }} />
          {t('crm.dashboard.amountLabel')}
        </span>
        <span className="row" style={{ gap: 5 }}>
          <i className="crm-key" />
          {t('crm.dashboard.weightedLabel')}
        </span>
      </div>
    </div>
  );
}

/** Выручка выигранных сделок по месяцам: CSS-столбцы */
function Revenue({ deals }: { deals: Deal[] }) {
  const t = useT();
  const months = revenueByMonth(deals, 6);
  const max = Math.max(...months.map(m => m.amount), 1);
  const total = months.reduce((a, m) => a + m.amount, 0);
  return (
    <div className="panel-b">
      <div className="row" style={{ alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-.02em' }}>
          {money(total)}
        </span>
        <span className="muted">{t('crm.dashboard.wonInLast')}</span>
      </div>
      <div className="crm-bars" role="img" aria-label={`${t('crm.dashboard.revenue')}: ${months.map(m => `${m.label} ${money(m.amount)}`).join(', ')}`}>
        {months.map(m => (
          <div key={m.key} className={cn('crm-bar', m.current && 'cur')}>
            <span className="num v">{m.amount ? moneyShort(m.amount) : '—'}</span>
            <span className="trk">
              <i style={{ height: `${(m.amount / max) * 100}%` }} title={`${m.label}: ${money(m.amount)} (${m.count} deals)`} />
            </span>
            <span className="l">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DealRowLine({ d, right, company = true }: { d: Deal; right: React.ReactNode; company?: boolean }) {
  const { data } = useCrm();
  const ui = useCrmUi();
  const co = findCompany(data, d.company);
  return (
    <div className="row crm-row" role="button" tabIndex={0} onClick={() => ui.openDeal(d.id)} onKeyDown={e => e.key === 'Enter' && ui.openDeal(d.id)}>
      <StageIcon stage={d.stage} />
      <span className="grow trunc">
        {d.name} {company && <span className="faint hide-m">· {co?.name}</span>}
      </span>
      {right}
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, dispatch, pipes } = useCrm();
  const ui = useCrmUi();
  const t = useT();
  const ds = data.deals;
  const mainPipeline = pipes.pipelines.find(p => p.isDefault) ?? pipes.pipelines[0];
  const pl = pipeline(ds);
  const won = wonThisMonth(ds);
  const conv = conversionRate(ds);
  const lost = ds.filter(d => stage(d.stage).category === 'lost').length;
  const wonAll = ds.filter(d => stage(d.stage).category === 'won').length;
  const soon = closingSoon(ds, 5);
  const top = topDeals(ds, 5);
  const followups = data.activities
    .filter(a => a.type === 'task' && !a.done)
    .sort((a, b) => ((a.due ?? '') > (b.due ?? '') ? 1 : -1))
    .slice(0, 4);
  const overdue = openDeals(ds).filter(d => diffDays(parse(d.closeDate), today()) < 0).length;

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>{t('crm.dashboard.title')}</h1>
          <p>{t('crm.dashboard.subtitle', { companies: data.companies.length, deals: openDeals(ds).length })}</p>
        </div>
        <div className="acts">
          <Button onClick={() => ui.newDeal()}>
            <Plus size={14} />
            {t('crm.deals.newDeal')}
          </Button>
          <Button variant="primary" onClick={() => navigate('/crm/deals')}>
            <SquareKanban size={14} />
            {t('crm.dashboard.openPipelineBtn')}
          </Button>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label={t('crm.dashboard.openPipeline')} value={money(pl.amount)} note={t('crm.dashboard.openPipelineNote', { count: pl.count })} />
        <Stat label={t('crm.dashboard.weighted')} value={money(pl.weighted)} note={t('crm.dashboard.weightedNote', { pct: pct(pl.amount ? pl.weighted / pl.amount : 0) })} />
        <Stat label={t('crm.dashboard.wonThisMonth')} value={money(sumAmount(won))} note={t('crm.dashboard.wonThisMonthNote', { count: won.length })} tone={won.length ? 'up' : undefined} />
        <Stat label={t('crm.dashboard.winRate')} value={pct(conv)} note={t('crm.dashboard.winRateNote', { won: wonAll, lost })} />
      </div>

      <div className="grid2">
        <div className="stack">
          <Panel title={t('crm.dashboard.funnel')} actions={<span className="faint" style={{ fontSize: 11.5 }}>{t('crm.dashboard.funnelHint')}</span>}>
            {mainPipeline && <Funnel deals={ds.filter(d => stage(d.stage).pipelineId === mainPipeline.id)} pipelineId={mainPipeline.id} />}
          </Panel>
          <Panel title={t('crm.dashboard.revenue')} actions={<span className="faint" style={{ fontSize: 11.5 }}>{t('crm.dashboard.revenueHint')}</span>}>
            <Revenue deals={ds} />
          </Panel>
        </div>
        <div className="stack">
          <Panel title={t('crm.dashboard.topDeals')} actions={<span className="faint" style={{ fontSize: 11.5 }}>{t('crm.dashboard.topDealsHint')}</span>}>
            <div className="panel-b">
              {top.map(d => (
                <DealRowLine key={d.id} d={d} right={<span className="num">{money(d.amount)}</span>} />
              ))}
            </div>
          </Panel>
          <Panel title={t('crm.dashboard.closingSoon')} actions={overdue ? <span style={{ fontSize: 11.5, color: 'var(--red)' }}>{t('crm.dashboard.overdue', { count: overdue })}</span> : undefined}>
            <div className="panel-b">
              {soon.map(d => (
                <DealRowLine
                  key={d.id}
                  d={d}
                  company={false}
                  right={
                    <>
                      <span className="hide-m" style={{ width: 84 }}>
                        <CloseDate deal={d} />
                      </span>
                      <span className="num muted" style={{ width: 72, textAlign: 'right' }}>
                        {moneyShort(d.amount)}
                      </span>
                      <MemberAvatar id={d.owner} size="sm" />
                    </>
                  }
                />
              ))}
            </div>
          </Panel>
          <Panel title={t('crm.dashboard.followUps')}>
            <div className="panel-b">
              {followups.length ? (
                followups.map(a => {
                  const late = a.due && diffDays(parse(a.due), today()) < 0;
                  const co = findCompany(data, a.company);
                  return (
                    <div key={a.id} className="row crm-row">
                      <Checkbox round checked={!!a.done} onChange={() => dispatch({ type: 'activity/toggle', id: a.id })} aria-label={t('crm.common.completeAria', { subject: a.subject })} />
                      <span className="grow trunc">
                        {a.subject} {co && <span className="faint hide-m">· {co.name}</span>}
                      </span>
                      <span className="num" style={{ color: late ? 'var(--red)' : 'var(--text-3)', fontSize: 12 }}>
                        {a.due ? relDate(a.due) : ''}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="faint">{t('crm.dashboard.caughtUp')}</div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
