/* Печатные формы спецификации: «Кратко» (только эта спецификация) и «Развёрнуто» (все переделы до исходных
   материалов). Чистая функция «данные → HTML», как и формы документов: та же страница показывается в браузере
   (предпросмотр и печать) и превращается в PDF воркером. */
import { esc, moneyRu, qtyRu, dateRu } from './templates';

export interface BomPrintRow {
  n: number;
  /** Тип строки: Материал, Полуфабрикат, Работа, Расход, Выходной продукт */
  kind: string;
  name: string;
  /** Товар каталога */
  product: string;
  unitCode: string;
  qty: string;
  note: string;
  /** Доля стоимости, % (выходной продукт разборки) */
  costShare?: string | null;
  /** Вложенные строки (развёрнутая форма) */
  children?: BomPrintRow[];
}

export interface BomPrintData {
  form: 'short' | 'expanded';
  /** Вид спецификации: сборка или разборка (у разборки товар — исходный) */
  mode?: 'assembly' | 'disassembly';
  /** Название спецификации */
  name: string;
  code: string;
  /** Товар, который выпускается (у разборки — исходный, что разбирают) */
  productName: string | null;
  unitCode: string;
  /** Количество на партию */
  batchQty: string;
  overheadPct: string;
  date: string;
  /** Значения параметров изделия */
  params: { name: string; value: string }[];
  rows: BomPrintRow[];
}

const BASE_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#000;font:11px/1.35 "Liberation Sans",Arial,Helvetica,sans-serif}
h1{font-size:15px;margin:0 0 6px;font-weight:700}
table{border-collapse:collapse;width:100%}
td,th{vertical-align:top;border:1px solid #000;padding:2px 4px}
th{text-align:center;font-weight:700;background:#f2f2f2}
thead{display:table-header-group}
tr{break-inside:avoid;page-break-inside:avoid}
.right{text-align:right}
.gray{background:#f7f7f7}
.params{margin:4px 0 8px}
.params td{border:0;padding:1px 6px 1px 0}
`;

/** Печатная форма спецификации: короткая (свои строки) или развёрнутая (с переделами) */
export function bomPrintHtml(d: BomPrintData): string {
  const disassembly = d.mode === 'disassembly';
  const title = d.form === 'short' ? 'Спецификация (кратко)' : 'Спецификация (развёрнуто)';
  const rowsHtml = d.rows.map(r => rowHtml(r, disassembly)).join('');
  const paramsHtml = d.params.length
    ? `<table class="params"><tr>${d.params.map(p => `<td><b>${esc(p.name)}:</b> ${esc(p.value)}</td>`).join('')}</tr></table>`
    : '';
  const shareHead = disassembly ? '<th style="width:70px">Доля, %</th>' : '';
  const productLabel = disassembly ? 'Исходный товар' : 'Товар';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}@page{size:A4;margin:12mm}</style></head><body>
<h1>${esc(title)}: ${esc(d.name)}</h1>
<table class="params">
<tr><td><b>Код:</b> ${esc(d.code)}</td><td><b>${esc(productLabel)}:</b> ${esc(d.productName ?? '')}</td><td><b>Партия:</b> ${esc(qtyRu(d.batchQty))} ${esc(d.unitCode)}</td></tr>
<tr><td><b>Накладные, %:</b> ${esc(d.overheadPct)}</td><td><b>Дата:</b> ${esc(dateRu(d.date))}</td></tr>
</table>
${paramsHtml}
<table>
<thead><tr><th style="width:30px">№</th><th>Наименование</th><th>Товар</th><th style="width:80px">Кол-во</th><th style="width:50px">Ед.</th>${shareHead}<th style="width:90px">Сумма</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
</body></html>`;
}

/** Строка печатной формы со вложенными строками переделов */
function rowHtml(r: BomPrintRow, disassembly = false): string {
  const children = r.children?.length ? r.children.map(c => rowHtml(c, disassembly)).join('') : '';
  const share = disassembly ? `<td class="right">${esc(r.costShare ?? '')}</td>` : '';
  return `<tr><td class="right">${r.n}</td><td>${esc(r.kind)}: ${esc(r.name)}${r.note ? ` <i>(${esc(r.note)})</i>` : ''}</td><td>${esc(r.product)}</td><td class="right">${esc(qtyRu(r.qty))}</td><td>${esc(r.unitCode)}</td>${share}<td class="right">${esc(moneyRu('0'))}</td></tr>${children}`;
}
