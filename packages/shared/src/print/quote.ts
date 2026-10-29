/* Коммерческое предложение по шаблону (docs/architecture/quotes.md). Шаблон — текст с простой разметкой:
   «# » и «## » — заголовки, пустая строка — новый абзац, **жирный**, параметры {{Контрагент}} и блоки на отдельной строке:
   {{Товары}} — таблица основного варианта, {{Варианты}} — все варианты с итогами, {{Подписи}} — подпись и печать.
   Всё экранируется; незнакомый параметр остаётся текстом; строка, где все параметры пустые, не печатается. */
import { amountInWordsRu } from '../ru';
import { dateLongRu, dateRu, esc, groupedRows, html, moneyRu, qtyRu } from './templates';
import type { PrintData, PrintLine, PrintVariant } from './types';

/** Параметры для подстановки: имя → значение по данным печати */
const PARAMS: Record<string, (d: PrintData) => string> = {
  Номер: d => d.number ?? '(черновик)',
  Дата: d => dateLongRu(d.date),
  'Действительно до': d => (d.dueDate ? dateRu(d.dueDate) : ''),
  Организация: d => d.organization.fullName || d.organization.name,
  'ИНН организации': d => d.organization.inn,
  'КПП организации': d => d.organization.kpp,
  'Адрес организации': d => d.organization.address,
  'Телефон организации': d => d.organization.phone,
  'Банк организации': d => {
    const b = d.organization.bank;
    return b ? `р/с ${b.account} в ${b.bankName}, БИК ${b.bik}${b.corrAccount ? `, к/с ${b.corrAccount}` : ''}` : '';
  },
  Руководитель: d => d.organization.directorName,
  'Должность руководителя': d => d.organization.directorTitle,
  Контрагент: d => d.party.fullName || d.party.name,
  'ИНН контрагента': d => d.party.inn,
  'КПП контрагента': d => d.party.kpp,
  'Адрес контрагента': d => d.party.address,
  'Телефон контрагента': d => d.party.phone,
  Ответственный: d => d.responsibleName ?? '',
  Вариант: d => d.variants?.find(v => v.main)?.name ?? '',
  Сумма: d => moneyRu(d.totals.total),
  НДС: d => (d.lines.every(l => l.vatRate === 'none') ? 'без НДС' : moneyRu(d.totals.vat)),
  'Сумма прописью': d => amountInWordsRu(d.totals.total),
  Комментарий: d => d.comment,
};

/** Блоки: ставятся отдельной строкой */
const BLOCKS: Record<string, (d: PrintData) => string> = {
  Товары: d => linesTable(d, { name: '', main: true, lines: d.lines, totals: d.totals }),
  Варианты: d => variantsBlock(d),
  Подписи: d => signs(d),
};

export const QUOTE_TEMPLATE_PARAMS = Object.keys(PARAMS);
export const QUOTE_TEMPLATE_BLOCKS = Object.keys(BLOCKS);

/** Текст стандартной формы «Коммерческое предложение»; с него же начинается новый шаблон */
export const DEFAULT_QUOTE_TEMPLATE = `# Коммерческое предложение № {{Номер}} от {{Дата}}

**Поставщик:** {{Организация}}, ИНН {{ИНН организации}}, {{Адрес организации}}
**Телефон:** {{Телефон организации}}
**Покупатель:** {{Контрагент}}

Уважаемые коллеги! Предлагаем рассмотреть условия поставки товаров и оказания услуг.

{{Варианты}}

Предложение действительно до {{Действительно до}}.
{{Комментарий}}

Ответственный менеджер: {{Ответственный}}

{{Подписи}}`;

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

