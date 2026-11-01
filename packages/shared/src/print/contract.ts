/* Договор по шаблону (docs/architecture/contracts.md). Разметка та же, что у КП (print/quote.ts): «# » и «## » — заголовки,
   пустая строка — абзац, **жирный**, параметры {{Номер договора}} и блоки на отдельной строке: {{Товары}} — таблица
   документа (составные назначения), {{Подписи сторон}} — реквизиты и подписи. Всё экранируется. */
import type { DocTemplatePurpose } from '../schemas/documents';
import { amountInWordsRu } from '../ru';
import { linesTable, renderMarkup } from './quote';
import { BASE_CSS, dateLongRu, dateRu, esc, moneyRu } from './templates';
import type { ContractPrintData, PrintBank, PrintParty } from './types';

const KIND_RU = { customer: 'с покупателем', supplier: 'с поставщиком', other: 'прочий' } as const;

const bankLine = (b: PrintBank | null) => (b ? `р/с ${b.account} в ${b.bankName}, БИК ${b.bik}${b.corrAccount ? `, к/с ${b.corrAccount}` : ''}` : '');

/** «Название, в лице должности ФИО, действующего на основании …»; без подписанта — только название */
function inPerson(name: string, title: string, person: string, basis: string): string {
  if (!person.trim()) return name;
  return `${name}, в лице ${[title.trim(), person.trim()].filter(Boolean).join(' ')}, действующего на основании ${basis.trim() || 'Устава'}`;
}

const doc = (d: ContractPrintData) => d.doc;
const partyName = (p: PrintParty) => p.fullName || p.name;

/** Параметры: имя → значение. Параметры документа пусты у договора без документа — такие строки не печатаются */
const PARAMS: Record<string, (d: ContractPrintData) => string> = {
  'Номер договора': d => d.contract.number,
  'Дата договора': d => dateLongRu(d.contract.date),
  'Начало срока': d => dateRu(d.contract.validFrom),
  'Окончание срока': d => (d.contract.validTo ? dateRu(d.contract.validTo) : ''),
  'Срок действия': d => (d.contract.validTo ? `с ${dateRu(d.contract.validFrom)} по ${dateRu(d.contract.validTo)}` : `с ${dateRu(d.contract.validFrom)}, бессрочный`),
  'Вид договора': d => KIND_RU[d.contract.kind],
  Категория: d => d.contract.category,
  'Отсрочка оплаты': d => (d.contract.paymentDays > 0 ? `${d.contract.paymentDays} дн.` : ''),
  'Примечание договора': d => d.contract.note,
  Организация: d => partyName(d.organization),
  'ИНН организации': d => d.organization.inn,
  'КПП организации': d => d.organization.kpp,
  'ОГРН организации': d => d.organization.ogrn,
  'Адрес организации': d => d.organization.address,
  'Телефон организации': d => d.organization.phone,
  'Банк организации': d => bankLine(d.organization.bank),
  'Руководитель организации': d => d.organization.directorName,
  'Должность руководителя организации': d => d.organization.directorTitle,
  'Основание полномочий организации': d => d.contract.orgSignerBasis || 'Устава',
  'Организация в лице': d => inPerson(partyName(d.organization), d.organization.directorTitle, d.organization.directorName, d.contract.orgSignerBasis),
  Контрагент: d => partyName(d.party),
  'ИНН контрагента': d => d.party.inn,
  'КПП контрагента': d => d.party.kpp,
  'ОГРН контрагента': d => d.party.ogrn,
  'Адрес контрагента': d => d.party.address,
  'Телефон контрагента': d => d.party.phone,
  'Банк контрагента': d => bankLine(d.party.bank),
  'Руководитель контрагента': d => d.contract.partySignerName,
  'Должность руководителя контрагента': d => d.contract.partySignerTitle,
  'Основание полномочий контрагента': d => (d.contract.partySignerName ? d.contract.partySignerBasis || 'Устава' : ''),
  'Контрагент в лице': d => inPerson(partyName(d.party), d.contract.partySignerTitle, d.contract.partySignerName, d.contract.partySignerBasis),
  'Номер документа': d => doc(d)?.number ?? (doc(d) ? '(черновик)' : ''),
  'Дата документа': d => (doc(d) ? dateLongRu(doc(d)!.date) : ''),
  Сумма: d => (doc(d) ? moneyRu(doc(d)!.totals.total) : ''),
  'Сумма прописью': d => (doc(d) ? amountInWordsRu(doc(d)!.totals.total) : ''),
  НДС: d => (doc(d) ? (doc(d)!.lines.every(l => l.vatRate === 'none') ? 'без НДС' : moneyRu(doc(d)!.totals.vat)) : ''),
  'Оплатить до': d => (doc(d)?.dueDate ? dateRu(doc(d)!.dueDate!) : ''),
  'Комментарий документа': d => doc(d)?.comment ?? '',
};

const BLOCKS: Record<string, (d: ContractPrintData) => string> = {
  Товары: d => {
    const x = doc(d);
    return x ? linesTable(x, { name: '', main: true, lines: x.lines, totals: x.totals }) : '';
  },
  'Подписи сторон': d => signs(d),
};

export const CONTRACT_TEMPLATE_PARAMS = Object.keys(PARAMS);
export const CONTRACT_TEMPLATE_BLOCKS = Object.keys(BLOCKS);

