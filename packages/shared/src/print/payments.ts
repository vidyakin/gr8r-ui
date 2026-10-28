/* Печатные формы денег (задача 1174б): приходный (КО-1) и расходный (КО-2) кассовые ордера и акт сверки взаиморасчётов.
   Чистые функции «данные → HTML», по-русски, без перевода. Страница A4 портрет. */
import { dec, fmt } from '../decimal';
import { amountInWordsRu } from '../ru';
import { BASE_CSS, dateRu, esc, moneyRu } from './templates';
import type { PrintOrganization } from './types';

export const moneyPage = (title: string, body: string, draft: boolean) => `<!doctype html>
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
  return moneyPage(
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
  return moneyPage(
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

/* ---------------- банковские документы, АО-1, ввод остатков ---------------- */

export interface PrintBankRef {
  bankName: string;
  bik: string;
  corrAccount: string;
  account: string;
}
export interface PrintPartyRef {
  name: string;
  inn: string;
  kpp: string;
}

const heading = (title: string, number: string | null, date: string) =>
  number ? `${title} № ${esc(number)} от ${esc(dateRu(date))}` : `${title} (черновик, номер будет присвоен при проведении) от ${esc(dateRu(date))}`;
const rubWords = (amount: string) => `<div class="words"><b>Сумма:</b> ${moneyRu(fmt(dec(amount), 2))} руб.<br>${esc(amountInWordsRu(amount))}</div>`;
const bankText = (b: PrintBankRef | null) => (b ? `${esc(b.bankName)}, БИК ${esc(b.bik)}, к/с ${esc(b.corrAccount)}, р/с ${esc(b.account)}` : '—');

/** Поступление на расчётный счёт: кто, на какой счёт, за что */
export interface BankReceiptData {
  form: 'bank_receipt';
  number: string | null;
  date: string;
  organization: PrintOrganization;
  /** Наш расчётный счёт-получатель */
  account: PrintBankRef | null;
  /** Название операции («Оплата от покупателя») */
  operation: string;
  payer: PrintPartyRef | null;
  rows: { n: number; label: string; flowItem: string; amount: string }[];
  amount: string;
  comment: string;
}

export function renderBankReceipt(d: BankReceiptData): string {
  const o = d.organization;
  const title = heading('Поступление на расчётный счёт', d.number, d.date);
  const rows = d.rows.map(r => `<tr><td class="center">${r.n}</td><td>${esc(r.label)}</td><td>${esc(r.flowItem)}</td><td class="right">${moneyRu(r.amount)}</td></tr>`).join('');
  return moneyPage(
    title,
    `<h1 class="center">${title}</h1>
<table class="plain" style="margin-top:8px">
<tr><td style="width:150px">Организация</td><td><b>${esc(o.fullName || o.name)}</b>${o.inn ? `, ИНН ${esc(o.inn)}` : ''}${o.kpp ? `, КПП ${esc(o.kpp)}` : ''}</td></tr>
<tr><td>Расчётный счёт</td><td>${bankText(d.account)}</td></tr>
<tr><td>Операция</td><td>${esc(d.operation)}</td></tr>
<tr><td>Плательщик</td><td>${d.payer ? `${esc(d.payer.name)}${d.payer.inn ? `, ИНН ${esc(d.payer.inn)}` : ''}` : '—'}</td></tr>
</table>
<table class="grid" style="margin-top:10px"><thead><tr><th style="width:28px">№</th><th>Основание (документ расчётов)</th><th style="width:170px">Статья движения денег</th><th style="width:110px">Сумма, руб.</th></tr></thead>
<tbody>${rows}<tr class="bold"><td colspan="3" class="right">Итого</td><td class="right">${moneyRu(fmt(dec(d.amount), 2))}</td></tr></tbody></table>
${rubWords(d.amount)}
${d.comment ? `<div class="party small">${esc(d.comment)}</div>` : ''}
<table class="sign plain"><tr>
<td><b>Главный бухгалтер</b><br><span class="line"></span> / ${esc(o.accountantName || o.directorName || '________________')} /</td>
</tr></table>`,
    !d.number,
  );
}

/** Платёжное поручение (форма 0401060) по документу «Списание с расчётного счёта» */
export interface PaymentOrderData {
  form: 'payment_order';
  number: string | null;
  date: string;
  organization: PrintOrganization;
  payer: PrintPartyRef;
  payerBank: PrintBankRef | null;
  payee: PrintPartyRef;
  /** Банк и расчётный счёт получателя */
  payeeBank: PrintBankRef | null;
  amount: string;
  /** Назначение платежа */
  purpose: string;
}

export function renderPaymentOrder(d: PaymentOrderData): string {
  const o = d.organization;
  const pb = d.payerBank;
  const rb = d.payeeBank;
  const title = d.number ? `Платёжное поручение № ${esc(d.number)}` : 'Платёжное поручение (черновик)';
  const sum = moneyRu(fmt(dec(d.amount), 2));
  const cell = (label: string, v: string) => `<div class="small">${label}</div><div>${v || '&nbsp;'}</div>`;
  return moneyPage(
    title,
    `<div class="right small">Форма по ОКУД 0401060</div>
