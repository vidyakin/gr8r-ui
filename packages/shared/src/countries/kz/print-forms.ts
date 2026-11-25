/* Казахстанские печатные формы. Данные документа и его сторон собираются до рендера. */
import { dec, div, fmt } from '../../decimal';
import { DOCUMENT_LABELS_RU } from '../../documents';
import { moneyPage, type CashOrderData, type PaymentOrderData } from '../../print/payments';
import { dateRu, esc, html, moneyRu, printOrientation, qtyRu } from '../../print/templates';
import type { PrintData, PrintLine, PrintParty } from '../../print/types';
import { amountInWordsKzt, isValidKzIban } from '.';

const titles = {
  kz_invoice: 'Счёт на оплату',
  kz_z2: 'Накладная на отпуск запасов на сторону',
  kz_r1: 'Акт выполненных работ (оказанных услуг)',
  kz_tax_invoice: 'Счёт-фактура',
};
type KzTradeForm = keyof typeof titles;
type Party = Pick<PrintParty, 'name' | 'inn' | 'requisites'> & Partial<Pick<PrintParty, 'fullName' | 'address' | 'bank'>>;

const shown = (value?: string | null) => esc(value || '—');
const money = (value: string) => esc(moneyRu(value));
const vatLabel = (rate: string) => rate === 'none' ? 'без НДС' : `${esc(rate)}%`;

function partyRows(label: string, party: Party, bank = party.bank) {
  const r = party.requisites;
  const account = bank?.account && isValidKzIban(bank.account) ? bank.account : r?.iik;
  const bik = account && account === bank?.account ? bank?.bik || r?.bik : r?.bik;
  return `<tr><th colspan="4">${label}</th></tr>
<tr><td colspan="2"><b>${shown(party.fullName || party.name)}</b>${party.address ? `<br>${esc(party.address)}` : ''}</td>
<td colspan="2">БИН/ИИН: ${shown(r?.binIin || r?.bin || r?.iin || party.inn)}</td></tr>
<tr><td>ИИК: ${shown(account)}</td><td>БИК: ${shown(bik)}</td><td>КБе: ${shown(r?.kbe)}</td><td>КНП: ${shown(r?.knp)}</td></tr>
${bank?.bankName && account === bank.account ? `<tr><td colspan="4">Банк: ${esc(bank.bankName)}</td></tr>` : ''}`;
}

function header(title: string, number: string | null, date: string, code?: string) {
  return `${code ? `<div class="small right">Форма ${code}</div>` : ''}
<h1 class="center">${title}${number ? ` № ${esc(number)}` : ''} от ${esc(dateRu(date))}</h1>`;
}

function amountWords(amount: string, currency: string) {
  if (currency !== 'KZT') return '';
  return `<div class="words"><b>Сумма прописью</b> ${esc(amountInWordsKzt(amount, true))}</div>`;
}

function signatures(...entries: [label: string, name?: string][]) {
  return `<table class="plain sign"><tr>${entries.map(([label, name]) =>
    `<td><b>${label}</b><br><span class="line"></span> / ${shown(name)} /</td>`).join('')}</tr></table>`;
}

function tradeLines(form: KzTradeForm, d: PrintData, currency: string) {
  const shipped = form === 'kz_z2';
  const work = form === 'kz_r1';
  const name = work ? 'Наименование работ (услуг)' : 'Наименование товаров, работ, услуг';
  const quantity = shipped ? '<th>По документу</th><th>Отпущено</th>' : '<th>Количество</th>';
  const unitNet = (l: PrintLine) => money(fmt(div(dec(l.net), dec(l.qty) || 1n), 2));
  const rows = d.lines.map(l => `<tr>
<td class="center">${esc(l.n)}</td><td>${esc(l.name)}</td><td>${esc(l.sku)}</td>
${work ? `<td>${esc(dateRu(d.date))}</td>` : ''}
<td class="center">${esc(l.unitSymbol || l.unitCode)}</td><td class="right">${esc(qtyRu(l.qty))}</td>
${shipped ? `<td class="right">${esc(qtyRu(l.qty))}</td>` : ''}
<td class="right">${unitNet(l)}</td><td class="right">${money(l.net)}</td><td class="center">${vatLabel(l.vatRate)}</td>
<td class="right">${l.vatRate === 'none' ? '—' : money(l.vatAmount)}</td><td class="right">${money(l.total)}</td>
</tr>`).join('');
  return `<table class="grid" style="margin-top:8px"><thead><tr>
<th>№</th><th>${name}</th><th>Код</th>${work ? '<th>Дата выполнения</th>' : ''}<th>Ед. изм.</th>${quantity}
<th>Цена без НДС</th><th>Сумма без НДС</th><th>Ставка НДС</th><th>Сумма НДС</th><th>Всего, ${esc(currency)}</th>
</tr></thead><tbody>${rows}
<tr class="bold"><td colspan="${shipped || work ? 7 : 6}" class="right">Итого</td><td class="right">${money(d.totals.net)}</td><td></td>
<td class="right">${d.totals.byRate.every(v => v.rate === 'none') ? 'без НДС' : money(d.totals.vat)}</td>
<td class="right">${money(d.totals.total)}</td></tr>
</tbody></table>`;
}

