/* Запись «Зарплата»: начисление за месяц («Заполнить» — оклад и сдельная из нарядов по сотрудникам), проведение,
   затем ведомость на выплату и выплата из кассы. Разметка — как у PayrollPages.tsx (начисление и ведомость) */
import type * as React from 'react';
import { ChevronDown, Copy, Plus, Wand2 } from 'lucide-react';
import { DemoShell, rub, type NavId } from './shell';
import type { Scene } from './player';

interface Row {
  who: string;
  kind: string;
  /** База: оклад или выработка по нарядам */
  base: number;
  days?: string;
  amount: number;
}

const NDFL = 0.13;
const INS = 0.3;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Строки, которые «Заполнить» добавляет по одной: оклад по табелю и сдельная по проведённым нарядам */
const ROWS: Row[] = [
  { who: 'Ковалёв Игорь', kind: 'Оклад по табелю', base: 50000, days: '22 / 22', amount: 50000 },
  { who: 'Ковалёв Игорь', kind: 'Сдельная', base: 38400, amount: 38400 },
  { who: 'Соколова Мария', kind: 'Оклад по табелю', base: 45000, days: '21 / 22', amount: r2((45000 * 21) / 22) },
  { who: 'Соколова Мария', kind: 'Сдельная', base: 29750, amount: 29750 },
  { who: 'Громов Павел', kind: 'Оклад по табелю', base: 40000, days: '22 / 22', amount: 40000 },
  { who: 'Громов Павел', kind: 'Сдельная', base: 51200, amount: 51200 },
];

/** К выплате по сотрудникам: начислено минус НДФЛ */
const PEOPLE = ['Ковалёв Игорь', 'Соколова Мария', 'Громов Павел'].map(who => {
  const sum = ROWS.filter(r => r.who === who).reduce((a, r) => a + r.amount, 0);
  return { who, pay: r2(sum - r2(sum * NDFL)) };
});

interface S {
  screen: 'accrual' | 'statement';
  /** Сколько строк уже заполнено */
  n: number;
  posted: boolean;
  paid: boolean;
}

