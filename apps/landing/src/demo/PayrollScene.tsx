/* Запись «Зарплата»: начисление за месяц («Заполнить» — оклад и сдельная из нарядов по сотрудникам), проведение,
   затем ведомость на выплату и выплата из кассы. Разметка — как у PayrollPages.tsx (начисление и ведомость) */
import type * as React from 'react';
import { ChevronDown, Copy, Plus, Wand2 } from 'lucide-react';
import { DemoShell, money, moneyFull } from './shell';
import type { Scene } from './player';
import type { Locale } from '../i18n';
import { PAYROLL_DICT } from './i18n/payroll';

const r2 = (n: number) => Math.round(n * 100) / 100;

interface S {
  screen: 'accrual' | 'statement';
  /** Сколько строк уже заполнено */
  n: number;
  posted: boolean;
  paid: boolean;
}

const initial: S = { screen: 'accrual', n: 0, posted: false, paid: false };
const final = (locale: Locale): S => ({ screen: 'statement', n: PAYROLL_DICT[locale].rows.length, posted: true, paid: true });

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      {children}
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

const Cell = ({ v, r }: { v: string; r?: boolean }) => <span className={'input d-sel d-cell' + (r ? ' r' : '')}>{v}</span>;

export const payrollScene: Scene<S> = {
  initial,
  final,
  height: [660, 650],
  script: async ({ set, wait, move, click }, locale) => {
    const rowCount = PAYROLL_DICT[locale].rows.length;
    await move('btn-fill');
    await click();
    // Строки появляются по одной
    for (let i = 1; i <= rowCount; i++) {
      set(s => ({ ...s, n: i }));
      await wait(560);
    }
    await wait(700);
    await move('btn-post');
    await click();
    set(s => ({ ...s, posted: true }));
    await wait(1000);
    await move('btn-based');
    await click();
    set(s => ({ ...s, screen: 'statement' }));
    await wait(1100);
    await move('btn-pay');
    await click();
    set(s => ({ ...s, paid: true }));
    await wait(900);
  },
  render: (s, { compact, locale }) => {
    const d = PAYROLL_DICT[locale];
    const rows = d.rows;
    const people = Array.from(new Set(rows.map(r => r.who))).map(who => {
      const sum = rows.filter(r => r.who === who).reduce((a, r) => a + r.amount, 0);
      return { who, pay: r2(sum - r2(sum * d.taxRate)) };
    });
    const accrued = rows.slice(0, s.n).reduce((a, r) => a + r.amount, 0);
    const ndfl = rows.slice(0, s.n).reduce((a, r) => a + r2(r.amount * d.taxRate), 0);
    const ins = rows.slice(0, s.n).reduce((a, r) => a + r2(r.amount * d.contribRate), 0);
    const payTotal = people.reduce((a, p) => a + p.pay, 0);
    return s.screen === 'accrual' ? (
      <DemoShell compact={compact} active="payroll" crumbs={d.crumbsAccrual} locale={locale}>
        <div className="d-page-in">
          <div className="d-ph">
            <div>
              <h1>
                {s.posted ? d.accrualDocNum : d.newAccrualTitle}
                {s.posted && (
                  <span className="badge green d-pop" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                    <span className="dot" />
                    {d.postedBadge}
                  </span>
                )}
              </h1>
              <p>{d.accrualSubtitle}</p>
            </div>
            <span className="sp" />
            {s.posted ? (
              <>
                <span className="btn btn-secondary" data-demo="btn-based">
                  <Copy size={14} />
                  {compact ? d.statementBtnCompact : d.statementBtn}
                </span>
                <span className="btn btn-secondary">{d.unpostBtn}</span>
              </>
            ) : (
              <>
                <span className="btn btn-secondary" data-demo="btn-fill">
                  <Wand2 size={14} />
                  {d.fillBtn}
                </span>
                <span className="btn btn-primary d-off">{d.createBtn}</span>
                <span className={'btn btn-secondary' + (s.n ? '' : ' d-off')} data-demo="btn-post">
                  {d.postBtn}
                </span>
              </>
            )}
          </div>
          <div className="d-doc">
            <section className="doc-head panel">
              <Field label={d.periodLabel}>
                <span className="input d-sel">{d.periodVal}</span>
              </Field>
              <Field label={d.dateLabel}>
                <span className="input d-sel">{d.dateVal}</span>
              </Field>
              <Field label={d.orgLabel}>
                <Select v={d.orgVal} />
              </Field>
            </section>
            <section className="doc-lines panel">
              <table className="dtbl">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>{d.accrualCols.num}</th>
                    <th style={{ width: compact ? 132 : 170 }}>{d.accrualCols.employee}</th>
                    <th style={{ width: compact ? 132 : 160 }}>{d.accrualCols.kind}</th>
                    {!compact && (
                      <th className="r" style={{ width: 100 }}>
                        {d.accrualCols.base}
                      </th>
                    )}
                    {!compact && (
                      <th className="r" style={{ width: 66 }}>
                        {d.accrualCols.days}
                      </th>
                    )}
                    <th className="r" style={{ width: 104 }}>
                      {d.accrualCols.amount}
                    </th>
                    <th className="r" style={{ width: 92 }}>
                      {d.accrualCols.tax}
                    </th>
                    {!compact && (
                      <th className="r" style={{ width: 92 }}>
                        {d.accrualCols.contrib}
                      </th>
                    )}
                    {!compact && <th>{d.accrualCols.posting}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, s.n).map((r, i) => (
                    <tr key={i} className={i === s.n - 1 ? 'd-row-hot' : undefined}>
                      <td className="faint num">{i + 1}</td>
                      <td>
                        <Cell v={r.who} />
                      </td>
                      <td>
                        <Cell v={r.kind} />
                      </td>
                      {!compact && <td className="r num">{money(r.base, locale, true)}</td>}
                      {!compact && <td className="r num" style={{ whiteSpace: 'nowrap' }}>{r.days ?? ''}</td>}
                      <td className="r">
                        <Cell v={money(r.amount, locale, true)} r />
                      </td>
                      <td className="r num">{money(r2(r.amount * d.taxRate), locale, true)}</td>
                      {!compact && <td className="r num">{money(r2(r.amount * d.contribRate), locale, true)}</td>}
                      {!compact && (
                        <td>
                          <Cell v={r.isPiece ? d.postingPiece : d.postingSalary} />
                        </td>
                      )}
                    </tr>
                  ))}
                  {s.n === 0 && (
                    <tr>
                      <td colSpan={compact ? 5 : 9} className="faint" style={{ height: 76, textAlign: 'center' }}>
                        {d.emptyHint}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="row d-addline" style={{ justifyContent: 'space-between', padding: '8px 12px' }}>
                <span className="btn btn-ghost btn-sm">
                  <Plus size={14} />
                  {d.addLineBtn}
                </span>
                <span className="muted">
                  {!compact && <>{d.accrualSummary.accrued}: <b className="num">{moneyFull(accrued, locale)}</b> · {d.accrualSummary.withheld}: <b className="num">{moneyFull(ndfl, locale)}</b> · </>}{d.accrualSummary.toPay}:{' '}
                  <b className={'num' + (s.n ? ' d-flash' : '')} key={s.n}>
                    {moneyFull(accrued - ndfl, locale)}
                  </b>
                  {!compact && (
                    <>
                      {' '}
                      · {d.accrualSummary.insurance}: <b className="num">{moneyFull(ins, locale)}</b>
                    </>
                  )}
                </span>
              </div>
            </section>
          </div>
        </div>
      </DemoShell>
    ) : (
      <DemoShell compact={compact} active="payroll" crumbs={d.crumbsStatement} locale={locale}>
        <div className="d-page-in">
          <div className="d-ph">
            <div>
              <h1>{d.statementDocNum}</h1>
              <p>{d.statementSubtitle}</p>
            </div>
            <span className="sp" />
            <span className={'badge d-pop ' + (s.paid ? 'green' : 'gray')} key={String(s.paid)}>
              <span className="dot" />
              {s.paid ? d.paidBadge : d.unpaidBadge}
            </span>
            {!compact && <span className="btn btn-secondary">{d.printBtn}</span>}
            <span className="btn btn-secondary">{d.unpostBtn}</span>
          </div>
          <div className="d-doc">
            <section className="doc-head panel">
              <Field label={d.periodLabel}>
                <span className="input d-sel">{d.periodVal}</span>
              </Field>
              <Field label={d.dateLabel}>
                <span className="input d-sel">{d.dateVal}</span>
              </Field>
              <Field label={d.kindLabel}>
                <Select v={d.kindVal} />
              </Field>
              <Field label={d.payMethodLabel}>
                <Select v={d.payMethodVal} />
              </Field>
              {!compact && (
                <Field label={d.orgLabel}>
                  <Select v={d.orgVal} />
                </Field>
              )}
            </section>
            <section className="doc-lines panel">
              <table className="dtbl">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>{d.accrualCols.num}</th>
                    <th>{d.accrualCols.employee}</th>
                    <th className="r" style={{ width: 150 }}>
                      {d.accrualCols.amount}
                    </th>
                    <th className="r" style={{ width: 150 }}>
                      {d.paidCol}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p, i) => (
                    <tr key={p.who} className={s.paid ? 'd-row-hot' : undefined}>
                      <td className="faint num">{i + 1}</td>
                      <td>
                        <Cell v={p.who} />
                      </td>
                      <td className="r">
                        <Cell v={money(p.pay, locale, true)} r />
                      </td>
                      <td className="r num">{money(s.paid ? p.pay : 0, locale, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row d-addline" style={{ justifyContent: 'flex-end', padding: '8px 12px' }}>
                <span className="muted">
                  {d.statementSummary.total}: <b className="num">{moneyFull(payTotal, locale)}</b> · {d.statementSummary.paid}: <b className="num">{moneyFull(s.paid ? payTotal : 0, locale)}</b> · {d.statementSummary.remaining}:{' '}
                  <b className="num">{moneyFull(s.paid ? 0 : payTotal, locale)}</b>
                </span>
              </div>
            </section>
            <section className="doc-head panel" style={{ alignItems: 'end' }}>
              <Field label={d.cashDeskLabel}>
                <Select v={d.cashDeskVal} />
              </Field>
              <div className="acts row" style={{ gap: 8 }}>
                <span className={'btn btn-primary' + (s.paid ? ' d-off' : '')} data-demo="btn-pay">
                  {d.payFromCashBtn}
                </span>
              </div>
              {s.paid && (
                <div className="muted d-pop" style={{ alignSelf: 'center' }}>
                  {d.payoutsLabel}: <span className="crm-link">{d.payoutDocNum} · {moneyFull(payTotal, locale)}</span>
                </div>
              )}
            </section>
          </div>
        </div>
      </DemoShell>
    );
  },
};
