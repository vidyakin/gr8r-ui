/* Зарплата: журнал и документ «Начисление зарплаты», ведомости на выплату. Шапка сверху, таблица ниже,
   комментарий внизу (как в 1С). «Заполнить» строит строки по графику, нарядам и продажам периода. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleAlert, FilePlus2, Plus, Trash2, Wand2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useWorkspace } from '../data/store';
import { useCanWrite } from '../meta/custom-fields';
import { useIsAdmin } from '../catalog/data';
import { fmtDate } from '../lib/dates';
import { useOrganizations } from '../docs/data';
import { useCashRegisters, useOrgBankAccounts } from '../money/data';
import {
  usePayroll,
  usePayrollApi,
  usePayrollKinds,
  usePayrolls,
  useReflections,
  useStatement,
  useStatements,
  type BaseType,
  type PayoutMethod,
  type StatementKind,
} from './data';

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const monthOf = (period: string) => period.slice(0, 7);

function useMembersList() {
  const { data: ws } = useWorkspace();
  return ws.members.filter(m => m.status === 'active').map(m => ({ value: m.id, label: m.name }));
}

function useRun() {
  const [busy, setBusy] = React.useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function StatusBadge({ status }: { status: string }) {
  const tt = useT();
  return (
    <Badge tone={status === 'posted' ? 'green' : status === 'draft' ? 'gray' : 'neutral'} dot>
      {status === 'posted' ? tt('payroll.posted') : tt('payroll.draft')}
    </Badge>
  );
}

/* ---------------- начисление зарплаты ---------------- */

