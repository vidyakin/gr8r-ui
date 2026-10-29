/* Автопарк → Машины (задача 1210): справочник машин с грузоподъёмностью, объёмом, паллетами, нормой топлива лето/зима,
   пробегом и закреплённым водителем; карточка показывает документы со сроками и регламент ТО машины. */
import * as React from 'react';
import { Plus, Truck } from 'lucide-react';
import { FUEL_TYPES, VEHICLE_KINDS, VEHICLE_STATUSES, type FuelType, type VehicleKind, type VehicleStatus } from '@gr8r/shared';
import { Badge, Button, EmptyState, Skeleton, Switch } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtNumber, useT } from '@/i18n';
import { fmtDate, parse } from '../lib/dates';
import { useWorkspace } from '../data/store';
import { useMembersWith } from '../positions/data';
import { useIsAdmin } from '../catalog/data';
import { useFleetApi, useVehicle, useVehicles, type Vehicle } from './data';
import { FleetHead, FormDialog, TermBadge, intOrNull, num, type FieldDef, type Values } from './parts';

const NONE = 'none';
const STATUS_TONE = { active: 'green', repair: 'amber', inactive: 'gray' } as const;

const toValues = (v: Vehicle | null): Values => ({
  plate: v?.plate ?? '',
  name: v?.name ?? '',
  kind: v?.kind ?? 'truck',
  make: v?.make ?? '',
  model: v?.model ?? '',
  vin: v?.vin ?? '',
  year: v?.year ? String(v.year) : '',
  capacityKg: v?.capacityKg ? String(Number(v.capacityKg)) : '',
  volumeM3: v?.volumeM3 ? String(Number(v.volumeM3)) : '',
  pallets: v?.pallets !== null && v?.pallets !== undefined ? String(v.pallets) : '',
  fuelType: v?.fuelType ?? 'diesel',
  fuelNormSummer: v?.fuelNormSummer ? String(Number(v.fuelNormSummer)) : '',
  fuelNormWinter: v?.fuelNormWinter ? String(Number(v.fuelNormWinter)) : '',
  tankL: v?.tankL ? String(Number(v.tankL)) : '',
  odometer: v ? String(Number(v.odometer)) : '0',
  status: v?.status ?? 'active',
  driverMemberId: v?.driverMemberId ?? NONE,
  comment: v?.comment ?? '',
});

const body = (v: Values) => ({
  plate: String(v.plate).trim(),
  name: String(v.name).trim(),
  kind: v.kind as VehicleKind,
  make: String(v.make).trim(),
  model: String(v.model).trim(),
  vin: String(v.vin).trim(),
  year: intOrNull(v.year),
  capacityKg: num(v.capacityKg) ?? null,
  volumeM3: num(v.volumeM3) ?? null,
  pallets: intOrNull(v.pallets),
  fuelType: v.fuelType as FuelType,
  fuelNormSummer: num(v.fuelNormSummer) ?? null,
  fuelNormWinter: num(v.fuelNormWinter) ?? null,
  tankL: num(v.tankL) ?? null,
  odometer: num(v.odometer) ?? '0',
  status: v.status as VehicleStatus,
  driverMemberId: v.driverMemberId === NONE ? null : String(v.driverMemberId),
  comment: String(v.comment),
});

