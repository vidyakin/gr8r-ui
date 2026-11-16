/* Запись «Логистика»: диспетчер дня — доставки перетаскиваются в рейс машины, рейс уходит «В пути», затем у доставки статус «Доставлена».
   Разметка — как у DispatchPage.tsx (доставки слева, машины с осью времени справа), TripDialog.tsx (карточка рейса) и DeliveriesPage.tsx (список) */
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, GripVertical, Plus, Shuffle, Trash2, X } from 'lucide-react';
import { DemoShell, rub } from './shell';
import type { Scene } from './player';

type Status = 'new' | 'assigned' | 'in_transit' | 'delivered';
interface Del {
  id: string;
  num: string;
  who: string;
  addr: string;
  contact: string;
  win: [string, string];
  kg: number;
  price: number;
  status: Status;
  /** t0 — чужой рейс, t1 — рейс сцены, null — не распределена */
  trip: 't0' | 't1' | null;
}
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

const TRIP_NUM = 'РС-2026-00024';
const DRIVER = 'Сафин Ринат';
const STATUS: Record<Status, string> = { new: 'Новая', assigned: 'Назначена', in_transit: 'В пути', delivered: 'Доставлена' };

const del = (id: string, num: string, who: string, addr: string, contact: string, win: [string, string], kg: number, price: number, status: Status = 'new', trip: Del['trip'] = null): Del => ({
  id,
  num,
  who,
  addr,
  contact,
  win,
  kg,
  price,
  status,
  trip,
});

const initial: S = {
  view: 'dispatch',
  dels: [
    del('d1', 'ЗК-000131', 'Петров Андрей', 'ул. Лесная, 14, кв. 52', 'Петров А. · +7 916 204-18-30', ['10:00', '12:00'], 86, 600),
    del('d2', 'ЗК-000132', 'ООО «Атлас Мебель»', 'Ленинградский пр-т, 37к2', 'Фролова Е. · +7 495 120-44-09', ['12:00', '14:00'], 240, 900),
    del('d3', 'ЗК-000134', 'Кузнецова Ольга', 'ул. Новочерёмушкинская, 21', 'Кузнецова О. · +7 903 551-02-76', ['14:00', '16:00'], 54, 450),
    del('d4', 'ЗК-000135', 'ИП Громов С. В.', 'Варшавское ш., 125Ж', 'Громов С. · +7 925 707-33-18', ['15:00', '18:00'], 310, 1200),
    del('d6', 'ЗК-000127', 'ООО «Северстрой»', 'Волгоградский пр-т, 32к5', 'Миронов Д. · +7 495 777-12-50', ['09:00', '11:00'], 420, 1200, 'in_transit', 't0'),
    del('d7', 'ЗК-000129', 'Орлова Анна', 'ул. Профсоюзная, 56', 'Орлова А. · +7 926 318-90-04', ['11:00', '13:00'], 95, 600, 'in_transit', 't0'),
  ],
  trip: null,
  drag: null,
  hot: null,
  dialog: false,
  toast: null,
  fresh: null,
};

const place =
  (id: string) =>
  (s: S): S => ({
    ...s,
    drag: null,
    hot: null,
    fresh: id,
    toast: s.trip ? 'Доставка добавлена в рейс' : `Рейс ${TRIP_NUM} создан`,
    trip: { status: 'planned', stops: [...(s.trip?.stops ?? []), id] },
    dels: s.dels.map(d => (d.id === id ? { ...d, trip: 't1', status: 'assigned' } : d)),
  });
const start = (s: S): S => ({
  ...s,
  dialog: false,
  toast: null,
  fresh: null,
  trip: s.trip && { ...s.trip, status: 'in_transit' },
  dels: s.dels.map(d => (d.trip === 't1' ? { ...d, status: 'in_transit' } : d)),
});
const delivered = (s: S): S => ({ ...s, toast: 'Статус изменён', fresh: 'd1', dels: s.dels.map(d => (d.id === 'd1' ? { ...d, status: 'delivered' } : d)) });