<table class="plain"><tr>
<td style="width:260px"><h1 style="margin:0">${title}</h1></td><td style="width:90px" class="center">${esc(dateRu(d.date))}<div class="small">Дата</div></td><td style="width:90px" class="center">электронно<div class="small">Вид платежа</div></td><td></td></tr></table>
<table class="grid" style="margin-top:4px">
<tr><td colspan="3">Сумма прописью<br><b>${esc(amountInWordsRu(d.amount))}</b></td></tr>
<tr><td style="width:34%">${cell('ИНН', esc(d.payer.inn))}</td><td style="width:33%">${cell('КПП', esc(d.payer.kpp))}</td><td>${cell('Сумма', sum)}</td></tr>
<tr><td colspan="2" rowspan="2">${cell('Плательщик', esc(d.payer.name))}</td><td>${cell('Сч. №', esc(pb?.account ?? ''))}</td></tr>
<tr><td>${cell('БИК', esc(pb?.bik ?? ''))}${cell('Сч. №', esc(pb?.corrAccount ?? ''))}</td></tr>
<tr><td colspan="3">${cell('Банк плательщика', esc(pb?.bankName ?? ''))}</td></tr>
<tr><td colspan="2" rowspan="2">${cell('Банк получателя', esc(rb?.bankName ?? ''))}</td><td>${cell('БИК', esc(rb?.bik ?? ''))}</td></tr>
<tr><td>${cell('Сч. №', esc(rb?.corrAccount ?? ''))}</td></tr>
<tr><td>${cell('ИНН', esc(d.payee.inn))}</td><td>${cell('КПП', esc(d.payee.kpp))}</td><td>${cell('Сч. №', esc(rb?.account ?? ''))}</td></tr>
<tr><td colspan="3">${cell('Получатель', esc(d.payee.name))}</td></tr>
<tr><td colspan="3"><table class="plain"><tr>
<td>${cell('Вид оп.', '01')}</td><td>${cell('Срок плат.', '')}</td><td>${cell('Наз. пл.', '')}</td><td>${cell('Очер. плат.', '5')}</td><td>${cell('Код', '')}</td><td>${cell('Рез. поле', '')}</td></tr></table></td></tr>
<tr><td colspan="3">${cell('Назначение платежа', esc(d.purpose))}</td></tr>
</table>
<table class="sign plain"><tr>
<td style="width:55%"><b>Подписи</b><br><br><span class="line"></span> / ${esc(o.directorName || '________________')} /<br><br><span class="line"></span> / ${esc(o.accountantName || '________________')} /</td>
<td><b>Отметки банка</b><br><br><span class="small">М.П.</span></td></tr></table>`,
    !d.number,
  );
}

/** Авансовый отчёт (АО-1): расходы подотчётного лица */
export interface AdvanceReportData {
  form: 'advance_report';
  number: string | null;
  date: string;
  organization: PrintOrganization;
  accountableName: string;
  rows: { n: number; label: string; costItem: string; counterparty: string; amount: string }[];
  total: string;
  comment: string;
}

export function renderAdvanceReport(d: AdvanceReportData): string {
  const o = d.organization;
  const title = heading('Авансовый отчёт', d.number, d.date);
  const rows = d.rows.map(r => `<tr><td class="center">${r.n}</td><td>${esc(r.label)}</td><td>${esc(r.costItem)}</td><td>${esc(r.counterparty)}</td><td class="right">${moneyRu(r.amount)}</td></tr>`).join('');
  return moneyPage(
    title,
    `<h1 class="center">${title}</h1>
