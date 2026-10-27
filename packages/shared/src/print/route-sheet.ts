/* Печатная форма «Маршрутный лист» курьера на день (задача 1100): адреса, окна, контакты, документы, суммы, подписи.
   Чистая функция «данные → HTML», как формы документов. */
import { dateRu, esc, moneyRu } from './templates';

export interface RouteSheetPrintData {
  /** Дата маршрута, YYYY-MM-DD */
  date: string;
  courierName: string;
  items: { time: string; address: string; contact: string; phone: string; document: string; total: string; comment: string }[];
  total: string;
}

export function renderRouteSheet(d: RouteSheetPrintData): string {
  const rows = d.items
    .map(
      (i, n) =>
        `<tr><td class="center">${n + 1}</td><td class="nowrap">${esc(i.time)}</td><td>${esc(i.address)}</td><td>${esc(i.contact)}<br>${esc(i.phone)}</td><td>${esc(i.document)}</td><td class="right">${moneyRu(i.total)}</td><td>${esc(i.comment)}</td><td style="width:90px"></td></tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Маршрутный лист ${esc(dateRu(d.date))}</title>
<style>
@page{size:A4 landscape;margin:10mm 8mm}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#000;font:11px/1.35 "Liberation Sans",Arial,Helvetica,sans-serif}
h1{font-size:15px;margin:0 0 6px;text-align:center}
table{border-collapse:collapse;width:100%}
td,th{vertical-align:top}
table.grid td,table.grid th{border:1px solid #000;padding:3px 4px}
table.grid th{text-align:center;background:#f2f2f2}
table.grid tr{break-inside:avoid}
.right{text-align:right}.center{text-align:center}.nowrap{white-space:nowrap}.bold{font-weight:700}
.sign{margin-top:22px;break-inside:avoid}.sign td{padding:4px 6px;vertical-align:bottom}
.line{display:inline-block;border-bottom:1px solid #000;min-width:160px;height:24px}
@media screen{body{background:#e9e9ec}.sheet{background:#fff;margin:12px auto;padding:10mm 8mm;width:297mm;min-height:210mm;box-shadow:0 1px 6px rgba(0,0,0,.25)}}
</style></head>
<body><div class="sheet">
<h1>Маршрутный лист на ${esc(dateRu(d.date))}</h1>
<p>Курьер: <b>${esc(d.courierName)}</b>. Доставок: ${d.items.length}.</p>
<table class="grid"><thead><tr><th style="width:28px">№</th><th style="width:90px">Окно</th><th>Адрес</th><th style="width:170px">Контакт</th><th style="width:170px">Документ</th><th style="width:90px">Сумма</th><th style="width:150px">Комментарий</th><th>Подпись получателя</th></tr></thead>
<tbody>${rows}<tr class="bold"><td colspan="5" class="right">Итого</td><td class="right">${moneyRu(d.total)}</td><td colspan="2"></td></tr></tbody></table>
<table class="sign"><tr><td>Курьер <span class="line"></span> / ${esc(d.courierName)} /</td><td>Выдал <span class="line"></span></td></tr></table>
</div></body></html>`;
}
