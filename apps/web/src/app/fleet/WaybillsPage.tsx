/* Автопарк → Путевые листы (задача 1210): черновик → выдан (отметки медосмотра и техконтроля обязательны, просроченные ОСАГО и права
   не допускаются) → закрыт (пробег, остаток топлива, расчёт нормы против факта). Печатная форма — по приказу Минтранса. Рейс (задача 1211)
   будет создавать путевой лист тем же сервисом: поле tripId уже есть. */
import * as React from 'react';
import { ClipboardList, Plus, Printer } from 'lucide-react';
import { WAYBILL_STATUSES, type WaybillStatus } from '@gr8r/shared';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtNumber, useT } from '@/i18n';
import { iso, today, fmtDate, parse } from '../lib/dates';
import { useWorkspace } from '../data/store';
import { useMembersWith } from '../positions/data';
import { useWsId } from '../meta/data';
import { openWaybillPrint, useFleetApi, useVehicles, useWaybill, useWaybills, type Waybill } from './data';
import { FleetHead, FormDialog, fromLocalInput, num, toLocalInput, type FieldDef } from './parts';

const ALL = 'all';
export const WAYBILL_TONE: Record<WaybillStatus, 'gray' | 'accent' | 'green' | 'red'> = { draft: 'gray', issued: 'accent', closed: 'green', cancelled: 'red' };

function WaybillDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const ws = useWsId();
  const api = useFleetApi();
  const vehicles = useVehicles().data?.items ?? [];
  const detail = useWaybill(id);
  const w = id ? detail.data : null;
  const drivers = useMembersWith(useWorkspace().data.members, 'driver', [w?.driverMemberId]);
  const status: WaybillStatus = w?.status ?? 'draft';
  const draft = status === 'draft';
  const open = status === 'draft' || status === 'issued';
  if (id && !w) return null;
  const fields: FieldDef[] = [
    { key: 'vehicleId', label: t('fleet.waybill.vehicle'), type: 'select', options: vehicles.map(v => ({ value: v.id, label: `${v.plate} ${v.name}`.trim() })), required: true },
    { key: 'driverMemberId', label: t('fleet.waybill.driver'), type: 'select', options: drivers.map(m => ({ value: m.id, label: m.name })), required: true },
    { key: 'date', label: t('fleet.waybill.date'), type: 'date', required: true },
    { key: 'departureAt', label: t('fleet.waybill.departure'), type: 'datetime' },
    { key: 'returnAt', label: t('fleet.waybill.return'), type: 'datetime' },
    { key: 'route', label: t('fleet.waybill.route'), type: 'textarea' },
    { key: 'odometerOut', label: t('fleet.waybill.odometerOut'), type: 'number' },
    { key: 'fuelOut', label: t('fleet.waybill.fuelOut'), type: 'number' },
    { key: 'medicalOk', label: t('fleet.waybill.medicalOk'), type: 'check' },
    { key: 'medicalTime', label: t('fleet.waybill.medicalTime'), type: 'time' },
    { key: 'medicalBy', label: t('fleet.waybill.medicalBy'), type: 'text' },
    { key: 'techOk', label: t('fleet.waybill.techOk'), type: 'check' },
    { key: 'techTime', label: t('fleet.waybill.techTime'), type: 'time' },
    { key: 'techBy', label: t('fleet.waybill.techBy'), type: 'text' },
    ...(status !== 'draft' ? ([{ key: 'odometerBack', label: t('fleet.waybill.odometerBack'), type: 'number' }, { key: 'fuelBack', label: t('fleet.waybill.fuelBack'), type: 'number' }] as FieldDef[]) : []),
    { key: 'comment', label: t('fleet.comment'), type: 'textarea' },
  ];
  const payload = (v: Record<string, string | boolean>) => ({
    ...(draft ? { vehicleId: String(v.vehicleId), driverMemberId: String(v.driverMemberId), date: String(v.date) } : {}),
    route: String(v.route),
    departureAt: fromLocalInput(v.departureAt),
    returnAt: fromLocalInput(v.returnAt),
    odometerOut: num(v.odometerOut) ?? '0',
    fuelOut: num(v.fuelOut) ?? '0',
    medicalOk: !!v.medicalOk,
    medicalTime: String(v.medicalTime),
    medicalBy: String(v.medicalBy),
    techOk: !!v.techOk,
    techTime: String(v.techTime),
    techBy: String(v.techBy),
    ...(status !== 'draft' ? { odometerBack: num(v.odometerBack) ?? null, fuelBack: num(v.fuelBack) ?? null } : {}),
    comment: String(v.comment),
  });
  const save = async (v: Record<string, string | boolean>) => (id ? api<Waybill>('PATCH', `waybills/${id}`, payload(v)) : api<Waybill>('POST', 'waybills', payload(v)));
  const f = w?.fuel;
  return (
    <FormDialog
      title={w ? `${t('fleet.waybill.title1')} ${w.number}` : t('fleet.waybill.new')}
      description={w ? t(`fleet.waybillStatus.${w.status}`) : undefined}
      size="lg"
      fields={fields}
      initial={{
        vehicleId: w?.vehicleId ?? vehicles[0]?.id ?? '',
        driverMemberId: w?.driverMemberId ?? drivers[0]?.id ?? '',
        date: w?.date ?? iso(today()),
        departureAt: toLocalInput(w?.departureAt),
        returnAt: toLocalInput(w?.returnAt),
        route: w?.route ?? '',
        odometerOut: w ? String(Number(w.odometerOut)) : '',
        fuelOut: w ? String(Number(w.fuelOut)) : '0',
        medicalOk: w?.medicalOk ?? false,
        medicalTime: w?.medicalTime ?? '',
        medicalBy: w?.medicalBy ?? '',
        techOk: w?.techOk ?? false,
        techTime: w?.techTime ?? '',
        techBy: w?.techBy ?? '',
        odometerBack: w?.odometerBack ? String(Number(w.odometerBack)) : '',
        fuelBack: w?.fuelBack ? String(Number(w.fuelBack)) : '',
        comment: w?.comment ?? '',
      }}
      hideSubmit={!open}
      onClose={onClose}
      onSubmit={async v => !!(await save(v))}
      footerExtra={(v, close) =>
        w ? (
          <>
            <Button variant="ghost" onClick={() => openWaybillPrint(ws, w.id).catch(e => toast.error(String(e instanceof Error ? e.message : e)))}>
              <Printer size={13} />
              {t('fleet.waybill.print')}
            </Button>
            {draft && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (await api('DELETE', `waybills/${w.id}`)) close();
                }}
              >
                {t('fleet.delete')}
              </Button>
            )}
            {open && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (await api('POST', `waybills/${w.id}/cancel`)) close();
                }}
              >
                {t('fleet.waybill.cancel')}
              </Button>
            )}
            {draft && (
              <Button
                variant="secondary"
                onClick={async () => {
                  if ((await save(v)) && (await api('POST', `waybills/${w.id}/issue`))) close();
                }}
              >
                {t('fleet.waybill.issue')}
              </Button>
            )}
            {status === 'issued' && (
              <Button
                variant="secondary"
                onClick={async () => {
                  if ((await save(v)) && (await api('POST', `waybills/${w.id}/close`))) close();
                }}
              >
                {t('fleet.waybill.close')}
              </Button>
            )}
          </>
        ) : null
      }
      extra={() =>
        w ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="label">{t('fleet.waybill.fuelBlock', { norm: fmtNumber(w.normPer100) })}</div>
            <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
              <span>{t('fleet.waybill.filled')}: <b className="num">{fmtNumber(w.fuelFilled)}</b></span>
              {f ? (
                <>
                  <span>{t('fleet.waybill.distance')}: <b className="num">{fmtNumber(f.distanceKm)}</b></span>
                  <span>{t('fleet.waybill.norm')}: <b className="num">{fmtNumber(f.normLiters)}</b></span>
                  <span>{t('fleet.waybill.actual')}: <b className="num">{fmtNumber(f.actualLiters)}</b> ({fmtNumber(f.actualPer100)} {t('fleet.unit.per100')})</span>
                  <Badge tone={Number(f.deltaLiters) > 0 ? 'red' : 'green'}>{Number(f.deltaLiters) > 0 ? t('fleet.waybill.over', { l: fmtNumber(f.deltaLiters) }) : t('fleet.waybill.saved', { l: fmtNumber(-Number(f.deltaLiters)) })}</Badge>
                </>
              ) : (
                <span className="muted">{t('fleet.waybill.fuelHint')}</span>
              )}
            </div>
            {(w.fuelEntries ?? []).map(e => (
              <div key={e.id} className="row muted" style={{ gap: 12 }}>
                <span className="num">{fmtDate(parse(e.date))}</span>
                <span className="num">{fmtNumber(e.liters)} {t('fleet.unit.l')}</span>
                <span>{e.station}</span>
              </div>
            ))}
          </div>
        ) : null
      }
    />
  );
}

