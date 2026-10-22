/* Billing: the invoice of the period for service contracts. The page shows a preview (subscription for the current
   period and the works by fact for the previous one), runs the billing and shows the result. */
import * as React from 'react';
import { CircleAlert, FileDown, ReceiptText } from 'lucide-react';
import { Badge, Button, EmptyState, Field, Select, Skeleton, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { money } from '../catalog/data';
import { useBillingApi, useBillingPreview, useContractReport, type BillingPreviewItem, type BillingRunItem } from './billing-data';
import { useIsAdmin } from '../catalog/data';

/** Варианты периода: последние 12 месяцев, кварталы и год */
function periodOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value: key, label: `${months[d.getMonth()]} ${d.getFullYear()}` });
  }
  for (let q = 1; q <= 4; q++) out.push({ value: `${now.getFullYear()}-Q${q}`, label: `Q${q} ${now.getFullYear()}` });
  out.push({ value: `${now.getFullYear()}`, label: `${now.getFullYear()}` });
  return out;
}

/** Ключ периода по умолчанию: текущий месяц */
function currentPeriodKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function BillingPage() {
  const isAdmin = useIsAdmin();
  const api = useBillingApi();
  const [period, setPeriod] = React.useState(currentPeriodKey);
  const [result, setResult] = React.useState<BillingRunItem[] | null>(null);
  const preview = useBillingPreview(period);
  const report = useContractReport();

  const run = async () => {
    const r = await api<{ period: string; items: BillingRunItem[] }>('POST', '/billing/run', { period });
    if (r) {
      setResult(r.items);
      const created = r.items.filter(i => !i.skipped).length;
      toast(created ? `Issued ${created} invoice(s)` : 'Nothing to issue: the invoices for this period already exist');
    }
  };

  const items = preview.data?.items ?? [];

  /** Выгрузка счетов периода: PDF печатных форм (задачи воркера) */
  const exportPdf = async () => {
    const ids = items.map(i => i.existingDocumentId).filter((id): id is string => !!id);
    if (!ids.length) return toast.error('There are no issued invoices for this period');
    const r = await api<{ count: number }>('POST', '/billing/export', { documentIds: ids });
    if (r) toast(`PDF export requested for ${r.count} invoice(s)`);
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Billing</h1>
          <p>Invoices for service contracts: the subscription for the current period and the works by fact for the previous one.</p>
        </div>
        <div className="acts">
          {isAdmin && (
            <Button variant="ghost" disabled={preview.isFetching} onClick={() => void exportPdf()}>
              <FileDown size={14} />
              Export PDFs
            </Button>
          )}
          {isAdmin && (
            <Button variant="primary" disabled={preview.isFetching} onClick={() => void run()}>
              <ReceiptText size={14} />
              Run billing
            </Button>
          )}
        </div>
      </div>
      <div className="pane">
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <Field label="Period" hint="The subscription is billed for this period, the works by fact for the previous one">
            {({ id }) => <Select id={id} value={period} onValueChange={v => setPeriod(v)} options={periodOptions()} />}
          </Field>
        </div>
        {preview.isPending ? (
          <Skeleton w="100%" h={120} />
        ) : !items.length ? (
          <EmptyState icon={<ReceiptText size={20} />} title="Nothing to bill">
            There are no service contracts in this workspace yet.
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {items.map(item => (
              <BillingCard key={item.contractId} item={item} />
            ))}
          </div>
        )}
        {result && (
          <div style={{ marginTop: 16 }}>
            <h2>Result</h2>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {result.map(i => (
                <div key={i.contractId} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{i.contractNumber || i.contractId}</span>
                  {i.skipped ? <span className="faint">{i.reason}</span> : <Badge tone="green">{i.number ?? 'Draft'}</Badge>}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ marginTop: 24 }}>
          <h2>Income and expenses by contract</h2>
          {report.isPending ? (
            <Skeleton w="100%" h={80} />
          ) : !report.data?.items.length ? (
            <EmptyState size="sm" icon={<CircleAlert size={18} />} title="No documents with a contract yet" />
          ) : (
            <ReportTable items={report.data.items} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Карточка договора: строки счёта и расшифровка (откуда строка) */
function BillingCard({ item }: { item: BillingPreviewItem }) {
  const columns: Column<BillingPreviewItem['lines'][number]>[] = [
    { id: 'name', header: 'Position', width: 320, value: l => l.name, cell: l => <span className="trunc">{l.name}</span> },
    { id: 'qty', header: 'Qty', width: 100, align: 'right', value: l => Number(l.qty), cell: l => <span className="num">{l.qty}</span> },
    { id: 'price', header: 'Price', width: 120, align: 'right', value: l => Number(l.price), cell: l => <span className="num">{money(l.price)}</span> },
    {
      id: 'total',
      header: 'Total',
      width: 120,
      align: 'right',
      value: l => Number(l.qty) * Number(l.price),
      cell: l => <span className="num">{money(String(Number(l.qty) * Number(l.price)))}</span>,
      total: rows => <span className="num">{money(String(rows.reduce((s, r) => s + Number(r.qty) * Number(r.price), 0)))}</span>,
    },
    {
      id: 'source',
      header: 'Source',
      width: 220,
      defaultHidden: true,
      value: l => l.breakdown.map(b => b.source).join(', '),
      cell: l => <span className="faint trunc">{l.breakdown.map(b => `${b.source}: ${b.name}`).join('; ')}</span>,
    },
  ];
  const table = useDataTable(columns, {});
  return (
    <div className="sblock">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <b>{item.companyName}</b> {item.contractNumber && <span className="muted">· {item.contractNumber}</span>}
          <div className="faint" style={{ fontSize: 12 }}>
            Period {item.period} · works by fact {item.factPeriod}
          </div>
        </div>
        {item.existingDocumentId && <Badge tone="green">Already issued</Badge>}
      </div>
      {item.warnings.map((w, i) => (
        <div key={i} className="faint" style={{ fontSize: 12 }}>
          {w}
        </div>
      ))}
      <DataTable columns={columns} table={table} rows={item.lines} getId={l => l.productId} aria-label="Invoice lines" />
    </div>
  );
}

/** Отчёт: доходы и расходы по договорам */
function ReportTable({ items }: { items: { contractId: string; contractNumber: string; companyName: string; income: string; expense: string }[] }) {
  const columns: Column<(typeof items)[number]>[] = [
    { id: 'company', header: 'Customer', width: 240, value: r => r.companyName, cell: r => <span className="trunc">{r.companyName}</span> },
    { id: 'contract', header: 'Contract', width: 140, value: r => r.contractNumber, cell: r => <span className="mono">{r.contractNumber || '—'}</span> },
    { id: 'income', header: 'Income', width: 140, align: 'right', value: r => Number(r.income), cell: r => <span className="num">{money(r.income)}</span> },
    { id: 'expense', header: 'Expenses', width: 140, align: 'right', value: r => Number(r.expense), cell: r => <span className="num">{money(r.expense)}</span> },
  ];
  const table = useDataTable(columns, {});
  return <DataTable columns={columns} table={table} rows={items} getId={r => r.contractId} aria-label="Income and expenses by contract" />;
}
