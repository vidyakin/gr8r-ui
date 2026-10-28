/* Ввод начальных остатков: журнал и документ. Шапка сверху, таблицы во вкладках («Касса и банк», «Расчёты с контрагентами»),
   комментарий внизу (как в 1С). Проведение пишет остатки касс и счетов и взаиморасчёты; отмена проведения их убирает. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleAlert, FilePlus2, Plus, Printer, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Select, Skeleton, Tab, Tabs, TabsList, toast } from '@/components/ui';
import { PAYABLE_TYPES } from '@gr8r/shared';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useCanWrite } from '../meta/custom-fields';
import { useIsAdmin } from '../catalog/data';
import { fmtDate } from '../lib/dates';
import { typeLabel, useDocuments, useOrganizations } from '../docs/data';
import { useContracts } from '../docs/billing-data';
import { CounterpartyPicker } from '../docs/pickers';
import { useCashRegisters, useOrgBankAccounts } from './data';
import { useOpening, useOpeningApi, useOpenings, type OpeningKind } from './opening-data';

const today = () => new Date().toISOString().slice(0, 10);
const MONEY_KINDS: OpeningKind[] = ['cash', 'bank'];
const SETTLEMENT_KINDS: OpeningKind[] = ['customer_debt', 'customer_advance', 'supplier_debt', 'supplier_advance'];

export function OpeningsPage() {
  const tt = useT();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const list = useOpenings();
  const rows = list.data?.items ?? [];
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('money.opening.title')}</h1>
          <p>{tt('money.opening.subtitle')}</p>
        </div>
        <div className="acts">
          {isAdmin && (
            <Button variant="primary" onClick={() => void navigate('/money/opening/new')}>
              <FilePlus2 size={14} />
              {tt('money.opening.new')}
            </Button>
          )}
        </div>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('money.opening.title')} action={<Button size="sm" onClick={() => list.refetch()}>{tt('money.common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<FilePlus2 size={20} />} title={tt('money.opening.empty')}>
          {tt('money.opening.emptyHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('money.opening.table')}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>{tt('money.common.number')}</th>
                <th style={{ width: 110 }}>{tt('money.common.date')}</th>
                <th style={{ width: 130 }}>{tt('money.common.status')}</th>
                <th>{tt('money.opening.organization')}</th>
                <th>{tt('money.common.comment')}</th>
                <th style={{ width: 150 }} className="r">{tt('money.opening.moneyTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="mono"><Link to={`/money/opening/${r.id}`} className="crm-link">{r.number ?? tt('money.common.draft')}</Link></td>
                  <td className="muted">{fmtDate(r.date)}</td>
                  <td><Badge tone={r.status === 'posted' ? 'green' : r.status === 'draft' ? 'gray' : 'neutral'} dot>{r.status === 'posted' ? tt('money.common.posted') : tt('money.common.draft')}</Badge></td>
                  <td>{r.organizationName}</td>
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

/** Договор и документ расчётов строки: список договоров и документов выбранного контрагента (оба необязательны) */
function ContractSelect({ line, disabled, onChange }: { line: Line; disabled: boolean; onChange: (id: string) => void }) {
  const tt = useT();
  const contracts = useContracts({ companyId: line.counterpartyId || undefined });
  return (
    <Select
      aria-label={tt('money.opening.contract')}
      disabled={disabled || !line.counterpartyId}
      value={line.contractId}
      onValueChange={onChange}
      options={[{ value: '', label: tt('money.opening.noContract') }, ...(contracts.data?.items ?? []).map(c => ({ value: c.id, label: c.number }))]}
    />
  );
}

