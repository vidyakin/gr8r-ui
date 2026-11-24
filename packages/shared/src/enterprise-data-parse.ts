/* File exchange with 1C. See docs/user/automations/integrations.md. */
import { DOMParser, onErrorStopParsing, type Element } from '@xmldom/xmldom';
import { z } from 'zod';
import { dec, mul, fmt } from './decimal';
import { IC_DOCUMENT_TYPES } from './enterprise-data';
import type { IC_ENTITY_TYPES } from './integrations-1c';

export const ENTERPRISE_DATA_MAX_BYTES = 10 * 1024 * 1024;
const FORMAT = 'http://v8.1c.ru/edi/edi_stnd/EnterpriseData';
const versions = [`${FORMAT}/1.15`, `${FORMAT}/1.17`];
const guidPattern = /^(?:\{([0-9a-f-]{36})\}|([0-9a-f-]{36}))$/i;
const validGuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const isoDate = z.iso.date();

export type IcCatalogType = Exclude<typeof IC_ENTITY_TYPES[number], 'document'>;
export type IcDocumentType = typeof IC_DOCUMENT_TYPES[number];

export interface IcCatalogObject {
  type: IcCatalogType;
  refUuid: string;
  name: string;
  fullName?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  partyKind?: 'legal' | 'individual' | 'sole_proprietor';
  kind?: 'goods' | 'service';
  sku?: string;
  barcode?: string;
  unitCode?: string;
  vatRate?: string;
  organizationRef?: string;
  companyRef?: string;
  ownerRef?: string;
  contractKind?: 'customer' | 'supplier' | 'other';
  number?: string;
  date?: string;
  bankName?: string;
  bik?: string;
  account?: string;
  corrAccount?: string;
  currency?: string;
}

export interface IcParsedDocument {
  refUuid?: string;
  type: IcDocumentType;
  number: string;
  date: string;
  amount: string;
  currency?: string;
  organizationRef?: string;
  companyRef?: string;
  operation?: string;
  /** EnterpriseData uses the same document tag for sales and service acts. */
  serviceOnly?: boolean;
}

interface BalanceBase {
  date?: string;
  organizationRef?: string;
  amount: string;
}
export type IcBalance =
  | (BalanceBase & { kind: 'stock'; productRef?: string; warehouseRef?: string; qty: string; unitCode?: string; hasCost: boolean })
  | (BalanceBase & { kind: 'bank' | 'cash'; accountRef?: string; currency?: string })
  | (BalanceBase & { kind: 'settlement'; companyRef?: string; contractRef?: string; side?: 'customer' | 'supplier'; currency?: string });

export interface EnterpriseDataParseIssue {
  type: string;
  refUuid?: string;
  name?: string;
  reason: 'invalid_catalog' | 'duplicate_catalog' | 'invalid_document' | 'duplicate_document' | 'invalid_balance';
}

export interface IcBalanceSnapshot {
  kind: IcBalance['kind'];
  date?: string;
  organizationRef?: string;
}

export interface ParsedEnterpriseData {
  version: '1.15' | '1.17';
  catalogs: IcCatalogObject[];
  documents: IcParsedDocument[];
  balances: IcBalance[];
  balanceSnapshots: IcBalanceSnapshot[];
  references: IcCatalogObject[];
  issues: EnterpriseDataParseIssue[];
}

export class EnterpriseDataParseError extends Error {
  constructor(readonly code: 'invalid_enterprise_data' | 'payload_too_large') {
    super(code === 'payload_too_large' ? 'EnterpriseData file exceeds 10 MiB' : 'Expected a valid EnterpriseData 1.15 or 1.17 XML file');
  }
}

