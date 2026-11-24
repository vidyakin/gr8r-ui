/* Запись «Документы и КП»: счёт покупателю — выбор покупателя, строка товара с ценой из вида цен, итоги, проведение. Разметка — как у DocumentPage */
import type * as React from 'react';
import { ChevronDown, Copy, Plus, Printer, Trash2 } from 'lucide-react';
import type { Locale } from '../i18n';
import { DemoShell, money, moneyFull } from './shell';
import { DOC_DICT, type DocLineData } from './i18n/doc';
import type { Scene } from './player';

interface S {
  buyer: string;
  /** Подсказки в выпадающем списке: buyer — покупатели, item — товары; null — список закрыт */
  pop: 'buyer' | 'item' | null;
  lines: DocLineData[];
  /** Новая строка, пока в ней ищут товар */
  query: string | null;
  posted: boolean;
  hot: boolean;
}

const makeInitial = (locale: Locale): S => ({
  buyer: '',
  pop: null,
  lines: [DOC_DICT[locale].initialLine],
  query: null,
  posted: false,
  hot: false,
});

const makeFinal = (locale: Locale): S => {
  const d = DOC_DICT[locale];
  return {
    ...makeInitial(locale),
    buyer: d.selectedBuyer,
    lines: [d.initialLine, { ...d.addedLine, qty: 2 }],
    posted: true,
  };
};

