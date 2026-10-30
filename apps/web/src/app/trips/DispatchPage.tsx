/* Транспорт → Диспетчер (задача 1211): нераспределённые доставки слева, машины на день с таймлайном справа. Доставку перетаскивают на рейс
   (добавляется точкой) или на свободную машину (создаётся рейс на день). Без перетаскивания — выбор «В рейс…». Задача 1213: кнопка «Распределить»
   (задача воркера собирает рейсы и порядок точек, ход и итог — в полосе запуска) и карта рейсов дня. */
import * as React from 'react';
import { ChevronLeft, ChevronRight, GripVertical, Plus, Shuffle } from 'lucide-react';
import { Alert, Badge, Button, IconButton, Skeleton, toast } from '@/components/ui';
import { fmtNumber, useT } from '@/i18n';
import { fmtDate, iso, parse, today } from '../lib/dates';
import { FleetHead } from '../fleet/parts';
import { STOP_TONE, TRIP_TONE, TripDialog, useOverloadText } from './TripDialog';
import { RouteMapView, etaText, mapStops, tripColor } from './map';
import { useDispatch, useRoutingRuns, useTripApi, type Dispatch, type DispatchDelivery, type DispatchTrip } from './data';

const FROM_H = 6;
const TO_H = 22;
const SPAN = (TO_H - FROM_H) * 60;
const MIME = 'application/x-gr8r-delivery';
const mins = (hhmm: string | null | undefined, dflt: number) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : dflt);
const pct = (m: number) => Math.max(0, Math.min(100, ((m - FROM_H * 60) / SPAN) * 100));

/** Положение рейса на оси дня: без времени — на весь день; многодневный рейс на промежуточные дни занимает всю ось */
function barSpan(trip: DispatchTrip, date: string): { left: number; width: number } {
  const first = trip.dateFrom === date;
  const last = trip.dateTo === date;
  const a = first ? mins(trip.startTime, FROM_H * 60) : FROM_H * 60;
  const b = last ? mins(trip.endTime, TO_H * 60) : TO_H * 60;
  const left = pct(a);
  return { left, width: Math.max(2, pct(b) - left) };
}

