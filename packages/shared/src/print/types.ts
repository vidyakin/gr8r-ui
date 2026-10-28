/* Данные для печатных форм: всё, что нужно шаблону, собрано заранее (сервером или воркером), шаблон — чистая функция «данные → HTML». */
import type { DocumentTotals, DocumentType } from '../documents';
import type { FileRef } from '../schemas/documents';

export interface PrintBank {
  bik: string;
  account: string;
  corrAccount: string;
  bankName: string;
}

export interface PrintParty {
  name: string;
  fullName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  address: string;
  phone: string;
  bank: PrintBank | null;
}

export interface PrintOrganization extends PrintParty {
  kind: 'legal' | 'sole_proprietor' | 'individual';
  directorName: string;
  directorTitle: string;
  accountantName: string;
  taxSystem: 'osn' | 'usn';
  stampFile: FileRef;
  directorSignatureFile: FileRef;
  accountantSignatureFile: FileRef;
}

export interface PrintLine {
  n: number;
  sku: string;
  name: string;
  /** Код ОКЕИ и обозначение единицы */
  unitCode: string;
  unitSymbol: string;
  qty: string;
  /** Цена, как в документе (с НДС или без — по priceIncludesVat) */
  price: string;
  discountPct: string;
  vatRate: string;
  net: string;
  vatAmount: string;
  total: string;
  /** Учётное количество по остаткам (инвентаризация) */
  bookQty?: string;
  /** Разница фактического и учётного количества (инвентаризация) */
  diffQty?: string;
  /** Себестоимость единицы по документу (внутренние документы) */
  cost?: string;
  /** План по строке (сдельный наряд) */
  planQty?: string;
  /** Нормочасы по строке (сдельный наряд) */
  hours?: string;
  /** Расценка по строке (сдельный наряд) */
  rate?: string;
  /** Вид номенклатуры строки (товар, услуга, работа) */
  kind?: string;
  /** Серийные номера строки с гарантией до (товары с учётом по номерам) */
  serials?: { serial: string; warrantyUntil: string | null }[];
  /** Гарантия на товар, мес. */
  warrantyMonths?: number | null;
}

/** Ремонт: изделие клиента и данные для актов приёма и выдачи */
export interface PrintRepair {
  kindType: 'repair' | 'warranty';
  itemName: string;
  serial: string;
  defect: string;
  completeness: string;
  appearance: string;
  receivedAt: string | null;
  returnedAt: string | null;
  /** Гарантия на проданное изделие по реестру номеров (проверка при приёме) */
  saleWarrantyUntil: string | null;
  saleWarrantyActive: boolean | null;
  /** Гарантия на выполненный ремонт, мес. и дата окончания */
  repairWarrantyMonths: number | null;
  repairWarrantyUntil: string | null;
  customerMaterials: { name: string; qty: string; comment: string }[];
}

export interface PrintData {
  type: DocumentType;
  /** null — документ ещё не проведён и номера не имеет */
  number: string | null;
  /** YYYY-MM-DD */
  date: string;
  dueDate: string | null;
  priceIncludesVat: boolean;
  organization: PrintOrganization;
  party: PrintParty;
  lines: PrintLine[];
  totals: DocumentTotals;
  basedOn: { type: DocumentType; number: string | null; date: string } | null;
  comment: string;
  /** Склад документа (внутренние документы) */
  warehouseName?: string;
  /** Склад-получатель (перемещение) */
  targetWarehouseName?: string;
  /** Статья затрат или доходов (списание, оприходование, передача в эксплуатацию) */
  costItemName?: string;
  /** Получатель имущества в эксплуатацию: сотрудник или участок */
  holderName?: string;
  /** Вид операции документа (перемещение) */
  operation?: string;
  /** Заказ-наряд: вид, состояние, материалы и исполнители */
  workOrder?: {
    kindName: string;
    stateLabel: string;
    /** Плановые начало и окончание работ */
    plannedStart?: string | null;
    plannedEnd?: string | null;
    materials: { n: number; name: string; unitCode: string; unitSymbol: string; qty: string }[];
    assignees: { name: string; workCenterName: string | null; plannedHours: string | null; startDate: string | null; dueDate: string | null }[];
  };
  /** Изделие в ремонте (заказ-наряд типа ремонт и гарантийный ремонт) */
  repair?: PrintRepair;
  /** Живая ссылка на онлайн-оплату ЮКассы (счёт и заказ покупателя): печатается ссылкой и QR-кодом; нет ссылки — нет блока */
  paymentLink?: { url: string; amount: string } | null;
  /** Исполнитель сдельного наряда */
  executorName?: string;
  /** Участок сдельного наряда */
  workCenterName?: string;
}
