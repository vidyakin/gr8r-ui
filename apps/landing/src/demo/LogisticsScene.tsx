/* Запись «Логистика»: диспетчер дня — доставки перетаскиваются в рейс машины, рейс уходит «В пути», затем у доставки статус «Доставлена».
   Разметка — как у DispatchPage.tsx (доставки слева, машины с осью времени справа), TripDialog.tsx (карточка рейса) и DeliveriesPage.tsx (список) */
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, GripVertical, Plus, Shuffle, Trash2, X } from 'lucide-react';
import { DemoShell, fmtNum, money } from './shell';
import type { Scene } from './player';
import type { Locale } from '../i18n';
import { LOGISTICS_DICT, type DelData as Del, type DelStatus as Status, type LogisticsDict } from './i18n/logistics';

interface S {
  view: 'dispatch' | 'list';
  dels: Del[];
  /** Рейс сцены: создаётся первой брошенной доставкой; stops — id доставок по порядку */
  trip: { stops: string[]; status: 'planned' | 'in_transit' } | null;
  drag: string | null;
  hot: 'lane' | 'bar' | null;
  dialog: boolean;
  toast: string | null;
  fresh: string | null;
}

const initial = (locale: Locale): S => ({
  view: 'dispatch',
  dels: LOGISTICS_DICT[locale].initialDels,
  trip: null,
  drag: null,
  hot: null,
  dialog: false,
  toast: null,
  fresh: null,
});

const place =
  (id: string, locale: Locale) =>
  (s: S): S => {
    const d = LOGISTICS_DICT[locale];
    return {
      ...s,
      drag: null,
      hot: null,
      fresh: id,
      toast: s.trip ? d.toasts.added : d.toasts.created(d.tripNum),
      trip: { status: 'planned', stops: [...(s.trip?.stops ?? []), id] },
      dels: s.dels.map(x => (x.id === id ? { ...x, trip: 't1', status: 'assigned' } : x)),
    };
  };
const start = (s: S): S => ({
  ...s,
  dialog: false,
  toast: null,
  fresh: null,
  trip: s.trip && { ...s.trip, status: 'in_transit' },
  dels: s.dels.map(d => (d.trip === 't1' ? { ...d, status: 'in_transit' } : d)),
});
const delivered =
  (locale: Locale) =>
  (s: S): S => ({
    ...s,
    toast: LOGISTICS_DICT[locale].toasts.statusChanged,
    fresh: 'd1',
    dels: s.dels.map(d => (d.id === 'd1' ? { ...d, status: 'delivered' } : d)),
  });

const final = (locale: Locale): S => ({
  ...delivered(locale)({
    ...start(['d1', 'd2', 'd3'].reduce((s, id) => place(id, locale)(s), initial(locale))),
    view: 'list',
  }),
  view: 'list',
  toast: null,
  fresh: null,
});

const T0 = { from: '08:00', to: '17:00' };
const FROM_H = 6;
const SPAN = 16 * 60;
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const pct = (m: number) => Math.max(0, Math.min(100, ((m - FROM_H * 60) / SPAN) * 100));