function* children(node?: Element): Generator<Element> {
  for (let child = node?.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) yield child as Element;
  }
}
const element = (node: Element | undefined, ...names: string[]) => {
  for (const name of names) {
    for (const child of children(node)) if (child.localName === name) return child;
  }
  return undefined;
};
const scalar = (node?: Element) => {
  let value = '';
  for (let child = node?.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 || child.nodeType === 4) value += child.nodeValue;
  }
  return value.trim() || undefined;
};
const field = (node: Element | undefined, ...names: string[]) => scalar(element(node, ...names));
const keys = (node?: Element) => element(node, 'КлючевыеСвойства') ?? node;
const prop = (node: Element | undefined, ...names: string[]) => field(keys(node), ...names) ?? field(node, ...names);
const ref = (node?: Element) => {
  const value = prop(node, 'Ссылка', 'УникальныйИдентификатор', 'GUID') ?? scalar(node);
  const match = value?.match(guidPattern);
  const normalized = (match?.[1] ?? match?.[2])?.toLowerCase();
  return normalized && validGuid.test(normalized) && normalized !== '00000000-0000-0000-0000-000000000000' ? normalized : undefined;
};
const related = (node: Element | undefined, ...names: string[]) => element(keys(node), ...names) ?? element(node, ...names);
const productReference = (node?: Element) => related(node, 'Номенклатура', 'Товар') ?? related(element(node, 'ДанныеНоменклатуры'), 'Номенклатура');
const date = (value?: string) => {
  const day = value?.slice(0, 10);
  return day && !day.startsWith('0000-') && isoDate.safeParse(day).success && (value?.length === 10 || /^\d{4}-\d{2}-\d{2}T/.test(value ?? '')) ? day : undefined;
};
const decimal = (value?: string) => {
  const normalized = value?.replace(',', '.').replace(/^\+/, '');
  return normalized && /^-?\d{1,16}(?:\.\d{1,8})?$/.test(normalized) ? normalized : undefined;
};
const classification = (node?: Element) => field(element(node, 'ДанныеКлассификатора'), 'Код') ?? field(node, 'Код') ?? scalar(node);

const catalogNames = new Map<string, IcCatalogType>([
  ['Организация', 'organization'], ['Организации', 'organization'],
  ['Контрагент', 'company'], ['Контрагенты', 'company'],
  ['Договор', 'contract'], ['Договоры', 'contract'], ['ДоговорыКонтрагентов', 'contract'], ['ДоговорКонтрагента', 'contract'],
  ['Номенклатура', 'product'],
  ['Склад', 'warehouse'], ['Склады', 'warehouse'], ['СкладыИМагазины', 'warehouse'],
  ['БанковскиеСчета', 'bank_account'], ['БанковскийСчет', 'bank_account'], ['БанковскиеСчетаОрганизаций', 'bank_account'],
  ['Касса', 'cash_register'], ['Кассы', 'cash_register'], ['КассыОрганизаций', 'cash_register'],
]);

function catalog(node: Element, type: IcCatalogType): IcCatalogObject | undefined {
  const refUuid = ref(node);
  const account = prop(node, 'НомерСчета', 'НомерБанковскогоСчета');
  const name = prop(node, 'Наименование', 'НаименованиеПолное') ?? account;
  if (!refUuid || !name) return undefined;
  const row: IcCatalogObject = { type, refUuid, name };
  if (type === 'company' || type === 'organization') {
    const individual = prop(node, 'ЮридическоеФизическоеЛицо', 'ВидКонтрагента') === 'ФизическоеЛицо';
    const sole = ['true', '1'].includes(prop(node, 'ИндивидуальныйПредприниматель') ?? '');
    return { ...row, fullName: prop(node, 'НаименованиеПолное'), inn: prop(node, 'ИНН'), kpp: prop(node, 'КПП'),
      ogrn: prop(node, 'ОГРН', 'ОГРНИП', 'РегистрационныйНомер'), partyKind: sole ? 'sole_proprietor' : individual ? 'individual' : 'legal' };
  }
  if (type === 'product') {
    const vat = related(node, 'СтавкаНДС');
    return { ...row, sku: prop(node, 'Артикул'), barcode: prop(node, 'Штрихкод', 'ШтрихКод') ?? field(element(element(node, 'Штрихкоды'), 'Строка'), 'Штрихкод', 'ШтрихКод'),
      kind: prop(node, 'ТипНоменклатуры', 'ВидНоменклатуры') === 'Услуга' ? 'service' : 'goods',
      unitCode: classification(related(node, 'ЕдиницаИзмерения', 'БазоваяЕдиницаИзмерения', 'ЕдиницаХраненияОстатков', 'ЕдиницаХранения')),
      vatRate: field(vat, 'НеОблагается') === 'true' ? 'none' : field(vat, 'Ставка') ?? scalar(vat)?.replace(/^НДС/, '').replace(/^БезНДС$/, 'none') };
  }
  if (type === 'contract' || type === 'bank_account' || type === 'cash_register') {
    row.organizationRef = ref(related(node, 'Организация'));
    row.companyRef = ref(related(node, 'Контрагент', 'Партнер'));
    row.ownerRef = ref(related(node, 'Владелец'));
    row.currency = classification(related(node, 'ВалютаВзаиморасчетов', 'ВалютаДенежныхСредств', 'Валюта'));
  }
  if (type === 'contract') {
    const kind = prop(node, 'ВидДоговора');
    return { ...row, number: prop(node, 'Номер'), date: date(prop(node, 'Дата')),
      contractKind: kind === 'СПокупателем' ? 'customer' : kind === 'СПоставщиком' ? 'supplier' : 'other' };
  }
  if (type === 'bank_account') {
    const bank = related(node, 'Банк');
    const details = element(bank, 'ДанныеКлассификатораБанков', 'ДанныеКлассификатора') ?? keys(bank);
    return { ...row, account, bik: field(details, 'БИК') ?? prop(node, 'БИК'),
      bankName: field(details, 'Наименование'), corrAccount: field(details, 'КоррСчет', 'КорреспондентскийСчет') };
  }
  return row;
}

