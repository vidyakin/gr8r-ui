/* Карточка инвестпроекта — как форма 1С: шапка (наименование, шаг, начало, горизонт, ставка, связи), ключевые показатели
   «план / факт / прогноз», вкладки «План», «Денежный поток», «План-факт», «Статьи проекта», комментарий внизу.
   Показатели плана и прогноза пересчитываются в форме сразу (те же чистые функции, что на сервере), факт — с сервера.
   Править и менять статус может admin и owner; план — только у черновика. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import {
  cashflowTable,
  dec,
  fmt,
  forecastFlows,
  INVESTMENT_PERIOD_KINDS,
  investmentMetrics,
  periodIndexOf,
  periodLabel,
  periodRate,
  periodStart,
  sumByPeriod,
  type CashflowPeriod,
  type Dec,
  type InvestmentMetrics,
  type InvestmentPeriodKind,
  type ProjectStatus as ProjectStatusId,
} from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, t, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useWorkspace } from '../data/store';
import { useCostItems, useOrganizations } from '../docs/data';
import { DocTabs } from '../docs/doc-tabs';
import { fmtDate } from '../lib/dates';
import { useCanSeeAmounts, useInvestment, useInvestmentApi, type InvestmentDetail, type InvestmentInput } from './data';
import { amount, num, statusTone } from './InvestmentsPage';
import { PlanFactTab } from './PlanFactTab';
import { ProjectStatus } from '../components/project';

type Line = InvestmentInput['lines'][number];

const today = () => new Date().toISOString().slice(0, 10);
/** «14.0000» → «14» */
const trimZeros = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
const newLine = (periodIndex = 0): Line => ({ id: crypto.randomUUID(), periodIndex, costItemId: '', amount: '0', comment: '' });

const blank = (): InvestmentInput => ({
  name: '',
  periodKind: 'quarter',
  startDate: periodStart(today(), 'quarter'),
  periods: 8,
  discountRate: '12',
  projectId: null,
  organizationId: null,
  responsibleId: null,
  comment: '',
  lines: [newLine()],
  costItemIds: [],
  factBasis: 'accrual',
});

const fromDetail = (d: InvestmentDetail): InvestmentInput => ({
  name: d.name,
  periodKind: d.periodKind,
  startDate: d.startDate,
  periods: d.periods,
  discountRate: trimZeros(d.discountRate ?? '0'),
  projectId: d.projectId,
  organizationId: d.organizationId,
  responsibleId: d.responsibleId,
  comment: d.comment,
  lines: d.lines.map(l => ({ id: l.id, periodIndex: l.periodIndex, costItemId: l.costItemId, amount: trimZeros(l.amount ?? '0'), comment: l.comment })),
  costItemIds: d.costItems.map(c => c.id),
  factBasis: d.factBasis ?? 'accrual',
});

/** Вложения и поступления факта по периодам формы (с сервера; при смене горизонта в форме — до сохранения обрезаются) */
function factArrays(d: InvestmentDetail | null | undefined, periods: number) {
  const out: Dec[] = Array.from({ length: periods }, () => 0n);
  const inc: Dec[] = Array.from({ length: periods }, () => 0n);
  for (const r of (d?.fact.cashflow ?? []) as CashflowPeriod[]) {
    if (r.outflow === undefined || r.index >= periods) continue;
    out[r.index] = dec(r.outflow);
    inc[r.index] = dec(r.inflow);
  }
  return { outflow: out, inflow: inc };
}

