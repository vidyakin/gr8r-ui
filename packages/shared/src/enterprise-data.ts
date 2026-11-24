/* Файловая выгрузка в 1С. Контракт обмена и ограничения — docs/user/automations/integrations.md. */
import { z } from 'zod';
import { IC_EXCHANGE_PLAN, IC_MESSAGE_NS, type IcMessageHeader, type IcSyncEntityType } from './integrations-1c-sync';
import { uuid, hhmm } from './schemas/common';

export const IC_CATALOG_TYPES = ['organization', 'company', 'contract', 'product', 'warehouse', 'bank_account'] as const;
export const IC_TRADE_DOCUMENT_TYPES = ['realization', 'act', 'receipt'] as const;
export const IC_MONEY_DOCUMENT_TYPES = ['bank_receipt', 'bank_payment', 'cash_receipt', 'cash_payment', 'advance_report'] as const;
export const IC_DOCUMENT_TYPES = [...IC_TRADE_DOCUMENT_TYPES, ...IC_MONEY_DOCUMENT_TYPES] as const;
type CatalogType = typeof IC_CATALOG_TYPES[number];
type ExportDocumentType = typeof IC_DOCUMENT_TYPES[number];

export const icExportSelection = z.object({
  organizationId: uuid.optional(),
  version: z.enum(['1.15', '1.17']).optional(),
  includeCatalogs: z.boolean().optional(),
  includeDocuments: z.boolean().optional(),
  catalogTypes: z.array(z.enum(IC_CATALOG_TYPES)).max(IC_CATALOG_TYPES.length).optional(),
  documentTypes: z.array(z.enum(IC_DOCUMENT_TYPES)).max(IC_DOCUMENT_TYPES.length).optional(),
  saveLinks: z.boolean().optional(),
});
const exportDate = z.iso.date().refine(date => !date.startsWith('0000-'), 'Year must be positive');
export const icExportRequest = icExportSelection.extend({ dateFrom: exportDate, dateTo: exportDate }).strict()
  .refine(v => v.dateFrom <= v.dateTo, { path: ['dateTo'], message: 'End date must be on or after start date' });
export const icExportSchedule = icExportSelection.extend({ enabled: z.boolean(), time: hhmm }).strict();
export type EnterpriseDataOptions = z.infer<typeof icExportRequest>;
export type EnterpriseDataSchedule = z.infer<typeof icExportSchedule>;

export interface EnterpriseDataSummary {
  catalogs: Record<string, number>;
  documents: Record<string, number>;
  totalObjects: number;
  warnings: string[];
}

interface Entity {
  id: string;
  refUuid?: string;
  name: string;
}
interface Party extends Entity {
  fullName?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  kind?: 'legal' | 'sole_proprietor' | 'individual';
}
interface Contract extends Entity {
  organizationId: string;
  companyId: string;
  number: string;
  date: string;
  currency: string;
  kind: 'customer' | 'supplier' | 'other';
}
interface Product extends Entity {
  sku?: string;
  kind: string;
  unitCode: string;
  vatRate: string;
}
interface BankAccount extends Entity {
  organizationId?: string | null;
  companyId?: string | null;
  bik: string;
  account: string;
  bankName: string;
  corrAccount?: string;
  currency?: string;
}
interface Line {
  productId: string;
  unitCode: string;
  qty: string;
  price: string;
  net: string;
  total: string;
  vatRate: string;
  vatAmount: string;
}
interface PaymentLine {
  amount: string;
  comment?: string;
  companyId?: string | null;
  contractId?: string | null;
}
export interface EnterpriseDataDocument {
  id: string;
  refUuid?: string;
  type: ExportDocumentType;
  number: string;
  date: string;
  organizationId: string;
  companyId?: string | null;
  contractId?: string | null;
  warehouseId?: string | null;
  bankAccountId?: string | null;
  targetBankAccountId?: string | null;
  cashRegister?: Entity;
  targetCashRegister?: Entity;
  operation?: string | null;
  accountable?: Entity;
  currency: string;
  comment?: string;
  total: string;
  priceIncludesVat: boolean;
  posted?: boolean;
  lines?: Line[];
  paymentLines?: PaymentLine[];
}
export interface EnterpriseDataInput {
  organizations: Party[];
  companies: Party[];
  contracts: Contract[];
  products: Product[];
  warehouses: Entity[];
  bankAccounts: BankAccount[];
  documents: EnterpriseDataDocument[];
}

