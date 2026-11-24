import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { IC_CATALOG_TYPES, IC_MONEY_DOCUMENT_TYPES, IC_TRADE_DOCUMENT_TYPES, icExportRequest, icExportSchedule, type EnterpriseDataOptions, type EnterpriseDataSchedule, type EnterpriseDataSummary } from '@erp/shared';
import { DateInput } from '@/components/erp/date-picker';
import { Alert, Button, Checkbox, Choice, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtNumber } from '@/i18n/format';
import { apiFor, errorMessage, ok } from '../data/api';
import { useOrganizations } from '../docs/data';
import { fmtDate, iso, today } from '../lib/dates';
import { useWsId } from '../meta/data';

type DocumentType = NonNullable<EnterpriseDataOptions['documentTypes']>[number];
interface ScheduleStatus {
  options: EnterpriseDataSchedule;
  exportedDate: string | null;
  failedAt: string | null;
}

async function downloadXml(response: Pick<Response, 'ok' | 'status' | 'statusText' | 'json' | 'headers' | 'blob'>, date: string) {
  if (!response.ok) await ok(response);
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = response.headers.get('Content-Disposition')?.match(/filename="(1c-buh3-\d{4}-\d{2}-\d{2}\.xml)"/)?.[1]
    ?? `1c-buh3-${date}.xml`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Export1c() {
  const t = useT();
  const ws = useWsId();
  const api = apiFor(ws).integrations['1c'].export;
  const schedule = useQuery({
    queryKey: ['ws', ws, 'ic-export-schedule'],
    queryFn: () => ok<ScheduleStatus | null>(api.schedule.$get()),
    refetchInterval: 60_000,
  });
  return (
    <section className="sblock">
      <h2>{t('icExport.title')}</h2>
      {schedule.isPending ? <Skeleton w="100%" h={80} /> : (
        <ExportForm key={ws} schedule={schedule.data} scheduleError={schedule.isError} />
      )}
    </section>
  );
}

function ExportForm({ schedule, scheduleError }: { schedule?: ScheduleStatus | null; scheduleError: boolean }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const api = apiFor(ws).integrations['1c'].export;
  const organizations = useOrganizations();
  const saved = schedule?.options;
  const [dateTo, setDateTo] = useState(() => iso(today()));
  const [dateFrom, setDateFrom] = useState(() => `${dateTo.slice(0, 7)}-01`);
  const [organization, setOrganization] = useState(saved?.organizationId ?? 'all');
  const [version, setVersion] = useState(saved?.version ?? '1.15');
  const [catalogs, setCatalogs] = useState(saved?.includeCatalogs !== false);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>(() =>
    saved?.includeDocuments === false ? [] : saved?.documentTypes ?? [...IC_TRADE_DOCUMENT_TYPES, ...IC_MONEY_DOCUMENT_TYPES]);
  const [saveLinks, setSaveLinks] = useState(saved?.saveLinks ?? false);
  const [enabled, setEnabled] = useState(saved?.enabled ?? false);
  const [time, setTime] = useState(saved?.time ?? '07:00');
  const selection = { organizationId: organization === 'all' ? undefined : organization, version, includeCatalogs: catalogs, catalogTypes: saved?.catalogTypes, documentTypes, saveLinks };
  const request = { ...selection, dateFrom, dateTo };
  const scheduleOptions = { ...selection, enabled, time: enabled ? time : saved?.time ?? '07:00' };
  const invalidRange = !!dateFrom && !!dateTo && dateFrom > dateTo;
  const validSelection = catalogs || documentTypes.length > 0;

  const preview = useMutation({
    mutationFn: (options: EnterpriseDataOptions) => ok<EnterpriseDataSummary>(api.preview.$post({ json: options })),
    onError: error => toast.error(errorMessage(error)),
  });
  const download = useMutation({
    mutationFn: async (options: EnterpriseDataOptions) => downloadXml(await api.$post({ json: options }), options.dateTo),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ws', ws, 'ic-links'] }),
    onError: error => toast.error(errorMessage(error)),
  });
  const saveSchedule = useMutation({
    mutationFn: (options: EnterpriseDataSchedule) => ok(api.schedule.$put({ json: options })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ws', ws, 'ic-export-schedule'] });
      toast(t('icExport.scheduleSaved'));
    },
    onError: error => toast.error(errorMessage(error)),
  });
  const latest = useMutation({
    mutationFn: async (date: string) => downloadXml(await api.latest.$get(), date),
    onError: error => toast.error(errorMessage(error)),
  });

  const busy = preview.isPending || download.isPending || saveSchedule.isPending || latest.isPending;
  const validPeriod = validSelection && icExportRequest.safeParse(request).success;
  const summary = preview.data && JSON.stringify(preview.variables) === JSON.stringify(request) ? preview.data : undefined;
  const group = (label: string, types: readonly DocumentType[]) => (
    <Choice>
      <Checkbox
        checked={types.every(type => documentTypes.includes(type))}
        indeterminate={types.some(type => documentTypes.includes(type)) && !types.every(type => documentTypes.includes(type))}
        disabled={busy}
        onChange={() => setDocumentTypes(current => types.every(type => current.includes(type))
          ? current.filter(type => !types.includes(type))
          : [...new Set([...current, ...types])])}
      />
      {label}
    </Choice>
  );
  const organizationOptions = [
    { value: 'all', label: t('icExport.allOrganizations') },
    ...(organizations.data ?? []).map(row => ({ value: row.id, label: row.name })),
  ];
  if (!organizationOptions.some(option => option.value === organization)) {
    organizationOptions.push({ value: organization, label: organization });
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {organizations.isError && <Alert tone="warn">{t('icExport.organizationsError')}</Alert>}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Field label={t('icLinks.types.organization')}>
          {p => <Select id={p.id} value={organization} options={organizationOptions} onValueChange={setOrganization} disabled={busy || organizations.isPending} />}
        </Field>
        <Field label={t('icExport.dateFrom')}>
          {p => <DateInput {...p} required value={dateFrom} max={dateTo} disabled={busy} onChange={setDateFrom} />}
        </Field>
        <Field label={t('icExport.dateTo')} error={invalidRange ? t('icExport.invalidRange') : undefined}>
          {p => <DateInput {...p} required value={dateTo} min={dateFrom} disabled={busy} onChange={setDateTo} />}
        </Field>
        <Field label={t('icExport.version')}>
          {p => <Select id={p.id} value={version} options={[{ value: '1.15', label: '1.15' }, { value: '1.17', label: '1.17' }]}
            onValueChange={value => setVersion(value === '1.17' ? '1.17' : '1.15')} disabled={busy} />}
        </Field>
      </div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <Choice><Checkbox checked={catalogs} disabled={busy} onChange={e => setCatalogs(e.target.checked)} />{t('icExport.catalogs')}</Choice>
        {group(t('icExport.tradeDocuments'), IC_TRADE_DOCUMENT_TYPES)}
        {group(t('icExport.moneyDocuments'), IC_MONEY_DOCUMENT_TYPES)}
        <Choice><Checkbox checked={saveLinks} disabled={busy} onChange={e => setSaveLinks(e.target.checked)} />{t('icExport.saveLinks')}</Choice>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button size="sm" variant="secondary" disabled={busy || !validPeriod} onClick={() => preview.mutate(request)}>
          {t(preview.isPending ? 'icExport.previewing' : 'icExport.preview')}
        </Button>
        <Button size="sm" variant="primary" disabled={busy || !validPeriod} onClick={() => download.mutate(request)}>
          <Download size={14} /> {t(download.isPending ? 'icExport.preparing' : 'icExport.download')}
        </Button>
      </div>
      {summary && (
        <div aria-live="polite" className="stack" style={{ gap: 6 }}>
          <strong>{t('icExport.total', { n: fmtNumber(summary.totalObjects) })}</strong>
          {!!summary.totalObjects && (
            <ul>
              {IC_CATALOG_TYPES.filter(type => summary.catalogs[type]).map(type => (
                <li key={type}>{t(`icLinks.types.${type}`)} · {fmtNumber(summary.catalogs[type]!)}</li>
              ))}
              {[...IC_TRADE_DOCUMENT_TYPES, ...IC_MONEY_DOCUMENT_TYPES].filter(type => summary.documents[type]).map(type => (
                <li key={type}>{t(`icExport.documents.${type}`)} · {fmtNumber(summary.documents[type]!)}</li>
              ))}
            </ul>
          )}
          {summary.warnings.length > 0 && (
            <Alert tone="warn">
              <ul>{summary.warnings.map((warning, i) => <li key={i}>{warning === 'legacy_vat' ? t('icExport.legacyVat')
                : warning.startsWith('missing_inn:') ? t('icExport.missingInn', { name: warning.slice('missing_inn:'.length) })
                  : warning}</li>)}</ul>
            </Alert>
          )}
        </div>
      )}
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        <h3>{t('icExport.schedule')}</h3>
        <p className="muted">{t('icExport.scheduleHint')}</p>
        {scheduleError && <Alert tone="warn">{t('icExport.scheduleError')}</Alert>}
        {schedule?.failedAt && <Alert tone="warn">{t('icExport.scheduleFailed')}</Alert>}
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Choice><Checkbox checked={enabled} disabled={busy || scheduleError} onChange={e => setEnabled(e.target.checked)} />{t('icExport.scheduleEnabled')}</Choice>
          <Field label={t('icExport.scheduleTime')}>
            {p => <Input {...p} type="time" value={time} disabled={busy || !enabled || scheduleError} onChange={e => setTime(e.target.value)} />}
          </Field>
          <Button size="sm" variant="secondary" disabled={busy || scheduleError || (enabled && !validSelection) || !icExportSchedule.safeParse(scheduleOptions).success}
            onClick={() => saveSchedule.mutate(scheduleOptions)}>{t('icExport.scheduleSave')}</Button>
          {schedule?.exportedDate && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => latest.mutate(schedule.exportedDate!)}>
              <Download size={14} /> {t('icExport.scheduleDownload', { date: fmtDate(schedule.exportedDate) })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