export function InvestmentPage() {
  const tt = useT();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const canManage = useCanSeeAmounts();
  const api = useInvestmentApi();
  const doc = useInvestment(isNew ? undefined : id);
  const detail = isNew ? null : doc.data;
  const { data: ws } = useWorkspace();
  const costItems = useCostItems();
  const orgs = useOrganizations();
  const [form, setForm] = React.useState<InvestmentInput>(blank);
  const [busy, setBusy] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);
  const [scenario, setScenario] = React.useState<'plan' | 'fact' | 'forecast'>('plan');
  const loadedFor = React.useRef<string | null>(null);

  // загруженный проект кладём в форму один раз (и после сохранения — заново)
  React.useEffect(() => {
    if (!detail || loadedFor.current === detail.id + detail.updatedAt) return;
    loadedFor.current = detail.id + detail.updatedAt;
    setForm(fromDetail(detail));
  }, [detail]);

  const set = <K extends keyof InvestmentInput>(k: K, v: InvestmentInput[K]) => setForm(f => ({ ...f, [k]: v }));
  const setLine = (i: number, patch: Partial<Line>) => setForm(f => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const status = detail?.status ?? 'draft';
  const archived = !!detail?.archivedAt;
  const headEditable = canManage && !archived && status !== 'closed';
  const planEditable = headEditable && status === 'draft';

  const kind = form.periodKind;
  const start = periodStart(form.startDate || today(), kind);
  const periods = Math.max(1, Math.min(240, Math.floor(Number(form.periods) || 1)));
  const labels = React.useMemo(() => Array.from({ length: periods }, (_, i) => periodLabel(start, kind, i)), [start, kind, periods]);
  const itemKind = new Map((costItems.data ?? []).map(c => [c.id, c.kind]));

  // план и прогноз — в форме, сразу при правке; факт — с сервера
  const live = React.useMemo(() => {
    const rate = Number(form.discountRate) || 0;
    const plan = sumByPeriod(
      form.lines.filter(l => l.costItemId && Number(l.amount) > 0 && l.periodIndex < periods).map(l => ({ periodIndex: l.periodIndex, direction: itemKind.get(l.costItemId) === 'income' ? 'in' : 'out', amount: l.amount })),
      periods,
    );
    const fact = factArrays(detail, periods);
    const current = Math.max(0, Math.min(periodIndexOf(start, kind, today()), periods));
    const forecast = { outflow: forecastFlows(plan.outflow, fact.outflow, current), inflow: forecastFlows(plan.inflow, fact.inflow, current) };
    const pr = periodRate(rate, kind);
    const pack = (x: { outflow: Dec[]; inflow: Dec[] }) => ({ cashflow: cashflowTable(x.outflow, x.inflow, pr), metrics: investmentMetrics(x.outflow, x.inflow, rate, kind) });
    return { current, plan: pack(plan), fact: pack(fact), forecast: pack(forecast) };
  }, [form.lines, form.discountRate, periods, kind, start, detail, costItems.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = form.name.trim() !== '' && !!form.startDate && form.lines.every(l => l.costItemId && Number(l.amount) > 0 && l.periodIndex < periods);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, periods, startDate: start, lines: form.lines.filter(l => l.costItemId) };
      if (detail) {
        // у утверждённого проекта план заморожен — отправляем только шапку и статьи
        const patch: Partial<InvestmentInput> = planEditable ? body : { name: body.name, projectId: body.projectId, organizationId: body.organizationId, responsibleId: body.responsibleId, comment: body.comment, costItemIds: body.costItemIds, factBasis: body.factBasis };
        await api.update(detail.id, patch);
      } else {
        const created = await api.create(body);
        await navigate(`/investments/${created.id}`, { replace: true });
      }
      toast(tt('finance.common.saved'), { duration: 1500 });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (action: 'approve' | 'unapprove' | 'close' | 'reopen') => {
    if (!detail) return;
    setBusy(true);
    try {
      // перед утверждением сохраняем правки черновика
      if (action === 'approve' && planEditable) await api.update(detail.id, { ...form, periods, startDate: start, lines: form.lines.filter(l => l.costItemId) });
      await api.status(detail.id, action);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isNew && doc.isPending)
    return (
      <div className="page flush">
        <div className="ph">
          <Skeleton w={260} h={24} />
        </div>
      </div>
    );

  const projects = ws.projects.filter(p => !p.archived);
  const totalOut = form.lines.reduce((s, l) => (itemKind.get(l.costItemId) === 'income' ? s : s + dec(l.amount)), 0n);
  const totalIn = form.lines.reduce((s, l) => (itemKind.get(l.costItemId) === 'income' ? s + dec(l.amount) : s), 0n);
  const cashflow = live[scenario].cashflow;

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{detail?.name || tt('finance.card.newTitle')}</h1>
          <p>
            {detail && (
              <Badge tone={statusTone(status)} dot>
                {tt(`finance.status.${status}`)}
              </Badge>
            )}
          </p>
        </div>
        <div className="acts">
          {headEditable && (
            <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>
              {detail ? tt('finance.common.save') : tt('finance.common.create')}
            </Button>
          )}
          {detail && canManage && !archived && (
            <>
              {status === 'draft' && (
                <Button disabled={busy || !valid} onClick={() => void changeStatus('approve')}>
                  {tt('finance.card.approve')}
                </Button>
              )}
              {status === 'approved' && (
                <>
                  <Button disabled={busy} onClick={() => void changeStatus('unapprove')}>
                    {tt('finance.card.unapprove')}
                  </Button>
                  <Button disabled={busy} onClick={() => void changeStatus('close')}>
                    {tt('finance.card.close')}
                  </Button>
                </>
              )}
              {status === 'closed' && (
                <Button disabled={busy} onClick={() => void changeStatus('reopen')}>
                  {tt('finance.card.reopen')}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setArchiving(true)}>
                {tt('finance.common.archive')}
              </Button>
            </>
          )}
          {detail && canManage && archived && (
            <Button onClick={() => void api.archive(detail.id, true)}>{tt('finance.common.restore')}</Button>
          )}
        </div>
      </div>

      <section className="panel doc-head" aria-label={tt('finance.field.name')}>
        <Field label={tt('finance.field.name')} className="doc-wide">
          {p => <Input {...p} disabled={!headEditable} value={form.name} onChange={e => set('name', e.target.value)} />}
        </Field>
        <Field label={tt('finance.field.periodKind')}>
          {p => (
            <Select
              {...p}
              disabled={!planEditable}
              value={form.periodKind}
              onValueChange={v => setForm(f => ({ ...f, periodKind: v as InvestmentPeriodKind, startDate: periodStart(f.startDate || today(), v as InvestmentPeriodKind) }))}
              options={INVESTMENT_PERIOD_KINDS.map(k => ({ value: k, label: tt(`finance.periodKind.${k}`) }))}
            />
          )}
        </Field>
        <Field label={tt('finance.field.startDate')}>{p => <Input {...p} type="date" disabled={!planEditable} value={form.startDate} onChange={e => set('startDate', e.target.value)} onBlur={() => set('startDate', start)} />}</Field>
        <Field label={tt('finance.field.periods')}>{p => <Input {...p} inputMode="decimal" disabled={!planEditable} value={String(form.periods)} onChange={e => set('periods', Number(e.target.value.replace(/\D/g, '')) || 0)} />}</Field>
        <Field label={t('money.investment.factBasis')}>
          {p => (
            <Select
              id={p.id}
              disabled={!canManage}
              value={form.factBasis}
              onValueChange={v => set('factBasis', v as 'accrual' | 'payments')}
              options={[
                { value: 'accrual', label: t('money.investment.accrual') },
                { value: 'payments', label: t('money.investment.payments') },
              ]}
              aria-label={t('money.investment.factBasis')}
            />
          )}
        </Field>
        <Field label={tt('finance.field.discountRate')}>
          {p => <Input {...p} inputMode="decimal" disabled={!planEditable || !canManage} value={canManage ? form.discountRate : t('finance.common.empty')} onChange={e => set('discountRate', e.target.value)} />}
        </Field>
        <Field label={tt('finance.field.organization')}>
          {p => (
            <Select
              {...p}
              disabled={!headEditable}
              value={form.organizationId ?? ''}
              onValueChange={v => set('organizationId', v || null)}
              options={[{ value: '', label: tt('finance.common.empty') }, ...(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))]}
            />
          )}
        </Field>
        <Field label={tt('finance.field.responsible')}>
          {p => (
            <Select
              {...p}
              disabled={!headEditable}
              value={form.responsibleId ?? ''}
              onValueChange={v => set('responsibleId', v || null)}
              options={[{ value: '', label: tt('finance.common.empty') }, ...ws.members.map(m => ({ value: m.id, label: m.name }))]}
            />
          )}
        </Field>
        <Field label={tt('finance.field.project')} className="doc-wide">
          {p => (
            <Select
              {...p}
              disabled={!headEditable}
              value={form.projectId ?? ''}
              onValueChange={v => set('projectId', v || null)}
              options={[{ value: '', label: tt('finance.common.empty') }, ...projects.map(x => ({ value: x.id, label: x.name }))]}
            />
          )}
        </Field>
        {detail?.project && (
          <p className="doc-wide faint" style={{ margin: 0, fontSize: 12 }}>
            <Link to={`/projects/${detail.project.id}`} className="crm-link">
              {detail.project.name}
            </Link>{' '}
            · <ProjectStatus status={detail.project.status as ProjectStatusId} /> · {tt('finance.card.linkedProject', { start: fmtDate(detail.project.startDate ?? ''), due: fmtDate(detail.project.dueDate ?? '') })}
          </p>
        )}
      </section>

      {(archived || status !== 'draft' || (detail?.outsideHorizon ?? 0) > 0) && (
        <div className="faint" style={{ fontSize: 12, padding: '8px var(--gutter) 0' }}>
          {archived && <p>{tt('finance.card.archived')}</p>}
          {status === 'approved' && <p>{tt('finance.card.planLocked')}</p>}
          {status === 'closed' && <p>{tt('finance.card.closedHint')}</p>}
          {!!detail?.outsideHorizon && <p>{tt('finance.card.outsideHorizon', { count: detail.outsideHorizon })}</p>}
        </div>
      )}

      <section className="panel inv-metrics" aria-label={tt('finance.card.metrics')}>
        {canManage ? <Metrics plan={live.plan.metrics} fact={detail ? live.fact.metrics : null} forecast={detail ? live.forecast.metrics : null} /> : <p className="faint">{tt('finance.common.hiddenAmounts')}</p>}
      </section>

      <DocTabs
        label={tt('finance.card.tabs')}
        tabs={[
          {
            id: 'plan',
            label: tt('finance.card.planTab'),
            count: form.lines.length,
            content: (
              <section className="doc-lines panel" aria-label={tt('finance.card.planTab')}>
                <div className="table-wrap">
                  <table className="dtbl" aria-label={tt('finance.card.planTab')}>
                    <thead>
                      <tr>
                        <th style={{ width: 34 }}>#</th>
                        <th style={{ width: 140 }}>{tt('finance.field.period')}</th>
                        <th style={{ width: 240 }}>{tt('finance.field.costItem')}</th>
                        <th style={{ width: 120 }}>{tt('finance.field.direction')}</th>
                        <th style={{ width: 140 }} className="r">{tt('finance.field.amount')}</th>
                        <th>{tt('finance.field.comment')}</th>
                        <th style={{ width: 36 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {form.lines.map((l, i) => {
                        const k = itemKind.get(l.costItemId);
                        return (
                          <tr key={l.id}>
                            <td className="faint num">{i + 1}</td>
                            <td>
                              <Select aria-label={tt('finance.field.period')} disabled={!planEditable} value={String(l.periodIndex)} onValueChange={v => setLine(i, { periodIndex: Number(v) })} options={labels.map((lb, j) => ({ value: String(j), label: lb }))} />
                            </td>
                            <td>
                              <Select
                                aria-label={tt('finance.field.costItem')}
                                disabled={!planEditable}
                                value={l.costItemId}
                                onValueChange={v => setLine(i, { costItemId: v })}
                                options={(costItems.data ?? []).filter(c => !c.archivedAt || c.id === l.costItemId).map(c => ({ value: c.id, label: c.name }))}
                              />
                            </td>
                            <td>{k && <Badge tone={k === 'income' ? 'green' : 'gray'}>{tt(`finance.direction.${k === 'income' ? 'in' : 'out'}`)}</Badge>}</td>
                            <td className="r">
                              <Input aria-label={tt('finance.field.amount')} inputMode="decimal" className="cell-input r" disabled={!planEditable || !canManage} value={canManage ? l.amount : t('finance.common.empty')} onChange={e => setLine(i, { amount: e.target.value })} />
                            </td>
                            <td>
                              <Input aria-label={tt('finance.field.comment')} className="cell-input" disabled={!planEditable} value={l.comment} onChange={e => setLine(i, { comment: e.target.value })} />
                            </td>
                            <td>
                              {planEditable && (
                                <IconButton size="xs" label={tt('finance.common.remove')} onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}>
                                  <Trash2 size={13} />
                                </IconButton>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!form.lines.length && <p className="faint" style={{ padding: 12 }}>{tt('finance.card.noLines')}</p>}
                </div>
                {planEditable && (
                  <div className="doc-add">
                    <Button size="sm" variant="ghost" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, newLine(Math.min((f.lines.at(-1)?.periodIndex ?? -1) + 1, periods - 1))] }))}>
                      <Plus size={13} />
                      {tt('finance.common.add')}
                    </Button>
                  </div>
                )}
                {canManage && (
                  <div className="doc-totals" style={{ borderTop: '1px solid var(--divider)' }}>
                    <dl>
                      <div>
                        <dt>{tt('finance.metric.totalOutflow')}</dt>
                        <dd className="num">{fmtAmount(fmt(totalOut, 2))}</dd>
                      </div>
                      <div>
                        <dt>{tt('finance.metric.totalInflow')}</dt>
                        <dd className="num">{fmtAmount(fmt(totalIn, 2))}</dd>
                      </div>
                    </dl>
                  </div>
                )}
              </section>
            ),
          },
          {
            id: 'cashflow',
            label: tt('finance.card.cashflowTab'),
            content: (
              <section className="doc-lines panel" aria-label={tt('finance.cashflow.table')}>
                {canManage ? (
                  <>
                    <div className="doc-add" style={{ borderTop: 0, borderBottom: '1px solid var(--divider)' }}>
                      <Field label={tt('finance.cashflow.scenario')}>
                        {p => (
                          <Select
                            {...p}
                            value={scenario}
                            onValueChange={v => setScenario(v as typeof scenario)}
                            options={(detail ? (['plan', 'fact', 'forecast'] as const) : (['plan'] as const)).map(s => ({ value: s, label: tt(`finance.metric.${s}`) }))}
                          />
                        )}
                      </Field>
                      {scenario === 'forecast' && <span className="faint" style={{ fontSize: 12 }}>{tt('finance.metric.forecastHint')}</span>}
                    </div>
                    <div className="table-wrap">
                      <table className="dtbl" aria-label={tt('finance.cashflow.table')}>
                        <thead>
                          <tr>
                            <th style={{ width: 120 }}>{tt('finance.field.period')}</th>
                            <th className="r">{tt('finance.cashflow.outflow')}</th>
                            <th className="r">{tt('finance.cashflow.inflow')}</th>
                            <th className="r">{tt('finance.cashflow.net')}</th>
                            <th className="r">{tt('finance.cashflow.cumulative')}</th>
                            <th className="r">{tt('finance.cashflow.discounted')}</th>
                            <th className="r">{tt('finance.cashflow.discountedCumulative')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashflow.map(r => (
                            <tr key={r.index} className={r.index === live.current ? 'inv-current' : undefined}>
                              <td>
                                {labels[r.index]}
                                {r.index === live.current && detail && <span className="faint"> · {tt('finance.cashflow.current')}</span>}
                              </td>
                              <td className="r num">{fmtAmount(r.outflow)}</td>
                              <td className="r num">{fmtAmount(r.inflow)}</td>
                              <td className={`r num ${Number(r.net) < 0 ? 'inv-neg' : ''}`}>{fmtAmount(r.net)}</td>
                              <td className={`r num ${Number(r.cumulative) < 0 ? 'inv-neg' : ''}`}>{fmtAmount(r.cumulative)}</td>
                              <td className="r num">{fmtAmount(r.discounted)}</td>
                              <td className={`r num ${Number(r.discountedCumulative) < 0 ? 'inv-neg' : ''}`}>{fmtAmount(r.discountedCumulative)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="faint" style={{ padding: 12 }}>{tt('finance.common.hiddenAmounts')}</p>
                )}
              </section>
            ),
          },
          detail && { id: 'planFact', label: tt('finance.card.planFactTab'), count: detail.factDocuments, content: <PlanFactTab id={detail.id} /> },
          {
            id: 'costItems',
            label: tt('finance.card.costItemsTab'),
            count: form.costItemIds.length,
            content: (
              <section className="doc-lines panel" aria-label={tt('finance.card.costItemsTab')}>
                <p className="faint" style={{ fontSize: 12, padding: '10px 12px 0', margin: 0 }}>{tt('finance.card.costItemsHint')}</p>
                <div className="table-wrap">
                  <table className="dtbl" aria-label={tt('finance.card.costItemsTab')}>
                    <tbody>
                      {form.costItemIds.map(cid => {
                        const c = (costItems.data ?? []).find(x => x.id === cid);
                        return (
                          <tr key={cid}>
                            <td>{c?.name ?? cid}</td>
                            <td style={{ width: 140 }}>{c && <Badge tone={c.kind === 'income' ? 'green' : 'gray'}>{tt(`finance.direction.${c.kind === 'income' ? 'in' : 'out'}`)}</Badge>}</td>
                            <td style={{ width: 36 }}>
                              {headEditable && (
                                <IconButton size="xs" label={tt('finance.common.remove')} onClick={() => set('costItemIds', form.costItemIds.filter(x => x !== cid))}>
                                  <Trash2 size={13} />
                                </IconButton>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!form.costItemIds.length && <p className="faint" style={{ padding: 12 }}>{tt('finance.card.noCostItems')}</p>}
                </div>
                {headEditable && (
                  <div className="doc-add">
                    <Select
                      aria-label={tt('finance.card.addCostItem')}
                      placeholder={tt('finance.card.addCostItem')}
                      value=""
                      onValueChange={v => v && set('costItemIds', [...form.costItemIds, v])}
                      options={(costItems.data ?? []).filter(c => !c.archivedAt && !form.costItemIds.includes(c.id)).map(c => ({ value: c.id, label: c.name }))}
                    />
                  </div>
                )}
              </section>
            ),
          },
        ]}
      />

      <section className="doc-comment panel" aria-label={tt('finance.field.comment')}>
        <Field label={tt('finance.field.comment')}>{p => <Input {...p} disabled={!headEditable} value={form.comment} placeholder={tt('finance.card.commentHint')} onChange={e => set('comment', e.target.value)} />}</Field>
      </section>

      {archiving && detail && (
        <ConfirmDialog
          open
          danger
          title={tt('finance.common.archive')}
          confirmLabel={tt('finance.common.archive')}
          onOpenChange={open => !open && setArchiving(false)}
          onConfirm={async () => {
            setArchiving(false);
            await api.archive(detail.id);
            await navigate('/investments', { replace: true });
          }}
          description=""
        />
      )}
    </div>
  );
}

/** Ключевые показатели: строки — показатели, колонки — план, факт, прогноз */
function Metrics({ plan, fact, forecast }: { plan: InvestmentMetrics; fact: InvestmentMetrics | null; forecast: InvestmentMetrics | null }) {
  const tt = useT();
  const cols = [
    { id: 'plan' as const, m: plan },
    ...(fact ? [{ id: 'fact' as const, m: fact }] : []),
    ...(forecast ? [{ id: 'forecast' as const, m: forecast }] : []),
  ];
  const rows: { key: keyof InvestmentMetrics; money?: boolean; never?: boolean }[] = [
    { key: 'totalOutflow', money: true },
    { key: 'totalInflow', money: true },
    { key: 'net', money: true },
    { key: 'npv', money: true },
    { key: 'irr' },
    { key: 'pi' },
    { key: 'payback', never: true },
    { key: 'discountedPayback', never: true },
  ];
  return (
    <table className="dtbl" aria-label={tt('finance.card.metrics')}>
      <thead>
        <tr>
          <th>{tt('finance.card.metrics')}</th>
          {cols.map(c => (
            <th key={c.id} className="r" title={c.id === 'forecast' ? tt('finance.metric.forecastHint') : undefined}>
              {tt(`finance.metric.${c.id}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key}>
            <td className="muted">{tt(`finance.metric.${r.key}`)}</td>
            {cols.map(c => (
              <td key={c.id} className={`r num ${r.key === 'npv' && Number(c.m.npv) < 0 ? 'inv-neg' : ''}`}>
                {r.money ? amount(c.m[r.key]) : num(c.m[r.key], r.never)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
