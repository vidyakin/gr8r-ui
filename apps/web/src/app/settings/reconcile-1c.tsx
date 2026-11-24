import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { ENTERPRISE_DATA_MAX_BYTES, icReconcileQuery } from '@erp/shared';
import { DateInput } from '@/components/erp/date-picker';
import { Alert, Button, Field, Select, Skeleton } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtAmount, fmtNumber } from '@/i18n/format';
import { errorMessage } from '../data/api';
import { useOrganizations } from '../docs/data';
import { fmtDate, iso, today } from '../lib/dates';
import { useWsId } from '../meta/data';
import { EnterpriseDataFields, IcReportTable, uploadEnterpriseData, type IcApi, type IcSourceValue } from './enterprise-data-upload';

type Report = InferResponseType<IcApi['reconcile']['$post'], 200>;
type DocumentRow = Report['onlyInErp'][number] | Report['onlyIn1c'][number];

export function Reconcile1c() {
  const ws = useWsId();
  return <ReconcileForm key={ws} ws={ws} />;
}

function ReconcileForm({ ws }: { ws: string }) {
  const t = useT();
  const organizations = useOrganizations();
  const [file, setFile] = useState<File>();
  const [source, setSource] = useState<IcSourceValue>('buh3');
  const [dateTo, setDateTo] = useState(() => iso(today()));
  const [dateFrom, setDateFrom] = useState(() => `${dateTo.slice(0, 7)}-01`);
  const [organization, setOrganization] = useState('all');
  const report = useMutation({
    mutationFn: (xml: File) => uploadEnterpriseData<Report>(ws, 'reconcile', xml, {
      source, dateFrom, dateTo, ...(organization === 'all' ? {} : { organizationId: organization }),
    }),
  });
  const busy = report.isPending;
  const tooLarge = !!file && file.size > ENTERPRISE_DATA_MAX_BYTES;
  const invalidRange = dateFrom > dateTo;
  const valid = icReconcileQuery.safeParse({ source, dateFrom, dateTo, organizationId: organization === 'all' ? undefined : organization }).success;
  const organizationOptions = [
    { value: 'all', label: t('icExport.allOrganizations') },
    ...(organizations.data ?? []).map(row => ({ value: row.id, label: row.name })),
  ];

  return (
    <section className="sblock">
      <h2>{t('icExchange.reconcileTitle')}</h2>
      <div className="stack gap-3">
        <div className="row flex-wrap items-start gap-3">
          <EnterpriseDataFields disabled={busy} source={source}
            setSource={value => { setSource(value); report.reset(); }}
            setFile={value => { setFile(value); report.reset(); }} />
        </div>
        <div className="row flex-wrap items-start gap-3">
          <Field label={t('icLinks.types.organization')}>
            {p => <Select id={p.id} value={organization} options={organizationOptions}
              disabled={busy || organizations.isPending} onValueChange={value => { setOrganization(value); report.reset(); }} />}
          </Field>
          <Field label={t('icExport.dateFrom')}>
            {p => <DateInput {...p} required value={dateFrom} max={dateTo} disabled={busy}
              onChange={value => { setDateFrom(value); report.reset(); }} />}
          </Field>
          <Field label={t('icExport.dateTo')} error={invalidRange ? t('icExport.invalidRange') : undefined}>
            {p => <DateInput {...p} required value={dateTo} min={dateFrom} disabled={busy}
              onChange={value => { setDateTo(value); report.reset(); }} />}
          </Field>
        </div>
        {organizations.isError && <Alert tone="warn">{t('icExport.organizationsError')}</Alert>}
        {tooLarge && <Alert tone="warn">{t('errors.payload_too_large')}</Alert>}
        <div>
          <Button size="sm" variant="primary" disabled={!file || tooLarge || !valid || busy}
            onClick={() => { if (file) report.mutate(file); }}>{t(busy ? 'icExchange.reconciling' : 'icExchange.reconcile')}</Button>
        </div>
        {busy && <Skeleton w="100%" h={72} />}
        {report.isError && <Alert tone="warn">{errorMessage(report.error)}</Alert>}
        {report.data && <ReconciliationReport data={report.data} />}
      </div>
    </section>
  );
}