function SettlementDocumentSelect({ line, disabled, onChange }: { line: Line; disabled: boolean; onChange: (id: string) => void }) {
  const tt = useT();
  const docs = useDocuments({ counterpartyId: line.counterpartyId || undefined });
  const side = line.kind.startsWith('customer') ? 'customer' : 'supplier';
  const options = (docs.data?.items ?? []).filter(d => (PAYABLE_TYPES as string[]).includes(d.type) && d.status !== 'cancelled' && (d.type === 'receipt' || d.type === 'supplier_order' ? side === 'supplier' : side === 'customer'));
  const current = line.settlementDocumentLabel;
  return (
    <Select
      aria-label={tt('money.opening.document')}
      disabled={disabled || !line.counterpartyId}
      value={line.settlementDocumentId}
      onValueChange={onChange}
      options={[
        { value: '', label: tt('money.opening.noDocument') },
        ...(line.settlementDocumentId && current && !options.some(d => d.id === line.settlementDocumentId) ? [{ value: line.settlementDocumentId, label: current }] : []),
        ...options.map(d => ({ value: d.id, label: `${typeLabel(d.type)} ${d.number ?? ''} · ${fmtAmount(d.total)}` })),
      ]}
    />
  );
}

interface Line {
  id: string;
  kind: OpeningKind;
  contractId: string;
  settlementDocumentId: string;
  settlementDocumentLabel: string;
  accountId: string;
  counterpartyId: string;
  counterpartyName: string;
  amount: string;
  comment: string;
}
const newLine = (kind: OpeningKind): Line => ({ id: crypto.randomUUID(), kind, accountId: '', counterpartyId: '', counterpartyName: '', contractId: '', settlementDocumentId: '', settlementDocumentLabel: '', amount: '', comment: '' });