const final: S = { ...delivered({ ...start([place('d1'), place('d2'), place('d3')].reduce((s, f) => f(s), initial)), view: 'list' }), view: 'list', toast: null, fresh: null };

const T0 = { from: '08:00', to: '17:00' };
const FROM_H = 6;
const SPAN = 16 * 60;
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const pct = (m: number) => Math.max(0, Math.min(100, ((m - FROM_H * 60) / SPAN) * 100));

const VEHICLES = [
  { id: 'v1', plate: 'А 482 ВС 77', name: 'ГАЗель NEXT', cap: 1500 },
  { id: 'v2', plate: 'Е 117 ОК 50', name: 'Ford Transit', cap: 1100 },
  { id: 'v3', plate: 'М 905 РТ 77', name: 'Hyundai Porter', cap: 900 },
];
const num = (n: number) => n.toLocaleString('ru-RU');

function DelCard({ d, grab }: { d: Del; grab?: boolean }) {
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
          <span className="num">{d.kg} кг</span>
        </div>
      </div>
    </div>
  );
}

/** Полоса рейса на оси дня, как TripBar: номер и статус, водитель, вес / вместимость, номера точек с окнами */
function TripBar({ num: no, status, driver, stops, left, width, hot, fresh, demo }: { num: string; status: string; driver: string; stops: Del[]; left: number; width: number; hot: boolean; fresh?: boolean; demo?: string }) {
  const kg = stops.reduce((a, d) => a + d.kg, 0);
  const tone = status === 'В пути' ? 'accent' : 'gray';
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
          {driver} · точек: {stops.length} · {num(kg)}
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

function Dispatch({ s, compact }: { s: S; compact: boolean }) {
  const free = s.dels.filter(d => d.trip === null);
  const mine = (s.trip?.stops ?? []).map(id => s.dels.find(d => d.id === id)!);
  const t0 = s.dels.filter(d => d.trip === 't0');
  const hours = [6, 8, 10, 12, 14, 16, 18, 20, 22];
  return (
    <>
      <div className="d-ph" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1>Диспетчер</h1>
          <p>Нераспределённые доставки, машины на день и таймлайн. Перетащите доставку на рейс или на машину.</p>
        </div>
        <span className="sp" />
        <div className="row" style={{ gap: 8 }}>
          <span className="ibtn">
            <ChevronLeft size={15} />
          </span>
          <span className="input d-sel" style={{ width: 130 }}>
            05.11.2026
          </span>
          <span className="ibtn">
            <ChevronRight size={15} />
          </span>
          {!compact && <span className="btn btn-ghost btn-sm">Сегодня</span>}
          <span className="btn btn-secondary btn-sm">
            <Shuffle size={13} />
            Распределить
          </span>
          <span className="btn btn-primary btn-sm">
            <Plus size={13} />
            {compact ? '' : 'Новый рейс'}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, padding: '0 var(--gutter) 24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <section style={{ flex: '0 0 320px', maxWidth: '100%' }} className="stack">
          <div className="label" style={{ marginBottom: 8 }}>
            Нераспределённые доставки · {free.length}
          </div>
          <div className="stack" style={{ gap: 0 }}>
            {free.map(d => (
              <div key={d.id} style={{ opacity: s.drag === d.id ? 0.4 : 1 }}>
                <DelCard d={d} grab />
              </div>
            ))}
          </div>
        </section>
        <section style={{ flex: '1 1 520px', minWidth: 0 }}>
          <div className="label" style={{ marginBottom: 8 }}>
            Машины на день · 5 ноября
          </div>
          <div className="row muted" style={{ marginLeft: 150, position: 'relative', height: 16, fontSize: 11 }} aria-hidden="true">
            {hours.map(h => (
              <span key={h} style={{ position: 'absolute', left: `${pct(h * 60)}%`, transform: 'translateX(-50%)' }} className="num">
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {VEHICLES.map(v => {
              const lane = v.id === 'v1' && !s.trip && s.hot === 'lane';
              return (
                <div key={v.id} className="row" style={{ gap: 0, alignItems: 'stretch' }}>
                  <div style={{ width: 150, flex: 'none', paddingRight: 8 }}>
                    <b>{v.plate}</b>
                    <div className="muted trunc" style={{ fontSize: 12 }}>
                      {v.name}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      до {num(v.cap)} кг
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
                    {v.id === 'v2' && <TripBar num="РС-2026-00023" status="В пути" driver="Ковалёв Дмитрий" stops={t0.map((d, i) => (i ? d : { ...d, status: 'delivered' }))} left={pct(mins(T0.from))} width={pct(mins(T0.to)) - pct(mins(T0.from))} hot={false} />}
                    {v.id === 'v1' && !s.trip && (
                      <span className="muted" style={{ position: 'absolute', left: 10, top: 28, fontSize: 12 }}>
                        {lane ? 'Бросьте доставку сюда, чтобы создать рейс' : 'Свободна весь день'}
                      </span>
                    )}
                    {v.id === 'v1' && s.trip && (
                      <TripBar num={TRIP_NUM} status={s.trip.status === 'planned' ? 'План' : 'В пути'} driver={DRIVER} stops={mine} left={0} width={100} hot={s.hot === 'bar'} fresh={!!s.fresh} demo="bar-t1" />
                    )}
                    {v.id === 'v3' && (
                      <span className="muted" style={{ position: 'absolute', left: 10, top: 28, fontSize: 12 }}>
                        Свободна весь день
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

function TripCard({ s, compact }: { s: S; compact: boolean }) {
  const stops = (s.trip?.stops ?? []).map(id => s.dels.find(d => d.id === id)!);
  const kg = stops.reduce((a, d) => a + d.kg, 0);
  return (
    <div className="d-modal" style={{ paddingTop: compact ? 20 : 28 }}>
      <div className="modal lg d-pop" style={{ maxWidth: 720 }}>
        <div className="modal-h">
          <h2>Рейс {TRIP_NUM}</h2>
          <span className="ibtn ibtn-sm">
            <X size={14} />
          </span>
        </div>
        <div className="modal-desc">План</div>
        <div className="modal-b">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Fld label="Вид рейса" v="Городской" />
            <Fld label="Дата" v="05.11.2026" />
            <Fld label="Машина" v="А 482 ВС 77 · ГАЗель NEXT" />
            <Fld label="Водитель" v={DRIVER} />
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="label">Точки рейса</div>
              <span className="muted">
                Загрузка: <b className="num">{num(kg)}</b> кг / {num(1500)}
              </span>
            </div>
            {stops.map((d, i) => (
              <div key={d.id} className="row" style={{ gap: 8, alignItems: 'flex-start', padding: '6px 0', borderTop: i ? '1px solid var(--divider)' : undefined }}>
                <b className="num" style={{ width: 22 }}>
                  {i + 1}
                </b>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge gray">Доставка</span>
                    <span className="link">{d.addr}</span>
                    <span className="muted">{d.num}</span>
                    <span className="badge gray">В плане</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {d.win.join('–')} · {d.kg} кг · {d.contact.split(' · ')[0]}
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
          <span className="btn btn-ghost btn-sm">Печать маршрутного листа</span>
          <span className="btn btn-ghost btn-sm">Создать путевой лист</span>
          <span className="sp" />
          <span className="btn btn-ghost btn-sm">Отменить рейс</span>
          <span className="btn btn-secondary btn-sm" data-demo="dlg-start">
            Отправить
          </span>
          <span className="btn btn-primary btn-sm">Сохранить</span>
        </div>
      </div>
    </div>
  );
}

const StatusSel = ({ st, flash, demo }: { st: Status; flash: boolean; demo: string }) => (
  <span className={'select-btn input d-sel' + (flash ? ' d-flash' : '')} style={{ height: 28, width: 150 }} data-demo={demo} key={st}>
    <span className="trunc">{STATUS[st]}</span>
    <ChevronDown size={13} className="chev" />
  </span>
);

function List({ s, compact }: { s: S; compact: boolean }) {
  const rows = [...s.dels].sort((a, b) => a.win[0].localeCompare(b.win[0]));
  return (
    <>
      <div className="d-ph">
        <div>
          <h1>Доставки</h1>
          <p>Доставки по дням и курьерам: назначение курьеров, смена статусов, отчёт.</p>
        </div>
      </div>
      <div className="tabs d-tabs">
        <span className="tab on">Доставки</span>
        <span className="tab">Отчёт</span>
      </div>
      <section className="panel plain" style={{ margin: '12px var(--gutter) 12px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Fld label="С" v="05.11.2026" />
          <Fld label="По" v="05.11.2026" />
          {!compact && <Fld label="Курьер" v="Все курьеры" />}
          {!compact && <Fld label="Способ" v="Все способы" />}
          <Fld label="Статус" v="Все статусы" />
        </div>
      </section>
      <section className="panel d-report">
        <table className="dtbl">
          <thead>
            <tr>
              <th>Время</th>
              <th>Адрес</th>
              <th>Документ</th>
              {!compact && <th>Курьер</th>}
              {!compact && <th className="r">Цена</th>}
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(d => (
              <tr key={d.id} className={s.fresh === d.id ? 'd-row-hot' : undefined}>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {compact ? '' : '05.11.2026 '}
                  {d.win.join('–')}
                </td>
                <td>
                  <span className="trunc">{d.addr}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{compact ? '' : 'Заказ '}{d.num}</td>
                {!compact && <td className="muted" style={{ whiteSpace: 'nowrap' }}>{d.trip === 't0' ? 'Ковалёв Дмитрий' : d.trip === 't1' ? DRIVER : 'Не назначен'}</td>}
                {!compact && <td className="r num" style={{ whiteSpace: 'nowrap' }}>{rub(d.price)}</td>}
                <td>
                  <StatusSel st={d.status} flash={s.fresh === d.id} demo={`st-${d.id}`} />
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
  script: async ({ set, wait, move, click }) => {
    const dragTo = async (id: string, target: string, hot: S['hot']) => {
      await move(`card-${id}`, { ax: 0.5, ay: 0.3 });
      await wait(150);
      set(s => ({ ...s, drag: id, fresh: null, toast: null }));
      await wait(200);
      await move(target, { ax: 0.5, ay: 0.5, dur: 950 });
      set(s => ({ ...s, hot }));
      await wait(450);
      set(place(id));
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
    set(delivered);
    await wait(300);
  },
  render: (s, { compact, cursor }) => {
    const dragged = s.drag ? s.dels.find(d => d.id === s.drag) : null;
    return (
      <DemoShell compact={compact} active={s.view === 'list' ? 'deliveries' : 'dispatch'} crumbs={s.view === 'list' ? ['Услуги', 'Доставки'] : ['Транспорт', 'Диспетчер']}>
        <div key={s.view} className="d-page-in" style={{ flex: 1, minHeight: 0 }}>
          {s.view === 'dispatch' ? <Dispatch s={s} compact={compact} /> : <List s={s} compact={compact} />}
        </div>
        {dragged && (
          <div className="ghost" style={{ width: 300, background: 'var(--surface)', borderRadius: 8, boxShadow: 'var(--shadow-drag)', transform: `translate(${cursor.x - 60}px, ${cursor.y - 22}px) rotate(1.5deg)`, transitionDuration: `${cursor.dur}ms` }}>
            <DelCard d={dragged} />
          </div>
        )}
        {s.dialog && <TripCard s={s} compact={compact} />}
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
