/* Запись «Продажи»: журнал заказов покупателей → заказ → «Создать на основании» → реализация → проведение →
   движения склада и взаиморасчёты покупателя. Разметка — как у JournalPage, DocumentPage, StockMovesDialog и CompanySettlements */
import type * as React from 'react';
import { ArrowLeftRight, CalendarDays, ChevronDown, Copy, FileText, Printer, Search, Trash2, X } from 'lucide-react';
import { DemoShell, rub } from './shell';
import type { Scene } from './player';

type View = 'journal' | 'order' | 'real' | 'card';

interface Line {
  name: string;
  qty: number;
  price: number;
}
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

const BUYER = 'ООО «Атлас Мебель»';
const LINES: Line[] = [
  { name: 'Стол обеденный «Дуб» 160×90', qty: 2, price: 24900 },
  { name: 'Стул «Классик»', qty: 8, price: 5900 },
  { name: 'Тумба под ТВ «Лофт»', qty: 1, price: 14500 },
];
const TOTAL = LINES.reduce((a, l) => a + l.qty * l.price, 0); // 111 500
const WORDS = 'Сто одиннадцать тысяч пятьсот рублей 00 копеек';
const vatOf = (n: number) => Math.round(((n * 20) / 120) * 100) / 100;

const JOURNAL = [
  { num: 'ЗК-000118', date: '27.10.2026', who: BUYER, total: TOTAL },
  { num: 'ЗК-000117', date: '26.10.2026', who: 'ИП Громова Е. В.', total: 38400 },
  { num: 'ЗК-000116', date: '23.10.2026', who: 'ООО «Атлант-Строй»', total: 214900 },
  { num: 'ЗК-000115', date: '21.10.2026', who: 'ООО «Северный дом»', total: 67200 },
];
const JOURNAL_SUM = JOURNAL.reduce((a, r) => a + r.total, 0);

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