export function OpeningPage() {
  const tt = useT();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const canWrite = useCanWrite();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const api = useOpeningApi();
  const q = useOpening(isNew ? undefined : id);
  const detail = isNew ? null : q.data;
  const orgs = useOrganizations();
  const registers = useCashRegisters();

  const [organizationId, setOrganizationId] = React.useState('');
  const [date, setDate] = React.useState(today());
  const [comment, setComment] = React.useState('');
  const [lines, setLines] = React.useState<Line[]>([]);
  const [tab, setTab] = React.useState<'money' | 'settlements'>('money');
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);
  const banks = useOrgBankAccounts(organizationId || undefined);

  React.useEffect(() => {
    if (!isNew || organizationId || !orgs.data?.length) return;
    setOrganizationId((orgs.data.find(o => o.isDefault) ?? orgs.data[0]!).id);
  }, [isNew, organizationId, orgs.data]);

  React.useEffect(() => {
    if (!detail || loadedFor.current === detail.id + detail.status) return;
    loadedFor.current = detail.id + detail.status;
    setOrganizationId(detail.organizationId);
    setDate(detail.date);
    setComment(detail.comment);
    setLines(detail.lines.map(l => ({ id: l.id, kind: l.kind, accountId: l.cashRegisterId ?? l.bankAccountId ?? '', counterpartyId: l.counterpartyId ?? '', counterpartyName: l.counterpartyName ?? '', contractId: l.contractId ?? '', settlementDocumentId: l.settlementDocumentId ?? '', settlementDocumentLabel: l.settlementDocumentLabel ?? '', amount: l.amount, comment: l.comment })));
  }, [detail]);

  const editable = isAdmin && canWrite && (!detail || detail.status === 'draft');
  const ownRegisters = (registers.data ?? []).filter(r => !r.archivedAt && r.organizationId === organizationId);
  const body = () => ({
    organizationId,
    date,
    comment,
    lines: lines.map(l => ({
      id: l.id,
      kind: l.kind,
      cashRegisterId: l.kind === 'cash' ? l.accountId || null : null,
      bankAccountId: l.kind === 'bank' ? l.accountId || null : null,
      counterpartyId: MONEY_KINDS.includes(l.kind) ? null : l.counterpartyId || null,
      contractId: MONEY_KINDS.includes(l.kind) ? null : l.contractId || null,
      settlementDocumentId: MONEY_KINDS.includes(l.kind) ? null : l.settlementDocumentId || null,
      amount: l.amount || '0',
      comment: l.comment,
    })),
  });
  const valid = !!organizationId && lines.length > 0 && lines.every(l => Number(l.amount) > 0 && (MONEY_KINDS.includes(l.kind) ? !!l.accountId : !!l.counterpartyId));
  const moneyTotal = lines.filter(l => MONEY_KINDS.includes(l.kind)).reduce((s, l) => s + Number(l.amount || 0), 0);

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
  const save = () =>
    run(async () => {
      const saved = detail ? await api.update(detail.id, body()) : await api.save(body());
      toast(tt('money.common.saved'), { duration: 1500 });
      if (!detail) await navigate(`/money/opening/${saved.id}`, { replace: true });
    });
  const post = () =>
    run(async () => {
      if (!detail) return;
      await api.update(detail.id, body());
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

  const shown = lines.map((l, i) => ({ l, i })).filter(({ l }) => (tab === 'money' ? MONEY_KINDS : SETTLEMENT_KINDS).includes(l.kind));
  const kinds = tab === 'money' ? MONEY_KINDS : SETTLEMENT_KINDS;

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{detail?.number ?? tt('money.opening.newTitle')}</h1>
          <p>{tt('money.opening.title')}</p>
        </div>
        <div className="acts">
          {detail && <Badge tone={detail.status === 'posted' ? 'green' : 'gray'} dot>{detail.status === 'posted' ? tt('money.common.posted') : tt('money.common.draft')}</Badge>}
          {editable && (
            <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>
              {detail ? tt('money.common.save') : tt('money.common.create')}
            </Button>
          )}
          {detail && detail.status === 'draft' && editable && <Button disabled={busy || !valid} onClick={() => void post()}>{tt('money.common.post')}</Button>}
          {detail && detail.status === 'posted' && isAdmin && <Button disabled={busy} onClick={() => void run(() => api.action(detail.id, 'unpost'))}>{tt('money.common.unpost')}</Button>}
          {detail && (
            <Button variant="ghost" onClick={() => void navigate(`/documents/${detail.id}/print/opening_balance`)}>
              <Printer size={14} />
              {tt('money.common.print')}
            </Button>
          )}
          {detail && detail.status === 'draft' && editable && <Button variant="ghost" onClick={() => setRemoving(true)}>{tt('money.common.delete')}</Button>}
        </div>
      </div>

      <section className="panel doc-head" aria-label={tt('money.common.date')}>
        <Field label={tt('money.common.date')}>{p => <Input {...p} type="date" disabled={!editable} value={date} onChange={e => setDate(e.target.value)} />}</Field>
        <Field label={tt('money.form.organization')}>
          {p => <Select id={p.id} disabled={!editable || !!detail?.number} value={organizationId} onValueChange={v => { setOrganizationId(v); setLines(prev => prev.map(l => ({ ...l, accountId: MONEY_KINDS.includes(l.kind) ? '' : l.accountId }))); }} options={(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))} aria-label={tt('money.form.organization')} />}
        </Field>
      </section>

      <div style={{ padding: '0 var(--gutter)' }}>
        <Tabs value={tab} onValueChange={v => setTab(v as 'money' | 'settlements')}>
          <TabsList aria-label={tt('money.opening.title')}>
            <Tab value="money">{tt('money.opening.tabMoney')}</Tab>
            <Tab value="settlements">{tt('money.opening.tabSettlements')}</Tab>
          </TabsList>
        </Tabs>
      </div>

      <section className="doc-lines panel" aria-label={tab === 'money' ? tt('money.opening.linesMoney') : tt('money.opening.linesSettlements')}>
        <div className="table-wrap">
          <table className="dtbl" aria-label={tab === 'money' ? tt('money.opening.linesMoney') : tt('money.opening.linesSettlements')}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th style={{ width: 230 }}>{tt('money.opening.kind')}</th>
                <th>{tab === 'money' ? tt('money.opening.account') : tt('money.opening.counterparty')}</th>
                {tab === 'settlements' && <th style={{ width: 160 }}>{tt('money.opening.contract')}</th>}
                {tab === 'settlements' && <th style={{ width: 220 }}>{tt('money.opening.document')}</th>}
                <th style={{ width: 150 }} className="r">{tt('money.form.amount')}</th>
                <th>{tt('money.form.comment')}</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {shown.map(({ l, i }, n) => {
                const set = (patch: Partial<Line>) => setLines(prev => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <tr key={l.id}>
                    <td className="faint num">{n + 1}</td>
                    <td>
                      <Select aria-label={tt('money.opening.kind')} disabled={!editable} value={l.kind} onValueChange={v => set({ kind: v as OpeningKind, accountId: '', settlementDocumentId: '', settlementDocumentLabel: '' })} options={kinds.map(k => ({ value: k, label: tt(`money.opening.kinds.${k}`) }))} />
                    </td>
                    <td>
                      {tab === 'money' ? (
                        <Select
                          aria-label={tt('money.opening.account')}
                          disabled={!editable}
                          value={l.accountId}
                          onValueChange={v => set({ accountId: v })}
                          options={l.kind === 'cash' ? ownRegisters.map(r => ({ value: r.id, label: r.name })) : (banks.data ?? []).map(b => ({ value: b.id, label: `${b.bankName} · ${b.account}` }))}
                        />
                      ) : (
                        <CounterpartyPicker id={`opening-cp-${l.id}`} value={l.counterpartyName} disabled={!editable} onPick={c => set({ counterpartyId: c.id, counterpartyName: c.name, contractId: '', settlementDocumentId: '', settlementDocumentLabel: '' })} />
                      )}
                    </td>
                    {tab === 'settlements' && (
                      <td>
                        <ContractSelect line={l} disabled={!editable} onChange={v => set({ contractId: v })} />
                      </td>
                    )}
                    {tab === 'settlements' && (
                      <td>
                        <SettlementDocumentSelect line={l} disabled={!editable} onChange={v => set({ settlementDocumentId: v, settlementDocumentLabel: '' })} />
                      </td>
                    )}
                    <td className="r">
                      <Input aria-label={tt('money.form.amount')} inputMode="decimal" disabled={!editable} value={l.amount} onChange={e => set({ amount: e.target.value })} />
                    </td>
                    <td>
                      <Input aria-label={tt('money.form.comment')} disabled={!editable} value={l.comment} onChange={e => set({ comment: e.target.value })} />
                    </td>
                    <td>
                      {editable && (
                        <IconButton size="xs" label={tt('money.common.remove')} onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>
                          <Trash2 size={13} />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="doc-add">
            <Button size="sm" variant="ghost" onClick={() => setLines(prev => [...prev, newLine(kinds[0]!)])}>
              <Plus size={13} />
              {tt('money.common.add')}
            </Button>
          </div>
        )}
        {tab === 'settlements' && <p className="faint" style={{ padding: '4px 16px 8px', fontSize: 12 }}>{tt('money.opening.settlementHint')}</p>}
        <div className="doc-totals panel" style={{ border: 0 }}>
          <div className="trow grand">
            <span>{tt('money.opening.moneyTotal')}</span>
            <span className="num">{fmtAmount(moneyTotal.toFixed(2))}</span>
          </div>
        </div>
      </section>

      <section className="doc-comment panel" aria-label={tt('money.common.comment')}>
        <Field label={tt('money.common.comment')}>{p => <Input {...p} disabled={!editable} value={comment} onChange={e => setComment(e.target.value)} />}</Field>
      </section>

      {removing && detail && (
        <ConfirmDialog
          open
          danger
          title={tt('money.common.delete')}
          confirmLabel={tt('money.common.delete')}
          onOpenChange={open => !open && setRemoving(false)}
          onConfirm={async () => {
            setRemoving(false);
            await api.remove(detail.id);
            await navigate('/money/opening', { replace: true });
          }}
          description=""
        />
      )}
    </div>
  );
}