function DeliveryCard({ d, targets, onPlace }: { d: DispatchDelivery; targets: { value: string; label: string }[]; onPlace: (target: string) => void }) {
  const t = useT();
  const late = d.deliveryDate !== null && d.deliveryDate < iso(today());
  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData(MIME, d.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="panel plain"
      style={{ padding: '8px 10px', cursor: 'grab', display: 'flex', gap: 8, alignItems: 'flex-start' }}
    >
      <GripVertical size={14} className="faint" style={{ marginTop: 3, flex: 'none' }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <b>{d.documentNumber ?? '—'}</b>
          {d.counterpartyName && <span className="muted trunc">{d.counterpartyName}</span>}
        </div>
        <div className="trunc" title={d.address}>{d.address || '—'}</div>
        <div className="row muted" style={{ gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
          {(d.windowFrom || d.windowTo) && <span className="num">{[d.windowFrom, d.windowTo].filter(Boolean).join('–')}</span>}
          <span className="num">{t('trips.dispatch.weight', { kg: fmtNumber(d.weightKg) })}</span>
          {late && <Badge tone="red">{t('trips.dispatch.overdue')}</Badge>}
          {d.lat === null && <Badge tone="gray" title={t('trips.dispatch.noCoordsHint')}>{t('trips.dispatch.noCoords')}</Badge>}
        </div>
        <select
          aria-label={t('trips.dispatch.addTo')}
          className="input"
          style={{ marginTop: 6, height: 28, fontSize: 12 }}
          value=""
          onChange={e => e.target.value && onPlace(e.target.value)}
        >
          <option value="">{t('trips.dispatch.addTo')}</option>
          {targets.map(x => (
            <option key={x.value} value={x.value}>{x.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function TripBar({ trip, date, over, onOpen, onDropDelivery }: { trip: DispatchTrip; date: string; over: boolean; onOpen: () => void; onDropDelivery: (deliveryId: string) => void }) {
  const t = useT();
  const overloadText = useOverloadText();
  const [hot, setHot] = React.useState(false);
  const { left, width } = barSpan(trip, date);
  return (
    <div
      onDragOver={e => {
        if (e.dataTransfer.types.includes(MIME)) {
          e.preventDefault();
          setHot(true);
        }
      }}
      onDragLeave={() => setHot(false)}
      onDrop={e => {
        e.preventDefault();
        e.stopPropagation();
        setHot(false);
        const id = e.dataTransfer.getData(MIME);
        if (id) onDropDelivery(id);
      }}
      style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 6, bottom: 6 }}
    >
      <button
        type="button"
        onClick={onOpen}
        title={trip.overloads.length ? overloadText(trip.overloads) : t('trips.dispatch.dropTrip')}
        style={{
          width: '100%',
          height: '100%',
          textAlign: 'left',
          padding: '4px 8px',
          borderRadius: 6,
          cursor: 'pointer',
          border: `1px solid ${hot ? 'var(--accent)' : trip.overloads.length || over ? 'var(--red)' : 'var(--line)'}`,
          background: hot ? 'var(--accent-soft, var(--hover))' : 'var(--panel-2, var(--hover))',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <b className="trunc">{trip.number}</b>
          <Badge tone={TRIP_TONE[trip.status]}>{t(`trips.status.${trip.status}`)}</Badge>
        </span>
        <span className="muted trunc" style={{ fontSize: 12 }}>
          {trip.driverName ? `${trip.driverName} · ` : ''}{t('trips.dispatch.stops', { n: trip.stopsTotal })} · {fmtNumber(trip.load.weightKg)}
          {trip.limits.capacityKg ? `/${fmtNumber(trip.limits.capacityKg)}` : ''}
        </span>
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {trip.stops
            .filter(s => s.day === date)
            .map(s => (
              <Badge key={s.id} tone={s.etaLate ? 'red' : STOP_TONE[s.status]} title={s.address || s.title}>
                {s.seq}
                {s.etaMin !== null ? ` ~${etaText(s.etaMin)}` : s.windowFrom ? ` ${s.windowFrom}` : ''}
              </Badge>
            ))}
        </span>
      </button>
    </div>
  );
}

/** Полоса последнего запуска «Распределить»: ход, итог, предупреждение провайдера, причины, по которым доставки остались нераспределёнными */
function RunBanner({ run }: { run: NonNullable<ReturnType<typeof useRoutingRuns>['data']>['items'][number] }) {
  const t = useT();
  const [hidden, setHidden] = React.useState<string | null>(null);
  if (hidden === run.id) return null;
  const sum = run.summary;
  const tone = run.status === 'failed' ? 'danger' : run.status === 'done' ? (sum && sum.unassigned.length ? 'warn' : 'ok') : 'info';
  const reasons = sum ? [...new Set([...sum.unassigned.map(u => u.reason), ...sum.skippedVehicles.map(v => v.reason)])] : [];
  return (
    <div style={{ padding: '0 var(--gutter) 12px' }}>
      <Alert tone={tone} action={run.status === 'done' || run.status === 'failed' ? <Button size="sm" variant="ghost" onClick={() => setHidden(run.id)}>{t('trips.run.hide')}</Button> : undefined}>
        <div>
          <span>
            {run.status === 'queued' || run.status === 'running'
              ? t('trips.run.running')
              : run.status === 'failed'
                ? t('trips.run.failed', { error: run.error ?? '' })
                : t('trips.run.done', { trips: sum?.tripIds.length ?? 0, stops: sum?.stops ?? 0, left: sum?.unassigned.length ?? 0 })}
            {run.status === 'done' && ` · ${t(`trips.run.source.${run.source ?? 'straight'}`)}`}
            {run.warning && ` · ${t('trips.run.warning', { text: run.warning })}`}
            {reasons.length > 0 && ` · ${reasons.map(r => t(`trips.run.reason.${r}` as Parameters<typeof t>[0])).join(', ')}`}
          </span>
        </div>
      </Alert>
    </div>
  );
}

export function DispatchPage() {
  const t = useT();
  const api = useTripApi();
  const [date, setDate] = React.useState(iso(today()));
  const board = useDispatch(date).data;
  const [open, setOpen] = React.useState<{ id: string | null; defaults?: { vehicleId?: string; date?: string } } | null>(null);
  const [hotLane, setHotLane] = React.useState<string | null>(null);
  const runs = useRoutingRuns({ date }).data?.items ?? [];
  const run = runs[0];
  const running = run?.status === 'queued' || run?.status === 'running';
  const distribute = async () => {
    if (await api('POST', '/routing/distribute', { date })) toast(t('trips.dispatch.distributeStarted'));
  };
  const shift = (n: number) => setDate(iso(new Date(parse(date).getTime() + n * 86400000)));

  const place = async (b: Dispatch, deliveryId: string, target: { tripId: string } | { vehicleId: string }) => {
    let tripId = 'tripId' in target ? target.tripId : '';
    if ('vehicleId' in target) {
      const v = b.vehicles.find(x => x.id === target.vehicleId);
      const driver = v?.driverMemberId ?? b.drivers[0]?.id;
      if (!v || !driver) return void toast.error(t('trips.dispatch.noDriver'));
      const created = await api<{ id: string; number: string }>('POST', '', { kind: 'city', dateFrom: date, vehicleId: v.id, driverMemberId: driver });
      if (!created) return;
      tripId = created.id;
      toast.success(t('trips.dispatch.created', { number: created.number }));
    }
    if (await api('POST', `/${tripId}/deliveries`, { deliveryId })) toast.success(t('trips.dispatch.placed'));
  };

  if (!board) {
    return (
      <div className="page flush">
        <FleetHead title={t('trips.dispatch.title')} lead={t('trips.dispatch.lead')} />
        <div style={{ padding: 16 }}><Skeleton w="100%" h={120} /></div>
      </div>
    );
  }
  const busyVehicles = new Set(board.trips.map(x => x.vehicleId));
  const targets = [
    ...board.trips.filter(x => x.status !== 'done').map(x => ({ value: `trip:${x.id}`, label: `${x.number} · ${x.plate || x.carrierName || ''}` })),
    ...board.vehicles.filter(v => !busyVehicles.has(v.id)).map(v => ({ value: `vehicle:${v.id}`, label: `${t('trips.dispatch.newTripFor')} · ${v.plate}` })),
  ];
  const onPlace = (deliveryId: string, target: string) => {
    const [kind, id] = target.split(':') as ['trip' | 'vehicle', string];
    return place(board, deliveryId, kind === 'trip' ? { tripId: id } : { vehicleId: id });
  };
  const hours = Array.from({ length: TO_H - FROM_H + 1 }, (_, i) => FROM_H + i);

  return (
    <div className="page flush">
      <FleetHead
        title={t('trips.dispatch.title')}
        lead={t('trips.dispatch.lead')}
        actions={
          <>
            <IconButton label={t('trips.dispatch.prev')} onClick={() => shift(-1)}><ChevronLeft size={15} /></IconButton>
            <input className="input" type="date" aria-label={t('trips.col.date')} value={date} onChange={e => e.target.value && setDate(e.target.value)} style={{ width: 150 }} />
            <IconButton label={t('trips.dispatch.next')} onClick={() => shift(1)}><ChevronRight size={15} /></IconButton>
            <Button size="sm" variant="ghost" onClick={() => setDate(iso(today()))}>{t('trips.dispatch.today')}</Button>
            <Button size="sm" variant="secondary" disabled={running} onClick={() => void distribute()}>
              <Shuffle size={13} />
              {t('trips.dispatch.distribute')}
            </Button>
            <Button size="sm" onClick={() => setOpen({ id: null, defaults: { date } })}>
              <Plus size={13} />
              {t('trips.new')}
            </Button>
          </>
        }
      />
      {run && <RunBanner run={run} />}
      <div style={{ display: 'flex', gap: 16, padding: '0 var(--gutter) 24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <section style={{ flex: '0 0 320px', maxWidth: '100%' }} className="stack">
          <div className="label" style={{ marginBottom: 8 }}>{t('trips.dispatch.unassigned')} · {board.unassigned.length}</div>
          <div className="stack" style={{ gap: 8 }}>
            {board.unassigned.length === 0 && <div className="muted">{t('trips.dispatch.noUnassigned')}</div>}
            {board.unassigned.map(d => (
              <DeliveryCard key={d.id} d={d} targets={targets} onPlace={target => void onPlace(d.id, target)} />
            ))}
          </div>
        </section>
        <section style={{ flex: '1 1 520px', minWidth: 0 }}>
          <div className="label" style={{ marginBottom: 8 }}>
            {t('trips.dispatch.vehicles')} · {fmtDate(parse(date), true)}
          </div>
          {board.vehicles.length === 0 && <div className="muted">{t('trips.dispatch.noVehicles')}</div>}
          <div className="row muted" style={{ marginLeft: 150, position: 'relative', height: 16, fontSize: 11 }} aria-hidden="true">
            {hours.filter(h => (h - FROM_H) % 2 === 0).map(h => (
              <span key={h} style={{ position: 'absolute', left: `${pct(h * 60)}%`, transform: 'translateX(-50%)' }} className="num">{String(h).padStart(2, '0')}:00</span>
            ))}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {board.vehicles.map(v => {
              const trips = board.trips.filter(x => x.vehicleId === v.id);
              return (
                <div key={v.id} className="row" style={{ gap: 0, alignItems: 'stretch' }}>
                  <div style={{ width: 150, flex: 'none', paddingRight: 8 }}>
                    <b>{v.plate}</b>
                    <div className="muted trunc" style={{ fontSize: 12 }}>{v.name}</div>
                    {v.capacityKg && <div className="muted" style={{ fontSize: 11 }}>{t('trips.dispatch.capacity', { kg: fmtNumber(v.capacityKg) })}</div>}
                  </div>
                  <div
                    onDragOver={e => {
                      if (e.dataTransfer.types.includes(MIME)) {
                        e.preventDefault();
                        setHotLane(v.id);
                      }
                    }}
                    onDragLeave={() => setHotLane(null)}
                    onDrop={e => {
                      e.preventDefault();
                      setHotLane(null);
                      const id = e.dataTransfer.getData(MIME);
                      if (id) void place(board, id, { vehicleId: v.id });
                    }}
                    style={{
                      position: 'relative',
                      flex: 1,
                      minHeight: 78,
                      borderRadius: 6,
                      border: `1px ${hotLane === v.id ? 'solid var(--accent)' : 'dashed var(--line)'}`,
                      backgroundImage: 'repeating-linear-gradient(90deg, transparent 0, transparent calc(12.5% - 1px), var(--line) calc(12.5% - 1px), var(--line) 12.5%)',
                    }}
                  >
                    {trips.length === 0 && <span className="muted" style={{ position: 'absolute', left: 10, top: 28, fontSize: 12 }}>{hotLane === v.id ? t('trips.dispatch.drop') : t('trips.dispatch.free')}</span>}
                    {trips.map(trip => (
                      <TripBar key={trip.id} trip={trip} date={date} over={trip.overloads.length > 0} onOpen={() => setOpen({ id: trip.id })} onDropDelivery={id => void place(board, id, { tripId: trip.id })} />
                    ))}
                  </div>
                </div>
              );
            })}
            {board.trips.filter(x => x.hired).map(trip => (
              <div key={trip.id} className="row" style={{ gap: 0, alignItems: 'stretch' }}>
                <div style={{ width: 150, flex: 'none', paddingRight: 8 }}>
                  <b>{t('trips.hiredLane')}</b>
                  <div className="muted trunc" style={{ fontSize: 12 }}>{trip.carrierName ?? '—'}</div>
                </div>
                <div style={{ position: 'relative', flex: 1, minHeight: 78, borderRadius: 6, border: '1px dashed var(--line)' }}>
                  <TripBar trip={trip} date={date} over={false} onOpen={() => setOpen({ id: trip.id })} onDropDelivery={id => void place(board, id, { tripId: trip.id })} />
                </div>
              </div>
            ))}
          </div>
          <div className="label" style={{ margin: '16px 0 8px' }}>{t('trips.dispatch.map')}</div>
          <RouteMapView
            height={380}
            routes={board.trips.map((x, i) => ({ id: x.id, color: tripColor(i), label: `${x.number} · ${x.plate || x.carrierName || ''}`, stops: mapStops(x.stops) }))}
            free={board.unassigned.flatMap(d => (d.lat !== null && d.lon !== null ? [{ id: d.id, lat: Number(d.lat), lon: Number(d.lon), label: '•', title: d.address || d.documentNumber || '' }] : []))}
            onRouteClick={id => setOpen({ id })}
          />
        </section>
      </div>
      {open && <TripDialog key={open.id ?? 'new'} id={open.id} {...(open.defaults ? { defaults: open.defaults } : {})} onClose={() => setOpen(null)} />}
    </div>
  );
}
