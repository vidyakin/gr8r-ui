/* Billing: the invoice of the period for service contracts. The page shows a preview (subscription for the current
   period and the works by fact for the previous one), runs the billing and shows the result. */
import * as React from 'react';
import { CircleAlert, Download, FileDown, ReceiptText } from 'lucide-react';
import { Badge, Button, EmptyState, Field, Select, Skeleton, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { useT } from '@/i18n';
import { money } from '../catalog/data';
import { useBillingApi, useBillingPreview, useContractReport, type BillingPreviewItem, type BillingRunItem } from './billing-data';
import { useIsAdmin } from '../catalog/data';
import { API_BASE } from '../data/api';
import { call, useWsId } from '../meta/data';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Варианты периода: последние 12 месяцев, кварталы и год */
function periodOptions(t: ReturnType<typeof useT>): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  const months = t('docs.billing.monthsShort').split('|');
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value: key, label: `${months[d.getMonth()] ?? MONTHS_EN[d.getMonth()]} ${d.getFullYear()}` });
  }
  for (let q = 1; q <= 4; q++) out.push({ value: `${now.getFullYear()}-Q${q}`, label: t('docs.billing.quarter', { q, year: now.getFullYear() }) });
  out.push({ value: `${now.getFullYear()}`, label: t('docs.billing.year', { year: now.getFullYear() }) });
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
  const ws = useWsId();
  const t = useT();
  const [period, setPeriod] = React.useState(currentPeriodKey);
  const [result, setResult] = React.useState<BillingRunItem[] | null>(null);
  /** Состояние выгрузки PDF (ZIP): задача воркера, статус и ссылка на скачивание */
  const [exported, setExported] = React.useState<{ id: string; name: string; status: string; error?: string } | null>(null);
  const preview = useBillingPreview(period);
  const report = useContractReport();

  const run = async () => {
    const r = await api<{ period: string; items: BillingRunItem[] }>('POST', '/billing/run', { period });
    if (r) {
      setResult(r.items);
      const created = r.items.filter(i => !i.skipped).length;
      toast(created ? t('docs.billing.runIssued', { n: created }) : t('docs.billing.runNothing'));
    }
  };

  const items = preview.data?.items ?? [];

  /** Выгрузка счетов периода одним ZIP-архивом: задача воркера, статус и ссылка на скачивание */
  const exportPdf = async () => {
    const ids = items.map(i => i.existingDocumentId).filter((id): id is string => !!id);
    if (!ids.length) return toast.error(t('docs.billing.noInvoices'));
    const r = await api<{ id: string; name: string; count: number }>('POST', '/billing/export', { documentIds: ids });
    if (!r) return;
    setExported({ id: r.id, name: r.name, status: 'pending' });
    toast(t('docs.billing.exportRequested', { n: r.count }));
    for (let i = 0; i < 60; i++) {
      await new Promise(res => setTimeout(res, 1000));
      const st = await call<{ status: string; error?: string }>(ws, 'GET', `/billing/export/${r.id}`).catch(() => null);
      if (!st) return;
      setExported(e => (e && e.id === r.id ? { ...e, status: st.status, error: st.error } : e));
      if (st.status === 'ready') return toast(t('docs.billing.archiveReady'));
      if (st.status === 'failed') return toast.error(st.error || t('docs.billing.exportFailed'));
    }
    toast.error(t('docs.billing.exportTimeout'));
  };

  /** Скачивание архива */
  const downloadArchive = async () => {
    if (!exported) return;
    const res = await fetch(`${API_BASE()}/billing/export/${exported.id}?download=1`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
    if (!res.ok) return toast.error(t('docs.billing.archiveDownloadFailed'));
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = exported.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('docs.billing.title')}</h1>
          <p>{t('docs.billing.lead')}</p>
        </div>
        <div className="acts">
          {isAdmin && (
            <Button variant="ghost" disabled={preview.isFetching} onClick={() => void exportPdf()}>
              <FileDown size={14} />
              {t('docs.billing.exportPdf')}
            </Button>
          )}
          {isAdmin && (
            <Button variant="primary" disabled={preview.isFetching} onClick={() => void run()}>
              <ReceiptText size={14} />
              {t('docs.billing.run')}
            </Button>
          )}
        </div>
      </div>
      <div className="pane">
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <Field label={t('docs.billing.period')} hint={t('docs.billing.periodHint')}>
            {({ id }) => <Select id={id} value={period} onValueChange={v => setPeriod(v)} options={periodOptions(t)} />}
          </Field>
        </div>
        {preview.isPending ? (
          <Skeleton w="100%" h={120} />
        ) : !items.length ? (
          <EmptyState icon={<ReceiptText size={20} />} title={t('docs.billing.emptyTitle')}>
            {t('docs.billing.emptyHint')}
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
            <h2>{t('docs.billing.resultTitle')}</h2>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {result.map(i => (
                <div key={i.contractId} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{i.contractNumber || i.contractId}</span>
                  {i.skipped ? <span className="faint">{i.reason}</span> : <Badge tone="green">{i.number ?? t('docs.journal.draft')}</Badge>}
                </div>
              ))}
            </div>
          </div>
        )}
        {exported && (
          <div style={{ marginTop: 16 }}>
            <h2>{t('docs.billing.exportTitle')}</h2>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span>
                {exported.name} ·{' '}
                {exported.status === 'pending' ? t('docs.billing.statusPending') : exported.status === 'ready' ? t('docs.billing.statusReady') : exported.status === 'failed' ? t('docs.billing.statusFailed', { err: exported.error ?? t('common.unknownError') }) : exported.status}
              </span>
              {exported.status === 'ready' && (
                <Button variant="secondary" onClick={() => void downloadArchive()}>
                  <Download size={14} />
                  {t('docs.billing.download')}
                </Button>
              )}
            </div>
          </div>
        )}
        <div style={{ marginTop: 24 }}>
          <h2>{t('docs.billing.reportTitle')}</h2>
          {report.isPending ? (
            <Skeleton w="100%" h={80} />
          ) : !report.data?.items.length ? (
            <EmptyState size="sm" icon={<CircleAlert size={18} />} title={t('docs.billing.reportEmpty')} />
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
  const t = useT();
  const columns: Column<BillingPreviewItem['lines'][number]>[] = [
    { id: 'name', header: t('docs.billing.col.position'), width: 320, value: l => l.name, cell: l => <span className="trunc">{l.name}</span> },
    { id: 'qty', header: t('docs.billing.col.qty'), width: 100, align: 'right', value: l => Number(l.qty), cell: l => <span className="num">{l.qty}</span> },
    { id: 'price', header: t('docs.billing.col.price'), width: 120, align: 'right', value: l => Number(l.price), cell: l => <span className="num">{money(l.price)}</span> },
    {
      id: 'total',
      header: t('docs.billing.col.total'),
      width: 120,
      align: 'right',
      value: l => Number(l.qty) * Number(l.price),
      cell: l => <span className="num">{money(String(Number(l.qty) * Number(l.price)))}</span>,
      total: rows => <span className="num">{money(String(rows.reduce((s, r) => s + Number(r.qty) * Number(r.price), 0)))}</span>,
    },
    {
      id: 'source',
      header: t('docs.billing.col.source'),
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
            {t('docs.billing.periodOf', { period: item.period, fact: item.factPeriod })}
          </div>
        </div>
        {item.existingDocumentId && <Badge tone="green">{t('docs.billing.alreadyIssued')}</Badge>}
      </div>
      {item.warnings.map((w, i) => (
        <div key={i} className="faint" style={{ fontSize: 12 }}>
          {w}
        </div>
      ))}
      <DataTable columns={columns} table={table} rows={item.lines} getId={l => l.productId} aria-label={t('docs.billing.ariaLines')} />
    </div>
  );
}

/** Отчёт: доходы и расходы по договорам */
function ReportTable({ items }: { items: { contractId: string; contractNumber: string; companyName: string; income: string; expense: string }[] }) {
  const t = useT();
  const columns: Column<(typeof items)[number]>[] = [
    { id: 'company', header: t('docs.billing.col.customer'), width: 240, value: r => r.companyName, cell: r => <span className="trunc">{r.companyName}</span> },
    { id: 'contract', header: t('docs.billing.col.contract'), width: 140, value: r => r.contractNumber, cell: r => <span className="mono">{r.contractNumber || '—'}</span> },
    { id: 'income', header: t('docs.billing.col.income'), width: 140, align: 'right', value: r => Number(r.income), cell: r => <span className="num">{money(r.income)}</span> },
    { id: 'expense', header: t('docs.billing.col.expense'), width: 140, align: 'right', value: r => Number(r.expense), cell: r => <span className="num">{money(r.expense)}</span> },
  ];
  const table = useDataTable(columns, {});
  return <DataTable columns={columns} table={table} rows={items} getId={r => r.contractId} aria-label={t('docs.billing.ariaReport')} />;
}
