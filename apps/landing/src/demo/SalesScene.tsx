/* Запись «Продажи»: журнал заказов покупателей → заказ → «Создать на основании» → реализация → проведение →
   движения склада и взаиморасчёты покупателя. Разметка — как у JournalPage, DocumentPage, StockMovesDialog и CompanySettlements */
import type * as React from 'react';
import { ArrowLeftRight, CalendarDays, ChevronDown, Copy, FileText, Printer, Search, Trash2, X } from 'lucide-react';
import type { Locale } from '../i18n';
import { DemoShell, money, moneyFull } from './shell';
import type { Scene } from './player';
import { SALES_DICT } from './i18n/sales';

type View = 'journal' | 'order' | 'real' | 'card';

interface S {
  view: View;
  /** Меню «Создать на основании» */
  menu: boolean;
  /** Диалог «Создать реализацию» (отгрузка по дату) */
  ship: boolean;
  posted: boolean;
  /** Диалог «Движения склада» */
  moves: boolean;
  /** Подсветка только что изменившегося */
  hot: boolean;
}

const vatOf = (n: number) => Math.round(((n * 20) / 120) * 100) / 100;

const initial: S = { view: 'journal', menu: false, ship: false, posted: false, moves: false, hot: false };
const final: S = { ...initial, view: 'card', posted: true, hot: false };

const Select = ({ v }: { v: string }) => (
  <span className="select-btn input d-sel">
    <span className="trunc">{v}</span>
    <span className="chev">
      <ChevronDown size={14} />
    </span>
  </span>
);

