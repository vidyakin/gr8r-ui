/* КП сделки: вкладка карточки сделки (задача 1252). Список КП со связью deal_id и кнопка «Создать КП»:
   новое КП получает контрагента сделки; у сделки без контрагента кнопка недоступна. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { CircleAlert, FilePlus, FileText } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton, Tooltip } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useCanWrite } from '../meta/custom-fields';
import { fmtDate, parse } from '../lib/dates';
import { STATUS_LABEL, STATUS_TONE, useDocsApi, useDocuments, type DocDetail } from './data';

export function useDealQuoteCount(dealId: string): number | undefined {
  return useDocuments({ type: 'quote', dealId }).data?.items.length;
}

export function CreateQuoteButton({ dealId, hasCompany }: { dealId: string; hasCompany: boolean }) {
  const t = useT();
  const api = useDocsApi();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const [busy, setBusy] = React.useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<DocDetail>('POST', '/documents', { type: 'quote', dealId });
      if (r) navigate(`/documents/${r.id}`);
    } finally {
      setBusy(false);
    }
  };
  const btn = (
    <Button size="sm" variant="primary" disabled={!hasCompany || !canWrite || busy} onClick={create}>
      <FilePlus size={13} />
      {t('crm.deals.drawer.quoteCreate')}
    </Button>
  );
  return hasCompany ? btn : <Tooltip content={t('crm.deals.drawer.quoteNoCompany')}><span style={{ display: 'inline-flex' }}>{btn}</span></Tooltip>;
}

export function DealQuotesTab({ dealId, hasCompany }: { dealId: string; hasCompany: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const docs = useDocuments({ type: 'quote', dealId });
  let body: React.ReactNode;
  if (docs.isError)
    body = (
      <EmptyState icon={<CircleAlert size={20} />} error title={t('crm.deals.drawer.quoteLoadFailed')} action={<Button size="sm" onClick={() => docs.refetch()}>{t('crm.deals.drawer.quoteRetry')}</Button>}>
        {errorMessage(docs.error)}
      </EmptyState>
    );
  else if (docs.isPending) body = <Skeleton w="100%" h={80} />;
  else if (!docs.data.items.length)
    body = (
      <EmptyState icon={<FileText size={20} />} title={t('crm.deals.drawer.quoteEmpty')}>
        {t('crm.deals.drawer.quoteEmptyHint')}
      </EmptyState>
    );
  else
    body = (
      <table className="dtbl" aria-label={t('crm.deals.drawer.quoteAria')}>
        <thead>
          <tr>
            <th>{t('crm.deals.drawer.quoteCol')}</th>
            <th>{t('crm.deals.drawer.quoteDate')}</th>
            <th>{t('crm.deals.drawer.quoteStatus')}</th>
            <th className="r">{t('crm.deals.drawer.quoteTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {docs.data.items.map(d => (
            <tr key={d.id} className="clickable" style={{ cursor: 'pointer' }} tabIndex={0} onClick={() => navigate(`/documents/${d.id}`)} onKeyDown={e => e.key === 'Enter' && navigate(`/documents/${d.id}`)}>
              <td className="mono">{d.number ?? t('crm.deals.drawer.quoteDraft')}</td>
              <td className="num muted">{fmtDate(parse(d.date))}</td>
              <td><Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge></td>
              <td className="r num">{fmtAmount(d.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  return (
    <div style={{ paddingTop: 8 }}>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <span className="sp" />
        <CreateQuoteButton dealId={dealId} hasCompany={hasCompany} />
      </div>
      {body}
    </div>
  );
}
