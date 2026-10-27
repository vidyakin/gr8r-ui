/* Печатные формы денег (задача 1174б): приходный (КО-1) и расходный (КО-2) кассовые ордера и акт сверки взаиморасчётов.
   Чистые функции «данные → HTML», по-русски, без перевода. Страница A4 портрет. */
import { dec, fmt } from '../decimal';
import { amountInWordsRu } from '../ru';
import { BASE_CSS, dateRu, esc, moneyRu } from './templates';
import type { PrintOrganization } from './types';

const page = (title: string, body: string, draft: boolean) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
@page{size:A4 portrait;margin:12mm 10mm}
${BASE_CSS}
@media screen{body{background:#e9e9ec}.sheet{background:#fff;margin:12px auto;padding:12mm 10mm;width:210mm;min-height:297mm;box-shadow:0 1px 6px rgba(0,0,0,.2)}}
</style></head>
<body><div class="sheet">${draft ? '<div class="draft">ЧЕРНОВИК</div>' : ''}${body}</div></body></html>`;

export interface CashOrderData {
  form: 'ko1' | 'ko2';
  /** null — документ не проведён */
  number: string | null;
  date: string;
  organization: PrintOrganization;
  cashRegisterName: string;
  /** Принято от / выдать: контрагент или подотчётное лицо */
  personName: string;
  /** Основание (документы расчётов, комментарий) */
  basis: string;
  amount: string;
}

export function renderCashOrder(d: CashOrderData): string {
  const o = d.organization;
  const receipt = d.form === 'ko1';
  const title = receipt ? 'Приходный кассовый ордер' : 'Расходный кассовый ордер';
  const head = d.number ? `${title} № ${esc(d.number)}` : `${title} (черновик)`;
  const rub = moneyRu(fmt(dec(d.amount), 2));
  return page(
    head,
    `<h1 class="center">${head}</h1>
<div class="center">Унифицированная форма № ${receipt ? 'КО-1' : 'КО-2'}</div>
<table class="plain" style="margin-top:8px">
<tr><td style="width:150px">Организация</td><td><b>${esc(o.fullName || o.name)}</b>${o.inn ? `, ИНН ${esc(o.inn)}` : ''}</td></tr>
<tr><td>Касса</td><td>${esc(d.cashRegisterName)}</td></tr>
<tr><td>Дата</td><td>${esc(dateRu(d.date))}</td></tr>
</table>
<table class="grid" style="margin-top:10px"><thead><tr><th>${receipt ? 'Принято от' : 'Выдать'}</th><th>Основание</th><th style="width:130px">Сумма, руб.</th></tr></thead>
<tbody><tr><td>${esc(d.personName)}</td><td>${esc(d.basis)}</td><td class="right">${rub}</td></tr></tbody></table>
<div class="words"><b>Сумма:</b> ${esc(amountInWordsRu(d.amount))}</div>
<table class="sign plain"><tr>
<td><b>Руководитель</b><br><span class="line"></span> / ${esc(o.directorName || '________________')} /</td>
<td><b>Главный бухгалтер</b><br><span class="line"></span> / ${esc(o.accountantName || o.directorName || '________________')} /</td>
<td><b>${receipt ? 'Кассир' : 'Получил'}</b><br><span class="line"></span> / ________________ /</td>
</tr></table>`,
    !d.number,
  );
}

export interface SettlementActRow {
  date: string;
  /** «Реализация РТ-2026-00012», «Оплата ПС-2026-00003» */
  label: string;
  /** Начисление (долг контрагента растёт) */
  accrual: string;
  /** Оплата и зачёт (долг уменьшается) */
  payment: string;
}
export interface SettlementActData {
  organization: PrintOrganization;
  counterpartyName: string;
  counterpartyInn: string;
  side: 'customer' | 'supplier';
  from: string;
  to: string;
  /** Сальдо на начало: положительное — долг контрагента перед нами (у поставщика — наш долг) */
  opening: string;
  rows: SettlementActRow[];
  closing: string;
}

export function renderSettlementAct(d: SettlementActData): string {
  const o = d.organization;
  const rows = d.rows
    .map(r => `<tr><td class="center nowrap">${esc(dateRu(r.date))}</td><td>${esc(r.label)}</td><td class="right">${dec(r.accrual) ? moneyRu(r.accrual) : ''}</td><td class="right">${dec(r.payment) ? moneyRu(r.payment) : ''}</td></tr>`)
    .join('');
  const turnoverA = d.rows.reduce((s, r) => s + dec(r.accrual), 0n);
  const turnoverP = d.rows.reduce((s, r) => s + dec(r.payment), 0n);
  const closing = dec(d.closing);
  const verdict =
    closing === 0n
      ? 'Задолженности нет.'
      : d.side === 'customer'
        ? closing > 0n
          ? `Задолженность ${esc(d.counterpartyName)} в пользу ${esc(o.name)}: ${moneyRu(fmt(closing, 2))} руб.`
          : `Задолженность ${esc(o.name)} в пользу ${esc(d.counterpartyName)} (аванс): ${moneyRu(fmt(-closing, 2))} руб.`
        : closing > 0n
          ? `Задолженность ${esc(o.name)} в пользу ${esc(d.counterpartyName)}: ${moneyRu(fmt(closing, 2))} руб.`
          : `Задолженность ${esc(d.counterpartyName)} в пользу ${esc(o.name)} (аванс): ${moneyRu(fmt(-closing, 2))} руб.`;
  const title = `Акт сверки взаиморасчётов за период ${dateRu(d.from)} — ${dateRu(d.to)}`;
  return page(
    title,
    `<h1 class="center">Акт сверки взаиморасчётов</h1>
<div class="center">за период ${esc(dateRu(d.from))} — ${esc(dateRu(d.to))}</div>
<p>Мы, нижеподписавшиеся, <b>${esc(o.fullName || o.name)}</b>${o.inn ? ` (ИНН ${esc(o.inn)})` : ''} и <b>${esc(d.counterpartyName)}</b>${d.counterpartyInn ? ` (ИНН ${esc(d.counterpartyInn)})` : ''}, составили акт о том, что состояние взаиморасчётов по данным учёта ${esc(o.name)} следующее:</p>
<table class="grid"><thead><tr><th style="width:80px">Дата</th><th>Документ</th><th style="width:120px">${d.side === 'customer' ? 'Отгрузка' : 'Поступление'}, руб.</th><th style="width:120px">Оплата, руб.</th></tr></thead>
<tbody><tr class="bold"><td></td><td>Сальдо на ${esc(dateRu(d.from))}</td><td class="right" colspan="2">${moneyRu(d.opening)}</td></tr>
${rows}
<tr class="bold"><td></td><td>Обороты за период</td><td class="right">${moneyRu(fmt(turnoverA, 2))}</td><td class="right">${moneyRu(fmt(turnoverP, 2))}</td></tr>
<tr class="bold"><td></td><td>Сальдо на ${esc(dateRu(d.to))}</td><td class="right" colspan="2">${moneyRu(d.closing)}</td></tr></tbody></table>
<div class="words">${verdict}</div>
<table class="sign plain"><tr>
<td style="width:50%"><b>${esc(o.name)}</b><br><br><span class="line"></span> / ${esc(o.directorName || '________________')} /</td>
<td style="width:50%"><b>${esc(d.counterpartyName)}</b><br><br><span class="line"></span> / ________________ /</td>
</tr></table>`,
    false,
  );
}
