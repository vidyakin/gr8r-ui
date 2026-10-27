/* Деньги: остатки, движение денег (ДДС), дебиторская и кредиторская задолженность, кассы и статьи ДДС */
import * as React from 'react';
import { Link } from 'react-router';
import { CircleAlert, Wallet } from 'lucide-react';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { useCanSeeAmounts as useCanManage } from '../finance/data';
import { typeLabel, useOrganizations } from '../docs/data';
import { useBalances, useCashFlowItems, useCashFlowReport, useCashRegisters, useDebtReport, useRefsApi } from './data';

const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

function Loading({ q }: { q: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown } }) {
  const tt = useT();
  if (q.isError)
    return (
      <EmptyState icon={<CircleAlert size={20} />} error title="" action={<Button size="sm" onClick={() => q.refetch()}>{tt('money.common.retry')}</Button>}>
        {(q.error as Error).message}
      </EmptyState>
    );
  return q.isPending ? (
    <div style={{ padding: 16 }}>
      <Skeleton w="100%" h={36} />
    </div>
  ) : null;
}

const Head = ({ title, lead, children }: { title: string; lead: string; children?: React.ReactNode }) => (
  <>
    <div className="ph">
      <div>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
    </div>
    <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px', alignItems: 'flex-end' }}>
      {children}
    </div>
  </>
);

/* ---------------- остатки ---------------- */