function documentType(tag: string): IcDocumentType | undefined {
  if (['РеализацияТоваровУслуг', 'РеализацияТоваровИУслуг', 'РеализацияТоваров'].includes(tag)) return 'realization';
  if (['АктВыполненныхРабот', 'АктОбОказанииУслуг'].includes(tag)) return 'act';
  if (['ПоступлениеТоваровУслуг', 'ПоступлениеТоваровИУслуг', 'ПриобретениеТоваровУслуг'].includes(tag)) return 'receipt';
  if (tag.startsWith('ПБДС') || ['ПоступлениеБезналичныхДенежныхСредств', 'ПоступлениеНаРасчетныйСчет'].includes(tag)) return 'bank_receipt';
  if (tag.startsWith('СБДС') || ['СписаниеБезналичныхДенежныхСредств', 'СписаниеСРасчетногоСчета', 'ПлатежноеПоручениеИсходящее'].includes(tag)) return 'bank_payment';
  if (tag.startsWith('ПКО') || ['ПриходныйКассовыйОрдер', 'ПоступлениеНаличных'].includes(tag)) return 'cash_receipt';
  if (tag.startsWith('РКО') || ['РасходныйКассовыйОрдер', 'ВыдачаНаличных'].includes(tag)) return 'cash_payment';
  if (tag === 'АвансовыйОтчет') return 'advance_report';
}

function sumTradeLines(node: Element) {
  let total = 0n;
  let count = 0;
  const includesVat = prop(node, 'СуммаВключаетНДС', 'ЦенаВключаетНДС');
  for (const section of ['Товары', 'Услуги']) {
    for (const row of children(element(node, section))) {
      if (row.localName !== 'Строка') continue;
      const amount = decimal(prop(row, 'СуммаСНДС', 'Сумма'));
      const vat = prop(row, 'СуммаНДС');
      if (amount === undefined || (vat !== undefined && decimal(vat) === undefined)) return undefined;
      total += dec(amount);
      if (!prop(row, 'СуммаСНДС') && (includesVat === 'false' || includesVat === '0')) total += dec(decimal(vat));
      count++;
    }
  }
  return count ? fmt(total, 2) : undefined;
}

