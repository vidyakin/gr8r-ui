/* Зарплата: сотрудники (кадровые данные и плановые начисления), справочники (способы отражения, виды, взносы),
   отчёты «Расчёты с персоналом» и свод начислений, расчётный листок. Суммы видят admin и owner; листок — каждый свой. */
import * as React from 'react';
import { CircleAlert, Plus, Trash2, Users } from 'lucide-react';
import { Badge, Button, EmptyState, Field, IconButton, Input, Select, Skeleton, Tab, Tabs, TabsList, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useIsAdmin } from '../catalog/data';
import { useOrganizations, useCostItems } from '../docs/data';
import { useWorkCenters } from '../catalog/data';
import { fmtDate } from '../lib/dates';
import { useEmployees, usePayrollApi, usePayrollKinds, usePayrollSettings, usePayslip, useReflections, useSettlementsReport, useSummaryReport, type Employee } from './data';

const today = () => new Date().toISOString().slice(0, 10);

function guard(tt: ReturnType<typeof useT>, isAdmin: boolean) {
  return isAdmin ? null : (
    <div className="page flush">
      <EmptyState icon={<CircleAlert size={20} />} title={tt('payroll.adminOnly')}>{tt('payroll.adminOnlyHint')}</EmptyState>
    </div>
  );
}

