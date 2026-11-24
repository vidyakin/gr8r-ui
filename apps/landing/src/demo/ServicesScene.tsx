/* Запись «Услуги»: день записи к мастерам — клиент записывается на свободный слот, затем пришедшему ставится «Пришёл».
   Разметка — как у appointments-ui.tsx (сетка .appt-grid) и карточки записи в диалоге */
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import type { Locale } from '../i18n';
import { DemoShell, money } from './shell';
import type { Scene } from './player';
import { SERVICES_DICT, type ApptData as Appt } from './i18n/services';

interface S {
  appts: Appt[];
  /** Слот, по которому кликнули: открыт диалог новой записи */
  booking: { col: number; at: number; client: string; svc: string | null } | null;
  /** Открытая карточка записи */
  card: string | null;
  fresh: string | null;
}

const ROWS = 10;
const time = (at: number) => `${9 + Math.floor(at / 2)}:${at % 2 ? '30' : '00'}`;

const initial = (locale: Locale): S => ({
  appts: SERVICES_DICT[locale].initialAppts,
  booking: null,
  card: null,
  fresh: null,
});

const book = (newAppt: Appt) => (s: S): S => ({ ...s, booking: null, fresh: newAppt.id, appts: [...s.appts, newAppt] });
const came = (s: S): S => ({ ...s, card: null, fresh: 'a3', appts: s.appts.map(a => (a.id === 'a3' ? { ...a, st: 'came' } : a)) });
const final = (locale: Locale): S => ({ ...came(book(SERVICES_DICT[locale].newAppt)(initial(locale))), fresh: null });

const Select = ({ v, ph, focus }: { v: string | null; ph: string; focus?: boolean }) => (
  <span className={'select-btn input d-sel' + (focus ? ' d-focus' : '')}>
    <span className={'trunc' + (v ? '' : ' d-ph-text')}>{v ?? ph}</span>
  </span>
);

function Grid({ s, cols }: { s: S; cols: [string, string, string] }) {
  const cells = [];
  for (let c = 0; c < cols.length; c++)
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
      <div className="appt-grid" style={{ gridTemplateColumns: `64px repeat(${cols.length}, minmax(120px, 1fr))`, gridTemplateRows: `auto repeat(${ROWS}, 32px)` }}>
        <div className="appt-h corner" style={{ gridColumn: 1, gridRow: 1 }} />
        {cols.map((n, i) => (
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
  script: async ({ set, wait, move, click, type }, locale) => {
    const d = SERVICES_DICT[locale];
    await move('slot-1-4');
    await click();
    set(s => ({ ...s, booking: { col: 1, at: 4, client: '', svc: null } }));
    await wait(450);
    await move('bk-client');
    await click();
    await type(d.newAppt.name, (s, v) => ({ ...s, booking: s.booking && { ...s.booking, client: v } }));
    await wait(300);
    await move('bk-svc');
    await click();
    set(s => ({ ...s, booking: s.booking && { ...s.booking, svc: d.newAppt.svc } }));
    await wait(500);
    await move('bk-submit');
    await click();
    set(book(d.newAppt));
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
  render: (s, { compact, locale }) => {
    const d = SERVICES_DICT[locale];
    const card = s.card ? s.appts.find(a => a.id === s.card)! : null;
    return (
      <DemoShell compact={compact} active="appts" crumbs={d.crumbs} locale={locale}>
        <div className="d-ph">
          <div>
            <div className="d-ph-title">{d.title}</div>
            <p>{d.subtitle}</p>
          </div>
          <span className="sp" />
          <span className="btn btn-primary">
            <Plus size={14} />
            {d.newBookingBtn}
          </span>
        </div>
        <div className="tabs d-tabs">
          {d.tabs.map((tab, i) => (
            <span key={tab} className={'tab' + (i === 0 ? ' on' : '')}>
              {tab}
            </span>
          ))}
        </div>
        <div className="d-toolbar">
          <span className="ibtn">
            <ChevronLeft size={16} />
          </span>
          <span className="input d-sel" style={{ width: 130 }}>
            {d.date}
          </span>
          <span className="ibtn">
            <ChevronRight size={16} />
          </span>
          <span className="btn btn-secondary btn-sm">{d.todayBtn}</span>
        </div>
        <Grid s={s} cols={d.cols} />

        {s.booking && (
          <div className="d-modal">
            <div className="modal sm d-pop">
              <div className="modal-h">
                <h2>{d.modalNewTitle}</h2>
                <span className="ibtn ibtn-sm">
                  <X size={14} />
                </span>
              </div>
              <div className="modal-desc">
                {d.cols[s.booking.col]} · {d.date}, {time(s.booking.at)}
              </div>
              <div className="modal-b">
                <div className="field" data-demo="bk-client">
                  <span className="label">{d.clientLabel}</span>
                  <span className={'input d-sel' + (s.booking.client && !s.booking.svc ? ' d-focus' : '')}>
                    {s.booking.client ? (
                      <>
                        {s.booking.client}
                        {!s.booking.svc && <span className="caret" />}
                      </>
                    ) : (
                      <span className="d-ph-text">{d.clientPh}</span>
                    )}
                  </span>
                </div>
                <div className="field" data-demo="bk-svc">
                  <span className="label">{d.svcLabel}</span>
                  <Select v={s.booking.svc} ph={d.svcPh} />
                </div>
                {s.booking.svc && (
                  <div className="row d-pop" style={{ gap: 8 }}>
                    <span className="muted">{d.priceLabel}</span>
                    <span className="num">{money(d.bookingPrice, locale)}</span>
                    <span className="faint">{d.durationText}</span>
                  </div>
                )}
              </div>
              <div className="modal-f">
                <span className="sp" />
                <span className="btn btn-ghost btn-sm">{d.cancelBtn}</span>
                <span className="btn btn-primary btn-sm" data-demo="bk-submit">
                  {d.bookBtn}
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
                {d.date} · {time(card.at)}–{time(card.at + card.len)}
              </div>
              <div className="modal-b">
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge accent">
                    <span className="dot" />
                    {d.status[card.st]}
                  </span>
                  <span>{card.svc}</span>
                  <span className="num muted">{money(d.cardPrice, locale)}</span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="btn btn-primary btn-sm" data-demo="card-came">
                    {d.cameBtn}
                  </span>
                  <span className="btn btn-secondary btn-sm">{d.noShowBtn}</span>
                  <span className="btn btn-secondary btn-sm">{d.rescheduleBtn}</span>
                  <span className="btn btn-ghost btn-sm">{d.cancelApptBtn}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </DemoShell>
    );
  },
};