function Field({ label, children, demo, hint }: { label: string; children: React.ReactNode; demo?: string; hint?: string }) {
  return (
    <div className="field" data-demo={demo}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

const Select = ({ v }: { v: string }) => (
  <span className="select-btn input d-sel">
    <span className="trunc">{v}</span>
    <span className="chev">
      <ChevronDown size={14} />
    </span>
  </span>
);

export const docScene: Scene<S> = {
  initial: makeInitial,
  final: makeFinal,
  height: [680, 820],
  script: async ({ set, wait, move, click, type }, locale) => {
    const d = DOC_DICT[locale];
    await move('buyer');
    await click();
    await type(d.buyerQuery, (s, v) => ({ ...s, buyer: v, pop: 'buyer' }), 110);
    await wait(500);
    await move('opt-0');
    await click();
    set(s => ({ ...s, buyer: d.selectedBuyer, pop: null }));
    await wait(700);
    await move('add-line');
    await click();
    set(s => ({ ...s, query: '' }));
    await wait(200);
    await type(d.itemQuery, (s, v) => ({ ...s, query: v, pop: 'item' }), 90);
    await wait(450);
    await move('opt-0');
    await click();
    set(s => ({ ...s, query: null, pop: null, hot: true, lines: [...s.lines, d.addedLine] }));
    await wait(1100);
    await move('qty-1');
    await click();
    set(s => ({ ...s, hot: false }));
    await wait(250);
    set(s => ({ ...s, hot: true, lines: s.lines.map((l, i) => (i === 1 ? { ...l, qty: 2 } : l)) }));
    await wait(1100);
    await move('btn-post');
    await click();
    set(s => ({ ...s, posted: true, hot: false }));
    await wait(600);
  },
  render: (s, { compact, locale }) => {
    const d = DOC_DICT[locale];
    const vatRate = d.totals.vatRate;
    const total = s.lines.reduce((a, l) => a + l.qty * l.price, 0);
    const vat = Math.round(((total * vatRate) / (100 + vatRate)) * 100) / 100;
    const opts = s.pop === 'buyer' ? d.buyers : d.items;
    return (
      <DemoShell compact={compact} active="sales" crumbs={s.posted ? d.crumbsPosted : d.crumbsDraft} locale={locale}>
        <div className="d-doc">
          <div className="doc-bar">
            <div className="doc-title">
              <nav className="muted" style={{ fontSize: 12.5 }}>
                {d.subCrumb}
              </nav>
              <h1>
                {d.docTitlePrefix} {s.posted ? <span className="faint">{d.docNumber}</span> : <span className="faint">{d.draftWord}</span>}
                {s.posted ? (
                  <span className="badge green d-pop">
                    <span className="dot" />
                    {d.statusPosted}
                  </span>
                ) : (
                  <span className="badge gray">
                    <span className="dot" />
                    {d.statusDraft}
                  </span>
                )}
              </h1>
              <span className="faint" style={{ fontSize: 12 }}>
                {d.savedNote}
              </span>
            </div>
            <div className="doc-actions">
              {!compact && (
                <span className="btn btn-secondary">
                  <Copy size={14} />
                  {d.createFromBtn}
                </span>
              )}
              <span className="btn btn-secondary">
                <Printer size={14} />
                {d.printBtn}
              </span>
              <span className={'btn ' + (s.posted ? 'btn-secondary' : 'btn-primary')} data-demo="btn-post">
                {s.posted ? d.unpostBtn : d.postBtn}
              </span>
            </div>
          </div>

          <section className="doc-head panel">
            <Field label={d.fields.org}>
              <Select v={d.fields.orgValue} />
            </Field>
            <Field label={d.fields.buyer} demo="buyer">
              <div className="combo">
                <div className={'input d-sel' + (s.pop === 'buyer' ? ' d-focus' : '')}>
                  {s.buyer || <span className="d-ph-text">{d.fields.buyerPlaceholder}</span>}
                  {s.pop === 'buyer' && <span className="caret" />}
                </div>
                {s.pop === 'buyer' && <Pop opts={opts} />}
              </div>
            </Field>
            <Field label={d.fields.priceType} hint={s.buyer.length > 3 ? d.fields.priceTypeContractHint : undefined}>
              <Select v={s.buyer.length > 3 ? d.fields.priceWholesale : d.fields.priceRetail} />
            </Field>
            <Field label={d.fields.warehouse}>
              <Select v={d.fields.warehouseValue} />
            </Field>
            <Field label={d.fields.date}>
              <span className="input d-sel">{d.fields.dateValue}</span>
            </Field>
            <Field label={d.fields.number} hint={s.posted ? undefined : d.fields.numberHint}>
              <span className="input d-sel">{s.posted ? d.docNumber : '—'}</span>
            </Field>
            {!compact && (
              <Field label={d.fields.contract}>
                <Select v={s.buyer.length > 3 ? d.fields.contractSigned : d.fields.contractPlaceholder} />
              </Field>
            )}
            {!compact && (
              <Field label={d.fields.pricesMode}>
                <span className="seg d-seg">
                  <span data-state="on">{d.fields.vatIncluded}</span>
                  <span>{d.fields.vatExcluded}</span>
                </span>
              </Field>
            )}
          </section>

          <div className="tabs d-tabs">
            <span className="tab on">
              {d.tabs[0]}
              <span className="cnt">{s.lines.length}</span>
            </span>
            <span className="tab">{d.tabs[1]}</span>
            {!compact && <span className="tab">{d.tabs[2]}</span>}
          </div>
          <section className="doc-lines panel">
            <table className="dtbl">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>{d.cols.num}</th>
                  <th>{d.cols.item}</th>
                  <th className="r" style={{ width: 70 }}>
                    {d.cols.qty}
                  </th>
                  <th className="r" style={{ width: 96 }}>
                    {d.cols.price}
                  </th>
                  {!compact && (
                    <th className="r" style={{ width: 100 }}>
                      {d.cols.vat}
                    </th>
                  )}
                  <th className="r" style={{ width: 110 }}>
                    {d.cols.total}
                  </th>
                  {!compact && <th style={{ width: 30 }} />}
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l, i) => (
                  <tr key={l.name} className={s.hot && i === 1 ? 'd-row-hot' : undefined}>
                    <td className="faint num">{i + 1}</td>
                    <td>
                      <span className="input d-sel d-cell">{l.name}</span>
                    </td>
                    <td className="r">
                      <span className="input d-sel d-cell r" data-demo={`qty-${i}`}>
                        {l.qty}
                      </span>
                    </td>
                    <td className="r">
                      <span className="input d-sel d-cell r">{money(l.price, locale, true)}</span>
                    </td>
                    {!compact && <td className="r num muted">{money(Math.round(((l.qty * l.price * vatRate) / (100 + vatRate)) * 100) / 100, locale, true)}</td>}
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
                {s.query !== null && (
                  <tr>
                    <td className="faint num">{s.lines.length + 1}</td>
                    <td colSpan={compact ? 4 : 6}>
                      <div className="combo">
                        <div className="input d-sel d-cell d-focus">
                          {s.query || <span className="d-ph-text">{d.itemSearchPlaceholder}</span>}
                          <span className="caret" />
                        </div>
                        {s.pop === 'item' && <Pop opts={opts} />}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="d-addline">
              <span className="btn btn-ghost btn-sm" data-demo="add-line">
                <Plus size={14} />
                {d.addLineBtn}
              </span>
            </div>
          </section>

          <div className="doc-bottom">
            {!compact && (
              <section className="doc-links panel">
                <h2>{d.relatedHeading}</h2>
                <p className="faint">{d.relatedText}</p>
              </section>
            )}
            <section className="doc-totals panel">
              <dl>
                <div>
                  <dt>{d.totals.subtotal}</dt>
                  <dd className="num">{money(total - vat, locale, true)}</dd>
                </div>
                <div>
                  <dt>{d.totals.vatLabel}</dt>
                  <dd className="num">{money(vat, locale, true)}</dd>
                </div>
                <div className="grand">
                  <dt>{d.totals.grandTotal}</dt>
                  <dd className={'num' + (s.hot ? ' d-flash' : '')} key={total}>
                    {moneyFull(total, locale)}
                  </dd>
                </div>
              </dl>
              <p className="doc-words">{d.words[total]}</p>
            </section>
          </div>
        </div>
      </DemoShell>
    );
  },
};

function Pop({ opts }: { opts: string[] }) {
  return (
    <div className="pop combo-pop d-popover">
      {opts.map((o, i) => (
        <span key={o} className={'mi combo-item' + (i === 0 ? ' hl' : '')} data-demo={`opt-${i}`}>
          {o}
        </span>
      ))}
    </div>
  );
}
