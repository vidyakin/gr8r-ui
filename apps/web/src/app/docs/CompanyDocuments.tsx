/* Документы контрагента: вкладка «Документы» в карточке компании (задача 1097). Все документы клиента с фильтром по типу;
   у заказ-нарядов — состояние вида; итоги по выборке даёт сервер (журнал /documents, отменённые в сумму не входят).
   Итог только по одному виду: заказ, счёт и акт одной продажи в сумме посчитались бы трижды. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { CircleAlert, FileText } from 'lucide-react';
import { DOCUMENT_META, DOCUMENT_TYPES } from '@gr8r/shared';
import { Badge, Button, EmptyState, Field, Select, Skeleton } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { fmtDate, parse } from '../lib/dates';
import { STATUS_LABEL, STATUS_TONE, typeLabel, useDocumentStates, useDocuments } from './data';

const ALL = 'all';
// типы с контрагентом: у внутренних документов склада и производства его нет
const PARTY_TYPES = DOCUMENT_TYPES.filter(x => DOCUMENT_META[x].party !== null);

export function CompanyDocumentsTab({ companyId }: { companyId: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [type, setType] = React.useState(ALL);
  const docs = useDocuments({ counterpartyId: companyId, ...(type === ALL ? {} : { type }) });
  const states = useDocumentStates();
  const stateLabel = (d: { type: string; state: string | null; workOrderKindId?: string | null }) => {
    if (d.type !== 'work_order' || !d.state) return null;
    return states.data?.find(s => s.kindId === d.workOrderKindId && s.key === d.state)?.label ?? d.state;
  };

  let body: React.ReactNode;
  if (docs.isError)
    body = (
      <EmptyState icon={<CircleAlert size={20} />} error title={t('serviceReports.companyDocuments.loadFailed')} action={<Button size="sm" onClick={() => docs.refetch()}>{t('serviceReports.companyDocuments.retry')}</Button>}>
        {errorMessage(docs.error)}
      </EmptyState>
    );
  else if (docs.isPending) body = <Skeleton w="100%" h={120} />;
  else if (!docs.data.items.length)
    body = (
      <EmptyState icon={<FileText size={20} />} title={t('serviceReports.companyDocuments.emptyTitle')}>
        {t('serviceReports.companyDocuments.emptyHint')}
      </EmptyState>
    );
  else {
    const { items, sum } = docs.data;
    body = (
      <table className="dtbl" aria-label={t('serviceReports.companyDocuments.ariaLabel')}>
        <thead>
          <tr>
            <th>{t('serviceReports.companyDocuments.col.document')}</th>
            <th>{t('serviceReports.companyDocuments.col.date')}</th>
            <th>{t('serviceReports.companyDocuments.col.state')}</th>
            <th>{t('serviceReports.companyDocuments.col.status')}</th>
            <th className="r">{t('serviceReports.companyDocuments.col.amount')}</th>
            <th className="r">{t('serviceReports.companyDocuments.col.total')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map(d => (
            <tr key={d.id} className="clickable" style={{ cursor: 'pointer' }} tabIndex={0} onClick={() => navigate(`/documents/${d.id}`)} onKeyDown={e => e.key === 'Enter' && navigate(`/documents/${d.id}`)}>
              <td>
                {typeLabel(d.type)} <span className="mono faint">{d.number ?? t('serviceReports.draft')}</span>
              </td>
              <td className="num muted">{fmtDate(parse(d.date))}</td>
              <td>{stateLabel(d) ?? <span className="faint">—</span>}</td>
              <td><Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge></td>
              <td className="r num">{fmtAmount(d.amountNet)}</td>
              <td className="r num">{fmtAmount(d.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {type === ALL ? (
            <tr>
              <td colSpan={6} className="faint">{t('serviceReports.companyDocuments.sumHint')}</td>
            </tr>
          ) : (
            <tr>
              <td colSpan={4}><strong>{t('serviceReports.companyDocuments.sum')}</strong></td>
              <td className="r num"><strong>{fmtAmount(sum.net)}</strong></td>
              <td className="r num"><strong>{fmtAmount(sum.total)}</strong></td>
            </tr>
          )}
        </tfoot>
      </table>
    );
  }
  return (
    <div className="page" style={{ maxWidth: 1060, paddingTop: 12 }}>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <Field label={t('serviceReports.companyDocuments.type')}>
          {p => <Select id={p.id} value={type} onValueChange={setType} options={[{ value: ALL, label: t('serviceReports.companyDocuments.allTypes') }, ...PARTY_TYPES.map(x => ({ value: x, label: typeLabel(x) }))]} aria-label={t('serviceReports.companyDocuments.type')} />}
        </Field>
      </div>
      {body}
    </div>
  );
}
