/* Печатные формы актов выполненных работ (задача 1273, docs/architecture/construction.md):
   КС-2 «Акт о приёмке выполненных работ» и КС-3 «Справка о стоимости выполненных работ и затрат».
   Чистые функции «данные → HTML», по-русски, A4 портрет; суммы — через moneyRu и amountInWordsRu, без float. */
import { amountInWordsRu } from '../ru';
import { dateRu, esc, moneyRu, qtyRu } from './templates';
import { moneyPage } from './payments';
import type { PrintOrganization, PrintParty } from './types';

/** Строка таблицы КС-2: работа, единица, количество, цена и стоимость без НДС */
export interface Ks2Line {
  n: number;
  name: string;
  /** Код и обозначение единицы измерения (ОКЕИ) */
  unitCode: string;
  unitSymbol: string;
  qty: string;
  price: string;
  /** Стоимость без НДС */
  amount: string;
}

export interface Ks2Data {
  /** Номер акта; пусто — черновик */
  number: string;
  /** Дата акта, YYYY-MM-DD */
  actDate: string;
  /** Подрядчик — наша организация */
  organization: PrintOrganization;
  /** Заказчик */
  customer: PrintParty;
  objectName: string;
  objectAddress: string;
  /** Договор: «Договор № 12 от 01.09.2026» или пусто */
  contractLabel: string;
  periodFrom: string;
  periodTo: string;
  lines: Ks2Line[];
  /** Итого без НДС */
  net: string;
  vat: string;
  /** Всего с НДС */
  total: string;
  note: string;
  /** Подписан заказчиком: на черновике печатается пометка «ЧЕРНОВИК» */
  signed: boolean;
}

const contractLine = (label: string) => (label ? `Договор (контракт): ${esc(label)}` : 'Договор (контракт): —');

/** КС-2: акт о приёмке выполненных работ (унифицированная форма № КС-2) */
export function renderKs2(d: Ks2Data): string {
  const o = d.organization;
  const rows = d.lines
    .map(
      l =>
        `<tr><td class="center">${l.n}</td><td>${esc(l.name)}</td><td class="center">—</td><td class="center">${esc(l.unitSymbol)}</td><td class="right">${qtyRu(l.qty)}</td><td class="right">${moneyRu(l.price)}</td><td class="right">${moneyRu(l.amount)}</td></tr>`,
    )
    .join('');
  const title = d.number ? `Акт о приёмке выполненных работ № ${esc(d.number)} от ${esc(dateRu(d.actDate))}` : `Акт о приёмке выполненных работ (черновик) от ${esc(dateRu(d.actDate))}`;
  const party = (label: string, value: string) => `<tr><td style="width:170px">${label}</td><td>${value}</td></tr>`;
  const sign = (label: string, name: string) => `<td><b>${label}</b><br><span class="line"></span> / ${esc(name || '________________')} /<br><span class="small">(подпись) (расшифровка подписи)</span></td>`;
  return moneyPage(
    'Акт о приёмке выполненных работ (КС-2)',
    `<table class="plain"><tr><td class="right small">Унифицированная форма № КС-2<br>Утверждена постановлением Госкомстата России от 11.11.99 № 100<br>Форма по ОКУД 0322005</td></tr></table>
<h1 class="center" style="margin-top:6px">${title}</h1>
<table class="plain" style="margin-top:6px">
${party('Инвестор', '—')}
${party('Заказчик', `${esc(d.customer.fullName || d.customer.name)}${d.customer.inn ? `, ИНН ${esc(d.customer.inn)}` : ''}`)}
${party('Подрядчик', `${esc(o.fullName || o.name)}${o.inn ? `, ИНН ${esc(o.inn)}` : ''}`)}
${party('Объект', `${esc(d.objectName)}${d.objectAddress ? `, ${esc(d.objectAddress)}` : ''}`)}
${party('Договор (контракт)', contractLine(d.contractLabel).replace('Договор (контракт): ', ''))}
${party('Отчётный период', `с ${esc(dateRu(d.periodFrom))} по ${esc(dateRu(d.periodTo))}`)}
</table>
<p class="small" style="margin:8px 0 4px">Акт составлен в том, что подрядчиком выполнены работы, указанные в таблице. Стоимость работ указана без НДС.</p>
<table class="grid"><thead>
<tr><th rowspan="2" style="width:34px">№ п/п</th><th rowspan="2">Наименование работ</th><th rowspan="2" style="width:64px">Номер единичной расценки</th><th colspan="2">Единица измерения</th><th rowspan="2" style="width:72px">Количество</th><th rowspan="2" style="width:92px">Цена за единицу, руб.</th><th rowspan="2" style="width:100px">Стоимость, руб.</th></tr>
<tr><th style="width:44px">обозначение</th><th style="width:40px">код</th></tr>
</thead><tbody>${rows}
<tr class="bold"><td colspan="7" class="right">Итого без НДС</td><td class="right">${moneyRu(d.net)}</td></tr>
<tr class="bold"><td colspan="7" class="right">Сумма НДС</td><td class="right">${d.vat === '0.00' ? 'без НДС' : moneyRu(d.vat)}</td></tr>
<tr class="bold"><td colspan="7" class="right">Всего с НДС</td><td class="right">${moneyRu(d.total)}</td></tr>
</tbody></table>
<div class="words">Всего наименований ${d.lines.length}, на сумму <b>${moneyRu(d.total)}</b> руб.<br><b>${esc(amountInWordsRu(d.total))}</b></div>
${d.note ? `<div class="party small">${esc(d.note)}</div>` : ''}
<table class="sign plain" style="margin-top:22px"><tr>
${sign('Сдал (подрядчик)', o.directorName)}
${sign(`Принял (заказчик)${d.signed ? ' — принято' : ''}`, '')}
</tr></table>`,
    !d.signed,
  );
}