async function guarded(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/* ---------------- сотрудники ---------------- */

function EmployeeCard({ e }: { e: Employee }) {
  const tt = useT();
  const api = usePayrollApi();
  const kinds = usePayrollKinds();
  const reflections = useReflections();
  const orgs = useOrganizations();
  const centers = useWorkCenters();
  const [draft, setDraft] = React.useState({
    hiredAt: e.hiredAt ?? '',
    firedAt: e.firedAt ?? '',
    organizationId: e.organizationId ?? '',
    workCenterId: e.workCenterId ?? '',
    reflectionId: e.reflectionId ?? '',
    ndflRate: e.ndflRate,
    cardAccount: e.cardAccount,
    advanceAmount: e.advanceAmount ?? '',
    advancePercent: e.advancePercent ?? '',
  });
  const [acc, setAcc] = React.useState({ kindId: '', validFrom: today().slice(0, 8) + '01', value: '', basis: 'revenue' });
  const planned = (kinds.data ?? []).filter(k => ['salary', 'sales_percent', 'bonus'].includes(k.baseType));
  const accKind = planned.find(k => k.id === acc.kindId);
  const save = () =>
    guarded(async () => {
      await api.updateEmployee(e.memberId, {
        hiredAt: draft.hiredAt || null,
        firedAt: draft.firedAt || null,
        organizationId: draft.organizationId || null,
        workCenterId: draft.workCenterId || null,
        reflectionId: draft.reflectionId || null,
        ndflRate: draft.ndflRate || '13',
        cardAccount: draft.cardAccount,
        advanceAmount: draft.advanceAmount || null,
        advancePercent: draft.advancePercent || null,
      });
      toast(tt('payroll.saved'), { duration: 1500 });
    });
  const addAccrual = () =>
    guarded(async () => {
      await api.addAccrual({ memberId: e.memberId, kindId: acc.kindId, validFrom: acc.validFrom, ...(accKind?.baseType === 'sales_percent' ? { percent: acc.value, percentBasis: acc.basis } : { amount: acc.value }) });
      setAcc(a => ({ ...a, value: '' }));
    });
  return (
    <section className="panel" style={{ margin: '0 var(--gutter) 16px', padding: 12 }} aria-label={e.name}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{e.name} {!e.configured && <Badge tone="gray">{tt('payroll.employees.notConfigured')}</Badge>}</h3>
        <Button size="sm" variant="primary" onClick={() => void save()}>{tt('payroll.save')}</Button>
      </div>
      <div className="doc-head">
        <Field label={tt('payroll.employees.hired')}>{p => <Input {...p} type="date" value={draft.hiredAt} onChange={ev => setDraft({ ...draft, hiredAt: ev.target.value })} />}</Field>
        <Field label={tt('payroll.employees.fired')}>{p => <Input {...p} type="date" value={draft.firedAt} onChange={ev => setDraft({ ...draft, firedAt: ev.target.value })} />}</Field>
        <Field label={tt('payroll.organization')}>
          {p => <Select id={p.id} value={draft.organizationId} onValueChange={v => setDraft({ ...draft, organizationId: v })} aria-label={tt('payroll.organization')} options={[{ value: '', label: '—' }, ...(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))]} />}
        </Field>
        <Field label={tt('payroll.employees.workCenter')}>
          {p => <Select id={p.id} value={draft.workCenterId} onValueChange={v => setDraft({ ...draft, workCenterId: v })} aria-label={tt('payroll.employees.workCenter')} options={[{ value: '', label: '—' }, ...(centers.data?.items ?? []).map(c => ({ value: c.id, label: c.name }))]} />}
        </Field>
        <Field label={tt('payroll.reflection')}>
          {p => <Select id={p.id} value={draft.reflectionId} onValueChange={v => setDraft({ ...draft, reflectionId: v })} aria-label={tt('payroll.reflection')} options={[{ value: '', label: '—' }, ...(reflections.data ?? []).map(r => ({ value: r.id, label: r.name }))]} />}
        </Field>
        <Field label={tt('payroll.employees.ndflRate')}>{p => <Input {...p} inputMode="decimal" value={draft.ndflRate} onChange={ev => setDraft({ ...draft, ndflRate: ev.target.value })} />}</Field>
        <Field label={tt('payroll.employees.card')}>{p => <Input {...p} value={draft.cardAccount} onChange={ev => setDraft({ ...draft, cardAccount: ev.target.value })} />}</Field>
        <Field label={tt('payroll.employees.advanceAmount')}>{p => <Input {...p} inputMode="decimal" value={draft.advanceAmount} onChange={ev => setDraft({ ...draft, advanceAmount: ev.target.value })} />}</Field>
        <Field label={tt('payroll.employees.advancePercent')}>{p => <Input {...p} inputMode="decimal" value={draft.advancePercent} onChange={ev => setDraft({ ...draft, advancePercent: ev.target.value })} />}</Field>
      </div>
      <table className="dtbl" aria-label={tt('payroll.employees.accruals')}>
        <thead>
          <tr>
            <th>{tt('payroll.kind')}</th>
            <th style={{ width: 130 }}>{tt('payroll.employees.validFrom')}</th>
            <th style={{ width: 150 }} className="r">{tt('payroll.employees.value')}</th>
            <th style={{ width: 36 }} />
          </tr>
        </thead>
        <tbody>
          {e.accruals.map(a => (
            <tr key={a.id}>
              <td>{a.kindName}{a.baseType === 'sales_percent' ? ` (${tt(`payroll.employees.bases.${a.percentBasis === 'margin' ? 'margin' : 'revenue'}`)})` : ''}</td>
              <td className="muted">{fmtDate(a.validFrom)}</td>
              <td className="r num">{a.baseType === 'sales_percent' ? `${a.percent} %` : fmtAmount(a.amount)}</td>
              <td><IconButton label={tt('payroll.remove')} onClick={() => void guarded(() => api.removeAccrual(a.id))}><Trash2 size={14} /></IconButton></td>
            </tr>
          ))}
          <tr>
            <td><Select aria-label={tt('payroll.kind')} value={acc.kindId} onValueChange={v => setAcc({ ...acc, kindId: v })} options={planned.map(k => ({ value: k.id, label: k.name }))} /></td>
            <td><Input aria-label={tt('payroll.employees.validFrom')} type="date" value={acc.validFrom} onChange={ev => setAcc({ ...acc, validFrom: ev.target.value })} /></td>
            <td className="r">
              <div className="row">
                {accKind?.baseType === 'sales_percent' && <Select aria-label={tt('payroll.employees.basis')} value={acc.basis} onValueChange={v => setAcc({ ...acc, basis: v })} options={[{ value: 'revenue', label: tt('payroll.employees.bases.revenue') }, { value: 'margin', label: tt('payroll.employees.bases.margin') }]} />}
                <Input aria-label={tt('payroll.employees.value')} inputMode="decimal" value={acc.value} onChange={ev => setAcc({ ...acc, value: ev.target.value })} />
              </div>
            </td>
            <td><IconButton label={tt('payroll.addLine')} disabled={!acc.kindId || !acc.value} onClick={() => void addAccrual()}><Plus size={14} /></IconButton></td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Dictionaries() {
  const tt = useT();
  const api = usePayrollApi();
  const reflections = useReflections();
  const kinds = usePayrollKinds();
  const settings = usePayrollSettings();
  const costItems = useCostItems('expense');
  const centers = useWorkCenters();
  const [rate, setRate] = React.useState<string | null>(null);
  const [refl, setRefl] = React.useState({ name: '', costItemId: '', workCenterId: '' });
  const [kind, setKind] = React.useState({ name: '', baseType: 'one_time' });
  return (
    <section className="panel" style={{ margin: '0 var(--gutter) 16px', padding: 12 }} aria-label={tt('payroll.employees.dictionaries')}>
      <h3 style={{ marginTop: 0 }}>{tt('payroll.employees.dictionaries')}</h3>
      <div className="doc-head">
        <Field label={tt('payroll.employees.insuranceRate')}>
          {p => <Input {...p} inputMode="decimal" value={rate ?? settings.data?.insuranceRate ?? ''} onChange={ev => setRate(ev.target.value)} onBlur={() => rate !== null && void guarded(async () => { await api.setInsuranceRate(rate); setRate(null); })} />}
        </Field>
      </div>
      <table className="dtbl" aria-label={tt('payroll.employees.reflections')}>
        <thead>
          <tr>
            <th>{tt('payroll.employees.reflections')}</th>
            <th>{tt('payroll.employees.costItem')}</th>
            <th>{tt('payroll.employees.workCenter')}</th>
            <th style={{ width: 36 }} />
          </tr>
        </thead>
        <tbody>
          {(reflections.data ?? []).map(r => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td className="muted">{r.costItemName}</td>
              <td className="muted">{r.workCenterName ?? '—'}</td>
              <td><IconButton label={tt('payroll.remove')} onClick={() => void guarded(() => api.removeReflection(r.id))}><Trash2 size={14} /></IconButton></td>
            </tr>
          ))}
          <tr>
            <td><Input aria-label={tt('payroll.employees.reflections')} value={refl.name} onChange={ev => setRefl({ ...refl, name: ev.target.value })} /></td>
            <td><Select aria-label={tt('payroll.employees.costItem')} value={refl.costItemId} onValueChange={v => setRefl({ ...refl, costItemId: v })} options={(costItems.data ?? []).map(c => ({ value: c.id, label: c.name }))} /></td>
            <td><Select aria-label={tt('payroll.employees.workCenter')} value={refl.workCenterId} onValueChange={v => setRefl({ ...refl, workCenterId: v })} options={[{ value: '', label: '—' }, ...(centers.data?.items ?? []).map(c => ({ value: c.id, label: c.name }))]} /></td>
            <td><IconButton label={tt('payroll.addLine')} disabled={!refl.name || !refl.costItemId} onClick={() => void guarded(async () => { await api.addReflection({ name: refl.name, costItemId: refl.costItemId, workCenterId: refl.workCenterId || null }); setRefl({ name: '', costItemId: '', workCenterId: '' }); })}><Plus size={14} /></IconButton></td>
          </tr>
        </tbody>
      </table>
      <table className="dtbl" aria-label={tt('payroll.employees.kinds')} style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>{tt('payroll.employees.kinds')}</th>
            <th>{tt('payroll.employees.baseType')}</th>
            <th style={{ width: 36 }} />
          </tr>
        </thead>
        <tbody>
          {(kinds.data ?? []).map(k => (
            <tr key={k.id}>
              <td>{k.name}</td>
              <td className="muted">{tt(`payroll.employees.baseTypes.${k.baseType}`)}</td>
              <td>{!k.systemKey && <IconButton label={tt('payroll.remove')} onClick={() => void guarded(() => api.removeKind(k.id))}><Trash2 size={14} /></IconButton>}</td>
            </tr>
          ))}
          <tr>
            <td><Input aria-label={tt('payroll.employees.kinds')} value={kind.name} onChange={ev => setKind({ ...kind, name: ev.target.value })} /></td>
            <td><Select aria-label={tt('payroll.employees.baseType')} value={kind.baseType} onValueChange={v => setKind({ ...kind, baseType: v })} options={(['bonus', 'one_time', 'deduction'] as const).map(b => ({ value: b, label: tt(`payroll.employees.baseTypes.${b}`) }))} /></td>
            <td><IconButton label={tt('payroll.addLine')} disabled={!kind.name} onClick={() => void guarded(async () => { await api.addKind({ name: kind.name, baseType: kind.baseType, insurable: kind.baseType !== 'deduction' }); setKind({ name: '', baseType: 'one_time' }); })}><Plus size={14} /></IconButton></td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export function EmployeesPage() {
  const tt = useT();
  const isAdmin = useIsAdmin();
  const q = useEmployees();
  const g = guard(tt, isAdmin);
  if (g) return g;
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('payroll.employees.title')}</h1>
          <p>{tt('payroll.employees.subtitle')}</p>
        </div>
      </div>
      {q.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('payroll.employees.title')}>{errorMessage(q.error)}</EmptyState>
      ) : q.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : !q.data.length ? (
        <EmptyState icon={<Users size={20} />} title={tt('payroll.employees.empty')} />
      ) : (
        <>
          <Dictionaries />
          {q.data.map(e => (
            <EmployeeCard key={e.memberId} e={e} />
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------- отчёты ---------------- */

const monthStart = () => today().slice(0, 8) + '01';

export function PayrollReportsPage() {
  const tt = useT();
  const isAdmin = useIsAdmin();
  const [tab, setTab] = React.useState<'settlements' | 'summary'>('settlements');
  const [from, setFrom] = React.useState(monthStart());
  const [to, setTo] = React.useState(today());
  const settlements = useSettlementsReport(from, to);
  const summary = useSummaryReport(from, to);
  const g = guard(tt, isAdmin);
  if (g) return g;
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('payroll.reports.title')}</h1>
          <p>{tt('payroll.reports.subtitle')}</p>
        </div>
      </div>
      <section className="panel doc-head" aria-label={tt('payroll.period')}>
        <Field label={tt('payroll.reports.from')}>{p => <Input {...p} type="date" value={from} onChange={e => setFrom(e.target.value)} />}</Field>
        <Field label={tt('payroll.reports.to')}>{p => <Input {...p} type="date" value={to} onChange={e => setTo(e.target.value)} />}</Field>
      </section>
      <div style={{ padding: '0 var(--gutter)' }}>
        <Tabs value={tab} onValueChange={v => setTab(v as 'settlements' | 'summary')}>
          <TabsList aria-label={tt('payroll.reports.title')}>
            <Tab value="settlements">{tt('payroll.reports.settlements')}</Tab>
            <Tab value="summary">{tt('payroll.reports.summary')}</Tab>
          </TabsList>
        </Tabs>
      </div>
      {tab === 'settlements' ? (
        <div className="table-wrap" style={{ padding: '8px var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('payroll.reports.settlements')}>
            <thead>
              <tr>
                <th>{tt('payroll.employee')}</th>
                <th className="r">{tt('payroll.reports.opening')}</th>
                <th className="r">{tt('payroll.accrued')}</th>
                <th className="r">{tt('payroll.withheld')}</th>
                <th className="r">{tt('payroll.reports.paid')}</th>
                <th className="r">{tt('payroll.reports.closing')}</th>
              </tr>
            </thead>
            <tbody>
              {(settlements.data?.items ?? []).map(r => (
                <tr key={r.memberId}>
                  <td>{r.memberName}</td>
                  <td className="r num">{fmtAmount(r.opening)}</td>
                  <td className="r num">{fmtAmount(r.accrued)}</td>
                  <td className="r num">{fmtAmount(r.withheld)}</td>
                  <td className="r num">{fmtAmount(r.paid)}</td>
                  <td className="r num"><b>{fmtAmount(r.closing)}</b></td>
                </tr>
              ))}
              {settlements.data && (
                <tr>
                  <td><b>{tt('payroll.reports.total')}</b></td>
                  <td className="r num">{fmtAmount(settlements.data.totals.opening)}</td>
                  <td className="r num">{fmtAmount(settlements.data.totals.accrued)}</td>
                  <td className="r num">{fmtAmount(settlements.data.totals.withheld)}</td>
                  <td className="r num">{fmtAmount(settlements.data.totals.paid)}</td>
                  <td className="r num"><b>{fmtAmount(settlements.data.totals.closing)}</b></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap" style={{ padding: '8px var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('payroll.reports.byKind')}>
            <thead>
              <tr>
                <th>{tt('payroll.kind')}</th>
                <th className="r">{tt('payroll.amount')}</th>
                <th className="r">{tt('payroll.ndfl')}</th>
                <th className="r">{tt('payroll.insurance')}</th>
              </tr>
            </thead>
            <tbody>
              {(summary.data?.byKind ?? []).map(r => (
                <tr key={r.kindId}>
                  <td>{r.kindName}</td>
                  <td className="r num">{fmtAmount(r.amount)}</td>
                  <td className="r num">{fmtAmount(r.ndfl)}</td>
                  <td className="r num">{fmtAmount(r.insurance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="dtbl" aria-label={tt('payroll.reports.byWorkCenter')} style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>{tt('payroll.reports.byWorkCenter')}</th>
                <th className="r">{tt('payroll.accrued')}</th>
                <th className="r">{tt('payroll.insurance')}</th>
              </tr>
            </thead>
            <tbody>
              {(summary.data?.byWorkCenter ?? []).map(r => (
                <tr key={r.workCenterId ?? 'none'}>
                  <td>{r.workCenterName || tt('payroll.reports.noWorkCenter')}</td>
                  <td className="r num">{fmtAmount(r.accrued)}</td>
                  <td className="r num">{fmtAmount(r.insurance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- расчётный листок ---------------- */

export function PayslipPage() {
  const tt = useT();
  const [period, setPeriod] = React.useState(today().slice(0, 7));
  const q = usePayslip(`${period}-01`);
  const d = q.data;
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('payroll.payslip.title')}</h1>
          <p>{tt('payroll.payslip.subtitle')}</p>
        </div>
      </div>
      <section className="panel doc-head" aria-label={tt('payroll.period')}>
        <Field label={tt('payroll.period')}>{p => <Input {...p} type="month" value={period} onChange={e => setPeriod(e.target.value)} />}</Field>
      </section>
      {q.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('payroll.payslip.title')}>{errorMessage(q.error)}</EmptyState>
      ) : q.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : !d || !d.items.length ? (
        <EmptyState icon={<Users size={20} />} title={tt('payroll.payslip.empty')} />
      ) : (
        <div className="table-wrap" style={{ padding: '8px var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('payroll.payslip.title')}>
            <thead>
              <tr>
                <th>{tt('payroll.kind')}</th>
                <th className="r">{tt('payroll.base')}</th>
                <th className="r">{tt('payroll.days')}</th>
                <th className="r">{tt('payroll.amount')}</th>
                <th className="r">{tt('payroll.ndfl')}</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((r, i) => (
                <tr key={i}>
                  <td>{r.kindName}</td>
                  <td className="r num">{Number(r.base) ? fmtAmount(r.base) : ''}</td>
                  <td className="r num">{r.normDays ? `${r.workedDays} / ${r.normDays}` : ''}</td>
                  <td className="r num">{r.deduction ? `−${fmtAmount(r.amount)}` : fmtAmount(r.amount)}</td>
                  <td className="r num">{r.deduction ? '' : fmtAmount(r.ndfl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 12 }}>
            {tt('payroll.accrued')}: <b className="num">{fmtAmount(d.totals.accrued)}</b> · {tt('payroll.withheld')}: <b className="num">{fmtAmount(Number(d.totals.ndfl) + Number(d.totals.deductions))}</b> · {tt('payroll.reports.paid')}: <b className="num">{fmtAmount(d.totals.paid)}</b> · {tt('payroll.payslip.debt')}: <b className="num">{fmtAmount(d.totals.debtAtEnd)}</b>
          </p>
        </div>
      )}
    </div>
  );
}
