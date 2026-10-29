/* Запись «Услуги»: день записи к мастерам — клиент записывается на свободный слот, затем пришедшему ставится «Пришёл».
   Разметка — как у appointments-ui.tsx (сетка .appt-grid) и карточки записи в диалоге */
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { DemoShell } from './shell';
import type { Scene } from './player';

type St = 'booked' | 'confirmed' | 'came';
interface Appt {
  id: string;
  col: number;
  /** Начало — номер получасового слота от 9:00 */
  at: number;
  len: number;
  name: string;
  svc: string;
  st: St;
}
interface S {
  appts: Appt[];
  /** Слот, по которому кликнули: открыт диалог новой записи */
  booking: { col: number; at: number; client: string; svc: string | null } | null;
  /** Открытая карточка записи */
  card: string | null;
  fresh: string | null;
}

const COLS = ['Ковалёв Дмитрий', 'Орлова Анна', 'Сафин Ринат'];
const ROWS = 10;
const time = (at: number) => `${9 + Math.floor(at / 2)}:${at % 2 ? '30' : '00'}`;
const STATUS: Record<St, string> = { booked: 'Записан', confirmed: 'Подтверждён', came: 'Пришёл' };

const initial: S = {
  appts: [
    { id: 'a1', col: 0, at: 0, len: 2, name: 'Петров Андрей', svc: 'Замер кухни', st: 'came' },
    { id: 'a2', col: 0, at: 4, len: 3, name: 'Лебедева Ирина', svc: 'Сборка шкафа', st: 'confirmed' },
    { id: 'a3', col: 1, at: 1, len: 2, name: 'Громов Сергей', svc: 'Ремонт фасада', st: 'confirmed' },
    { id: 'a4', col: 1, at: 7, len: 2, name: 'Кузнецова Ольга', svc: 'Гарантийный осмотр', st: 'booked' },
    { id: 'a5', col: 2, at: 2, len: 4, name: 'ООО «Северстрой»', svc: 'Монтаж гардеробной', st: 'confirmed' },
  ],
  booking: null,
  card: null,
  fresh: null,
};

const NEW: Appt = { id: 'a6', col: 1, at: 4, len: 2, name: 'Соколова Мария', svc: 'Замер кухни', st: 'booked' };
const book = (s: S): S => ({ ...s, booking: null, fresh: NEW.id, appts: [...s.appts, NEW] });
const came = (s: S): S => ({ ...s, card: null, fresh: 'a3', appts: s.appts.map(a => (a.id === 'a3' ? { ...a, st: 'came' } : a)) });
const final: S = { ...came(book(initial)), fresh: null };

const Select = ({ v, ph, focus }: { v: string | null; ph: string; focus?: boolean }) => (
  <span className={'select-btn input d-sel' + (focus ? ' d-focus' : '')}>
    <span className={'trunc' + (v ? '' : ' d-ph-text')}>{v ?? ph}</span>
  </span>
);

