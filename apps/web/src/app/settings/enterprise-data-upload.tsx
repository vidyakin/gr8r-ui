import { useState, type ReactNode } from 'react';
import { IC_SOURCES } from '@erp/shared';
import { Button, Field, Input, Select } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtNumber } from '@/i18n/format';
import { API_BASE, ok, type apiFor } from '../data/api';

export type IcSourceValue = typeof IC_SOURCES[number];
export type IcApi = ReturnType<typeof apiFor>['integrations']['1c'];

export function uploadEnterpriseData<T>(workspaceId: string, path: string, file: File, query: Record<string, string>) {
  return ok<T>(fetch(`${API_BASE()}/integrations/1c/${path}?${new URLSearchParams(query)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Workspace-Id': workspaceId, 'Content-Type': 'application/xml' },
    body: file,
  }));
}

export function EnterpriseDataFields({ disabled, source, setSource, setFile }: {
  disabled: boolean;
  source: IcSourceValue;
  setSource: (source: IcSourceValue) => void;
  setFile: (file: File | undefined) => void;
}) {
  const t = useT();
  return (
    <>
      <Field label={t('icLinks.source')}>
        {p => <Select id={p.id} value={source} options={IC_SOURCES.map(value => ({ value, label: t(`icLinks.sources.${value}`) }))}
          disabled={disabled} onValueChange={value => setSource(value as IcSourceValue)} />}
      </Field>
      <Field label={t('icExchange.file')} hint={t('icExchange.fileHint')}>
        {p => <Input {...p} type="file" accept=".xml,application/xml,text/xml" disabled={disabled}
          onChange={event => setFile(event.target.files?.[0])} />}
      </Field>
    </>
  );
}

export function IcReportTable<Row>({ headings, rows, cells }: {
  headings: string[];
  rows: Row[];
  cells: (row: Row) => ReactNode[];
}) {
  const t = useT();
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const pages = Math.ceil(rows.length / pageSize);
  const current = Math.min(page, Math.max(0, pages - 1));
  if (!rows.length) return <p className="muted">{t('icExchange.empty')}</p>;
  return (
    <div className="stack gap-2">
      <div className="overflow-x-auto">
        <table className="dtbl">
          <thead><tr>{headings.map((heading, i) => <th scope="col" key={i}>{heading}</th>)}</tr></thead>
          <tbody>
            {rows.slice(current * pageSize, (current + 1) * pageSize).map((row, i) => (
              <tr key={i}>{cells(row).map((cell, column) => <td key={column}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && <div className="row gap-2">
        <Button size="sm" variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>{t('icExchange.previous')}</Button>
        <span className="muted">{t('icExchange.page', { page: fmtNumber(current + 1), total: fmtNumber(pages) })}</span>
        <Button size="sm" variant="secondary" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>{t('icExchange.next')}</Button>
      </div>}
    </div>
  );
}
