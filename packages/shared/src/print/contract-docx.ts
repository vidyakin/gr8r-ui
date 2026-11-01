/* Заполнение DOCX-шаблонов договора (задача 1195, docs/architecture/contracts.md).
   Библиотеки — docxtemplater + pizzip (решение записано в план): docxtemplater сам разбирает word/document.xml
   и склеивает разорванные Word-прогоны внутри {{…}}; delimiters заданы явно, потому что по умолчанию одинарные скобки.
   Повтор строк документа — цикл по таблице Word: {{#Товары}} … {{/Товары}} вокруг строки-шаблона. */
import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module';
import PizZip from 'pizzip';
import { amountInWordsRu } from '../ru';
import { dateLongRu, dateRu, moneyRu, qtyRu } from './templates';
import type { ContractPrintData, PrintLine, PrintBank } from './types';

/** Параметры строки документа для цикла {{#Товары}} */
const LINE_PARAMS: Record<string, (l: PrintLine, d: ContractPrintData) => string> = {
  'Наименование': l => l.name,
  'Количество': l => qtyRu(l.qty),
  'Единица': l => l.unitSymbol,
  Цена: l => moneyRu(l.price),
  Сумма: l => moneyRu(l.total),
  Номер: l => String(l.n),
};

/** Строки документа в виде объектов для цикла docxtemplater */
export function docxDocLines(d: ContractPrintData): Record<string, string>[] {
  return (d.doc?.lines ?? []).map(l => {
    const o: Record<string, string> = {};
    for (const [k, f] of Object.entries(LINE_PARAMS)) o[k] = f(l, d);
    return o;
  });
}

/** Параметры уровня документа для DOCX (те же имена, что у HTML-шаблонов) + данные цикла Товары */
export function docxData(d: ContractPrintData): Record<string, unknown> {
  const data: Record<string, unknown> = { ...docxDocParams(d), Товары: docxDocLines(d) };
  return data;
}

/** Реквизитные параметры: те же вычисления, что в print/contract.ts, но без HTML-экранирования */
function docxDocParams(d: ContractPrintData): Record<string, string> {
  const doc = d.doc;
  const kind = { customer: 'с покупателем', supplier: 'с поставщиком', other: 'прочий' } as const;
  const bank = (b: PrintBank | null) =>
    b ? `р/с ${b.account} в ${b.bankName}, БИК ${b.bik}${b.corrAccount ? `, к/с ${b.corrAccount}` : ''}` : '';
  const inPerson = (name: string, title: string, person: string, basis: string) => {
    if (!person.trim()) return name;
    return `${name}, в лице ${[title.trim(), person.trim()].filter(Boolean).join(' ')}, действующего на основании ${basis.trim() || 'Устава'}`;
  };
  const p = (name: string, value: string) => [name, value] as const;
  const pairs: (readonly [string, string])[] = [
    p('Номер договора', d.contract.number),
    p('Дата договора', dateLongRu(d.contract.date)),
    p('Начало срока', dateRu(d.contract.validFrom)),
    p('Окончание срока', d.contract.validTo ? dateRu(d.contract.validTo) : ''),
    p('Срок действия', d.contract.validTo ? `с ${dateRu(d.contract.validFrom)} по ${dateRu(d.contract.validTo)}` : `с ${dateRu(d.contract.validFrom)}, бессрочный`),
    p('Вид договора', kind[d.contract.kind]),
    p('Категория', d.contract.category),
    p('Отсрочка оплаты', d.contract.paymentDays > 0 ? `${d.contract.paymentDays} дн.` : ''),
    p('Примечание договора', d.contract.note),
    p('Организация', d.organization.fullName || d.organization.name),
    p('ИНН организации', d.organization.inn),
    p('КПП организации', d.organization.kpp),
    p('ОГРН организации', d.organization.ogrn),
    p('Адрес организации', d.organization.address),
    p('Телефон организации', d.organization.phone),
    p('Банк организации', bank(d.organization.bank)),
    p('Руководитель организации', d.organization.directorName),
    p('Должность руководителя организации', d.organization.directorTitle),
    p('Основание полномочий организации', d.contract.orgSignerBasis || 'Устава'),
    p('Организация в лице', inPerson(d.organization.fullName || d.organization.name, d.organization.directorTitle, d.organization.directorName, d.contract.orgSignerBasis)),
    p('Контрагент', d.party.fullName || d.party.name),
    p('ИНН контрагента', d.party.inn),
    p('КПП контрагента', d.party.kpp),
    p('ОГРН контрагента', d.party.ogrn),
    p('Адрес контрагента', d.party.address),
    p('Телефон контрагента', d.party.phone),
    p('Банк контрагента', bank(d.party.bank)),
    p('Руководитель контрагента', d.contract.partySignerName),
    p('Должность руководителя контрагента', d.contract.partySignerTitle),
    p('Основание полномочий контрагента', d.contract.partySignerName ? d.contract.partySignerBasis || 'Устава' : ''),
    p('Контрагент в лице', inPerson(d.party.fullName || d.party.name, d.contract.partySignerTitle, d.contract.partySignerName, d.contract.partySignerBasis)),
    p('Номер документа', doc ? (doc.number ?? '(черновик)') : ''),
    p('Дата документа', doc ? dateLongRu(doc.date) : ''),
    p('Сумма', doc ? moneyRu(doc.totals.total) : ''),
    p('Сумма прописью', doc ? amountInWordsRu(doc.totals.total) : ''),
    p('НДС', doc ? (doc.lines.every(l => l.vatRate === 'none') ? 'без НДС' : moneyRu(doc.totals.vat)) : ''),
    p('Оплатить до', doc?.dueDate ? dateRu(doc.dueDate) : ''),
    p('Комментарий документа', doc?.comment ?? ''),
  ];
  const out: Record<string, string> = {};
  for (const [k, v] of pairs) out[k] = v;
  return out;
}

const OPTIONS = { paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' } } as const;

/** Список параметров, найденных в шаблоне (верхний уровень и внутри циклов) */
export function docxTemplateTags(data: Uint8Array): string[] {
  const iModule = new InspectModule();
  new Docxtemplater(new PizZip(data), { ...OPTIONS, modules: [iModule] });
  const all = iModule.getAllTags() as Record<string, unknown>;
  const out = new Set<string>();
  const walk = (tags: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(tags)) {
      out.add(k);
      if (v && typeof v === 'object') walk(v as Record<string, unknown>);
    }
  };
  walk(all);
  return [...out].sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Заполняет DOCX-шаблон данными договора; возвращает байты готового файла */
export function renderContractDocx(data: Uint8Array, d: ContractPrintData): Uint8Array {
  const doc = new Docxtemplater(new PizZip(data), OPTIONS);
  doc.render(docxData(d));
  return doc.toUint8Array();
}