function parseDocument(node: Element, type: IcDocumentType): IcParsedDocument | undefined {
  const common = element(node, 'ОбщиеДанные');
  const day = date(prop(node, 'Дата') ?? field(common, 'ДатаВыписки', 'Дата'));
  const number = prop(node, 'Номер') ?? field(common, 'Номер') ?? '';
  const refUuid = ref(node);
  const total = prop(node, 'СуммаДокумента', 'Сумма', 'СуммаПлатежа') ?? field(common, 'СуммаДокумента', 'Сумма', 'СуммаПлатежа');
  const amount = total === undefined && (type === 'realization' || type === 'act' || type === 'receipt') ? sumTradeLines(node) : decimal(total);
  if (!day || amount === undefined || (!number && !refUuid)) return undefined;
  return { type, refUuid, number, date: day, amount,
    currency: classification(related(node, 'Валюта', 'ВалютаДокумента') ?? related(common, 'Валюта', 'ВалютаДокумента')),
    organizationRef: ref(related(node, 'Организация') ?? related(common, 'Организация')),
    companyRef: ref(related(node, 'Контрагент', 'Партнер') ?? related(common, 'Контрагент', 'Партнер')),
    operation: prop(node, 'ВидОперации', 'ВидРасчетов') ?? field(common, 'ВидОперации'),
    serviceOnly: type === 'realization' && !element(element(node, 'Товары'), 'Строка') && !!element(element(node, 'Услуги'), 'Строка') };
}

type BalanceSection = 'stock' | 'money' | 'bank' | 'cash' | 'settlement';
const balanceSections = new Map<string, BalanceSection>([
  ['ОстаткиСобственныхТМЦ', 'stock'], ['СобственныеТМЦ', 'stock'], ['Товары', 'stock'], ['Запасы', 'stock'], ['ОстаткиТоваров', 'stock'], ['ТоварыНаСкладах', 'stock'], ['ВводОстатковТоваров', 'stock'],
  ['ДенежныеСредства', 'money'], ['ОстаткиДенежныхСредств', 'money'], ['ОстаткиДенег', 'money'], ['ВводОстатковДенежныхСредств', 'money'],
  ['Касса', 'cash'], ['НаличныеДенежныеСредства', 'cash'], ['ОстаткиНаличныхДенежныхСредств', 'cash'], ['ОстаткиВКассе', 'cash'],
  ['ОстаткиБезналичныхДенежныхСредств', 'bank'], ['БанковскиеСчета', 'bank'], ['БезналичныеДенежныеСредства', 'bank'], ['ОстаткиНаБанковскихСчетах', 'bank'],
  ['Взаиморасчеты', 'settlement'], ['ОстаткиВзаиморасчетов', 'settlement'], ['РасчетыСКонтрагентами', 'settlement'],
  ['ЗадолженностьКонтрагентов', 'settlement'], ['ВводОстатковВзаиморасчетов', 'settlement'],
]);
const openingNames = new Set(['ВводНачальныхОстатков', 'НачальныеОстатки', 'ВводОстатков', 'Остатки']);
const balanceRows = new Set(['Строка', 'Остаток', 'Запись', 'ОстатокТовара', 'ОстатокДенежныхСредств', 'ОстатокВзаиморасчетов',
  'СтрокаЗапасов', 'СтрокаТоваров', 'СтрокаДенежныхСредств', 'СтрокаВзаиморасчетов']);
const settlementTypes: Record<string, { side: 'customer' | 'supplier'; negative: boolean }> = {
  ОстаткиРасчетовСПокупателямиДолги: { side: 'customer', negative: false },
  ОстаткиРасчетовСПокупателямиАвансы: { side: 'customer', negative: true },
  ОстаткиРасчетовСПоставщикамиДолги: { side: 'supplier', negative: true },
  ОстаткиРасчетовСПоставщикамиАвансы: { side: 'supplier', negative: false },
};

