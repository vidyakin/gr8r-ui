/* Договоры контрагента: вкладка «Договоры» в карточке компании. */
import { FileSignature } from 'lucide-react';
import { BILLING_PERIODICITY_LABELS, CONTRACT_KIND_LABELS } from '@gr8r/shared';
import { Badge, EmptyState, Skeleton } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { useT, tEnum } from '@/i18n';
import { fmtDate, parse } from '../lib/dates';
import { useContracts, type Contract } from './billing-data';

export function CompanyContractsTab({ companyId }: { companyId: string }) {
  const contracts = useContracts({ companyId });
  const t = useT();
  const columns: Column<Contract>[] = [
    { id: 'number', header: t('docs.counterpartyContracts.col.number'), width: 140, value: c => c.number, cell: c => <span className="mono">{c.number || '—'}</span> },
    { id: 'kind', header: t('docs.counterpartyContracts.col.kind'), width: 110, value: c => tEnum('contractKind', 'k_' + c.kind, CONTRACT_KIND_LABELS[c.kind]), cell: c => <span className="muted">{tEnum('contractKind', 'k_' + c.kind, CONTRACT_KIND_LABELS[c.kind])}</span> },
    { id: 'valid', header: t('docs.counterpartyContracts.col.valid'), width: 200, value: c => c.validFrom, cell: c => <span className="num muted">{c.validTo ? `${fmtDate(parse(c.validFrom))} — ${fmtDate(parse(c.validTo))}` : `${fmtDate(parse(c.validFrom))} — ${t('docs.counterpartyContracts.indefinite')}`}</span> },
    { id: 'service', header: t('docs.counterpartyContracts.col.billing'), width: 140, value: c => (c.isService ? c.periodicity ?? '' : ''), cell: c => (c.isService ? <Badge tone="accent">{c.periodicity ? tEnum('periodicity', c.periodicity, BILLING_PERIODICITY_LABELS[c.periodicity]) : t('docs.counterpartyContracts.service')}</Badge> : <span className="faint">—</span>) },
    { id: 'signed', header: t('docs.counterpartyContracts.col.signed'), width: 100, value: c => (c.isSigned ? t('common.yes') : t('common.no')), cell: c => (c.isSigned ? <Badge tone="green">{t('docs.counterpartyContracts.signed')}</Badge> : <span className="faint">{t('common.no')}</span>) },
  ];
  const table = useDataTable(columns, {});
  if (contracts.isPending)
    return (
      <div className="page" style={{ maxWidth: 980, paddingTop: 12 }}>
        <Skeleton w="100%" h={120} />
      </div>
    );
  const items = contracts.data?.items ?? [];
  return (
    <div className="page" style={{ maxWidth: 980, paddingTop: 12 }}>
      {items.length ? (
        <DataTable columns={columns} table={table} rows={items} getId={c => c.id} aria-label={t('docs.counterpartyContracts.ariaLabel')} />
      ) : (
        <EmptyState icon={<FileSignature size={20} />} title={t('docs.counterpartyContracts.emptyTitle')}>
          {t('docs.counterpartyContracts.emptyHint')}
        </EmptyState>
      )}
    </div>
  );
}
