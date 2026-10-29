/* Запись «Документы и КП»: счёт покупателю — выбор покупателя, строка товара с ценой из вида цен, итоги, проведение. Разметка — как у DocumentPage */
import type * as React from 'react';
import { ChevronDown, Copy, Plus, Printer, Trash2 } from 'lucide-react';
import { DemoShell, rub } from './shell';
import type { Scene } from './player';

interface Line {
  name: string;
  qty: number;
  price: number;
}
interface S {
  buyer: string;
  /** Подсказки в выпадающем списке: buyer — покупатели, item — товары; null — список закрыт */
  pop: 'buyer' | 'item' | null;
  lines: Line[];
  /** Новая строка, пока в ней ищут товар */
  query: string | null;
  posted: boolean;
  hot: boolean;
}

const BUYERS = ['ООО «Атлас Мебель» · ИНН 7704 512 389', 'ООО «Атлант-Строй» · ИНН 5029 117 640'];
const ITEMS = ['Стол обеденный «Дуб» 160×90 · 24 900 ₽', 'Стол журнальный «Дуб» · 11 400 ₽'];
const STOL: Line = { name: 'Стол обеденный «Дуб» 160×90', qty: 1, price: 24900 };

const initial: S = { buyer: '', pop: null, lines: [{ name: 'Стул обеденный «Классик»', qty: 4, price: 5900 }], query: null, posted: false, hot: false };
const final: S = { ...initial, buyer: 'ООО «Атлас Мебель»', lines: [initial.lines[0]!, { ...STOL, qty: 2 }], posted: true };