export function selectEnterpriseData(input: EnterpriseDataInput, options: EnterpriseDataOptions) {
  const catalog = (type: CatalogType) => options.includeCatalogs !== false && (!options.catalogTypes || options.catalogTypes.includes(type));
  const org = options.organizationId;
  return {
    organizations: catalog('organization') ? input.organizations.filter(row => !org || row.id === org) : [],
    companies: catalog('company') ? input.companies : [],
    contracts: catalog('contract') ? input.contracts.filter(row => !org || row.organizationId === org) : [],
    products: catalog('product') ? input.products : [],
    warehouses: catalog('warehouse') ? input.warehouses : [],
    bankAccounts: catalog('bank_account') ? input.bankAccounts.filter(row => !org || !row.organizationId || row.organizationId === org) : [],
    documents: options.includeDocuments === false ? [] : input.documents.filter(row =>
      (!org || row.organizationId === org) && row.date >= options.dateFrom && row.date <= options.dateTo &&
      (!options.documentTypes || options.documentTypes.includes(row.type))),
  };
}

const FORMAT = 'http://v8.1c.ru/edi/edi_stnd/EnterpriseData';
const escapes: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
const escapeXml = (value: string | boolean) => String(value)
  .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '')
  .replace(/[<>&"']/g, char => escapes[char]!);
const node = (name: string, children: string) => `<${name}>${children}</${name}>`;
const field = (name: string, value?: string | boolean | null) => value == null || value === '' ? '' : node(name, escapeXml(value));
const keys = (children: string) => node('КлючевыеСвойства', children);
const ref = (record: { id: string; refUuid?: string }) => field('Ссылка', record.refUuid ?? record.id);
const dateTime = (date: string) => `${date}T00:00:00`;
const sorted = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const indexById = <T extends Entity>(items: T[]) => new Map(items.map(item => [item.id, item]));
const classification = (tag: string, code: string) => node(tag, node('ДанныеКлассификатора', field('Код', code)));
const currencyCodes: Record<string, string> = {
  RUB: '643', USD: '840', EUR: '978', CNY: '156', KZT: '398', BYN: '933', UZS: '860', GBP: '826', AED: '784',
  MXN: '484', ARS: '032', BRL: '986', CLP: '152', COP: '170', PEN: '604', JPY: '392', TRY: '949', AMD: '051',
};
const currency = (code: string, tag = 'Валюта') => classification(tag, currencyCodes[code] ?? code);
const nameKeys = (item: Entity) => ref(item) + field('Наименование', item.name);
const partyKeys = (item: Party, organization = false) => nameKeys(item)
  + field('НаименованиеПолное', item.fullName || item.name)
  + field('ИНН', item.inn) + field('КПП', item.kpp)
  + (organization ? '' : field('РегистрационныйНомер', item.ogrn))
  + field('ЮридическоеФизическоеЛицо', item.kind === 'individual' || item.kind === 'sole_proprietor'
    ? 'ФизическоеЛицо' : 'ЮридическоеЛицо')
  + (!organization && item.kind === 'sole_proprietor' ? field('ИндивидуальныйПредприниматель', true) : '');
const productKeys = (item: Product) => ref(item) + field('НаименованиеПолное', item.name)
  + field('Артикул', item.sku) + field('Наименование', item.name);
const vat = (rate: string, version: string) => {
  if (version === '1.15') return field('СтавкаНДС', rate === 'none' ? 'БезНДС' : `НДС${rate}`);
  return node('СтавкаНДС', field('Ставка', rate === 'none' ? '0' : rate)
    + field('РасчетнаяСтавка', false) + field('НеОблагается', rate === 'none')
    + field('ВидСтавки', ['5', '7', '10'].includes(rate) ? 'Пониженная' : 'Обычная'));
};

const tradeDocumentNames = { realization: 'РеализацияТоваровУслуг', act: 'РеализацияТоваровУслуг', receipt: 'ПоступлениеТоваровУслуг' };
const paymentPrefixes = { bank_receipt: 'ПБДС', bank_payment: 'СБДС', cash_receipt: 'ПКО', cash_payment: 'РКО' };
const otherPaymentKinds = { bank_receipt: 'ПрочееПоступление', bank_payment: 'ПрочееСписание', cash_receipt: 'ПрочееПоступление', cash_payment: 'ПрочаяВыдача' };
const settlementKinds: Readonly<Record<string, string>> = {
  from_customer: 'СПокупателем', customer_refund: 'СПокупателем',
  to_supplier: 'СПоставщиком', supplier_refund: 'СПоставщиком',
};
const person = (tag: string, row: Entity | undefined) => row ? node(tag, ref(row) + field('ФИО', row.name)) : '';

function paymentKind(type: keyof typeof paymentPrefixes, doc: EnterpriseDataDocument) {
  if (doc.operation === 'from_accountable' || doc.operation === 'to_accountable') return 'РасчетыССотрудниками';
  if (doc.operation === 'salary_payment') return type === 'bank_payment' ? 'ПеречислениеЗаработнойПлаты' : 'ВыплатаЗарплаты';
  if (doc.operation === 'money_transfer') {
    if (doc.targetBankAccountId) return type === 'bank_payment' ? 'ПереводНаДругойСчет' : 'НаБанковскийСчет';
    return type === 'bank_payment' ? 'ПрочееСписание' : 'ВнутренняяПередача';
  }
  if (settlementKinds[doc.operation ?? ''] || (!doc.operation && doc.companyId)) return 'РасчетыСКонтрагентами';
  return otherPaymentKinds[type];
}

/** Warning strings use a stable code followed by a colon and a record name for UI localization. */
export interface EnterpriseDataDelta {
  header: IcMessageHeader;
  createdAt?: string;
  selectedIds?: Partial<Record<IcSyncEntityType, ReadonlySet<string>>>;
  deleted?: { type: IcSyncEntityType; refUuid: string; documentType?: ExportDocumentType }[];
}

export function generateEnterpriseData(input: EnterpriseDataInput, options: EnterpriseDataOptions, delta?: EnterpriseDataDelta): { xml: string; summary: EnterpriseDataSummary } {
  const version = options.version ?? '1.15';
  const namespace = `${FORMAT}/${version}`;
  const namespaceAttribute = escapeXml(namespace);
  const summary: EnterpriseDataSummary = { catalogs: {}, documents: {}, totalObjects: 0, warnings: [] };
  const selected = selectEnterpriseData(input, options);
  if (delta?.selectedIds) {
    const ids = delta.selectedIds;
    selected.organizations = selected.organizations.filter(row => ids.organization?.has(row.id));
    selected.companies = selected.companies.filter(row => ids.company?.has(row.id));
    selected.products = selected.products.filter(row => ids.product?.has(row.id));
    selected.warehouses = selected.warehouses.filter(row => ids.warehouse?.has(row.id));
    selected.documents = selected.documents.filter(row => ids.document?.has(row.id));
    selected.contracts = [];
    selected.bankAccounts = [];
  }
  const body: string[] = [];
  const orgs = indexById(input.organizations);
  const companies = indexById(input.companies);
  const contracts = indexById(input.contracts);
  const products = indexById(input.products);
  const warehouses = indexById(input.warehouses);
  const accounts = indexById(input.bankAccounts);

  const reference = <T extends Entity>(tag: string, id: string | null | undefined, index: Map<string, T>, serialize: (row: T) => string) => {
    if (!id) return '';
    const row = index.get(id);
    return node(tag, row ? serialize(row) : ref({ id }));
  };
  const organization = (id: string | null | undefined) => reference('Организация', id, orgs, row => partyKeys(row, true));
  const company = (id: string | null | undefined) => reference('Контрагент', id, companies, partyKeys);
  const contractKeys = (item: Contract) => ref(item) + organization(item.organizationId) + company(item.companyId)
    + currency(item.currency, 'ВалютаВзаиморасчетов') + field('РасчетыВУсловныхЕдиницах', false)
    + field('Наименование', item.name) + field('Дата', item.date) + field('Номер', item.number)
    + field('ВидДоговора', { customer: 'СПокупателем', supplier: 'СПоставщиком', other: 'Прочее' }[item.kind]);
  const contract = (id: string | null | undefined) => reference('Договор', id, contracts, contractKeys);
  const accountKeys = (item: BankAccount) => ref(item)
    + node('Банк', node('ДанныеКлассификатораБанков', field('БИК', item.bik) + field('Наименование', item.bankName) + field('КоррСчет', item.corrAccount)))
    + (item.organizationId
      ? `<Владелец xsi:type="ed:КлючевыеСвойстваОрганизация">${orgs.has(item.organizationId) ? partyKeys(orgs.get(item.organizationId)!, true) : ref({ id: item.organizationId })}</Владелец>`
      : item.companyId
        ? `<Владелец xsi:type="ed:КлючевыеСвойстваКонтрагент">${companies.has(item.companyId) ? partyKeys(companies.get(item.companyId)!) : ref({ id: item.companyId })}</Владелец>`
        : '')
    + field('НомерСчета', item.account);
  const settlements = (contractId: string | null | undefined) => node('ДанныеВзаиморасчетов',
    contract(contractId) + field('КурсВзаиморасчетов', '1') + field('КратностьВзаиморасчетов', '1'));

  const addCatalog = <T extends Entity>(type: CatalogType, name: string, rows: T[], render: (item: T) => string) => {
    for (const row of sorted(rows)) body.push(node(`Справочник.${name}`, render(row)));
    if (rows.length) summary.catalogs[type] = rows.length;
    summary.totalObjects += rows.length;
  };
  addCatalog('organization', 'Организации', selected.organizations, item =>
    keys(partyKeys(item, true)) + field('ОГРН', item.ogrn));
  addCatalog('company', 'Контрагенты', selected.companies, item =>
    keys(partyKeys(item)));
  addCatalog('contract', 'Договоры', selected.contracts, item =>
    keys(contractKeys(item)));
  addCatalog('product', 'Номенклатура', selected.products, item =>
    keys(productKeys(item)) + field('ТипНоменклатуры', item.kind === 'goods' ? 'Товар' : 'Услуга')
    + classification('ЕдиницаИзмерения', item.unitCode) + vat(item.vatRate, version));
  addCatalog('warehouse', 'Склады', selected.warehouses, item => keys(nameKeys(item)));
  addCatalog('bank_account', 'БанковскиеСчета', selected.bankAccounts, item => keys(accountKeys(item)) + currency(item.currency ?? 'RUB', 'ВалютаДенежныхСредств'));

  const companyIds = new Set([
    ...selected.companies.map(row => row.id), ...selected.contracts.map(row => row.companyId),
    ...selected.bankAccounts.map(row => row.companyId),
    ...selected.documents.flatMap(row => [row.companyId, ...(row.paymentLines ?? []).map(line => line.companyId)]),
  ]);
  for (const item of sorted(input.companies)) {
    if (companyIds.has(item.id) && !item.inn?.trim()) summary.warnings.push(`missing_inn:${item.name}`);
  }

  if (version === '1.15' && (
    selected.products.some(row => row.vatRate === '5' || row.vatRate === '7') ||
    selected.documents.some(doc => doc.lines?.some(row => row.vatRate === '5' || row.vatRate === '7'))
  )) summary.warnings.push('legacy_vat');

  for (const doc of sorted(selected.documents)) {
    const identity = ref(doc) + field('Дата', dateTime(doc.date)) + field('Номер', doc.number) + organization(doc.organizationId);
    const total = currency(doc.currency) + field('Сумма', doc.total);
    let name: string;
    let contents: string;
    if (doc.type === 'realization' || doc.type === 'act' || doc.type === 'receipt') {
      name = tradeDocumentNames[doc.type];
      const goods: string[] = [];
      const services: string[] = [];
      for (const [i, line] of (doc.lines ?? []).entries()) {
        const product = products.get(line.productId);
        const section = doc.type === 'act' || (product && product.kind !== 'goods') ? services : goods;
        section.push(node('Строка', field('НомерСтрокиДокумента', String(i + 1))
          + node('ДанныеНоменклатуры', reference('Номенклатура', line.productId, products, productKeys))
          + classification('ЕдиницаИзмерения', line.unitCode) + field('Количество', line.qty)
          + field('Сумма', doc.priceIncludesVat ? line.total : line.net) + field('Цена', line.price)
          + vat(line.vatRate, version) + field('СуммаНДС', line.vatAmount)));
      }
      contents = keys(identity + company(doc.companyId))
        + (goods.length ? node('Товары', goods.join('')) : '') + (services.length ? node('Услуги', services.join('')) : '')
        + total + field('СуммаВключаетНДС', doc.priceIncludesVat)
        + (doc.type === 'receipt' ? field('ВидОперации', 'ПокупкаУПоставщика') : '')
        + reference('Склад', doc.warehouseId, warehouses, nameKeys)
        + field('Комментарий', doc.comment) + settlements(doc.contractId);
    } else if (doc.type === 'advance_report') {
      name = 'АвансовыйОтчет';
      const expenses = (doc.paymentLines ?? []).map((line, i) => node('Строка', field('НомерСтрокиДокумента', String(i + 1))
        + field('Содержание', line.comment) + field('Сумма', line.amount) + company(line.companyId) + contract(line.contractId))).join('');
      contents = keys(identity) + person('ПодотчетноеЛицо', doc.accountable) + total
        + field('Комментарий', doc.comment) + (expenses ? node('ПрочиеРасходы', expenses) : '');
    } else {
      const bank = doc.type === 'bank_receipt' || doc.type === 'bank_payment';
      const kind = paymentKind(doc.type, doc);
      name = paymentPrefixes[doc.type] + kind;
      const bankAccount = reference('БанковскийСчетОрганизации', doc.bankAccountId, accounts, accountKeys);
      const cashRegister = doc.cashRegister ? node('Касса', nameKeys(doc.cashRegister) + organization(doc.organizationId)) : '';
      const data = node('ОбщиеДанные', (bank ? field('ДатаВыписки', doc.date) : '') + total
        + field('Комментарий', doc.comment) + (bank ? bankAccount : cashRegister));
      const lines = (doc.paymentLines ?? []).map(line => node('Строка', settlements(line.contractId || doc.contractId)
        + field('Сумма', line.amount))).join('');
      contents = keys(identity) + data
        + (kind === 'РасчетыСКонтрагентами'
          ? field('ВидРасчетов', settlementKinds[doc.operation ?? ''] ?? (doc.type.endsWith('_receipt') ? 'СПокупателем' : 'СПоставщиком'))
            + company(doc.companyId)
          : person('ФизическоеЛицо', doc.accountable))
        + reference('БанковскийСчетПолучателя', doc.targetBankAccountId, accounts, accountKeys)
        + (doc.targetCashRegister ? node('КассаПолучатель', nameKeys(doc.targetCashRegister) + organization(doc.organizationId)) : '')
        + (lines ? node('РасшифровкаПлатежа', lines) : '');
    }
    body.push(node(`Документ.${name}`, contents + (delta && doc.posted === false ? field('Проведен', false) : '')));
    summary.documents[doc.type] = (summary.documents[doc.type] ?? 0) + 1;
    summary.totalObjects++;
  }

  const removedCatalogNames = { organization: 'Организации', company: 'Контрагенты', product: 'Номенклатура', warehouse: 'Склады' };
  for (const row of delta?.deleted ?? []) {
    const type = row.documentType;
    const referenceType = row.type !== 'document' ? removedCatalogNames[row.type]
      : !type ? undefined
      : type === 'advance_report' ? 'АвансовыйОтчет'
      : type in tradeDocumentNames ? tradeDocumentNames[type as keyof typeof tradeDocumentNames]
      : paymentPrefixes[type as keyof typeof paymentPrefixes];
    if (!referenceType) continue;
    body.push(node('УдалениеОбъекта', node('СсылкаНаОбъект', node('СсылкаНаОбъект', field(`${referenceType}Ссылка`, row.refUuid)))));
    summary.totalObjects++;
  }
  const confirmation = delta ? node('msg:Confirmation', field('msg:ExchangePlan', IC_EXCHANGE_PLAN)
    + field('msg:To', delta.header.to) + field('msg:From', delta.header.from)
    + field('msg:MessageNo', String(delta.header.messageNo)) + field('msg:ReceivedNo', String(delta.header.receivedNo))) : '';
  const header = node('msg:Header', field('msg:Format', namespace) + field('msg:CreationDate', delta?.createdAt ?? dateTime(options.dateTo))
    + confirmation + field('msg:AvailableVersion', version));
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Message xmlns:msg="${IC_MESSAGE_NS}" xmlns:ed="${namespaceAttribute}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    header, `<Body xmlns="${namespaceAttribute}">`, ...body, '</Body>', '</Message>', '',
  ].join('\n');
  return { xml, summary };
}