export function WaybillsPage() {
  const t = useT();
  const vehicles = useVehicles().data?.items ?? [];
  const [from, setFrom] = React.useState(iso(new Date(today().getTime() - 30 * 86400000)));
  const [to, setTo] = React.useState(iso(new Date(today().getTime() + 7 * 86400000)));
  const [vehicle, setVehicle] = React.useState(ALL);
  const [status, setStatus] = React.useState(ALL);
  const [q, setQ] = React.useState('');
  const list = useWaybills({ from, to, ...(vehicle === ALL ? {} : { vehicleId: vehicle }), ...(status === ALL ? {} : { status }), ...(q.trim() ? { q: q.trim() } : {}) });
  const [edit, setEdit] = React.useState<string | 'new' | null>(null);
  const columns = React.useMemo<Column<Waybill>[]>(
    () => [
      { id: 'number', header: t('fleet.waybill.number'), width: 150, value: r => r.number, cell: r => <b>{r.number}</b> },
      { id: 'date', header: t('fleet.waybill.date'), width: 110, value: r => r.date, cell: r => <span className="num">{fmtDate(parse(r.date))}</span> },
      { id: 'vehicle', header: t('fleet.waybill.vehicle'), width: 120, value: r => r.plate, cell: r => r.plate },
      { id: 'driver', header: t('fleet.waybill.driver'), width: 170, value: r => r.driverName, cell: r => <span className="trunc">{r.driverName}</span> },
      { id: 'route', header: t('fleet.waybill.route'), width: 260, value: r => r.route, cell: r => <span className="trunc muted">{r.route || '—'}</span> },
      { id: 'distance', header: t('fleet.waybill.distance'), width: 100, align: 'right', value: r => Number(r.distanceKm ?? 0), cell: r => <span className="num">{r.fuel ? fmtNumber(r.fuel.distanceKm) : '—'}</span> },
      { id: 'norm', header: t('fleet.waybill.norm'), width: 100, align: 'right', value: r => Number(r.normLiters ?? 0), cell: r => <span className="num">{r.fuel ? fmtNumber(r.fuel.normLiters) : '—'}</span> },
      { id: 'actual', header: t('fleet.waybill.actual'), width: 100, align: 'right', value: r => Number(r.actualLiters ?? 0), cell: r => <span className="num">{r.fuel ? fmtNumber(r.fuel.actualLiters) : '—'}</span> },
      {
        id: 'delta',
        header: t('fleet.waybill.delta'),
        width: 110,
        align: 'right',
        value: r => Number(r.fuel?.deltaLiters ?? 0),
        cell: r => (r.fuel ? <span className="num" style={{ color: Number(r.fuel.deltaLiters) > 0 ? 'var(--red)' : 'var(--green)' }}>{Number(r.fuel.deltaLiters) > 0 ? '+' : ''}{fmtNumber(r.fuel.deltaLiters)}</span> : <span className="faint">—</span>),
      },
      { id: 'status', header: t('fleet.waybill.status'), width: 120, value: r => r.status, cell: r => <Badge tone={WAYBILL_TONE[r.status]}>{t(`fleet.waybillStatus.${r.status}`)}</Badge> },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });
  return (
    <div className="page flush">
      <FleetHead
        title={t('fleet.waybills.title')}
        lead={t('fleet.waybills.lead')}
        actions={
          <Button size="sm" onClick={() => setEdit('new')}>
            <Plus size={13} />
            {t('fleet.waybill.new')}
          </Button>
        }
      />
      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('fleet.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} />}</Field>
          <Field label={t('fleet.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || to)} />}</Field>
          <Field label={t('fleet.waybill.vehicle')}>
            {p => <Select id={p.id} aria-label={t('fleet.waybill.vehicle')} value={vehicle} onValueChange={setVehicle} options={[{ value: ALL, label: t('fleet.all') }, ...vehicles.map(v => ({ value: v.id, label: v.plate }))]} />}
          </Field>
          <Field label={t('fleet.waybill.status')}>
            {p => <Select id={p.id} aria-label={t('fleet.waybill.status')} value={status} onValueChange={setStatus} options={[{ value: ALL, label: t('fleet.all') }, ...WAYBILL_STATUSES.map(s => ({ value: s, label: t(`fleet.waybillStatus.${s}`) }))]} />}
          </Field>
          <Field label={t('fleet.search')}>{p => <Input {...p} value={q} onChange={e => setQ(e.target.value)} />}</Field>
        </div>
      </section>
      {list.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : (
        <DataTable aria-label={t('fleet.waybills.title')} columns={columns} rows={list.data?.items ?? []} table={table} getId={r => r.id} onRowClick={r => setEdit(r.id)} empty={<EmptyState icon={<ClipboardList size={20} />} title={t('fleet.waybills.empty')}>{t('fleet.waybills.emptyHint')}</EmptyState>} />
      )}
      {edit && <WaybillDialog key={edit} id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
