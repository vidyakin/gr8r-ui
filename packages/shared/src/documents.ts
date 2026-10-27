/* Документы продаж и закупок: типы, статусы, расчёт сумм строк и итогов (НДС «в т.ч.» / «сверху») и средняя скользящая
   себестоимость склада. Чистые функции на десятичных из decimal.ts — одни и те же на сервере (проведение) и в интерфейсе
   (мгновенный пересчёт табличной части). Деньги внутри считаются целыми копейками, наружу идут строками с двумя знаками. */
import { dec, fmt, roundDiv, type Dec } from './decimal';
import type { VatRate } from './constants';

/* ---------------- типы и статусы ---------------- */

export const DOCUMENT_TYPES = ['quote', 'customer_order', 'invoice', 'realization', 'act', 'customer_return', 'supplier_order', 'receipt', 'supplier_return', 'stock_transfer', 'write_off', 'stock_posting', 'inventory_count', 'production_order', 'production', 'work_order', 'piecework_order', 'other_costs', 'material_allocation', 'tolling_receipt', 'tolling_report', 'tolling_return', 'sales_plan', 'service_day', 'cash_receipt', 'cash_payment', 'bank_receipt', 'bank_payment', 'advance_report', 'payment_request'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DOCUMENT_GROUPS = ['sales', 'purchases', 'stock', 'production', 'tolling', 'cash'] as const;
export type DocumentGroup = (typeof DOCUMENT_GROUPS)[number];
export const PRINT_FORMS = ['invoice', 'upd', 'act', 'torg12', 'inv3', 'torg16', 'torg13', 'work_order', 'piecework', 'warranty_card', 'repair_receipt', 'repair_return', 'ko1', 'ko2'] as const;
export type PrintForm = (typeof PRINT_FORMS)[number];
export const PRINT_FORM_LABELS: Record<PrintForm, string> = { invoice: 'Invoice for payment', upd: 'UPD', act: 'Service act', torg12: 'TORG-12', inv3: 'INV-3 (inventory list)', torg16: 'TORG-16 (write-off act)', torg13: 'TORG-13 (internal transfer)', work_order: 'Work order (job sheet)', piecework: 'Piecework order', warranty_card: 'Warranty card', repair_receipt: 'Repair acceptance act', repair_return: 'Repair return act', ko1: 'Cash receipt order (KO-1)', ko2: 'Cash payment order (KO-2)' };

/** Вид склада: обычный склад, цех участка и служебный склад «в пути» */
export const WAREHOUSE_KINDS = ['warehouse', 'workshop', 'transit'] as const;
export type WarehouseKind = (typeof WAREHOUSE_KINDS)[number];
/** Статья затрат или доходов */
export const COST_ITEM_KINDS = ['expense', 'income'] as const;
export type CostItemKind = (typeof COST_ITEM_KINDS)[number];
/** Вид операции внутреннего документа */
export const DOCUMENT_OPERATIONS = ['transfer', 'in_transit', 'to_operation', 'from_operation', 'assembly', 'disassembly', 'processing', 'from_customer', 'supplier_refund', 'from_accountable', 'other_income', 'to_supplier', 'customer_refund', 'to_accountable', 'other_expense', 'money_transfer'] as const;
export type DocumentOperation = (typeof DOCUMENT_OPERATIONS)[number];
/** Виды операции производственных документов: сборка и разборка */
export const PRODUCTION_OPERATIONS = ['assembly', 'disassembly'] as const;
export type ProductionOperation = (typeof PRODUCTION_OPERATIONS)[number];
/** Виды перемещения между складами: сразу, «в пути», в эксплуатацию и обратно */
export const TRANSFER_OPERATIONS = ['transfer', 'in_transit', 'to_operation', 'from_operation'] as const;
export type TransferOperation = (typeof TRANSFER_OPERATIONS)[number];
/** Роль строки внутреннего документа: приход или расход */
export const STOCK_ROLES = ['in', 'out'] as const;
export type StockRole = (typeof STOCK_ROLES)[number];
/** Чей материал в строке выпуска: наш или давальца (учитывается только количественно) */
export const MATERIAL_OWNERS = ['own', 'customer'] as const;
export type MaterialOwner = (typeof MATERIAL_OWNERS)[number];
export const MATERIAL_OWNER_LABELS: Record<MaterialOwner, string> = { own: 'Own', customer: "Customer's" };
/** Вкладка строки отчёта о переработке: продукция, использованное сырьё или отходы */
export const TOLLING_ROLES = ['product', 'material', 'waste'] as const;
export type TollingRole = (typeof TOLLING_ROLES)[number];
export const TOLLING_ROLE_LABELS: Record<TollingRole, string> = { product: 'Products', material: 'Materials', waste: 'Waste' };

/** Состояние документа (отдельно от проведения): «в работе», «выполнен» и т. п. */
export interface DocumentStateDef {
  key: string;
  label: string;
  color?: string;
  category?: string;
  /** Состояния, в которые можно перейти из этого (если не указаны — в любые неконечные) */
  next?: string[];
  /** Конечное состояние: из него переходов нет */
  final?: boolean;
}

export interface DocumentTypeMeta {
  label: string;
  group: DocumentGroup;
  /** Префикс номера: «СЧ-2026-00042» */
  prefix: string;
  /** Движение остатков при проведении (у внутренних документов направление задаёт роль строки) */
  stock: 'in' | 'out' | null;
  /** Контрагент: покупатель или поставщик; null — внутренний документ, контрагент не нужен */
  party: 'customer' | 'supplier' | null;
  /** Из каких документов можно создать «на основании» */
  basedOn: DocumentType[];
  /** Документ исполняет заказ (его строки уменьшают остаток к отгрузке/поступлению) */
  fulfils: boolean;
  /** Печатные формы */
  forms: PrintForm[];
  /** Документ резервирует товар под заказ */
  reserves?: boolean;
  /** Тип — заказ: его строки — источник origin_line_id для документов-исполнителей */
  isOrder?: boolean;
  /** Типы-исполнители, снимающие резерв этого заказа */
  reservedUntil?: DocumentType[];
  /** Тип — возврат: его строки ссылаются на строки исходного документа */
  isReturn?: boolean;
  /** Статья затрат или доходов обязательна у этого типа */
  costItemKind?: CostItemKind;
  /** Направление движения внутреннего документа: расход, приход или перемещение (две стороны) */
  stockRole?: 'out' | 'in' | 'transfer';
  /** Состояния документа (отдельно от проведения) */
  states?: DocumentStateDef[];
  /** Вид операции внутреннего документа */
  operation?: DocumentOperation;
  /** Документ переработки: приём, отчёт или возврат давальческого сырья */
  tolling?: 'receipt' | 'report' | 'return';
  /** Документ без цен: приём и возврат давальческого сырья ничего не продают */
  noPrice?: boolean;
  /** Тип производства: в шапке два склада (материалы и продукция), роль строки задаёт каждая строка */
  production?: boolean;
  /** Тип со своими строками вне document_lines (строки без товара: «Прочие затраты») */
  ownLines?: boolean;
  /** Документ ведётся в своём разделе (план продаж в CRM): в общих журналах группы и меню «Создать» его нет */
  section?: boolean;
  /** Документ создаётся и открывается в своём разделе (запись на приём): в журнале есть, в меню «Создать» нет */
  own?: boolean;
}

/** Состояния заказа на производство (отдельно от проведения) */
/** Состояния перемещения «в пути»: отправлено → принято (возврат назад отменяет приёмку) */
export const TRANSIT_STATES: DocumentStateDef[] = [
  { key: 'shipped', label: 'Shipped', next: ['received'] },
  { key: 'received', label: 'Received', next: ['shipped'] },
];

export const PRODUCTION_ORDER_STATES: DocumentStateDef[] = [
  { key: 'planned', label: 'Planned', next: ['in_progress'] },
  { key: 'in_progress', label: 'In progress', next: ['done'] },
  { key: 'done', label: 'Done', next: ['closed'] },
  { key: 'closed', label: 'Closed', final: true },
];

/** Этап выпуска по умолчанию: «Завершение производства». Виды производства и список этапов — справочник (этап 4б);
    спецификация без вида производства работает как раньше — единственный этот этап */
export const PRODUCTION_STAGES = [{ key: 'final', label: 'Completion of production', isFinal: true }] as const;
export type ProductionStageKey = (typeof PRODUCTION_STAGES)[number]['key'];

export const DOCUMENT_META: Record<DocumentType, DocumentTypeMeta> = {
  quote: { label: 'Quote', group: 'sales', prefix: 'КП', stock: null, party: 'customer', basedOn: [], fulfils: false, forms: ['invoice'] },
  customer_order: { label: 'Customer order', group: 'sales', prefix: 'ЗК', stock: null, party: 'customer', basedOn: ['quote'], fulfils: false, forms: ['invoice'], reserves: true, isOrder: true, reservedUntil: ['realization'] },
  invoice: { label: 'Invoice', group: 'sales', prefix: 'СЧ', stock: null, party: 'customer', basedOn: ['quote', 'customer_order', 'work_order'], fulfils: false, forms: ['invoice'] },
  realization: { label: 'Shipment (UPD)', group: 'sales', prefix: 'РТ', stock: 'out', party: 'customer', basedOn: ['customer_order', 'invoice'], fulfils: true, forms: ['upd', 'torg12', 'warranty_card'] },
  act: { label: 'Service act', group: 'sales', prefix: 'АКТ', stock: null, party: 'customer', basedOn: ['customer_order', 'invoice'], fulfils: true, forms: ['act'] },
  customer_return: { label: 'Customer return', group: 'sales', prefix: 'ВК', stock: 'in', party: 'customer', basedOn: ['realization'], fulfils: false, forms: [], isReturn: true },
  supplier_order: { label: 'Supplier order', group: 'purchases', prefix: 'ЗС', stock: null, party: 'supplier', basedOn: [], fulfils: false, forms: [], isOrder: true, reservedUntil: ['receipt'] },
  receipt: { label: 'Goods receipt', group: 'purchases', prefix: 'ПТ', stock: 'in', party: 'supplier', basedOn: ['supplier_order'], fulfils: true, forms: [] },
  supplier_return: { label: 'Supplier return', group: 'purchases', prefix: 'ВС', stock: 'out', party: 'supplier', basedOn: ['receipt'], fulfils: false, forms: [], isReturn: true },
  // внутренние документы: контрагента нет, направление движения задаёт роль строки
  stock_transfer: { label: 'Stock transfer', group: 'stock', prefix: 'ПМ', stock: null, party: null, basedOn: [], fulfils: false, forms: ['torg13'], stockRole: 'transfer', operation: 'transfer', states: TRANSIT_STATES },
  write_off: { label: 'Write-off', group: 'stock', prefix: 'СП', stock: null, party: null, basedOn: ['inventory_count', 'production'], fulfils: false, forms: ['torg16'], stockRole: 'out', costItemKind: 'expense' },
  stock_posting: { label: 'Goods posting', group: 'stock', prefix: 'ОП', stock: null, party: null, basedOn: ['inventory_count'], fulfils: false, forms: [], stockRole: 'in', costItemKind: 'income' },
  // инвентаризация: остатки не двигает, результат оформляется списанием и оприходованием на основании
  inventory_count: { label: 'Inventory count', group: 'stock', prefix: 'ИНВ', stock: null, party: null, basedOn: [], fulfils: false, forms: ['inv3'], isOrder: true },
  // производство: заказ на производство и выпуск (списание материалов + приход продукции)
  production_order: { label: 'Production order', group: 'production', prefix: 'ЗП', stock: null, party: null, basedOn: ['customer_order'], fulfils: false, forms: [], states: PRODUCTION_ORDER_STATES, operation: 'assembly', production: true },
  production: { label: 'Production', group: 'production', prefix: 'ПР', stock: null, party: null, basedOn: ['production_order', 'customer_order'], fulfils: false, forms: [], operation: 'assembly', production: true },
  // заказ-наряд: сам является продажей — при входе в состояние категории «done» он проводится целиком
  // (выручка, долг клиента, расход товаров и материалов), частичной отгрузки нет
  work_order: { label: 'Work order', group: 'sales', prefix: 'ЗН', stock: 'out', party: 'customer', basedOn: ['quote', 'customer_order'], fulfils: true, forms: ['work_order', 'act', 'upd', 'torg12', 'invoice', 'warranty_card', 'repair_receipt', 'repair_return'] },
  // сдельный наряд: выполненные операции исполнителя за день (зарплата не начисляется — только отчёт к оплате)
  piecework_order: { label: 'Piecework order', group: 'production', prefix: 'СН', stock: null, party: null, basedOn: [], fulfils: false, forms: ['piecework'] },
  // прочие затраты: косвенные затраты периода без склада (строки — статья, участок, сумма; своего товара у них нет)
  // план продаж: сценарий и периоды в своей шапке, строки — период × значение разреза (раздел CRM «План продаж»)
  // оказанные услуги за день: один на специалиста, строки — клиент, услуга, время; проведение создаёт продажу по каждому клиенту
  service_day: { label: 'Services of the day', group: 'sales', prefix: 'ОУ', stock: null, party: null, basedOn: [], fulfils: false, forms: [], ownLines: true, own: true },
  sales_plan: { label: 'Sales plan', group: 'sales', prefix: 'ПП', stock: null, party: null, basedOn: [], fulfils: false, forms: [], ownLines: true, section: true },
  // оплаты (задача 1174б): деньги по кассам и счетам; строки — расшифровка суммы в payment_lines, склада и товаров нет
  cash_receipt: { label: 'Cash receipt', group: 'cash', prefix: 'ПКО', stock: null, party: null, basedOn: [], fulfils: false, forms: ['ko1'], ownLines: true, section: true },
  cash_payment: { label: 'Cash payment', group: 'cash', prefix: 'РКО', stock: null, party: null, basedOn: [], fulfils: false, forms: ['ko2'], ownLines: true, section: true },
  bank_receipt: { label: 'Bank receipt', group: 'cash', prefix: 'ПС', stock: null, party: null, basedOn: [], fulfils: false, forms: [], ownLines: true, section: true },
  bank_payment: { label: 'Bank payment', group: 'cash', prefix: 'СС', stock: null, party: null, basedOn: [], fulfils: false, forms: [], ownLines: true, section: true },
  payment_request: { label: 'Payment request', group: 'cash', prefix: 'ЗР', stock: null, party: null, basedOn: [], fulfils: false, forms: [], ownLines: true, section: true },
  advance_report: { label: 'Advance report', group: 'cash', prefix: 'АО', stock: null, party: null, basedOn: [], fulfils: false, forms: [], ownLines: true, section: true },
  other_costs: { label: 'Other costs', group: 'production', prefix: 'ПЗ', stock: null, party: null, basedOn: ['work_order'], fulfils: false, forms: [], ownLines: true },
  // распределение материалов по итогам смены: фактический расход делится между выпусками участка в режиме «по итогам смены»
  material_allocation: { label: 'Material allocation', group: 'production', prefix: 'РМ', stock: null, party: null, basedOn: [], fulfils: false, forms: [], stockRole: 'out' },
  // переработка давальческого сырья (мы — переработчик): приём сырья заказчика, отчёт перед ним и возврат остатков
  tolling_receipt: { label: 'Receipt for processing', group: 'tolling', prefix: 'ППР', stock: null, party: 'customer', basedOn: ['customer_order'], fulfils: false, forms: [], tolling: 'receipt', noPrice: true },
  tolling_report: { label: 'Processing report', group: 'tolling', prefix: 'ОРП', stock: null, party: 'customer', basedOn: ['customer_order'], fulfils: false, forms: ['act'], tolling: 'report' },
  tolling_return: { label: 'Return of unused materials', group: 'tolling', prefix: 'ВПР', stock: null, party: 'customer', basedOn: ['customer_order'], fulfils: false, forms: [], tolling: 'return', noPrice: true },
};

/** Виды операции, которые выбирает пользователь (у остальных типов вид задают метаданные).
    Пусто — вид операции документ не имеет */
export const DOCUMENT_OPERATION_CHOICES: Partial<Record<DocumentType, DocumentOperation[]>> = {
  customer_order: ['processing'],
  supplier_order: ['processing'],
  production: ['processing'],
};

/** Типы документов, исполняющих заказ (остаток к отгрузке / поступлению) */
export const FULFIL_TYPES: DocumentType[] = DOCUMENT_TYPES.filter(t => DOCUMENT_META[t].fulfils);
/** Типы — заказы (их строки — источник origin_line_id) */
export const ORDER_TYPES: DocumentType[] = DOCUMENT_TYPES.filter(t => DOCUMENT_META[t].isOrder);
/** Внутренние документы: без контрагента, со своей ролью строки */
export const INTERNAL_TYPES: DocumentType[] = DOCUMENT_TYPES.filter(t => DOCUMENT_META[t].party === null);
/** Документы переработки давальческого сырья */
export const TOLLING_TYPES: DocumentType[] = DOCUMENT_TYPES.filter(t => DOCUMENT_META[t].tolling);

/** Роль строки по типу документа: у внутренних документов её проставляет сервер (у перемещения обе стороны задаёт шапка) */
export const lineRole = (type: DocumentType): StockRole | null => {
  const m = DOCUMENT_META[type];
  if (m.party) return null;
  if (m.stockRole === 'out') return 'out';
  if (m.stockRole === 'in') return 'in';
  return null;
};

/** Названия документов по-русски: печатные формы и ссылки «Основание» */
export const DOCUMENT_LABELS_RU: Record<DocumentType, string> = {
  quote: 'Коммерческое предложение',
  customer_order: 'Заказ покупателя',
  invoice: 'Счёт на оплату',
  realization: 'Реализация (УПД)',
  act: 'Акт оказания услуг',
  customer_return: 'Возврат от покупателя',
  supplier_order: 'Заказ поставщику',
  receipt: 'Поступление',
  supplier_return: 'Возврат поставщику',
  stock_transfer: 'Перемещение между складами',
  write_off: 'Списание',
  stock_posting: 'Оприходование',
  inventory_count: 'Инвентаризация',
  production_order: 'Заказ на производство',
  production: 'Производство (выпуск)',
  tolling_receipt: 'Приём в переработку',
  tolling_report: 'Отчёт о переработке',
  tolling_return: 'Возврат давальческого сырья',
  work_order: 'Заказ-наряд',
  piecework_order: 'Сдельный наряд',
  other_costs: 'Прочие затраты',
  sales_plan: 'План продаж',
  service_day: 'Оказанные услуги за день',
  material_allocation: 'Распределение материалов',
  cash_receipt: 'Приходный кассовый ордер',
  cash_payment: 'Расходный кассовый ордер',
  bank_receipt: 'Поступление на расчётный счёт',
  bank_payment: 'Списание с расчётного счёта',
  advance_report: 'Авансовый отчёт',
  payment_request: 'Заявка на расход',
};

export const documentTypesOf = (group: DocumentGroup): DocumentType[] => DOCUMENT_TYPES.filter(t => DOCUMENT_META[t].group === group && !DOCUMENT_META[t].section);
/** В какие типы можно создать документ «на основании» данного */
export const basedOnTargets = (from: DocumentType): DocumentType[] => DOCUMENT_TYPES.filter(t => DOCUMENT_META[t].basedOn.includes(from));

/** Номер документа: префикс-год-порядковый номер из пяти цифр */
export const formatDocumentNumber = (type: DocumentType, year: number, seq: number) => `${DOCUMENT_META[type].prefix}-${year}-${String(seq).padStart(5, '0')}`;

/* ---------------- состояние документа ---------------- */

/** Состояния, из которых можно перейти: у типа без состояний — пусто. Из конечного состояния переходов нет.
    Если у состояния объявлен список `next`, переходы идут только по нему */
export function stateTransitions(meta: DocumentTypeMeta, from: string | null): string[] {
  const states = meta.states ?? [];
  if (!states.length) return [];
  if (from === null) return states.filter(s => !s.final).map(s => s.key);
  const cur = states.find(s => s.key === from);
  if (!cur || cur.final) return [];
  return cur.next ?? states.filter(s => s.key !== from && !s.final).map(s => s.key);
}

/** Можно ли перевести документ из одного состояния в другое */
export const canChangeState = (meta: DocumentTypeMeta, from: string | null, to: string): boolean => stateTransitions(meta, from).includes(to);

/* ---------------- состояния заказ-наряда ---------------- */

/** Категории состояний заказ-наряда. Логика привязана к категории, а не к ключу: воркспейс
    переименовывает состояния и добавляет свои, но «выполнен» всегда узнаётся по категории */
export const WORK_ORDER_STATE_CATEGORIES = ['new', 'scheduled', 'in_progress', 'done', 'delivered', 'cancelled'] as const;
export type WorkOrderStateCategory = (typeof WORK_ORDER_STATE_CATEGORIES)[number];
export const WORK_ORDER_CATEGORY_LABELS: Record<WorkOrderStateCategory, string> = {
  new: 'New',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  done: 'Done',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
/** Категории, в которых заказ-наряд ещё в работе: из них он может уйти назад и отменить проведение */
export const WORK_ORDER_OPEN_CATEGORIES: WorkOrderStateCategory[] = ['new', 'scheduled', 'in_progress'];

/** Способы выставления строки работы заказ-наряда: norm — количество × цена, hours — по фактическим часам */
export const WORK_ORDER_BILLING_MODES = ['norm', 'hours'] as const;
export type WorkOrderBillingMode = (typeof WORK_ORDER_BILLING_MODES)[number];
export const WORK_ORDER_BILLING_LABELS: Record<WorkOrderBillingMode, string> = { norm: 'By norm', hours: 'By actual hours' };

export interface WorkOrderStateDef {
  key: string;
  label: string;
  category: WorkOrderStateCategory;
  color?: string;
}

/** Конечные категории: из них выходят только admin и выше */
export const isFinalCategory = (category: WorkOrderStateCategory): boolean => category === 'delivered' || category === 'cancelled';

/** Можно ли перевести заказ-наряд из одного состояния в другое: между рабочими состояниями — любой переход,
    из завершённых — только admin и выше (иначе работа закрыта) */
export function canChangeWorkOrderState(from: WorkOrderStateDef | null, to: WorkOrderStateDef, isAdmin: boolean): boolean {
  if (!to.key) return false;
  if (from && from.key === to.key) return false;
  if (from && isFinalCategory(from.category) && !isAdmin) return false;
  return true;
}

/* ---------------- склад: план движений ---------------- */

export interface StockPlanLine {
  /** id строки документа */
  id: string;
  productId: string;
  qty: string;
  /** Роль строки внутреннего документа: приход или расход (у продаж и закупок — null) */
  stockRole: StockRole | null;
}

export interface StockPlanDoc {
  type: DocumentType;
  /** Склад-источник (у перемещения — откуда уходит товар) */
  warehouseId: string | null;
  /** Склад-получатель (у перемещения — куда приходит товар) */
  targetWarehouseId: string | null;
}

export interface PlannedMove {
  lineId: string;
  productId: string;
  warehouseId: string;
  qty: string;
  direction: 'in' | 'out';
  role: StockRole;
}

/** План движений склада по документу: у продаж и закупок направление задаёт тип документа, у внутренних — роль строки.
    Перемещение даёт две стороны: расход со склада шапки и приход на склад-получатель по каждой строке */
export function stockPlan(doc: StockPlanDoc, lines: StockPlanLine[]): PlannedMove[] {
  const meta = DOCUMENT_META[doc.type];
  const moves: PlannedMove[] = [];
  if (meta.party) {
    // продажи и закупки: одно направление на весь документ
    if (!meta.stock || !doc.warehouseId) return [];
    for (const l of lines) moves.push({ lineId: l.id, productId: l.productId, warehouseId: doc.warehouseId, qty: l.qty, direction: meta.stock, role: meta.stock });
    return moves;
  }
  // внутренние документы: направление строки задаёт тип документа или сама строка (выпуск — этап 2)
  for (const l of lines) {
    const role = l.stockRole ?? (meta.stockRole === 'transfer' ? 'transfer' : meta.stockRole);
    if (role === 'out') {
      if (!doc.warehouseId) continue;
      moves.push({ lineId: l.id, productId: l.productId, warehouseId: doc.warehouseId, qty: l.qty, direction: 'out', role: 'out' });
    } else if (role === 'in') {
      const to = doc.targetWarehouseId ?? doc.warehouseId;
      if (!to) continue;
      moves.push({ lineId: l.id, productId: l.productId, warehouseId: to, qty: l.qty, direction: 'in', role: 'in' });
    } else if (role === 'transfer') {
      if (!doc.warehouseId || !doc.targetWarehouseId) continue;
      moves.push({ lineId: l.id, productId: l.productId, warehouseId: doc.warehouseId, qty: l.qty, direction: 'out', role: 'out' });
      moves.push({ lineId: l.id, productId: l.productId, warehouseId: doc.targetWarehouseId, qty: l.qty, direction: 'in', role: 'in' });
    }
  }
  return moves;
}

/* ---------------- суммы ---------------- */

export const vatPercent = (rate: VatRate | string): number => (rate === 'none' ? 0 : Number(rate));

/** Строка → копейки (округление половины от нуля) */
export const toKop = (v: string | number | null | undefined): bigint => roundDiv(dec(v), 10_000n);
/** Копейки → «1234.50» */
export const fmtKop = (k: bigint): string => fmt(k * 10_000n, 2);

export interface LineInput {
  qty: string | number;
  price: string | number;
  /** Скидка, % */
  discountPct?: string | number | null;
  vatRate: VatRate | string;
}

export interface LineAmounts {
  /** Сумма без НДС */
  net: string;
  vatAmount: string;
  /** Сумма с НДС */
  total: string;
}

function lineKop(l: LineInput, includesVat: boolean): { net: bigint; vat: bigint; total: bigint } {
  const disc = dec(l.discountPct ?? 0);
  if (disc < 0n || disc > 100n * 1_000_000n) throw new RangeError('Discount must be between 0 and 100 percent');
  // стоимость после скидки в копейках = qty × цена × (100 − скидка) — точное целое до единственного округления
  const gross = roundDiv(dec(l.qty) * dec(l.price) * (100n * 1_000_000n - disc), 10n ** 18n);
  const r = BigInt(vatPercent(l.vatRate));
  if (includesVat) {
    const vat = roundDiv(gross * r, 100n + r);
    return { net: gross - vat, vat, total: gross };
  }
  const vat = roundDiv(gross * r, 100n);
  return { net: gross, vat, total: gross + vat };
}

/** Суммы строки. Цена «НДС в т.ч.»: итог = стоимость после скидки, НДС выделяется из него; «НДС сверху»: НДС добавляется к стоимости.
    Округление — до копейки по каждой строке (половина от нуля), итоги документа — суммы округлённых строк */
export function computeLine(l: LineInput, priceIncludesVat: boolean): LineAmounts {
  const k = lineKop(l, priceIncludesVat);
  return { net: fmtKop(k.net), vatAmount: fmtKop(k.vat), total: fmtKop(k.total) };
}

export interface VatBreakdown {
  rate: VatRate | string;
  net: string;
  vat: string;
  total: string;
}

export interface DocumentTotals {
  net: string;
  vat: string;
  total: string;
  /** Итоги по ставкам НДС (для счёта-фактуры и печатных форм), по возрастанию ставки */
  byRate: VatBreakdown[];
}

/** Итоги документа из уже посчитанных сумм строк */
export function computeTotals(lines: (LineAmounts & { vatRate: VatRate | string })[]): DocumentTotals {
  let net = 0n;
  let vat = 0n;
  let total = 0n;
  const by = new Map<string, { rate: string; net: bigint; vat: bigint; total: bigint }>();
  for (const l of lines) {
    const n = toKop(l.net);
    const v = toKop(l.vatAmount);
    const t = toKop(l.total);
    net += n;
    vat += v;
    total += t;
    const g = by.get(l.vatRate) ?? { rate: l.vatRate, net: 0n, vat: 0n, total: 0n };
    g.net += n;
    g.vat += v;
    g.total += t;
    by.set(l.vatRate, g);
  }
  const byRate = [...by.values()].sort((a, b) => vatPercent(a.rate) - vatPercent(b.rate) || (a.rate === 'none' ? 1 : -1)).map(g => ({ rate: g.rate, net: fmtKop(g.net), vat: fmtKop(g.vat), total: fmtKop(g.total) }));
  return { net: fmtKop(net), vat: fmtKop(vat), total: fmtKop(total), byRate };
}

/** Строки и итоги разом: то, что нужно форме документа */
export function computeDocument(lines: (LineInput & { id?: string })[], priceIncludesVat: boolean) {
  const amounts = lines.map(l => ({ ...computeLine(l, priceIncludesVat), vatRate: l.vatRate }));
  return { lines: amounts, totals: computeTotals(amounts) };
}

/* ---------------- склад: средняя скользящая себестоимость ---------------- */

/** Остаток и средняя себестоимость единицы (масштаб decimal.ts) */
export interface StockState {
  qty: Dec;
  avg: Dec;
}

const round4 = (a: Dec): Dec => dec(fmt(a, 4));

/** Приход qty по цене unitCost: средняя пересчитывается взвешенно. Если остаток был нулевым или отрицательным (ушли в минус по
    разрешению), средней становится цена прихода: отрицательные единицы были списаны по старой средней и стоимости не имеют */
export function stockIn(s: StockState, qty: Dec, unitCost: Dec): StockState {
  const next = s.qty + qty;
  if (s.qty <= 0n) return { qty: next, avg: round4(unitCost) };
  // (остаток × средняя + приход × цена) / новый остаток; все величины в масштабе 10^-6, произведение даёт масштаб 10^-12
  return { qty: next, avg: round4(roundDiv(s.qty * s.avg + qty * unitCost, next)) };
}

/** Расход qty: списывается по текущей средней, она не меняется. Возвращает новое состояние и себестоимость единицы */
export function stockOut(s: StockState, qty: Dec): { state: StockState; cost: Dec } {
  return { state: { qty: s.qty - qty, avg: s.avg }, cost: s.avg };
}

export interface ReplayMove {
  /** Со знаком: приход +, расход − */
  qty: Dec;
  /** Приход: цена единицы (вход); расход: заполняется при пересчёте */
  cost: Dec;
}

/** Пересчёт остатка и средней по порядку движений: приходы берут свою цену, расходы получают текущую среднюю.
    Именно так проведение и отмена проведения приводят остаток к единому состоянию — отмена просто перечитывает оставшиеся движения */
export function replayMoves(moves: ReplayMove[]): { state: StockState; moves: ReplayMove[]; minQty: Dec } {
  let s: StockState = { qty: 0n, avg: 0n };
  let minQty = 0n;
  const out: ReplayMove[] = [];
  for (const m of moves) {
    if (m.qty >= 0n) {
      s = stockIn(s, m.qty, m.cost);
      out.push({ qty: m.qty, cost: m.cost });
    } else {
      const r = stockOut(s, -m.qty);
      s = r.state;
      out.push({ qty: m.qty, cost: r.cost });
    }
    if (s.qty < minQty) minQty = s.qty;
  }
  return { state: s, moves: out, minQty };
}

/** Средняя по складам, взвешенная остатком: себестоимость товара «по организации» для расчёта производства */
export function weightedAvgCost(rows: { qty: string; avgCost: string }[]): string | null {
  let q = 0n;
  let v = 0n;
  for (const r of rows) {
    const qty = dec(r.qty);
    if (qty <= 0n) continue;
    q += qty;
    v += qty * dec(r.avgCost);
  }
  if (q <= 0n) return null;
  const avg = roundDiv(v, q);
  return avg > 0n ? fmt(avg, 4) : null;
}