/** Реквизиты и подписи сторон: слева организация, справа контрагент */
function signs(d: ContractPrintData): string {
  const o = d.organization;
  const p = d.party;
  const img = (f: typeof o.stampFile, cls: string, alt: string) => (f && f.url ? `<img class="${cls}" src="${esc(f.url)}" alt="${esc(alt)}">` : '');
  const side = (title: string, name: string, inn: string, kpp: string, ogrn: string, addr: string, bank: PrintBank | null, post: string, person: string, sig: string) =>
    `<td style="width:50%;vertical-align:top"><b>${esc(title)}</b><br>${esc(name)}<br>${[inn && `ИНН ${inn}`, kpp && `КПП ${kpp}`, ogrn && `ОГРН ${ogrn}`].filter(Boolean).map(esc).join(', ')}${addr ? `<br>${esc(addr)}` : ''}${bank ? `<br>${esc(bankLine(bank))}` : ''}<br><br>${esc(post || 'Руководитель')}<br><span class="line">${sig}</span> / ${esc(person || '________________')} /</td>`;
  const left = side('Организация', partyName(o), o.inn, o.kpp, o.ogrn, o.address, o.bank, o.directorTitle, o.directorName, img(o.directorSignatureFile, 'sig', 'Подпись руководителя') + (img(o.stampFile, 'stamp', 'Печать') || '<span class="small">М.П.</span>'));
  const right = side('Контрагент', partyName(p), p.inn, p.kpp, p.ogrn, p.address, p.bank, d.contract.partySignerTitle, d.contract.partySignerName, '<span class="small">М.П.</span>');
  return `<table class="sign plain" style="margin-top:14px"><tr>${left}${right}</tr></table>`;
}

/** Встроенные шаблоны — по одному на назначение; с них начинается новый шаблон и ими печатается договор без выбора */
const TERMS = `**1. Предмет договора**
1.1. {{Организация}} (далее — «Поставщик») обязуется передать, а {{Контрагент}} (далее — «Покупатель») обязуется принять и оплатить товары в ассортименте, количестве и по ценам, согласованным сторонами.
1.2. Договор действует {{Срок действия}}.

**2. Порядок расчётов**
2.1. Оплата производится в рублях безналичным расчётом.
2.2. Отсрочка оплаты: {{Отсрочка оплаты}}

**3. Ответственность и разрешение споров**
3.1. За неисполнение или ненадлежащее исполнение обязательств стороны несут ответственность по законодательству Российской Федерации.
3.2. Споры решаются путём переговоров, а при недостижении согласия — в суде по месту нахождения ответчика.

**4. Реквизиты и подписи сторон**`;

const HEAD = `# Договор № {{Номер договора}}

{{Дата договора}}

{{Организация в лице}}, с одной стороны, и {{Контрагент в лице}}, с другой стороны, заключили настоящий договор о нижеследующем.
`;

export const DEFAULT_CONTRACT_TEMPLATES: Record<Exclude<DocTemplatePurpose, 'quote'>, { name: string; body: string }> = {
  contract: { name: 'Договор поставки', body: `${HEAD}\n${TERMS}\n\n{{Подписи сторон}}` },
  contract_order: {
    name: 'Договор поставки + Заказ покупателя',
    body: `${HEAD}\n${TERMS}\n\n**Приложение. Заказ покупателя № {{Номер документа}} от {{Дата документа}}**\n\n{{Товары}}\n\nВсего к оплате: {{Сумма прописью}}.\n{{Комментарий документа}}\n\n{{Подписи сторон}}`,
  },
  contract_invoice: {
    name: 'Договор поставки + Счёт',
    body: `${HEAD}\n${TERMS}\n\n**Приложение. Счёт на оплату № {{Номер документа}} от {{Дата документа}}**\n\n{{Товары}}\n\nВсего к оплате: {{Сумма прописью}}. Оплатить до {{Оплатить до}}.\n\n{{Подписи сторон}}`,
  },
  contract_work_order: {
    name: 'Договор оказания услуг',
    body: `${HEAD}\n**1. Предмет договора**\n1.1. {{Организация}} (далее — «Исполнитель») обязуется оказать услуги и выполнить работы по заданию {{Контрагент}} (далее — «Заказчик»), а Заказчик обязуется принять и оплатить их.\n1.2. Договор действует {{Срок действия}}.\n\n**2. Стоимость и порядок расчётов**\n2.1. Состав и стоимость работ определены заказ-нарядом № {{Номер документа}} от {{Дата документа}}.\n\n{{Товары}}\n\nИтого: {{Сумма прописью}}.\n2.2. Отсрочка оплаты: {{Отсрочка оплаты}}\n\n**3. Ответственность и разрешение споров**\n3.1. Стороны несут ответственность по законодательству Российской Федерации; споры решаются путём переговоров, а при недостижении согласия — в суде.\n\n**4. Реквизиты и подписи сторон**\n\n{{Подписи сторон}}`,
  },
};

/** Тело договора по шаблону → HTML без обёртки страницы */
export const renderContractBody = (body: string, d: ContractPrintData): string => renderMarkup(body, d, PARAMS, BLOCKS);

/** Страница договора по шаблону; без текста — встроенный шаблон назначения */
export function renderContract(d: ContractPrintData, purpose: Exclude<DocTemplatePurpose, 'quote'>, body?: string): string {
  const text = body ?? DEFAULT_CONTRACT_TEMPLATES[purpose].body;
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(`Договор № ${d.contract.number || 'б/н'} от ${dateRu(d.contract.date)}`)}</title>
<style>
@page{size:A4 portrait;margin:12mm 10mm}
${BASE_CSS}
@media screen{body{background:#e9e9ec}.sheet{background:#fff;margin:12px auto;padding:12mm 10mm;width:210mm;min-height:297mm;box-shadow:0 1px 6px rgba(0,0,0,.25)}}
</style></head>
<body><div class="sheet"><div class="quote">${renderContractBody(text, d)}</div></div></body></html>`;
}