function parseBalance(row: Element, inherited: Element[], section: BalanceSection, settlement?: typeof settlementTypes[string]): IcBalance | undefined {
  const [source, ...parents] = [row, ...inherited];
  const get = (...names: string[]) => prop(source, ...names) ?? parents.map(parent => prop(parent, ...names)).find(Boolean);
  const relation = (...names: string[]) => related(source, ...names) ?? parents.map(parent => related(parent, ...names)).find(Boolean);
  const lookup = (...names: string[]) => ref(relation(...names));
  const day = get('ДатаОстатков', 'ДатаСреза', 'НаДату', 'Дата');
  const base = { date: date(day), organizationRef: lookup('Организация') };
  if (day && !base.date) return undefined;
  const rawAmount = prop(row, 'СуммаОстаток', 'СуммаОстатка', 'Сумма', 'СуммаВзаиморасчетов', 'СуммаУпр', 'СуммаРегл', 'СуммаОстаткаВВалюте', 'Задолженность', 'Стоимость', 'Себестоимость');
  const amount = decimal(rawAmount);
  if (rawAmount !== undefined && amount === undefined) return undefined;
  if (section === 'stock') {
    const qty = decimal(prop(row, 'КоличествоОстаток', 'КоличествоОстатка', 'Количество'));
    const rawCost = prop(row, 'СебестоимостьЕдиницы', 'Цена');
    const cost = decimal(rawCost);
    if (qty === undefined || (rawCost !== undefined && cost === undefined)) return undefined;
    return { ...base, kind: 'stock', productRef: ref(productReference(row)) ?? lookup('Номенклатура', 'Товар'), warehouseRef: lookup('Склад', 'МестоХранения'),
      qty, unitCode: classification(related(row, 'ЕдиницаИзмерения')), amount: amount ?? (cost ? fmt(mul(dec(qty), dec(cost)), 2) : '0'),
      hasCost: amount !== undefined || cost !== undefined };
  }
  if (amount === undefined) return undefined;
  const currency = classification(relation('Валюта', 'ВалютаДенежныхСредств', 'ВалютаВзаиморасчетов'));
  if (section === 'settlement') {
    const side = get('ВидРасчетов', 'ВидДоговора');
    const sourceAmount = settlement ? (settlement.negative ? '-' : '') + amount.replace(/^-/, '') : amount;
    return { ...base, kind: 'settlement', companyRef: lookup('Контрагент', 'Партнер', 'Покупатель', 'Поставщик'),
      contractRef: lookup('Договор', 'ДоговорКонтрагента') ?? ref(related(relation('ДанныеВзаиморасчетов'), 'Договор')),
      amount: sourceAmount, currency, side: settlement?.side ?? (side === 'СПокупателем' ? 'customer' : side === 'СПоставщиком' ? 'supplier' : undefined) };
  }
  const cash = lookup('Касса', 'КассаОрганизации');
  const bank = lookup('БанковскийСчет', 'БанковскийСчетОрганизации', 'РасчетныйСчет', 'Счет');
  const kind = section === 'cash' || (section === 'money' && !!cash) ? 'cash' : 'bank';
  return { ...base, kind, accountRef: kind === 'cash' ? cash : bank, amount, currency };
}

const invalidXmlCharacter = /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u;
function assertSafeXml(xml: string) {
  if (invalidXmlCharacter.test(xml)) throw new EnterpriseDataParseError('invalid_enterprise_data');
  const declarations = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!\s*(?:DOCTYPE|ENTITY)\b|&#(?:x([0-9a-f]+)|([0-9]+));/gi;
  for (const token of xml.matchAll(declarations)) {
    if (token[0].startsWith('&#')) {
      const point = Number.parseInt(token[1] ?? token[2]!, token[1] ? 16 : 10);
      if (point > 0x10ffff || invalidXmlCharacter.test(String.fromCodePoint(point))) throw new EnterpriseDataParseError('invalid_enterprise_data');
    } else if (!token[0].startsWith('<!--') && !token[0].startsWith('<![')) {
      throw new EnterpriseDataParseError('invalid_enterprise_data');
    }
  }
}

