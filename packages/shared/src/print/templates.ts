/* HTML-шаблоны печатных форм: счёт на оплату, УПД, акт оказания услуг, ТОРГ-12. Чистые функции «данные → HTML-строка»:
   одни и те же страницы показываются в браузере (предпросмотр + window.print) и превращаются в PDF в воркере (headless Chromium).
   Формат A4, поля и разрывы страниц заданы в @page и CSS-правилах break-*; шапка таблицы повторяется на каждой странице. */
import { dec, div, fmt, mul } from '../decimal';
import { DOCUMENT_LABELS_RU, type PrintForm } from '../documents';
import { amountInWordsRu, numberToWordsRu } from '../ru';
import type { FileRef } from '../schemas/documents';
import type { PrintData, PrintLine, PrintOrganization, PrintParty } from './types';

const NBSP = ' ';

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** «1234.5» → «1 234,50» (неразрывные пробелы) */
export function moneyRu(v: string | number): string {
  const s = String(v);
  const neg = s.startsWith('-');
  const [i = '0', f = '00'] = (neg ? s.slice(1) : s).split('.');
  return (neg ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) + ',' + f.padEnd(2, '0').slice(0, 2);
}

/** «2.000» → «2», «2.500» → «2,5» */
export function qtyRu(v: string): string {
  const s = String(v).includes('.') ? String(v).replace(/0+$/, '').replace(/\.$/, '') : String(v);
  return s.replace('.', ',');
}