export function renderKzTradeForm(form: KzTradeForm, d: PrintData): string {
  const o = d.organization;
  const shipment = form === 'kz_z2';
  const work = form === 'kz_r1';
  const tax = form === 'kz_tax_invoice';
  const currency = d.currency || 'KZT';
  const basis = d.basedOn
    ? `${DOCUMENT_LABELS_RU[d.basedOn.type]} ${d.basedOn.number ?? ''} от ${dateRu(d.basedOn.date)}`
    : '';
  return html(d, printOrientation(form), `
${header(titles[form], d.number, d.date, shipment ? 'З-2' : work ? 'Р-1' : undefined)}
${tax ? `<p>Номер учётной системы: ${shown(d.number)} · Дата совершения оборота: ${esc(dateRu(d.date))}</p>` : ''}
<table class="grid">
${partyRows(shipment ? 'Организация-отправитель' : work ? 'Исполнитель' : 'Поставщик', o)}
${partyRows(shipment ? 'Организация-получатель' : work ? 'Заказчик' : 'Покупатель', d.party)}
</table>
${shipment ? `<p>Склад: ${shown(d.warehouseName)} · Отпуск через: ____________________ · Доверенность № ______ от __________</p>` : ''}
${basis ? `<p>Основание: ${esc(basis)}</p>` : ''}
${form === 'kz_invoice' && d.dueDate ? `<p>Оплатить до ${esc(dateRu(d.dueDate))}</p>` : ''}
${tradeLines(form, d, currency)}
${amountWords(d.totals.total, currency)}
${d.comment ? `<p>${esc(d.comment)}</p>` : ''}
${shipment
    ? signatures(['Отпуск разрешил', o.directorName], ['Отпустил'], ['Главный бухгалтер', o.accountantName], ['Запасы получил'])
    : work
      ? signatures(['Сдал (исполнитель)', o.directorName], ['Принял (заказчик)'])
      : signatures(['Руководитель', o.directorName], ['Главный бухгалтер', o.accountantName])}
${work ? '<p class="right">Дата приёмки работ (услуг) ____________________</p>' : ''}`);
}

function cashFields(title: string, d: CashOrderData, receipt: boolean) {
  const currency = d.currency || 'KZT';
  return `<table class="plain">
<tr><td>Касса</td><td>${shown(d.cashRegisterName)}</td></tr>
<tr><td>${title}</td><td>${shown(d.personName)}</td></tr>
<tr><td>Основание</td><td>${shown(d.basis)}</td></tr>
<tr><td>Сумма, ${esc(currency)}</td><td><b>${money(d.amount)}</b></td></tr>
<tr><td>Приложение</td><td>________________________________________________</td></tr>
${receipt ? '' : '<tr><td>Предъявленный документ</td><td>________________________________________________</td></tr>'}
</table>
${amountWords(d.amount, currency)}`;
}

export function renderKzCashOrder(d: CashOrderData): string {
  const receipt = d.form === 'kz_pko';
  const title = receipt ? 'Приходный кассовый ордер' : 'Расходный кассовый ордер';
  const o = d.organization;
  return moneyPage(title, `
${header(title, d.number, d.date, receipt ? 'КО-1' : 'КО-2')}
<table class="grid">
${partyRows('Организация', o)}
${d.party ? partyRows(receipt ? 'Вноситель' : 'Получатель', d.party) : ''}
</table>
${cashFields(receipt ? 'Принято от' : 'Выдать', d, receipt)}
${receipt ? signatures(['Главный бухгалтер', o.accountantName], ['Кассир']) :
    signatures(['Руководитель', o.directorName], ['Главный бухгалтер', o.accountantName], ['Получил', d.personName], ['Кассир'])}
${receipt ? `<div style="border-top:1px dashed;margin-top:18px;padding-top:8px">
<h2 class="center">Квитанция к приходному кассовому ордеру</h2>
<p>${shown(o.fullName || o.name)} · № ${shown(d.number)} от ${esc(dateRu(d.date))}</p>
${cashFields('Принято от', d, true)}
${signatures(['Главный бухгалтер', o.accountantName], ['Кассир'])}
</div>` : ''}`, !d.number);
}

export function renderKzPaymentOrder(d: PaymentOrderData): string {
  const title = 'Платёжное поручение';
  const o = d.organization;
  const currency = d.currency || 'KZT';
  return moneyPage(title, `
${header(title, d.number, d.date)}
<table class="grid">
${partyRows('Отправитель денег', d.payer, d.payerBank)}
${partyRows('Бенефициар', d.payee, d.payeeBank)}
<tr><td colspan="2">Сумма, ${esc(currency)}: <b>${money(d.amount)}</b></td><td colspan="2">Дата валютирования: ____________</td></tr>
<tr><td colspan="4">Назначение платежа: ${shown(d.purpose)}</td></tr>
<tr><td colspan="2">КНП: ${shown(d.payee.requisites?.knp || d.payer.requisites?.knp)}</td><td colspan="2">КБК: ____________</td></tr>
</table>
${amountWords(d.amount, currency)}
${signatures(['Руководитель', o.directorName], ['Главный бухгалтер', o.accountantName], ['Отметки банка'])}`, !d.number);
}