function Journal({ compact, hot }: { compact: boolean; hot: boolean }) {
  return (
    <div className="d-page-in">
      <div className="d-ph">
        <div>
          <h1>Продажи</h1>
          {!compact && <p>КП, заказы покупателей, счета, отгрузки (УПД), акты услуг и возвраты.</p>}
        </div>
      </div>
      <div className="tabs d-tabs">
        <span className="tab">Все типы</span>
        <span className="tab on">Заказ покупателя</span>
        <span className="tab">Счёт на оплату</span>
        {!compact && <span className="tab">Реализация (УПД)</span>}
      </div>
      <div className="d-toolbar">
        <span className="input d-sel" style={{ width: 200, height: 28, flexShrink: 0 }}>
          <Search size={13} />
          <span className="d-ph-text">Поиск по покупателю</span>
        </span>
        <span className="btn btn-ghost">Фильтр</span>
        <span className="btn btn-ghost">Сортировка: Дата</span>
      </div>
      <div className="tbl-wrap" style={{ margin: '0 var(--gutter)' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>
                <div className="thi">Номер</div>
              </th>
              <th>
                <div className="thi">Дата</div>
              </th>
              <th>
                <div className="thi">Покупатель</div>
              </th>
              {!compact && (
                <th>
                  <div className="thi">Оплата</div>
                </th>
              )}
              <th>
                <div className="thi">Статус</div>
              </th>
              {!compact && (
                <th className="num">
                  <div className="thi" style={{ justifyContent: 'flex-end' }}>
                    НДС
                  </div>
                </th>
              )}
              <th className="num">
                <div className="thi" style={{ justifyContent: 'flex-end' }}>
                  Всего
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {JOURNAL.map((r, i) => (
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
                      Не оплачен
                    </span>
                  </td>
                )}
                <td>
                  <span className="badge green">
                    <span className="dot" />
                    Проведён
                  </span>
                </td>
                {!compact && <td className="num muted">{rub(vatOf(r.total), true)}</td>}
                <td className="num" style={{ fontWeight: 500 }}>
                  {rub(r.total, true)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={compact ? 4 : 6}>
                <span className="row" style={{ gap: 6 }}>
                  Итого
                  <span className="faint" style={{ fontWeight: 500 }}>
                    {JOURNAL.length}
                  </span>
                </span>
              </td>
              <td className="num" style={{ fontWeight: 600 }}>
                {rub(JOURNAL_SUM, true)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Форма документа: заказ покупателя (проведён) или реализация (черновик → проведена) */
function Doc({ s, compact, kind }: { s: S; compact: boolean; kind: 'order' | 'real' }) {
  const order = kind === 'order';
  const posted = order || s.posted;
  const title = order ? 'Заказ покупателя' : 'Реализация (УПД)';
  const num = order ? 'ЗК-000118' : s.posted ? 'РТ-000063' : null;
  return (
    <div className="d-doc d-page-in">
      <div className="doc-bar">
        <div className="doc-title">
          <nav className="muted" style={{ fontSize: 12.5 }}>
            Продажи / {title}
          </nav>
          <h1>
            {title} {num ? num : <span className="faint">черновик</span>}
            <span className={'badge ' + (posted ? 'green' : 'gray') + (!order && s.posted ? ' d-pop' : '')} key={String(posted)}>
              <span className="dot" />
              {posted ? 'Проведён' : 'Черновик'}
            </span>
          </h1>
          <span className="faint" style={{ fontSize: 12 }}>
            {posted ? 'Проведён 29.10.2026' : 'Все изменения сохранены'}
          </span>
        </div>
        <div className="doc-actions" style={{ position: 'relative' }}>
          {!order && (
            <span className="btn btn-secondary" data-demo="btn-moves">
              <ArrowLeftRight size={14} />
              Движения
            </span>
          )}
          {order && !compact && (
            <span className="btn btn-secondary">
              <Printer size={14} />
              Печать
            </span>
          )}
          {(order || s.posted) && (
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <span className="btn btn-secondary" data-demo="btn-based">
                <Copy size={14} />
                Создать на основании
                <ChevronDown size={12} />
              </span>
              {s.menu && (
                <div className="pop d-popover" style={{ left: 'auto', right: 0, minWidth: 230 }}>
                  {['Счёт на оплату', 'Реализация (УПД)', 'Акт выполненных работ'].map((t, i) => (
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
            <span className="btn btn-secondary">Отменить проведение</span>
          ) : (
            <span className={'btn ' + (s.posted ? 'btn-secondary' : 'btn-primary')} data-demo="btn-post">
              {s.posted ? 'Отменить проведение' : 'Провести'}
            </span>
          )}
        </div>
      </div>

      <section className="doc-head panel">
        <Field label="Организация">
          <Select v="ООО «Мебельная фабрика»" />
        </Field>
        <Field label="Покупатель">
          <div className="doc-ro">
            <span className="crm-link" data-demo="buyer-link">
              {BUYER}
            </span>
          </div>
        </Field>
        <Field label="Склад">
          <Select v="Основной склад" />
        </Field>
        <Field label="Дата">
          <span className="input d-sel">{order ? '27.10.2026' : '29.10.2026'}</span>
        </Field>
        <Field label="Номер" hint={num ? undefined : 'Присваивается при проведении'}>
          <span className="input d-sel">{num ?? '—'}</span>
        </Field>
        <Field label="Вид цен">
          <Select v="Оптовая" />
        </Field>
        {!compact && (
          <Field label="Договор">
            <Select v="Договор поставки № 41" />
          </Field>
        )}
      </section>

      <div className="tabs d-tabs">
        <span className="tab on">
          Товары и услуги<span className="cnt">{LINES.length}</span>
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
            {LINES.map((l, i) => (
              <tr key={l.name}>
                <td className="faint num">{i + 1}</td>
                <td>
                  <span className="input d-sel d-cell">{l.name}</span>
                </td>
                <td className="r">
                  <span className="input d-sel d-cell r">{l.qty}</span>
                </td>
                <td className="r">
                  <span className="input d-sel d-cell r">{rub(l.price, true)}</span>
                </td>
                {!compact && <td className="r num muted">{rub(vatOf(l.qty * l.price), true)}</td>}
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
          </tbody>
        </table>
      </section>

      <div className="doc-bottom">
        {!compact && (
          <section className="doc-links panel">
            <h2>Связанные документы</h2>
            {order ? (
              <>
                <p className="faint">Не создан на основании другого документа</p>
                <p className="faint">Созданных документов пока нет.</p>
              </>
            ) : (
              <p>
                <span className="muted">На основании </span>
                <span className="doc-ref">
                  <span className="crm-link">Заказ покупателя ЗК-000118</span>
                  <span className="badge green">
                    <span className="dot" />
                    Проведён
                  </span>
                  <span className="num muted">{rub(TOTAL, true)}</span>
                </span>
              </p>
            )}
          </section>
        )}
        <section className="doc-totals panel">
          <dl>
            <div>
              <dt>Сумма без НДС</dt>
              <dd className="num">{rub(TOTAL - vatOf(TOTAL), true)}</dd>
            </div>
            <div>
              <dt>НДС 20%</dt>
              <dd className="num">{rub(vatOf(TOTAL), true)}</dd>
            </div>
            <div className="grand">
              <dt>Всего (с НДС)</dt>
              <dd className="num">{rub(TOTAL, true)} ₽</dd>
            </div>
          </dl>
          <p className="doc-words">{WORDS}</p>
        </section>
      </div>
    </div>
  );
}

/** Карточка покупателя, вкладка «Взаиморасчёты»: после проведения реализации появилось начисление — долг */
function Card({ compact }: { compact: boolean }) {
  return (
    <div className="d-page-in">
      <div className="d-ph">
        <span className="av md" style={{ '--c': '#5A67D8' } as React.CSSProperties}>
          АМ
        </span>
        <h1>{BUYER}</h1>
        {!compact && <span className="badge gray">Мебель</span>}
      </div>
      <div className="tabs d-tabs">
        <span className="tab">Обзор</span>
        {!compact && <span className="tab">Договоры</span>}
        <span className="tab">
          Документы<span className="cnt">2</span>
        </span>
        <span className="tab on">Взаиморасчёты</span>
      </div>
      <div className="d-doc" style={{ paddingTop: 16 }}>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Покупатель</h3>
          <span className="muted">
            Сальдо: <b className="d-flash" style={{ fontWeight: 600 }}>{rub(TOTAL, true)}</b>
          </span>
          {!compact && <span className="faint" style={{ fontSize: 12 }}>Плюс — долг, минус — аванс</span>}
          <span className="sp" />
          <span className="btn btn-secondary btn-sm">
            <Printer size={13} />
            Акт сверки
          </span>
        </div>
        <table className="dtbl">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Дата</th>
              <th>Документ</th>
              <th className="r" style={{ width: 130 }}>
                Начислено
              </th>
              <th className="r" style={{ width: 130 }}>
                Оплачено
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="bold">
              <td />
              <td>Сальдо на начало</td>
              <td className="r num" colSpan={2}>
                {rub(0, true)}
              </td>
            </tr>
            <tr className="d-row-hot">
              <td className="muted">29.10.2026</td>
              <td>Реализация (УПД) РТ-000063</td>
              <td className="r num">{rub(TOTAL, true)}</td>
              <td className="r num" />
            </tr>
            <tr className="bold">
              <td />
              <td>Сальдо на конец</td>
              <td className="r num" colSpan={2}>
                {rub(TOTAL, true)}
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
  render: (s, { compact }) => (
    <DemoShell
      compact={compact}
      active="sales"
      crumbs={
        s.view === 'journal'
          ? ['Продажи', 'Заказы покупателей']
          : s.view === 'order'
            ? ['Продажи', 'Заказ покупателя ЗК-000118']
            : s.view === 'real'
              ? ['Продажи', s.posted ? 'Реализация РТ-000063' : 'Реализация (черновик)']
              : ['CRM', BUYER, 'Взаиморасчёты']
      }
    >
      {s.view === 'journal' && <Journal compact={compact} hot={false} />}
      {s.view === 'order' && <Doc s={s} compact={compact} kind="order" />}
      {s.view === 'real' && <Doc s={s} compact={compact} kind="real" />}
      {s.view === 'card' && <Card compact={compact} />}

      {s.ship && (
        <div className="d-modal">
          <div className="modal sm d-pop">
            <div className="modal-h">
              <h2>Создать реализацию</h2>
              <span className="ibtn ibtn-sm">
                <X size={14} />
              </span>
            </div>
            <div className="modal-desc">Можно выбрать дату: в реализацию попадут только строки заказа со сроком отгрузки не позже неё. Без даты берутся все строки.</div>
            <div className="modal-b">
              <Field label="Отгрузка по дату">
                <span className="input d-sel">
                  <span className="d-ph-text">Не выбрана</span>
                  <span className="chev" style={{ marginLeft: 'auto' }}>
                    <CalendarDays size={14} />
                  </span>
                </span>
              </Field>
            </div>
            <div className="modal-f">
              <span className="sp" />
              <span className="btn btn-ghost">Оставить</span>
              <span className="btn btn-primary" data-demo="ship-create">
                Создать
              </span>
            </div>
          </div>
        </div>
      )}

      {s.moves && (
        <div className="d-modal">
          <div className="modal lg d-pop" style={{ maxWidth: 640 }}>
            <div className="modal-h">
              <h2>Движения склада</h2>
              <span className="ibtn ibtn-sm">
                <X size={14} />
              </span>
            </div>
            <div className="modal-desc">Движения, записанные проведённым документом.</div>
            <div className="modal-b">
              <table className="dtbl">
                <thead>
                  <tr>
                    <th>Склад</th>
                    <th>Товар</th>
                    <th className="r">Количество</th>
                  </tr>
                </thead>
                <tbody>
                  {LINES.map(l => (
                    <tr key={l.name} className="d-row-hot">
                      <td className="muted">Основной склад</td>
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
                Закрыть
              </span>
            </div>
          </div>
        </div>
      )}
    </DemoShell>
  ),
};
