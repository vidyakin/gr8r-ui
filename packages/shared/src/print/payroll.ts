/* Печатные формы зарплаты (задача 1184): расчётный листок и платёжная ведомость (Т-53). Чистые функции «данные → HTML»,
   по-русски, без перевода. Платёжная ведомость — A4 альбом, расчётный листок — A4 портрет. */
import { dec, fmt } from '../decimal';
import { amountInWordsRu } from '../ru';
import { BASE_CSS, dateRu, esc, moneyRu } from './templates';
import type { PrintOrganization } from './types';

const page = (title: string, body: string, orientation: 'portrait' | 'landscape', draft: boolean) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
@page{size:A4 ${orientation};margin:12mm 10mm}
${BASE_CSS}
@media screen{body{background:#e9e9ec}.sheet{background:#fff;margin:12px auto;padding:12mm 10mm;width:${orientation === 'portrait' ? '210mm' : '297mm'};min-height:${orientation === 'portrait' ? '297mm' : '210mm'};box-shadow:0 1px 6px rgba(0,0,0,.2)}}
</style></head>
<body><div class="sheet">${draft ? '<div class="draft">ЧЕРНОВИК</div>' : ''}${body}</div></body></html>`;

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const periodRu = (period: string): string => `${MONTHS[Number(period.slice(5, 7)) - 1] ?? ''} ${period.slice(0, 4)}`;

export interface PayslipData {
  organization: PrintOrganization;
  memberName: string;
  period: string;
  items: { kindName: string; base: string; workedDays: number; normDays: number; amount: string; ndfl: string; deduction: boolean }[];
  totals: { accrued: string; ndfl: string; deductions: string; paid: string; debtAtEnd: string };
}

export function renderPayslip(d: PayslipData): string {
  const o = d.organization;
  const title = `Расчётный листок за ${periodRu(d.period)}`;
  const rows = d.items
    .map(i => `<tr><td>${esc(i.kindName)}</td><td class="right">${Number(i.base) ? moneyRu(fmt(dec(i.base), 2)) : ''}</td><td class="right">${i.normDays ? `${i.workedDays} / ${i.normDays}` : ''}</td><td class="right">${i.deduction ? '−' : ''}${moneyRu(fmt(dec(i.amount), 2))}</td><td class="right">${i.deduction ? '' : moneyRu(fmt(dec(i.ndfl), 2))}</td></tr>`)
    .join('');
  const withheld = dec(d.totals.ndfl) + dec(d.totals.deductions);
  return page(
    title,
    `<h1 class="center">${esc(title)}</h1>
<table class="plain" style="margin-top:8px">
<tr><td style="width:150px">Организация</td><td><b>${esc(o.fullName || o.name)}</b></td></tr>
<tr><td>Сотрудник</td><td><b>${esc(d.memberName)}</b></td></tr>
</table>
<table class="grid" style="margin-top:10px"><thead><tr><th>Вид начисления</th><th style="width:110px">База, руб.</th><th style="width:80px">Дни</th><th style="width:120px">Сумма, руб.</th><th style="width:110px">НДФЛ, руб.</th></tr></thead>
<tbody>${rows}</tbody></table>
<table class="plain" style="margin-top:10px">
<tr><td style="width:220px">Начислено</td><td class="right">${moneyRu(d.totals.accrued)}</td></tr>
<tr><td>Удержано (НДФЛ и прочее)</td><td class="right">${moneyRu(fmt(withheld, 2))}</td></tr>
<tr><td>Выплачено в месяце</td><td class="right">${moneyRu(d.totals.paid)}</td></tr>
<tr><td><b>Долг на конец месяца</b></td><td class="right"><b>${moneyRu(d.totals.debtAtEnd)}</b></td></tr>
</table>`,
    'portrait',
    false,
  );
}

export interface PayrollStatementPrintData {
  organization: PrintOrganization;
  number: string | null;
  date: string;
  period: string;
  kindLabel: string;
  lines: { memberName: string; amount: string }[];
  total: string;
}

/** Платёжная (расчётно-платёжная) ведомость по форме Т-53: табельный номер, сумма, подпись получателя */
export function renderPaymentStatement(d: PayrollStatementPrintData): string {
  const o = d.organization;
  const head = d.number ? `Платёжная ведомость № ${esc(d.number)}` : 'Платёжная ведомость (черновик)';
  const rows = d.lines.map((l, i) => `<tr><td class="center">${i + 1}</td><td>${esc(l.memberName)}</td><td class="right">${moneyRu(fmt(dec(l.amount), 2))}</td><td></td><td></td></tr>`).join('');
  return page(
    head,
    `<h1 class="center">${head}</h1>
<div class="center">Унифицированная форма № Т-53 · ${esc(d.kindLabel)} за ${esc(periodRu(d.period))}</div>
<table class="plain" style="margin-top:8px">
<tr><td style="width:150px">Организация</td><td><b>${esc(o.fullName || o.name)}</b>${o.inn ? `, ИНН ${esc(o.inn)}` : ''}</td></tr>
<tr><td>Дата составления</td><td>${esc(dateRu(d.date))}</td></tr>
</table>
<table class="grid" style="margin-top:10px"><thead><tr><th style="width:40px">№</th><th>Фамилия, имя, отчество</th><th style="width:130px">Сумма, руб.</th><th style="width:160px">Подпись получателя</th><th style="width:110px">Дата выплаты</th></tr></thead>
<tbody>${rows}<tr><td></td><td><b>Итого</b></td><td class="right"><b>${moneyRu(fmt(dec(d.total), 2))}</b></td><td></td><td></td></tr></tbody></table>
<div class="words"><b>Всего к выплате:</b> ${esc(amountInWordsRu(d.total))}</div>
<table class="sign plain"><tr>
<td><b>Руководитель</b><br><span class="line"></span> / ${esc(o.directorName || '________________')} /</td>
<td><b>Главный бухгалтер</b><br><span class="line"></span> / ${esc(o.accountantName || o.directorName || '________________')} /</td>
<td><b>Кассир</b><br><span class="line"></span> / ________________ /</td>
</tr></table>`,
    'landscape',
    !d.number,
  );
}