export function BalancesPage() {
  const tt = useT();
  const [asOf, setAsOf] = React.useState(today());
  const q = useBalances(asOf);
  const d = q.data;
  const table = (rows: { id: string; name: string; organizationName: string; balance: string }[]) => (
    <table className="dtbl">
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td>{r.name}</td>
            <td className="muted">{r.organizationName}</td>
            <td className="r num" style={{ color: Number(r.balance) < 0 ? 'var(--danger, #c0392b)' : undefined }}>{fmtAmount(r.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="page flush">
      <Head title={tt('money.balances.title')} lead={tt('money.balances.subtitle')}>
        <Field label={tt('money.common.asOf')}>{p => <Input {...p} type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />}</Field>
      </Head>
      <Loading q={q} />
      {d && !d.cash.length && !d.bank.length ? (
        <EmptyState icon={<Wallet size={20} />} title={tt('money.balances.noMoney')}>
          {tt('money.form.noAccount')}
        </EmptyState>
      ) : d ? (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px', display: 'grid', gap: 18 }}>
          <div className="row" style={{ gap: 24 }}>
            <Badge tone="gray">{tt('money.balances.totalCash')}: {fmtAmount(d.totals.cash)}</Badge>
            <Badge tone="gray">{tt('money.balances.totalBank')}: {fmtAmount(d.totals.bank)}</Badge>
            <Badge tone="green">{tt('money.balances.totalAll')}: {fmtAmount(d.totals.all)}</Badge>
          </div>
          <section>
            <h3>{tt('money.balances.cash')}</h3>
            {table(d.cash)}
          </section>
          <section>
            <h3>{tt('money.balances.bank')}</h3>
            {table(d.bank)}
          </section>
          {!!d.accountable.length && (
            <section>
              <h3>{tt('money.balances.accountable')}</h3>
              <p className="faint" style={{ fontSize: 12 }}>{tt('money.balances.accountableHint')}</p>
              <table className="dtbl">
                <tbody>
                  {d.accountable.map(a => (
                    <tr key={a.memberId}>
                      <td>{a.name}</td>
                      <td className="r num">{fmtAmount(a.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- ДДС ---------------- */

export function CashFlowPage() {
  const tt = useT();
  const [from, setFrom] = React.useState(yearStart());
  const [to, setTo] = React.useState(today());
  const [groupBy, setGroupBy] = React.useState('item');
  const q = useCashFlowReport({ from, to, groupBy });
  const d = q.data;
  return (
    <div className="page flush">
      <Head title={tt('money.cashFlow.title')} lead={tt('money.cashFlow.subtitle')}>
        <Field label={tt('money.common.from')}>{p => <Input {...p} type="date" value={from} onChange={e => setFrom(e.target.value)} />}</Field>
        <Field label={tt('money.common.to')}>{p => <Input {...p} type="date" value={to} onChange={e => setTo(e.target.value)} />}</Field>
        <Field label={tt('money.cashFlow.groupBy')}>
          {p => (
            <Select
              id={p.id}
              value={groupBy}
              onValueChange={setGroupBy}
              options={[
                { value: 'item', label: tt('money.cashFlow.item') },
                { value: 'account', label: tt('money.cashFlow.account') },
                { value: 'month', label: tt('money.cashFlow.month') },
              ]}
              aria-label={tt('money.cashFlow.groupBy')}
            />
          )}
        </Field>
      </Head>
      <Loading q={q} />
      {d && !d.rows.length ? (
        <EmptyState icon={<Wallet size={20} />} title={tt('money.cashFlow.empty')} />
      ) : d ? (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('money.cashFlow.title')}>
            <thead>
              <tr>
                <th>{groupBy === 'item' ? tt('money.cashFlow.item') : groupBy === 'month' ? tt('money.cashFlow.month') : tt('money.cashFlow.account')}</th>
                {groupBy === 'account' && <th className="r">{tt('money.cashFlow.opening')}</th>}
                <th className="r">{tt('money.cashFlow.income')}</th>
                <th className="r">{tt('money.cashFlow.expense')}</th>
                <th className="r">{tt('money.cashFlow.net')}</th>
                {groupBy === 'account' && <th className="r">{tt('money.cashFlow.closing')}</th>}
              </tr>
            </thead>
            <tbody>
              {d.rows.map(r => (
                <tr key={r.key}>
                  <td>{r.name}</td>
                  {groupBy === 'account' && <td className="r num">{fmtAmount(r.opening ?? '0')}</td>}
                  <td className="r num">{fmtAmount(r.income)}</td>
                  <td className="r num">{fmtAmount(r.expense)}</td>
                  <td className="r num">{fmtAmount(r.net)}</td>
                  {groupBy === 'account' && <td className="r num">{fmtAmount(r.closing ?? '0')}</td>}
                </tr>
              ))}
              <tr className="bold">
                <td>{tt('money.common.total')}</td>
                {groupBy === 'account' && <td />}
                <td className="r num">{fmtAmount(d.totals.income)}</td>
                <td className="r num">{fmtAmount(d.totals.expense)}</td>
                <td className="r num">{fmtAmount(d.totals.net)}</td>
                {groupBy === 'account' && <td />}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- задолженность ---------------- */

export function DebtsPage({ side }: { side: 'customer' | 'supplier' }) {
  const tt = useT();
  const [asOf, setAsOf] = React.useState(today());
  const q = useDebtReport(side, asOf);
  const d = q.data;
  const customer = side === 'customer';
  return (
    <div className="page flush">
      <Head title={customer ? tt('money.debts.receivables') : tt('money.debts.payables')} lead={customer ? tt('money.debts.receivablesSubtitle') : tt('money.debts.payablesSubtitle')}>
        <Field label={tt('money.common.asOf')}>{p => <Input {...p} type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />}</Field>
      </Head>
      <Loading q={q} />
      {d && !d.rows.length ? (
        <EmptyState icon={<Wallet size={20} />} title={tt('money.debts.empty')} />
      ) : d ? (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('money.debts.counterparty')}>
            <thead>
              <tr>
                <th>{tt('money.debts.counterparty')}</th>
                <th style={{ width: 130 }}>{tt('money.debts.mode')}</th>
                <th style={{ width: 130 }} className="r">{tt('money.debts.debt')}</th>
                <th style={{ width: 130 }} className="r">{tt('money.debts.overdue')}</th>
                <th style={{ width: 130 }} className="r">{tt('money.debts.advance')}</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map(r => (
                <React.Fragment key={r.companyId}>
                  <tr>
                    <td>
                      <Link to={`/crm/companies?open=${r.companyId}`} className="crm-link">{r.companyName}</Link>
                    </td>
                    <td className="muted">{tt(`money.settlementMode.${r.mode as 'by_documents'}`)}</td>
                    <td className="r num">{fmtAmount(r.debt)}</td>
                    <td className="r num" style={{ color: Number(r.overdue) > 0 ? 'var(--danger, #c0392b)' : undefined }}>{fmtAmount(r.overdue)}</td>
                    <td className="r num">{fmtAmount(r.advance)}</td>
                  </tr>
                  {r.docs.map(x => (
                    <tr key={x.documentId} className="faint">
                      <td style={{ paddingLeft: 28 }}>
                        <Link to={`/documents/${x.documentId}`} className="crm-link">{typeLabel(x.type)} {x.number ?? ''}</Link> · {fmtDate(x.date)}
                      </td>
                      <td>{x.dueDate ? `${tt('money.debts.due')}: ${fmtDate(x.dueDate)}` : ''}</td>
                      <td className="r num">{fmtAmount(x.amount)}</td>
                      <td className="r num">{x.overdueDays > 0 ? `${x.overdueDays}` : ''}</td>
                      <td />
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              <tr className="bold">
                <td colSpan={2}>{tt('money.common.total')}</td>
                <td className="r num">{fmtAmount(d.totals.debt)}</td>
                <td className="r num">{fmtAmount(d.totals.overdue)}</td>
                <td className="r num">{fmtAmount(d.totals.advance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- кассы и статьи ДДС ---------------- */

export function MoneyReferencesPage() {
  const tt = useT();
  const canManage = useCanManage();
  const registers = useCashRegisters();
  const items = useCashFlowItems();
  const orgs = useOrganizations();
  const api = useRefsApi();
  const [regName, setRegName] = React.useState('');
  const [itemName, setItemName] = React.useState('');
  const [itemKind, setItemKind] = React.useState('expense');
  const [group, setGroup] = React.useState('operating');
  const orgName = (id: string) => orgs.data?.find(o => o.id === id)?.name ?? '';

  return (
    <div className="page flush">
      <Head title={tt('money.refs.title')} lead={tt('money.refs.subtitle')} />
      <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px', display: 'grid', gap: 24 }}>
        <section>
          <h3>{tt('money.refs.registers')}</h3>
          {!(registers.data ?? []).filter(r => !r.archivedAt).length && <p className="faint">{tt('money.refs.noRegisters')}</p>}
          <table className="dtbl">
            <tbody>
              {(registers.data ?? []).filter(r => !r.archivedAt).map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="muted">{orgName(r.organizationId)}</td>
                  <td className="r">{canManage && <Button size="sm" variant="ghost" onClick={() => void api.archive('cash-registers', r.id)}>{tt('money.refs.archive')}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canManage && (
            <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
              <Field label={tt('money.refs.name')}>{p => <Input {...p} value={regName} onChange={e => setRegName(e.target.value)} />}</Field>
              <Button
                disabled={!regName.trim()}
                onClick={() =>
                  void api.create('cash-registers', { name: regName.trim() }).then(() => setRegName(''))
                }
              >
                {tt('money.refs.addRegister')}
              </Button>
            </div>
          )}
        </section>
        <section>
          <h3>{tt('money.refs.items')}</h3>
          <table className="dtbl">
            <thead>
              <tr>
                <th>{tt('money.refs.name')}</th>
                <th style={{ width: 130 }}>{tt('money.refs.kind')}</th>
                <th style={{ width: 200 }}>{tt('money.refs.group')}</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {(items.data ?? []).filter(i => !i.archivedAt).map(i => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>{tt(`money.refs.${i.kind}`)}</td>
                  <td className="muted">{tt(`money.refs.${i.flowGroup}`)}</td>
                  <td>{i.systemKey ? <Badge tone="gray">{tt('money.refs.system')}</Badge> : canManage && <Button size="sm" variant="ghost" onClick={() => void api.archive('cash-flow-items', i.id)}>{tt('money.refs.archive')}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canManage && (
            <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
              <Field label={tt('money.refs.name')}>{p => <Input {...p} value={itemName} onChange={e => setItemName(e.target.value)} />}</Field>
              <Field label={tt('money.refs.kind')}>
                {p => <Select id={p.id} value={itemKind} onValueChange={setItemKind} options={[{ value: 'income', label: tt('money.refs.income') }, { value: 'expense', label: tt('money.refs.expense') }]} aria-label={tt('money.refs.kind')} />}
              </Field>
              <Field label={tt('money.refs.group')}>
                {p => (
                  <Select
                    id={p.id}
                    value={group}
                    onValueChange={setGroup}
                    options={[
                      { value: 'operating', label: tt('money.refs.operating') },
                      { value: 'investing', label: tt('money.refs.investing') },
                      { value: 'financing', label: tt('money.refs.financing') },
                    ]}
                    aria-label={tt('money.refs.group')}
                  />
                )}
              </Field>
              <Button disabled={!itemName.trim()} onClick={() => void api.create('cash-flow-items', { name: itemName.trim(), kind: itemKind, flowGroup: group }).then(() => setItemName(''))}>
                {tt('money.refs.addItem')}
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
