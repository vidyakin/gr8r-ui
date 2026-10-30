/* Транспорт → Рейсы (задача 1211): список рейсов с отбором по периоду, машине, статусу и виду, карточка рейса, настройка контроля вместимости. */
import * as React from 'react';
import { Plus, Settings2, Waypoints } from 'lucide-react';
import { TRIP_KINDS, TRIP_STATUSES } from '@gr8r/shared';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtNumber, useT } from '@/i18n';
import { iso, today, fmtDate, parse } from '../lib/dates';
import { useIsAdmin } from '../catalog/data';
import { useVehicles } from '../fleet/data';
import { FleetHead } from '../fleet/parts';
import { TRIP_TONE, TripDialog, useOverloadText } from './TripDialog';
import { RoutingSettingsDialog } from './RoutingSettings';
import { useRouting, useTripApi, useTripSettings, useTrips, type Trip } from './data';

const ALL = 'all';

export function TripsPage() {
  const t = useT();
  const isAdmin = useIsAdmin();
  const api = useTripApi();
  const overloadText = useOverloadText();
  const vehicles = useVehicles().data?.items ?? [];
  const settings = useTripSettings().data;
  const routing = useRouting().data;
  const [routingOpen, setRoutingOpen] = React.useState(false);
  const [from, setFrom] = React.useState(iso(new Date(today().getTime() - 14 * 86400000)));
  const [to, setTo] = React.useState(iso(new Date(today().getTime() + 14 * 86400000)));
  const [vehicle, setVehicle] = React.useState(ALL);
  const [status, setStatus] = React.useState(ALL);
  const [kind, setKind] = React.useState(ALL);
  const [q, setQ] = React.useState('');
  const list = useTrips({ from, to, ...(vehicle === ALL ? {} : { vehicleId: vehicle }), ...(status === ALL ? {} : { status }), ...(kind === ALL ? {} : { kind }), ...(q.trim() ? { q: q.trim() } : {}) });
  const [edit, setEdit] = React.useState<string | 'new' | null>(null);
  const columns = React.useMemo<Column<Trip>[]>(
    () => [
      { id: 'number', header: t('trips.col.number'), width: 140, value: r => r.number, cell: r => <b>{r.number}</b> },
      { id: 'date', header: t('trips.col.date'), width: 170, value: r => r.dateFrom, cell: r => <span className="num">{r.dateTo === r.dateFrom ? fmtDate(parse(r.dateFrom)) : `${fmtDate(parse(r.dateFrom))} — ${fmtDate(parse(r.dateTo))}`}</span> },
      { id: 'kind', header: t('trips.col.kind'), width: 130, value: r => r.kind, cell: r => <span className="muted">{t(`trips.kind.${r.kind}`).split(' (')[0]}</span> },
      { id: 'name', header: t('trips.field.name'), width: 200, value: r => r.name, cell: r => <span className="trunc">{r.name || '—'}</span> },
      { id: 'vehicle', header: t('trips.col.vehicle'), width: 120, value: r => r.plate, cell: r => r.plate },
      { id: 'driver', header: t('trips.col.driver'), width: 170, value: r => r.driverName, cell: r => <span className="trunc">{r.hired ? [r.carrierName ?? t('trips.hiredLane'), r.driverName].filter(Boolean).join(' · ') : r.driverName}</span> },
      { id: 'stops', header: t('trips.col.stops'), width: 90, align: 'right', value: r => r.stopsTotal, cell: r => <span className="num">{r.stopsDone}/{r.stopsTotal}</span> },
      {
        id: 'load',
        header: t('trips.col.load'),
        width: 190,
        align: 'right',
        value: r => Number(r.load.weightKg),
        cell: r => (
          <span className="num" title={r.overloads.length ? overloadText(r.overloads) : undefined} style={{ color: r.overloads.length ? 'var(--red)' : undefined }}>
            {fmtNumber(r.load.weightKg)}{r.limits.capacityKg ? ` / ${fmtNumber(r.limits.capacityKg)}` : ''}
          </span>
        ),
      },
      { id: 'km', header: t('trips.col.km'), width: 120, align: 'right', value: r => Number(r.routeKm ?? r.straightKm ?? 0), cell: r => <span className="num muted">{r.routeKm ?? r.straightKm ? fmtNumber((r.routeKm ?? r.straightKm)!) : '—'}</span> },
      { id: 'status', header: t('trips.col.status'), width: 120, value: r => r.status, cell: r => <Badge tone={TRIP_TONE[r.status]}>{t(`trips.status.${r.status}`)}</Badge> },
    ],
    [t, overloadText],
  );
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });
  return (
    <div className="page flush">
      <FleetHead
        title={t('trips.title')}
        lead={t('trips.lead')}
        actions={
          <>
            {isAdmin && routing && (
              <Button size="sm" variant="ghost" onClick={() => setRoutingOpen(true)}>
                <Settings2 size={13} />
                {t('trips.routing.open')}
              </Button>
            )}
          <Button size="sm" onClick={() => setEdit('new')}>
            <Plus size={13} />
            {t('trips.new')}
          </Button>
          </>
        }
      />
      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('trips.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} />}</Field>
          <Field label={t('trips.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || to)} />}</Field>
          <Field label={t('trips.field.vehicle')}>
            {p => <Select id={p.id} aria-label={t('trips.field.vehicle')} value={vehicle} onValueChange={setVehicle} options={[{ value: ALL, label: t('trips.all') }, ...vehicles.map(v => ({ value: v.id, label: v.plate }))]} />}
          </Field>
          <Field label={t('trips.col.status')}>
            {p => <Select id={p.id} aria-label={t('trips.col.status')} value={status} onValueChange={setStatus} options={[{ value: ALL, label: t('trips.all') }, ...TRIP_STATUSES.map(s => ({ value: s, label: t(`trips.status.${s}`) }))]} />}
          </Field>
          <Field label={t('trips.col.kind')}>
            {p => <Select id={p.id} aria-label={t('trips.col.kind')} value={kind} onValueChange={setKind} options={[{ value: ALL, label: t('trips.all') }, ...TRIP_KINDS.map(k => ({ value: k, label: t(`trips.kind.${k}`) }))]} />}
          </Field>
          <Field label={t('trips.search')}>{p => <Input {...p} value={q} onChange={e => setQ(e.target.value)} />}</Field>
          {isAdmin && settings && (
            <Field label={t('trips.settings.title')} hint={t('trips.settings.hint')}>
              {p => (
                <Select
                  id={p.id}
                  aria-label={t('trips.settings.title')}
                  value={settings.capacityMode}
                  onValueChange={v => void api('PUT', '/settings', { capacityMode: v })}
                  options={[{ value: 'warn', label: t('trips.settings.warn') }, { value: 'block', label: t('trips.settings.block') }]}
                />
              )}
            </Field>
          )}
        </div>
      </section>
      {list.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : (
        <DataTable aria-label={t('trips.title')} columns={columns} rows={list.data?.items ?? []} table={table} getId={r => r.id} onRowClick={r => setEdit(r.id)} empty={<EmptyState icon={<Waypoints size={20} />} title={t('trips.empty')}>{t('trips.emptyHint')}</EmptyState>} />
      )}
      {routingOpen && routing && <RoutingSettingsDialog view={routing} onClose={() => setRoutingOpen(false)} />}
      {edit && <TripDialog key={edit} id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