function ReconciliationReport({ data }: { data: Report }) {
  const t = useT();
  const displayAmount = (value: string | undefined | null, code?: string) => value == null ? '—' : [fmtAmount(value), code].filter(Boolean).join(' ');
  const docLabel = (row: DocumentRow) => row.number || ('id' in row ? row.id : row.refUuid) || '—';
  const docGroups = [
    { title: t('icExchange.onlyErp'), rows: data.onlyInErp },
    { title: t('icExchange.only1c'), rows: data.onlyIn1c },
  ];
  const amountGroups = [
    { title: t('icExchange.amountDiffs'), rows: data.amountDiffs },
    { title: t('icExchange.paymentDiffs'), rows: data.paymentDiffs },
  ];
  const balances = [...data.stockDiffs, ...data.balanceDiffs];
  return (
    <div className="stack gap-4" aria-live="polite">
      <strong>{t('icExchange.matchedTotal', { n: fmtNumber(data.matchedCount) })}</strong>
      {!!data.unresolvedOrganizations.length && <Alert tone="warn">{t('icExchange.unresolvedOrgs', { n: fmtNumber(data.unresolvedOrganizations.length) })}</Alert>}
      {docGroups.map(group => <div key={group.title} className="stack gap-2">
        <h3>{group.title} · {fmtNumber(group.rows.length)}</h3>
        <IcReportTable<DocumentRow> headings={[t('icExchange.number'), t('icExchange.date'), t('icLinks.entityType'), t('icExchange.amount')]} rows={group.rows}
          cells={row => [docLabel(row), fmtDate(row.date, true), t(`icExport.documents.${row.type}`), displayAmount(row.amount, row.currency)]} />
      </div>)}
      {amountGroups.map(group => <div key={group.title} className="stack gap-2">
        <h3>{group.title} · {fmtNumber(group.rows.length)}</h3>
        <IcReportTable headings={[t('icExchange.number'), t('icExchange.date'), t('icLinks.entityType'), t('icExchange.erp'), t('icExchange.oneC'), t('icExchange.difference')]}
          rows={group.rows} cells={row => {
            const doc = row.erp ?? row.oneC!;
            return [docLabel(doc), fmtDate(doc.date, true), t(`icExport.documents.${doc.type}`), displayAmount(row.erp?.amount, row.erp?.currency),
              displayAmount(row.oneC?.amount, row.oneC?.currency), row.difference === null ? t('icExchange.reasons.currency') : displayAmount(row.difference)];
          }} />
      </div>)}
      <div className="stack gap-2">
        <h3>{t('icExchange.balanceDiffs')} · {fmtNumber(balances.length)}</h3>
        {data.balanceKinds.length ? <IcReportTable headings={[t('icExchange.date'), t('icLinks.entityType'), t('icExchange.object'), t('icExchange.erp'), t('icExchange.oneC'),
          t('icExchange.difference'), t('icExchange.qtyDifference')]} rows={balances}
          cells={row => [fmtDate(row.date, true), t(`icExchange.kinds.${row.kind}`), row.label || row.key, displayAmount(row.erpAmount), displayAmount(row.oneCAmount),
            row.reason === 'balance' ? displayAmount(row.amountDifference) : t(`icExchange.reasons.${row.reason}`),
            row.qtyDifference == null ? '—' : fmtNumber(row.qtyDifference)]} /> : <p className="muted">{t('icExchange.noBalances')}</p>}
      </div>
      {!!data.issues.length && <div className="stack gap-2">
        <h3>{t('icExchange.fileIssues')}</h3>
        <IcReportTable headings={[t('icLinks.name1c'), t('icLinks.guid'), t('icExchange.reason')]} rows={data.issues}
          cells={row => [row.name || '—', row.refUuid || '—', t(`icExchange.reasons.${row.reason}`)]} />
      </div>}
    </div>
  );
}