<div class="center">Унифицированная форма № АО-1</div>
<table class="plain" style="margin-top:8px">
<tr><td style="width:150px">Организация</td><td><b>${esc(o.fullName || o.name)}</b>${o.inn ? `, ИНН ${esc(o.inn)}` : ''}</td></tr>
<tr><td>Подотчётное лицо</td><td>${esc(d.accountableName)}</td></tr>
</table>
<table class="grid" style="margin-top:10px"><thead><tr><th style="width:28px">№</th><th>Расход (документ, назначение)</th><th style="width:140px">Статья затрат</th><th style="width:140px">Поставщик</th><th style="width:100px">Сумма, руб.</th></tr></thead>
<tbody>${rows}<tr class="bold"><td colspan="4" class="right">Израсходовано</td><td class="right">${moneyRu(fmt(dec(d.total), 2))}</td></tr></tbody></table>
${rubWords(d.total)}
${d.comment ? `<div class="party small">${esc(d.comment)}</div>` : ''}
<table class="sign plain"><tr>
<td><b>Подотчётное лицо</b><br><span class="line"></span> / ${esc(d.accountableName || '________________')} /</td>
<td><b>Руководитель</b><br><span class="line"></span> / ${esc(o.directorName || '________________')} /</td>
<td><b>Главный бухгалтер</b><br><span class="line"></span> / ${esc(o.accountantName || o.directorName || '________________')} /</td>
</tr></table>`,
    !d.number,
  );
}

/** Ввод начальных остатков: кассы, счета и расчёты с контрагентами по разделам */
export interface OpeningBalanceData {
  form: 'opening_balance';
  number: string | null;
  date: string;
  organization: PrintOrganization;
  sections: { title: string; rows: { n: number; name: string; details: string; amount: string }[]; total: string }[];
  comment: string;
}

export function renderOpeningBalance(d: OpeningBalanceData): string {
  const o = d.organization;
  const title = heading('Ввод начальных остатков', d.number, d.date);
  const sections = d.sections
    .map(
      s => `<h2 style="margin-top:12px">${esc(s.title)}</h2>
<table class="grid"><thead><tr><th style="width:28px">№</th><th>Наименование</th><th>Уточнение</th><th style="width:120px">Сумма, руб.</th></tr></thead><tbody>
${s.rows.map(r => `<tr><td class="center">${r.n}</td><td>${esc(r.name)}</td><td>${esc(r.details)}</td><td class="right">${moneyRu(r.amount)}</td></tr>`).join('')}
<tr class="bold"><td colspan="3" class="right">Итого</td><td class="right">${moneyRu(fmt(dec(s.total), 2))}</td></tr></tbody></table>`,
    )
    .join('');
  return moneyPage(
    title,
    `<h1 class="center">${title}</h1>
<table class="plain" style="margin-top:8px"><tr><td style="width:150px">Организация</td><td><b>${esc(o.fullName || o.name)}</b>${o.inn ? `, ИНН ${esc(o.inn)}` : ''}</td></tr>
<tr><td>Остатки на дату</td><td>${esc(dateRu(d.date))}</td></tr></table>
${sections || '<p>Строк нет.</p>'}
${d.comment ? `<div class="party small">${esc(d.comment)}</div>` : ''}
<table class="sign plain"><tr>
<td><b>Главный бухгалтер</b><br><span class="line"></span> / ${esc(o.accountantName || o.directorName || '________________')} /</td>
</tr></table>`,
    !d.number,
  );
}

export type MoneyFormData = CashOrderData | BankReceiptData | PaymentOrderData | AdvanceReportData | OpeningBalanceData;
export const MONEY_FORMS: readonly string[] = ['ko1', 'ko2', 'bank_receipt', 'payment_order', 'advance_report', 'opening_balance'];
export const isMoneyForm = (f: string): boolean => MONEY_FORMS.includes(f);

/** Страница денежной печатной формы по готовым данным */
export function renderMoneyForm(d: MoneyFormData): string {
  switch (d.form) {
    case 'ko1':
    case 'ko2':
      return renderCashOrder(d);
    case 'bank_receipt':
      return renderBankReceipt(d);
    case 'payment_order':
      return renderPaymentOrder(d);
    case 'advance_report':
      return renderAdvanceReport(d);
    case 'opening_balance':
      return renderOpeningBalance(d);
  }
}