function Grid({ s }: { s: S }) {
  const cells = [];
  for (let c = 0; c < COLS.length; c++)
    for (let r = 0; r < ROWS; r++) {
      const busy = s.appts.some(a => a.col === c && r >= a.at && r < a.at + a.len);
      if (!busy)
        cells.push(
          <span
            key={`f${c}-${r}`}
            className={'appt-cell free' + (s.booking?.col === c && s.booking.at === r ? ' target' : '')}
            style={{ gridColumn: c + 2, gridRow: r + 2 }}
            data-demo={`slot-${c}-${r}`}
          >
            {s.booking?.col === c && s.booking.at === r ? time(r) : ''}
          </span>,
        );
    }
  return (
    <div className="appt-scroll">
      <div className="appt-grid" style={{ gridTemplateColumns: `64px repeat(${COLS.length}, minmax(120px, 1fr))`, gridTemplateRows: `auto repeat(${ROWS}, 32px)` }}>
        <div className="appt-h corner" style={{ gridColumn: 1, gridRow: 1 }} />
        {COLS.map((n, i) => (
          <div key={n} className="appt-h" style={{ gridColumn: i + 2, gridRow: 1 }}>
            {n}
          </div>
        ))}
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} className="appt-time" style={{ gridColumn: 1, gridRow: r + 2 }}>
            {time(r)}
          </div>
        ))}
        {cells}
        {s.appts.map(a => (
          <span
            key={a.id}
            className={`appt-item ${a.st}` + (s.fresh === a.id ? ' d-fresh' : '')}
            style={{ gridColumn: a.col + 2, gridRow: `${a.at + 2} / span ${a.len}` }}
            data-demo={`appt-${a.id}`}
          >
            <span className="nm">{a.name}</span>
            <span className="sv">
              {time(a.at)} · {a.svc}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export const servicesScene: Scene<S> = {
  initial,
  final,
  height: [580, 580],
  script: async ({ set, wait, move, click, type }) => {
    await move('slot-1-4');
    await click();
    set(s => ({ ...s, booking: { col: 1, at: 4, client: '', svc: null } }));
    await wait(450);
    await move('bk-client');
    await click();
    await type(NEW.name, (s, v) => ({ ...s, booking: s.booking && { ...s.booking, client: v } }));
    await wait(300);
    await move('bk-svc');
    await click();
    set(s => ({ ...s, booking: s.booking && { ...s.booking, svc: NEW.svc } }));
    await wait(500);
    await move('bk-submit');
    await click();
    set(book);
    await wait(1500);
    await move('appt-a3', { ay: 0.4 });
    await click();
    set(s => ({ ...s, card: 'a3', fresh: null }));
    await wait(700);
    await move('card-came');
    await click();
    set(came);
    await wait(300);
  },
  render: (s, { compact }) => {
    const card = s.card ? s.appts.find(a => a.id === s.card)! : null;
    return (
      <DemoShell compact={compact} active="appts" crumbs={['Услуги', 'Запись']}>
        <div className="d-ph">
          <div>
            <h1>Запись</h1>
            <p>Запись клиентов к специалистам: кто свободен, кто пришёл, закрытие дня.</p>
          </div>
          <span className="sp" />
          <span className="btn btn-primary">
            <Plus size={14} />
            Новая запись
          </span>
        </div>
        <div className="tabs d-tabs">
          <span className="tab on">День</span>
          <span className="tab">Специалист</span>
          <span className="tab">Незакрытые дни</span>
          <span className="tab">Графики</span>
        </div>
        <div className="d-toolbar">
          <span className="ibtn">
            <ChevronLeft size={16} />
          </span>
          <span className="input d-sel" style={{ width: 130 }}>
            30.10.2026
          </span>
          <span className="ibtn">
            <ChevronRight size={16} />
          </span>
          <span className="btn btn-secondary btn-sm">Сегодня</span>
        </div>
        <Grid s={s} />

        {s.booking && (
          <div className="d-modal">
            <div className="modal sm d-pop">
              <div className="modal-h">
                <h2>Новая запись</h2>
                <span className="ibtn ibtn-sm">
                  <X size={14} />
                </span>
              </div>
              <div className="modal-desc">
                {COLS[s.booking.col]} · 30.10.2026, {time(s.booking.at)}
              </div>
              <div className="modal-b">
                <div className="field" data-demo="bk-client">
                  <span className="label">Клиент</span>
                  <span className={'input d-sel' + (s.booking.client && !s.booking.svc ? ' d-focus' : '')}>
                    {s.booking.client ? (
                      <>
                        {s.booking.client}
                        {!s.booking.svc && <span className="caret" />}
                      </>
                    ) : (
                      <span className="d-ph-text">Имя или телефон</span>
                    )}
                  </span>
                </div>
                <div className="field" data-demo="bk-svc">
                  <span className="label">Услуга</span>
                  <Select v={s.booking.svc} ph="Выберите услугу" />
                </div>
                {s.booking.svc && (
                  <div className="row d-pop" style={{ gap: 8 }}>
                    <span className="muted">Цена</span>
                    <span className="num">1 500 ₽</span>
                    <span className="faint">· 60 мин</span>
                  </div>
                )}
              </div>
              <div className="modal-f">
                <span className="sp" />
                <span className="btn btn-ghost btn-sm">Отмена</span>
                <span className="btn btn-primary btn-sm" data-demo="bk-submit">
                  Записать
                </span>
              </div>
            </div>
          </div>
        )}

        {card && (
          <div className="d-modal">
            <div className="modal sm d-pop">
              <div className="modal-h">
                <h2>{card.name}</h2>
                <span className="ibtn ibtn-sm">
                  <X size={14} />
                </span>
              </div>
              <div className="modal-desc">
                30.10.2026 · {time(card.at)}–{time(card.at + card.len)}
              </div>
              <div className="modal-b">
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge accent">
                    <span className="dot" />
                    {STATUS[card.st]}
                  </span>
                  <span>{card.svc}</span>
                  <span className="num muted">2 400 ₽</span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="btn btn-primary btn-sm" data-demo="card-came">
                    Пришёл
                  </span>
                  <span className="btn btn-secondary btn-sm">Не пришёл</span>
                  <span className="btn btn-secondary btn-sm">Перенести</span>
                  <span className="btn btn-ghost btn-sm">Отменить запись</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </DemoShell>
    );
  },
};
