import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { ENTERPRISE_DATA_MAX_BYTES, type IcCatalogType } from '@erp/shared';
import { DateInput } from '@/components/erp/date-picker';
import { Alert, Button, Checkbox, Choice, Field, Skeleton } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtAmount, fmtNumber } from '@/i18n/format';
import { errorMessage } from '../data/api';
import { fmtDate } from '../lib/dates';
import { useWsId } from '../meta/data';
import { EnterpriseDataFields, IcReportTable, uploadEnterpriseData, type IcApi, type IcSourceValue } from './enterprise-data-upload';

type Preview = InferResponseType<IcApi['import']['preview']['$post'], 200>;
type ImportResult = InferResponseType<IcApi['import']['apply']['$post'], 200>;

function balanceReferences({ balance }: Preview['balanceIssues'][number]) {
  const objects = balance.kind === 'stock' ? [balance.warehouseRef, balance.productRef]
    : balance.kind === 'settlement' ? [balance.companyRef, balance.contractRef] : [balance.accountRef];
  return [balance.organizationRef, ...objects].filter(Boolean).join(' / ') || '—';
}

export function Import1c() {
  const ws = useWsId();
  return <ImportForm key={ws} ws={ws} />;
}

function ImportForm({ ws }: { ws: string }) {
  const t = useT();
  const query = useQueryClient();
  const [file, setFile] = useState<File>();
  const [source, setSource] = useState<IcSourceValue>('buh3');
  const [catalogTypes, setCatalogTypes] = useState<IcCatalogType[]>([]);
  const [date, setDate] = useState('');
  const [stock, setStock] = useState(false);
  const [money, setMoney] = useState(false);
  const [settlements, setSettlements] = useState(false);
  const [post, setPost] = useState(false);

  const preview = useMutation({
    mutationFn: (xml: File) => uploadEnterpriseData<Preview>(ws, 'import/preview', xml, { source }),
    onSuccess: report => {
      setCatalogTypes(report.catalogs.filter(row => row.newCount || row.matchedCount).map(row => row.type));
      setDate(report.balanceDates.length === 1 ? report.balanceDates[0]! : '');
      setStock(false);
      setMoney(false);
      setSettlements(false);
      setPost(false);
    },
  });
  const apply = useMutation({
    mutationFn: (xml: File) => uploadEnterpriseData<ImportResult>(ws, 'import/apply', xml, {
      source, catalogTypes: catalogTypes.join(','), stock: String(stock), money: String(money), settlements: String(settlements), post: String(post),
      ...(date ? { date } : {}),
    }),
    onSuccess: () => { void query.invalidateQueries({ queryKey: ['ws', ws] }); },
  });
  const resetReport = () => {
    preview.reset();
    apply.reset();
  };
  const report = preview.data;
  const busy = preview.isPending || apply.isPending;
  const tooLarge = !!file && file.size > ENTERPRISE_DATA_MAX_BYTES;
  const openings = stock || money || settlements;
  const validDate = !!date && (!report?.balanceDates.length || report.balanceDates.includes(date));
  const issueApplies = (kind: string) => kind === 'stock' ? stock : kind === 'settlement' ? settlements : money;
  const blocked = openings && !!report && (report.balanceIssues.some(issue => issueApplies(issue.balance.kind) && (!issue.balance.date || issue.balance.date === date)) ||
    report.issues.some(issue => issue.reason === 'invalid_balance' && issueApplies(issue.type)));
  const fileIssues = report?.issues.filter(issue => issue.reason !== 'invalid_document' && issue.reason !== 'duplicate_document') ?? [];
  const balanceCount = report && Object.values(report.balances).some(Boolean);
  const unmatched = apply.data?.unmatched ?? report?.unmatched ?? [];

  return (
    <section className="sblock">
      <h2>{t('icExchange.importTitle')}</h2>
      <div className="stack gap-3">
        <div className="row flex-wrap items-start gap-3">
          <EnterpriseDataFields disabled={busy} source={source}
            setSource={value => { setSource(value); resetReport(); }}
            setFile={value => { setFile(value); resetReport(); }} />
        </div>
        {tooLarge && <Alert tone="warn">{t('errors.payload_too_large')}</Alert>}
        <div>
          <Button size="sm" variant="secondary" disabled={!file || tooLarge || busy}
            onClick={() => { if (file) { apply.reset(); preview.mutate(file); } }}>
            {t(preview.isPending ? 'icExport.previewing' : 'icExport.preview')}
          </Button>
        </div>
        {preview.isPending && <Skeleton w="100%" h={72} />}
        {preview.isError && <Alert tone="warn">{errorMessage(preview.error)}</Alert>}
        {report && <div className="stack gap-3" aria-live="polite">
          <div className="row flex-wrap gap-3">
            <strong>{t('icExchange.matchedTotal', { n: fmtNumber(report.matchedCount) })}</strong>
            <strong>{t('icExchange.newTotal', { n: fmtNumber(report.newCount) })}</strong>
            <strong>{t('icExchange.unmatchedTotal', { n: fmtNumber(report.unmatchedCount) })}</strong>
          </div>
          <IcReportTable headings={[t('icLinks.entityType'), t('icExchange.matched'), t('icExchange.new'), t('icExchange.unmatched'), t('icExchange.include')]}
            rows={report.catalogs.filter(row => row.matchedCount || row.newCount || row.unmatchedCount)}
            cells={row => {
              const label = t(`icLinks.types.${row.type}`);
              return [label, fmtNumber(row.matchedCount), fmtNumber(row.newCount), fmtNumber(row.unmatchedCount),
                <Checkbox aria-label={t('icExchange.includeCatalog', { name: label })} checked={catalogTypes.includes(row.type)}
                  disabled={busy || (!row.matchedCount && !row.newCount)} onChange={e => {
                    const checked = e.target.checked;
                    setCatalogTypes(current => checked ? [...current, row.type] : current.filter(type => type !== row.type));
                    apply.reset();
                  }} />];
            }} />
          {!!unmatched.length && <div className="stack gap-2">
            <h3>{t('icExchange.unmatched')}</h3>
            <IcReportTable headings={[t('icLinks.entityType'), t('icLinks.name1c'), t('icLinks.guid'), t('icExchange.reason'), t('icExchange.candidates')]}
              rows={unmatched} cells={row => [t(`icLinks.types.${row.type}`), row.name, row.refUuid, t(`icExchange.reasons.${row.reason}`),
                row.candidates?.map(candidate => candidate.name || candidate.entityId).join(', ') || '—']} />
          </div>}
          {!!fileIssues.length && <div className="stack gap-2">
            <h3>{t('icExchange.fileIssues')}</h3>
            <IcReportTable headings={[t('icLinks.name1c'), t('icLinks.guid'), t('icExchange.reason')]} rows={fileIssues}
              cells={row => [row.name || '—', row.refUuid || '—', t(`icExchange.reasons.${row.reason}`)]} />
          </div>}
          {!!balanceCount && <div className="stack gap-2">
            <h3>{t('icExchange.opening')}</h3>
            <p className="muted">{t('icExchange.balanceCount', { stock: fmtNumber(report.balances.stock), bank: fmtNumber(report.balances.bank),
              cash: fmtNumber(report.balances.cash), settlements: fmtNumber(report.balances.settlement) })}</p>
            {!!report.balanceIssues.length && <IcReportTable
              headings={[t('icLinks.entityType'), t('icExchange.row'), t('icExchange.object'), t('icExchange.date'), t('icExchange.amount'), t('icExchange.reason')]}
              rows={report.balanceIssues} cells={row => [t(`icExchange.kinds.${row.balance.kind}`), fmtNumber(row.index + 1), balanceReferences(row),
                row.balance.date ? fmtDate(row.balance.date, true) : '—', fmtAmount(row.balance.amount), t(`icExchange.reasons.${row.reason}`)]} />}
            <div className="row flex-wrap gap-3">
              <Choice><Checkbox checked={stock} disabled={busy || !report.balances.stock} onChange={e => { setStock(e.target.checked); apply.reset(); }} />{t('icExchange.kinds.stock')}</Choice>
              <Choice><Checkbox checked={money} disabled={busy || !(report.balances.bank + report.balances.cash)} onChange={e => { setMoney(e.target.checked); apply.reset(); }} />{t('icExchange.money')}</Choice>
              <Choice><Checkbox checked={settlements} disabled={busy || !report.balances.settlement} onChange={e => { setSettlements(e.target.checked); apply.reset(); }} />{t('icExchange.kinds.settlement')}</Choice>
            </div>
            {openings && <div className="row items-end flex-wrap gap-3">
              <Field label={t('icExchange.openingDate')} error={date && !validDate ? t('icExchange.wrongDate') : undefined}
                hint={report.balanceDates.length ? report.balanceDates.map(day => fmtDate(day, true)).join(', ') : undefined}>
                {p => <DateInput {...p} required value={date} disabled={busy} onChange={value => { setDate(value); apply.reset(); }} />}
              </Field>
              <Choice><Checkbox checked={post} disabled={busy} onChange={e => { setPost(e.target.checked); apply.reset(); }} />{t('icExchange.post')}</Choice>
            </div>}
          </div>}
          {blocked && <Alert tone="warn">{t('errors.ic_unresolved_balances')}</Alert>}
          <div>
            <Button size="sm" variant="primary" disabled={!file || busy || !!apply.data || (!catalogTypes.length && !openings) || (openings && (!validDate || blocked))}
              onClick={() => { if (file) apply.mutate(file); }}>{t(apply.isPending ? 'icExchange.applying' : 'icExchange.apply')}</Button>
          </div>
          {apply.isError && <Alert tone="warn">{errorMessage(apply.error)}</Alert>}
          {apply.data && <Alert tone="info">{t('icExchange.applied', {
            created: fmtNumber(apply.data.createdCount), linked: fmtNumber(apply.data.linkedCount), openings: fmtNumber(apply.data.openingDocumentIds.length),
          })}</Alert>}
        </div>}
      </div>
    </section>
  );
}
