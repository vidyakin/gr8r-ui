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
}
