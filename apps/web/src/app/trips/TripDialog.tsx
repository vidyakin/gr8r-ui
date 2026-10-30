/* Карточка рейса (задача 1211): шапка (вид, даты, машина, водитель), точки в порядке объезда со стрелками, предупреждения
   (вместимость, временные окна), действия: отправить, завершить, отменить, путевой лист, печать маршрутного листа. */
import * as React from 'react';
import { ArrowDown, ArrowUp, Plus, Printer, Route, Timer, Trash2 } from 'lucide-react';
import { STOP_KINDS, TRIP_KINDS } from '@gr8r/shared';
import { Badge, Button, IconButton, toast } from '@/components/ui';
import { fmtNumber, useT } from '@/i18n';
import { fmtDate, iso, parse, today } from '../lib/dates';
import { errorMessage } from '../data/api';
import { useWorkspace } from '../data/store';
import { useMembersWith } from '../positions/data';
import { useWsId } from '../meta/data';
import { useVehicles } from '../fleet/data';
import { FormDialog, intOrNull, num, orNull, type FieldDef, type Values } from '../fleet/parts';
import { downloadTransportWaybillPdf, openTransportWaybill, openTripPrint, useRoutingRuns, useTrip, useTripApi, type TripDetail, type TripStop } from './data';
import { RouteMapView, etaText, mapStops, tripColor } from './map';

