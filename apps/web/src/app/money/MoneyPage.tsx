/* Деньги: журнал оплат (ПКО, РКО, поступления и списания по счёту, авансовые отчёты) */
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { CircleAlert, FilePlus2 } from 'lucide-react';
import { Badge, Button, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton, Tab, Tabs, TabsList } from '@/components/ui';
import { fmtAmount, tProductionEnum, useT } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { usePayments } from './data';

const NEW_TYPES = ['bank_receipt', 'bank_payment', 'cash_receipt', 'cash_payment', 'advance_report'] as const;
const RECEIPTS = 'cash_receipt,bank_receipt';
const PAYMENTS = 'cash_payment,bank_payment';

export function MoneyPage() {
  const tt = useT();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const [tab, setTab] = React.useState('all');
  const [q, setQ] = React.useState('');
  const type = tab === 'receipts' ? RECEIPTS : tab === 'payments' ? PAYMENTS : tab === 'advance' ? 'advance_report' : undefined;
  const list = usePayments({ type, q: q || undefined });
  const rows = list.data?.items ?? [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('money.list.title')}</h1>
          <p>{tt('money.list.subtitle')}</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="primary">
                  <FilePlus2 size={14} />
                  {tt('money.list.new')}
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                {NEW_TYPES.map(ty => (
                  <MenuItem key={ty} onSelect={() => void navigate(`/money/new?type=${ty}`)}>
                    {tt(`money.typesShort.${ty}`)}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
        </div>
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px', alignItems: 'flex-end' }}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label={tt('money.list.title')}>
            <Tab value="all">{tt('money.list.all')}</Tab>
            <Tab value="receipts">{tt('money.list.receipts')}</Tab>
            <Tab value="payments">{tt('money.list.payments')}</Tab>
            <Tab value="advance">{tt('money.list.advance')}</Tab>
          </TabsList>
        </Tabs>
        <Field label={tt('money.common.search')}>{p => <Input {...p} value={q} onChange={e => setQ(e.target.value)} />}</Field>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('money.list.title')} action={<Button size="sm" onClick={() => list.refetch()}>{tt('money.common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<FilePlus2 size={20} />} title={tt('money.list.noPayments')}>
          {tt('money.list.noPaymentsHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('money.list.table')}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>{tt('money.common.number')}</th>
                <th style={{ width: 110 }}>{tt('money.common.date')}</th>
                <th style={{ width: 110 }}>{tt('money.common.status')}</th>
                <th>{tt('money.list.operation')}</th>
                <th>{tt('money.list.counterparty')}</th>
                <th>{tt('money.list.account')}</th>
                <th style={{ width: 130 }} className="r">{tt('money.form.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const incoming = r.type === 'cash_receipt' || r.type === 'bank_receipt';
                return (
                  <tr key={r.id}>
                    <td className="mono">
                      <Link to={`/money/${r.id}`} className="crm-link">
                        {r.number ?? tt('money.common.draft')}
                      </Link>
                    </td>
                    <td className="muted">{fmtDate(r.date)}</td>
                    <td>
                      <Badge tone={r.status === 'posted' ? 'green' : r.status === 'cancelled' ? 'neutral' : 'gray'} dot>
                        {tProductionEnum('docStatus', r.status, r.status)}
                      </Badge>
                    </td>
                    <td>{r.operation ? tt(`money.operations.${r.operation as 'from_customer'}`) : tt(`money.types.${r.type as 'advance_report'}`)}</td>
                    <td>{r.counterpartyName ?? ''}</td>
                    <td className="muted">{r.accountName ?? ''}</td>
                    <td className="r num">{r.type === 'advance_report' ? '' : incoming ? '+' : '−'}{fmtAmount(r.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            {tt('money.list.incoming')}: {fmtAmount(list.data!.incoming)} · {tt('money.list.outgoing')}: {fmtAmount(list.data!.outgoing)}
          </p>
        </div>
      )}
    </div>
  );
}

