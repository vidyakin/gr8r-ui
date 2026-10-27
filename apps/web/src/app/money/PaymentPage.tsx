/* Документ оплаты: ПКО, РКО, поступление на счёт, списание со счёта и авансовый отчёт.
   Шапка над таблицей (как в 1С), расшифровка суммы — табличная часть, комментарий — внизу. */
import * as React from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { operationNeedsAccountable, operationNeedsCounterparty, operationSettlement, operationsOfType, PAYABLE_TYPES, type PaymentDocType, type PaymentOperation } from '@gr8r/shared';
import { Alert, Badge, Button, ConfirmDialog, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, tProductionEnum, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useWorkspace } from '../data/store';
import { useCanWrite } from '../meta/custom-fields';
import { useCostItems, useDocuments, useOrganizations, typeLabel } from '../docs/data';
import { CounterpartyPicker } from '../docs/pickers';
import { useBankAccounts } from '../docs/data';
import { useCashFlowItems, useCashRegisters, usePayment, usePaymentApi, usePrintOpener, type PaymentBody } from './data';

interface Line {
  id: string;
  settlementDocumentId: string | null;
  counterpartyId: string | null;
  counterpartyName: string;
  amount: string;
  cashFlowItemId: string;
  costItemId: string | null;
  comment: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const newLine = (): Line => ({ id: crypto.randomUUID(), settlementDocumentId: null, counterpartyId: null, counterpartyName: '', amount: '', cashFlowItemId: '', costItemId: null, comment: '' });
const KO: Record<string, 'ko1' | 'ko2'> = { cash_receipt: 'ko1', cash_payment: 'ko2' };

export function PaymentPage() {
  const tt = useT();
  const { id } = useParams();
  const [sp] = useSearchParams();
  const isNew = !id || id === 'new';
  const type = (isNew ? (sp.get('type') ?? 'bank_receipt') : '') as string;
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const api = usePaymentApi();
  const openPrint = usePrintOpener();
  const doc = usePayment(isNew ? undefined : id);
  const detail = isNew ? null : doc.data;
  const docType = detail?.type ?? type;
  const isAdvance = docType === 'advance_report';
  const isBank = docType === 'bank_receipt' || docType === 'bank_payment';
  const incoming = docType === 'cash_receipt' || docType === 'bank_receipt';
  const operations = isAdvance ? [] : operationsOfType(docType as PaymentDocType);

  const orgs = useOrganizations();
  const registers = useCashRegisters();
  const items = useCashFlowItems();
  const costItems = useCostItems('expense');
  const members = useWorkspace().data.members;

  const [operation, setOperation] = React.useState<string>(isAdvance ? '' : (operations[0] ?? ''));
  const [organizationId, setOrganizationId] = React.useState('');
  const [date, setDate] = React.useState(today());
  const [cashRegisterId, setCashRegisterId] = React.useState('');
  const [bankAccountId, setBankAccountId] = React.useState('');
  const [targetKey, setTargetKey] = React.useState(''); // "cash:<id>" | "bank:<id>"
  const [counterpartyId, setCounterpartyId] = React.useState('');
  const [counterpartyName, setCounterpartyName] = React.useState('');
  const [memberId, setMemberId] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [lines, setLines] = React.useState<Line[]>([newLine()]);
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!isNew || organizationId || !orgs.data?.length) return;
    setOrganizationId((orgs.data.find(o => o.isDefault) ?? orgs.data[0]!).id);
  }, [isNew, organizationId, orgs.data]);

  React.useEffect(() => {
    if (!detail || loadedFor.current === detail.id + detail.status) return;
    loadedFor.current = detail.id + detail.status;
    setOperation(detail.operation ?? '');
    setOrganizationId(detail.organizationId);
    setDate(detail.date);
    setCashRegisterId(detail.cashRegisterId ?? '');
    setBankAccountId(detail.bankAccountId ?? '');
    setTargetKey(detail.targetCashRegisterId ? `cash:${detail.targetCashRegisterId}` : detail.targetBankAccountId ? `bank:${detail.targetBankAccountId}` : '');
    setCounterpartyId(detail.counterpartyId ?? '');
    setCounterpartyName(detail.counterparty?.name ?? '');
    setMemberId(detail.accountableMemberId ?? '');
    setComment(detail.comment);
    setLines(detail.lines.length ? detail.lines.map(l => ({ id: l.id, settlementDocumentId: l.settlementDocumentId, counterpartyId: l.counterpartyId, counterpartyName: l.counterpartyName ?? '', amount: l.amount, cashFlowItemId: l.cashFlowItemId, costItemId: l.costItemId, comment: l.comment })) : [newLine()]);
  }, [detail]);

  const editable = canWrite && (!detail || detail.status === 'draft');
  const orgBanks = useBankAccounts('organizations', organizationId || undefined);
  const orgRegisters = (registers.data ?? []).filter(r => !r.archivedAt && r.organizationId === organizationId);
  // по умолчанию — первая касса или счёт организации
  React.useEffect(() => {
    if (!isNew) return;
    if (!isBank && !cashRegisterId && orgRegisters[0]) setCashRegisterId(orgRegisters[0].id);
    if (isBank && !bankAccountId && orgBanks.data?.[0]) setBankAccountId(orgBanks.data[0].id);
  }, [isNew, isBank, cashRegisterId, bankAccountId, orgRegisters, orgBanks.data]);

  const needsCp = !isAdvance && operationNeedsCounterparty(operation);
  const needsMember = isAdvance || operationNeedsAccountable(operation);
  const settle = operationSettlement(operation);
  const isTransfer = operation === 'money_transfer';
  const flowItems = (items.data ?? []).filter(i => !i.archivedAt && i.kind === (isAdvance || !incoming ? 'expense' : 'income') && !['opening_balance', 'transfer_in', 'transfer_out', 'accountable_in', 'accountable_out'].includes(i.systemKey ?? ''));
  const sysItem = (key: string) => (items.data ?? []).find(i => i.systemKey === key)?.id ?? '';
  const defaultItem = (op: string) => ({ from_customer: sysItem('customers_payment'), to_supplier: sysItem('suppliers_payment'), supplier_refund: sysItem('refund_in'), customer_refund: sysItem('refund_out'), to_accountable: sysItem('accountable_out'), from_accountable: sysItem('accountable_in'), money_transfer: sysItem('transfer_out') })[op as 'from_customer'] ?? '';

  // документы расчётов контрагента для выбора в строке
  const settlementDocs = useDocuments({ counterpartyId: counterpartyId || undefined });
  const docOptions = (settlementDocs.data?.items ?? []).filter(d => (PAYABLE_TYPES as string[]).includes(d.type) && d.status !== 'cancelled');

  const body = (): PaymentBody => ({
    ...(isNew ? { type } : {}),
    operation: isAdvance ? undefined : operation,
    organizationId,
    date,
    cashRegisterId: isBank || isAdvance ? null : cashRegisterId || null,
    bankAccountId: isBank ? bankAccountId || null : null,
    targetCashRegisterId: isTransfer && targetKey.startsWith('cash:') ? targetKey.slice(5) : null,
    targetBankAccountId: isTransfer && targetKey.startsWith('bank:') ? targetKey.slice(5) : null,
    counterpartyId: needsCp ? counterpartyId || null : null,
    accountableMemberId: needsMember ? memberId || null : null,
    comment,
    lines: lines.map(l => ({
      id: l.id,
      settlementDocumentId: l.settlementDocumentId,
      counterpartyId: isAdvance ? l.counterpartyId : null,
      amount: l.amount || '0',
      cashFlowItemId: l.cashFlowItemId || defaultItem(isAdvance ? (l.counterpartyId ? 'to_supplier' : '') : operation) || flowItems[0]?.id || undefined,
      costItemId: l.costItemId,
      comment: l.comment,
    })),
  });

  const valid = lines.length > 0 && lines.every(l => Number(l.amount) > 0) && !!organizationId;
  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);

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
      if (!detail) await navigate(`/money/${saved.id}`, { replace: true });
    });
  const post = () =>
    run(async () => {
      if (!detail) return;
      await api.update(detail.id, body());
      await api.action(detail.id, 'post');
      toast(tt('money.common.posted'), { duration: 1500 });
    });

  if (!isNew && doc.isPending)
    return (
      <div className="page flush">
        <div className="ph">
          <Skeleton w={260} h={24} />
        </div>
      </div>
    );

  const title = detail?.number ?? tt('money.form.newTitle');
  const koForm = KO[docType];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{title}</h1>
          <p>{tt(`money.types.${docType as 'advance_report'}`)}</p>
        </div>
        <div className="acts">
          {detail && <Badge tone={detail.status === 'posted' ? 'green' : 'gray'} dot>{tProductionEnum('docStatus', detail.status, detail.status)}</Badge>}
          {editable && (
            <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>
              {detail ? tt('money.common.save') : tt('money.common.create')}
            </Button>
          )}
          {detail && detail.status === 'draft' && canWrite && (
            <Button disabled={busy || !valid} onClick={() => void post()}>
              {tt('money.common.post')}
            </Button>
          )}
          {detail && detail.status === 'posted' && canWrite && (
            <Button disabled={busy} onClick={() => void run(() => api.action(detail.id, 'unpost'))}>
              {tt('money.common.unpost')}
            </Button>
          )}
          {detail && koForm && (
            <Button variant="ghost" onClick={() => void openPrint(`/payments/${detail.id}/print/${koForm}`).catch(e => toast.error(errorMessage(e)))}>
              <Printer size={14} />
              {tt('money.common.print')}
            </Button>
          )}
          {detail && detail.status === 'draft' && canWrite && (
            <Button variant="ghost" onClick={() => setRemoving(true)}>
              {tt('money.common.delete')}
            </Button>
          )}
        </div>
      </div>

      {detail?.warnings.includes('negative_balance') && (
        <div style={{ padding: '0 var(--gutter) 8px' }}>
          <Alert tone="warn">
            {tt('money.form.negative')}
          </Alert>
        </div>
      )}

      <section className="panel doc-head" aria-label={tt('money.common.date')}>
        {!isAdvance && (
          <Field label={tt('money.form.operation')}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={operation}
                onValueChange={v => {
                  setOperation(v);
                  setLines(prev => prev.map(l => ({ ...l, settlementDocumentId: null, cashFlowItemId: '' })));
                }}
                options={operations.map(o => ({ value: o, label: tt(`money.operations.${o as PaymentOperation}`) }))}
                aria-label={tt('money.form.operation')}
              />
            )}
          </Field>
        )}
        <Field label={tt('money.common.date')}>{p => <Input {...p} type="date" disabled={!editable} value={date} onChange={e => setDate(e.target.value)} />}</Field>
        <Field label={tt('money.form.organization')}>
          {p => (
            <Select id={p.id} disabled={!editable || !!detail?.number} value={organizationId} onValueChange={setOrganizationId} options={(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))} aria-label={tt('money.form.organization')} />
          )}
        </Field>
        {!isAdvance && !isBank && (
          <Field label={tt('money.form.cashRegister')}>
            {p => <Select id={p.id} disabled={!editable} value={cashRegisterId} onValueChange={setCashRegisterId} options={orgRegisters.map(r => ({ value: r.id, label: r.name }))} aria-label={tt('money.form.cashRegister')} />}
          </Field>
        )}
        {isBank && (
          <Field label={tt('money.form.bankAccount')}>
            {p => <Select id={p.id} disabled={!editable} value={bankAccountId} onValueChange={setBankAccountId} options={(orgBanks.data ?? []).map(b => ({ value: b.id, label: `${b.bankName} · ${b.account}` }))} aria-label={tt('money.form.bankAccount')} />}
          </Field>
        )}
        {isTransfer && (
          <Field label={tt('money.form.targetAccount')} hint={tt('money.form.targetHint')}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={targetKey}
                onValueChange={setTargetKey}
                options={[
                  ...orgRegisters.filter(r => r.id !== cashRegisterId).map(r => ({ value: `cash:${r.id}`, label: r.name })),
                  ...(orgBanks.data ?? []).filter(b => b.id !== bankAccountId).map(b => ({ value: `bank:${b.id}`, label: `${b.bankName} · ${b.account}` })),
                ]}
                aria-label={tt('money.form.targetAccount')}
              />
            )}
          </Field>
        )}
        {needsCp && (
          <Field label={tt('money.form.counterparty')}>
            {p => (
              <CounterpartyPicker
                id={p.id}
                value={counterpartyName}
                disabled={!editable}
                onPick={c => {
                  setCounterpartyId(c.id);
                  setCounterpartyName(c.name);
                  setLines(prev => prev.map(l => ({ ...l, settlementDocumentId: null })));
                }}
              />
            )}
          </Field>
        )}
        {needsMember && (
          <Field label={tt('money.form.accountable')}>
            {p => <Select id={p.id} disabled={!editable} value={memberId} onValueChange={setMemberId} options={members.map(m => ({ value: m.id, label: m.name }))} aria-label={tt('money.form.accountable')} />}
          </Field>
        )}
        {detail?.basedOn && (
          <Field label={tt('money.form.basedOn')}>
            {() => (
              <Link to={`/documents/${detail.basedOn!.id}`} className="crm-link">
                {typeLabel(detail.basedOn!.type)} {detail.basedOn!.number ?? ''}
              </Link>
            )}
          </Field>
        )}
      </section>

      <section className="doc-lines panel" aria-label={tt('money.form.lines')}>
        <div className="table-wrap">
          <table className="dtbl" aria-label={tt('money.form.lines')}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                {isAdvance && <th style={{ width: 190 }}>{tt('money.form.supplier')}</th>}
                {(settle || isAdvance) && <th style={{ width: 260 }}>{tt('money.form.settlementDocument')}</th>}
                {!isTransfer && <th style={{ width: 200 }}>{tt('money.form.cashFlowItem')}</th>}
                {(isAdvance || operation === 'other_expense' || operation === 'other_income') && <th style={{ width: 180 }}>{tt('money.form.costItem')}</th>}
                <th style={{ width: 130 }} className="r">{tt('money.form.amount')}</th>
                <th>{tt('money.form.comment')}</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const set = (patch: Partial<Line>) => setLines(prev => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <tr key={l.id} data-row={i}>
                    <td className="faint num">{i + 1}</td>
                    {isAdvance && (
                      <td>
                        <CounterpartyPicker
                          value={l.counterpartyName}
                          disabled={!editable}
                          placeholder={tt('money.form.expenseLine')}
                          onPick={c => {
                            set({ counterpartyId: c.id, counterpartyName: c.name, settlementDocumentId: null });
                            setCounterpartyId(c.id);
                          }}
                        />
                      </td>
                    )}
                    {(settle || isAdvance) && (
                      <td>
                        <Select
                          aria-label={tt('money.form.settlementDocument')}
                          disabled={!editable || (!counterpartyId && !isAdvance)}
                          value={l.settlementDocumentId ?? ''}
                          onValueChange={v => {
                            const d = docOptions.find(x => x.id === v);
                            set({ settlementDocumentId: v || null, amount: l.amount || (d ? d.total : '') });
                          }}
                          options={[{ value: '', label: tt('money.form.settlementHint') }, ...docOptions.map(d => ({ value: d.id, label: `${typeLabel(d.type)} ${d.number ?? ''} · ${fmtAmount(d.total)}` }))]}
                        />
                      </td>
                    )}
                    {!isTransfer && (
                      <td>
                        <Select
                          aria-label={tt('money.form.cashFlowItem')}
                          disabled={!editable}
                          value={l.cashFlowItemId || defaultItem(isAdvance ? (l.counterpartyId ? 'to_supplier' : '') : operation) || ''}
                          onValueChange={v => set({ cashFlowItemId: v })}
                          options={[...flowItems, ...(items.data ?? []).filter(i => i.systemKey && !flowItems.some(f => f.id === i.id) && i.id === (l.cashFlowItemId || defaultItem(operation)))].map(c => ({ value: c.id, label: c.name }))}
                        />
                      </td>
                    )}
                    {(isAdvance || operation === 'other_expense' || operation === 'other_income') && (
                      <td>
                        <Select
                          aria-label={tt('money.form.costItem')}
                          disabled={!editable}
                          value={l.costItemId ?? ''}
                          onValueChange={v => set({ costItemId: v || null })}
                          options={[{ value: '', label: tt('money.form.none') }, ...(costItems.data ?? []).map(c => ({ value: c.id, label: c.name }))]}
                        />
                      </td>
                    )}
                    <td className="r">
                      <Input aria-label={tt('money.form.amount')} inputMode="decimal" disabled={!editable} value={l.amount} onChange={e => set({ amount: e.target.value })} />
                    </td>
                    <td>
                      <Input aria-label={tt('money.form.comment')} disabled={!editable} value={l.comment} onChange={e => set({ comment: e.target.value })} />
                    </td>
                    <td>
                      {editable && lines.length > 1 && (
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
            <Button size="sm" variant="ghost" onClick={() => setLines(prev => [...prev, newLine()])}>
              <Plus size={13} />
              {tt('money.common.add')}
            </Button>
          </div>
        )}
        <div className="doc-totals panel" style={{ border: 0 }}>
          <div className="trow grand">
            <span>{tt('money.common.total')}</span>
            <span className="num">{fmtAmount(total.toFixed(2))}</span>
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
            await navigate('/money', { replace: true });
          }}
          description=""
        />
      )}
    </div>
  );
}