export const TRIP_TONE = { planned: 'gray', in_transit: 'accent', done: 'green', cancelled: 'red' } as const;
export const STOP_TONE = { planned: 'gray', arrived: 'amber', done: 'green', failed: 'red' } as const;
/** «1 ч 20 мин» из минут */
function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}` : `0:${String(m).padStart(2, '0')}`;
}
const hm = (s: string | null | undefined) => (s ? s.slice(0, 5) : '');
const win = (s: { windowFrom: string | null; windowTo: string | null }) => [hm(s.windowFrom), hm(s.windowTo)].filter(Boolean).join('–');

/** Сообщения о превышении вместимости */
export function useOverloadText() {
  const t = useT();
  return (o: { kind: 'weight' | 'volume' | 'pallets'; peak: string; limit: string }[]) => o.map(x => t(`trips.warn.${x.kind}`, { peak: fmtNumber(x.peak), limit: fmtNumber(x.limit) })).join(', ');
}

function StopDialog({ trip, stop, onClose }: { trip: TripDetail; stop: TripStop | null; onClose: () => void }) {
  const t = useT();
  const api = useTripApi();
  const locked = !!stop && (stop.status === 'done' || stop.status === 'failed');
  const fromDelivery = stop?.sourceKind === 'delivery';
  const days: string[] = [];
  for (let d = parse(trip.dateFrom).getTime(); d <= parse(trip.dateTo).getTime() && days.length < 60; d += 86400000) days.push(iso(new Date(d)));
  const fields: FieldDef[] = [
    { key: 'kind', label: t('trips.stop.kind'), type: 'select', options: STOP_KINDS.map(k => ({ value: k, label: t(`trips.stopKind.${k}`) })) },
    { key: 'title', label: t('trips.stop.title'), type: 'text' },
    { key: 'address', label: t('trips.stop.address'), type: 'text' },
    ...(days.length > 1 ? ([{ key: 'day', label: t('trips.stop.day'), type: 'select', options: days.map(d => ({ value: d, label: fmtDate(parse(d)) })) }] as FieldDef[]) : []),
    { key: 'windowFrom', label: t('trips.stop.windowFrom'), type: 'time' },
    { key: 'windowTo', label: t('trips.stop.windowTo'), type: 'time' },
    { key: 'contactName', label: t('trips.stop.contactName'), type: 'text' },
    { key: 'contactPhone', label: t('trips.stop.contactPhone'), type: 'text' },
    { key: 'weightKg', label: t('trips.stop.weight'), type: 'number' },
    { key: 'volumeM3', label: t('trips.stop.volume'), type: 'number' },
    { key: 'pallets', label: t('trips.stop.pallets'), type: 'number' },
    { key: 'lat', label: t('trips.stop.lat'), type: 'number' },
    { key: 'lon', label: t('trips.stop.lon'), type: 'number' },
    { key: 'comment', label: t('trips.stop.comment'), type: 'textarea' },
  ];
  const coord = (s: string | boolean | undefined) => {
    const n = num(s);
    return n === undefined ? null : Number(n);
  };
  const body = (v: Values) => ({
    kind: String(v.kind),
    title: String(v.title),
    address: String(v.address),
    ...(v.day ? { day: String(v.day) } : {}),
    windowFrom: orNull(v.windowFrom),
    windowTo: orNull(v.windowTo),
    contactName: String(v.contactName),
    contactPhone: String(v.contactPhone),
    weightKg: num(v.weightKg) ?? '0',
    volumeM3: num(v.volumeM3) ?? '0',
    pallets: intOrNull(v.pallets) ?? 0,
    lat: coord(v.lat),
    lon: coord(v.lon),
    comment: String(v.comment),
  });
  return (
    <FormDialog
      title={stop ? t('trips.stop.edit') : t('trips.stop.new')}
      description={stop ? undefined : t('trips.card.manualHint')}
      fields={fields}
      lockedKeys={locked ? fields.map(f => f.key) : fromDelivery ? ['kind'] : []}
      hideSubmit={locked}
      initial={{
        kind: stop?.kind ?? 'delivery',
        title: stop?.title ?? '',
        address: stop?.address ?? '',
        day: stop?.day ?? trip.dateFrom,
        windowFrom: hm(stop?.windowFrom),
        windowTo: hm(stop?.windowTo),
        contactName: stop?.contactName ?? '',
        contactPhone: stop?.contactPhone ?? '',
        weightKg: stop ? String(Number(stop.weightKg)) : '',
        volumeM3: stop ? String(Number(stop.volumeM3)) : '',
        pallets: stop ? String(stop.pallets) : '',
        lat: stop?.lat ? String(Number(stop.lat)) : '',
        lon: stop?.lon ? String(Number(stop.lon)) : '',
        comment: stop?.comment ?? '',
      }}
      onClose={onClose}
      onSubmit={async v => !!(stop ? await api('PATCH', `/${trip.id}/stops/${stop.id}`, body(v)) : await api('POST', `/${trip.id}/stops`, body(v)))}
    />
  );
}

export function TripDialog({ id, defaults, onClose }: { id: string | null; defaults?: { vehicleId?: string; date?: string }; onClose: () => void }) {
  const t = useT();
  const ws = useWsId();
  const api = useTripApi();
  const overloadText = useOverloadText();
  const vehicles = useVehicles().data?.items ?? [];
  const detail = useTrip(id);
  const trip = id ? detail.data : null;
  const drivers = useMembersWith(useWorkspace().data.members, 'driver', [trip?.driverMemberId, trip?.coDriverMemberId]);
  const runs = useRoutingRuns(id ? { tripId: id } : {}).data?.items ?? [];
  const lastRun = runs[0];
  const calculating = lastRun?.status === 'queued' || lastRun?.status === 'running';
  const optimize = async (reorder: boolean) => void (id && (await api('POST', `/${id}/optimize`, { reorder })));
  const [stopEdit, setStopEdit] = React.useState<TripStop | 'new' | null>(null);
  if (id && !trip) return null;
  const status = trip?.status ?? 'planned';
  const planned = status === 'planned';
  const open = planned || status === 'in_transit';
  const vehicleId = trip?.vehicleId ?? defaults?.vehicleId ?? vehicles[0]?.id ?? '';
  const vehicleDriver = vehicles.find(v => v.id === vehicleId)?.driverMemberId ?? null;
  const fields: FieldDef[] = [
    { key: 'kind', label: t('trips.field.kind'), type: 'select', options: TRIP_KINDS.map(k => ({ value: k, label: t(`trips.kind.${k}`) })) },
    { key: 'name', label: t('trips.field.name'), type: 'text' },
    { key: 'dateFrom', label: t('trips.field.dateFrom'), type: 'date', required: true },
    { key: 'dateTo', label: t('trips.field.dateTo'), type: 'date', hint: t('trips.kind.intercity') },
    { key: 'startTime', label: t('trips.field.startTime'), type: 'time' },
    { key: 'endTime', label: t('trips.field.endTime'), type: 'time' },
    { key: 'vehicleId', label: t('trips.field.vehicle'), type: 'select', options: vehicles.map(v => ({ value: v.id, label: `${v.plate} ${v.name}`.trim() })), required: true },
    { key: 'driverMemberId', label: t('trips.field.driver'), type: 'select', options: drivers.map(m => ({ value: m.id, label: m.name })), required: true },
    { key: 'coDriverMemberId', label: t('trips.field.coDriver'), type: 'select', options: [{ value: '_none', label: t('trips.field.none') }, ...drivers.map(m => ({ value: m.id, label: m.name }))] },
    { key: 'comment', label: t('trips.field.comment'), type: 'textarea' },
  ];
  const payload = (v: Values) =>
    planned
      ? {
          kind: String(v.kind),
          name: String(v.name),
          dateFrom: String(v.dateFrom),
          dateTo: v.kind === 'intercity' ? orNull(v.dateTo) : null,
          startTime: orNull(v.startTime),
          endTime: orNull(v.endTime),
          vehicleId: String(v.vehicleId),
          driverMemberId: String(v.driverMemberId),
          coDriverMemberId: v.coDriverMemberId && v.coDriverMemberId !== '_none' ? String(v.coDriverMemberId) : null,
          comment: String(v.comment),
        }
      : { name: String(v.name), startTime: orNull(v.startTime), endTime: orNull(v.endTime), comment: String(v.comment) };
  const save = async (v: Values) => (id ? api<TripDetail>('PATCH', `/${id}`, payload(v)) : api<TripDetail>('POST', '', payload(v)));
  const moveStop = async (index: number, delta: number) => {
    if (!trip) return;
    const ids = trip.stops.map(s => s.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    await api('PUT', `/${trip.id}/order`, { stopIds: ids });
  };
  return (
    <>
      <FormDialog
        title={trip ? t('trips.card.title', { number: trip.number }) : t('trips.card.new')}
        description={trip ? t(`trips.status.${trip.status}`) : undefined}
        size="lg"
        fields={fields}
        lockedKeys={planned ? [] : ['kind', 'dateFrom', 'dateTo', 'vehicleId', 'driverMemberId', 'coDriverMemberId']}
        initial={{
          kind: trip?.kind ?? 'city',
          name: trip?.name ?? '',
          dateFrom: trip?.dateFrom ?? defaults?.date ?? iso(today()),
          dateTo: trip && trip.dateTo !== trip.dateFrom ? trip.dateTo : '',
          startTime: hm(trip?.startTime),
          endTime: hm(trip?.endTime),
          vehicleId,
          driverMemberId: trip?.driverMemberId ?? vehicleDriver ?? drivers[0]?.id ?? '',
          coDriverMemberId: trip?.coDriverMemberId ?? '_none',
          comment: trip?.comment ?? '',
        }}
        hideSubmit={!open}
        onClose={onClose}
        onSubmit={async v => !!(await save(v))}
        footerExtra={(v, close) =>
          trip ? (
            <>
              <Button variant="ghost" onClick={() => openTripPrint(ws, trip.id).catch(e => toast.error(String(e instanceof Error ? e.message : e)))}>
                <Printer size={13} />
                {t('trips.action.print')}
              </Button>
              <Button variant="ghost" onClick={() => openTransportWaybill(ws, { tripId: trip.id }).catch(e => toast.error(errorMessage(e)))}>
                <Printer size={13} />
                {t('trips.tn.print')}
              </Button>
              <Button variant="ghost" onClick={() => downloadTransportWaybillPdf(ws, { tripId: trip.id }, { failed: t('trips.tn.failed'), timeout: t('trips.tn.timeout') }).catch(e => toast.error(errorMessage(e)))}>
                {t('trips.tn.pdf')}
              </Button>
              {status !== 'cancelled' && !trip.waybills.some(w => w.status !== 'cancelled') && (
                <Button variant="ghost" onClick={async () => void (await api('POST', `/${trip.id}/waybill`))}>
                  {t('trips.action.waybill')}
                </Button>
              )}
              {planned && (
                <Button variant="ghost" onClick={async () => { if (window.confirm(t('trips.confirm.delete')) && (await api('DELETE', `/${trip.id}`))) close(); }}>
                  {t('trips.action.delete')}
                </Button>
              )}
              {open && (
                <Button variant="ghost" onClick={async () => { if (window.confirm(t('trips.confirm.cancel')) && (await api('POST', `/${trip.id}/cancel`))) close(); }}>
                  {t('trips.action.cancel')}
                </Button>
              )}
              {planned && (
                <Button variant="secondary" onClick={async () => { if ((await save(v)) && (await api('POST', `/${trip.id}/start`))) close(); }}>
                  {t('trips.action.start')}
                </Button>
              )}
              {status === 'in_transit' && (
                <Button variant="secondary" onClick={async () => { if ((await save(v)) && (await api('POST', `/${trip.id}/complete`))) close(); }}>
                  {t('trips.action.complete')}
                </Button>
              )}
            </>
          ) : null
        }
        extra={() => (
          <div className="stack" style={{ gap: 10 }}>
            {trip && (
              <>
                <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div className="label">{t('trips.card.stops')}</div>
                  <span className="muted">
                    {t('trips.card.load')}: <b className="num">{fmtNumber(trip.load.weightKg)}</b> {t('fleet.unit.kg')}
                    {trip.limits.capacityKg ? <> / {fmtNumber(trip.limits.capacityKg)}</> : null}
                    {Number(trip.load.volumeM3) > 0 ? <>, <b className="num">{fmtNumber(trip.load.volumeM3)}</b> {t('fleet.unit.m3')}</> : null}
                    {trip.load.pallets > 0 ? <>, {trip.load.pallets} {t('fleet.unit.pal')}</> : null}
                  </span>
                  {trip.routeKm ? (
                    <span className="muted">
                      {t('trips.card.route', { km: fmtNumber(trip.routeKm), time: fmtDuration(trip.routeMin ?? 0) })} · {t(`trips.run.source.${trip.routeSource ?? 'straight'}`)}
                    </span>
                  ) : (
                    trip.straightKm && <span className="muted">{t('trips.card.straight', { km: fmtNumber(trip.straightKm) })}</span>
                  )}
                  {open && trip.stops.length > 1 && (
                    <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                      {planned && (
                        <Button size="sm" variant="ghost" disabled={calculating} onClick={() => void optimize(true)}>
                          <Route size={13} />
                          {t('trips.action.optimize')}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={calculating} onClick={() => void optimize(false)}>
                        <Timer size={13} />
                        {t('trips.action.recalc')}
                      </Button>
                    </span>
                  )}
                </div>
                {calculating && <div className="muted">{t('trips.card.calculating')}</div>}
                {lastRun?.status === 'failed' && <Badge tone="red" style={{ alignSelf: 'flex-start', whiteSpace: 'normal' }}>{t('trips.run.failed', { error: lastRun.error ?? '' })}</Badge>}
                {lastRun?.status === 'done' && lastRun.warning && <Badge tone="amber" style={{ alignSelf: 'flex-start', whiteSpace: 'normal' }}>{t('trips.run.warning', { text: lastRun.warning })}</Badge>}
                {trip.warnings.map((w, i) => (
                  <Badge key={i} tone={w.code === 'overload' ? 'red' : 'amber'} style={{ alignSelf: 'flex-start', whiteSpace: 'normal' }}>
                    {w.code === 'overload' ? t('trips.warn.overload', { items: overloadText(w.overloads ?? []) }) : t('trips.warn.windowOrder', { seq: w.seq ?? 0 })}
                  </Badge>
                ))}
                {trip.stops.length === 0 && <div className="muted">{t('trips.card.noStops')}</div>}
                {trip.stops.map((s, i) => (
                  <div key={s.id} className="row" style={{ gap: 8, alignItems: 'flex-start', padding: '6px 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                    <b className="num" style={{ width: 22 }}>{s.seq}</b>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <Badge tone="gray">{t(`trips.stopKind.${s.kind}`)}</Badge>
                        <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setStopEdit(s)}>
                          {s.address || s.title || '—'}
                        </button>
                        {s.documentNumber && <span className="muted">{s.documentNumber}</span>}
                        <Badge tone={STOP_TONE[s.status]}>{t(`trips.stopStatus.${s.status}`)}</Badge>
                        {s.etaMin !== null && <Badge tone={s.etaLate ? 'red' : 'gray'} title={s.etaLate ? t('trips.card.etaLate') : undefined}>{t('trips.card.eta', { time: etaText(s.etaMin) })}</Badge>}
                        {s.lat === null && s.address && <Badge tone="gray" title={t('trips.stop.noCoordsHint')}>{s.geoStatus === 'pending' ? t('trips.stop.geoPending') : t('trips.stop.noCoords')}</Badge>}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {[trip.dateFrom !== trip.dateTo ? fmtDate(parse(s.day)) : '', win(s), Number(s.weightKg) ? `${fmtNumber(s.weightKg)} ${t('fleet.unit.kg')}` : '', s.legKm ? t('trips.card.leg', { km: fmtNumber(s.legKm), min: s.legMin ?? 0 }) : '', s.contactName].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {status === 'in_transit' && (s.status === 'planned' || s.status === 'arrived') && (
                      <div className="row" style={{ gap: 4 }}>
                        {s.status === 'planned' && <Button size="sm" variant="ghost" onClick={() => api('POST', `/${trip.id}/stops/${s.id}/status`, { status: 'arrived' })}>{t('trips.stop.arrived')}</Button>}
                        <Button size="sm" variant="ghost" onClick={() => api('POST', `/${trip.id}/stops/${s.id}/status`, { status: 'done' })}>{t('trips.stop.done')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => api('POST', `/${trip.id}/stops/${s.id}/status`, { status: 'failed' })}>{t('trips.stop.failed')}</Button>
                      </div>
                    )}
                    {status === 'in_transit' && (s.status === 'done' || s.status === 'failed') && (
                      <Button size="sm" variant="ghost" onClick={() => api('POST', `/${trip.id}/stops/${s.id}/status`, { status: 'planned' })}>{t('trips.stop.back')}</Button>
                    )}
                    {open && s.status !== 'done' && s.status !== 'failed' && (
                      <div className="row" style={{ gap: 2 }}>
                        <IconButton label={t('trips.card.up')} size="sm" disabled={i === 0} onClick={() => moveStop(i, -1)}><ArrowUp size={13} /></IconButton>
                        <IconButton label={t('trips.card.down')} size="sm" disabled={i === trip.stops.length - 1} onClick={() => moveStop(i, 1)}><ArrowDown size={13} /></IconButton>
                        <IconButton label={t('trips.card.remove')} size="sm" onClick={() => api('DELETE', `/${trip.id}/stops/${s.id}`)}><Trash2 size={13} /></IconButton>
                      </div>
                    )}
                  </div>
                ))}
                {open && (
                  <Button size="sm" variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setStopEdit('new')}>
                    <Plus size={13} />
                    {t('trips.card.addStop')}
                  </Button>
                )}
                {trip.stops.some(s => s.lat !== null) && (
                  <RouteMapView height={260} routes={[{ id: trip.id, color: tripColor(0), label: trip.number, stops: mapStops(trip.stops) }]} />
                )}
                <div className="row muted" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span>{t('trips.card.docs')}:</span>
                  {trip.waybills.length ? trip.waybills.map(w => <Badge key={w.id} tone="gray">{w.number}</Badge>) : <span>{t('trips.card.noWaybill')}</span>}
                </div>
              </>
            )}
          </div>
        )}
      />
      {trip && stopEdit && <StopDialog key={stopEdit === 'new' ? 'new' : stopEdit.id} trip={trip} stop={stopEdit === 'new' ? null : stopEdit} onClose={() => setStopEdit(null)} />}
    </>
  );
}