function DelCard({ d, kgUnit, grab }: { d: Del; kgUnit: string; grab?: boolean }) {
  return (
    <div className="panel plain" style={{ padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'flex-start', borderBottom: '1px solid var(--divider)' }} data-demo={grab ? `card-${d.id}` : undefined}>
      <GripVertical size={14} className="faint" style={{ marginTop: 3, flex: 'none' }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <b>{d.num}</b>
          <span className="muted trunc">{d.who}</span>
        </div>
        <div className="trunc">{d.addr}</div>
        <div className="row muted" style={{ gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
          <span className="num">{d.win.join('–')}</span>
          <span className="num">{d.kg} {kgUnit}</span>
        </div>
      </div>
    </div>
  );
}

/** Полоса рейса на оси дня, как TripBar: номер и статус, водитель, вес / вместимость, номера точек с окнами */
function TripBar({ num: no, status, inTransit, driver, stops, left, width, hot, fresh, demo, dict, locale }: { num: string; status: string; inTransit: boolean; driver: string; stops: Del[]; left: number; width: number; hot: boolean; fresh?: boolean; demo?: string; dict: LogisticsDict; locale: Locale }) {
  const kg = stops.reduce((a, d) => a + d.kg, 0);
  const tone = inTransit ? 'accent' : 'gray';
  return (
    <div style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 6, bottom: 6 }} data-demo={demo}>
      <div
        className={fresh ? 'd-fresh' : undefined}
        style={{
          width: '100%',
          height: '100%',
          padding: '4px 8px',
          borderRadius: 6,
          border: `1px solid ${hot ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: hot ? 'var(--accent-soft)' : 'var(--surface-2)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <b className="trunc">{no}</b>
          <span className={`badge ${tone}`} key={status}>
            {status}
          </span>
        </span>
        <span className="muted trunc" style={{ fontSize: 12 }}>
          {driver} · {dict.stopsLabel(stops.length)} · {fmtNum(kg, locale)}
        </span>
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {stops.map((d, i) => (
            <span key={d.id} className={`badge ${d.status === 'delivered' ? 'green' : 'gray'}`}>
              {i + 1} {d.win[0]}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function Dispatch({ s, compact, dict, locale }: { s: S; compact: boolean; dict: LogisticsDict; locale: Locale }) {
  const free = s.dels.filter(d => d.trip === null);
  const mine = (s.trip?.stops ?? []).map(id => s.dels.find(d => d.id === id)!);
  const t0 = s.dels.filter(d => d.trip === 't0');
  const hours = [6, 8, 10, 12, 14, 16, 18, 20, 22];
  return (
    <>
      <div className="d-ph" style={{ flexWrap: 'wrap' }}>
        <div>
          <div className="d-ph-title">{dict.dispatchTitle}</div>
          <p>{dict.dispatchSubtitle}</p>
        </div>
        <span className="sp" />
        <div className="row" style={{ gap: 8 }}>
          <span className="ibtn">
            <ChevronLeft size={15} />
          </span>
          <span className="input d-sel" style={{ width: 130 }}>
            {dict.dateStr}
          </span>
          <span className="ibtn">
            <ChevronRight size={15} />
          </span>
          {!compact && <span className="btn btn-ghost btn-sm">{dict.todayBtn}</span>}
          <span className="btn btn-secondary btn-sm">
            <Shuffle size={13} />
            {dict.autoAssignBtn}
          </span>
          <span className="btn btn-primary btn-sm">
            <Plus size={13} />
            {compact ? '' : dict.newTripBtn}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, padding: '0 var(--gutter) 24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <section style={{ flex: '0 0 320px', maxWidth: '100%' }} className="stack">
          <div className="label" style={{ marginBottom: 8 }}>
            {dict.unassignedHeader(free.length)}
          </div>
          <div className="stack" style={{ gap: 0 }}>
            {free.map(d => (
              <div key={d.id} style={{ opacity: s.drag === d.id ? 0.4 : 1 }}>
                <DelCard d={d} kgUnit={dict.kgUnit} grab />
              </div>
            ))}
          </div>
        </section>
        <section style={{ flex: '1 1 520px', minWidth: 0 }}>
          <div className="label" style={{ marginBottom: 8 }}>
            {dict.vehiclesHeader}
          </div>
          <div className="row muted" style={{ marginLeft: 150, position: 'relative', height: 16, fontSize: 11 }} aria-hidden="true">
            {hours.map(h => (
              <span key={h} style={{ position: 'absolute', left: `${pct(h * 60)}%`, transform: 'translateX(-50%)' }} className="num">
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {dict.vehicles.map(v => {
              const lane = v.id === 'v1' && !s.trip && s.hot === 'lane';
              return (
                <div key={v.id} className="row" style={{ gap: 0, alignItems: 'stretch' }}>
                  <div style={{ width: 150, flex: 'none', paddingRight: 8 }}>
                    <b>{v.plate}</b>
                    <div className="muted trunc" style={{ fontSize: 12 }}>
                      {v.name}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {dict.upToCap(fmtNum(v.cap, locale))}
                    </div>
                  </div>
                  <div
                    data-demo={`lane-${v.id}`}
                    style={{
                      position: 'relative',
                      flex: 1,
                      minHeight: 84,
                      borderRadius: 6,
                      border: lane ? '1px solid var(--accent)' : '1px dashed var(--border-strong)',
                      backgroundImage: 'repeating-linear-gradient(90deg, transparent 0, transparent calc(12.5% - 1px), var(--divider) calc(12.5% - 1px), var(--divider) 12.5%)',
                    }}
                  >
                    {v.id === 'v2' && (
                      <TripBar
                        num={dict.otherTripNum}
                        status={dict.tripStatus.in_transit}
                        inTransit
                        driver={dict.otherDriver}
                        stops={t0.map((d, i) => (i ? d : { ...d, status: 'delivered' }))}
                        left={pct(mins(T0.from))}
                        width={pct(mins(T0.to)) - pct(mins(T0.from))}
                        hot={false}
                        dict={dict}
                        locale={locale}
                      />
                    )}
                    {v.id === 'v1' && !s.trip && (
                      <span className="muted" style={{ position: 'absolute', left: 10, top: 28, fontSize: 12 }}>
                        {lane ? dict.dropHereHint : dict.freeAllDay}
                      </span>
                    )}
                    {v.id === 'v1' && s.trip && (
                      <TripBar
                        num={dict.tripNum}
                        status={s.trip.status === 'planned' ? dict.tripStatus.planned : dict.tripStatus.in_transit}
                        inTransit={s.trip.status === 'in_transit'}
                        driver={dict.driver}
                        stops={mine}
                        left={0}
                        width={100}
                        hot={s.hot === 'bar'}
                        fresh={!!s.fresh}
                        demo="bar-t1"
                        dict={dict}
                        locale={locale}
                      />
                    )}
                    {v.id === 'v3' && (
                      <span className="muted" style={{ position: 'absolute', left: 10, top: 28, fontSize: 12 }}>
                        {dict.freeAllDay}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

const Fld = ({ label, v }: { label: string; v: string }) => (
  <div className="field">
    <span className="label">{label}</span>
    <span className="input d-sel">{v}</span>
  </div>
);

function TripCard({ s, compact, dict, locale }: { s: S; compact: boolean; dict: LogisticsDict; locale: Locale }) {
  const stops = (s.trip?.stops ?? []).map(id => s.dels.find(d => d.id === id)!);
  const kg = stops.reduce((a, d) => a + d.kg, 0);
  const v1 = dict.vehicles[0]!;
  return (
    <div className="d-modal" style={{ paddingTop: compact ? 20 : 28 }}>
      <div className="modal lg d-pop" style={{ maxWidth: 720 }}>
        <div className="modal-h">
          <h2>{dict.tripHeading(dict.tripNum)}</h2>
          <span className="ibtn ibtn-sm">
            <X size={14} />
          </span>
        </div>
        <div className="modal-desc">{dict.tripStatus.planned}</div>
        <div className="modal-b">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Fld label={dict.tripKindLabel} v={dict.tripKindVal} />
            <Fld label={dict.dateLabel} v={dict.dateStr} />
            <Fld label={dict.vehicleLabel} v={`${v1.plate} · ${v1.name}`} />
            <Fld label={dict.driverLabel} v={dict.driver} />
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="label">{dict.stopsTitle}</div>
              <span className="muted">
                {dict.loadLabel}: <b className="num">{fmtNum(kg, locale)}</b> {dict.kgUnit} / {fmtNum(v1.cap, locale)}
              </span>
            </div>
            {stops.map((d, i) => (
              <div key={d.id} className="row" style={{ gap: 8, alignItems: 'flex-start', padding: '6px 0', borderTop: i ? '1px solid var(--divider)' : undefined }}>
                <b className="num" style={{ width: 22 }}>
                  {i + 1}
                </b>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge gray">{dict.deliveryBadge}</span>
                    <span className="link">{d.addr}</span>
                    <span className="muted">{d.num}</span>
                    <span className="badge gray">{dict.plannedBadge}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {d.win.join('–')} · {d.kg} {dict.kgUnit} · {d.contact.split(' · ')[0]}
                  </div>
                </div>
                <div className="row" style={{ gap: 2 }}>
                  <span className="ibtn ibtn-sm">
                    <ArrowUp size={13} />
                  </span>
                  <span className="ibtn ibtn-sm">
                    <ArrowDown size={13} />
                  </span>
                  <span className="ibtn ibtn-sm">
                    <Trash2 size={13} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-f">
          <span className="btn btn-ghost btn-sm">{dict.printRoute}</span>
          <span className="btn btn-ghost btn-sm">{dict.createWaybill}</span>
          <span className="sp" />
          <span className="btn btn-ghost btn-sm">{dict.cancelTrip}</span>
          <span className="btn btn-secondary btn-sm" data-demo="dlg-start">
            {dict.dispatchBtn}
          </span>
          <span className="btn btn-primary btn-sm">{dict.saveBtn}</span>
        </div>
      </div>
    </div>
  );
}

const StatusSel = ({ st, statusLabels, flash, demo }: { st: Status; statusLabels: Record<Status, string>; flash: boolean; demo: string }) => (
  <span className={'select-btn input d-sel' + (flash ? ' d-flash' : '')} style={{ height: 28, width: 150 }} data-demo={demo} key={st}>
    <span className="trunc">{statusLabels[st]}</span>
    <ChevronDown size={13} className="chev" />
  </span>
);

function List({ s, compact, dict, locale }: { s: S; compact: boolean; dict: LogisticsDict; locale: Locale }) {
  const rows = [...s.dels].sort((a, b) => a.win[0].localeCompare(b.win[0]));
  return (
    <>
      <div className="d-ph">
        <div>
          <div className="d-ph-title">{dict.listTitle}</div>
          <p>{dict.listSubtitle}</p>
        </div>
      </div>
      <div className="tabs d-tabs">
        <span className="tab on">{dict.listTabs[0]}</span>
        <span className="tab">{dict.listTabs[1]}</span>
      </div>
      <section className="panel plain" style={{ margin: '12px var(--gutter) 12px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Fld label={dict.filters.from} v={dict.dateStr} />
          <Fld label={dict.filters.to} v={dict.dateStr} />
          {!compact && <Fld label={dict.filters.courier} v={dict.filters.allCouriers} />}
          {!compact && <Fld label={dict.filters.method} v={dict.filters.allMethods} />}
          <Fld label={dict.filters.status} v={dict.filters.allStatuses} />
        </div>
      </section>
      <section className="panel d-report">
        <table className="dtbl">
          <thead>
            <tr>
              <th>{dict.tableCols[0]}</th>
              <th>{dict.tableCols[1]}</th>
              <th>{dict.tableCols[2]}</th>
              {!compact && <th>{dict.tableCols[3]}</th>}
              {!compact && <th className="r">{dict.tableCols[4]}</th>}
              <th>{dict.tableCols[5]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(d => (
              <tr key={d.id} className={s.fresh === d.id ? 'd-row-hot' : undefined}>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {compact ? '' : `${dict.dateStr} `}
                  {d.win.join('–')}
                </td>
                <td>
                  <span className="trunc">{d.addr}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{compact ? '' : dict.orderPrefix}{d.num}</td>
                {!compact && <td className="muted" style={{ whiteSpace: 'nowrap' }}>{d.trip === 't0' ? dict.otherDriver : d.trip === 't1' ? dict.driver : dict.unassignedDriver}</td>}
                {!compact && <td className="r num" style={{ whiteSpace: 'nowrap' }}>{money(d.price, locale)}</td>}
                <td>
                  <StatusSel st={d.status} statusLabels={dict.statusLabels} flash={s.fresh === d.id} demo={`st-${d.id}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export const logisticsScene: Scene<S> = {
  initial,
  final,
  height: [680, 860],
  script: async ({ set, wait, move, click }, locale) => {
    const dragTo = async (id: string, target: string, hot: S['hot']) => {
      await move(`card-${id}`, { ax: 0.5, ay: 0.3 });
      await wait(150);
      set(s => ({ ...s, drag: id, fresh: null, toast: null }));
      await wait(200);
      await move(target, { ax: 0.5, ay: 0.5, dur: 950 });
      set(s => ({ ...s, hot }));
      await wait(450);
      set(place(id, locale));
      await wait(900);
    };
    await dragTo('d1', 'lane-v1', 'lane');
    await dragTo('d2', 'bar-t1', 'bar');
    await dragTo('d3', 'bar-t1', 'bar');
    await wait(500);
    await move('bar-t1', { ax: 0.85, ay: 0.5 });
    await click();
    set(s => ({ ...s, dialog: true, toast: null, fresh: null }));
    await wait(1100);
    await move('dlg-start');
    await click();
    set(start);
    await wait(1400);
    await move('nav-deliveries');
    await click();
    set(s => ({ ...s, view: 'list' }));
    await wait(1100);
    await move('st-d1');
    await click();
    set(delivered(locale));
    await wait(300);
  },
  render: (s, { compact, cursor, locale }) => {
    const dict = LOGISTICS_DICT[locale];
    const dragged = s.drag ? s.dels.find(d => d.id === s.drag) : null;
    return (
      <DemoShell compact={compact} active={s.view === 'list' ? 'deliveries' : 'dispatch'} crumbs={s.view === 'list' ? dict.crumbsList : dict.crumbsDispatch} locale={locale}>
        <div key={s.view} className="d-page-in" style={{ flex: 1, minHeight: 0 }}>
          {s.view === 'dispatch' ? <Dispatch s={s} compact={compact} dict={dict} locale={locale} /> : <List s={s} compact={compact} dict={dict} locale={locale} />}
        </div>
        {dragged && (
          <div className="ghost" style={{ width: 300, background: 'var(--surface)', borderRadius: 8, boxShadow: 'var(--shadow-drag)', transform: `translate(${cursor.x - 60}px, ${cursor.y - 22}px) rotate(1.5deg)`, transitionDuration: `${cursor.dur}ms` }}>
            <DelCard d={dragged} kgUnit={dict.kgUnit} />
          </div>
        )}
        {s.dialog && <TripCard s={s} compact={compact} dict={dict} locale={locale} />}
        {s.toast && (
          <div className="toast d-toast">
            <CircleCheck size={15} />
            <span>{s.toast}</span>
          </div>
        )}
      </DemoShell>
    );
  },
};