/** Parse UTF-8 XML without a DTD, external entities, schema loads or network I/O. */
export function parseEnterpriseDataXml(input: string | Uint8Array): ParsedEnterpriseData {
  if (input.length > ENTERPRISE_DATA_MAX_BYTES ||
    (typeof input === 'string' && new TextEncoder().encode(input).length > ENTERPRISE_DATA_MAX_BYTES)) {
    throw new EnterpriseDataParseError('payload_too_large');
  }
  let root: Element | null;
  try {
    const xml = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input);
    assertSafeXml(xml);
    root = new DOMParser({ onError: onErrorStopParsing }).parseFromString(xml, 'application/xml').documentElement;
  } catch {
    throw new EnterpriseDataParseError('invalid_enterprise_data');
  }
  const body = root?.localName === 'Message' ? element(root, 'Body') : root?.localName === 'Body' ? root : undefined;
  const header = element(root ?? undefined, 'Header');
  const format = field(header, 'Format');
  const schema = [body?.namespaceURI, ...Array.from(children(body), node => node.namespaceURI)]
    .find(value => value?.startsWith(`${FORMAT}/`)) ?? (format === FORMAT ? `${FORMAT}/${field(header, 'AvailableVersion')}` : format);
  const version = schema && versions.includes(schema) ? schema.slice(-4) : undefined;
  if (!body || (version !== '1.15' && version !== '1.17')) throw new EnterpriseDataParseError('invalid_enterprise_data');

  const catalogs: IcCatalogObject[] = [];
  const documents: IcParsedDocument[] = [];
  const balances: IcBalance[] = [];
  const balanceSnapshots: IcBalanceSnapshot[] = [];
  const references = new Map<string, IcCatalogObject>();
  const referenceTypes = new Map<string, IcCatalogType>([
    ['Организация', 'organization'], ['Контрагент', 'company'], ['Партнер', 'company'], ['Покупатель', 'company'], ['Поставщик', 'company'],
    ['Договор', 'contract'], ['ДоговорКонтрагента', 'contract'], ['Номенклатура', 'product'], ['Товар', 'product'],
    ['Склад', 'warehouse'], ['МестоХранения', 'warehouse'], ['БанковскийСчет', 'bank_account'], ['БанковскийСчетОрганизации', 'bank_account'],
    ['РасчетныйСчет', 'bank_account'], ['Касса', 'cash_register'], ['КассаОрганизации', 'cash_register'],
  ]);
  const addReference = (node: Element, type: IcCatalogType, organizationRef?: string) => {
    const record = catalog(node, type);
    if (record) {
      const key = `${type}:${record.refUuid}`;
      if (!references.has(key)) references.set(key, { ...record,
        organizationRef: record.organizationRef ?? (type === 'cash_register' || type === 'bank_account' ? organizationRef : undefined) });
    }
  };
  const lname = (el: Element) => el.localName ?? '';
  const readReferences = (node: Element, organizationRef?: string) => {
    for (const level of [node, keys(node), element(node, 'ОбщиеДанные'), element(node, 'ДанныеНоменклатуры'), element(node, 'ДанныеВзаиморасчетов')]) {
      for (const child of children(level)) {
        const kind = referenceTypes.get(lname(child));
        if (kind) addReference(child, kind, organizationRef);
      }
    }
  };
  const issues: EnterpriseDataParseIssue[] = [];
  const seen = new Set<string>();
  const collectBalances = (node: Element, section: BalanceSection, inherited: Element[], settlement?: typeof settlementTypes[string]) => {
    if (inherited.length > 16) throw new EnterpriseDataParseError('invalid_enterprise_data');
    const levels = [node, ...inherited];
    const parent = levels.at(-1)!;
    const nested = [...children(node)].filter(child => lname(child) !== lname(node) && (
      (balanceSections.get(lname(child)) === section && !related(child, 'Ссылка', 'Количество', 'Сумма')) ||
      (section === 'money' && ['bank', 'cash'].includes(balanceSections.get(lname(child)) ?? '') && !ref(child)) ||
      ['ДанныеОстатков', 'Остатки', 'Строки'].includes(lname(child))
    ));
    const rows = [...children(node)].filter(child => balanceRows.has(lname(child)));
    const hasValues = related(node, 'Количество', 'КоличествоОстаток', 'КоличествоОстатка', 'Сумма', 'СуммаОстаток', 'СуммаОстатка',
      'СуммаВзаиморасчетов', 'СуммаУпр', 'СуммаРегл', 'СуммаОстаткаВВалюте', 'Стоимость', 'Себестоимость', 'СебестоимостьЕдиницы', 'Задолженность');
    if (!rows.length && hasValues) rows.push(node);
    const dateValue = levels.map(level => prop(level, 'ДатаОстатков', 'ДатаСреза', 'НаДату', 'Дата')).find(Boolean);
    const organizationRef = levels.map(level => ref(related(level, 'Организация'))).find(Boolean);
    readReferences(node, organizationRef);
    for (const row of rows) {
      const parsed = parseBalance(row, levels, section, settlement);
      if (parsed) {
        balances.push(parsed);
        readReferences(row, parsed.organizationRef);
      } else issues.push({ type: section, refUuid: ref(parent), reason: 'invalid_balance' });
    }
    for (const child of nested) collectBalances(child, balanceSections.get(lname(child)) ?? section, levels, settlement);
    if (rows.length || nested.length) return;
    const empty = ![...children(node)].some(child => !['КлючевыеСвойства', 'Дата', 'ДатаОстатков', 'ДатаСреза', 'НаДату', 'Организация',
      'Номер', 'Ссылка', 'Проведен', 'Проведён', 'Комментарий'].includes(lname(child)));
    if (!empty || (dateValue && !date(dateValue))) {
      issues.push({ type: section, refUuid: ref(parent), reason: 'invalid_balance' });
    } else {
      const kinds = section === 'money' ? ['bank', 'cash'] as const : [section];
      for (const kind of kinds) balanceSnapshots.push({ kind, date: date(dateValue), organizationRef });
    }
  };

  for (const node of children(body)) {
    if (node.namespaceURI?.startsWith(`${FORMAT}/`) && node.namespaceURI !== schema) {
      throw new EnterpriseDataParseError('invalid_enterprise_data');
    }
    const xsiType = node.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type')?.split(':').at(-1);
    const nodeName = lname(node);
    const nameInFormat = nodeName.includes('.') ? nodeName : xsiType ?? nodeName;
    const [prefix, name = prefix] = nameInFormat.split('.', 2);
    if (prop(node, 'ПометкаУдаления') === 'true') continue;
    const type = prefix === 'Справочник' ? catalogNames.get(name!) : undefined;
    if (type) {
      const parsed = catalog(node, type);
      const id = `${type}:${parsed?.refUuid}`;
      if (!parsed) issues.push({ type, refUuid: ref(node), name: prop(node, 'Наименование'), reason: 'invalid_catalog' });
      else if (seen.has(id)) issues.push({ type, refUuid: parsed.refUuid, name: parsed.name, reason: 'duplicate_catalog' });
      else { seen.add(id); catalogs.push(parsed); }
      continue;
    }
    if (prefix === 'Документ' && ['false', '0'].includes(prop(node, 'Проведен', 'Проведён') ?? '')) continue;
    if (openingNames.has(name!)) {
      readReferences(node);
      for (const section of children(node)) {
        const kind = balanceSections.get(lname(section));
        if (kind) collectBalances(section, kind, [node]);
      }
      continue;
    }
    const settlement = Object.hasOwn(settlementTypes, name!) ? settlementTypes[name!] : undefined;
    const balance = settlement ? 'settlement' : balanceSections.get(name!);
    if (balance) {
      collectBalances(node, balance, [], settlement);
      continue;
    }
    const docType = prefix === 'Документ' ? documentType(name!) : undefined;
    if (!docType) continue;
    const parsed = parseDocument(node, docType);
    const id = `document:${parsed?.refUuid}`;
    if (!parsed) issues.push({ type: docType, refUuid: ref(node), name: prop(node, 'Номер'), reason: 'invalid_document' });
    else if (parsed.refUuid && seen.has(id)) issues.push({ type: docType, refUuid: parsed.refUuid, name: parsed.number, reason: 'duplicate_document' });
    else {
      if (parsed.refUuid) seen.add(id);
      documents.push(parsed);
      readReferences(node, parsed.organizationRef);
    }
  }
  // Inline key properties help match references in partial exports, without treating them as
  // full catalog records. A named cash register referenced by a balance can be created on import.
  for (const row of balances) {
    if (row.kind !== 'cash' || !row.accountRef) continue;
    const key = `cash_register:${row.accountRef}`;
    const account = references.get(key);
    if (!seen.has(key) && account?.organizationRef) {
      seen.add(key);
      catalogs.push(account);
    }
  }
  return { version, catalogs, documents, balances, balanceSnapshots, references: [...references.values()], issues };
}
