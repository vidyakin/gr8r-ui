/* Печатная форма прайс-листа (задача 1178): чистая функция «данные → HTML», по-русски, A4 портрет/альбом по числу колонок.
   PDF получается печатью страницы в браузере. */
import { BASE_CSS, dateRu, esc, moneyRu } from './templates';

export interface PriceListPrintData {
  title: string;
  company: string;
  /** Дата цен, ГГГГ-ММ-ДД */
  date: string;
  kinds: { id: string; name: string }[];
  rows: { sku: string; name: string; unit: string; category: string | null; prices: Record<string, string | null>; inStock?: boolean | undefined }[];
  /** Показывать колонку «Наличие» (публичная ссылка: есть / нет) */
  showStock?: boolean | undefined;
}

export function renderPriceList(d: PriceListPrintData): string {
  const orientation = d.kinds.length > 3 ? 'landscape' : 'portrait';
  const head = `<tr><th style="width:90px">Артикул</th><th>Наименование</th><th style="width:50px">Ед.</th>${d.kinds.map(k => `<th style="width:100px">${esc(k.name)}, руб.</th>`).join('')}${d.showStock ? '<th style="width:80px">Наличие</th>' : ''}</tr>`;
  const cols = 3 + d.kinds.length + (d.showStock ? 1 : 0);
  let body = '';
  let cat: string | null | undefined;
  for (const r of d.rows) {
    if (r.category !== cat) {
      cat = r.category;
      body += `<tr><td colspan="${cols}" style="background:#f0f0f2"><b>${esc(cat ?? 'Без категории')}</b></td></tr>`;
    }
    body += `<tr><td>${esc(r.sku)}</td><td>${esc(r.name)}</td><td class="center">${esc(r.unit)}</td>${d.kinds.map(k => `<td class="right">${r.prices[k.id] ? moneyRu(r.prices[k.id]!) : ''}</td>`).join('')}${d.showStock ? `<td class="center">${r.inStock ? 'в наличии' : 'под заказ'}</td>` : ''}</tr>`;
  }
  const title = d.title || 'Прайс-лист';
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
@page{size:A4 ${orientation};margin:12mm 10mm}
${BASE_CSS}
@media screen{body{background:#e9e9ec}.sheet{background:#fff;margin:12px auto;padding:12mm 10mm;width:${orientation === 'portrait' ? '210mm' : '297mm'};box-shadow:0 1px 6px rgba(0,0,0,.2)}}
thead{display:table-header-group}tr{page-break-inside:avoid}
</style></head>
<body><div class="sheet">
<h1 class="center">${esc(title)}</h1>
<p class="center">${esc(d.company)} · цены на ${dateRu(d.date)}</p>
<table class="grid" style="margin-top:8px"><thead>${head}</thead><tbody>${body}</tbody></table>
</div></body></html>`;
}
