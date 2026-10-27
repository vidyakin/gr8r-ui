/* Банковская выписка файлом (1174в): загрузка 1CClientBankExchange, предпросмотр с ручной правкой, создание документов банка;
   выгрузка платёжных поручений в тот же формат. Сопоставление делает сервер, здесь — только правка строк. */
import * as React from 'react';
import { Link } from 'react-router';
import { Download, FileUp } from 'lucide-react';
import { PAYABLE_TYPES } from '@gr8r/shared';
import { Alert, Badge, Button, Checkbox, EmptyState, Field, Input, Select, toast } from '@/components/ui';
import { fmtAmount, hasKey, t as translate, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { fmtDate } from '../lib/dates';
import { typeLabel, useDocuments, useOrganizations } from '../docs/data';
import { CounterpartyPicker } from '../docs/pickers';
import { useCanWrite } from '../meta/custom-fields';
import { useBankImportApi, useCashFlowItems, useOrgBankAccounts, type BankImportPreview, type BankImportResult, type BankImportRow } from './data';

const OPERATIONS = { in: ['from_customer', 'supplier_refund', 'other_income'], out: ['to_supplier', 'customer_refund', 'other_expense'] } as const;
const isOther = (op: string | null) => op === 'other_income' || op === 'other_expense';

interface Row extends BankImportRow {
  include: boolean;
  cashFlowItemId: string;
}

/** Документ расчётов строки: список документов контрагента */
function DocumentSelect({ row, onChange }: { row: Row; onChange: (id: string | null) => void }) {
  const tt = useT();
  const docs = useDocuments({ counterpartyId: row.counterpartyId || undefined });
  const options = (docs.data?.items ?? []).filter(d => (PAYABLE_TYPES as string[]).includes(d.type) && d.status !== 'cancelled');
  const current = row.settlementDocument;
  return (
    <Select
      aria-label={tt('money.bankImport.document')}
      disabled={!row.counterpartyId}
      value={row.settlementDocumentId ?? ''}
      onValueChange={v => onChange(v || null)}
      options={[
        { value: '', label: tt('money.bankImport.advance') },
        ...(current && !options.some(d => d.id === current.id) ? [{ value: current.id, label: `${typeLabel(current.type)} ${current.number ?? ''}` }] : []),
        ...options.map(d => ({ value: d.id, label: `${typeLabel(d.type)} ${d.number ?? ''} · ${fmtAmount(d.total)}` })),
      ]}
    />
  );
}

export function BankImportPage() {
  const tt = useT();
  const canWrite = useCanWrite();
  const api = useBankImportApi();
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<BankImportPreview | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [accountId, setAccountId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<BankImportResult | null>(null);
  const flowItems = useCashFlowItems();

  const load = async (f: File, bankAccountId?: string) => {
    setBusy(true);
    setResult(null);
    try {
      const p = await api.preview(f, bankAccountId);
      setPreview(p);
      setAccountId(p.bankAccount?.id ?? '');
      setRows(p.rows.map(r => ({ ...r, include: !r.skip, cashFlowItemId: '' })));
    } catch (e) {
      setPreview(null);
      setRows([]);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (i: number, patch: Partial<Row>) => setRows(prev => prev.map(r => (r.index === i ? { ...r, ...patch } : r)));
  const picked = rows.filter(r => r.include && r.direction);
  const incomplete = picked.filter(r => (isOther(r.operation) ? !r.cashFlowItemId : !r.counterpartyId));

  const commit = async (post: boolean) => {
    if (!preview?.bankAccount) return;
    setBusy(true);
    try {
      const r = await api.commit({
        bankAccountId: accountId,
        post,
        rows: picked.map(r => ({
          direction: r.direction!,
          number: r.number,
          docDate: r.docDate,
          bookedDate: r.bookedDate,
          amount: r.amount,
          purpose: r.purpose,
          operation: r.operation!,
          counterpartyId: isOther(r.operation) ? null : r.counterpartyId,
          settlementDocumentId: isOther(r.operation) ? null : r.settlementDocumentId,
          cashFlowItemId: r.cashFlowItemId || null,
        })),
      });
      setResult(r);
      // созданные и дубли уходят из таблицы, ошибочные остаются для правки
      const failed = new Set(r.failed.map(f => f.key));
      setRows(prev => prev.filter(x => !(x.include && !failed.has(x.key))));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('money.bankImport.title')}</h1>
          <p>{tt('money.bankImport.subtitle')}</p>
        </div>
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label={tt('money.bankImport.file')}>
          {p => (
            <Input
              {...p}
              type="file"
              accept=".txt,.csv,text/plain"
              onChange={e => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f) void load(f);
              }}
            />
          )}
        </Field>
        {preview && preview.accounts.length > 1 && (
          <Field label={tt('money.bankImport.account')}>
            {p => (
              <Select
                id={p.id}
                value={accountId}
                onValueChange={v => {
                  setAccountId(v);
                  if (file) void load(file, v);
                }}
                options={preview.accounts.map(a => ({ value: a.id, label: a.label }))}
                aria-label={tt('money.bankImport.account')}
              />
            )}
          </Field>
        )}
      </div>

      {preview && !preview.bankAccount && (
        <div style={{ padding: '0 var(--gutter)' }}>
          <Alert tone="warn">{tt('money.bankImport.noAccount', { accounts: preview.statementAccounts.join(', ') || '—' })}</Alert>
        </div>
      )}
      {preview?.bankAccount && (
        <div style={{ padding: '0 var(--gutter) 8px' }} className="faint">
          {preview.bankAccount.label} · {preview.period.from ? fmtDate(preview.period.from) : '—'} – {preview.period.to ? fmtDate(preview.period.to) : '—'} ·{' '}
          {tt('money.bankImport.summary', { total: preview.summary.total, incoming: preview.summary.incoming, outgoing: preview.summary.outgoing, duplicates: preview.summary.duplicates })}
        </div>
      )}
      {preview?.warnings.length ? (
        <div style={{ padding: '0 var(--gutter) 8px' }}>
          <Alert tone="warn">{tt('money.bankImport.warnings', { count: preview.warnings.length })}</Alert>
        </div>
      ) : null}

      {result && (
        <div style={{ padding: '0 var(--gutter) 8px' }}>
          <Alert tone={result.failed.length ? 'warn' : 'ok'}>
            {tt('money.bankImport.result', { created: result.created.length, skipped: result.skipped.length, failed: result.failed.length })}{' '}
            <Link to="/money">{tt('money.bankImport.toPayments')}</Link>
            {result.failed.map(f => (
              <div key={f.key}>
                № {f.key.split('|')[3]}: {hasKey(`errors.${f.code}`) ? translate(`errors.${f.code}` as never) : f.message}
              </div>
            ))}
          </Alert>
        </div>
      )}

      {preview?.bankAccount && rows.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="dtbl" aria-label={tt('money.bankImport.title')}>
              <thead>
                <tr>
                  <th style={{ width: 32 }} />
                  <th>{tt('money.bankImport.date')}</th>
                  <th>{tt('money.bankImport.number')}</th>
                  <th className="r">{tt('money.bankImport.amount')}</th>
                  <th style={{ minWidth: 220 }}>{tt('money.bankImport.bankParty')}</th>
                  <th style={{ minWidth: 200 }}>{tt('money.bankImport.counterparty')}</th>
                  <th style={{ minWidth: 220 }}>{tt('money.bankImport.document')}</th>
                  <th style={{ minWidth: 180 }}>{tt('money.bankImport.operation')}</th>
                  <th>{tt('money.bankImport.notes')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.index} style={r.include ? undefined : { opacity: 0.55 }}>
                    <td>
                      <Checkbox checked={r.include} disabled={!r.direction} onChange={e => set(r.index, { include: e.target.checked })} aria-label={tt('money.bankImport.include')} />
                    </td>
                    <td>{fmtDate(r.bookedDate)}</td>
                    <td>{r.number}</td>
                    <td className="r num" style={{ color: r.direction === 'in' ? 'var(--green, inherit)' : undefined }}>
                      {r.direction === 'out' ? '−' : ''}
                      {fmtAmount(r.amount)}
                    </td>
                    <td>
                      <div>{r.party.name || '—'}</div>
                      <div className="faint">{[r.party.inn, r.purpose].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>
                      {r.direction && !isOther(r.operation) ? (
                        <CounterpartyPicker
                          value={r.counterpartyName ?? ''}
                          placeholder={r.candidates.length ? tt('money.bankImport.pickOne', { count: r.candidates.length }) : undefined}
                          onPick={c => set(r.index, { counterpartyId: c.id, counterpartyName: c.name, settlementDocumentId: null, settlementDocument: null, candidates: [] })}
                        />
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td>{r.direction && !isOther(r.operation) ? <DocumentSelect row={r} onChange={id => set(r.index, { settlementDocumentId: id })} /> : <span className="faint">—</span>}</td>
                    <td>
                      {r.direction ? (
                        <>
                          <Select
                            aria-label={tt('money.bankImport.operation')}
                            value={r.operation ?? ''}
                            onValueChange={v => set(r.index, { operation: v })}
                            options={OPERATIONS[r.direction].map(op => ({ value: op, label: tt(`money.operations.${op}`) }))}
                          />
                          {isOther(r.operation) && (
                            <Select
                              aria-label={tt('money.bankImport.cashFlowItem')}
                              value={r.cashFlowItemId}
                              onValueChange={v => set(r.index, { cashFlowItemId: v })}
                              options={[{ value: '', label: tt('money.bankImport.cashFlowItem') }, ...(flowItems.data ?? []).filter(i => i.kind === (r.direction === 'in' ? 'income' : 'expense') && !i.archivedAt).map(i => ({ value: i.id, label: i.name }))]}
                            />
                          )}
                        </>
                      ) : null}
                    </td>
                    <td>
                      {r.issues.map(i => (
                        <Badge key={i} tone={i === 'duplicate' || i === 'internal_transfer' || i === 'other_account' ? 'gray' : i === 'counterparty_from_document' ? 'green' : 'amber'}>
                          {tt(`money.bankImport.issues.${i as 'duplicate'}`)}
                        </Badge>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canWrite && (
            <div className="row" style={{ gap: 8, padding: 'var(--gutter)', alignItems: 'center' }}>
              <Button variant="primary" disabled={busy || picked.length === 0 || incomplete.length > 0} onClick={() => void commit(true)}>
                <FileUp size={14} />
                {tt('money.bankImport.createPosted', { count: picked.length })}
              </Button>
              <Button disabled={busy || picked.length === 0 || incomplete.length > 0} onClick={() => void commit(false)}>
                {tt('money.bankImport.createDrafts')}
              </Button>
              {incomplete.length > 0 && <span className="faint">{tt('money.bankImport.incomplete', { count: incomplete.length })}</span>}
            </div>
          )}
        </>
      )}
      {!preview && !busy && <EmptyState icon={<FileUp size={20} />} title={tt('money.bankImport.emptyTitle')}>{tt('money.bankImport.emptyHint')}</EmptyState>}

      {canWrite && <OrdersExport />}
    </div>
  );
}

/** Выгрузка платёжных поручений (черновики и проведённые «Списания со счёта») в формате банк-клиента */
function OrdersExport() {
  const tt = useT();
  const api = useBankImportApi();
  const orgs = useOrganizations();
  const [orgId, setOrgId] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const organization = orgId || orgs.data?.[0]?.id;
  const accounts = useOrgBankAccounts(organization);
  const account = accountId || accounts.data?.[0]?.id || '';
  return (
    <section style={{ padding: 'var(--gutter)' }}>
      <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>{tt('money.bankImport.exportTitle')}</h2>
      <p className="faint" style={{ margin: '0 0 8px' }}>
        {tt('money.bankImport.exportHint')}
      </p>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label={tt('money.form.organization')}>
          {p => (
            <Select
              id={p.id}
              value={organization ?? ''}
              onValueChange={v => {
                setOrgId(v);
                setAccountId('');
              }}
              options={(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))}
              aria-label={tt('money.form.organization')}
            />
          )}
        </Field>
        <Field label={tt('money.form.bankAccount')}>
          {p => <Select id={p.id} value={account} onValueChange={setAccountId} options={(accounts.data ?? []).map(b => ({ value: b.id, label: `${b.bankName} · ${b.account}` }))} aria-label={tt('money.form.bankAccount')} />}
        </Field>
        <Field label={tt('money.common.from')}>{p => <Input {...p} type="date" value={from} onChange={e => setFrom(e.target.value)} />}</Field>
        <Field label={tt('money.common.to')}>{p => <Input {...p} type="date" value={to} onChange={e => setTo(e.target.value)} />}</Field>
        <Button
          disabled={!account}
          onClick={() =>
            void api
              .downloadOrders({ bankAccountId: account, ...(from ? { from } : {}), ...(to ? { to } : {}) })
              .catch(e => toast.error(errorMessage(e)))
          }
        >
          <Download size={14} />
          {tt('money.bankImport.exportButton')}
        </Button>
      </div>
    </section>
  );
}