const initial: S = { screen: 'accrual', n: 0, posted: false, paid: false };
const final: S = { screen: 'statement', n: ROWS.length, posted: true, paid: true };

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
  script: async ({ set, wait, move, click }) => {
    await move('btn-fill');
    await click();
    // Строки появляются по одной
    for (let i = 1; i <= ROWS.length; i++) {
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
  render: (s, { compact }) => {
    const accrued = ROWS.slice(0, s.n).reduce((a, r) => a + r.amount, 0);
    const ndfl = ROWS.slice(0, s.n).reduce((a, r) => a + r2(r.amount * NDFL), 0);
    const ins = ROWS.slice(0, s.n).reduce((a, r) => a + r2(r.amount * INS), 0);
    const payTotal = PEOPLE.reduce((a, p) => a + p.pay, 0);
    return s.screen === 'accrual' ? (
      <DemoShell compact={compact} active={'payroll' as NavId} crumbs={['Финансы', 'Начисление зарплаты']}>
        <div className="d-page-in">
          <div className="d-ph">
            <div>
              <h1>
                {s.posted ? 'НЗ-000019' : 'Новое начисление'}
                {s.posted && (
                  <span className="badge green d-pop" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                    <span className="dot" />
                    Проведён
                  </span>
                )}
              </h1>
              <p>Начисление зарплаты</p>
            </div>
            <span className="sp" />
            {s.posted ? (
              <>
                <span className="btn btn-secondary" data-demo="btn-based">
                  <Copy size={14} />
                  {compact ? 'Ведомость' : 'Создать ведомость'}
                </span>
                <span className="btn btn-secondary">Отменить проведение</span>
              </>
            ) : (
              <>
                <span className="btn btn-secondary" data-demo="btn-fill">
                  <Wand2 size={14} />
                  Заполнить
                </span>
                <span className="btn btn-primary d-off">Создать</span>
                <span className={'btn btn-secondary' + (s.n ? '' : ' d-off')} data-demo="btn-post">
                  Провести
                </span>
              </>
            )}
          </div>
          <div className="d-doc">
            <section className="doc-head panel">
              <Field label="Период">
                <span className="input d-sel">октябрь 2026</span>
              </Field>
              <Field label="Дата">
                <span className="input d-sel">31.10.2026</span>
              </Field>
              <Field label="Организация">
                <Select v="ООО «Мебельная фабрика»" />
              </Field>
            </section>
            <section className="doc-lines panel">
              <table className="dtbl">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>№</th>
                    <th style={{ width: compact ? 132 : 170 }}>Сотрудник</th>
                    <th style={{ width: compact ? 132 : 160 }}>Вид начисления</th>
                    {!compact && (
                      <th className="r" style={{ width: 100 }}>
                        База
                      </th>
                    )}
                    {!compact && (
                      <th className="r" style={{ width: 66 }}>
                        Дни
                      </th>
                    )}
                    <th className="r" style={{ width: 104 }}>
                      Сумма
                    </th>
                    <th className="r" style={{ width: 92 }}>
                      НДФЛ
                    </th>
                    {!compact && (
                      <th className="r" style={{ width: 92 }}>
                        Взносы
                      </th>
                    )}
                    {!compact && <th>Способ отражения</th>}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.slice(0, s.n).map((r, i) => (
                    <tr key={i} className={i === s.n - 1 ? 'd-row-hot' : undefined}>
                      <td className="faint num">{i + 1}</td>
                      <td>
                        <Cell v={r.who} />
                      </td>
                      <td>
                        <Cell v={r.kind} />
                      </td>
                      {!compact && <td className="r num">{rub(r.base, true)}</td>}
                      {!compact && <td className="r num" style={{ whiteSpace: 'nowrap' }}>{r.days ?? ''}</td>}
                      <td className="r">
                        <Cell v={rub(r.amount, true)} r />
                      </td>
                      <td className="r num">{rub(r2(r.amount * NDFL), true)}</td>
                      {!compact && <td className="r num">{rub(r2(r.amount * INS), true)}</td>}
                      {!compact && (
                        <td>
                          <Cell v={r.kind === 'Сдельная' ? 'Производство · Цех №1' : 'Зарплата · Цех №1'} />
                        </td>
                      )}
                    </tr>
                  ))}
                  {s.n === 0 && (
                    <tr>
                      <td colSpan={compact ? 5 : 9} className="faint" style={{ height: 76, textAlign: 'center' }}>
                        Строк пока нет — нажмите «Заполнить»
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="row d-addline" style={{ justifyContent: 'space-between', padding: '8px 12px' }}>
                <span className="btn btn-ghost btn-sm">
                  <Plus size={14} />
                  Добавить строку
                </span>
                <span className="muted">
                  {!compact && <>Начислено: <b className="num">{rub(accrued, true)}</b> · Удержано: <b className="num">{rub(ndfl, true)}</b> · </>}К выплате:{' '}
                  <b className={'num' + (s.n ? ' d-flash' : '')} key={s.n}>
                    {rub(accrued - ndfl, true)}
                  </b>
                  {!compact && (
                    <>
                      {' '}
                      · Страховые взносы: <b className="num">{rub(ins, true)}</b>
                    </>
                  )}
                </span>
              </div>
            </section>
          </div>
        </div>
      </DemoShell>
    ) : (
      <DemoShell compact={compact} active={'payroll' as NavId} crumbs={['Финансы', 'Ведомости на выплату']}>
        <div className="d-page-in">
          <div className="d-ph">
            <div>
              <h1>ВЗ-000012</h1>
              <p>Ведомости на выплату</p>
            </div>
            <span className="sp" />
            <span className={'badge d-pop ' + (s.paid ? 'green' : 'gray')} key={String(s.paid)}>
              <span className="dot" />
              {s.paid ? 'Выплачена' : 'Не выплачена'}
            </span>
            {!compact && <span className="btn btn-secondary">Печать</span>}
            <span className="btn btn-secondary">Отменить проведение</span>
          </div>
          <div className="d-doc">
            <section className="doc-head panel">
              <Field label="Период">
                <span className="input d-sel">октябрь 2026</span>
              </Field>
              <Field label="Дата">
                <span className="input d-sel">31.10.2026</span>
              </Field>
              <Field label="Вид">
                <Select v="Расчёт" />
              </Field>
              <Field label="Способ выплаты">
                <Select v="Касса" />
              </Field>
              {!compact && (
                <Field label="Организация">
                  <Select v="ООО «Мебельная фабрика»" />
                </Field>
              )}
            </section>
            <section className="doc-lines panel">
              <table className="dtbl">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>№</th>
                    <th>Сотрудник</th>
                    <th className="r" style={{ width: 150 }}>
                      Сумма
                    </th>
                    <th className="r" style={{ width: 150 }}>
                      Выплачено
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PEOPLE.map((p, i) => (
                    <tr key={p.who} className={s.paid ? 'd-row-hot' : undefined}>
                      <td className="faint num">{i + 1}</td>
                      <td>
                        <Cell v={p.who} />
                      </td>
                      <td className="r">
                        <Cell v={rub(p.pay, true)} r />
                      </td>
                      <td className="r num">{rub(s.paid ? p.pay : 0, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row d-addline" style={{ justifyContent: 'flex-end', padding: '8px 12px' }}>
                <span className="muted">
                  Сумма: <b className="num">{rub(payTotal, true)}</b> · Выплачено: <b className="num">{rub(s.paid ? payTotal : 0, true)}</b> · Осталось:{' '}
                  <b className="num">{rub(s.paid ? 0 : payTotal, true)}</b>
                </span>
              </div>
            </section>
            <section className="doc-head panel" style={{ alignItems: 'end' }}>
              <Field label="Касса">
                <Select v="Основная касса" />
              </Field>
              <div className="acts row" style={{ gap: 8 }}>
                <span className={'btn btn-primary' + (s.paid ? ' d-off' : '')} data-demo="btn-pay">
                  Выплатить из кассы
                </span>
              </div>
              {s.paid && (
                <div className="muted d-pop" style={{ alignSelf: 'center' }}>
                  Выплаты: <span className="crm-link">РКО-000044 · {rub(payTotal, true)}</span>
                </div>
              )}
            </section>
          </div>
        </div>
      </DemoShell>
    );
  },
};