export function VehicleDialog({ vehicle, onClose }: { vehicle: Vehicle | null; onClose: () => void }) {
  const t = useT();
  const api = useFleetApi();
  const isAdmin = useIsAdmin();
  const members = useMembersWith(useWorkspace().data.members, 'driver', [vehicle?.driverMemberId]);
  const detail = useVehicle(vehicle?.id ?? null);
  const fields: FieldDef[] = [
    { key: 'plate', label: t('fleet.vehicle.plate'), type: 'text', required: true },
    { key: 'name', label: t('fleet.vehicle.name'), type: 'text' },
    { key: 'kind', label: t('fleet.vehicle.kind'), type: 'select', options: VEHICLE_KINDS.map(k => ({ value: k, label: t(`fleet.kind.${k}`) })) },
    { key: 'make', label: t('fleet.vehicle.make'), type: 'text' },
    { key: 'model', label: t('fleet.vehicle.model'), type: 'text' },
    { key: 'vin', label: t('fleet.vehicle.vin'), type: 'text' },
    { key: 'year', label: t('fleet.vehicle.year'), type: 'number' },
    { key: 'capacityKg', label: t('fleet.vehicle.capacityKg'), type: 'number' },
    { key: 'volumeM3', label: t('fleet.vehicle.volumeM3'), type: 'number' },
    { key: 'pallets', label: t('fleet.vehicle.pallets'), type: 'number' },
    { key: 'fuelType', label: t('fleet.vehicle.fuelType'), type: 'select', options: FUEL_TYPES.map(k => ({ value: k, label: t(`fleet.fuelType.${k}`) })) },
    { key: 'fuelNormSummer', label: t('fleet.vehicle.normSummer'), type: 'number', hint: t('fleet.vehicle.normHint') },
    { key: 'fuelNormWinter', label: t('fleet.vehicle.normWinter'), type: 'number' },
    { key: 'tankL', label: t('fleet.vehicle.tank'), type: 'number' },
    { key: 'odometer', label: t('fleet.vehicle.odometer'), type: 'number' },
    { key: 'status', label: t('fleet.vehicle.status'), type: 'select', options: VEHICLE_STATUSES.map(k => ({ value: k, label: t(`fleet.vehicleStatus.${k}`) })) },
    { key: 'driverMemberId', label: t('fleet.vehicle.driver'), type: 'select', options: [{ value: NONE, label: t('fleet.vehicle.noDriver') }, ...members.map(m => ({ value: m.id, label: m.name }))] },
    { key: 'comment', label: t('fleet.comment'), type: 'textarea' },
  ];
  const d = detail.data;
  return (
    <FormDialog
      title={vehicle ? `${vehicle.plate} ${vehicle.name}`.trim() : t('fleet.vehicle.new')}
      size="lg"
      fields={fields}
      initial={toValues(vehicle)}
      onClose={onClose}
      onSubmit={async v => !!(vehicle ? await api('PATCH', `vehicles/${vehicle.id}`, body(v)) : await api('POST', 'vehicles', body(v)))}
      footerExtra={
        vehicle && isAdmin ? (
          <Button
            variant="ghost"
            onClick={async () => {
              if (await api('POST', `vehicles/${vehicle.id}/${vehicle.archivedAt ? 'restore' : 'archive'}`)) onClose();
            }}
          >
            {vehicle.archivedAt ? t('fleet.restore') : t('fleet.archive')}
          </Button>
        ) : null
      }
      extra={() =>
        vehicle && d ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="label">{t('fleet.vehicle.documents')}</div>
            {d.documents.length ? (
              d.documents.map(x => (
                <div key={x.id} className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                  <span>{t(`fleet.docKind.${x.kind}`)} {x.number}</span>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="muted num">{x.validUntil ? fmtDate(parse(x.validUntil)) : ''}</span>
                    <TermBadge state={x.state} daysLeft={x.daysLeft} />
                  </span>
                </div>
              ))
            ) : (
              <span className="muted">{t('fleet.vehicle.noDocuments')}</span>
            )}
            <div className="label">{t('fleet.vehicle.plans')}</div>
            {d.servicePlans.length ? (
              d.servicePlans.map(p => (
                <div key={p.id} className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                  <span>{p.name}</span>
                  <Badge tone={p.due.overdue ? 'red' : p.due.soon ? 'amber' : 'green'}>
                    {p.due.leftKm !== null ? t('fleet.service.leftKm', { km: fmtNumber(p.due.leftKm) }) : p.due.dueDate ? fmtDate(parse(p.due.dueDate)) : '—'}
                  </Badge>
                </div>
              ))
            ) : (
              <span className="muted">{t('fleet.vehicle.noPlans')}</span>
            )}
          </div>
        ) : null
      }
    />
  );
}

