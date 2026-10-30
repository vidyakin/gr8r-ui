/* Реквизиты контрагента: вкладка в карточке компании. */
import { Skeleton } from '@/components/ui';
import { COMPANY_KIND_LABELS } from '@gr8r/shared';
import { tEnum, useT } from '@/i18n';
import { useCompanyRequisites } from './data';

export function CompanyRequisitesTab({ companyId }: { companyId: string }) {
  const reqs = useCompanyRequisites(companyId);
  const t = useT();
  if (reqs.isPending) return <Skeleton w="100%" h={160} />;
  const r = reqs.data;
  if (!r) return null;
  return (
    <div className="page" style={{ maxWidth: 980, paddingTop: 12 }}>
      <dl className="kv">
        <dt>{t('docs.requisites.kind')}</dt>
        <dd>{tEnum('companyKind', r.kind, COMPANY_KIND_LABELS[r.kind])}</dd>
        <dt>{t('docs.requisites.fullName')}</dt>
        <dd>{r.name}</dd>
        {r.inn && (
          <>
            <dt>{t('docs.requisites.inn')}</dt>
            <dd className="mono">{r.inn}</dd>
          </>
        )}
        {r.kpp && (
          <>
            <dt>{t('docs.requisites.kpp')}</dt>
            <dd className="mono">{r.kpp}</dd>
          </>
        )}
        {r.ogrn && (
          <>
            <dt>{t('docs.requisites.ogrn')}</dt>
            <dd className="mono">{r.ogrn}</dd>
          </>
        )}
        {r.legalAddress && (
          <>
            <dt>{t('docs.requisites.legalAddress')}</dt>
            <dd>{r.legalAddress}</dd>
          </>
        )}
        {r.actualAddress && (
          <>
            <dt>{t('docs.requisites.actualAddress')}</dt>
            <dd>{r.actualAddress}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
