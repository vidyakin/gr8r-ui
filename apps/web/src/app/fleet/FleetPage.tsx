/* Автопарк → Обзор (задача 1210): что требует внимания (документы, ТО) и затраты на машины за период (топливо, ремонты, штрафы,
   перерасход против нормы) — затраты видят admin и owner. */
import * as React from 'react';
import { Link } from 'react-router';
import { Badge, Field, Input, Skeleton } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { iso, today, fmtDate, parse } from '../lib/dates';
import { useIsAdmin } from '../catalog/data';
import { SECTIONS } from '../routes';
import { useFleetCosts, useFleetDocs, useFleetSummary, useServicePlans, type VehicleCost } from './data';
import { FleetHead, TermBadge } from './parts';

function Stat({ label, value, tone, to }: { label: string; value: number; tone?: 'red' | 'amber'; to: string }) {
  return (
    <Link to={to} className="panel plain" style={{ padding: 16, minWidth: 190, flex: '1 1 190px', textDecoration: 'none', color: 'inherit' }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, color: value && tone ? `var(--${tone})` : undefined }}>{value}</div>
    </Link>
  );
}

export function FleetPage() {
  const t = useT();
  const isAdmin = useIsAdmin();
  const summary = useFleetSummary().data;
  const attention = useFleetDocs({ term: 'expired' }).data?.items ?? [];
  const expiring = useFleetDocs({ term: 'expiring' }).data?.items ?? [];
  const plans = (useServicePlans().data?.items ?? []).filter(p => p.due.overdue || p.due.soon);
  const [from, setFrom] = React.useState(iso(new Date(today().getTime() - 30 * 86400000)));
  const [to, setTo] = React.useState(iso(today()));
  const costs = useFleetCosts(from, to, isAdmin);
  const columns = React.useMemo<Column<VehicleCost>[]>(
    () => [
      { id: 'plate', header: t('fleet.fuel.vehicle'), width: 130, value: r => r.plate, cell: r => <b>{r.plate}</b> },
      { id: 'km', header: t('fleet.costs.km'), width: 110, align: 'right', value: r => Number(r.distanceKm), cell: r => <span className="num">{fmtNumber(r.distanceKm)}</span>, total: rows => <span className="num">{fmtNumber(rows.reduce((s, r) => s + Number(r.distanceKm), 0))}</span> },
      { id: 'liters', header: t('fleet.costs.liters'), width: 110, align: 'right', value: r => Number(r.fuelLiters), cell: r => <span className="num">{fmtNumber(r.fuelLiters)}</span> },
      { id: 'delta', header: t('fleet.costs.delta'), width: 130, align: 'right', value: r => Number(r.fuelDeltaLiters), cell: r => <span className="num" style={{ color: Number(r.fuelDeltaLiters) > 0 ? 'var(--red)' : undefined }}>{Number(r.fuelDeltaLiters) > 0 ? '+' : ''}{fmtNumber(r.fuelDeltaLiters)}</span> },
      { id: 'fuel', header: t('fleet.costs.fuel'), width: 130, align: 'right', value: r => Number(r.fuelAmount), cell: r => <span className="num">{fmtAmount(r.fuelAmount)}</span>, total: rows => <span className="num">{fmtAmount(rows.reduce((s, r) => s + Number(r.fuelAmount), 0))}</span> },
      { id: 'repair', header: t('fleet.costs.repair'), width: 130, align: 'right', value: r => Number(r.repairAmount), cell: r => <span className="num">{fmtAmount(r.repairAmount)}</span>, total: rows => <span className="num">{fmtAmount(rows.reduce((s, r) => s + Number(r.repairAmount), 0))}</span> },
      { id: 'fines', header: t('fleet.costs.fines'), width: 120, align: 'right', value: r => Number(r.finesAmount), cell: r => <span className="num">{fmtAmount(r.finesAmount)}</span>, total: rows => <span className="num">{fmtAmount(rows.reduce((s, r) => s + Number(r.finesAmount), 0))}</span> },
      { id: 'total', header: t('fleet.costs.total'), width: 140, align: 'right', value: r => Number(r.total), cell: r => <b className="num">{fmtAmount(r.total)}</b>, total: rows => <b className="num">{fmtAmount(rows.reduce((s, r) => s + Number(r.total), 0))}</b> },
      { id: 'perKm', header: t('fleet.costs.perKm'), width: 120, align: 'right', value: r => Number(r.perKm ?? 0), cell: r => <span className="num muted">{r.perKm ? fmtAmount(r.perKm) : '—'}</span> },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'total', dir: -1 } });
  return (
    <div className="page flush">
      <FleetHead title={t('fleet.overview.title')} lead={t('fleet.overview.lead')} />
      {!summary ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={80} /></div>
      ) : (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', margin: '0 var(--gutter) 16px' }}>
          <Stat label={t('fleet.overview.vehicles')} value={summary.vehicles} to={SECTIONS.fleetVehicles.path} />
          <Stat label={t('fleet.overview.docsExpired')} value={summary.docsExpired} tone="red" to={SECTIONS.fleetDocuments.path} />
          <Stat label={t('fleet.overview.docsExpiring')} value={summary.docsExpiring} tone="amber" to={SECTIONS.fleetDocuments.path} />
          <Stat label={t('fleet.overview.serviceOverdue')} value={summary.serviceOverdue} tone="red" to={SECTIONS.fleetService.path} />
          <Stat label={t('fleet.overview.serviceSoon')} value={summary.serviceSoon} tone="amber" to={SECTIONS.fleetService.path} />
        </div>
      )}
      {(attention.length > 0 || expiring.length > 0 || plans.length > 0) && (
        <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
          <div className="stack" style={{ gap: 6 }}>
            <h2 style={{ margin: 0 }}>{t('fleet.overview.attention')}</h2>
            {[...attention, ...expiring].map(d => (
              <div key={d.id} className="row" style={{ gap: 12, justifyContent: 'space-between' }}>
                <span><b>{d.plate ?? d.memberName}</b> · {t(`fleet.docKind.${d.kind}`)} {d.number}</span>
                <span className="row" style={{ gap: 8 }}>
                  <span className="num muted">{d.validUntil ? fmtDate(parse(d.validUntil)) : ''}</span>
                  <TermBadge state={d.state} daysLeft={d.daysLeft} />
                </span>
              </div>
            ))}
            {plans.map(p => (
              <div key={p.id} className="row" style={{ gap: 12, justifyContent: 'space-between' }}>
                <span><b>{p.plate}</b> · {p.name}</span>
                <Badge tone={p.due.overdue ? 'red' : 'amber'}>{p.due.overdue ? t('fleet.service.overdue') : t('fleet.service.soon')}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}
      {isAdmin && (
        <>
          <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
            <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <h2 style={{ margin: 0 }}>{t('fleet.costs.title')}</h2>
              <Field label={t('fleet.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} />}</Field>
              <Field label={t('fleet.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || to)} />}</Field>
            </div>
            <p className="faint" style={{ fontSize: 12, margin: '8px 0 0' }}>{t('fleet.costs.hint')}</p>
          </section>
          <DataTable aria-label={t('fleet.costs.title')} columns={columns} rows={costs.data?.items ?? []} table={table} getId={r => r.vehicleId} />
        </>
      )}
    </div>
  );
}