export function PayrollsPage() {
  const tt = useT();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const list = usePayrolls();
  const rows = list.data?.items ?? [];
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('payroll.accruals.title')}</h1>
          <p>{tt('payroll.accruals.subtitle')}</p>
        </div>
        <div className="acts">
          {isAdmin && (
            <Button variant="primary" onClick={() => void navigate('/payroll/new')}>
              <FilePlus2 size={14} />
              {tt('payroll.accruals.new')}
            </Button>
          )}
        </div>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('payroll.accruals.title')} action={<Button size="sm" onClick={() => list.refetch()}>{tt('payroll.retry')}</Button>}>
          {errorMessage(list.error)}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<FilePlus2 size={20} />} title={tt('payroll.accruals.empty')}>
          {tt('payroll.accruals.emptyHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('payroll.accruals.title')}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>{tt('payroll.number')}</th>
                <th style={{ width: 110 }}>{tt('payroll.date')}</th>
                <th style={{ width: 110 }}>{tt('payroll.period')}</th>
                <th style={{ width: 130 }}>{tt('payroll.status')}</th>
                <th>{tt('payroll.comment')}</th>
                <th style={{ width: 150 }} className="r">{tt('payroll.accrued')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="mono"><Link to={`/payroll/${r.id}`} className="crm-link">{r.number ?? tt('payroll.draft')}</Link></td>
                  <td className="muted">{fmtDate(r.date)}</td>
                  <td>{monthOf(r.period)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="muted">{r.comment}</td>
                  <td className="r num">{fmtAmount(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Line {
  id: string;
  memberId: string;
  kindId: string;
  baseType: BaseType | '';
  base: string;
  rate: string;
  workedDays: number;
  normDays: number;
  amount: string;
  ndfl: string;
  insurance: string;
  reflectionId: string;
  comment: string;
}
const newLine = (): Line => ({ id: crypto.randomUUID(), memberId: '', kindId: '', baseType: '', base: '0', rate: '0', workedDays: 0, normDays: 0, amount: '', ndfl: '', insurance: '', reflectionId: '', comment: '' });

export function PayrollPage() {
  const tt = useT();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const canWrite = useCanWrite();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const api = usePayrollApi();
  const q = usePayroll(isNew ? undefined : id);
  const detail = isNew ? null : q.data;
  const orgs = useOrganizations();
  const kinds = usePayrollKinds();
  const reflections = useReflections();
  const members = useMembersList();
  const { busy, run } = useRun();

  const [organizationId, setOrganizationId] = React.useState('');
  const [period, setPeriod] = React.useState(thisMonth());
  const [date, setDate] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [lines, setLines] = React.useState<Line[]>([]);
  const [removing, setRemoving] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!isNew || organizationId || !orgs.data?.length) return;
    setOrganizationId((orgs.data.find(o => o.isDefault) ?? orgs.data[0]!).id);
  }, [isNew, organizationId, orgs.data]);

  React.useEffect(() => {
    if (!detail) return;
    const stamp = `${detail.id}|${detail.status}|${detail.lines.length}|${detail.total}`;
    if (loadedFor.current === stamp) return;
    loadedFor.current = stamp;
    setOrganizationId(detail.organizationId);
    setPeriod(monthOf(detail.period));
    setDate(detail.date);
    setComment(detail.comment);
    setLines(detail.lines.map(l => ({ id: l.id, memberId: l.memberId, kindId: l.kindId, baseType: l.baseType, base: l.base, rate: l.rate, workedDays: l.workedDays, normDays: l.normDays, amount: l.amount, ndfl: l.ndfl, insurance: l.insurance, reflectionId: l.reflectionId ?? '', comment: l.comment })));
  }, [detail]);

  const editable = isAdmin && canWrite && (!detail || detail.status === 'draft');
  const kindOf = (kindId: string) => (kinds.data ?? []).find(k => k.id === kindId);
  const body = () => ({
    organizationId,
    period: `${period}-01`,
    ...(date ? { date } : {}),
    comment,
    lines: lines.map(l => ({ id: l.id, memberId: l.memberId, kindId: l.kindId, base: l.base || '0', rate: l.rate || '0', workedDays: l.workedDays, normDays: l.normDays, amount: l.amount || '0', ndfl: l.ndfl || undefined, insurance: l.insurance || undefined, reflectionId: l.reflectionId || null, comment: l.comment })),
  });
  const valid = !!organizationId && !!period && lines.length > 0 && lines.every(l => l.memberId && l.kindId && Number(l.amount) > 0);
  const num = (v: string) => Number(v || 0);
  const accrued = lines.filter(l => l.baseType !== 'deduction').reduce((s, l) => s + num(l.amount), 0);
  const withheld = lines.reduce((s, l) => s + (l.baseType === 'deduction' ? num(l.amount) : num(l.ndfl)), 0);

  const save = () =>
    run(async () => {
      const saved = detail ? await api.updatePayroll(detail.id, body() as never) : await api.savePayroll(body() as never);
      toast(tt('payroll.saved'), { duration: 1500 });
      if (!detail) await navigate(`/payroll/${saved.id}`, { replace: true });
    });
  const fill = () =>
    run(async () => {
      let target = detail?.id;
      if (detail) await api.updatePayroll(detail.id, body() as never);
      else {
        const saved = await api.savePayroll(body() as never);
        target = saved.id;
        await navigate(`/payroll/${saved.id}`, { replace: true });
      }
      await api.fillPayroll(target!);
    });
  const post = () =>
    run(async () => {
      if (!detail) return;
      await api.updatePayroll(detail.id, body() as never);
      await api.action(detail.id, 'post');
    });

  if (!isNew && q.isPending)
    return (
      <div className="page flush">
        <div className="ph">
          <Skeleton w={260} h={24} />
        </div>
      </div>
    );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{detail?.number ?? tt('payroll.accruals.newTitle')}</h1>
          <p>{tt('payroll.accruals.title')}</p>
        </div>
        <div className="acts">
          {detail && <StatusBadge status={detail.status} />}
          {editable && <Button disabled={busy || !organizationId || !period} onClick={() => void fill()}><Wand2 size={14} />{tt('payroll.fill')}</Button>}
          {editable && <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>{detail ? tt('payroll.save') : tt('payroll.create')}</Button>}
          {detail && detail.status === 'draft' && editable && <Button disabled={busy || !valid} onClick={() => void post()}>{tt('payroll.post')}</Button>}
          {detail && detail.status === 'posted' && isAdmin && <Button disabled={busy} onClick={() => void run(() => api.action(detail.id, 'unpost'))}>{tt('payroll.unpost')}</Button>}
          {detail && detail.status === 'draft' && editable && <Button variant="ghost" onClick={() => setRemoving(true)}>{tt('payroll.delete')}</Button>}
        </div>
      </div>

      <section className="panel doc-head" aria-label={tt('payroll.period')}>
        <Field label={tt('payroll.period')}>{p => <Input {...p} type="month" disabled={!editable} value={period} onChange={e => setPeriod(e.target.value)} />}</Field>
        <Field label={tt('payroll.date')}>{p => <Input {...p} type="date" disabled={!editable} value={date} onChange={e => setDate(e.target.value)} />}</Field>
        <Field label={tt('payroll.organization')}>
          {p => <Select id={p.id} disabled={!editable || !!detail?.number} value={organizationId} onValueChange={setOrganizationId} options={(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))} aria-label={tt('payroll.organization')} />}
        </Field>
      </section>

      <section className="doc-lines panel" aria-label={tt('payroll.lines')}>
        <div className="table-wrap">
          <table className="dtbl" aria-label={tt('payroll.lines')}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th style={{ width: 200 }}>{tt('payroll.employee')}</th>
                <th style={{ width: 170 }}>{tt('payroll.kind')}</th>
                <th style={{ width: 120 }} className="r">{tt('payroll.base')}</th>
                <th style={{ width: 90 }} className="r">{tt('payroll.rate')}</th>
                <th style={{ width: 90 }} className="r">{tt('payroll.days')}</th>
                <th style={{ width: 120 }} className="r">{tt('payroll.amount')}</th>
                <th style={{ width: 110 }} className="r">{tt('payroll.ndfl')}</th>
                <th style={{ width: 110 }} className="r">{tt('payroll.insurance')}</th>
                <th style={{ width: 180 }}>{tt('payroll.reflection')}</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const set = (patch: Partial<Line>) => setLines(prev => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <tr key={l.id}>
                    <td className="faint num">{i + 1}</td>
                    <td><Select aria-label={tt('payroll.employee')} disabled={!editable} value={l.memberId} onValueChange={v => set({ memberId: v })} options={members} /></td>
                    <td>
                      <Select
                        aria-label={tt('payroll.kind')}
                        disabled={!editable}
                        value={l.kindId}
                        onValueChange={v => set({ kindId: v, baseType: kindOf(v)?.baseType ?? '', ...(kindOf(v)?.baseType === 'deduction' ? { ndfl: '0', insurance: '0' } : {}) })}
                        options={(kinds.data ?? []).map(k => ({ value: k.id, label: k.name }))}
                      />
                    </td>
                    <td className="r num">{fmtAmount(l.base)}</td>
                    <td className="r num">{Number(l.rate) ? l.rate : ''}</td>
                    <td className="r num">{l.normDays ? `${l.workedDays} / ${l.normDays}` : ''}</td>
                    <td className="r"><Input aria-label={tt('payroll.amount')} inputMode="decimal" disabled={!editable} value={l.amount} onChange={e => set({ amount: e.target.value, ndfl: '', insurance: '' })} /></td>
                    <td className="r num">{l.baseType === 'deduction' ? '' : fmtAmount(l.ndfl || 0)}</td>
                    <td className="r num">{l.baseType === 'deduction' ? '' : fmtAmount(l.insurance || 0)}</td>
                    <td>
                      <Select aria-label={tt('payroll.reflection')} disabled={!editable} value={l.reflectionId} onValueChange={v => set({ reflectionId: v })} options={[{ value: '', label: tt('payroll.noReflection') }, ...(reflections.data ?? []).map(r => ({ value: r.id, label: r.name }))]} />
                    </td>
                    <td>{editable && <IconButton label={tt('payroll.remove')} onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}><Trash2 size={14} /></IconButton>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', padding: '8px 12px' }}>
          {editable ? <Button size="sm" onClick={() => setLines(prev => [...prev, newLine()])}><Plus size={14} />{tt('payroll.addLine')}</Button> : <span />}
          <span className="muted">
            {tt('payroll.accrued')}: <b className="num">{fmtAmount(accrued)}</b> · {tt('payroll.withheld')}: <b className="num">{fmtAmount(withheld)}</b> · {tt('payroll.payable')}: <b className="num">{fmtAmount(accrued - withheld)}</b>
            {detail && isAdmin ? <> · {tt('payroll.insuranceTotal')}: <b className="num">{fmtAmount(detail.totals.insurance)}</b></> : null}
          </span>
        </div>
      </section>

      <section className="panel doc-head" aria-label={tt('payroll.comment')}>
        <Field label={tt('payroll.comment')}>{p => <Input {...p} disabled={!editable} value={comment} onChange={e => setComment(e.target.value)} />}</Field>
      </section>

      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={tt('payroll.deleteTitle')} confirmLabel={tt('payroll.delete')} onConfirm={() => run(async () => { await api.remove(detail!.id); await navigate('/payroll'); })} />
    </div>
  );
}

/* ---------------- ведомость на выплату ---------------- */

export function StatementsPage() {
  const tt = useT();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const list = useStatements();
  const rows = list.data?.items ?? [];
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('payroll.statements.title')}</h1>
          <p>{tt('payroll.statements.subtitle')}</p>
        </div>
        <div className="acts">
          {isAdmin && (
            <Button variant="primary" onClick={() => void navigate('/payroll/statements/new')}>
              <FilePlus2 size={14} />
              {tt('payroll.statements.new')}
            </Button>
          )}
        </div>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('payroll.statements.title')}>{errorMessage(list.error)}</EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : !rows.length ? (
        <EmptyState icon={<FilePlus2 size={20} />} title={tt('payroll.statements.empty')}>{tt('payroll.statements.emptyHint')}</EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('payroll.statements.title')}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>{tt('payroll.number')}</th>
                <th style={{ width: 110 }}>{tt('payroll.date')}</th>
                <th style={{ width: 110 }}>{tt('payroll.period')}</th>
                <th style={{ width: 120 }}>{tt('payroll.statements.kind')}</th>
                <th style={{ width: 110 }}>{tt('payroll.statements.method')}</th>
                <th style={{ width: 130 }}>{tt('payroll.status')}</th>
                <th style={{ width: 150 }} className="r">{tt('payroll.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="mono"><Link to={`/payroll/statements/${r.id}`} className="crm-link">{r.number ?? tt('payroll.draft')}</Link></td>
                  <td className="muted">{fmtDate(r.date)}</td>
                  <td>{monthOf(r.period)}</td>
                  <td>{tt(`payroll.statements.kinds.${r.kind}`)}</td>
                  <td>{tt(`payroll.statements.methods.${r.method}`)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="r num">{fmtAmount(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface SLine {
  id: string;
  memberId: string;
  amount: string;
  paid: string;
  comment: string;
}

export function StatementPage() {
  const tt = useT();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const canWrite = useCanWrite();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const api = usePayrollApi();
  const q = useStatement(isNew ? undefined : id);
  const detail = isNew ? null : q.data;
  const orgs = useOrganizations();
  const registers = useCashRegisters();
  const members = useMembersList();
  const { busy, run } = useRun();

  const [organizationId, setOrganizationId] = React.useState('');
  const [period, setPeriod] = React.useState(thisMonth());
  const [kind, setKind] = React.useState<StatementKind>('settlement');
  const [method, setMethod] = React.useState<PayoutMethod>('cash');
  const [date, setDate] = React.useState(today());
  const [comment, setComment] = React.useState('');
  const [lines, setLines] = React.useState<SLine[]>([]);
  const [accountId, setAccountId] = React.useState('');
  const [removing, setRemoving] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);
  const banks = useOrgBankAccounts(organizationId || undefined);

  React.useEffect(() => {
    if (!isNew || organizationId || !orgs.data?.length) return;
    setOrganizationId((orgs.data.find(o => o.isDefault) ?? orgs.data[0]!).id);
  }, [isNew, organizationId, orgs.data]);

  React.useEffect(() => {
    if (!detail) return;
    const stamp = `${detail.id}|${detail.status}|${detail.lines.length}|${detail.total}|${detail.paidTotal}`;
    if (loadedFor.current === stamp) return;
    loadedFor.current = stamp;
    setOrganizationId(detail.organizationId);
    setPeriod(monthOf(detail.period));
    setKind(detail.kind);
    setMethod(detail.method);
    setDate(detail.date);
    setComment(detail.comment);
    setLines(detail.lines.map(l => ({ id: l.id, memberId: l.memberId, amount: l.amount, paid: l.paid, comment: l.comment })));
  }, [detail]);

  const editable = isAdmin && canWrite && (!detail || detail.status === 'draft');
  const body = () => ({ organizationId, period: `${period}-01`, kind, method, date, comment, lines: lines.map(l => ({ id: l.id, memberId: l.memberId, amount: l.amount || '0', comment: l.comment })) });
  const valid = !!organizationId && !!period && lines.length > 0 && lines.every(l => l.memberId && Number(l.amount) > 0);
  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const ownRegisters = (registers.data ?? []).filter(r => !r.archivedAt && r.organizationId === organizationId);

  const save = () =>
    run(async () => {
      const saved = detail ? await api.updateStatement(detail.id, body() as never) : await api.saveStatement(body() as never);
      toast(tt('payroll.saved'), { duration: 1500 });
      if (!detail) await navigate(`/payroll/statements/${saved.id}`, { replace: true });
    });
  const fill = () =>
    run(async () => {
      let target = detail?.id;
      if (detail) await api.updateStatement(detail.id, { organizationId, period: `${period}-01`, kind, method, date, comment } as never);
      else {
        const saved = await api.saveStatement({ organizationId, period: `${period}-01`, kind, method, date, comment });
        target = saved.id;
        await navigate(`/payroll/statements/${saved.id}`, { replace: true });
      }
      await api.fillStatement(target!);
    });
  const post = () =>
    run(async () => {
      if (!detail) return;
      await api.updateStatement(detail.id, body() as never);
      await api.action(detail.id, 'post');
    });
  const pay = () =>
    run(async () => {
      if (!detail) return;
      const r = await api.pay(detail.id, method === 'cash' ? { cashRegisterId: accountId || null } : { bankAccountId: accountId || null });
      await navigate(`/money/${r.paymentId}`);
    });

  if (!isNew && q.isPending)
    return (
      <div className="page flush">
        <div className="ph"><Skeleton w={260} h={24} /></div>
      </div>
    );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{detail?.number ?? tt('payroll.statements.newTitle')}</h1>
          <p>{tt('payroll.statements.title')}</p>
        </div>
        <div className="acts">
          {detail && <StatusBadge status={detail.status} />}
          {detail && detail.status === 'posted' && <Badge tone={detail.payState === 'paid' ? 'green' : detail.payState === 'partial' ? 'amber' : 'gray'} dot>{tt(`payroll.statements.payStates.${detail.payState}`)}</Badge>}
          {detail && detail.status === 'posted' && <Button disabled={busy} onClick={() => void run(() => api.openPrint(`/payroll/statements/${detail.id}/print`))}>{tt('payroll.print')}</Button>}
          {editable && <Button disabled={busy || !organizationId || !period} onClick={() => void fill()}><Wand2 size={14} />{tt('payroll.fill')}</Button>}
          {editable && <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>{detail ? tt('payroll.save') : tt('payroll.create')}</Button>}
          {detail && detail.status === 'draft' && editable && <Button disabled={busy || !valid} onClick={() => void post()}>{tt('payroll.post')}</Button>}
          {detail && detail.status === 'posted' && isAdmin && <Button disabled={busy} onClick={() => void run(() => api.action(detail.id, 'unpost'))}>{tt('payroll.unpost')}</Button>}
          {detail && detail.status === 'draft' && editable && <Button variant="ghost" onClick={() => setRemoving(true)}>{tt('payroll.delete')}</Button>}
        </div>
      </div>

      <section className="panel doc-head" aria-label={tt('payroll.period')}>
        <Field label={tt('payroll.period')}>{p => <Input {...p} type="month" disabled={!editable} value={period} onChange={e => setPeriod(e.target.value)} />}</Field>
        <Field label={tt('payroll.date')}>{p => <Input {...p} type="date" disabled={!editable} value={date} onChange={e => setDate(e.target.value)} />}</Field>
        <Field label={tt('payroll.statements.kind')}>
          {p => <Select id={p.id} disabled={!editable} value={kind} onValueChange={v => setKind(v as StatementKind)} options={(['advance', 'settlement'] as const).map(k => ({ value: k, label: tt(`payroll.statements.kinds.${k}`) }))} aria-label={tt('payroll.statements.kind')} />}
        </Field>
        <Field label={tt('payroll.statements.method')}>
          {p => <Select id={p.id} disabled={!editable} value={method} onValueChange={v => { setMethod(v as PayoutMethod); setAccountId(''); }} options={(['cash', 'bank'] as const).map(k => ({ value: k, label: tt(`payroll.statements.methods.${k}`) }))} aria-label={tt('payroll.statements.method')} />}
        </Field>
        <Field label={tt('payroll.organization')}>
          {p => <Select id={p.id} disabled={!editable || !!detail?.number} value={organizationId} onValueChange={setOrganizationId} options={(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))} aria-label={tt('payroll.organization')} />}
        </Field>
      </section>

      <section className="doc-lines panel" aria-label={tt('payroll.lines')}>
        <div className="table-wrap">
          <table className="dtbl" aria-label={tt('payroll.lines')}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th>{tt('payroll.employee')}</th>
                <th style={{ width: 150 }} className="r">{tt('payroll.amount')}</th>
                {detail?.status === 'posted' && <th style={{ width: 150 }} className="r">{tt('payroll.statements.paid')}</th>}
                <th>{tt('payroll.comment')}</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const set = (patch: Partial<SLine>) => setLines(prev => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <tr key={l.id}>
                    <td className="faint num">{i + 1}</td>
                    <td><Select aria-label={tt('payroll.employee')} disabled={!editable} value={l.memberId} onValueChange={v => set({ memberId: v })} options={members} /></td>
                    <td className="r"><Input aria-label={tt('payroll.amount')} inputMode="decimal" disabled={!editable} value={l.amount} onChange={e => set({ amount: e.target.value })} /></td>
                    {detail?.status === 'posted' && <td className="r num">{fmtAmount(l.paid)}</td>}
                    <td><Input aria-label={tt('payroll.comment')} disabled={!editable} value={l.comment} onChange={e => set({ comment: e.target.value })} /></td>
                    <td>{editable && <IconButton label={tt('payroll.remove')} onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}><Trash2 size={14} /></IconButton>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', padding: '8px 12px' }}>
          {editable ? <Button size="sm" onClick={() => setLines(prev => [...prev, { id: crypto.randomUUID(), memberId: '', amount: '', paid: '0', comment: '' }])}><Plus size={14} />{tt('payroll.addLine')}</Button> : <span />}
          <span className="muted">
            {tt('payroll.amount')}: <b className="num">{fmtAmount(total)}</b>
            {detail?.status === 'posted' ? <> · {tt('payroll.statements.paid')}: <b className="num">{fmtAmount(detail.paidTotal)}</b> · {tt('payroll.statements.remaining')}: <b className="num">{fmtAmount(detail.remaining)}</b></> : null}
          </span>
        </div>
      </section>

      {detail && detail.status === 'posted' && isAdmin && (
        <section className="panel doc-head" aria-label={tt('payroll.statements.payment')}>
          <Field label={method === 'cash' ? tt('payroll.statements.cashRegister') : tt('payroll.statements.bankAccount')}>
            {p => (
              <Select
                id={p.id}
                value={accountId}
                onValueChange={setAccountId}
                aria-label={tt('payroll.statements.payment')}
                options={[{ value: '', label: tt('payroll.statements.defaultAccount') }, ...(method === 'cash' ? ownRegisters.map(r => ({ value: r.id, label: r.name })) : (banks.data ?? []).map(b => ({ value: b.id, label: `${b.bankName} · ${b.account}` })))]}
              />
            )}
          </Field>
          <div className="acts">
            <Button variant="primary" disabled={busy || detail.payState === 'paid'} onClick={() => void pay()}>{method === 'cash' ? tt('payroll.statements.payCash') : tt('payroll.statements.payBank')}</Button>
            {method === 'bank' && <Button disabled={busy} onClick={() => void run(() => api.downloadRegistry(detail.id))}>{tt('payroll.statements.registry')}</Button>}
          </div>
          {detail.payments.length > 0 && (
            <div className="muted">
              {tt('payroll.statements.payments')}:{' '}
              {detail.payments.map(p => (
                <Link key={p.id} to={`/money/${p.id}`} className="crm-link" style={{ marginRight: 8 }}>{p.number ?? tt('payroll.draft')} · {fmtAmount(p.total)}</Link>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="panel doc-head" aria-label={tt('payroll.comment')}>
        <Field label={tt('payroll.comment')}>{p => <Input {...p} disabled={!editable} value={comment} onChange={e => setComment(e.target.value)} />}</Field>
      </section>

      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={tt('payroll.deleteTitle')} confirmLabel={tt('payroll.delete')} onConfirm={() => run(async () => { await api.remove(detail!.id); await navigate('/payroll/statements'); })} />
    </div>
  );
}