function linesTable(d: PrintData, v: PrintVariant): string {
  const amount = (l: PrintLine) => (d.priceIncludesVat ? l.total : l.net);
  const disc = v.lines.some(l => Number(l.discountPct) > 0);
  const cols = disc ? 6 : 5;
  const rows = groupedRows(
    v.lines,
    l =>
      `<tr><td class="center">${l.n}</td><td>${esc(l.name)}</td><td class="right">${qtyRu(l.qty)}</td><td class="center">${esc(l.unitSymbol)}</td><td class="right">${moneyRu(l.price)}</td>${disc ? `<td class="right">${Number(l.discountPct) > 0 ? `${qtyRu(l.discountPct)}%` : ''}</td>` : ''}<td class="right">${moneyRu(amount(l))}</td></tr>`,
    (name, sum) => `<tr class="grp"><td colspan="${cols}" class="bold">${esc(name)}</td><td class="right bold">${moneyRu(sum)}</td></tr>`,
    amount,
  );
  const t = v.totals;
  const vat = v.lines.every(l => l.vatRate === 'none') ? 'Без НДС' : moneyRu(t.vat);
  return `<table class="grid" style="margin-top:6px"><thead><tr><th style="width:28px">№</th><th>Товары (работы, услуги)</th><th style="width:56px">Кол-во</th><th style="width:40px">Ед.</th><th style="width:84px">Цена</th>${disc ? '<th style="width:56px">Скидка</th>' : ''}<th style="width:92px">Сумма</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals" style="margin-top:4px"><tr><td class="bold">${d.priceIncludesVat ? 'Итого' : 'Итого (без НДС)'}:</td><td class="bold" style="width:100px">${moneyRu(d.priceIncludesVat ? t.total : t.net)}</td></tr>
<tr><td class="bold">${d.priceIncludesVat ? 'В том числе НДС' : 'Сумма НДС'}:</td><td class="bold">${vat}</td></tr>
<tr><td class="bold">Всего:</td><td class="bold">${moneyRu(t.total)}</td></tr></table>`;
}

/** Все варианты: у каждого заголовок, таблица и итог; без вариантов — таблица строк документа */
function variantsBlock(d: PrintData): string {
  const vs = d.variants ?? [];
  if (vs.length < 2) return linesTable(d, { name: '', main: true, lines: d.lines, totals: d.totals });
  return vs.map(v => `<h2 style="margin-top:10px">${esc(v.name)}</h2>${linesTable(d, v)}<div class="small">${esc(amountInWordsRu(v.totals.total))}</div>`).join('');
}

function signs(d: PrintData): string {
  const o = d.organization;
  const img = (f: PrintData['organization']['stampFile'], cls: string, alt: string) => (f && f.url ? `<img class="${cls}" src="${esc(f.url)}" alt="${esc(alt)}">` : '');
  return `<table class="sign plain"><tr>
<td class="nowrap"><b>${esc(o.directorTitle || 'Руководитель')}</b></td>
<td><span class="line">${img(o.directorSignatureFile, 'sig', 'Подпись руководителя')}</span></td>
<td>/ ${esc(o.directorName || '________________')} /</td>
<td style="position:relative;width:110px">${img(o.stampFile, 'stamp', 'Печать') || '<span class="small">М.П.</span>'}</td>
</tr></table>`;
}

/** Строка текста: параметры подставляются (экранированно), **жирный** — после экранирования, значения в нём не участвуют.
    null — в строке были параметры, и все оказались пустыми: такую строку не печатаем */
function inline(text: string, d: PrintData): string | null {
  const values: string[] = [];
  let total = 0;
  let filled = 0;
  const marked = text.replace(PLACEHOLDER, (all, name: string) => {
    const f = PARAMS[name];
    if (!f) return all;
    total++;
    const v = f(d);
    if (v.trim()) filled++;
    values.push(esc(v));
    return `\u0000${values.length - 1}\u0000`;
  });
  if (total > 0 && filled === 0) return null;
  return esc(marked)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => values[Number(i)]!);
}

/** Тело шаблона → HTML без обёртки страницы */
export function renderQuoteBody(body: string, d: PrintData): string {
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
    para = [];
  };
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const block = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(line);
    if (block && BLOCKS[block[1]!]) {
      flush();
      out.push(BLOCKS[block[1]!]!(d));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    const text = inline(h ? h[2]! : line, d);
    if (text === null) continue;
    if (h) {
      flush();
      out.push(h[1] === '#' ? `<h1 class="center">${text}</h1>` : `<h2>${text}</h2>`);
    } else para.push(text);
  }
  flush();
  return out.join('\n');
}

/** Страница КП по шаблону; без шаблона — стандартная форма */
export function renderQuote(d: PrintData, body: string = DEFAULT_QUOTE_TEMPLATE): string {
  return html(d, 'portrait', `<div class="quote">${renderQuoteBody(body, d)}</div>`);
}