function Field({ label, children, demo, hint }: { label: string; children: React.ReactNode; demo?: string; hint?: string }) {
  return (
    <div className="field" data-demo={demo}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Journal({ compact, hot, locale }: { compact: boolean; hot: boolean; locale: Locale }) {
  const d = SALES_DICT[locale];
  const ui = d.journalUi;
  const journalSum = d.journal.reduce((a, r) => a + r.total, 0);
  return (
    <div className="d-page-in">
      <div className="d-ph">
        <div>
          <div className="d-ph-title">{ui.title}</div>
          {!compact && <p>{ui.subtitle}</p>}
        </div>
      </div>
      <div className="tabs d-tabs">
        <span className="tab">{ui.tabs[0]}</span>
        <span className="tab on">{ui.tabs[1]}</span>
        <span className="tab">{ui.tabs[2]}</span>
        {!compact && <span className="tab">{ui.tabs[3]}</span>}
      </div>
      <div className="d-toolbar">
        <span className="input d-sel" style={{ width: 200, height: 28, flexShrink: 0 }}>
          <Search size={13} />
          <span className="d-ph-text">{ui.searchPh}</span>
        </span>
        <span className="btn btn-ghost">{ui.filter}</span>
        <span className="btn btn-ghost">{ui.sort}</span>
      </div>
      <div className="tbl-wrap" style={{ margin: '0 var(--gutter)' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>
                <div className="thi">{ui.cols.num}</div>
              </th>
              <th>
                <div className="thi">{ui.cols.date}</div>
              </th>
              <th>
                <div className="thi">{ui.cols.buyer}</div>
              </th>
              {!compact && (
                <th>
                  <div className="thi">{ui.cols.payment}</div>
                </th>
              )}
              <th>
                <div className="thi">{ui.cols.status}</div>
              </th>
              {!compact && (
                <th className="num">
                  <div className="thi" style={{ justifyContent: 'flex-end' }}>
                    {ui.cols.vat}
                  </div>
                </th>
              )}
              <th className="num">
                <div className="thi" style={{ justifyContent: 'flex-end' }}>
                  {ui.cols.total}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.journal.map((r, i) => (
              <tr key={r.num} className={'dt-click' + (hot && i === 0 ? ' d-row-hot' : '')} data-demo={`row-${i}`}>
                <td>
                  <span className="mono" style={{ fontWeight: 450 }}>
                    {r.num}
                  </span>
                </td>
                <td className="num muted">{r.date}</td>
                <td>
                  <span className="trunc">{r.who}</span>
                </td>
                {!compact && (
                  <td>
                    <span className="badge gray">
                      <span className="dot" />
                      {ui.unpaid}
                    </span>
                  </td>
                )}
                <td>
                  <span className="badge green">
                    <span className="dot" />
                    {ui.posted}
                  </span>
                </td>
                {!compact && <td className="num muted">{money(vatOf(r.total), locale, true)}</td>}
                <td className="num" style={{ fontWeight: 500 }}>
                  {money(r.total, locale, true)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={compact ? 4 : 6}>
                <span className="row" style={{ gap: 6 }}>
                  {ui.total}
                  <span className="faint" style={{ fontWeight: 500 }}>
                    {d.journal.length}
                  </span>
                </span>
              </td>
              <td className="num" style={{ fontWeight: 600 }}>
                {money(journalSum, locale, true)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Форма документа: заказ покупателя (проведён) или реализация (черновик → проведена) */
function Doc({ s, compact, kind, locale }: { s: S; compact: boolean; kind: 'order' | 'real'; locale: Locale }) {
  const d = SALES_DICT[locale];
  const ui = d.docUi;
  const order = kind === 'order';
  const posted = order || s.posted;
  const title = order ? ui.orderTitle : ui.realTitle;
  const num = order ? d.orderNum : s.posted ? d.realNum : null;
  const total = d.lines.reduce((a, l) => a + l.qty * l.price, 0);
  return (
    <div className="d-doc d-page-in">
      <div className="doc-bar">
        <div className="doc-title">
          <nav className="muted" style={{ fontSize: 12.5 }}>
            {d.crumbs.sales} / {title}
          </nav>
          <div className="d-doc-title">
            {title} {num ? num : <span className="faint">{ui.draftLower}</span>}
            <span className={'badge ' + (posted ? 'green' : 'gray') + (!order && s.posted ? ' d-pop' : '')} key={String(posted)}>
              <span className="dot" />
              {posted ? ui.postedBadge : ui.draftBadge}
            </span>
          </div>
          <span className="faint" style={{ fontSize: 12 }}>
            {posted ? ui.postedAt : ui.allSaved}
          </span>
        </div>
        <div className="doc-actions" style={{ position: 'relative' }}>
          {!order && (
            <span className="btn btn-secondary" data-demo="btn-moves">
              <ArrowLeftRight size={14} />
              {ui.movesBtn}
            </span>
          )}
          {order && !compact && (
            <span className="btn btn-secondary">
              <Printer size={14} />
              {ui.printBtn}
            </span>
          )}
          {(order || s.posted) && (
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <span className="btn btn-secondary" data-demo="btn-based">
                <Copy size={14} />
                {ui.basedBtn}
                <ChevronDown size={12} />
              </span>
              {s.menu && (
                <div className="pop d-popover" style={{ left: 'auto', right: 0, minWidth: 230 }}>
                  {ui.basedItems.map((t, i) => (
                    <span key={t} className={'mi' + (i === 1 ? ' hl' : '')} data-demo={i === 1 ? 'mi-real' : undefined}>
                      <FileText size={15} />
                      <span className="flex-1">{t}</span>
                    </span>
                  ))}
                </div>
              )}
            </span>
          )}
          {order ? (
            <span className="btn btn-secondary">{ui.unpostBtn}</span>
          ) : (
            <span className={'btn ' + (s.posted ? 'btn-secondary' : 'btn-primary')} data-demo="btn-post">
              {s.posted ? ui.unpostBtn : ui.postBtn}
            </span>
          )}
        </div>
      </div>

      <section className="doc-head panel">
        <Field label={ui.fields.org}>
          <Select v={d.org} />
        </Field>
        <Field label={ui.fields.buyer}>
          <div className="doc-ro">
            <span className="crm-link" data-demo="buyer-link">
              {d.buyer}
            </span>
          </div>
        </Field>
        <Field label={ui.fields.warehouse}>
          <Select v={d.warehouse} />
        </Field>
        <Field label={ui.fields.date}>
          <span className="input d-sel">{order ? d.orderDate : d.realDate}</span>
        </Field>
        <Field label={ui.fields.number} hint={num ? undefined : ui.fields.numberHint}>
          <span className="input d-sel">{num ?? '—'}</span>
        </Field>
        <Field label={ui.fields.priceType}>
          <Select v={d.priceType} />
        </Field>
        {!compact && (
          <Field label={ui.fields.contract}>
            <Select v={d.contract} />
          </Field>
        )}
      </section>

      <div className="tabs d-tabs">
        <span className="tab on">
          {ui.tabs[0]}<span className="cnt">{d.lines.length}</span>
        </span>
        <span className="tab">{ui.tabs[1]}</span>
        {!compact && <span className="tab">{ui.tabs[2]}</span>}
      </div>
      <section className="doc-lines panel">
        <table className="dtbl">
          <thead>
            <tr>
              <th style={{ width: 30 }}>№</th>
              <th>{ui.lineCols.item}</th>
              <th className="r" style={{ width: 70 }}>
                {ui.lineCols.qty}
              </th>
              <th className="r" style={{ width: 96 }}>
                {ui.lineCols.price}
              </th>
              {!compact && (
                <th className="r" style={{ width: 100 }}>
                  {ui.lineCols.vat}
                </th>
              )}
              <th className="r" style={{ width: 110 }}>
                {ui.lineCols.total}
              </th>
              {!compact && <th style={{ width: 30 }} />}
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={l.name}>
                <td className="faint num">{i + 1}</td>
                <td>
                  <span className="input d-sel d-cell">{l.name}</span>
                </td>
                <td className="r">
                  <span className="input d-sel d-cell r">{l.qty}</span>
                </td>
                <td className="r">
                  <span className="input d-sel d-cell r">{money(l.price, locale, true)}</span>
                </td>
                {!compact && <td className="r num muted">{money(vatOf(l.qty * l.price), locale, true)}</td>}
                <td className="r num" style={{ fontWeight: 600 }}>
                  {money(l.qty * l.price, locale, true)}
                </td>
                {!compact && (
                  <td className="faint">
                    <Trash2 size={14} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="doc-bottom">
        {!compact && (
          <section className="doc-links panel">
            <h2>{ui.linkedTitle}</h2>
            {order ? (
              <>
                <p className="faint">{ui.noBased}</p>
                <p className="faint">{ui.noCreated}</p>
              </>
            ) : (
              <p>
                <span className="muted">{ui.basedOn}</span>
                <span className="doc-ref">
                  <span className="crm-link">{ui.orderTitle} {d.orderNum}</span>
                  <span className="badge green">
                    <span className="dot" />
                    {ui.postedBadge}
                  </span>
                  <span className="num muted">{money(total, locale, true)}</span>
                </span>
              </p>
            )}
          </section>
        )}
        <section className="doc-totals panel">
          <dl>
            <div>
              <dt>{ui.subtotal}</dt>
              <dd className="num">{money(total - vatOf(total), locale, true)}</dd>
            </div>
            <div>
              <dt>{ui.vatLabel}</dt>
              <dd className="num">{money(vatOf(total), locale, true)}</dd>
            </div>
            <div className="grand">
              <dt>{ui.grandTotal}</dt>
              <dd className="num">{moneyFull(total, locale)}</dd>
            </div>
          </dl>
          <p className="doc-words">{d.words}</p>
        </section>
      </div>
    </div>
  );
}

/** Карточка покупателя, вкладка «Взаиморасчёты»: после проведения реализации появилось начисление — долг */
function Card({ compact, locale }: { compact: boolean; locale: Locale }) {
  const d = SALES_DICT[locale];
  const ui = d.cardUi;
  const total = d.lines.reduce((a, l) => a + l.qty * l.price, 0);
  return (
    <div className="d-page-in">
      <div className="d-ph">
        <span className="av md" style={{ '--c': '#5A67D8' } as React.CSSProperties}>
          {d.buyerAv}
        </span>
        <div className="d-ph-title">{d.buyer}</div>
        {!compact && <span className="badge gray">{d.buyerTag}</span>}
      </div>
      <div className="tabs d-tabs">
        <span className="tab">{ui.tabs[0]}</span>
        {!compact && <span className="tab">{ui.tabs[1]}</span>}
        <span className="tab">
          {ui.tabs[2]}<span className="cnt">2</span>
        </span>
        <span className="tab on">{ui.tabs[3]}</span>
      </div>
      <div className="d-doc" style={{ paddingTop: 16 }}>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{ui.buyerHeading}</h3>
          <span className="muted">
            {ui.balanceLabel} <b className="d-flash" style={{ fontWeight: 600 }}>{money(total, locale, true)}</b>
          </span>
          {!compact && <span className="faint" style={{ fontSize: 12 }}>{ui.balanceHint}</span>}
          <span className="sp" />
          <span className="btn btn-secondary btn-sm">
            <Printer size={13} />
            {ui.reconcileBtn}
          </span>
        </div>
        <table className="dtbl">
          <thead>
            <tr>
              <th style={{ width: 110 }}>{ui.cols.date}</th>
              <th>{ui.cols.doc}</th>
              <th className="r" style={{ width: 130 }}>
                {ui.cols.charged}
              </th>
              <th className="r" style={{ width: 130 }}>
                {ui.cols.paid}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="bold">
              <td />
              <td>{ui.opening}</td>
              <td className="r num" colSpan={2}>
                {money(0, locale, true)}
              </td>
            </tr>
            <tr className="d-row-hot">
              <td className="muted">{d.realDate}</td>
              <td>{d.docUi.realTitle} {d.realNum}</td>
              <td className="r num">{money(total, locale, true)}</td>
              <td className="r num" />
            </tr>
            <tr className="bold">
              <td />
              <td>{ui.closing}</td>
              <td className="r num" colSpan={2}>
                {money(total, locale, true)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const salesScene: Scene<S> = {
  initial,
  final,
  height: [640, 650],
  script: async ({ set, wait, move, click }) => {
    // Журнал → заказ ЗК-000118
    await move('row-0', { ax: 0.3 });
    await wait(300);
    await click();
    set(s => ({ ...s, view: 'order' }));
    await wait(1400);
    // «Создать на основании» → «Реализация» → диалог отгрузки
    await move('btn-based');
    await click();
    set(s => ({ ...s, menu: true }));
    await wait(500);
    await move('mi-real');
    await click();
    set(s => ({ ...s, menu: false, ship: true }));
    await wait(900);
    await move('ship-create');
    await click();
    set(s => ({ ...s, ship: false, view: 'real' }));
    await wait(1500);
    // Проведение
    await move('btn-post');
    await click();
    set(s => ({ ...s, posted: true }));
    await wait(1200);
    // Движения склада: остатки товаров уменьшились
    await move('btn-moves');
    await click();
    set(s => ({ ...s, moves: true }));
    await wait(2600);
    await move('moves-close');
    await click();
    set(s => ({ ...s, moves: false }));
    await wait(400);
    // Покупатель → взаиморасчёты: появился долг
    await move('buyer-link');
    await click();
    set(s => ({ ...s, view: 'card' }));
    await wait(600);
  },
  render: (s, { compact, locale }) => {
    const d = SALES_DICT[locale];
    return (
      <DemoShell
        compact={compact}
        active="sales"
        locale={locale}
        crumbs={
          s.view === 'journal'
            ? [d.crumbs.sales, d.crumbs.journal]
            : s.view === 'order'
              ? [d.crumbs.sales, d.crumbs.order]
              : s.view === 'real'
                ? [d.crumbs.sales, s.posted ? d.crumbs.realPosted : d.crumbs.realDraft]
                : ['CRM', d.buyer, d.crumbs.settlements]
        }
      >
        {s.view === 'journal' && <Journal compact={compact} hot={false} locale={locale} />}
        {s.view === 'order' && <Doc s={s} compact={compact} kind="order" locale={locale} />}
        {s.view === 'real' && <Doc s={s} compact={compact} kind="real" locale={locale} />}
        {s.view === 'card' && <Card compact={compact} locale={locale} />}

        {s.ship && (
          <div className="d-modal">
            <div className="modal sm d-pop">
              <div className="modal-h">
                <h2>{d.shipUi.title}</h2>
                <span className="ibtn ibtn-sm">
                  <X size={14} />
                </span>
              </div>
              <div className="modal-desc">{d.shipUi.desc}</div>
              <div className="modal-b">
                <Field label={d.shipUi.dateLabel}>
                  <span className="input d-sel">
                    <span className="d-ph-text">{d.shipUi.datePh}</span>
                    <span className="chev" style={{ marginLeft: 'auto' }}>
                      <CalendarDays size={14} />
                    </span>
                  </span>
                </Field>
              </div>
              <div className="modal-f">
                <span className="sp" />
                <span className="btn btn-ghost">{d.shipUi.keepBtn}</span>
                <span className="btn btn-primary" data-demo="ship-create">
                  {d.shipUi.createBtn}
                </span>
              </div>
            </div>
          </div>
        )}

        {s.moves && (
          <div className="d-modal">
            <div className="modal lg d-pop" style={{ maxWidth: 640 }}>
              <div className="modal-h">
                <h2>{d.movesUi.title}</h2>
                <span className="ibtn ibtn-sm">
                  <X size={14} />
                </span>
              </div>
              <div className="modal-desc">{d.movesUi.desc}</div>
              <div className="modal-b">
                <table className="dtbl">
                  <thead>
                    <tr>
                      <th>{d.movesUi.cols[0]}</th>
                      <th>{d.movesUi.cols[1]}</th>
                      <th className="r">{d.movesUi.cols[2]}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.lines.map(l => (
                      <tr key={l.name} className="d-row-hot">
                        <td className="muted">{d.warehouse}</td>
                        <td>{l.name}</td>
                        <td className="r num neg">−{l.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-f">
                <span className="sp" />
                <span className="btn btn-secondary" data-demo="moves-close">
                  {d.movesUi.closeBtn}
                </span>
              </div>
            </div>
          </div>
        )}
      </DemoShell>
    );
  },
};
