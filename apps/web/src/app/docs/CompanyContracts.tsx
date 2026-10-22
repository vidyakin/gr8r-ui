/* Contracts of a customer: the tab "Contracts" in the company card. */
import { FileSignature } from 'lucide-react';
import { BILLING_PERIODICITY_LABELS, CONTRACT_KIND_LABELS } from '@gr8r/shared';
import { Badge, EmptyState, Skeleton } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtDate, parse } from '../lib/dates';
import { useContracts, type Contract } from './billing-data';

export function CompanyContractsTab({ companyId }: { companyId: string }) {
  const contracts = useContracts({ companyId });
  const columns: Column<Contract>[] = [
    { id: 'number', header: 'Number', width: 140, value: c => c.number, cell: c => <span className="mono">{c.number || '—'}</span> },
    { id: 'kind', header: 'Kind', width: 110, value: c => CONTRACT_KIND_LABELS[c.kind], cell: c => <span className="muted">{CONTRACT_KIND_LABELS[c.kind]}</span> },
    { id: 'valid', header: 'Valid', width: 200, value: c => c.validFrom, cell: c => <span className="num muted">{c.validTo ? `${fmtDate(parse(c.validFrom))} — ${fmtDate(parse(c.validTo))}` : `${fmtDate(parse(c.validFrom))} — indefinite`}</span> },
    { id: 'service', header: 'Billing', width: 140, value: c => (c.isService ? c.periodicity ?? '' : ''), cell: c => (c.isService ? <Badge tone="accent">{c.periodicity ? BILLING_PERIODICITY_LABELS[c.periodicity] : 'Service'}</Badge> : <span className="faint">—</span>) },
    { id: 'signed', header: 'Signed', width: 100, value: c => (c.isSigned ? 'Yes' : 'No'), cell: c => (c.isSigned ? <Badge tone="green">Signed</Badge> : <span className="faint">No</span>) },
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
        <DataTable columns={columns} table={table} rows={items} getId={c => c.id} aria-label="Contracts" />
      ) : (
        <EmptyState icon={<FileSignature size={20} />} title="No contracts">
          Contracts of this customer appear here. Create one in the Contracts section.
        </EmptyState>
      )}
    </div>
  );
}