export function VehiclesPage() {
  const t = useT();
  const [archived, setArchived] = React.useState(false);
  const list = useVehicles(archived ? { archived: 'include' } : {});
  const [edit, setEdit] = React.useState<Vehicle | 'new' | null>(null);
  const rows = list.data?.items ?? [];
  const columns = React.useMemo<Column<Vehicle>[]>(
    () => [
      { id: 'plate', header: t('fleet.vehicle.plate'), width: 130, value: r => r.plate, cell: r => <b>{r.plate}</b> },
      { id: 'model', header: t('fleet.vehicle.model'), width: 220, value: r => `${r.name} ${r.make} ${r.model}`, cell: r => <span className="trunc">{r.name || [r.make, r.model].filter(Boolean).join(' ') || '—'}</span> },
      { id: 'kind', header: t('fleet.vehicle.kind'), width: 120, value: r => r.kind, cell: r => t(`fleet.kind.${r.kind}`) },
      { id: 'cap', header: t('fleet.vehicle.capacity'), width: 180, align: 'right', value: r => Number(r.capacityKg ?? 0), cell: r => <span className="num">{r.capacityKg ? `${fmtNumber(r.capacityKg)} ${t('fleet.unit.kg')}` : '—'}{r.volumeM3 ? ` · ${fmtNumber(r.volumeM3)} ${t('fleet.unit.m3')}` : ''}{r.pallets ? ` · ${r.pallets} ${t('fleet.unit.pal')}` : ''}</span> },
      { id: 'norm', header: t('fleet.vehicle.norm'), width: 130, align: 'right', value: r => Number(r.fuelNormSummer ?? 0), cell: r => <span className="num">{r.fuelNormSummer ? `${fmtNumber(r.fuelNormSummer)} / ${fmtNumber(r.fuelNormWinter ?? r.fuelNormSummer)}` : '—'}</span> },
      { id: 'odometer', header: t('fleet.vehicle.odometer'), width: 120, align: 'right', value: r => Number(r.odometer), cell: r => <span className="num">{fmtNumber(r.odometer)}</span> },
      { id: 'driver', header: t('fleet.vehicle.driver'), width: 170, value: r => r.driverName ?? '', cell: r => <span className="muted trunc">{r.driverName ?? '—'}</span> },
      {
        id: 'docs',
        header: t('fleet.vehicle.documents'),
        width: 150,
        value: r => r.docsExpired * 100 + r.docsExpiring,
        cell: r => (r.docsExpired ? <Badge tone="red">{t('fleet.term.expiredCount', { n: r.docsExpired })}</Badge> : r.docsExpiring ? <Badge tone="amber">{t('fleet.term.expiringCount', { n: r.docsExpiring })}</Badge> : <span className="faint">—</span>),
      },
      { id: 'status', header: t('fleet.vehicle.status'), width: 120, value: r => r.status, cell: r => <Badge tone={r.archivedAt ? 'gray' : STATUS_TONE[r.status]}>{r.archivedAt ? t('fleet.archived') : t(`fleet.vehicleStatus.${r.status}`)}</Badge> },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'plate', dir: 1 } });
  return (
    <div className="page flush">
      <FleetHead
        title={t('fleet.vehicles.title')}
        lead={t('fleet.vehicles.lead')}
        actions={
          <>
            <label className="row" style={{ gap: 6, fontSize: 12 }}>
              <Switch checked={archived} aria-label={t('fleet.showArchived')} onChange={e => setArchived(e.target.checked)} />
              {t('fleet.showArchived')}
            </label>
            <Button size="sm" onClick={() => setEdit('new')}>
              <Plus size={13} />
              {t('fleet.vehicle.new')}
            </Button>
          </>
        }
      />
      {list.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : (
        <DataTable aria-label={t('fleet.vehicles.title')} columns={columns} rows={rows} table={table} getId={r => r.id} onRowClick={r => setEdit(r)} empty={<EmptyState icon={<Truck size={20} />} title={t('fleet.vehicles.empty')}>{t('fleet.vehicles.emptyHint')}</EmptyState>} />
      )}
      {edit && <VehicleDialog key={edit === 'new' ? 'new' : edit.id} vehicle={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