export const dateRu = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso);

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const dateLongRu = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)} г.`;

const vatLabel = (rate: string) => (rate === 'none' ? 'без НДС' : `${rate}%`);
const vatSum = (l: PrintLine) => (l.vatRate === 'none' ? 'без НДС' : moneyRu(l.vatAmount));
/** Цена единицы без НДС после скидки (для УПД и ТОРГ-12, где цена всегда без налога) */
const unitNet = (l: PrintLine) => moneyRu(fmt(div(dec(l.net), dec(l.qty) || 1n), 2));
/** Цена единицы так, как она входит в «Сумму» счёта и акта: с НДС при «НДС в т.ч.», без — при «НДС сверху» */
const unitEff = (l: PrintLine, includesVat: boolean) => moneyRu(fmt(div(dec(includesVat ? l.total : l.net), dec(l.qty) || 1n), 2));

const pageTitle = (d: PrintData) => `${DOCUMENT_LABELS_RU[d.type]} ${d.number ?? '(черновик)'}`;

function partyLine(p: PrintParty, withBank = false): string {
  const parts = [p.fullName || p.name, p.inn && `ИНН ${p.inn}`, p.kpp && `КПП ${p.kpp}`, p.address, p.phone && `тел.: ${p.phone}`];
  if (withBank && p.bank) parts.push(`р/с ${p.bank.account} в ${p.bank.bankName}, БИК ${p.bank.bik}${p.bank.corrAccount ? `, к/с ${p.bank.corrAccount}` : ''}`);
  return parts.filter(Boolean).map(esc).join(', ');
}

function image(f: FileRef, cls: string, alt: string): string {
  return f && f.url ? `<img class="${cls}" src="${esc(f.url)}" alt="${esc(alt)}">` : '';
}

function numberTitle(d: PrintData, title: string): string {
  return d.number ? `${title} № ${esc(d.number)} от ${esc(dateRu(d.date))}` : `${title} (черновик, номер будет присвоен при проведении) от ${esc(dateRu(d.date))}`;
}

const BASE_CSS = `
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#fff;color:#000;font:11px/1.35 "Liberation Sans",Arial,Helvetica,sans-serif}
.sheet{padding:0}
h1{font-size:15px;margin:0 0 6px;font-weight:700}
h2{font-size:13px;margin:0 0 4px}
.bold{font-weight:700}.right{text-align:right}.center{text-align:center}.small{font-size:9px}.nowrap{white-space:nowrap}
table{border-collapse:collapse;width:100%}
td,th{vertical-align:top}
table.grid td,table.grid th{border:1px solid #000;padding:2px 4px}
table.grid th{text-align:center;font-weight:700;background:#f2f2f2}
table.grid thead{display:table-header-group}
table.grid tr{break-inside:avoid;page-break-inside:avoid}
table.plain td{padding:1px 4px}
.hr{border-top:2px solid #000;margin:6px 0}
.party{margin:3px 0}
.party b{display:inline-block;min-width:110px}
.sign{break-inside:avoid;page-break-inside:avoid;margin-top:18px}
.sign td{padding:4px 6px;vertical-align:bottom}
.line{display:inline-block;border-bottom:1px solid #000;min-width:130px;height:30px;position:relative;vertical-align:bottom}
.line img.sig{position:absolute;left:4px;bottom:0;max-height:34px;max-width:120px}
.stamp{position:absolute;max-height:100px;max-width:100px;opacity:.9}
.totals{break-inside:avoid;page-break-inside:avoid}
.totals td{padding:1px 4px;text-align:right}
.words{margin:8px 0;break-inside:avoid;page-break-inside:avoid}
.draft{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:90px;color:rgba(200,0,0,.12);transform:rotate(-20deg);pointer-events:none}
`;

const html = (d: PrintData, orientation: 'portrait' | 'landscape', body: string) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(pageTitle(d))}</title>
<style>
@page{size:A4 ${orientation};margin:${orientation === 'portrait' ? '12mm 10mm' : '10mm 8mm'}}
${BASE_CSS}
@media screen{body{background:#e9e9ec}.sheet{background:#fff;margin:12px auto;padding:${orientation === 'portrait' ? '12mm 10mm' : '10mm 8mm'};width:${orientation === 'portrait' ? '210mm' : '297mm'};min-height:${orientation === 'portrait' ? '297mm' : '210mm'};box-shadow:0 1px 6px rgba(0,0,0,.25)}}
</style></head>
<body><div class="sheet">${d.number ? '' : '<div class="draft">ЧЕРНОВИК</div>'}${body}</div></body></html>`;

/* ---------------- подписи ---------------- */

function signBlock(o: PrintOrganization, withStamp = true): string {
  return `<table class="sign plain"><tr>
<td class="nowrap"><b>${esc(o.directorTitle || 'Руководитель')}</b></td>
<td><span class="line">${image(o.directorSignatureFile, 'sig', 'Подпись руководителя')}</span></td>
<td>/ ${esc(o.directorName || '________________')} /</td>
<td class="nowrap"><b>Главный бухгалтер</b></td>
<td><span class="line">${image(o.accountantSignatureFile, 'sig', 'Подпись бухгалтера')}</span></td>
<td>/ ${esc(o.accountantName || o.directorName || '________________')} /</td>
${withStamp ? `<td style="position:relative;width:110px">${image(o.stampFile, 'stamp', 'Печать') || '<span class="small">М.П.</span>'}</td>` : ''}
</tr></table>`;
}

/* ---------------- счёт на оплату (и коммерческое предложение / заказ в том же виде) ---------------- */

function invoiceForm(d: PrintData): string {
  const o = d.organization;
  const b = o.bank;
  const title = d.type === 'quote' ? 'Коммерческое предложение' : d.type === 'customer_order' ? 'Заказ покупателя' : 'Счёт на оплату';
  const rows = d.lines
    .map(
      l => `<tr><td class="center">${l.n}</td><td>${l.sku ? `<span class="small">${esc(l.sku)}</span> ` : ''}${esc(l.name)}</td><td class="right">${qtyRu(l.qty)}</td><td class="center">${esc(l.unitSymbol)}</td><td class="right">${unitEff(l, d.priceIncludesVat)}</td><td class="right">${moneyRu(d.priceIncludesVat ? l.total : l.net)}</td></tr>`,
    )
    .join('');
  const t = d.totals;
  const sumLabel = d.priceIncludesVat ? 'Итого' : 'Итого (без НДС)';
  const vatLabelText = d.priceIncludesVat ? 'В том числе НДС' : 'Сумма НДС';
  const vatText = d.lines.every(l => l.vatRate === 'none') ? 'Без НДС' : moneyRu(t.vat);
  const basis = d.basedOn ? `<div class="party"><b>Основание:</b> ${esc(DOCUMENT_LABELS_RU[d.basedOn.type])}${d.basedOn.number ? ` № ${esc(d.basedOn.number)}` : ''} от ${esc(dateRu(d.basedOn.date))}</div>` : '';
  return html(
    d,
    'portrait',
    `<table class="grid" style="margin-bottom:10px">
<tr><td colspan="2" rowspan="2" style="width:56%">${esc(b?.bankName ?? '')}<div class="small">Банк получателя</div></td><td style="width:8%">БИК</td><td>${esc(b?.bik ?? '')}</td></tr>
<tr><td>Сч. №</td><td>${esc(b?.corrAccount ?? '')}</td></tr>
<tr><td style="width:24%">ИНН ${esc(o.inn)}</td><td style="width:24%">КПП ${esc(o.kpp)}</td><td rowspan="2">Сч. №</td><td rowspan="2">${esc(b?.account ?? '')}</td></tr>
<tr><td colspan="2">${esc(o.fullName || o.name)}<div class="small">Получатель</div></td></tr>
</table>
<h1>${numberTitle(d, title)}</h1><div class="hr"></div>
<div class="party"><b>${d.type === 'quote' ? 'Поставщик:' : 'Поставщик:'}</b> ${partyLine(o)}</div>
<div class="party"><b>Покупатель:</b> ${partyLine(d.party)}</div>
${basis}
${d.dueDate ? `<div class="party"><b>${d.type === 'quote' ? 'Действительно до:' : 'Оплатить до:'}</b> ${esc(dateRu(d.dueDate))}</div>` : ''}
<table class="grid" style="margin-top:8px"><thead><tr><th style="width:28px">№</th><th>Товары (работы, услуги)</th><th style="width:56px">Кол-во</th><th style="width:40px">Ед.</th><th style="width:84px">Цена</th><th style="width:92px">Сумма</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals" style="margin-top:4px"><tr><td class="bold">${sumLabel}:</td><td class="bold" style="width:100px">${moneyRu(d.priceIncludesVat ? t.total : t.net)}</td></tr>
<tr><td class="bold">${vatLabelText}:</td><td class="bold">${vatText}</td></tr>
<tr><td class="bold">Всего к оплате:</td><td class="bold">${moneyRu(t.total)}</td></tr></table>
<div class="words">Всего наименований ${d.lines.length}, на сумму ${moneyRu(t.total)} руб.<br><b>${esc(amountInWordsRu(t.total))}</b></div>
${d.comment ? `<div class="party small">${esc(d.comment)}</div>` : ''}
${signBlock(o)}`,
  );
}

/* ---------------- акт оказания услуг ---------------- */

function actForm(d: PrintData): string {
  const o = d.organization;
  const t = d.totals;
  const rows = d.lines
    .map(l => `<tr><td class="center">${l.n}</td><td>${esc(l.name)}</td><td class="right">${qtyRu(l.qty)}</td><td class="center">${esc(l.unitSymbol)}</td><td class="right">${unitEff(l, d.priceIncludesVat)}</td><td class="right">${moneyRu(d.priceIncludesVat ? l.total : l.net)}</td></tr>`)
    .join('');
  const vatText = d.lines.every(l => l.vatRate === 'none') ? 'Без НДС' : moneyRu(t.vat);
  const basis = d.basedOn ? `<p>Основание: ${esc(DOCUMENT_LABELS_RU[d.basedOn.type])}${d.basedOn.number ? ` № ${esc(d.basedOn.number)}` : ''} от ${esc(dateRu(d.basedOn.date))}.</p>` : '';
  return html(
    d,
    'portrait',
    `<h1 class="center">${numberTitle(d, 'Акт оказания услуг')}</h1>
<p>Исполнитель: ${partyLine(o)}.</p>
<p>Заказчик: ${partyLine(d.party)}.</p>
${basis}
<p>Мы, нижеподписавшиеся, представитель Исполнителя ${esc(o.directorTitle || 'руководитель')} ${esc(o.directorName)}, с одной стороны, и представитель Заказчика, с другой стороны, составили настоящий акт о том, что Исполнитель оказал следующие услуги:</p>
<table class="grid"><thead><tr><th style="width:28px">№</th><th>Наименование работ, услуг</th><th style="width:56px">Кол-во</th><th style="width:40px">Ед.</th><th style="width:84px">Цена</th><th style="width:92px">Сумма</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals" style="margin-top:4px"><tr><td class="bold">${d.priceIncludesVat ? 'Итого' : 'Итого (без НДС)'}:</td><td class="bold" style="width:100px">${moneyRu(d.priceIncludesVat ? t.total : t.net)}</td></tr>
<tr><td class="bold">${d.priceIncludesVat ? 'В том числе НДС' : 'Сумма НДС'}:</td><td class="bold">${vatText}</td></tr>
<tr><td class="bold">Всего:</td><td class="bold">${moneyRu(t.total)}</td></tr></table>
<div class="words">Всего оказано услуг ${d.lines.length}, на сумму ${moneyRu(t.total)} руб.<br><b>${esc(amountInWordsRu(t.total))}</b></div>
<p>Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.</p>
<table class="sign plain" style="margin-top:28px"><tr>
<td style="width:50%"><b>ИСПОЛНИТЕЛЬ</b><br>${esc(o.fullName || o.name)}<br><br><span class="line">${image(o.directorSignatureFile, 'sig', 'Подпись')}</span> / ${esc(o.directorName)} /<div style="position:relative;height:0">${image(o.stampFile, 'stamp', 'Печать')}</div></td>
<td style="width:50%"><b>ЗАКАЗЧИК</b><br>${esc(d.party.fullName || d.party.name)}<br><br><span class="line"></span> / ______________ /</td></tr></table>`,
  );
}

/* ---------------- УПД ---------------- */

function updForm(d: PrintData): string {
  const o = d.organization;
  const t = d.totals;
  const status = o.taxSystem === 'osn' ? 1 : 2;
  const rows = d.lines
    .map(
      l => `<tr><td class="center">${l.n}</td><td class="center">${esc(l.sku)}</td><td>${esc(l.name)}</td><td class="center"></td><td class="center">${esc(l.unitCode)}</td><td class="center">${esc(l.unitSymbol)}</td><td class="right">${qtyRu(l.qty)}</td><td class="right">${unitNet(l)}</td><td class="right">${moneyRu(l.net)}</td><td class="center">без акциза</td><td class="center">${vatLabel(l.vatRate)}</td><td class="right">${vatSum(l)}</td><td class="right">${moneyRu(l.total)}</td><td class="center">—</td><td class="center">—</td><td class="center">—</td></tr>`,
    )
    .join('');
  const basis = d.basedOn ? `${esc(DOCUMENT_LABELS_RU[d.basedOn.type])}${d.basedOn.number ? ` № ${esc(d.basedOn.number)}` : ''} от ${esc(dateRu(d.basedOn.date))}` : '—';
  const head = (label: string, value: string) => `<tr><td style="width:190px">${label}</td><td>${value}</td></tr>`;
  return html(
    d,
    'landscape',
    `<table class="plain"><tr><td style="width:150px" class="small">Универсальный передаточный документ<br>Статус: <b>${status}</b><br><span class="small">${status === 1 ? '1 — счёт-фактура и передаточный документ (акт)' : '2 — передаточный документ (акт)'}</span></td>
<td><h1 style="margin:0">${d.number ? `Счёт-фактура № ${esc(d.number)} от ${esc(dateRu(d.date))}` : `Счёт-фактура (черновик) от ${esc(dateRu(d.date))}`}</h1>
<div class="small">Исправление № — от —</div></td></tr></table>
<table class="plain" style="margin-top:4px">
${head('Продавец:', partyLine(o))}
${head('Грузоотправитель и его адрес:', 'он же')}
${head('Грузополучатель и его адрес:', esc(d.party.fullName || d.party.name) + (d.party.address ? ', ' + esc(d.party.address) : ''))}
${head('К платёжно-расчётному документу №:', '—')}
${head('Покупатель:', partyLine(d.party))}
${head('Валюта: наименование, код', 'Российский рубль, 643')}
${head('Основание передачи (сдачи) / получения (приёмки):', basis)}
</table>
<table class="grid" style="margin-top:6px"><thead>
<tr><th rowspan="2" style="width:24px">№ п/п</th><th rowspan="2" style="width:70px">Код товара/ работ, услуг</th><th rowspan="2">Наименование товара (описание выполненных работ, оказанных услуг), имущественного права</th><th rowspan="2" style="width:50px">Код вида товара</th><th colspan="2">Единица измерения</th><th rowspan="2" style="width:50px">Количество (объём)</th><th rowspan="2" style="width:70px">Цена (тариф) за единицу измерения</th><th rowspan="2" style="width:82px">Стоимость товаров без налога — всего</th><th rowspan="2" style="width:50px">В том числе сумма акциза</th><th rowspan="2" style="width:48px">Налоговая ставка</th><th rowspan="2" style="width:72px">Сумма налога, предъявляемая покупателю</th><th rowspan="2" style="width:82px">Стоимость товаров с налогом — всего</th><th colspan="2">Страна происхождения</th><th rowspan="2" style="width:56px">Номер таможенной декларации</th></tr>
<tr><th style="width:40px">код</th><th style="width:40px">усл. обозн.</th><th style="width:40px">цифр. код</th><th style="width:70px">краткое наименование</th></tr>
</thead><tbody>${rows}
<tr class="bold"><td colspan="8" class="right">Всего к оплате</td><td class="right">${moneyRu(t.net)}</td><td class="center">X</td><td class="center">X</td><td class="right">${d.lines.every(l => l.vatRate === 'none') ? 'без НДС' : moneyRu(t.vat)}</td><td class="right">${moneyRu(t.total)}</td><td colspan="3"></td></tr>
</tbody></table>
<div class="words">Всего к оплате: <b>${esc(amountInWordsRu(t.total))}</b></div>
<table class="sign plain"><tr>
<td style="width:50%"><b>Руководитель организации</b> или иное уполномоченное лицо<br><span class="line">${image(o.directorSignatureFile, 'sig', 'Подпись')}</span> / ${esc(o.directorName)} /<br><span class="small">(подпись) (ф. и. о.)</span></td>
<td style="width:50%"><b>Главный бухгалтер</b> или иное уполномоченное лицо<br><span class="line">${image(o.accountantSignatureFile, 'sig', 'Подпись')}</span> / ${esc(o.accountantName || o.directorName)} /<br><span class="small">(подпись) (ф. и. о.)</span></td></tr>
<tr><td><b>Товар (груз) передал</b> / услуги, результаты работ, права сдал<br><span class="line"></span> / ${esc(o.directorName)} /<div style="position:relative;height:0">${image(o.stampFile, 'stamp', 'Печать')}</div><br><span class="small">Дата отгрузки, передачи (сдачи): ${esc(dateRu(d.date))}</span></td>
<td><b>Товар (груз) получил</b> / услуги, результаты работ, права принял<br><span class="line"></span> / ______________ /<br><span class="small">Дата получения (приёмки): «___» ____________ 20__ г.</span></td></tr></table>`,
  );
}

/* ---------------- ТОРГ-12 ---------------- */

function torg12Form(d: PrintData): string {
  const o = d.organization;
  const t = d.totals;
  const rows = d.lines
    .map(
      l => `<tr><td class="center">${l.n}</td><td>${esc(l.name)}</td><td class="center">${esc(l.sku)}</td><td class="center">${esc(l.unitSymbol)}</td><td class="center">${esc(l.unitCode)}</td><td></td><td></td><td></td><td></td><td class="right">${qtyRu(l.qty)}</td><td class="right">${unitNet(l)}</td><td class="right">${moneyRu(l.net)}</td><td class="center">${vatLabel(l.vatRate)}</td><td class="right">${vatSum(l)}</td><td class="right">${moneyRu(l.total)}</td></tr>`,
    )
    .join('');
  const totalQty = fmt(d.lines.reduce((s, l) => s + dec(l.qty), 0n), 3);
  const basis = d.basedOn ? `${esc(DOCUMENT_LABELS_RU[d.basedOn.type])}${d.basedOn.number ? ` № ${esc(d.basedOn.number)}` : ''} от ${esc(dateRu(d.basedOn.date))}` : '';
  const person = (label: string, name: string) => `<td><b>${label}</b><br><span class="line"></span> / ${esc(name)} /<br><span class="small">(должность) (подпись) (расшифровка подписи)</span></td>`;
  return html(
    d,
    'landscape',
    `<table class="plain"><tr><td class="right small">Унифицированная форма № ТОРГ-12<br>Утверждена постановлением Госкомстата России от 25.12.98 № 132</td></tr></table>
<table class="plain">
<tr><td style="width:150px">Грузоотправитель</td><td>${partyLine(o, true)}</td><td style="width:120px" class="right">Форма по ОКУД 0330212</td></tr>
<tr><td>Грузополучатель</td><td>${partyLine(d.party)}</td><td></td></tr>
<tr><td>Поставщик</td><td>${partyLine(o, true)}</td><td></td></tr>
<tr><td>Плательщик</td><td>${partyLine(d.party, true)}</td><td></td></tr>
<tr><td>Основание</td><td>${basis}</td><td></td></tr>
</table>
<table class="plain" style="margin:6px 0"><tr><td style="width:60%"></td><td class="center bold">Номер документа</td><td class="center bold">Дата составления</td></tr>
<tr><td class="right bold" style="font-size:15px">ТОВАРНАЯ НАКЛАДНАЯ</td><td class="center" style="border:1px solid #000">${esc(d.number ?? '—')}</td><td class="center" style="border:1px solid #000">${esc(dateRu(d.date))}</td></tr></table>
<table class="grid"><thead>
<tr><th rowspan="2" style="width:30px">Но-мер по по-рядку</th><th colspan="2">Товар</th><th colspan="2">Единица измерения</th><th rowspan="2" style="width:44px">Вид упаковки</th><th colspan="2">Количество</th><th rowspan="2" style="width:50px">Масса брутто</th><th rowspan="2" style="width:56px">Количество (масса нетто)</th><th rowspan="2" style="width:68px">Цена, руб. коп.</th><th rowspan="2" style="width:84px">Сумма без учёта НДС, руб. коп.</th><th colspan="2">НДС</th><th rowspan="2" style="width:84px">Сумма с учётом НДС, руб. коп.</th></tr>
<tr><th>наименование, характеристика, сорт, артикул товара</th><th style="width:60px">код</th><th style="width:46px">наимено-вание</th><th style="width:44px">код по ОКЕИ</th><th style="width:46px">в одном месте</th><th style="width:46px">мест, штук</th><th style="width:46px">ставка, %</th><th style="width:72px">сумма, руб. коп.</th></tr>
<tr>${Array.from({ length: 15 }, (_, i) => `<th class="small">${i + 1}</th>`).join('')}</tr>
</thead><tbody>${rows}
<tr class="bold"><td colspan="8" class="right">Итого</td><td></td><td class="right">${qtyRu(totalQty)}</td><td class="center">X</td><td class="right">${moneyRu(t.net)}</td><td class="center">X</td><td class="right">${d.lines.every(l => l.vatRate === 'none') ? 'без НДС' : moneyRu(t.vat)}</td><td class="right">${moneyRu(t.total)}</td></tr>
</tbody></table>
<div class="words">Товарная накладная имеет приложение на ___ листах и содержит <b>${esc(numberToWordsRu(d.lines.length, 'm'))}</b> порядковых номеров записей.<br>
Всего отпущено <b>${esc(numberToWordsRu(d.lines.length, 'm'))}</b> наименований на сумму: <b>${esc(amountInWordsRu(t.total))}</b></div>
<table class="sign plain"><tr>
${person('Отпуск груза разрешил', o.directorName)}
${person('Главный (старший) бухгалтер', o.accountantName || o.directorName)}
</tr><tr>
<td><b>Груз принял</b><br><span class="line"></span> / ______________ /</td>
<td style="position:relative"><b>Отпуск груза произвёл</b><br><span class="line">${image(o.directorSignatureFile, 'sig', 'Подпись')}</span> / ${esc(o.directorName)} /<div style="position:relative;height:0">${image(o.stampFile, 'stamp', 'Печать')}</div><br><span class="small">М.П. «${esc(d.date.slice(8, 10))}» ${esc(MONTHS[Number(d.date.slice(5, 7)) - 1] ?? '')} ${esc(d.date.slice(0, 4))} года</span></td>
</tr></table>`,
  );
}

/* ---------------- заказ-наряд (бланк приёма заказа) ---------------- */

function workOrderForm(d: PrintData): string {
  const o = d.organization;
  const t = d.totals;
  const w = d.workOrder;
  const rows = d.lines
    .map(l => `<tr><td class="center">${l.n}</td><td>${l.sku ? `<span class="small">${esc(l.sku)}</span> ` : ''}${esc(l.name)}</td><td class="right">${qtyRu(l.qty)}</td><td class="center">${esc(l.unitSymbol)}</td><td class="right">${unitEff(l, d.priceIncludesVat)}</td><td class="right">${moneyRu(d.priceIncludesVat ? l.total : l.net)}</td></tr>`)
    .join('');
  const materials = (w?.materials ?? []).map(m => `<tr><td class="center">${m.n}</td><td>${esc(m.name)}</td><td class="right">${qtyRu(m.qty)}</td><td class="center">${esc(m.unitSymbol)}</td></tr>`).join('');
  const assignees = (w?.assignees ?? []).map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.workCenterName ?? '—')}</td><td class="right">${a.plannedHours ? qtyRu(a.plannedHours) : '—'}</td><td class="center">${a.startDate ? esc(dateRu(a.startDate)) : '—'}</td><td class="center">${a.dueDate ? esc(dateRu(a.dueDate)) : '—'}</td></tr>`).join('');
  const vatText = d.lines.every(l => l.vatRate === 'none') ? 'Без НДС' : moneyRu(t.vat);
  return html(
    d,
    'portrait',
    `<h1 class="center">${numberTitle(d, 'Заказ-наряд')}</h1>
<table class="plain">
<tr><td style="width:150px">Исполнитель</td><td>${partyLine(o)}</td></tr>
<tr><td>Заказчик</td><td>${partyLine(d.party)}</td></tr>
<tr><td>Вид заказ-наряда</td><td>${esc(w?.kindName ?? '—')}</td></tr>
<tr><td>Состояние</td><td>${esc(w?.stateLabel ?? '—')}</td></tr>
<tr><td>Склад</td><td>${esc(d.warehouseName ?? '—')}</td></tr>
<tr><td>Плановые работы</td><td>с ${w?.plannedStart ? esc(dateRu(w.plannedStart)) : '—'} по ${w?.plannedEnd ? esc(dateRu(w.plannedEnd)) : '—'}</td></tr>
</table>
<table class="grid" style="margin-top:8px"><thead><tr><th style="width:28px">№</th><th>Работы, услуги и товары</th><th style="width:56px">Кол-во</th><th style="width:40px">Ед.</th><th style="width:84px">Цена</th><th style="width:92px">Сумма</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals" style="margin-top:4px"><tr><td class="bold">${d.priceIncludesVat ? 'Итого' : 'Итого (без НДС)'}:</td><td class="bold" style="width:100px">${moneyRu(d.priceIncludesVat ? t.total : t.net)}</td></tr>
<tr><td class="bold">${d.priceIncludesVat ? 'В том числе НДС' : 'Сумма НДС'}:</td><td class="bold">${vatText}</td></tr>
<tr><td class="bold">Всего:</td><td class="bold">${moneyRu(t.total)}</td></tr></table>
${materials ? `<h2 style="margin-top:10px">Материалы</h2><table class="grid"><thead><tr><th style="width:28px">№</th><th>Наименование</th><th style="width:60px">Кол-во</th><th style="width:44px">Ед.</th></tr></thead><tbody>${materials}</tbody></table>` : ''}
${assignees ? `<h2 style="margin-top:10px">Исполнители</h2><table class="grid"><thead><tr><th>Сотрудник</th><th style="width:120px">Участок</th><th style="width:60px">Часы</th><th style="width:80px">Начало</th><th style="width:80px">Окончание</th></tr></thead><tbody>${assignees}</tbody></table>` : ''}
<div class="words">Всего наименований ${d.lines.length}, на сумму ${moneyRu(t.total)} руб.<br><b>${esc(amountInWordsRu(t.total))}</b></div>
${d.comment ? `<div class="party small">${esc(d.comment)}</div>` : ''}
<table class="sign plain" style="margin-top:18px"><tr>
<td style="width:50%"><b>ИСПОЛНИТЕЛЬ</b><br>${esc(o.fullName || o.name)}<br><br><span class="line">${image(o.directorSignatureFile, 'sig', 'Подпись')}</span> / ${esc(o.directorName)} /</td>
<td style="width:50%"><b>ЗАКАЗЧИК</b><br>${esc(d.party.fullName || d.party.name)}<br><br><span class="line"></span> / ______________ /</td></tr></table>`,
  );
}

export function printOrientation(form: PrintForm): 'portrait' | 'landscape' {
  return form === 'upd' || form === 'torg12' || form === 'torg13' ? 'landscape' : 'portrait';
}

/* ---------------- ИНВ-3: инвентаризационная опись ---------------- */

function inv3Form(d: PrintData): string {
  const o = d.organization;
  const rows = d.lines
    .map(l => {
      const diff = Number(l.diffQty ?? 0);
      const mark = diff < 0 ? 'недостача' : diff > 0 ? 'излишек' : '';
      return `<tr><td class="center">${l.n}</td><td>${esc(l.name)}</td><td class="center">${esc(l.unitSymbol)}</td><td class="right">${qtyRu(l.bookQty ?? '0')}</td><td class="right">${qtyRu(l.qty)}</td><td class="right">${qtyRu(l.diffQty ?? '0')}</td><td class="center">${mark}</td></tr>`;
    })
    .join('');
  const book = d.lines.reduce((s, l) => s + dec(l.bookQty ?? '0'), 0n);
  const fact = d.lines.reduce((s, l) => s + dec(l.qty), 0n);
  const diff = fact - book;
  const person = (label: string, name: string) => `<td><b>${label}</b><br><span class="line"></span> / ${esc(name)} /<br><span class="small">(должность) (подпись) (расшифровка подписи)</span></td>`;
  return html(
    d,
    'portrait',
    `<h1 class="center">${numberTitle(d, 'ИНВ-3. Инвентаризационная опись остатков товаров')}</h1>
<table class="plain"><tr><td style="width:150px">Организация</td><td>${partyLine(o, true)}</td></tr>
<tr><td>Склад</td><td>${esc(d.warehouseName ?? '')}</td></tr>
<tr><td>Вид деятельности</td><td>${esc(d.comment || 'основная деятельность')}</td></tr>
</table>
<table class="grid" style="margin-top:6px"><thead>
<tr><th rowspan="2" style="width:30px">№ п/п</th><th rowspan="2">Наименование товара</th><th rowspan="2" style="width:48px">Ед. изм.</th><th colspan="2">Количество</th><th rowspan="2" style="width:70px">Разница</th><th rowspan="2" style="width:110px">Отметка о расхождении</th></tr>
<tr><th style="width:80px">учётное</th><th style="width:80px">фактическое</th></tr>
</thead><tbody>${rows}
<tr class="bold"><td colspan="3" class="right">Итого</td><td class="right">${qtyRu(fmt(book, 3))}</td><td class="right">${qtyRu(fmt(fact, 3))}</td><td class="right">${qtyRu(fmt(diff, 3))}</td><td></td></tr>
</tbody></table>
<p>Итоговая строка описи: товаров наименований ${d.lines.length}.</p>
<table class="sign plain"><tr>
${person('Председатель комиссии', o.directorName)}
${person('Член комиссии', o.accountantName || o.directorName)}
</tr><tr>
<td><b>Ответственный за хранение</b><br><span class="line"></span> / ______________ /</td>
<td>${d.comment ? `<div class="small">${esc(d.comment)}</div>` : ''}</td>
</tr></table>`,
  );
}

/* ---------------- ТОРГ-16: акт о списании ---------------- */

function torg16Form(d: PrintData): string {
  const o = d.organization;
  const rows = d.lines
    .map(l => `<tr><td class="center">${l.n}</td><td>${esc(l.name)}</td><td class="center">${esc(l.sku)}</td><td class="center">${esc(l.unitSymbol)}</td><td class="right">${qtyRu(l.qty)}</td><td class="right">${moneyRu(l.cost ?? '0')}</td><td class="right">${moneyRu(fmt(mul(dec(l.qty), dec(l.cost ?? '0')), 2))}</td></tr>`)
    .join('');
  const total = d.lines.reduce((s, l) => s + mul(dec(l.qty), dec(l.cost ?? '0')), 0n);
  const person = (label: string, name: string) => `<td><b>${label}</b><br><span class="line"></span> / ${esc(name)} /<br><span class="small">(должность) (подпись) (расшифровка подписи)</span></td>`;
  return html(
    d,
    'portrait',
    `<h1 class="center">${numberTitle(d, 'ТОРГ-16. Акт о списании товаров')}</h1>
<table class="plain"><tr><td style="width:150px">Организация</td><td>${partyLine(o, true)}</td></tr>
<tr><td>Склад</td><td>${esc(d.warehouseName ?? '')}</td></tr>
<tr><td>Статья затрат (доходов)</td><td>${esc(d.costItemName ?? '')}</td></tr>
<tr><td>Основание</td><td>${d.basedOn ? `${esc(DOCUMENT_LABELS_RU[d.basedOn.type])}${d.basedOn.number ? ` № ${esc(d.basedOn.number)}` : ''} от ${esc(dateRu(d.basedOn.date))}` : '—'}</td></tr>
</table>
<table class="grid" style="margin-top:6px"><thead>
<tr><th style="width:30px">№ п/п</th><th>Наименование товара</th><th style="width:70px">Код</th><th style="width:48px">Ед. изм.</th><th style="width:80px">Количество</th><th style="width:90px">Цена по себестоимости</th><th style="width:100px">Сумма</th></tr>
</thead><tbody>${rows}
<tr class="bold"><td colspan="4" class="right">Итого</td><td class="right">${qtyRu(fmt(d.lines.reduce((s, l) => s + dec(l.qty), 0n), 3))}</td><td></td><td class="right">${moneyRu(fmt(total, 2))}</td></tr>
</tbody></table>
<p>Товары списаны по результатам сверки их фактического наличия с учётным. Сумма списания: <b>${moneyRu(fmt(total, 2))}</b> руб.</p>
<table class="sign plain"><tr>
${person('Председатель комиссии', o.directorName)}
${person('Член комиссии', o.accountantName || o.directorName)}
</tr><tr>
<td><b>Главный бухгалтер</b><br><span class="line">${image(o.accountantSignatureFile, 'sig', 'Подпись')}</span> / ${esc(o.accountantName || o.directorName)} /</td>
<td style="position:relative">${person('Ответственный за хранение', '')}<div style="position:relative;height:0">${image(o.stampFile, 'stamp', 'Печать')}</div></td>
</tr></table>`,
  );
}

/* ---------------- ТОРГ-13: накладная на внутреннее перемещение ---------------- */

function torg13Form(d: PrintData): string {
  const o = d.organization;
  const rows = d.lines
    .map(l => `<tr><td class="center">${l.n}</td><td>${esc(l.name)}</td><td class="center">${esc(l.sku)}</td><td class="center">${esc(l.unitSymbol)}</td><td class="center">${esc(l.unitCode)}</td><td class="right">${qtyRu(l.qty)}</td><td class="right">${moneyRu(l.cost ?? '0')}</td><td class="right">${moneyRu(fmt(mul(dec(l.qty), dec(l.cost ?? '0')), 2))}</td></tr>`)
    .join('');
  const total = d.lines.reduce((s, l) => s + mul(dec(l.qty), dec(l.cost ?? '0')), 0n);
  const person = (label: string, name: string) => `<td><b>${label}</b><br><span class="line"></span> / ${esc(name)} /<br><span class="small">(должность) (подпись) (расшифровка подписи)</span></td>`;
  const holder = d.holderName ? `<tr><td>Передано в эксплуатацию</td><td>${esc(d.holderName)}</td></tr>` : '';
  return html(
    d,
    'landscape',
    `<table class="plain"><tr><td class="right small">Унифицированная форма № ТОРГ-13<br>Утверждена постановлением Госкомстата России от 25.12.98 № 132</td></tr></table>
<table class="plain">
<tr><td style="width:150px">Организация</td><td>${partyLine(o, true)}</td><td style="width:140px" class="right">Форма по ОКУД 0330213</td></tr>
<tr><td>Отправитель (склад)</td><td>${esc(d.warehouseName ?? '')}</td><td></td></tr>
<tr><td>Получатель (склад)</td><td>${esc(d.targetWarehouseName ?? '')}</td><td></td></tr>
${holder}
</table>
<table class="plain" style="margin:6px 0"><tr><td style="width:60%"></td><td class="center bold">Номер документа</td><td class="center bold">Дата составления</td></tr>
<tr><td class="right bold" style="font-size:15px">НАКЛАДНАЯ НА ВНУТРЕННЕЕ ПЕРЕМЕЩЕНИЕ</td><td class="center" style="border:1px solid #000">${esc(d.number ?? '—')}</td><td class="center" style="border:1px solid #000">${esc(dateRu(d.date))}</td></tr></table>
<table class="grid"><thead>
<tr><th rowspan="2" style="width:30px">Но-мер по по-рядку</th><th colspan="2">Товар</th><th colspan="2">Единица измерения</th><th colspan="2">Количество</th><th rowspan="2" style="width:80px">Цена по себестоимости</th><th rowspan="2" style="width:100px">Сумма</th></tr>
<tr><th>наименование, характеристика, сорт, артикул товара</th><th style="width:60px">код</th><th>наимено-вание</th><th style="width:44px">код по ОКЕИ</th><th style="width:56px">в одном месте</th><th style="width:56px">мест, штук</th></tr>
</thead><tbody>${rows}
<tr class="bold"><td colspan="6" class="right">Итого</td><td class="right">${moneyRu(fmt(total, 2))}</td></tr>
</tbody></table>
<div class="words">Накладная содержит <b>${esc(numberToWordsRu(d.lines.length, 'm'))}</b> порядковых номеров записей.<br>
Всего перемещено наименований ${d.lines.length} на сумму: <b>${esc(amountInWordsRu(fmt(total, 2)))}</b></div>
<table class="sign plain"><tr>
${person('Отпуск груза разрешил', o.directorName)}
${person('Главный (старший) бухгалтер', o.accountantName || o.directorName)}
</tr><tr>
<td><b>Груз принял</b><br><span class="line"></span> / ______________ /</td>
<td style="position:relative"><b>Отпуск груза произвёл</b><br><span class="line">${image(o.directorSignatureFile, 'sig', 'Подпись')}</span> / ${esc(o.directorName)} /<div style="position:relative;height:0">${image(o.stampFile, 'stamp', 'Печать')}</div></td>
</tr></table>`,
  );
}

/** Страница печатной формы целиком: <!doctype html>… */
export function renderPrintForm(form: PrintForm, data: PrintData): string {
  switch (form) {
    case 'invoice':
      return invoiceForm(data);
    case 'act':
      return actForm(data);
    case 'upd':
      return updForm(data);
    case 'torg12':
      return torg12Form(data);
    case 'inv3':
      return inv3Form(data);
    case 'torg16':
      return torg16Form(data);
    case 'torg13':
      return torg13Form(data);
    case 'work_order':
      return workOrderForm(data);
  }
}