/** Итоги одного разреза справки КС-3: без НДС, НДС и всего с НДС */
export interface Ks3Amounts {
  net: string;
  vat: string;
  total: string;
}

export interface Ks3Data {
  number: string;
  actDate: string;
  organization: PrintOrganization;
  customer: PrintParty;
  objectName: string;
  objectAddress: string;
  contractLabel: string;
  periodFrom: string;
  periodTo: string;
  /** С начала проведения работ (все принятые акты до конца периода) */
  sinceStart: Ks3Amounts;
  /** С начала года периода */
  sinceYear: Ks3Amounts;
  /** В том числе за отчётный период (этот акт) */
  period: Ks3Amounts;
  note: string;
  signed: boolean;
}

/** КС-3: справка о стоимости выполненных работ и затрат (унифицированная форма № КС-3) */
export function renderKs3(d: Ks3Data): string {
  const o = d.organization;
  const title = d.number ? `Справка о стоимости выполненных работ и затрат № ${esc(d.number)} от ${esc(dateRu(d.actDate))}` : `Справка о стоимости выполненных работ (черновик) от ${esc(dateRu(d.actDate))}`;
  const party = (label: string, value: string) => `<tr><td style="width:170px">${label}</td><td>${value}</td></tr>`;
  // колонки — три разреза: с начала работ, с начала года и за отчётный период
  const cols = (label: string, field: keyof Ks3Amounts) =>
    `<tr class="bold"><td>${label}</td><td class="right">${moneyRu(d.sinceStart[field])}</td><td class="right">${moneyRu(d.sinceYear[field])}</td><td class="right">${moneyRu(d.period[field])}</td></tr>`;
  const sign = (label: string, name: string) => `<td><b>${label}</b><br><span class="line"></span> / ${esc(name || '________________')} /<br><span class="small">(подпись) (расшифровка подписи)</span></td>`;
  return moneyPage(
    'Справка о стоимости выполненных работ (КС-3)',
    `<table class="plain"><tr><td class="right small">Унифицированная форма № КС-3<br>Утверждена постановлением Госкомстата России от 11.11.99 № 100<br>Форма по ОКУД 0322001</td></tr></table>
<h1 class="center" style="margin-top:6px">${title}</h1>
<table class="plain" style="margin-top:6px">
${party('Заказчик', `${esc(d.customer.fullName || d.customer.name)}${d.customer.inn ? `, ИНН ${esc(d.customer.inn)}` : ''}`)}
${party('Подрядчик', `${esc(o.fullName || o.name)}${o.inn ? `, ИНН ${esc(o.inn)}` : ''}`)}
${party('Объект', `${esc(d.objectName)}${d.objectAddress ? `, ${esc(d.objectAddress)}` : ''}`)}
${party('Договор (контракт)', contractLine(d.contractLabel).replace('Договор (контракт): ', ''))}
${party('Отчётный период', `с ${esc(dateRu(d.periodFrom))} по ${esc(dateRu(d.periodTo))}`)}
</table>
<table class="grid" style="margin-top:8px"><thead>
<tr><th rowspan="2">Наименование работ и затрат</th><th colspan="3">Стоимость выполненных работ и затрат, руб.</th></tr>
<tr><th style="width:120px">с начала проведения работ</th><th style="width:110px">с начала года</th><th style="width:130px">в том числе за отчётный период</th></tr>
</thead><tbody>
${cols('Всего работ и затрат без НДС', 'net')}
${cols('в том числе НДС', 'vat')}
${cols('Всего с учётом НДС', 'total')}
</tbody></table>
<div class="words">Всего с НДС за отчётный период: <b>${moneyRu(d.period.total)}</b> руб.<br><b>${esc(amountInWordsRu(d.period.total))}</b></div>
${d.note ? `<div class="party small">${esc(d.note)}</div>` : ''}
<table class="sign plain" style="margin-top:22px"><tr>
${sign('Подрядчик (сдал)', o.directorName)}
${sign(`Заказчик (принял)${d.signed ? ' — принято' : ''}`, '')}
</tr></table>`,
    !d.signed,
  );
}