/** Сумма прописью для итогов, которые встречаются в записи */
const WORDS: Record<number, string> = {
  23600: 'Двадцать три тысячи шестьсот рублей 00 копеек',
  48500: 'Сорок восемь тысяч пятьсот рублей 00 копеек',
  73400: 'Семьдесят три тысячи четыреста рублей 00 копеек',
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
  initial,
  final,
  height: [680, 820],
  script: async ({ set, wait, move, click, type }) => {
    await move('buyer');
    await click();
    await type('Атл', (s, v) => ({ ...s, buyer: v, pop: 'buyer' }), 110);
    await wait(500);
    await move('opt-0');
    await click();
    set(s => ({ ...s, buyer: 'ООО «Атлас Мебель»', pop: null }));
    await wait(700);
    await move('add-line');
    await click();
    set(s => ({ ...s, query: '' }));
    await wait(200);
    await type('стол об', (s, v) => ({ ...s, query: v, pop: 'item' }), 90);
    await wait(450);
    await move('opt-0');
    await click();
    set(s => ({ ...s, query: null, pop: null, hot: true, lines: [...s.lines, STOL] }));
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
  render: (s, { compact }) => {
    const total = s.lines.reduce((a, l) => a + l.qty * l.price, 0);
    const vat = Math.round((total * 20) / 120 * 100) / 100;
    const opts = s.pop === 'buyer' ? BUYERS : ITEMS;
    return (
      <DemoShell compact={compact} active="sales" crumbs={['Документы', s.posted ? 'Счёт покупателю СЧ-000214' : 'Счёт покупателю (черновик)']}>
        <div className="d-doc">
          <div className="doc-bar">
            <div className="doc-title">
              <nav className="muted" style={{ fontSize: 12.5 }}>
                Продажи / Счета покупателям
              </nav>
              <h1>
                Счёт покупателю {s.posted ? <span className="faint">СЧ-000214</span> : <span className="faint">черновик</span>}
                {s.posted ? (
                  <span className="badge green d-pop">
                    <span className="dot" />
                    Проведён
                  </span>
                ) : (
                  <span className="badge gray">
                    <span className="dot" />
                    Черновик
                  </span>
                )}
              </h1>
              <span className="faint" style={{ fontSize: 12 }}>
                Все изменения сохранены
              </span>
            </div>
            <div className="doc-actions">
              {!compact && (
                <span className="btn btn-secondary">
                  <Copy size={14} />
                  Создать на основании
                </span>
              )}
              <span className="btn btn-secondary">
                <Printer size={14} />
                Печать
              </span>
              <span className={'btn ' + (s.posted ? 'btn-secondary' : 'btn-primary')} data-demo="btn-post">
                {s.posted ? 'Отменить проведение' : 'Провести'}
              </span>
            </div>
          </div>

          <section className="doc-head panel">
            <Field label="Организация">
              <Select v="ООО «Мебельная фабрика»" />
            </Field>
            <Field label="Покупатель" demo="buyer">
              <div className="combo">
                <div className={'input d-sel' + (s.pop === 'buyer' ? ' d-focus' : '')}>
                  {s.buyer || <span className="d-ph-text">Поиск по названию или ИНН</span>}
                  {s.pop === 'buyer' && <span className="caret" />}
                </div>
                {s.pop === 'buyer' && <Pop opts={opts} />}
              </div>
            </Field>
            <Field label="Вид цен" hint={s.buyer.length > 3 ? 'По договору покупателя' : undefined}>
              <Select v={s.buyer.length > 3 ? 'Оптовая' : 'Розничная'} />
            </Field>
            <Field label="Склад">
              <Select v="Основной склад" />
            </Field>
            <Field label="Дата">
              <span className="input d-sel">29.10.2026</span>
            </Field>
            <Field label="Номер" hint={s.posted ? undefined : 'Присваивается при проведении'}>
              <span className="input d-sel">{s.posted ? 'СЧ-000214' : '—'}</span>
            </Field>
            {!compact && (
              <Field label="Договор">
                <Select v={s.buyer.length > 3 ? 'Договор поставки № 41' : 'Выберите договор'} />
              </Field>
            )}
            {!compact && (
              <Field label="Цены">
                <span className="seg d-seg">
                  <span data-state="on">НДС в сумме</span>
                  <span>НДС сверху</span>
                </span>
              </Field>
            )}
          </section>

          <div className="tabs d-tabs">
            <span className="tab on">
              Товары и услуги<span className="cnt">{s.lines.length}</span>
            </span>
            <span className="tab">Оплата</span>
            {!compact && <span className="tab">Доставка</span>}
          </div>
          <section className="doc-lines panel">
            <table className="dtbl">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>№</th>
                  <th>Товар или услуга</th>
                  <th className="r" style={{ width: 70 }}>
                    Кол-во
                  </th>
                  <th className="r" style={{ width: 96 }}>
                    Цена
                  </th>
                  {!compact && (
                    <th className="r" style={{ width: 100 }}>
                      Сумма НДС
                    </th>
                  )}
                  <th className="r" style={{ width: 110 }}>
                    Всего
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
                      <span className="input d-sel d-cell r">{rub(l.price, true)}</span>
                    </td>
                    {!compact && <td className="r num muted">{rub(Math.round(((l.qty * l.price * 20) / 120) * 100) / 100, true)}</td>}
                    <td className="r num" style={{ fontWeight: 600 }}>
                      {rub(l.qty * l.price, true)}
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
                          {s.query || <span className="d-ph-text">Поиск по названию, артикулу или штрихкоду</span>}
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
                Добавить строку
              </span>
            </div>
          </section>

          <div className="doc-bottom">
            {!compact && (
              <section className="doc-links panel">
                <h2>Связанные документы</h2>
                <p className="faint">На основании: Заказ покупателя № 118</p>
              </section>
            )}
            <section className="doc-totals panel">
              <dl>
                <div>
                  <dt>Сумма без НДС</dt>
                  <dd className="num">{rub(total - vat, true)}</dd>
                </div>
                <div>
                  <dt>НДС 20%</dt>
                  <dd className="num">{rub(vat, true)}</dd>
                </div>
                <div className="grand">
                  <dt>Всего (с НДС)</dt>
                  <dd className={'num' + (s.hot ? ' d-flash' : '')} key={total}>
                    {rub(total, true)} ₽
                  </dd>
                </div>
              </dl>
              <p className="doc-words">{WORDS[total]}</p>
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
