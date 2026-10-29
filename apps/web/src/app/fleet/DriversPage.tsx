/* Автопарк → Водители (задача 1210): участники с должностью-функцией «водитель» (Настройки → Должности), удостоверение,
   категории, телефон и документы водителя со сроками (права, медсправка). */
import * as React from 'react';
import { Badge, EmptyState, Skeleton } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { UserRound } from 'lucide-react';
import { useT } from '@/i18n';
import { fmtDate, parse } from '../lib/dates';
import { useDrivers, useFleetApi, useFleetDocs, type Driver } from './data';
import { FleetHead, FormDialog, TermBadge } from './parts';

function DriverDialog({ driver, onClose }: { driver: Driver; onClose: () => void }) {
  const t = useT();
  const api = useFleetApi();
  const docs = useFleetDocs({ memberId: driver.memberId });
  return (
    <FormDialog
      title={driver.name}
      description={driver.email}
      fields={[
        { key: 'licenseNumber', label: t('fleet.driver.license'), type: 'text' },
        { key: 'categories', label: t('fleet.driver.categories'), type: 'text', hint: t('fleet.driver.categoriesHint') },
        { key: 'phone', label: t('fleet.driver.phone'), type: 'text' },
        { key: 'comment', label: t('fleet.comment'), type: 'textarea' },
      ]}
      initial={{ licenseNumber: driver.licenseNumber, categories: driver.categories.join(', '), phone: driver.phone, comment: driver.comment }}
      onClose={onClose}
      onSubmit={async v => !!(await api('PUT', `drivers/${driver.memberId}`, { licenseNumber: String(v.licenseNumber).trim(), categories: String(v.categories).split(/[\s,;]+/).filter(Boolean).map(s => s.toUpperCase()), phone: String(v.phone).trim(), comment: String(v.comment) }))}
      extra={() => (
        <div className="stack" style={{ gap: 8 }}>
          <div className="label">{t('fleet.driver.documents')}</div>
          {(docs.data?.items ?? []).length ? (
            docs.data!.items.map(x => (
              <div key={x.id} className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                <span>{t(`fleet.docKind.${x.kind}`)} {x.number}</span>
                <span className="row" style={{ gap: 8 }}>
                  <span className="muted num">{x.validUntil ? fmtDate(parse(x.validUntil)) : ''}</span>
                  <TermBadge state={x.state} daysLeft={x.daysLeft} />
                </span>
              </div>
            ))
          ) : (
            <span className="muted">{t('fleet.driver.noDocuments')}</span>
          )}
        </div>
      )}
    />
  );
}

export function DriversPage() {
  const t = useT();
  const list = useDrivers();
  const [edit, setEdit] = React.useState<Driver | null>(null);
  const columns = React.useMemo<Column<Driver>[]>(
    () => [
      { id: 'name', header: t('fleet.driver.name'), width: 220, value: r => r.name, cell: r => <b>{r.name}</b> },
      { id: 'license', header: t('fleet.driver.license'), width: 170, value: r => r.licenseNumber, cell: r => <span className="num">{r.licenseNumber || '—'}</span> },
      { id: 'categories', header: t('fleet.driver.categories'), width: 140, value: r => r.categories.join(' '), cell: r => r.categories.map(c => <Badge key={c} className="mr-1">{c}</Badge>) },
      { id: 'phone', header: t('fleet.driver.phone'), width: 160, value: r => r.phone, cell: r => (r.phone ? <a className="crm-link" href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} onClick={e => e.stopPropagation()}>{r.phone}</a> : <span className="faint">—</span>) },
      { id: 'vehicles', header: t('fleet.driver.vehicles'), width: 180, value: r => r.vehicles.map(v => v.plate).join(' '), cell: r => <span className="muted">{r.vehicles.map(v => v.plate).join(', ') || '—'}</span> },
      { id: 'docs', header: t('fleet.driver.documents'), width: 150, value: r => r.docsExpired * 100 + r.docsExpiring, cell: r => (r.docsExpired ? <Badge tone="red">{t('fleet.term.expiredCount', { n: r.docsExpired })}</Badge> : r.docsExpiring ? <Badge tone="amber">{t('fleet.term.expiringCount', { n: r.docsExpiring })}</Badge> : <span className="faint">—</span>) },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'name', dir: 1 } });
  return (
    <div className="page flush">
      <FleetHead title={t('fleet.drivers.title')} lead={t('fleet.drivers.lead')} />
      {list.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : (
        <DataTable aria-label={t('fleet.drivers.title')} columns={columns} rows={list.data?.items ?? []} table={table} getId={r => r.memberId} onRowClick={setEdit} empty={<EmptyState icon={<UserRound size={20} />} title={t('fleet.drivers.empty')}>{t('fleet.drivers.emptyHint')}</EmptyState>} />
      )}
      {edit && <DriverDialog key={edit.memberId} driver={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
